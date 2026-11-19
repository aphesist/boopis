// @vitest-environment jsdom
/* The surfaces a mod draws into, against the events the real plugin sent (the recording of plugins/boopis/tests/test_mods_frames.py)
   and small fakes: the band, the status line and the composer's rise, panes at both widths, toasts, placed rows, and the theme
   card with every way a preview ends. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import type { DataProvider, ModsSource, ModSession } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createModsModel } from '../../data/mods-model';
import { setTokenReader } from '../../components/mod-colors';
import { fixtures } from '../../host/testing';
import { themeApi } from '../../styles/theme';
import { installPreset } from '../../styles/testing';
import { state } from '../../core/state';
import '../cards';
import { ctl } from './ctl';
import { resetMods } from './index';
import { decoratePanel } from './panes';
import { surface } from './surfaces';
import { queued, resetToasts, dismiss } from './toasts';
import { openCards, previewingCard, recheck, themeCard, themeColors, placeThemeCard, swatchesOf } from './theme-card';
import type { HxCard } from '../cards';

/* jsdom has no stylesheet: the catalog preset's colours go on the page, so the theme card's contrast guard reads what a browser would */
beforeAll(() => { installPreset('catalog'); });
let reducedMotion = false;
vi.mock('../../core/dom', async (orig) => ({ ...(await orig<typeof import('../../core/dom')>()), reduced: () => reducedMotion }));

const RECORDED = fixtures.mods.filter((r) => r.dir === 'in' && r.frame['method'] === 'event')
  .map((r) => r.frame['params'] as { type: string; session_id: string; payload: Record<string, unknown> })
  .filter((e) => e.type.startsWith('plugin.boopis.mod.')).map((e) => ({ type: e.type.slice('plugin.boopis.'.length), payload: e.payload }));
const SID = 's1';
const tree = (text: string): Record<string, unknown> => ({ type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [text] }] });

interface Rig { model: ReturnType<typeof createModsModel>; calls: Array<[string, ...unknown[]]>; col: HTMLElement; band: HTMLElement; status: HTMLElement; composer: HTMLElement; host: HTMLElement }
let rig: Rig;
const play = (type: string, payload: Record<string, unknown>): void => { rig.model.handle(SID, type, payload); };
const pane = (id: string, plugin = 'm', extra: Record<string, unknown> = {}): void => { play('mod.pane', { action: 'open', plugin, id, title: id.toUpperCase(), ...extra }); play('mod.render', { component: 'Pane', id, kind: 'tree', tree: tree('body of ' + id) }); };
const width = (w: number): void => { Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true }); window.dispatchEvent(new Event('resize')); };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function build(): Rig {
  document.body.innerHTML = '<div id="hx-app"><div class="ss-view"><div class="ss-col"></div><div class="ss-composer"><div class="ss-mods ss-mods--band"></div><div class="composer"></div><div class="ss-mods ss-mods--status"></div></div></div></div>';
  const q = (s: string): HTMLElement => document.querySelector<HTMLElement>(s) as HTMLElement;
  const model = createModsModel(() => Date.UTC(2026, 10, 19, 12, 0));
  const calls: Rig['calls'] = [];
  const mods: ModsSource = {
    ...model.source,
    press: (...a) => calls.push(['press', ...a]), input: (...a) => calls.push(['input', ...a]), select: (...a) => calls.push(['select', ...a]), props: (...a) => calls.push(['props', ...a])
  };
  setProvider({ ...createMockProvider({ simulate: false }), mods } as DataProvider);
  const r: Rig = { model, calls, col: q('.ss-col'), band: q('.ss-mods--band'), status: q('.ss-mods--status'), composer: q('.composer'), host: q('.ss-composer') };
  surface.slots = { band: r.band, status: r.status };
  surface.place = (n) => { r.col.append(n); };
  surface.redrawRight = null;
  return r;
}
const follow = (): void => { surface.onConversation?.(SID); };

beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
beforeEach(() => {
  reducedMotion = false; width(1440);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  setTokenReader((t) => ({ '--bg-0': '#0c0b0a', '--bg-1': '#14130f', '--bg-2': '#1c1a17', '--text': '#e9e4da' } as Record<string, string>)[t] ?? null);
  rig = build();
  resetMods(); resetToasts();
});
afterEach(() => { themeApi.endPreview(false); themeApi.reset(); themeApi.preset('catalog'); setTokenReader(null); });

