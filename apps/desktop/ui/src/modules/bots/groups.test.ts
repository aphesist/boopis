// @vitest-environment jsdom
/* Team chat in the Bots tab, and a live bot's composer, over the provider interface: the tests say what the user sees and what
   is asked of the provider, never how the engine answers (that is `host/live/groups.test.ts` and `bots.test.ts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import type { Bot, BotInfo, BotsEvent, DataProvider, GroupsSource } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { emitter } from '../../data/store';
import '../cards';
import { S } from './model';
import { registered } from '../../core/registry';
import './index';

const q = <T extends HTMLElement>(sel: string): T => { const n = document.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };
const tick = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(20); await tick(); };

let provider: DataProvider;
const calls: { fn: string; args: unknown[] }[] = [];
function spyGroups(g: GroupsSource): GroupsSource {
  const rec = <A extends unknown[], R>(fn: string, f: (...a: A) => R) => (...args: A): R => { calls.push({ fn, args }); return f(...args); };
  return { ...g, send: rec('send', g.send), stop: rec('stop', g.stop), create: rec('create', g.create), rename: rec('rename', g.rename), setMembers: rec('setMembers', g.setMembers), archive: rec('archive', g.archive), restore: rec('restore', g.restore), open: rec('open', g.open), setRoundLimit: rec('setRoundLimit', g.setRoundLimit) };
}
function mount(p: DataProvider): void {
  provider = p; setProvider(p);
  S.bots = []; S.rows.clear(); S.groupRows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null; S.groupSel = null; S.groups = []; S.groupThreads = {}; S.sheetOpen = false; S.sheetFor = null;
  document.body.replaceChildren();
  const list = document.createElement('div'), root = document.createElement('div');
  document.body.append(list, root);
  Element.prototype.scrollIntoView = (): void => undefined;
  (Element.prototype as unknown as { animate: () => void }).animate = (): void => undefined;
  Element.prototype.scrollTo = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
}
const withGroups = (): DataProvider => { const m = createMockProvider({ simulate: false, fixtures: ['groups'] }); return { ...m, groups: spyGroups(m.groups) }; };

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('groups in the list', () => {
  it('lists each group with its members, and a New group row after them', () => {
    mount(withGroups());
    const rows = [...document.querySelectorAll('.bt-groups .ui-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('release crew');
    expect(rows[0]!.getAttribute('aria-label')).toMatch(/^release crew, /);
    expect(rows[1]!.textContent).toContain('New group');
  });
  it('shows only New group when there are no groups', () => {
    mount({ ...createMockProvider({ simulate: false }) });
    expect(document.querySelectorAll('.bt-groups .ui-row')).toHaveLength(1);
  });
});

describe('a group’s thread', () => {
  beforeEach(() => { mount(withGroups()); q('.bt-groups .ui-row').click(); });
  it('opens in the room, reads its messages, and names the members under its name', async () => {
    await flush();
    expect(calls.some((c) => c.fn === 'open')).toBe(true);
    expect(q('.bt-group .bt-p-name').textContent).toBe('release crew');
    expect(q('.bt-group').hidden).toBe(false);
    expect(q<HTMLElement>('.bt-room:not(.bt-group)').hidden).toBe(true);
  });
  it('shows each message by the one who wrote it, and the user’s own as “You”', () => {
    const entries = [...document.querySelectorAll<HTMLElement>('.bt-group [data-hx-turn]')];
    expect(entries.length).toBe(4);
    expect(entries[0]!.getAttribute('aria-label') ?? entries[0]!.textContent).toMatch(/You/);
    expect(entries.slice(1).map((e) => e.querySelector('.bt-who-name')?.textContent)).toEqual(['atlas', 'nina', 'kai'].map((n) => provider.bots.snapshot().bots.find((b) => b.id === n)!.name));
  });
  it('draws the members as stacked orbs in the header', () => {
    expect(document.querySelector('.bt-group .bt-ghead .cd-stack')).not.toBeNull();
  });
  it('sends what is written to the group, and each member can be addressed with a chip', async () => {
    const chip = [...document.querySelectorAll<HTMLElement>('.bt-group .ui-chip')][1]!;
    expect(chip.textContent).toMatch(/^@/);
    const inserted: string[] = [];
    (document as unknown as { execCommand: (c: string, u: boolean, t: string) => boolean }).execCommand = (_c, _u, t) => { inserted.push(t); return true; };
    chip.click();
    expect(inserted.join('')).toBe((chip.textContent ?? '') + ' ');
    q('.bt-group .ui-composer').dispatchEvent(new CustomEvent('ui:send', { detail: { text: '@nina what is left?' } }));
    expect(calls.find((c) => c.fn === 'send')!.args).toEqual(['room-release', '@nina what is left?']);
  });
  it('shows who is replying, and says so to the screen reader', async () => {
    const g = provider.groups;
    const first = g.snapshot().groups[0]!;
    (provider.groups as unknown as { _ev?: unknown })._ev = undefined;
    // the provider says two members are working
    const ev = emitter<never>(); void ev;
    S.groups[0]!.working = [first.members[0]!.id, first.members[1]!.id];
    const { onGroupsEvent } = await import('./group-room');
    onGroupsEvent({ type: 'group', group: { ...first, working: [first.members[0]!.id, first.members[1]!.id] } });
    expect(q('.bt-working').textContent).toMatch(/are replying/);
    expect(q('.bt-working').getAttribute('aria-live')).toBe('polite');
  });
  it('renames in place with Enter, and Esc leaves it as it was', async () => {
    q('.bt-ghead [aria-label^="Rename"]').click();
    const input = q<HTMLInputElement>('.bt-gname');
    input.value = 'launch crew';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(calls.find((c) => c.fn === 'rename')!.args).toEqual(['room-release', 'launch crew']);
    expect(q('.bt-group .bt-p-name').textContent).toBe('launch crew');
    expect(q('.bt-groups .ui-row').textContent).toContain('launch crew');
    q('.bt-ghead [aria-label^="Rename"]').click();
    q<HTMLInputElement>('.bt-gname').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q('.bt-group .bt-p-name').textContent).toBe('launch crew');
  });
  it('sets the most rounds a run may take from the header, and says what the default is', async () => {
    await flush();
    q('.bt-group [aria-label^="Rounds a run may take"]').click();
    await flush();
    const items = [...document.querySelectorAll<HTMLElement>('.ui-menu__item')];
    expect(document.querySelector('.ui-menu__title')?.textContent).toBe('Most rounds a run may take');
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Default (30)', '6', '12', '30', '60', '100']);
    expect(items[0]!.getAttribute('aria-checked')).toBe('true');
    items[2]!.click();
    await flush();
    expect(calls.filter((c) => c.fn === 'setRoundLimit').map((c) => c.args)).toEqual([[expect.any(String), 12]]);
    q('.bt-group [aria-label^="Rounds a run may take"]').click();
    await flush();
    expect(document.querySelector('.ui-menu__item[aria-checked="true"]')?.textContent?.trim()).toBe('12');
    document.querySelectorAll<HTMLElement>('.ui-menu__item')[0]!.click();
    await flush();
    expect(calls.filter((c) => c.fn === 'setRoundLimit').at(-1)!.args[1]).toBeNull();
  });
  it('archives it, drops it from the list and offers Undo', async () => {
    q('.bt-ghead [aria-label^="Archive"]').click();
    await flush();
    expect(calls.some((c) => c.fn === 'archive')).toBe(true);
    expect(document.querySelectorAll('.bt-groups .ui-row')).toHaveLength(1);
    expect(q('.bt-archived').textContent).toContain('release crew');
    expect(q('.ui-toast').textContent).toContain('Undo');
  });
});

describe('making a group', () => {
  beforeEach(() => { mount(withGroups()); q('[data-new-group]').click(); });
  it('opens the form with every bot to pick, and cannot be made with fewer than two', () => {
    expect(q('.bt-new:not([hidden]) .bt-name').getAttribute('aria-label')).toBe('Group name');
    expect(document.querySelectorAll('.bt-new:not([hidden]) .bt-member').length).toBe(provider.bots.snapshot().bots.length);
    expect(q<HTMLButtonElement>('.bt-new:not([hidden]) .bt-go').disabled).toBe(true);
    q('.bt-new:not([hidden]) .bt-member').click();
    expect(q<HTMLButtonElement>('.bt-new:not([hidden]) .bt-go').disabled).toBe(true);
  });
  it('stops at six members', () => {
    const members = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) .bt-member')];
    members.forEach((m) => m.click());
    expect(members.filter((m) => m.getAttribute('aria-checked') === 'true')).toHaveLength(Math.min(6, members.length));
  });
  it('makes the group with the picked bots and opens it', async () => {
    const members = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) .bt-member')];
    members[0]!.click(); members[1]!.click();
    const name = q<HTMLInputElement>('.bt-new:not([hidden]) .bt-name');
    name.value = 'night shift';
    q<HTMLButtonElement>('.bt-new:not([hidden]) .bt-go').click();
    await flush();
    expect(calls.find((c) => c.fn === 'create')!.args).toEqual([{ name: 'night shift', bots: [members[0]!.dataset['id'], members[1]!.dataset['id']] }]);
    expect(q('.bt-group .bt-p-name').textContent).toBe('night shift');
    expect(document.querySelectorAll('.bt-groups .ui-row')).toHaveLength(3);
  });
  it('says why when it is not made, and keeps the form', async () => {
    const m = createMockProvider({ simulate: false, fixtures: ['groups'] });
    mount({ ...m, groups: { ...m.groups, create: () => Promise.reject(new Error('The room worker is off.')) } });
    q('[data-new-group]').click();
    const members = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) .bt-member')];
    members[0]!.click(); members[1]!.click();
    q<HTMLButtonElement>('.bt-new:not([hidden]) .bt-go').click();
    await flush();
    expect(q('.bt-new:not([hidden]) .bt-confirm-err').textContent).toContain('The room worker is off.');
  });
  it('changing members says it makes a new group and archives this one, then asks for it', async () => {
    q('.bt-groups .ui-row').click();
    q('.bt-ghead [aria-label^="Change the members"]').click();
    expect(q('.bt-new:not([hidden])').textContent).toMatch(/archives this one/);
    const picked = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) .bt-member')].filter((m) => m.getAttribute('aria-checked') === 'true');
    expect(picked).toHaveLength(3);
    picked[2]!.click();
    q<HTMLButtonElement>('.bt-new:not([hidden]) .bt-go').click();
    await flush();
    expect(calls.find((c) => c.fn === 'setMembers')!.args[0]).toBe('room-release');
    expect((calls.find((c) => c.fn === 'setMembers')!.args[1] as string[]).length).toBe(2);
  });
  it('is not offered where group chat cannot run, and says why', () => {
    const m = createMockProvider({ simulate: false });
    mount({ ...m, groups: { ...m.groups, note: () => 'Group chat is not running in the engine. Restart boopis and try again.' } });
    q('[data-new-group]').click();
    expect(q<HTMLButtonElement>('.bt-new:not([hidden]) .bt-go').disabled).toBe(true);
    expect(q('.bt-new:not([hidden])').textContent).toContain('not running');
  });
});

/* a live bot: it has `info`, a composer, and its recent sessions open as the thread */
const INFO: BotInfo = { profile: 'atlas', path: '/h/p/atlas', model: 'main/a', provider: 'main', skills: [], toolsets: [], mcpServers: [], jobs: [], sessions: [{ id: 's1', title: 'review billing', when: '5m', messages: 4, source: 'gui' }], soul: '', running: false, notes: {} };
function liveBot(p: DataProvider): { provider: DataProvider; events: ReturnType<typeof emitter<BotsEvent>>; sent: unknown[][]; opened: string[]; fresh: string[] } {
  const events = emitter<BotsEvent>();
  const sent: unknown[][] = [], opened: string[] = [], fresh: string[] = [];
  const base = p.bots.snapshot();
  const bots: Bot[] = base.bots.map((b) => ({ ...b, info: { ...INFO, profile: b.id }, attention: null }));
  const source = { ...p.bots, snapshot: () => ({ bots, threads: Object.fromEntries(bots.map((b) => [b.id, []])) }), subscribe: (fn: (e: BotsEvent) => void) => events.subscribe(fn), send: (...a: unknown[]) => { sent.push(a); }, admin: undefined,
    sessions: { open: (_b: string, s: string) => { opened.push(s); return Promise.resolve(); }, fresh: (b: string) => { fresh.push(b); }, current: () => null } } as unknown as DataProvider['bots'];
  return { provider: { ...p, info: { ...p.info, live: true }, bots: source }, events, sent, opened, fresh };
}
describe('a live bot’s room has a live composer', () => {
  it('shows the composer, sends to the bot, and lists the sessions as buttons that open them', async () => {
    const l = liveBot(createMockProvider({ simulate: false }));
    mount(l.provider);
    const id = S.sel as string;
    expect(q('.bt-composer-zone').hidden).toBe(false);
    expect(q('.bt-glance').textContent).not.toContain('team chat');
    q('.bt-composer').dispatchEvent(new CustomEvent('ui:send', { detail: { text: 'hello' } }));
    expect(l.sent).toEqual([[id, 'hello', 'bots']]);
    q('.bt-glance-open').click();
    expect(l.opened).toEqual(['s1']);
  });
  it('draws a thread the provider swaps in, the reply as the bot’s, and a note as a quiet line', async () => {
    const l = liveBot(createMockProvider({ simulate: false }));
    mount(l.provider);
    const id = S.sel as string;
    l.events.emit({ type: 'thread', botId: id, messages: [{ kind: 'text', id: 'a', who: 'you', t: '10:00', text: 'review billing' }, { kind: 'text', id: 'b', who: id, t: '10:01', text: 'Looks fine.' }, { kind: 'note', id: 'c', who: 'app', t: '10:02', text: 'The message was not sent: it is offline.' }] });
    expect(document.querySelectorAll('.bt-log [data-hx-turn]')).toHaveLength(2);
    expect(q('.bt-note').textContent).toContain('not sent');
    expect(q('.bt-log').textContent).toContain('Looks fine.');
    expect(q('.bt-ghead, .bt-presence [data-action="new-session"]')).toBeTruthy();
    q('[data-action="new-session"]').click();
    expect(l.fresh).toEqual([id]);
  });
});
