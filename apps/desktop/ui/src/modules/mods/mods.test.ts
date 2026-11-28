// @vitest-environment jsdom
/* The places a mod draws into (2b, the lead's decisions for conflict 32), against the events the real plugin sent (the recording of
   plugins/boopis/tests/test_mods_frames.py) and small fakes: the band in the strip's slot over the composer (the kit's Queue), a mod's
   status on the composer's own line, panes as tabs of the tools after their fixed tabs, notices, a log line as a SystemLine and a
   placed row as a ToolRow, and the theme card with every way a preview ends. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import type { DataProvider, ModsSource, ModSession } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createModsModel } from '../../data/mods-model';
import { kit, setTokenReader } from '@boopis/ui';
import { fixtures } from '../../host/testing';
import { themeApi } from '../../styles/theme';
import { installPreset } from '../../styles/testing';
import { state } from '../../core/state';
import '../cards';
import { ctl } from './ctl';
import { resetMods } from './index';
import { panelTabs } from './panes';
import { statusItems } from './status';
import { surface } from './surfaces';
import { openCards, previewingCard, recheck, themeCard, themeColors, placeThemeCard, swatchesOf } from './theme-card';
import type { HxCard } from '../cards';

/* jsdom has no stylesheet: the catalog preset's colours go on the page, so the theme card's contrast guard reads what a browser would */
beforeAll(() => { installPreset('catalog'); });

const RECORDED = fixtures.mods.filter((r) => r.dir === 'in' && r.frame['method'] === 'event')
  .map((r) => r.frame['params'] as { type: string; session_id: string; payload: Record<string, unknown> })
  .filter((e) => e.type.startsWith('plugin.boopis.mod.')).map((e) => ({ type: e.type.slice('plugin.boopis.'.length), payload: e.payload }));
const SID = 's1';
const tree = (text: string): Record<string, unknown> => ({ type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [text] }] });

interface Rig { model: ReturnType<typeof createModsModel>; calls: Array<[string, ...unknown[]]>; col: HTMLElement; band: HTMLElement; lines: number; tools: number }
let rig: Rig;
const play = (type: string, payload: Record<string, unknown>): void => { rig.model.handle(SID, type, payload); };
const pane = (id: string, plugin = 'm', extra: Record<string, unknown> = {}): void => { play('mod.pane', { action: 'open', plugin, id, title: id.toUpperCase(), ...extra }); play('mod.render', { component: 'Pane', id, kind: 'tree', tree: tree('body of ' + id) }); };
const status = (): string[] => statusItems().map((i) => i.value);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function build(): Rig {
  document.body.innerHTML = '<div id="hx-app"><div class="ss-view"><div class="ss-col"></div><div class="ss-composer"><div class="ss-strip" hidden></div><div class="ss-composer__slot"></div></div></div></div>';
  const q = (s: string): HTMLElement => document.querySelector<HTMLElement>(s) as HTMLElement;
  const model = createModsModel(() => Date.UTC(2026, 10, 19, 12, 0));
  const calls: Rig['calls'] = [];
  const mods: ModsSource = {
    ...model.source,
    press: (...a) => calls.push(['press', ...a]), input: (...a) => calls.push(['input', ...a]), select: (...a) => calls.push(['select', ...a]), props: (...a) => calls.push(['props', ...a])
  };
  setProvider({ ...createMockProvider({ simulate: false }), mods } as DataProvider);
  const r: Rig = { model, calls, col: q('.ss-col'), band: q('.ss-strip'), lines: 0, tools: 0 };
  surface.band = r.band;
  surface.place = (n) => { r.col.append(n); };
  surface.redrawRight = null;
  surface.redrawLine = () => { r.lines++; };
  surface.openTools = () => { r.tools++; };
  return r;
}
const follow = (): void => { surface.onConversation?.(SID); };

beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  setTokenReader((t) => ({ '--bg-0': '#0c0b0a', '--bg-1': '#14130f', '--bg-2': '#1c1a17', '--bg-3': '#23211e', '--bg-pane': '#161616', '--text': '#e9e4da' } as Record<string, string>)[t] ?? null);
  rig = build();
  resetMods(); kit.notifyReset();
});
afterEach(() => { themeApi.endPreview(false); themeApi.reset(); themeApi.preset('catalog'); setTokenReader(null); });