describe('what the recording says, drawn', () => {
  it('draws every surface from the real events: panes, the band, two status lines, the log in the conversation and a theme card', () => {
    follow();
    for (const e of RECORDED) rig.model.handle(SID, e.type, e.payload);
    expect(rig.model.state(SID).panes.map((p) => p.id)).toEqual(['tests', 'usage']);
    expect(rig.band.querySelectorAll('.mod-inline').length).toBe(0);   // 1440: panes are tabs, not inline
    expect(rig.band.querySelector('.mod-band .mv-root')?.textContent).toContain('Running tests');
    expect([...rig.status.querySelectorAll('.mod-status__i')].map((n) => n.textContent)).toEqual(['test-runner 1 failing', 'token-meter 12.4k tokens this turn']);
    expect([...rig.col.querySelectorAll('[data-mod-log]')].map((n) => n.textContent)).toEqual([expect.stringContaining('the cache for money.test.ts is stale'), expect.stringContaining('token-meter is watching this session')]);
    expect(rig.col.querySelector('hx-card[data-kind="form"] .cd-swatches')).toBeTruthy();
  });
  it('names each mod as its glyph and its name, the band after the mod that drew it, and a band with no name as "Mods" when several are loaded', () => {
    follow();
    for (const e of RECORDED) rig.model.handle(SID, e.type, e.payload);
    expect(rig.band.querySelector('.mod-row')?.getAttribute('aria-label')).toBe('test-runner mod');   // two mods are loaded: the event says which drew the row
    expect(rig.band.querySelector('.mod-row__who svg.mv-by__g')).toBeTruthy();
    expect(rig.col.querySelector('[data-mod-log] .mv-by__n')?.textContent).toBe('test-runner');
    expect(rig.col.querySelector('[data-mod-log] .ui-callno')?.textContent).toMatch(/\d\d:\d\d/);
    rig.model.list(SID, { plugins: [{ name: 'only-one' }] });
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x') });
    expect(rig.band.querySelector('.mod-row')?.getAttribute('aria-label')).toBe('only-one mod');
    rig.model.list(SID, { plugins: [{ name: 'a' }, { name: 'b' }] });
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x') });
    expect(rig.band.querySelector('.mod-row')?.getAttribute('aria-label')).toBe('Mods');   // no mod named, several loaded: never a guess
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x'), plugin: 'b' });
    expect(rig.band.querySelector('.mod-row')?.getAttribute('aria-label')).toBe('b mod');
  });
});

describe('the band', () => {
  it('is one collapsible row on the inset, empty slots take no room, and "no mod drew it" is an empty band', () => {
    follow();
    expect(rig.band.childElementCount).toBe(0);
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('Tests idle') });
    expect(rig.band.querySelectorAll('.mod-band .mod-row').length).toBe(1);
    expect(rig.band.querySelector('.mv-root')?.getAttribute('data-surface')).toBe('inset');
    expect(rig.band.querySelector('.mod-row')?.getAttribute('data-open')).toBe('false');
    play('mod.render', { component: 'AbovePrompt', kind: 'default' });
    expect(rig.band.childElementCount).toBe(0);
  });
  it('redraws a changed tree in place, so a field in it keeps focus', () => {
    follow();
    const input = (v: string): Record<string, unknown> => ({ type: 'Box', props: {}, children: [{ type: 'Input', props: { value: v, onInput: { $handler: 'h' } }, children: [] }] });
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: input('a') });
    const f = rig.band.querySelector<HTMLInputElement>('input');
    f?.focus();
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
    rig.band.querySelector<HTMLButtonElement>('.mod-chev')?.click();
    expect(bandProps().at(-1)).toEqual({ isWorking: true, isCollapsed: false });
    expect(rig.band.querySelector('.mod-row')?.getAttribute('data-open')).toBe('true');
  });
  it('sends a press from the band to the mod by id, for the session the tree was drawn for', () => {
    follow();
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: { type: 'Box', props: {}, children: [{ type: 'Button', props: { label: 'Re-run', onPress: { $handler: '0.h9' } }, children: [] }] } });
    rig.band.querySelector<HTMLButtonElement>('.mv-root button')?.click();
    expect(rig.calls.filter((c) => c[0] === 'press')).toEqual([['press', SID, '0.h9']]);
  });
});

