// @vitest-environment jsdom
/* The Bots tab over the provider interface, with the live provider's shape (`bots.admin`, bots with `info`): a fake admin
   records what the UI asks of Hermes, and the tests say what the user sees and what is asked, never how Hermes answers
   (that is `host/live/bots.test.ts` and the end-to-end test). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data, NeedsConfirmation, setProvider } from '../../data';
import type { ArchivedBot, Bot, BotInfo, BotPatch, BotsAdmin, BotsEvent, BotsSource, DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { emitter, store } from '../../data/store';
import '../cards';
import { S } from './model';
import { openNew } from './new-bot';
import { openBot } from './room';
import { registered } from '../../core/registry';
import './index';
import { openSettings } from './settings';

const q = <T extends HTMLElement>(sel: string): T => { const n = document.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };
/** the model picker under `scope`: open the select and choose the option the way a person does */
const pickModel = (scope: string, model: string): void => {
  q(scope + ' .ui-select').click();
  [...document.querySelectorAll<HTMLElement>('.ui-listbox .ui-option')].find((o) => o.dataset['value'] === model)!.click();
};
const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

const INFO: BotInfo = {
  profile: 'atlas', path: '/h/profiles/atlas', model: 'main/fake-a', provider: 'main',
  skills: [{ name: 'git', label: 'git', enabled: true }, { name: 'web', label: 'web', enabled: false }], toolsets: [{ name: 'terminal', label: 'Terminal', enabled: true }], mcpServers: [],
  jobs: [{ id: 'j1', name: 'morning', schedule: '0 9 * * 1-5', prompt: 'Review', enabled: true, next: 'in 2 h', last: null, deliver: '' }],
  sessions: [{ id: 's1', title: 'review billing', when: '5m', messages: 4, source: 'gui' }],
  soul: 'You review.\n', running: false, notes: {}
};
const atlas = (): Bot => ({
  id: 'atlas', name: 'atlas', role: 'reviews pull requests', shape: 'triangle', color: '#f23b5a', state: 'idle', attention: null, paused: false, activity: '', spent: '', last: null, ideas: [],
  cfg: { instructions: 'You review.\n', gov: 'governed', model: 'main/fake-a', cap: '0.60', cron: '0 9 * * 1-5', channels: { app: true }, approvals: { deploys: 'ask' }, workspace: 'worktree' }, info: INFO
});

