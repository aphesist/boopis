/* Settings on the kit (step 7a), driven as a person drives it: the dialog's nav (S39's order, Diagnostics last, a page shown only where
   its feature is), General's rows writing where today's did, Sessions' two scopes, Approvals' rules list against a scripted host (every
   action: switch, edit, add, remove and Undo, a draft finished or discarded, an outside change kept or discarded, Restore defaults behind
   its confirm, the reviewer), Voice and speech (a key goes to the keychain and leaves the page), Appearance, Keyboard and Diagnostics. */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { on } from '../../core/bus';
import { prefs, setState, state } from '../../core/state';
import { loadChrome, loadLineHidden, loadLook } from '../../core/settings';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import type { DataProvider, ProjectPolicy } from '../../data';
import { store } from '../../data/store';
import { themeApi } from '../../styles/theme';
import { DEFAULT_RULES, DRAFT as KAI_DRAFT, EXCEPTION, MODEL, fakeDiagnostics, fakeRules, fakeSpeech, withSettings } from '../../lab/settings-fixtures';
import type { FakeRules, FakeSpeech } from '../../lab/settings-fixtures';
import { currentPage, mountSettings, openSettings, PAGES, resetSettings } from './index';
import { resetSettingsHost, setSettingsHost } from './host';
import { catches } from './approvals';
import { modelWords } from './voice';
import { VOICE_LATER, voiceNeedsSetup, voiceSetUp, voiceTool } from '../chat/compose';

const tick = (n = 3): Promise<void> => new Promise((r) => { let i = 0; const go = (): void => { if (++i >= n) r(); else setTimeout(go, 0); }; setTimeout(go, 0); });
let dlg: HTMLDialogElement, rules: FakeRules, speech: FakeSpeech;
const q = <T extends HTMLElement = HTMLElement>(s: string): T => { const n = dlg.querySelector<T>(s); if (!n) throw new Error('missing ' + s); return n; };
const page = (): HTMLElement => q('.k7-dialog__page > :not([hidden])');
const nav = (): string[] => [...dlg.querySelectorAll('.k7-dialog__navrow')].map((n) => n.textContent ?? '');
const menuPick = (label: string): void => {
  const r = [...document.querySelectorAll<HTMLElement>('.k7-menu [role^="menuitem"]')].find((x) => x.textContent?.includes(label));
  if (!r) throw new Error('no menu row ' + label);
  r.click();
};
const label = (r: Element): string => r.querySelector('.k7-row__label')?.firstChild?.textContent ?? '';
const rowOf = (text: string): HTMLElement => { const r = [...page().querySelectorAll<HTMLElement>('.k7-row')].find((x) => label(x) === text); if (!r) throw new Error('no row ' + text); return r; };

function boot(o: { rules?: FakeRules | null; speech?: FakeSpeech | null; patch?: (p: DataProvider) => DataProvider; desktop?: boolean } = {}): void {
  localStorage.clear();
  resetSettings(); resetSettingsHost();
  rules = o.rules ?? fakeRules(); speech = o.speech ?? fakeSpeech();
  let p = createMockProvider({ simulate: false }) as DataProvider;
  if (o.patch) p = o.patch(p);
  setProvider(withSettings(p, { rules: o.rules === null ? null : rules, speech: o.speech === null ? null : speech }));
  if (o.desktop) setSettingsHost({ diagnostics: fakeDiagnostics });
  document.body.innerHTML = '<div id="hx-app"><dialog class="hx-dialog hx-settings" id="hx-settings"></dialog></div>';
  dlg = document.getElementById('hx-settings') as HTMLDialogElement;
  mountSettings(dlg);
}

beforeEach(() => { boot(); });