describe('what the recording says, drawn', () => {
  it('draws every surface from the real events: panes as tabs, the band, two statuses on the line, the log in the conversation and a theme card', () => {
    follow();
    for (const e of RECORDED) rig.model.handle(SID, e.type, e.payload);
    expect(rig.model.state(SID).panes.map((p) => p.id)).toEqual(['tests', 'usage']);
    expect(panelTabs()?.items.map((i) => i.label)).toEqual(['Tests', 'Token usage']);
    expect(rig.band.querySelector('[data-kit~="Queue"][data-variant="mod"] [data-kit~="ModView"]')?.textContent).toContain('Running tests');
    expect(status()).toEqual(['test-runner 1 failing', 'token-meter 12.4k tokens this turn']);
    expect([...rig.col.querySelectorAll('[data-mod-log]')].map((n) => n.textContent)).toEqual([expect.stringContaining('the cache for money.test.ts is stale'), expect.stringContaining('token-meter is watching this session')]);
    expect(rig.col.querySelector('hx-card[data-kind="form"] .k7-swatches')).toBeTruthy();
  });
  it('names each mod by its glyph and its name, the band after the mod that drew it, and a band with no name as "Mods" when several are loaded', () => {
    follow();
    for (const e of RECORDED) rig.model.handle(SID, e.type, e.payload);
    const row = (): Element | null => rig.band.querySelector('[data-kit-part~="QueueRow"]');
    expect(row()?.getAttribute('aria-label')).toBe('test-runner mod');   // two mods are loaded: the event says which drew the row
    expect(row()?.querySelector('.k7-queue__who svg')).toBeTruthy();
    expect(rig.col.querySelector('[data-mod-log] [data-kit~="StatusWord"]')?.textContent).toBe('test-runner');
    expect(rig.col.querySelector('[data-mod-log] .k7-sys__meta')?.textContent).toMatch(/\d\d:\d\d/);
    rig.model.list(SID, { plugins: [{ name: 'only-one' }] });
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x') });
    expect(row()?.getAttribute('aria-label')).toBe('only-one mod');
    rig.model.list(SID, { plugins: [{ name: 'a' }, { name: 'b' }] });
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x') });
    expect(row()?.getAttribute('aria-label')).toBe('Mods');   // no mod named, several loaded: never a guess
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x'), plugin: 'b' });
    expect(row()?.getAttribute('aria-label')).toBe('b mod');
  });
});

describe('the band, in the held or queued strip\'s slot over the composer (2b)', () => {
  it('is the kit\'s Queue (mod), one folding row on the strip; an empty slot is hidden, and "no mod drew it" empties it', () => {
    follow();
    expect([rig.band.childElementCount, rig.band.hidden]).toEqual([0, true]);
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('Tests idle') });
    expect(rig.band.hidden).toBe(false);
    expect(rig.band.querySelectorAll('[data-kit~="Queue"] [data-kit-part~="QueueRow"]').length).toBe(1);
    expect(rig.band.querySelector('[data-kit~="ModView"]')?.getAttribute('data-surface')).toBe('band');
    expect(rig.band.querySelector('[data-queue="fold"]')?.getAttribute('aria-expanded')).toBe('false');
    play('mod.render', { component: 'AbovePrompt', kind: 'default' });
    expect([rig.band.childElementCount, rig.band.hidden]).toEqual([0, true]);
  });
  it('redraws a changed tree in place, so a field in it keeps focus', () => {
    follow();
    const input = (v: string): Record<string, unknown> => ({ type: 'Box', props: {}, children: [{ type: 'Input', props: { value: v, onInput: { $handler: 'h' } }, children: [] }] });
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: input('a') });
    rig.band.querySelector<HTMLInputElement>('input')?.focus();
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: input('ab') });
    const g = rig.band.querySelector<HTMLInputElement>('input');
    expect([g?.value, document.activeElement === g]).toEqual(['ab', true]);
  });
  it('is told isWorking and isCollapsed, and told again when either changes, and only then', () => {
    follow();
    pane('a');
    const bandProps = (): unknown[] => rig.calls.filter((c) => c[0] === 'props' && c[2] === 'AbovePrompt').map((c) => c[4]);
    expect(bandProps()).toEqual([{ isWorking: false, isCollapsed: true }]);
    surface.onWorking?.(true); surface.onWorking?.(true);
    expect(bandProps()).toEqual([{ isWorking: false, isCollapsed: true }, { isWorking: true, isCollapsed: true }]);
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x') });
    rig.band.querySelector<HTMLButtonElement>('[data-queue="fold"]')?.click();
    expect(bandProps().at(-1)).toEqual({ isWorking: true, isCollapsed: false });
    expect(rig.band.querySelector('[data-kit-part~="QueueRow"]')?.hasAttribute('data-open')).toBe(true);
  });
  it('sends a press from the band to the mod by id, for the session the tree was drawn for', () => {
    follow();
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: { type: 'Box', props: {}, children: [{ type: 'Button', props: { label: 'Re-run', onPress: { $handler: '0.h9' } }, children: [] }] } });
    rig.band.querySelector<HTMLButtonElement>('[data-kit~="ModView"] button')?.click();
    expect(rig.calls.filter((c) => c[0] === 'press')).toEqual([['press', SID, '0.h9']]);
  });
});

