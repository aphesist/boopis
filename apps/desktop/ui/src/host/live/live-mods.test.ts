/* Mods on the live provider, over the frames the real plugin and the real hx worker produced (plugins/boopis/tests/test_mods_frames.py):
   what a session's mods draw reaches the provider as one state per session; what the user does goes back by handler id with the
   plugin's own method names; a mod's `$.ui.ask` arrives as a form with the mod's origin and is answered like any form. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FormWait, ModsEvent, ModSession } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { ReplayHost, ReplaySecrets } from '../replay';
import { eventsOf, fixtures, resultOf } from '../testing';

const SID = (resultOf<{ sessions: { id: string; message_count: number }[] }>(fixtures.mods, 'session.list').sessions.find((s) => s.message_count > 0) as { id: string }).id;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let host: ReplayHost;
let provider: LiveProvider;
let states: ModSession[];
let events: ModsEvent[];
async function open(): Promise<void> {
  host = new ReplayHost(fixtures.mods);
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ client, now: () => new Date(2026, 10, 19, 1, 0, 0), mock: createMockProvider({ simulate: false }), secrets: new ReplaySecrets(), pickFolder: null });
  await provider.ready;
  states = []; events = [];
  provider.mods.session(SID).subscribe((s) => states.push(s));
  provider.mods.events.subscribe((e) => events.push(e));
  provider.sessions.conversation(SID);   // the session is resumed: the plugin is asked who is loaded
  await tick(); await tick();
  provider.sessions.send(SID, 'run the tests', { governed: false, smart: false, model: '', assume: [] });
  await tick(); await tick(); await tick();
}
const sent = (method: string): { method: string; params: Record<string, unknown> }[] => host.requests.filter((r) => r.method === 'plugin.boopis.' + method) as never;

describe('what the mods draw', () => {
  beforeEach(async () => { await open(); });

  it('folds the recorded mod events of the turn into the session: panes, status, band, log and theme', () => {
    const s = provider.mods.session(SID).get();
    expect(s.active).toBe(true);
    expect(s.panes.map((p) => p.id)).toEqual(['tests', 'usage']);
    expect(s.status.map((x) => x.plugin)).toEqual(['test-runner', 'token-meter']);
    expect(s.log).toHaveLength(2);
    expect(s.theme?.plugin).toBe('test-runner');
    expect(events.filter((e) => e.type === 'toast')).toHaveLength(3);
    expect(events.every((e) => e.sessionId === SID)).toBe(true);
  });
  it('asks the plugin who is loaded when the session is resumed, by the gateway id of the session', () => {
    const asked = sent('mod.list').map((r) => r.params['session_id']);
    expect(asked).toContain(SID);
  });
  it('tells a watcher once per change, never with a mutated value', () => {
    expect(states.length).toBeGreaterThan(5);
    expect(new Set(states).size).toBe(states.length);
  });
  it('has no mods for a session the plugin never saw them in', () => {
    expect(provider.mods.session('another').get().active).toBe(false);
  });
});

describe('what the user does goes back by handler id', () => {
  beforeEach(async () => { await open(); });

  it('a press, an input and a select are mod.press, mod.input and mod.select with the session and the id', async () => {
    provider.mods.press(SID, '0.h1'); provider.mods.input(SID, '0.h2', 'abc'); provider.mods.select(SID, '0.h3', 'failing');
    await tick();
    expect(sent('mod.press').at(-1)?.params).toEqual({ session_id: SID, handler: '0.h1' });
    expect(sent('mod.input').at(-1)?.params).toEqual({ session_id: SID, handler: '0.h2', value: 'abc' });
    expect(sent('mod.select').at(-1)?.params).toEqual({ session_id: SID, handler: '0.h3', value: 'failing' });
  });
  it('a press is answered by the redraws it causes, which arrive as new draws of the pane', async () => {
    const before = states.length;
    provider.mods.press(SID, '0.h1');
    await tick(); await tick();
    expect(states.length).toBeGreaterThan(before);
  });
  it('tells a site where it is: a pane id and its placement, the band with no id', async () => {
    provider.mods.props(SID, 'Pane', 'tests', { placement: 'dock', title: 'Tests', isFocused: true });
    provider.mods.props(SID, 'AbovePrompt', null, { isWorking: false, isCollapsed: true });
    await tick();
    expect(sent('mod.props').at(-2)?.params).toEqual({ session_id: SID, component: 'Pane', id: 'tests', props: { placement: 'dock', title: 'Tests', isFocused: true } });
    expect(sent('mod.props').at(-1)?.params).toEqual({ session_id: SID, component: 'AbovePrompt', props: { isWorking: false, isCollapsed: true } });
  });
  it('sends nothing for a session that is not live on the gateway', async () => {
    const n = host.requests.length;
    provider.mods.press('new-nothing', 'h');
    await tick();
    expect(host.requests.length).toBe(n);
  });
});

describe('a mod asks a question', () => {
  beforeEach(async () => { await open(); });
  const asks = (): FormWait[] => provider.waits.snapshot().filter((w): w is FormWait => w.kind === 'form');

  it('is a form wait with the mod as its origin, so the conversation and the dock draw its byline', async () => {
    provider.mods.press(SID, '0.h1'); provider.mods.select(SID, '0.h2', 'failing'); provider.mods.press(SID, '0.h3');
    await tick(); await tick(); await tick();
    const opened = eventsOf(fixtures.mods, 'plugin.boopis.form.opened')[0]?.payload;
    expect(opened?.['origin']).toEqual({ kind: 'mod', plugin: 'test-runner' });
    const w = asks().find((x) => x.data.origin?.kind === 'mod');
    expect(w?.data).toMatchObject({ kind: 'choice', title: 'Which tests should I re-run?', origin: { kind: 'mod', plugin: 'test-runner' } });
    expect(w?.data.schema.properties?.['answer']).toMatchObject({ enum: ['The failing test', 'The billing suite', 'Everything'] });
  });
  it('is answered through the plugin, like every form, and leaves the dock', async () => {
    provider.mods.press(SID, '0.h1'); provider.mods.select(SID, '0.h2', 'failing'); provider.mods.press(SID, '0.h3');
    await tick(); await tick(); await tick();
    const w = asks().find((x) => x.data.origin?.kind === 'mod');
    expect(w).toBeTruthy();
    await provider.forms.submit(w?.id ?? '', { values: { answer: 'The billing suite' }, secrets: {} });
    await tick();
    expect(sent('form.submit').at(-1)?.params).toMatchObject({ form_id: w?.id, values: { answer: 'The billing suite' }, provided: [] });
    expect(asks().some((x) => x.id === w?.id)).toBe(false);
  });
});

describe('the mock has no mods', () => {
  it('is always empty and its commands go nowhere', () => {
    const m = createMockProvider({ simulate: false }).mods;
    expect(m.session('s1').get().active).toBe(false);
    expect(() => { m.press('s1', 'h'); m.props('s1', 'Pane', 'a', {}); }).not.toThrow();
  });
});