describe('the dialog', () => {
  it('is the kit\'s large Dialog: S39\'s nav with icons, Diagnostics last where it exists, and a page with its title', async () => {
    boot({ desktop: true });
    openSettings();
    await tick();
    expect(dlg.hasAttribute('open')).toBe(true);
    expect(q('[data-kit~="Dialog"]').getAttribute('data-variant')).toBe('large');
    expect(nav()).toEqual(['General', 'Sessions', 'Bots', 'Models', 'Approvals', 'Connectors', 'Appearance', 'Keyboard', 'Diagnostics']);
    expect(dlg.querySelectorAll('.k7-dialog__navrow svg, .k7-dialog__navrow .k7-ic').length).toBeGreaterThanOrEqual(9);
    expect(page().querySelector('.k7-page__title')?.textContent).toBe('General');
    expect(PAGES.map((x) => x.id)).toEqual(['general', 'sessions', 'bots', 'models', 'approvals', 'connectors', 'appearance', 'keys', 'diagnostics']);
  });
  it('hides a page whose feature is absent: Approvals without the rules engine, Diagnostics outside the desktop app', async () => {
    boot({ rules: null });
    openSettings('approvals');
    await tick();
    expect(nav()).not.toContain('Approvals');
    expect(nav()).not.toContain('Diagnostics');
    expect(currentPage(), 'an absent page opens General').toBe('general');
  });
  it('moves through the nav with up and down, and a press opens the page', async () => {
    openSettings();
    await tick();
    const rows = [...dlg.querySelectorAll<HTMLElement>('.k7-dialog__navrow')];
    rows[0]?.focus();
    rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(currentPage()).toBe('sessions');
    expect(rows[1]?.getAttribute('aria-current')).toBe('page');
    q<HTMLElement>('[data-page="keys"]').click();
    expect(page().querySelector('.k7-page__title')?.textContent).toBe('Keyboard');
    q<HTMLButtonElement>('[data-dialog-close]').click();
    expect(dlg.hasAttribute('open')).toBe(false);
  });
  it('steps aside on Appearance (no scrim), and back on any other page', async () => {
    openSettings('appearance');
    await tick();
    expect(dlg.hasAttribute('data-side')).toBe(true);
    openSettings('general');
    expect(dlg.hasAttribute('data-side')).toBe(false);
  });
});

describe('General', () => {
  it('writes the dock, the sidebar, the rail and search where the app reads them', async () => {
    setState({ dock: 'on' });
    openSettings('general');
    await tick();
    rowOf('Show the dock').querySelector<HTMLButtonElement>('[data-set="dock"]')?.click();
    expect(state.dock).toBe('off');
    rowOf('When the sidebar collapses').querySelector<HTMLElement>('[data-value="closed"]')?.click();
    expect(prefs.collapse).toBe('closed');
    const told: unknown[] = []; const off = on('hx:chrome', (d) => { told.push(d); });
    rowOf('Rail size').querySelector<HTMLElement>('[data-value="b"]')?.click();
    expect(loadChrome().rail).toBe('b');
    q<HTMLElement>('[data-select="search-as"]').click();
    menuPick('A pill');
    expect(loadChrome().searchAs).toBe('pill');
    rowOf('Show search').querySelector<HTMLButtonElement>('[data-set="search"]')?.click();
    expect(loadChrome().search).toBe(false);
    expect(page().querySelector('[data-select="search-as"]'), 'no "shows as" while search is off').toBeNull();
    expect(told.length).toBe(3);
    off();
  });
  it('Under the composer: each item is a check that the session composer\'s line follows', async () => {
    openSettings('general');
    await tick();
    const told: unknown[] = []; const off = on('hx:session-line', (d) => { told.push(d); });
    const branch = rowOf('Branch');
    expect(branch.getAttribute('role')).toBe('checkbox');
    expect(branch.getAttribute('aria-checked')).toBe('true');
    branch.click();
    expect(loadLineHidden()).toEqual(['branch']);
    expect(told).toHaveLength(1);
    rowOf('Branch').click();
    expect(loadLineHidden()).toEqual([]);
    off();
  });
  it('the dock\'s choices and the window controls keep working, and a change made elsewhere shows', async () => {
    openSettings('general');
    await tick();
    rowOf('Compact dock when idle').querySelector<HTMLButtonElement>('[data-set="dock-compact"]')?.click();
    expect(state.dockCompact).toBe(true);
    setState({ dockCompact: false });
    expect(rowOf('Compact dock when idle').querySelector('[data-set="dock-compact"]')?.getAttribute('aria-checked')).toBe('false');
    expect(rowOf('Window controls').querySelector('[data-kit~="Segmented"]')).not.toBeNull();
  });
});