describe('a mod\'s status joins the composer\'s own line (2b: nothing rises)', () => {
  it('is a plain item of the line that only says: the mod\'s glyph, its name and its words in mono, left out first when narrow', () => {
    follow();
    play('mod.status', { plugin: 'test-runner', text: '1 failing' });
    const [item] = statusItems();
    expect(item).toMatchObject({ plain: true, still: true, icon: 'mod', mono: true, fold: true, label: 'test-runner mod', value: 'test-runner 1 failing' });
  });
  it('draws the line again when a status comes, changes or clears, and not when nothing changed', () => {
    follow();
    const n0 = rig.lines;
    play('mod.status', { plugin: 'a', text: 'one' });
    expect(rig.lines).toBe(n0 + 1);
    play('mod.status', { plugin: 'a', text: 'one' });
    expect(rig.lines).toBe(n0 + 1);
    play('mod.status', { plugin: 'a', text: 'two' });
    play('mod.status', { plugin: 'a', text: '' });
    expect(rig.lines).toBe(n0 + 3);
    expect(status()).toEqual([]);
  });
  it('is drawn by the kit\'s composer as a plain item after the line\'s own, before its end', () => {
    follow();
    play('mod.status', { plugin: 'test-runner', text: '1 failing' });
    const t = document.createElement('template');
    t.innerHTML = kit.html.composer({ kind: 'session', line: [{ label: 'Branch', value: 'main', plain: true, still: true }, ...statusItems(), { label: 'Context', value: '12%', end: true }] });
    const items = [...t.content.querySelectorAll('.k7-composer__line > *')].map((n) => n.textContent ?? '');
    expect(items.indexOf('test-runner 1 failing')).toBe(1);
    expect(t.content.querySelector('[data-mod-status="test-runner"]')?.getAttribute('aria-label')).toBe('test-runner mod: test-runner 1 failing');
  });
});