describe('the status line and the composer rising 22px (owner decision, 19 November 2026)', () => {
  interface Anim { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }
  let anims: Anim[];
  beforeEach(() => {
    anims = [];
    /* a composer at 600 that sits 22px higher while a status line is showing: the layout the browser would make */
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const lifted = rig.status.childElementCount > 0 ? 22 : 0;
      const top = this === rig.composer ? 600 - lifted : this === rig.band ? 560 - lifted : this === rig.host ? 540 : 0;
      return { top, left: 0, right: 400, bottom: top + 80, width: 400, height: this === rig.composer ? 80 : 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    /* jsdom has no Web Animations: a recording stand-in on the prototype, removed after */
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value(this: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) {
      anims.push({ el: this, frames, opts });
      return { cancel() { /* a fake */ }, onfinish: null } as unknown as Animation;
    } });
    follow();
  });
  afterEach(() => { delete (HTMLElement.prototype as { animate?: unknown }).animate; });
  const movers = (): Anim[] => anims.filter((a) => a.frames.some((f) => 'transform' in f));

  it('lifts the composer and the band 22px by a transform when the first status appears: a FLIP over --dur-3 on --spring, never a layout animation', () => {
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: tree('x') });
    anims.length = 0;
    play('mod.status', { plugin: 'a', text: '1 failing' });
    const m = movers();
    expect(m.map((a) => a.el)).toEqual([rig.composer, rig.band]);
    for (const a of m) {
      expect(a.frames).toEqual([{ transform: 'translateY(22px)' }, { transform: 'translateY(0)' }]);
      expect(a.opts.duration).toBe(300);
      expect(a.opts.easing).toBe('cubic-bezier(.22, 1, .36, 1)');
      expect(a.frames.every((f) => Object.keys(f).every((k) => k === 'transform' || k === 'offset'))).toBe(true);   // no top, bottom or height
    }
    const line = anims.find((a) => a.el === rig.status);
    expect(line?.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);   // the line fades in as the composer leaves its place
  });
  it('adds no height for a second status, so nothing moves', () => {
    play('mod.status', { plugin: 'a', text: '1' });
    anims.length = 0;
    play('mod.status', { plugin: 'b', text: '2' });
    expect(anims).toEqual([]);
    expect(rig.status.querySelectorAll('.mod-status__i').length).toBe(2);
  });
  it('settles back when the last status clears, in the same way and in reverse, with a copy of the line fading in the vacated place', () => {
    play('mod.status', { plugin: 'a', text: '1' });
    anims.length = 0;
    play('mod.status', { plugin: 'a', text: '' });
    expect(movers().map((a) => [a.el, a.frames])).toEqual([[rig.composer, [{ transform: 'translateY(-22px)' }, { transform: 'translateY(0)' }]]]);
    expect(rig.status.childElementCount).toBe(0);
    const ghost = rig.host.querySelector('.mod-status--ghost');
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(anims.some((a) => a.el === ghost && a.frames.some((f) => f.opacity === 0))).toBe(true);
  });
  it('under reduced motion: no travel, a short crossfade from a ghost of where the composer was', () => {
    reducedMotion = true;
    play('mod.status', { plugin: 'a', text: '1' });
    expect(movers()).toEqual([]);
    const ghost = rig.host.querySelector('.mod-ghost');
    expect(ghost).toBeTruthy();
    expect((ghost as HTMLElement).inert).toBe(true);
    expect(anims.filter((a) => a.el === rig.composer).map((a) => [a.frames, a.opts.duration])).toEqual([[[{ opacity: 0 }, { opacity: 1 }], 120]]);
    expect(anims.find((a) => a.el === ghost)?.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
  });
  it('does not animate a switch of session: the line is there, the composer is where it is', () => {
    play('mod.status', { plugin: 'a', text: '1' });
    anims.length = 0;
    rig.model.handle('s2', 'mod.status', { plugin: 'b', text: 'two' });
    resetMods();
    surface.onConversation?.('s2');
    expect(rig.status.textContent).toBe('b two');
    expect(anims).toEqual([]);
  });
  it('says what it is to assistive tech and keeps what does not fit on one line out of the way', () => {
    play('mod.status', { plugin: 'a', text: 'x' });
    expect([rig.status.getAttribute('role'), rig.status.getAttribute('aria-label')]).toEqual(['region', 'Mod status']);
  });
});