describe('Sessions', () => {
  const policy: ProjectPolicy = { project: '/home/you/code/billing-api', governed: false, explicit: null, effective: false };
  const withProject = (calls: unknown[]) => (p: DataProvider): DataProvider => ({
    ...p,
    sessionControls: { launch: store({ folder: null, careful: 'auto_edits', effort: null, fellBack: false }) } as never,
    details: { ...p.details, environment: store({ ...p.details.environment.get(), cwd: '/home/you/code/billing-api' }) },
    store: { ...p.store, projectPolicy: () => Promise.resolve(policy), setProjectPolicy: (project: string, want: boolean) => { calls.push([project, want]); return Promise.resolve({ ...policy, explicit: want, effective: want }); } }
  });
  it('This device: How careful sets the step new sessions start with', async () => {
    boot({ patch: withProject([]) });
    openSettings('sessions');
    await tick();
    expect(page().querySelector('[data-scope]')).not.toBeNull();
    q<HTMLElement>('[data-select="careful"]').click();
    menuPick('Supervised');
    expect(JSON.parse(localStorage.getItem('hx.v7.sessionLaunch') ?? '{}').careful).toBe('supervised');
    expect(q('[data-select="careful"]').textContent).toContain('Supervised');
  });
  it('This project: the project\'s own switch, written where the store writes it', async () => {
    const calls: unknown[] = [];
    boot({ patch: withProject(calls) });
    openSettings('sessions');
    await tick();
    q<HTMLElement>('[data-scope] [data-value="project"]').click();
    await tick();
    const sw = q<HTMLButtonElement>('[data-set="policy"]');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    await tick();
    expect(calls).toEqual([['/home/you/code/billing-api', true]]);
    expect(q('[data-set="policy"]').getAttribute('aria-checked')).toBe('true');
  });
  it('with no project open there is no scope: the page is this device\'s', async () => {
    boot({ patch: (p) => ({ ...p, details: { ...p.details, environment: store({ ...p.details.environment.get(), cwd: '' }) } }) });
    openSettings('sessions');
    await tick();
    expect(page().querySelector('[data-scope]')).toBeNull();
  });
});