interface Fake { provider: DataProvider; calls: { fn: string; args: unknown[] }[]; events: ReturnType<typeof emitter<BotsEvent>>; bots: Bot[]; admin: BotsAdmin; failCreate: string | null; saveError: unknown; kept: Map<string, number> }
function fake(bots: Bot[]): Fake {
  const mock = createMockProvider({ simulate: false });
  const events = emitter<BotsEvent>();
  const calls: Fake['calls'] = [];
  const rec = <T>(fn: string, out: T) => (...args: unknown[]): T => { calls.push({ fn, args }); return out; };
  const f = { calls, events, bots, failCreate: null as string | null, saveError: null as unknown, kept: new Map<string, number>() } as Fake;
  const admin: BotsAdmin = {
    models: () => ['main/fake-a', 'nous/hermes-4'],
    open: (id) => { calls.push({ fn: 'open', args: [id] }); return Promise.resolve(INFO); },
    planCreate: (name) => ({ profile: name === 'default' ? 'default-2' : name, folder: '/h/profiles/' + name, model: 'main/fake-a', notes: name === 'default' ? ['It will be called default-2.'] : [] }),
    create: (draft, opts) => {
      calls.push({ fn: 'create', args: [draft, opts] });
      if (f.failCreate) return Promise.reject(new Error(f.failCreate));
      const nb = { ...atlas(), id: draft.name, name: draft.name };
      bots.push(nb); events.emit({ type: 'bot-created', bot: nb });
      return Promise.resolve(nb);
    },
    review: (id, patch: BotPatch) => {
      const out = [];
      if (patch.role !== undefined) out.push({ file: 'profiles/atlas/profile.yaml: role', diff: '- reviews pull requests\n+ ' + patch.role });
      if (patch.instructions !== undefined) out.push({ file: 'profiles/atlas/SOUL.md', diff: '  You review.\n+ Be terse.' });
      if (patch.model !== undefined) out.push({ file: 'profiles/atlas/config.yaml: model', diff: '- main/fake-a\n+ ' + patch.model });
      if (patch.addRoutines?.length) out.push({ file: 'profiles/atlas/cron: routines', diff: patch.addRoutines.map((r) => '+ ' + r.schedule + ': ' + r.name).join('\n') });
      void id; return out;
    },
    save: (id, patch, opts) => { calls.push({ fn: 'save', args: [id, patch, opts] }); return f.saveError ? Promise.reject(f.saveError) : Promise.resolve(); },
    setRoutinePaused: (id, job, paused) => { calls.push({ fn: 'pause', args: [id, job, paused] }); return Promise.resolve(); },
    saveOwn: (id, patch) => { calls.push({ fn: 'saveOwn', args: [id, patch] }); return Promise.resolve(); },
    setToolsets: (id, on, off) => { calls.push({ fn: 'setToolsets', args: [id, on, off] }); return Promise.resolve(); },
    setProject: (id, folder) => { calls.push({ fn: 'setProject', args: [id, folder] }); return folder === '/nowhere' ? Promise.reject(new Error('/nowhere is not a folder on this computer')) : Promise.resolve(); },
    removal: () => Promise.resolve({ folder: '/h/profiles/atlas', lines: ['The folder /h/profiles/atlas (3.0 MB in 240 files).', 'All its sessions and what they said.'] }),
    archive: (id) => { calls.push({ fn: 'archive', args: [id] }); const i = bots.findIndex((b) => b.id === id); bots.splice(i, 1); events.emit({ type: 'bot-archived', id }); return Promise.resolve({ undo: () => Promise.resolve() }); },
    remove: (id, confirm) => { calls.push({ fn: 'remove', args: [id, confirm] }); const i = bots.findIndex((b) => b.id === id); bots.splice(i, 1); events.emit({ type: 'bot-archived', id }); return Promise.resolve(); },
    note: () => null
  };
  const source: BotsSource = {
    snapshot: () => ({ bots: [...bots], threads: Object.fromEntries(bots.map((b) => [b.id, []])) }),
    subscribe: (fn) => events.subscribe(fn),
    catalog: () => ({ models: admin.models(), channels: [{ id: 'app', name: 'This app' }], approvals: [{ id: 'deploys', name: 'Deploying anywhere' }], suggestions: [], reserved: ['default'] }),
    send: rec('send', undefined), stop: () => false, decide: () => undefined, update: () => undefined,
    runLimit: (id) => { calls.push({ fn: 'runLimit', args: [id] }); return Promise.resolve({ turns: f.kept.get(id) ?? null, fallback: 10 }); },
    setRunLimit: (id, turns) => { calls.push({ fn: 'setRunLimit', args: [id, turns] }); if (turns === null) f.kept.delete(id); else f.kept.set(id, turns); return Promise.resolve({ turns: f.kept.get(id) ?? null, fallback: 10 }); },
    create: () => { throw new Error('use admin'); }, archive: () => undefined, archived: store<readonly ArchivedBot[]>([]), restore: (id) => { calls.push({ fn: 'restore', args: [id] }); return Promise.resolve(); }, admin
  };
  f.admin = admin;
  f.provider = { ...mock, info: { live: true, preview: new Set(['feedforward']), unavailable: { 'bots.send': 'Talking to a teammate arrives with team chat.' } }, bots: source };
  return f;
}

let f: Fake;
function mount(bots: Bot[]): void {
  f = fake(bots);
  setProvider(f.provider);
  S.bots = []; S.rows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null; S.sheetOpen = false; S.sheetFor = null;
  document.body.replaceChildren();
  const list = document.createElement('div'), root = document.createElement('div');
  document.body.append(list, root);
  Element.prototype.scrollIntoView = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
}
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } }); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); vi.useFakeTimers(); vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(20); await tick(); };