describe('panes: a tab of the tools after their fixed tabs (2b), at every width', () => {
  it('is a tab named by its title (the panel names its mod); Diff is in front until one is chosen', () => {
    follow(); pane('a'); pane('b');
    const t = panelTabs();
    expect(t?.items).toEqual([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]);
    expect([t?.value, t?.label, t?.body()]).toEqual(['diff', 'Diff', null]);
  });
  it('tells each pane where it is: placement dock, and whether it is the one in front', () => {
    follow(); pane('a');
    const paneProps = (): unknown[] => rig.calls.filter((c) => c[0] === 'props' && c[2] === 'Pane').map((c) => c[4]);
    expect(paneProps().at(-1)).toEqual({ title: 'A', placement: 'dock', isFocused: false });
    panelTabs()?.select('a');
    expect(paneProps().at(-1)).toEqual({ title: 'A', placement: 'dock', isFocused: true });
  });
  it('choosing a tab brings that pane in front: its name is the panel\'s, its tree its body (the strip is the kit\'s: modules/session/details.test.ts)', () => {
    follow(); pane('a'); pane('b');
    panelTabs()?.select('b');
    expect(ctl.active).toBe('b');
    const t = panelTabs();
    expect([t?.value, t?.label]).toEqual(['b', 'B, m mod']);
    expect(t?.body()?.querySelector('[data-kit~="ModView"]')?.getAttribute('data-surface')).toBe('pane');
    t?.select('diff');
    expect(panelTabs()?.body()).toBeNull();
  });
  it('draws a pane the plugin refused, or that no mod drew, as one line and not as nothing', () => {
    follow();
    play('mod.pane', { action: 'open', plugin: 'm', id: 'bad', title: 'Bad' });
    play('mod.render', { component: 'Pane', id: 'bad', kind: 'skipped', reason: 'deeper than 32' });
    ctl.active = 'bad';
    expect(panelTabs()?.body()?.querySelector('[data-kit~="EmptyState"]')?.textContent).toBe('This pane can’t be drawn.');
    play('mod.render', { component: 'Pane', id: 'bad', kind: 'default' });
    expect(panelTabs()?.body()?.textContent).toBe('m hasn’t drawn this pane.');
  });
  it('a pane that opens with focus comes forward: its tab, the tools open', () => {
    follow();
    state.right = 'closed' as never;
    play('mod.pane', { action: 'open', plugin: 'm', id: 'f', title: 'F', focus: true });
    expect([ctl.active, rig.tools, state.right]).toEqual(['f', 1, 'open']);
  });
  it('a pane opened without focus waits as a tab: nothing opens', () => {
    follow();
    state.right = 'closed' as never;
    pane('q');
    expect([ctl.active, rig.tools, state.right]).toEqual(['diff', 0, 'closed']);
  });
});