describe('Approvals', () => {
  const open = async (r: FakeRules = fakeRules(), focus?: string, patch?: (p: DataProvider) => DataProvider): Promise<void> => { boot({ rules: r, ...(patch ? { patch } : {}) }); openSettings('approvals', focus ? { focus } : {}); await tick(6); };
  it('lists the rules, each led by its switch, its words and where it came from; how many are on', async () => {
    await open();
    const rows = [...page().querySelectorAll('[data-rule]')];
    expect(rows).toHaveLength(8);
    expect(rows[0]?.querySelector('.k7-row > [data-kit~="Switch"]')).not.toBeNull();
    expect(rows[0]?.textContent).toContain('default');
    expect(page().querySelector('.k7-shead__count')?.textContent).toBe('8 on');
    expect(page().textContent).toContain('Anything not on the list runs on its own.');
  });
  it('a switch turns a rule off against the revision read, and the last change is a line with Undo', async () => {
    await open(rules);
    q<HTMLButtonElement>('[data-rule-switch="default.purchases"]').click();
    await tick(6);
    expect(rules.calls).toContain('enabled:default.purchases:false');
    const line = q('[data-last]');
    expect(line.textContent).toContain('Turned off');
    line.querySelector<HTMLButtonElement>('[data-line]')?.click();
    await tick(6);
    expect(rules.calls).toContain('enabled:default.purchases:true');
    expect(page().querySelector('[data-last]')).toBeNull();
  });
  it('Edit opens the rule on its words with what it catches; Save writes the new words with the reviewer\'s reading', async () => {
    await open(rules);
    q<HTMLButtonElement>('[data-rule-edit="default.messages"]').click();
    const ed = q('[data-rule-editor="default.messages"]');
    expect(ed.textContent).toContain('Checked when a bot is sending messages');
    const input = ed.querySelector<HTMLInputElement>('[data-rule-input]') as HTMLInputElement;
    input.value = 'Ask before emailing anyone outside the team.';
    ed.querySelector<HTMLButtonElement>('[data-rule-save]')?.click();
    await tick(8);
    expect(rules.calls).toContain('kinds:Ask before emailing anyone outside the team.');
    expect(rules.calls).toContain('put:default.messages:Ask before emailing anyone outside the team.');
    expect(page().querySelector('[data-rule-editor]')).toBeNull();
  });
  it('Remove takes a rule out and Undo puts it back through the host\'s token', async () => {
    await open(rules);
    q<HTMLButtonElement>('[data-rule-remove="default.secrets"]').click();
    await tick(6);
    expect(page().querySelector('[data-rule="default.secrets"]')).toBeNull();
    q<HTMLButtonElement>('[data-last] [data-line]').click();
    await tick(6);
    expect(rules.calls.some((c) => c.startsWith('undo:tok'))).toBe(true);
    expect(page().querySelector('[data-rule="default.secrets"]')).not.toBeNull();
  });
  it('Add a rule: an empty one, saved as yours', async () => {
    await open(rules);
    q<HTMLButtonElement>('[data-rule-add]').click();
    const input = q<HTMLInputElement>('[data-rule-editor="new"] [data-rule-input]');
    input.value = 'Ask before deleting a calendar event.';
    q<HTMLButtonElement>('[data-rule-save="new"]').click();
    await tick(8);
    expect(rules.calls).toContain('put:new:Ask before deleting a calendar event.');
    expect([...page().querySelectorAll('[data-rule]')].some((r) => r.textContent?.includes('calendar'))).toBe(true);
  });
  it('a draft from "Always allow" for every bot heads the page (opened at it): Save rule makes it active, Discard removes it', async () => {
    const DRAFT = { ...KAI_DRAFT, bots: null };
    const r = fakeRules({ rules: [...DEFAULT_RULES, DRAFT] });
    await open(r, 'drafts');
    const d = q('[data-draft="x_draft1"]');
    expect(page().querySelector('[data-part="drafts"]')).not.toBeNull();
    expect(d.textContent).toContain('Lets through');
    expect(d.querySelector<HTMLInputElement>('[data-draft-input]')?.value).toBe(DRAFT.text);
    d.querySelector<HTMLInputElement>('[data-draft-input]')!.value = 'kai may force-push feature/* of ~/repos/site.';
    d.querySelector<HTMLButtonElement>('[data-draft-save]')?.click();
    await tick(8);
    expect(r.calls).toContain('put:x_draft1:kai may force-push feature/* of ~/repos/site.');
    expect(page().querySelector('[data-draft]')).toBeNull();
    expect(page().querySelector('[data-part="allowed"]')?.textContent).toContain('feature/*');
    const r2 = fakeRules({ rules: [...DEFAULT_RULES, { ...DRAFT }] });
    await open(r2);
    q<HTMLButtonElement>('[data-draft-discard="x_draft1"]').click();
    await tick(6);
    expect(r2.calls).toContain('remove:x_draft1');
  });
  it('an outside change: a Notice with "Use the new rules" and "Keep mine", and it appears while the page is open', async () => {
    const r = fakeRules();
    await open(r);
    expect(page().querySelector('[data-outside]')).toBeNull();
    r.outside();
    await tick(6);
    expect(q('[data-outside]').textContent).toContain('changed outside boopis');
    q<HTMLButtonElement>('[data-outside] [data-value="discard"]').click();
    await tick(6);
    expect(r.calls).toContain('discard');
    expect(page().querySelector('[data-outside]')).toBeNull();
    r.outside(); await tick(6);
    q<HTMLButtonElement>('[data-outside] [data-value="accept"]').click();
    await tick(6);
    expect(r.calls).toContain('accept');
  });
  it('rules that cannot be read say so in the spec\'s words; an empty list says nothing asks', async () => {
    await open(fakeRules({ unreadable: true }));
    expect(page().textContent).toContain('Rules can’t be read, so every action asks.');
    await open(fakeRules({ rules: [] }));
    expect(page().textContent).toContain('No rules, so nothing asks.');
  });
  it('Restore defaults asks first; the reviewer is a select of Automatic and the ranked models', async () => {
    await open(rules);
    q<HTMLButtonElement>('[data-restore="ask"]').click();
    expect(rules.calls).not.toContain('restore');
    q<HTMLButtonElement>('[data-restore="yes"]').click();
    await tick(6);
    expect(rules.calls).toContain('restore');
    q<HTMLElement>('[data-select="reviewer"]').click();
    await tick(4);
    menuPick('claude-haiku-4');
    await tick(6);
    expect(rules.calls).toContain('reviewer:pinned:claude-haiku-4');
  });
  it('shows only the rules for every bot: a bot\'s own rules and drafts are in its sheet, and one line links each bot that has some', async () => {
    const r = fakeRules({ rules: [...DEFAULT_RULES, KAI_DRAFT, EXCEPTION] });
    await open(r);
    expect(page().querySelector('[data-draft]')).toBeNull();
    expect(page().textContent).not.toContain('kai may force-push');
    expect(page().textContent).not.toContain('nina may restart');
    expect(page().querySelector('[data-part="allowed"]')).toBeNull();
    expect(page().querySelector('[data-part="built-in"]')?.textContent).toContain('no bot can answer an approval for you');
    const line = q('[data-part="own"]');
    /* the mock: nina asks before deploying, nimbus may never message people; kai has a draft, nina an exception too */
    expect([...line.querySelectorAll('[data-own-bot]')].map((a) => a.textContent)).toEqual(['nina', 'kai', 'nimbus']);
    const seen: string[] = [];
    on('hx:bot-select', (d) => { seen.push('select ' + d.id); });
    on('hx:bot-settings', (d) => { seen.push('sheet ' + String(d.id) + ' ' + String(d.section)); });
    line.querySelector<HTMLButtonElement>('[data-own-bot="kai"]')?.click();
    await tick(4);
    expect(seen).toEqual(['select kai', 'sheet kai approvals']);
  });
  it('the line of bots with rules of their own is hidden when none has any', async () => {
    await open(fakeRules(), undefined, (p) => ({ ...p, bots: { ...p.bots, snapshot: () => { const s = p.bots.snapshot(); return { ...s, bots: s.bots.map((b) => ({ ...b, cfg: { ...b.cfg, approvals: { ...b.cfg.approvals, deploys: 'allow', people: 'allow' } } })) }; } } }));
    expect(page().querySelector('[data-part="own"]')).toBeNull();
  });
  it('says what a rule catches in words', () => {
    expect(catches(['messages', 'browser'])).toBe('Checked when a bot is sending messages or driving a browser.');
    expect(catches([])).toContain('has not read');
  });
});