describe('panes: a tab from 1200px, inline below it (owner decision, 19 November 2026)', () => {
  const panel = (): HTMLElement => { const p = document.createElement('div'); p.className = 'ui-panel'; p.innerHTML = '<div class="ui-panel__head"><h2>Session details</h2></div><div class="ui-panel__body">details</div>'; document.body.append(p); return p; };
  const names = (p: HTMLElement): string[] => [...p.querySelectorAll('.mod-tabs .ui-tab')].map((t) => t.getAttribute('aria-label') ?? '');

  it('at 1200 a pane is a tab after Details, and nothing is inline', () => {
    width(1200); follow(); pane('tests', 'test-runner'); pane('usage', 'token-meter');
    expect(rig.band.querySelectorAll('.mod-inline').length).toBe(0);
    const p = decoratePanel(panel());
    expect(names(p as HTMLElement)).toEqual(['Session details', 'TESTS, test-runner mod', 'USAGE, token-meter mod']);
    expect(p?.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Session details and mod panes');
  });
  it('at 1199 the same panes are inline above the composer, one open and the others folded to a head, and the panel is left as it was', () => {
    width(1199); follow(); pane('tests', 'test-runner'); pane('usage', 'token-meter');
    const secs = [...rig.band.querySelectorAll<HTMLElement>('.mod-inline')];
    expect(secs.map((s) => [s.dataset['pane'], s.dataset['open']])).toEqual([['tests', 'false'], ['usage', 'true']]);
    expect(secs[0]?.querySelector('.mod-inline__body')).toBeNull();
    expect(secs[1]?.querySelector('.mod-inline__body .mv-root')?.getAttribute('data-surface')).toBe('inset');
    expect(decoratePanel(panel())).toBeNull();
  });
  it('unfolds one inline pane and folds the other, and moves focus back to its chevron', () => {
    width(1000); follow(); pane('a'); pane('b');
    rig.band.querySelector<HTMLButtonElement>('[data-pane="a"] .mod-chev')?.click();
    expect([...rig.band.querySelectorAll<HTMLElement>('.mod-inline')].map((s) => s.dataset['open'])).toEqual(['true', 'false']);
  });
  it('redraws as the window crosses 1200, in both directions', () => {
    width(1300); follow(); pane('a');
    expect(rig.band.querySelectorAll('.mod-inline').length).toBe(0);
    width(1100);
    expect(rig.band.querySelectorAll('.mod-inline').length).toBe(1);
    width(1200);
    expect(rig.band.querySelectorAll('.mod-inline').length).toBe(0);
  });
  it('tells each pane where it is: placement dock or inline, and whether it is the one in front', () => {
    width(1300); follow(); pane('a'); pane('b');
    const props = (): unknown[] => rig.calls.filter((c) => c[0] === 'props' && c[2] === 'Pane').map((c) => [c[3], (c[4] as { placement: string; isFocused: boolean }).placement, (c[4] as { isFocused: boolean }).isFocused]);
    expect(props()).toEqual([['a', 'dock', false], ['b', 'dock', false]]);
    rig.calls.length = 0;
    width(1100);
    expect(props().every((p) => (p as string[])[1] === 'inline')).toBe(true);
  });
  it('a pane tab is a tablist: arrows, Home and End move between tabs', () => {
    width(1300); follow(); pane('a'); pane('b');
    const p = decoratePanel(panel()) as HTMLElement;
    const bar = p.querySelector('[role="tablist"]') as HTMLElement;
    document.body.append(p);
    /* the keys act on the focused tab (the library's tab bar, one tab stop) */
    const key = (k: string): void => { const t = bar.querySelector<HTMLElement>('[aria-selected="true"]') as HTMLElement; t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); };
    key('ArrowRight');
    expect(ctl.active).toBe('a');
    key('End');
    expect(ctl.active).toBe('b');
    key('ArrowRight');
    expect(ctl.active).toBe('details');
    p.remove();
  });
  it('draws a pane the plugin refused, or that no mod drew, as a sentence and not as nothing', () => {
    width(1300); follow();
    play('mod.pane', { action: 'open', plugin: 'm', id: 'bad', title: 'Bad' });
    play('mod.render', { component: 'Pane', id: 'bad', kind: 'skipped', reason: 'deeper than 32' });
    ctl.active = 'bad';
    expect(decoratePanel(panel())?.textContent).toContain('sent a tree the renderer refused');
    play('mod.render', { component: 'Pane', id: 'bad', kind: 'default' });
    expect(decoratePanel(panel())?.textContent).toContain('has not drawn this pane');
  });
  it('a pane the user closes goes, and comes back when the mod opens it again', () => {
    width(1300); follow(); pane('a');
    ctl.active = 'a';
    const p = decoratePanel(panel()) as HTMLElement;
    p.querySelector<HTMLButtonElement>('.mod-pane__head .ui-ib')?.click();
    expect(decoratePanel(panel())).toBeNull();
    play('mod.pane', { action: 'open', plugin: 'm', id: 'a', title: 'A' });
    expect(decoratePanel(panel())).not.toBeNull();
  });
  it('a pane that opens with focus comes forward and opens the details panel', () => {
    width(1300); follow();
    state.right = 'closed' as never;
    play('mod.pane', { action: 'open', plugin: 'm', id: 'f', title: 'F', focus: true });
    expect(ctl.active).toBe('f');
    expect(state.right).toBe('open');
  });
});

