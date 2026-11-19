import { describe, expect, it } from 'vitest';
import { eventsOf, fixtures } from '../host/testing';
import { LOG_MAX, NO_MODS, applyList, createModsModel, drawingOf, reduceMod } from './mods-model';
import type { ModsEvent } from './types';

/* the mod events a real plugin and a real hx worker emitted (plugins/boopis/tests/test_mods_frames.py), in the order they came */
const RECORDED = fixtures.mods.filter((r) => r.dir === 'in' && r.frame['method'] === 'event')
  .map((r) => r.frame['params'] as { type: string; session_id: string; payload: Record<string, unknown> })
  .filter((e) => e.type.startsWith('plugin.boopis.mod.'))
  .map((e) => ({ id: e.session_id, type: e.type.slice('plugin.boopis.'.length), payload: e.payload }));
const SID = RECORDED[0]?.id ?? '';

function play(upTo = RECORDED.length): { model: ReturnType<typeof createModsModel>; events: ModsEvent[] } {
  const model = createModsModel(() => Date.UTC(2026, 10, 19, 12, 0));
  const events: ModsEvent[] = [];
  model.source.events.subscribe((e) => events.push(e));
  for (const e of RECORDED.slice(0, upTo)) model.handle(e.id, e.type, e.payload);
  return { model, events };
}
const clock = { now: 1000, id: 1 };

describe('the recorded mod events, folded into one session', () => {
  it('has the recording to fold: panes, a status, toasts, a log, a theme, draws and a pane close are all in it', () => {
    const types = new Set(RECORDED.map((e) => e.type));
    for (const t of ['mod.pane', 'mod.render', 'mod.status', 'mod.toast', 'mod.log', 'mod.theme']) expect(types.has(t)).toBe(true);
    expect(eventsOf(fixtures.mods, 'plugin.boopis.form.opened')).toHaveLength(1);
  });
  it('opens both panes, each drawn with a tree, and keeps the plugin that owns each', () => {
    const s = play().model.state(SID);
    expect(s.active).toBe(true);
    expect(s.panes.map((p) => [p.id, p.plugin, p.title, p.drawing?.kind])).toEqual([['tests', 'test-runner', 'Tests', 'tree'], ['usage', 'token-meter', 'Token usage', 'tree']]);
    const tests = s.panes[0]?.drawing;
    expect(tests?.kind === 'tree' && tests.tree.type).toBe('Box');
  });
  it('keeps the newest draw of a site: the pane shows what the last press made it draw', () => {
    const s = play().model.state(SID);
    const first = s.panes[0]?.drawing, label = (d: typeof first): unknown => (d?.kind === 'tree' ? JSON.stringify(d.tree) : '');
    expect(label(first)).toContain('Running tests');
    expect(label(first)).toContain('"value":"failing"');
  });
  it('draws the band from AbovePrompt, with no plugin named (the plugin does not say which mod drew it)', () => {
    const band = play().model.state(SID).band;
    expect(band?.plugin).toBeNull();
    expect(band?.drawing.kind).toBe('tree');
    expect(JSON.stringify(band?.drawing)).toContain('Running tests');
  });
  it('holds one status per mod, in the order they first spoke', () => {
    expect(play().model.state(SID).status).toEqual([{ plugin: 'test-runner', text: '1 failing' }, { plugin: 'token-meter', text: '12.4k tokens this turn' }]);
  });
  it('turns toasts into events, in order, and keeps them out of the state', () => {
    const { model, events } = play();
    expect(events.filter((e) => e.type === 'toast').map((e) => e.type === 'toast' && [e.plugin, e.text, e.timeoutMs])).toEqual([['test-runner', '1 test failing', 4000], ['test-runner', 'Indexed 296 files', 4000], ['test-runner', 'Context is at 78%', 4000]]);
    expect(JSON.stringify(model.state(SID))).not.toContain('Indexed 296');
  });
  it('keeps the log lines the model does not read, newest last, and a theme the mod offered', () => {
    const s = play().model.state(SID);
    expect(s.log.map((l) => [l.plugin, l.level, l.text])).toEqual([['test-runner', 'info', 'the cache for money.test.ts is stale'], ['token-meter', 'info', 'token-meter is watching this session']]);
    expect(s.theme).toEqual({ plugin: 'test-runner', label: 'Dusk', colors: { '--bg-2': '#201e31', '--brass': '#b8a4f0', '--text': '#e7e4f2' } });
  });
  it('leaves state untouched and says so when an event has nothing to draw', () => {
    const model = createModsModel();
    const r = model.handle('s', 'mod.render', { component: 'UserMessage', kind: 'tree', tree: { type: 'Box', props: {}, children: [] } });
    expect(r.ignored).toMatch(/UserMessage/);
    expect(model.state('s')).toBe(NO_MODS);
  });
});