describe('notices: the kit\'s Notice, one at a time, with "+N" (owner decision, 19 November 2026; 2b: mod notices are the kit Notice)', () => {
  const shown = (): string | undefined => kit.notifyQueued().showing?.trim();
  const more = (): string | undefined => document.querySelector('.k7-notify .k7-notice__more')?.textContent ?? undefined;
  const fade = (): void => { vi.advanceTimersByTime(4100); vi.advanceTimersByTime(260); };
  beforeEach(() => { vi.useFakeTimers(); follow(); });
  afterEach(() => { kit.notifyReset(); vi.useRealTimers(); });
  const say = (t: string): void => play('mod.toast', { plugin: 'test-runner', text: t, timeout_ms: 4000 });

  it('shows the first at once, led by the mod (its glyph and "name mod"), and the rest wait behind it with a quiet count', () => {
    say('one'); say('two'); say('three');
    expect(shown()).toBe('one');
    expect(document.querySelector('.k7-notify .k7-notice__title')?.textContent).toBe('test-runner mod');
    expect(document.querySelector('.k7-notify [data-kit~="Notice"] svg')).toBeTruthy();
    expect(more()).toBe('+2');
    expect(kit.notifyQueued().waiting.map((x) => x.trim())).toEqual(['two', 'three']);
    expect(document.querySelector('.k7-notify .k7-notice__more')?.getAttribute('aria-label')).toBe('2 more waiting');
  });
  it('keeps the order and shows the next as the previous has faded', () => {
    say('one'); say('two'); say('three');
    fade();
    expect([shown(), more()]).toEqual(['two', '+1']);
    fade();
    expect([shown(), more()]).toEqual(['three', undefined]);
  });
  it('shows the next at once when one is dismissed by its close button, by Esc inside it, or by its action', () => {
    say('one'); say('two'); say('three'); say('four');
    document.querySelector<HTMLButtonElement>('.k7-notify [data-dismiss]')?.click();
    expect(shown()).toBe('two');
    document.querySelector('.k7-notify [data-kit~="Notice"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shown()).toBe('three');
    kit.notifyDismiss();
    expect(shown()).toBe('four');
    expect(more()).toBeUndefined();
    kit.notifyDismiss();
    expect(kit.notifyQueued()).toEqual({ showing: null, waiting: [] });
    expect(document.querySelector('.k7-notify')?.hasAttribute('data-in')).toBe(false);
  });
  it('fades by itself on the time the mod gave, and then the next comes', () => {
    say('one'); say('two');
    vi.advanceTimersByTime(4100);
    vi.advanceTimersByTime(260);
    expect(shown()).toBe('two');
  });
  it('shows notices of a session that is not on screen: the mod is named, so it is not mistaken', () => {
    rig.model.handle('another', 'mod.toast', { plugin: 'elsewhere', text: 'hi', timeout_ms: 1000 });
    expect(shown()).toBe('hi');
    expect(document.querySelector('.k7-notify .k7-notice__title')?.textContent).toBe('elsewhere mod');
  });
});

describe('a mod\'s rows in the conversation (2b: the kit\'s SystemLine and ToolRow), never from the agent', () => {
  it('a log line is a SystemLine: the mod\'s glyph and name, its words, the time; a warning\'s name in amber, boopis speaking as "Mods"', () => {
    follow();
    play('mod.log', { plugin: 'a', level: 'info', text: 'hello' });
    play('mod.log', { plugin: '', level: 'warn', text: 'a mod stopped' });
    const rows = [...rig.col.querySelectorAll<HTMLElement>('[data-mod-log]')];
    expect(rows.map((r) => [r.dataset['modLog'], r.getAttribute('data-kit')])).toEqual([['info', 'SystemLine'], ['warn', 'SystemLine']]);
    expect(rows[0]?.querySelector('.k7-sys__text')?.textContent).toBe('hello');
    expect(rows[0]?.querySelector('[data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('neutral');
    expect(rows[1]?.querySelector('[data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('owe');
    expect(rows[1]?.querySelector('[data-kit~="StatusWord"]')?.textContent).toBe('Mods');
  });
  it('a debug line is never shown', () => {
    follow();
    play('mod.log', { plugin: 'a', level: 'debug', text: 'secret' });
    expect(rig.col.textContent).not.toContain('secret');
  });
  it('rows are gone when the conversation is redrawn and placed again from the session, not kept twice', () => {
    follow();
    play('mod.log', { plugin: 'a', level: 'info', text: 'once' });
    rig.col.replaceChildren();
    follow();
    expect(rig.col.querySelectorAll('[data-mod-log]').length).toBe(1);
  });
  it('a Placed draw is a ToolRow led by the mod, what it draws under its head; replaced by the next draw of the same id, removed by a default one', () => {
    follow();
    play('mod.render', { component: 'Placed', id: 'r', kind: 'tree', tree: tree('first') });
    play('mod.render', { component: 'Placed', id: 'r', kind: 'tree', tree: tree('second') });
    const rows = [...rig.col.querySelectorAll('[data-mod-placed]')];
    expect(rows.map((n) => n.getAttribute('data-kit'))).toEqual(['ToolRow']);
    expect(rows[0]?.querySelector('.k7-tool__after [data-kit~="ModView"]')?.getAttribute('data-surface')).toBe('row');
    expect(rows[0]?.textContent).toContain('second');
    play('mod.render', { component: 'Placed', id: 'r', kind: 'default' });
    expect(rig.col.querySelectorAll('[data-mod-placed]').length).toBe(0);
  });
});

describe('refusals: nothing pretends to work', () => {
  it('draws no commands, backdrop or redraw of the app own parts: events for them change nothing on screen', () => {
    follow();
    const before = document.body.innerHTML;
    play('mod.command', { action: 'register', command: 'm:go', plugin: 'm', name: 'go' });
    play('mod.render', { component: 'UserMessage', kind: 'tree', tree: tree('redrawn') });
    play('mod.render', { component: 'Backdrop', kind: 'tree', tree: tree('scene') });
    expect(document.body.innerHTML).toBe(before);
  });
  it('a tree the renderer refuses leaves the band without a drawing and the reason in the log, not a half drawing', () => {
    follow();
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: { type: 'Client', props: {}, children: [] } });
    expect(rig.band.querySelector('[data-kit~="ModView"]')).toBeNull();
  });
  it('a worker that exited clears what it drew (the plugin tells through mod.list) and says so in the conversation', () => {
    follow(); pane('a'); play('mod.status', { plugin: 'm', text: 'x' });
    rig.model.list(SID, { plugins: [], exited: 'the worker was killed' });
    const s: ModSession = rig.model.state(SID);
    expect([s.stopped, s.panes.length, s.status.length]).toEqual(['the worker was killed', 0, 0]);
    expect(status()).toEqual([]);
  });
});

describe('the theme card, and every way its preview ends', () => {
  const root = document.documentElement;
  const brass = (): string => root.style.getPropertyValue('--brass');
  const offer = (colors: Record<string, string>, plugin = 'dusk'): HxCard => {
    const card = themeCard({ plugin, colors, label: null }) as HxCard;
    placeThemeCard(card);
    return card;
  };
  const DUSK = { '--bg-2': '#201e31', '--text': '#e7e4f2', '--brass': '#b8a4f0' };
  beforeEach(() => {
    follow();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  });
  afterEach(() => { for (const c of openCards()) c.closest('[data-mod-card]')?.remove(); recheck(); });
  const click = (c: HxCard, action: string): void => { c.querySelector<HTMLButtonElement>('[data-action="' + action + '"]')?.click(); };

  it('maps a mod colours onto the app tokens: its own tokens, and Claude Code names that have one, and says which it left out', () => {
    expect(themeColors({ '--brass': '#B8A4F0', claude: '#112233', text: '#fff', subtle: 'rgb(1, 2, 3)', success: '#0f0' })).toEqual({
      colors: { '--brass': '#112233', '--text': '#ffffff', '--text-quiet': '#010203', '--ok': '#00ff00' }, unused: []
    });
    const r = themeColors({ 'surface-0': '#101010', red: 'red', '--nope': '#ffffff', claude: '#bbaaff' });
    expect(r.colors).toEqual({ '--brass': '#bbaaff' });
    expect(r.unused).toEqual(['surface-0', 'red', '--nope']);
    expect(swatchesOf({ '--bg-2': '#201e31', '--text': '#e7e4f2', '--brass': '#b8a4f0', '--ok': '#00ff00' })).toEqual([['ground', '#201e31'], ['text', '#e7e4f2'], ['accent', '#b8a4f0'], ['success', '#00ff00']]);
  });
  it('offers no card when the app can use none of the colours', () => {
    expect(themeCard({ plugin: 'x', colors: { 'surface-0': '#101010' }, label: null })).toBeNull();
  });
  it('asks "Apply name’s colours?" with Keep, Later and Reject, the mod as its origin, and says "previewing"', () => {
    const c = offer(DUSK);
    expect(c.querySelector('.k7-ask__ask')?.textContent).toBe('Apply dusk’s colours?');
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('dusk mod asks');
    expect([...c.querySelectorAll('.k7-ask__answers .k7-chip__label')].map((b) => b.textContent)).toEqual(['Keep', 'Later', 'Reject']);
    expect(c.querySelector('.k7-ask__head .k7-word')?.textContent).toBe('previewing');   // not owed: no "needs you", the preview said instead
    expect(c.hasAttribute('data-previewing')).toBe(true);
  });
  it('previews the whole app while the card is open and on screen, and never saves it', () => {
    const c = offer(DUSK);
    expect([themeApi.previewing(), brass(), previewingCard()]).toEqual([true, '#b8a4f0', c]);
    expect(root.style.getPropertyValue('--bg-2')).toBe('#201e31');
    expect(localStorage.getItem('hx.v6.theme') ?? '').not.toContain('b8a4f0');
  });
  it('Keep commits the colours (they become the theme and are saved) and says what was kept', async () => {
    const c = offer(DUSK);
    click(c, 'submit'); await tick();
    expect([themeApi.previewing(), brass(), c.state]).toEqual([false, '#b8a4f0', 'done']);
    expect(localStorage.getItem('hx.v6.theme')).toContain('b8a4f0');
    expect(c.textContent).toContain('Kept dusk’s colours. Undo in Settings, Appearance');
    expect(c.hasAttribute('data-previewing')).toBe(false);
  });
  describe('a colour that would make text hard to read', () => {
    /* dark text on the theme's dark frame, and quiet text that is dark too: both would be unreadable, so neither is applied */
    const DARK_TEXT = { '--text': '#1a1a1a', '--text-quiet': '#222222', '--brass': '#b8a4f0', '--bg-2': '#201e31' };
    const text = (): string => root.style.getPropertyValue('--text');
    it('is not applied while the card previews, the rest is, and the card says which it skipped in plain words', () => {
      const c = offer(DARK_TEXT);
      expect([themeApi.previewing(), brass(), root.style.getPropertyValue('--bg-2'), text(), root.style.getPropertyValue('--text-quiet')]).toEqual([true, '#b8a4f0', '#201e31', '', '']);
      expect(c.querySelector('.k7-ask__sub')?.textContent).toContain('Skipped 2 colours that would make text hard to read: text on surface, quiet text.');
      expect(c.querySelector('.k7-ask__head .k7-word')?.textContent).toBe('previewing');
    });
    it('says nothing about skipping when every colour holds', () => {
      const c = offer(DUSK);
      expect(c.querySelector('.k7-ask__sub')?.textContent ?? '').not.toContain('Skipped');
    });
    it('Keep stores only what was applied, and the receipt says what was left out', async () => {
      const c = offer(DARK_TEXT);
      click(c, 'submit'); await tick();
      const saved = JSON.parse(localStorage.getItem('hx.v6.theme') ?? '{}') as { colors: Record<string, string> };
      expect(saved.colors).toEqual({ '--brass': '#b8a4f0', '--bg-2': '#201e31' });
      expect([c.state, text()]).toEqual(['done', '']);
      expect(c.textContent).toContain('Kept dusk’s colours, without 2 that would make text hard to read. Undo in Settings, Appearance');
    });
    it('Reject, and Esc, restore the previous theme as they do for any theme', () => {
      const c = offer(DARK_TEXT);
      click(c, 'cancel');
      expect([themeApi.previewing(), brass(), text(), c.state]).toEqual([false, '', '', 'cancelled']);
      expect(localStorage.getItem('hx.v6.theme') ?? '').not.toContain('b8a4f0');
      const d = offer(DARK_TEXT, 'dusk2');
      d.querySelector<HTMLElement>('[data-action="submit"]')?.focus();
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect([themeApi.previewing(), brass(), d.state]).toEqual([false, '', 'cancelled']);   // Esc is Reject's key (REPASS.md 6d)
    });
    it('another theme chosen ends the preview, and a card opened again checks again', () => {
      const c = offer(DARK_TEXT);
      themeApi.preset('graphite');
      expect([themeApi.previewing(), root.style.getPropertyValue('--bg-2')]).toEqual([false, '']);
      click(c, 'reopen');
      expect(c.hasAttribute('data-previewing')).toBe(false);
    });
    it('a card Kept without a preview showing it is checked before it is stored', async () => {
      const c = offer(DARK_TEXT);
      /* the card is set aside (another tab): no preview holds it, and Keep is still the guard's */
      c.closest('[data-mod-card]')?.setAttribute('hidden', '');
      recheck();
      expect(themeApi.previewing()).toBe(false);
      click(c, 'submit'); await tick();
      const saved = JSON.parse(localStorage.getItem('hx.v6.theme') ?? '{}') as { colors: Record<string, string> };
      expect(saved.colors).toEqual({ '--brass': '#b8a4f0', '--bg-2': '#201e31' });
      expect(c.textContent).toContain('without 2 that would make text hard to read');
    });
    it('a mod whose every colour would fail is told so on Keep, and nothing changes', async () => {
      const c = offer({ '--text': '#1a1a1a' });
      click(c, 'submit'); await tick();
      expect(localStorage.getItem('hx.v6.theme') ?? '').not.toContain('1a1a1a');
      expect(c.textContent).toContain('Kept nothing: every colour of dusk would make text hard to read');
    });
  });
  it('Reject restores the previous theme at once and says it is back as it was', () => {
    const c = offer(DUSK);
    click(c, 'cancel');
    expect([themeApi.previewing(), brass(), c.state]).toEqual([false, '', 'cancelled']);
    expect(c.textContent).toContain('Rejected. The theme is back as it was');
    expect(localStorage.getItem('hx.v6.theme') ?? '').not.toContain('b8a4f0');
  });
  it('Later restores it too, says the theme stays as it was, and opening the card again previews it again', () => {
    const c = offer(DUSK);
    click(c, 'defer');
    expect([themeApi.previewing(), brass(), c.state]).toEqual([false, '', 'deferred']);
    expect(c.textContent).toContain('Later. The theme stays as it was');
    click(c, 'reopen');
    expect([themeApi.previewing(), brass(), c.state]).toEqual([true, '#b8a4f0', 'open']);
  });
  it('closing or removing the card restores it, and so does the conversation being redrawn', () => {
    const c = offer(DUSK);
    c.closest('[data-mod-card]')?.remove();
    recheck();
    expect([themeApi.previewing(), brass()]).toEqual([false, '']);
    play('mod.theme', { action: 'set', plugin: 'dusk', theme: { colors: DUSK } });
    expect(themeApi.previewing()).toBe(true);
    rig.col.replaceChildren();
    recheck();
    expect(themeApi.previewing()).toBe(false);
  });
  it('a card in a view that is hidden (another tab, another session) does not preview; back on screen, it starts again', () => {
    const c = offer(DUSK);
    rig.col.setAttribute('inert', '');
    recheck();
    expect([themeApi.previewing(), brass()]).toEqual([false, '']);
    rig.col.removeAttribute('inert');
    recheck();
    expect([themeApi.previewing(), brass()]).toEqual([true, '#b8a4f0']);
    rig.col.hidden = true;
    recheck();
    expect(themeApi.previewing()).toBe(false);
    expect(c.state).toBe('open');
  });
  it('scrolled out of the window still counts as shown: reading the conversation never drops the preview', () => {
    offer(DUSK);
    /* the card is rendered and in the page; where it sits in the scroller does not matter */
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: -4000, left: 0, right: 10, bottom: -3990, width: 10, height: 10, x: 0, y: -4000, toJSON: () => ({}) } as DOMRect);
    recheck();
    expect(themeApi.previewing()).toBe(true);
  });
  it('another theme chosen ends the preview without bringing the old one back over it, and the card waits until it is opened again', () => {
    const c = offer(DUSK);
    themeApi.preset('graphite');
    expect([themeApi.previewing(), themeApi.get().preset, brass(), c.hasAttribute('data-previewing')]).toEqual([false, 'graphite', '', false]);
    recheck();
    expect(themeApi.previewing()).toBe(false);
  });
  it('a colour edited in Settings, Appearance ends it the same way', () => {
    offer(DUSK);
    themeApi.endPreview(false);
    expect(brass()).toBe('');
    recheck();
    expect(themeApi.previewing()).toBe(false);
  });
  it('is one preview at a time: the card opened last holds it, and rejecting it hands the preview back', () => {
    const a = offer({ '--brass': '#111111' }, 'a');
    const b = offer({ '--brass': '#222222' }, 'b');
    expect([brass(), previewingCard()]).toEqual(['#222222', b]);
    click(b, 'cancel');
    expect([brass(), previewingCard()]).toEqual(['#111111', a]);
    click(a, 'cancel');
    expect([brass(), themeApi.previewing()]).toEqual(['', false]);
  });
  it('a page that is going away restores it', () => {
    offer(DUSK);
    window.dispatchEvent(new Event('pagehide'));
    expect([themeApi.previewing(), brass()]).toEqual([false, '']);
  });
  it('a theme the mod takes back (theme.clear) or replaces withdraws the card and its preview', () => {
    play('mod.theme', { action: 'set', plugin: 'dusk', theme: { colors: DUSK } });
    expect([rig.col.querySelectorAll('hx-card[data-kind="form"]').length, brass()]).toEqual([1, '#b8a4f0']);
    play('mod.theme', { action: 'set', plugin: 'dusk', theme: { colors: { '--brass': '#445566' } } });
    expect([rig.col.querySelectorAll('hx-card[data-kind="form"]').length, brass()]).toEqual([1, '#445566']);
    play('mod.theme', { action: 'clear', plugin: 'dusk' });
    expect([rig.col.querySelectorAll('hx-card[data-kind="form"]').length, themeApi.previewing(), brass()]).toEqual([0, false, '']);
  });
  it('a card already answered is drawn again as its receipt when the conversation is redrawn, never asked twice', async () => {
    play('mod.theme', { action: 'set', plugin: 'dusk', theme: { colors: DUSK } });
    const c = rig.col.querySelector('hx-card[data-kind="form"]') as HxCard;
    click(c, 'cancel');
    rig.col.replaceChildren();
    follow();
    const again = rig.col.querySelector('hx-card[data-kind="form"]') as HxCard;
    expect([again.state, themeApi.previewing()]).toEqual(['cancelled', false]);
  });
});