describe('toasts: one at a time, with "+N" (owner decision, 19 November 2026)', () => {
  const shown = (): string | undefined => document.querySelector('.ui-toast .mod-toast__t')?.textContent ?? undefined;
  const more = (): string | undefined => document.querySelector('.ui-toast .mod-toast__more')?.textContent ?? undefined;
  const fade = async (): Promise<void> => { document.querySelector('.ui-toast')?.classList.remove('is-in'); await Promise.resolve(); vi.advanceTimersByTime(260); };
  beforeEach(() => { vi.useFakeTimers(); follow(); });
  afterEach(() => { resetToasts(); document.querySelectorAll('.ui-toast').forEach((n) => { n.remove(); }); vi.useRealTimers(); });
  const toast = (t: string): void => play('mod.toast', { plugin: 'test-runner', text: t, timeout_ms: 4000 });

  it('shows the first at once, led by the mod, and the rest wait behind it with a quiet count', () => {
    toast('one'); toast('two'); toast('three');
    expect(shown()).toBe('one');
    expect(document.querySelector('.ui-toast .mod-toast__who .mv-by__n')?.textContent).toBe('test-runner');
    expect(more()).toBe('+2');
    expect(queued()).toEqual({ showing: 'one', waiting: ['two', 'three'] });
    expect(document.querySelector('.ui-toast')?.getAttribute('aria-label')).toBe('test-runner mod: one, 2 more waiting');
  });
  it('keeps the order and shows the next as the previous has faded', async () => {
    toast('one'); toast('two'); toast('three');
    await fade();
    expect([shown(), more()]).toEqual(['two', '+1']);
    await fade();
    expect([shown(), more()]).toEqual(['three', undefined]);
  });
  it('shows the next at once when one is dismissed by its close button, by Esc inside it, or by its action', () => {
    toast('one'); toast('two'); toast('three'); toast('four');
    document.querySelector<HTMLButtonElement>('.ui-toast .mod-toast__x')?.click();
    expect(shown()).toBe('two');
    document.querySelector('.ui-toast')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shown()).toBe('three');
    dismiss();
    expect(shown()).toBe('four');
    expect(more()).toBeUndefined();
    dismiss();
    expect(queued()).toEqual({ showing: null, waiting: [] });
    expect(document.querySelector('.ui-toast')?.classList.contains('is-in')).toBe(false);
  });
  it('fades by itself on the time the mod gave, and then the next comes', async () => {
    toast('one'); toast('two');
    vi.advanceTimersByTime(4100);
    await Promise.resolve();
    vi.advanceTimersByTime(260);
    expect(shown()).toBe('two');
  });
  it('shows toasts of a session that is not on screen: the mod is named, so it is not mistaken', () => {
    rig.model.handle('another', 'mod.toast', { plugin: 'elsewhere', text: 'hi', timeout_ms: 1000 });
    expect(shown()).toBe('hi');
  });
});