describe('each event, on its own', () => {
  const pane = { action: 'open', plugin: 'm', id: 'p', title: 'P' };
  const tree = { type: 'Box', props: {}, children: [] };
  it('a pane opens, is opened again (the count tells), and closes', () => {
    let s = reduceMod(NO_MODS, 'mod.pane', pane, clock).state;
    expect(s.active && s.panes[0]).toMatchObject({ id: 'p', plugin: 'm', title: 'P', opens: 1, focus: false, drawing: null });
    s = reduceMod(s, 'mod.render', { component: 'Pane', id: 'p', kind: 'tree', tree }, clock).state;
    s = reduceMod(s, 'mod.pane', { ...pane, title: 'Q', focus: true }, clock).state;
    expect(s.panes[0]).toMatchObject({ title: 'Q', opens: 2, focus: true });
    expect(s.panes[0]?.drawing?.kind).toBe('tree');   // reopened: what it drew stays until it draws again
    expect(reduceMod(s, 'mod.pane', { action: 'close', plugin: 'm', id: 'p' }, clock).state.panes).toEqual([]);
  });
  it('a draw for a pane that is not open is ignored, not guessed at', () => {
    const r = reduceMod(NO_MODS, 'mod.render', { component: 'Pane', id: 'ghost', kind: 'tree', tree }, clock);
    expect(r.state).toBe(NO_MODS);
    expect(r.ignored).toMatch(/ghost/);
  });
  it('an identical draw changes nothing, so nothing redraws', () => {
    const s = reduceMod(NO_MODS, 'mod.pane', pane, clock).state;
    const a = reduceMod(s, 'mod.render', { component: 'Pane', id: 'p', kind: 'default' }, clock).state;
    expect(reduceMod(a, 'mod.render', { component: 'Pane', id: 'p', kind: 'default' }, clock).state).toBe(a);
  });
  it('default is no mod drew it, skipped is a tree the plugin refused with the reason, and a tree that is not an element is refused here', () => {
    expect(drawingOf({ kind: 'default' })).toEqual({ kind: 'default' });
    expect(drawingOf({ kind: 'skipped', reason: 'deeper than 32' })).toEqual({ kind: 'skipped', reason: 'deeper than 32' });
    expect(drawingOf({ kind: 'tree', tree: 'x' }).kind).toBe('skipped');
    expect(drawingOf({ kind: 'tree', tree }).kind).toBe('tree');
  });
  it('the band is empty when no mod drew it, and an empty band stays the same state', () => {
    let s = reduceMod(NO_MODS, 'mod.render', { component: 'AbovePrompt', kind: 'tree', tree, plugin: 'm' }, clock).state;
    expect(s.band).toMatchObject({ plugin: 'm' });
    s = reduceMod(s, 'mod.render', { component: 'AbovePromptList', kind: 'default' }, clock).state;
    expect(s.band).toBeNull();
    const again = reduceMod(s, 'mod.render', { component: 'AbovePrompt', kind: 'default' }, clock).state;
    expect(again).toBe(s);
  });
  it('a status is replaced in place, and empty text takes it away', () => {
    let s = reduceMod(NO_MODS, 'mod.status', { plugin: 'a', text: '1' }, clock).state;
    s = reduceMod(s, 'mod.status', { plugin: 'b', text: '2' }, clock).state;
    s = reduceMod(s, 'mod.status', { plugin: 'a', text: '3' }, clock).state;
    expect(s.status).toEqual([{ plugin: 'a', text: '3' }, { plugin: 'b', text: '2' }]);
    expect(reduceMod(s, 'mod.status', { plugin: 'a', text: '' }, clock).state.status).toEqual([{ plugin: 'b', text: '2' }]);
  });
  it('a debug line goes to the debug log and never to the conversation; the log is capped', () => {
    const d = reduceMod(NO_MODS, 'mod.log', { plugin: 'm', level: 'debug', text: 'x' }, clock);
    expect(d.state).toBe(NO_MODS);
    expect(d.ignored).toMatch(/debug/);
    let s = NO_MODS;
    for (let i = 0; i < LOG_MAX + 10; i++) s = reduceMod(s, 'mod.log', { plugin: 'm', level: 'warn', text: 'n' + i }, { now: 1, id: i }).state;
    expect([s.log.length, s.log[0]?.text, s.log.at(-1)?.text, s.log[0]?.level]).toEqual([LOG_MAX, 'n10', 'n' + (LOG_MAX + 9), 'warn']);
  });
  it('a theme is offered, replaced by the next, and taken back only by the mod that offered it', () => {
    let s = reduceMod(NO_MODS, 'mod.theme', { action: 'set', plugin: 'a', theme: { colors: { claude: '#fff', n: 3 } } }, clock).state;
    expect(s.theme).toEqual({ plugin: 'a', colors: { claude: '#fff' }, label: null });
    expect(reduceMod(s, 'mod.theme', { action: 'clear', plugin: 'b' }, clock).state.theme).not.toBeNull();
    s = reduceMod(s, 'mod.theme', { action: 'clear', plugin: 'a' }, clock).state;
    expect(s.theme).toBeNull();
  });
  it('a notification is an event with its title, and a Placed draw is a row that a default draw removes', () => {
    const n = reduceMod(NO_MODS, 'mod.notify', { plugin: 'm', title: 'T', text: 'x' }, clock);
    expect(n.event).toEqual({ type: 'notify', plugin: 'm', title: 'T', text: 'x' });
    let s = reduceMod(NO_MODS, 'mod.render', { component: 'Placed', id: 'r1', kind: 'tree', tree }, clock).state;
    expect(s.placed.map((p) => p.id)).toEqual(['r1']);
    s = reduceMod(s, 'mod.render', { component: 'Placed', id: 'r1', kind: 'default' }, clock).state;
    expect(s.placed).toEqual([]);
  });
  it('knows nothing it was not told: a mod command and an unknown event change no state', () => {
    expect(reduceMod(NO_MODS, 'mod.command', { action: 'register' }, clock).state).toBe(NO_MODS);
    expect(reduceMod(NO_MODS, 'mod.backdrop', {}, clock).ignored).toMatch(/does not know/);
  });
});