describe('Bots', () => {
  type Admin = NonNullable<DataProvider['bots']['admin']>;
  const withAdmin = (calls: string[]) => (p: DataProvider): DataProvider => ({ ...p, bots: { ...p.bots, admin: {
    removal: async (id: string) => { calls.push('removal ' + id); return { folder: '/x/' + id, lines: ['Its folder, 2 MB in 40 files', 'Its look and settings'] }; },
    remove: async (id: string, confirm: string) => { calls.push('remove ' + id + ' ' + confirm); },
    archive: async (id: string) => { calls.push('archive ' + id); p.bots.archive(id); return { undo: async () => { calls.push('undo ' + id); } }; }
  } as unknown as Admin } });
  const open = async (patch?: (p: DataProvider) => DataProvider): Promise<void> => { boot(patch ? { patch } : {}); openSettings('bots'); await tick(8); };
  const botRow = (id: string): HTMLElement => q('[data-bot="' + id + '"]');
  it('the one default is a value; each bot has its orb at the rail\'s size, its role and only what differs; Open goes to its sheet', async () => {
    await open((p) => ({ ...p, bots: { ...p.bots, snapshot: () => { const s = p.bots.snapshot(); return { ...s, bots: s.bots.map((b) => (b.id === 'kai' ? { ...b, cfg: { ...b.cfg, cap: '5' } } : b)) }; } } }));
    expect(q('[data-part="defaults"]').textContent).toContain('Default run limit');
    expect(q('[data-fallback]').textContent).toBe('10 turns');
    expect(botRow('atlas').querySelector('[data-kit~="Avatar"] orb-avatar')).not.toBeNull();
    expect(botRow('atlas').querySelector('[data-kit~="Avatar"]')?.getAttribute('data-size')).toBe(window.innerWidth < 1200 ? '28' : '36');   /* Automatic: compact under 1200 */
    expect(botRow('atlas').textContent).toContain('reviewer · Follows your rules');
    expect(botRow('nina').textContent).toContain('1 rule of its own');
    expect(botRow('kai').textContent).toContain('Follows your rules · $5 cap');
    expect(page().textContent).not.toMatch(/default cap|No cap/i);
    const seen: string[] = [];
    on('hx:bot-settings', (d) => { seen.push(String(d.id)); });
    botRow('kai').querySelector<HTMLButtonElement>('[data-bot-open]')?.click();
    await tick(3);
    expect(seen).toEqual(['kai']);
  });
  it('the menu archives with an Undo line; Archived lists each with Restore; Delete shows only where the provider deletes', async () => {
    await open();
    botRow('kai').querySelector<HTMLButtonElement>('[data-bot-menu]')?.click();
    await tick(2);
    expect([...document.querySelectorAll('.k7-menu [role^="menuitem"]')].map((r) => r.textContent)).toEqual(['Archive']);
    menuPick('Archive');
    await tick(8);
    expect(page().querySelector('[data-bot="kai"]')).toBeNull();
    expect(q('[data-last]').textContent).toContain('Archived kai');
    expect(q('[data-part="archived"]').textContent).toContain('kai');
    q<HTMLButtonElement>('[data-last] [data-line]').click();
    await tick(8);
    expect(page().querySelector('[data-bot="kai"]')).not.toBeNull();
    expect(page().querySelector('[data-bot-delete]')).toBeNull();
  });
  it('Delete is the sheet\'s flow: what goes, Archive instead, and a second press deletes with the name as the confirmation', async () => {
    const calls: string[] = [];
    await open(withAdmin(calls));
    botRow('atlas').querySelector<HTMLButtonElement>('[data-bot-menu]')?.click();
    await tick(2);
    menuPick('Delete');
    await tick(6);
    const flow = q('[data-part="delete"]');
    expect(flow.textContent).toContain('Delete atlas for good?');
    expect(flow.textContent).toContain('Its folder, 2 MB in 40 files');
    const sure = flow.querySelector<HTMLButtonElement>('[data-delete-act="sure"]') as HTMLButtonElement;
    sure.click();
    expect(calls).not.toContain('remove atlas atlas');
    expect(sure.textContent).toContain('Click again to delete');
    sure.click();
    await tick(4);
    expect(calls).toContain('remove atlas atlas');
    /* an archived bot is deleted the same way, from its row */
    q<HTMLButtonElement>('[data-bot-delete="archived--ledger"]').click();
    await tick(6);
    expect(q('[data-part="delete"]').textContent).toContain('Delete ledger for good?');
  });
  it('Restore brings an archived bot back; New bot opens the new-bot form', async () => {
    await open();
    q<HTMLButtonElement>('[data-bot-restore="archived--ledger"]').click();
    await tick(8);
    expect(page().querySelector('[data-bot="ledger"]')).not.toBeNull();
    const seen: string[] = [];
    on('hx:new-bot', () => { seen.push('new'); });
    q<HTMLButtonElement>('[data-new-bot]').click();
    expect(seen).toEqual(['new']);
  });
});