describe('placed rows: from the mod, never from the agent', () => {
  it('a log line is a quiet row in the conversation with the mod in the margin, in the warning ink when it warns', () => {
    follow();
    play('mod.log', { plugin: 'a', level: 'info', text: 'hello' });
    play('mod.log', { plugin: '', level: 'warn', text: 'a mod stopped' });
    const rows = [...rig.col.querySelectorAll<HTMLElement>('[data-mod-log]')];
    expect(rows.map((r) => r.dataset['modLog'])).toEqual(['info', 'warn']);
    expect(rows[0]?.getAttribute('data-kind')).toBe('mod');
    expect(rows[0]?.querySelector<HTMLElement>('.mv-text')?.style.color).toBe('var(--text-quiet)');
    expect(rows[1]?.querySelector<HTMLElement>('.mv-text')?.style.color).toBe('var(--warn)');
    expect(rows[1]?.querySelector('.mv-by__n')?.textContent).toBe('Mods');
    expect(rows[1]?.querySelector('.mv-root')?.getAttribute('data-surface')).toBe('ground');
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
  it('a Placed draw is a row, replaced by the next draw of the same id and removed by a default one', () => {
    follow();
    play('mod.render', { component: 'Placed', id: 'r', kind: 'tree', tree: tree('first') });
    play('mod.render', { component: 'Placed', id: 'r', kind: 'tree', tree: tree('second') });
    expect([...rig.col.querySelectorAll('[data-mod-placed]')].map((n) => n.textContent)).toEqual([expect.stringContaining('second')]);
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
  it('a tree the renderer refuses leaves the band empty and the reason in the log, not a half drawing', () => {
    follow();
    play('mod.render', { component: 'AbovePrompt', kind: 'tree', tree: { type: 'Client', props: {}, children: [] } });
    expect(rig.band.querySelector('.mod-row .mv-root')).toBeNull();
  });
  it('a worker that exited clears what it drew (the plugin tells through mod.list) and says so in the conversation', () => {
    follow(); pane('a'); play('mod.status', { plugin: 'm', text: 'x' });
    rig.model.list(SID, { plugins: [], exited: 'the worker was killed' });
    const s: ModSession = rig.model.state(SID);
    expect([s.stopped, s.panes.length, s.status.length]).toEqual(['the worker was killed', 0, 0]);
    expect(rig.status.childElementCount).toBe(0);
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
  afterEach(() => { for (const c of openCards()) c.closest('.ui-entry')?.remove(); recheck(); });
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
  it('asks "Apply name’s colours?" with Later, Reject and Keep, the mod as its origin, and shows "Previewing"', () => {
    const c = offer(DUSK);
    expect(c.querySelector('.cd-lead')?.textContent).toBe('Apply dusk’s colours?');
    expect(c.querySelector('.cd-by .cd-names__first')?.textContent).toBe('dusk');
    expect(c.querySelector('.cd-by .cd-names__via')?.textContent).toBe(' mod');
    expect([...c.querySelectorAll('.cd-foot button')].map((b) => b.textContent)).toEqual(['Later', 'Reject', 'Keep']);
    expect(c.querySelector('.cd-live')?.textContent).toBe('Previewing');
    expect(c.hasAttribute('data-previewing')).toBe(true);
    expect(c.querySelector('.ui-stamp')?.textContent).toBe('');   // not owed: no stamp
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
      expect(c.querySelector('.cd-text')?.textContent).toContain('Skipped 2 colours that would make text hard to read: text on surface, quiet text.');
      expect(c.querySelector('.cd-live')?.textContent).toBe('Previewing');
    });
    it('says nothing about skipping when every colour holds', () => {
      const c = offer(DUSK);
      expect(c.querySelector('.cd-text')?.textContent).not.toContain('Skipped');
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
      expect([themeApi.previewing(), brass(), d.state]).toEqual([false, '', 'deferred']);
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
      c.closest('.ui-entry')?.setAttribute('hidden', '');
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
  it('Esc (Later) restores it too, says the theme stays as it was, and opening the card again previews it again', () => {
    const c = offer(DUSK);
    c.querySelector<HTMLElement>('[data-action="submit"]')?.focus();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect([themeApi.previewing(), brass(), c.state]).toEqual([false, '', 'deferred']);
    expect(c.textContent).toContain('Later. The theme stays as it was');
    click(c, 'reopen');
    expect([themeApi.previewing(), brass(), c.state]).toEqual([true, '#b8a4f0', 'open']);
  });
  it('closing or removing the card restores it, and so does the conversation being redrawn', () => {
    const c = offer(DUSK);
    c.closest('.ui-entry')?.remove();
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