describe('who is loaded (mod.list)', () => {
  it('reads the names, and an exited worker clears every surface but keeps the log', () => {
    const s = reduceMod(NO_MODS, 'mod.status', { plugin: 'a', text: 'x' }, clock).state;
    const listed = applyList(s, { plugins: [{ name: 'a' }, { name: 'b' }], exited: '' });
    expect(listed.plugins).toEqual(['a', 'b']);
    const stopped = applyList(listed, { plugins: [], exited: 'the worker exited' });
    expect(stopped).toMatchObject({ active: false, stopped: 'the worker exited', status: [], panes: [] });
  });
  it('is nothing when the session has no mods and nothing was drawn', () => {
    expect(applyList(NO_MODS, undefined)).toBe(NO_MODS);
    expect(applyList(NO_MODS, { plugins: [], exited: '' })).toBe(NO_MODS);
  });
});

describe('the store', () => {
  it('tells a watcher of one session about its changes only', () => {
    const model = createModsModel();
    const seen: number[] = [];
    model.source.session('a').subscribe((s) => seen.push(s.status.length));
    model.handle('b', 'mod.status', { plugin: 'x', text: '1' });
    model.handle('a', 'mod.status', { plugin: 'x', text: '1' });
    expect(seen).toEqual([1]);
  });
});