describe('Models › Voice and speech', () => {
  it('the speech model: its state and size from the host, Download and Delete', async () => {
    const s = fakeSpeech({ model: MODEL({ state: 'absent', done: 0 }) });
    boot({ speech: s });
    openSettings('models', { focus: 'voice' });
    await tick(6);
    expect(q('[data-model-state]').textContent).toBe('Not downloaded');
    q<HTMLButtonElement>('[data-speech="fetch"]').click();
    await tick(6);
    expect(s.calls).toContain('fetch');
    expect(modelWords(MODEL())).toBe('Ready, 60 MB');
    expect(modelWords(MODEL({ state: 'fetching', done: 12_000_000 }))).toBe('Downloading, 12 of 60 MB');
    expect(rowOf('Language').textContent).toContain('Automatic');
  });
  it('ElevenLabs: the key goes to the keychain and leaves the page; then the circle says voice is set up', async () => {
    const s = fakeSpeech();
    boot({ speech: s });
    openSettings('models', { focus: 'voice' });
    await tick(6);
    q<HTMLElement>('[data-select="voice"]').click();
    menuPick('ElevenLabs');
    await tick(6);
    expect(s.calls).toContain('voice:elevenlabs:null');
    const input = q<HTMLInputElement>('#hx-voice-key');
    expect(input.type).toBe('password');
    input.value = 'sk_secret_value_123';
    q<HTMLButtonElement>('[data-voice="save-key"]').click();
    expect(input.value, 'the key leaves the page at once').toBe('');
    await tick(6);
    expect(s.calls).toContain('key:elevenlabs:19');
    expect(s.calls.join(' ')).not.toContain('sk_secret');
    expect(document.body.innerHTML).not.toContain('sk_secret');
    expect(s.ready.get()).toBe(true);
    expect(page().querySelector('[data-voice="change-key"]')).not.toBeNull();
    /* the voice circle: no longer "needs a voice model"; pressed, it says talking comes later */
    expect(voiceSetUp()).toBe(true);
    expect(voiceNeedsSetup()).toBe(false);
    const slot = document.createElement('div');
    slot.innerHTML = '<div class="k7-composer"><button data-send></button></div>';
    document.body.append(slot);
    voiceTool(slot, () => null);
    slot.dispatchEvent(new CustomEvent('ui:voice', { detail: { setup: false } }));
    expect(document.querySelector('.k7-notice[data-floating]')?.textContent).toContain(VOICE_LATER);
  });
  it('a server on this computer is its speech address', async () => {
    const s = fakeSpeech();
    boot({ speech: s });
    openSettings('models', { focus: 'voice' });
    await tick(6);
    q<HTMLElement>('[data-select="voice"]').click();
    menuPick('A server on this computer');
    await tick(3);
    const url = q<HTMLInputElement>('#hx-voice-url');
    url.value = 'http://127.0.0.1:8880/v1/audio/speech';
    q<HTMLButtonElement>('[data-voice="save-url"]').click();
    await tick(6);
    expect(s.calls).toContain('voice:local:http://127.0.0.1:8880/v1/audio/speech');
    expect(s.ready.get()).toBe(true);
  });
  it('a build with no speech shows no voice section', async () => {
    boot({ speech: null });
    openSettings('models');
    await tick(6);
    expect(page().querySelector('#hx-set-voice')).toBeNull();
  });
});