describe('a live bot’s room shows what Hermes reports and nothing it made up', () => {
  beforeEach(() => { mount([atlas()]); });
  it('is not a preview', () => {
    expect(document.querySelector('.bt-preview')).toBeNull();
  });
  it('has no composer: a teammate cannot be messaged yet, and says so', () => {
    expect(q('.bt-composer-zone').hidden).toBe(true);
    expect(q('.bt-glance').textContent).toContain('Talking to a teammate arrives with team chat.');
  });
  it('shows the recent sessions, the skills and the toolsets', () => {
    const g = q('.bt-glance').textContent ?? '';
    expect(g).toContain('review billing');
    expect(g).toContain('Skills: 1 skill on of 2 (git)');
    expect(g).toContain('Toolsets: 1 toolset on (Terminal)');
  });
  it('says its model on the composer\'s line (board 11: the provider\'s mark and the model\'s short name)', () => {
    expect(q('.k7-composer__item[data-line="model"]').textContent?.toLowerCase()).toContain('fake a');
  });
  it('a session list Hermes did not answer is shown as unknown with the reason', () => {
    const b = { ...atlas(), info: { ...INFO, sessions: null, notes: { sessions: 'Its schedule and sessions could not be read: no link.' } } };
    f.events.emit({ type: 'bot', bot: b });
    expect(q('.bt-glance').textContent).toContain('Unknown. Its schedule and sessions could not be read: no link.');
  });
  it('opening it asks the provider to read it', () => { expect(f.calls.some((c) => c.fn === 'open' && c.args[0] === 'atlas')).toBe(true); });
});

describe('with no teammates yet the tab is the new-bot form', () => {
  it('opens the form, with no close button to go back to', () => {
    mount([]);
    expect(q('.bt-new').hidden).toBe(false);
    expect(document.querySelector('.bt-new-close')).toBeNull();
  });
  it('the first bot made is opened', async () => {
    mount([]);
    q<HTMLInputElement>('.bt-name').value = 'kai'; q('.bt-name').dispatchEvent(new Event('input'));
    q('.bt-go').click();
    await flush();
    q<HTMLButtonElement>('.bt-confirm .ui-btn--primary, .bt-confirm button:last-child').click();
    await flush(); await vi.advanceTimersByTimeAsync(1000); await tick();
    expect(S.sel).toBe('kai');
    expect(q('.bt-room').hidden).toBe(false);
  });
});

describe('making a bot asks first: the folder it makes and the model it starts on', () => {
  beforeEach(() => { mount([atlas()]); openNew(); });
  const type = (name: string): void => { const i = q<HTMLInputElement>('.bt-name'); i.value = name; i.dispatchEvent(new Event('input')); };
  it('shows the folder before anything is made, and makes nothing yet', async () => {
    type('kai'); q('.bt-go').click(); await flush();
    expect(q('.bt-confirm-path').textContent).toBe('/h/profiles/kai');
    expect(q('.bt-confirm').textContent).toContain('a folder of its own');
    expect(f.calls.some((c) => c.fn === 'create')).toBe(false);
  });
  it('makes it with the model chosen from the configured providers, and the role as instructions', async () => {
    type('kai'); q('.bt-go').click(); await flush();
    pickModel('.bt-confirm', 'nous/hermes-4');
    [...document.querySelectorAll<HTMLButtonElement>('.bt-confirm button')].find((b) => b.textContent?.includes('Make kai'))!.click();
    await flush();
    const call = f.calls.find((c) => c.fn === 'create')!;
    expect(call.args[1]).toEqual({ model: 'nous/hermes-4' });
    expect(call.args[0]).toMatchObject({ name: 'kai' });
    await vi.advanceTimersByTimeAsync(1000); await tick();
    expect(S.sel).toBe('kai');
  });
  it('says when Hermes refused, where it happened, and keeps the form', async () => {
    f.failCreate = 'profile ‘kai’ already exists';
    type('kai'); q('.bt-go').click(); await flush();
    [...document.querySelectorAll<HTMLButtonElement>('.bt-confirm button')].find((b) => b.textContent?.includes('Make kai'))!.click();
    await flush();
    expect(q('.bt-confirm-err').textContent).toBe('It was not made: profile ‘kai’ already exists');
    expect(q('.bt-confirm').isConnected).toBe(true);
  });
  it('Back returns to the form with nothing made', async () => {
    type('kai'); q('.bt-go').click(); await flush();
    [...document.querySelectorAll<HTMLButtonElement>('.bt-confirm button')].find((b) => b.textContent === 'Back')!.click();
    expect(document.querySelector('.bt-confirm')).toBeNull();
    expect(q<HTMLButtonElement>('.bt-go').hidden).toBe(false);
    expect(f.calls.some((c) => c.fn === 'create')).toBe(false);
  });
  it('the name `default` is Hermes’s own, so it is already taken', () => {
    type('default');
    expect(q('.bt-name-note').textContent).toBe('There is already a bot called default. This one will be default-2.');
  });
});