describe('Appearance, Keyboard, Diagnostics', () => {
  it('Appearance writes the theme, the accent and the corners', async () => {
    openSettings('appearance');
    await tick();
    q<HTMLElement>('[data-select="accent"]').click();
    menuPick('Indigo');
    expect(loadLook().accent).toBe('indigo');
    expect(document.getElementById('hx-v7-look')?.textContent).toContain('--accent:#4f46e5');
    q<HTMLElement>('[data-set="corners"] [data-value="rounder"]').click();
    expect(loadLook().corners).toBe('rounder');
    q<HTMLElement>('[data-select="theme"]').click();
    menuPick('Light');
    expect(themeApi.scheme()).toBe('light');
  });
  it('Keyboard lists today\'s bindings by group as key chips, read only', async () => {
    openSettings('keys');
    await tick();
    expect(page().querySelectorAll('.k7-section').length).toBeGreaterThan(5);
    expect(rowOf('Search and commands').querySelector('[data-kit~="Kbd"]')).not.toBeNull();
    expect(page().querySelector('input, [data-kit~="Switch"]')).toBeNull();
  });
  it('Diagnostics: the GPU choice, saved with "Restart to switch", and the report', async () => {
    boot({ desktop: true });
    openSettings('diagnostics');
    await tick(6);
    expect(rowOf('Graphics card').textContent).toContain('Running on the integrated GPU');
    q<HTMLElement>('[data-set="gpu"] [data-value="dedicated"]').click();
    await tick(6);
    expect(rowOf('Graphics card').textContent).toContain('Applies after a restart.');
    expect(q('[data-act="restart"]').textContent).toContain('Restart to switch');
    expect(rowOf('Graphics renderer').querySelector('[data-act="copy"]')).not.toBeNull();
  });
});