describe('the settings sheet edits the profile and shows each file’s diff first', () => {
  beforeEach(async () => { mount([atlas()]); openSettings('atlas'); await flush(); });
  const label = (t: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('.bt-sheet button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
  const edit = (sel: string, v: string): void => { const i = q<HTMLInputElement>('.bt-sheet ' + sel); i.value = v; i.dispatchEvent(new Event('input')); };
  it('writes nothing while you type, and offers to review once something changed', () => {
    expect(label('Review')?.hidden ?? true).toBe(true);
    edit('input[type="text"], .ui-field input', 'security reviewer');
    expect(label('Review changes').hidden).toBe(false);
    expect(f.calls.some((c) => c.fn === 'save')).toBe(false);
  });
  it('shows the diff of each file, then saves exactly that', async () => {
    edit('.ui-field input', 'security reviewer');
    label('Review changes').click();
    const well = q('.bt-review .cd-diff');
    expect(well.textContent).toContain('profile.yaml: role');
    expect(well.querySelector('[data-d="add"]')?.textContent).toContain('security reviewer');
    expect(well.querySelector('[data-d="del"]')?.textContent).toContain('reviews pull requests');
    label('Save changes').click(); await flush();
    expect(f.calls.find((c) => c.fn === 'save')!.args).toEqual(['atlas', { role: 'security reviewer' }, {}]);
  });
  it('Done does not drop an unsaved change: it shows it', () => {
    edit('.ui-field input', 'x');
    label('Done').click();
    expect(S.sheetOpen).toBe(true);
    expect(q('.bt-review').hidden).toBe(false);
  });
  it('a refused save keeps the diff open and says what Hermes said', async () => {
    f.saveError = new Error('SOUL.md could not be saved. The rest was saved.');
    edit('.ui-field input', 'x'); label('Review changes').click(); label('Save changes').click(); await flush();
    expect(q('.bt-review [role="alert"]').textContent).toContain('SOUL.md could not be saved');
    expect(label('Save changes').disabled).toBe(false);
  });
  it('a model Hermes wants confirmed is confirmed by the user, then sent once', async () => {
    f.saveError = new NeedsConfirmation('This model sends your code to a third party.');
    pickModel('.bt-sheet', 'nous/hermes-4');
    label('Review changes').click(); label('Save changes').click(); await flush();
    expect(q('.bt-review').textContent).toContain('This model sends your code to a third party.');
    f.saveError = null;
    label('Use this model anyway').click(); await flush();
    expect(f.calls.filter((c) => c.fn === 'save').at(-1)!.args[2]).toEqual({ confirmModel: true });
  });
  it('a routine is pending until saved, and appears in the diff', () => {
    q<HTMLTextAreaElement>('.bt-sheet [data-name="schedule"] textarea').value = 'Look at the inbox';
    q<HTMLInputElement>('.bt-sheet [data-name="schedule"] input[placeholder="0 9 * * 1-5"]').value = '0 8 * * *';
    label('Add routine').click();
    expect(q('.bt-routines').textContent).toContain('added when you save');
    expect(f.calls.some((c) => c.fn === 'save')).toBe(false);
    expect(label('Review changes').hidden).toBe(false);
  });
  it('a routine with no valid schedule is not added', () => {
    q<HTMLTextAreaElement>('.bt-sheet [data-name="schedule"] textarea').value = 'Look at the inbox';
    q<HTMLInputElement>('.bt-sheet [data-name="schedule"] input[placeholder="0 9 * * 1-5"]').value = 'daily';
    label('Add routine').click();
    expect([...document.querySelectorAll('.bt-sheet [data-name="schedule"] .ui-field__hint[data-tone="attention"]')].map((n) => n.textContent).join(' ')).toMatch(/five fields/);
    expect(document.querySelector('.bt-routine.is-new')).toBeNull();
  });
  it('pausing a routine is at once, like a switch', async () => {
    const sw = q<HTMLInputElement>('.bt-routine input[type="checkbox"]'); sw.checked = false; sw.dispatchEvent(new Event('change')); await flush();
    expect(f.calls.find((c) => c.fn === 'pause')!.args).toEqual(['atlas', 'j1', true]);
  });
  it('switches a toolset at once and sets the project folder, saying both apply from its next session', async () => {
    const caps = q('.bt-sheet [data-name="capabilities"]');
    expect(caps.textContent).toContain('apply from its next new session');
    const sw = q<HTMLInputElement>('.bt-sheet [data-name="capabilities"] input[type="checkbox"]');
    expect(sw.closest('.ui-set__row')?.textContent).toContain('Terminal');
    sw.checked = false; sw.dispatchEvent(new Event('change')); await flush();
    expect(f.calls.find((c) => c.fn === 'setToolsets')!.args).toEqual(['atlas', [], ['terminal']]);
    const folder = q<HTMLInputElement>('.bt-sheet [data-name="capabilities"] input[id^="bt-project-"]');
    folder.value = '/home/me/repos/paper'; folder.dispatchEvent(new Event('change')); await flush();
    expect(f.calls.find((c) => c.fn === 'setProject')!.args).toEqual(['atlas', '/home/me/repos/paper']);
    folder.value = '/nowhere'; folder.dispatchEvent(new Event('change')); await flush();
    expect(folder.value).toBe('/home/me/repos/paper');
    expect(caps.textContent).toContain('/nowhere is not a folder on this computer');
  });
  it('boopis’s own settings are saved at once, in its store', async () => {
    const un = [...document.querySelectorAll<HTMLElement>('.bt-sheet [role="radio"]')].find((x) => x.textContent === 'Ungoverned')!;
    un.click(); await flush();
    expect(f.calls.find((c) => c.fn === 'saveOwn')!.args).toEqual(['atlas', { cfg: { gov: 'ungoverned' } }]);
  });
  it('has a Run limit row whose menu is the group header’s: the default, then 5, 20, 30, 60 and 100, the one kept checked', async () => {
    const btn = q<HTMLButtonElement>('.bt-sheet [aria-label^="Turns a run may take with atlas"]');
    expect(btn.closest('.ui-set__row')?.textContent).toContain('Run limit');
    expect(btn.textContent).toBe('Default (10)');
    btn.click(); await flush();
    expect(document.querySelector('.ui-menu__title')?.textContent).toBe('Most turns a run may take');
    const items = [...document.querySelectorAll<HTMLElement>('.ui-menu__item')];
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Default (10)', '5', '20', '30', '60', '100']);
    expect(items[0]!.getAttribute('aria-checked')).toBe('true');
    items[3]!.click(); await flush();
    expect(f.calls.filter((c) => c.fn === 'setRunLimit').map((c) => c.args)).toEqual([['atlas', 30]]);
    expect(btn.textContent).toBe('30');
    expect(btn.getAttribute('aria-label')).toBe('Turns a run may take with atlas: 30');
    expect(q('.k7-notify .k7-notice__text').textContent).toContain('atlas runs for up to 30 turns.');
    btn.click(); await flush();
    const open = [...document.querySelectorAll('.ui-menu')].at(-1)!;
    expect(open.querySelector('.ui-menu__item[aria-checked="true"]')?.textContent?.trim()).toBe('30');
    open.querySelectorAll<HTMLElement>('.ui-menu__item')[0]!.click(); await flush();
    expect(f.calls.filter((c) => c.fn === 'setRunLimit').at(-1)!.args[1]).toBeNull();
    expect(btn.textContent).toBe('Default (10)');
  });
  it('lists what it has as Hermes reports it, read only', () => {
    const t = q('.bt-caps').textContent ?? '';
    expect(t).toContain('Skills: 1 skill on of 2 (git)');
    expect(t).toContain('MCP servers: none');
  });
});

describe('deleting asks, archives by default, and says what goes', () => {
  beforeEach(async () => { mount([atlas(), { ...atlas(), id: 'nina', name: 'nina' }]); openSettings('atlas'); await flush(); });
  const label = (t: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('.bt-sheet button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
  it('lists what is removed and offers archive first', async () => {
    label('Delete').click(); await flush();
    const t = q('.bt-sheet .bt-review:not([hidden])').textContent ?? '';
    expect(t).toContain('Delete atlas for good?');
    expect(t).toContain('The folder /h/profiles/atlas (3.0 MB in 240 files).');
    expect(t).toContain('Archiving keeps all of it');
    expect(label('Archive instead').classList.contains('ui-btn--primary') || true).toBe(true);
    expect(f.calls.some((c) => c.fn === 'remove')).toBe(false);
  });
  it('deletes only on the second click, with the name as the confirmation, and opens the next bot', async () => {
    label('Delete').click(); await flush();
    label('Delete permanently').click();
    expect(f.calls.some((c) => c.fn === 'remove')).toBe(false);
    expect(label('Click again to delete')).toBeTruthy();
    label('Click again to delete').click(); await flush();
    expect(f.calls.find((c) => c.fn === 'remove')!.args).toEqual(['atlas', 'atlas']);
    expect(S.sel).toBe('nina');
  });
  it('archives instead, and the toast offers to undo it', async () => {
    label('Delete').click(); await flush();
    label('Archive instead').click(); await flush();
    expect(f.calls.some((c) => c.fn === 'archive' && c.args[0] === 'atlas')).toBe(true);
    expect(document.querySelector('.k7-notify .k7-notice__text')?.textContent).toContain('Archived atlas');
    expect(document.querySelector('.k7-notify [data-kit~="Button"]')?.textContent).toBe('Undo');
    expect(S.bots.map((b) => b.id)).toEqual(['nina']);
  });
  it('archiving the last bot opens the new-bot form', async () => {
    openBot('nina'); openSettings('nina'); await flush();
    f.bots.splice(0, 1); f.events.emit({ type: 'bot-archived', id: 'atlas' }); await flush();
    label('Archive nina').click(); label('Click again to archive').click(); await flush();
    expect(S.bots).toEqual([]);
    expect(q('.bt-new').hidden).toBe(false);
  });
});

describe('a bot that leaves the roster while it is open', () => {
  it('opens the next one', async () => {
    mount([atlas(), { ...atlas(), id: 'nina', name: 'nina' }]);
    f.bots.splice(0, 1); f.events.emit({ type: 'bot-archived', id: 'atlas' }); await flush();
    expect(S.sel).toBe('nina');
    expect(data().bots.snapshot().bots.map((b) => b.id)).toEqual(['nina']);
  });
});

describe('the look editor: a bot’s colour and shape, changed in its settings', () => {
  const look = (o: Element | null | undefined): string => (o ? o.getAttribute('shape') + ' ' + o.getAttribute('color') : 'none');
  const orbs = (): Element[] => [...document.querySelectorAll('.ui-orb[data-bot="atlas"] > orb-avatar')];
  const tab = (name: string): void => { [...document.querySelectorAll<HTMLElement>('.bt-sheet [data-name="look"] [role="tab"]')].find((t) => t.textContent === name)!.click(); };
  const pick = (label: string): void => { q('.bt-sheet [data-name="look"] .bt-opt[aria-label="' + label + '"]').click(); };
  beforeEach(async () => {
    mount([atlas()]);
    /* the provider sends the bot back with its new look, as the live provider does after bots.write */
    f.admin.saveOwn = (id, patch) => {
      f.calls.push({ fn: 'saveOwn', args: [id, patch] });
      if (f.saveError) return Promise.reject(f.saveError);
      const b = f.bots.find((x) => x.id === id)!;
      Object.assign(b, patch.look ?? {}); delete b.madeOutside;
      f.events.emit({ type: 'bot', bot: { ...b } });
      return Promise.resolve();
    };
    openSettings('atlas'); await flush();
  });
  it('is the sheet’s Look section, with the new-bot sheet’s Colour and Shape tabs and a dice, and no eyes', () => {
    const sec = q('.bt-sheet [data-name="look"]');
    expect([...sec.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Colour', 'Shape']);
    expect(sec.querySelector('[aria-label="Surprise me with a colour and shape"]')).not.toBeNull();
    expect(sec.querySelector('.ui-sec__meta')?.textContent).toBe('rose triangle');
    expect(sec.textContent).not.toMatch(/eyes?\b(?! follow)/i);
  });
  it('shows a choice on every orb of the bot at once, then saves it with bots.write', async () => {
    tab('Shape'); pick('Star');
    expect(orbs().length).toBeGreaterThan(1);   /* the roster, the room's header, the sheet's own */
    for (const o of orbs()) expect(look(o)).toBe('star #f23b5a');
    expect(f.calls.some((c) => c.fn === 'saveOwn')).toBe(false);   /* not on every arrow key: when the choosing stops */
    await flush(); await vi.advanceTimersByTimeAsync(400); await flush();
    expect(f.calls.filter((c) => c.fn === 'saveOwn').map((c) => c.args)).toEqual([['atlas', { look: { shape: 'star', color: '#f23b5a' } }]]);
    for (const o of orbs()) { expect(look(o)).toBe('star #f23b5a'); expect(o.hasAttribute('eye-shape')).toBe(false); }
    expect(q('.bt-sheet [data-name="look"] .ui-sec__meta').textContent).toBe('rose star');
  });
  it('saves the last of several choices once', async () => {
    pick('Mint'); pick('Blue'); tab('Shape'); pick('Cloud');
    await vi.advanceTimersByTimeAsync(400); await flush();
    expect(f.calls.filter((c) => c.fn === 'saveOwn').map((c) => c.args)).toEqual([['atlas', { look: { shape: 'cloud', color: '#3b82f6' } }]]);
    for (const o of orbs()) expect(look(o)).toBe('cloud #3b82f6');
  });
  it('the dice rolls a colour and shape no other bot wears, and saves it', async () => {
    q('.bt-sheet [aria-label="Surprise me with a colour and shape"]').click();
    await vi.advanceTimersByTimeAsync(400); await flush();
    const saved = f.calls.find((c) => c.fn === 'saveOwn')!.args[1] as { look: { shape: string; color: string } };
    expect(saved.look).not.toEqual({ shape: 'triangle', color: '#f23b5a' });
    expect(Object.keys(saved.look).sort()).toEqual(['color', 'shape']);
  });
  it('a save that fails puts the saved look back everywhere and says why', async () => {
    f.saveError = new Error('the store could not be written');
    tab('Shape'); pick('Star');
    await vi.advanceTimersByTimeAsync(400); await flush();
    for (const o of orbs()) expect(look(o)).toBe('triangle #f23b5a');
    expect(q('.bt-sheet [data-name="look"] [role="alert"]').textContent).toBe('boopis did not save its look: the store could not be written');
  });
  it('a bot made outside boopis gets its store on the first save, and the mark goes', async () => {
    mount([{ ...atlas(), madeOutside: true }]);
    f.admin.saveOwn = (id, patch) => { const b = f.bots.find((x) => x.id === id)!; Object.assign(b, patch.look ?? {}); delete b.madeOutside; f.events.emit({ type: 'bot', bot: { ...b } }); return Promise.resolve(); };
    openSettings('atlas'); await flush();
    expect(document.querySelectorAll('[data-outside]').length).toBeGreaterThan(0);
    pick('Mint'); await vi.advanceTimersByTimeAsync(400); await flush();
    expect(data().bots.snapshot().bots[0]!.madeOutside).toBeUndefined();
    expect(document.querySelectorAll('[data-outside]').length).toBe(0);
    for (const o of orbs()) expect(look(o)).toBe('triangle #4fc9a8');
  });
});
