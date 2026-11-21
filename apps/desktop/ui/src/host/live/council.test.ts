import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider } from '../../data/mock-provider';
import type { CouncilChoice, ConversationEvent, ModelChoice, AgentTurn } from '../../data';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { FakeHost } from '../testing';
import { applyMoa, bestOf, choiceFromPreset, defaultChoice, defaultMembers, onceValue, presetWrites, slotOfLabel, startedCouncil, versionOf } from './council';

const C = 'claude-subscription-directsdk-experimental';
const ch = (provider: string, model: string, tier?: number): ModelChoice => ({ value: provider + '/' + model, provider, model, providerName: provider, ...(tier !== undefined ? { tier, tierName: model } : {}) });
const CHOICES = [ch(C, 'haiku', 0), ch(C, 'sonnet', 1), ch(C, 'opus', 2), ch(C, 'claude-fable-5-2[1m]'), ch('openai-codex', 'gpt-5.1-codex-mini'), ch('openai-codex', 'gpt-6-luna'), ch('gemini', 'gemini-3.8-flash'), ch('gemini', 'gemini-3.8-pro')];

describe('who sits on a council by default', () => {
  it('reads a version out of an id', () => { expect(versionOf('claude-opus-5-5[1m]')).toEqual([5, 5]); expect(versionOf('gpt-5.1-codex')).toEqual([5, 1]); expect(versionOf('opus')).toEqual([]); });
  it('takes the main model of a family, not its small one, and the newest', () => {
    expect(bestOf(['gpt-5.1-codex-mini', 'gpt-6-luna'])).toBe('gpt-6-luna');
    expect(bestOf(['gemini-3.8-flash', 'gemini-3.8-pro'])).toBe('gemini-3.8-pro');
    expect(bestOf(['gpt-5', 'gpt-5.5'])).toBe('gpt-5.5');
  });
  it('never picks fable on its own (it bills usage credits on a Pro plan), but keeps it when it is all there is', () => {
    expect(bestOf(['claude-opus-5-5', 'claude-fable-5-2'])).toBe('claude-opus-5-5');
    expect(bestOf(['claude-fable-5-2'])).toBe('claude-fable-5-2');
  });
  it('one member per provider: the highest tier of the ladder where there is one, else the best', () => {
    expect(defaultMembers(CHOICES)).toEqual([{ provider: C, model: 'opus' }, { provider: 'openai-codex', model: 'gpt-6-luna' }, { provider: 'gemini', model: 'gemini-3.8-pro' }]);
  });
  it('the session\'s model combines them', () => {
    expect(defaultChoice(CHOICES, C + '/sonnet').combiner).toEqual({ provider: C, model: 'sonnet' });
    expect(defaultChoice(CHOICES, '').combiner).toEqual({ provider: C, model: 'opus' });
  });
});

describe('the preset', () => {
  const choice: CouncilChoice = { members: [{ provider: 'a', model: 'x' }, { provider: 'b', model: 'y' }], combiner: { provider: 'a', model: 'x' } };
  it('writes every field into the council preset, as JSON the engine parses', () => {
    const w = presetWrites(choice, null);
    expect(w.map(([k]) => k)).toEqual(['moa.presets.council.reference_models', 'moa.presets.council.aggregator', 'moa.presets.council.fanout']);
    expect(JSON.parse(w[0]?.[1] ?? '')).toEqual([{ provider: 'a', model: 'x' }, { provider: 'b', model: 'y' }]);
    expect(JSON.parse(w[1]?.[1] ?? '')).toEqual({ provider: 'a', model: 'x' });
    expect(w[2]?.[1]).toBe('user_turn');
  });
  it('writes nothing when the saved preset already is this council', () => {
    const saved = { reference_models: [{ provider: 'a', model: 'x', enabled: true }, { provider: 'b', model: 'y', enabled: true }], aggregator: { provider: 'a', model: 'x' }, fanout: 'user_turn', enabled: true };
    expect(presetWrites(choice, saved)).toEqual([]);
    expect(choiceFromPreset(saved)).toEqual(choice);
  });
  it('writes only the combiner when only it changed, and turns a disabled preset on', () => {
    const saved = { enabled: false, reference_models: [{ provider: 'a', model: 'x' }, { provider: 'b', model: 'y' }], aggregator: { provider: 'b', model: 'y' }, fanout: 'user_turn' };
    expect(presetWrites(choice, saved).map(([k]) => k)).toEqual(['moa.presets.council.aggregator', 'moa.presets.council.enabled']);
  });
  it('a preset with fewer than two members is not a council to remember', () => { expect(choiceFromPreset({ reference_models: [{ provider: 'a', model: 'x' }], aggregator: { provider: 'a', model: 'x' } })).toBeNull(); });
  it('the one-turn switch names the preset on the virtual provider', () => { expect(onceValue()).toBe('council --provider moa --once'); });
});

describe('the events of a council', () => {
  const choice: CouncilChoice = { members: [{ provider: 'p', model: 'm1' }, { provider: 'custom:q', model: 'm2' }], combiner: { provider: 'p', model: 'm1' } };
  it('reads a label back to the slot it names, colon in the provider and effort suffix included', () => {
    expect(slotOfLabel('custom:q:m2[reasoning=high]', choice.members)).toEqual({ provider: 'custom:q', model: 'm2' });
    expect(slotOfLabel('x:y:z')).toEqual({ provider: 'x', model: 'y:z' });
  });
  it('progress counts, references fill the cards, the phase moves to the combiner', () => {
    let t = startedCouncil(choice);
    t = applyMoa(t, { type: 'moa.progress', payload: { label: 'p:m1', refs_done: 1, refs_total: 2 } }) ?? t;
    expect(t.done).toBe(1); expect(t.members[0]?.state).toBe('answered');
    t = applyMoa(t, { type: 'moa.reference', payload: { label: 'p:m1', text: 'one', index: 1, count: 2 } }) ?? t;
    t = applyMoa(t, { type: 'moa.reference', payload: { label: 'custom:q:m2', text: '[failed: 429 rate limit]', index: 2, count: 2 } }) ?? t;
    expect(t.members.map((m) => [m.state, m.text])).toEqual([['answered', 'one'], ['failed', '']]);
    t = applyMoa(t, { type: 'moa.phase', payload: { phase: 'aggregator', refs_done: 2, refs_total: 2, aggregator: 'p:m1' } }) ?? t;
    expect(t.phase).toBe('combining'); expect(t.combiner).toEqual({ provider: 'p', model: 'm1' });
  });
  it('a council nobody armed (a slash command) builds its members from the events', () => {
    const t = applyMoa(null, { type: 'moa.reference', payload: { label: 'p:m1', text: 'hi', index: 1, count: 3 } });
    expect(t?.members.length).toBe(1); expect(t?.total).toBe(3);
  });
  it('an event that is not a council\'s changes nothing', () => { expect(applyMoa(null, { type: 'message.delta', payload: {} })).toBeNull(); });
});

/* ───────── the provider over fake frames ───────── */
const OPTIONS = { model: 'sonnet', provider: C, providers: [{ slug: C, name: 'Claude', models: ['sonnet', 'opus'], authenticated: true }, { slug: 'openai-codex', name: 'OpenAI', models: ['gpt-6-luna'], authenticated: true }] };
let host: FakeHost; let provider: LiveProvider; let calls: { method: string; params: Record<string, unknown> }[]; let saved: unknown; let onceFails: number;
const tick = (n = 5): Promise<void> => new Promise((r) => { let i = 0; const go = (): void => { if (++i >= n) r(); else setTimeout(go, 0); }; go(); });
function gateway(f: Record<string, unknown>): void {
  const id = f['id'], params = (f['params'] ?? {}) as Record<string, unknown>;
  calls.push({ method: String(f['method']), params });
  switch (f['method']) {
    case 'session.list': host.result(id, { sessions: [] }); break;
    case 'model.options': host.result(id, OPTIONS); break;
    case 'session.create': host.result(id, { session_id: 'g1', info: { model: 'sonnet' } }); break;
    case 'config.get': host.result(id, { config: { moa: { presets: saved ? { council: saved } : {} } } }); break;
    case 'cli.exec': host.result(id, { blocked: false, code: 0, output: 'ok' }); break;
    case 'config.set': if (onceFails-- > 0) host.error(id, 5001, 'config.set --once requires a live session'); else host.result(id, { key: 'model', value: 'council', scope: 'once' }); break;
    case 'prompt.submit': host.result(id, { status: 'streaming' }); break;
    case 'profiles.list': host.result(id, { profiles: [] }); break;
    case 'groups.list': host.result(id, { groups: [] }); break;
    case 'mcp.servers.status': host.result(id, { servers: [] }); break;
    default: host.result(id, {});
  }
}
beforeEach(async () => {
  host = new FakeHost(); host.autoReply = gateway; calls = []; saved = null; onceFails = 0;
  const client = new GatewayClient(host); await client.connect();
  provider = createLiveProvider({ client, mock: createMockProvider({ simulate: false }) });
  await provider.ready;
});
const CHOICE: CouncilChoice = { members: [{ provider: C, model: 'opus' }, { provider: 'openai-codex', model: 'gpt-6-luna' }], combiner: { provider: C, model: 'sonnet' } };

describe('asking a council, end to end over fake frames', () => {
  it('starts from the best of each provider, with the session\'s model combining', async () => {
    const s = provider.sessions.create('p');
    provider.details.follow(s.id);
    const f = await provider.council.prepare(s.id);
    expect(f.remembered).toBe(false);
    expect(f.choice.members.map((m) => m.model)).toEqual(['gpt-6-luna', 'opus'].sort((a, b) => f.choice.members.findIndex((m) => m.model === a) - f.choice.members.findIndex((m) => m.model === b)));
    expect(f.choice.members.length).toBe(2);
  });
  it('writes the preset with the engine\'s own config command, and arms the next message', async () => {
    const s = provider.sessions.create('p');
    await provider.council.arm(s.id, CHOICE);
    const sets = calls.filter((c) => c.method === 'cli.exec').map((c) => c.params['argv'] as string[]);
    expect(sets.map((a) => a.slice(0, 3))).toEqual([['config', 'set', 'moa.presets.council.reference_models'], ['config', 'set', 'moa.presets.council.aggregator'], ['config', 'set', 'moa.presets.council.fanout']]);
    expect(provider.council.armed(s.id)).toEqual(CHOICE);
  });
  it('remembers the last council: a saved preset is where the form starts, and asking it again writes nothing', async () => {
    saved = { reference_models: CHOICE.members, aggregator: CHOICE.combiner, fanout: 'user_turn' };
    const s = provider.sessions.create('p'); provider.details.follow(s.id);
    const f = await provider.council.prepare(s.id);
    expect(f.remembered).toBe(true); expect(f.choice).toEqual(CHOICE);
    await provider.council.arm(s.id, CHOICE);
    expect(calls.some((c) => c.method === 'cli.exec')).toBe(false);
  });
  it('refuses fewer than two members, and a refusal of the engine leaves nothing armed and says so in plain words', async () => {
    const s = provider.sessions.create('p');
    await expect(provider.council.arm(s.id, { ...CHOICE, members: [CHOICE.members[0] as CouncilChoice['members'][number]] })).rejects.toThrow(/at least 2/);
    host.autoReply = (f) => { if (f['method'] === 'cli.exec') host.result(f['id'], { blocked: false, code: 1, output: 'Traceback boom' }); else gateway(f); };
    await expect(provider.council.arm(s.id, CHOICE)).rejects.toThrow(/would not save the council/);
    expect(provider.council.armed(s.id)).toBeNull();
  });
  it('is not offered in a governed session, with the reason', async () => {
    const s = provider.sessions.create('p');
    provider.details.follow(s.id);
    provider.details.setGovernance({ governed: true });
    const say = provider.council.can(s.id);
    expect(say.ok).toBe(false);
    if (!say.ok) expect(say.reason).toMatch(/only when a gate fails/);
  });
  it('sends the one message as a one-turn council, shows each member, then the combined answer, and spends the arming', async () => {
    const s = provider.sessions.create('p');
    await provider.council.arm(s.id, CHOICE);
    const events: ConversationEvent[] = [];
    provider.sessions.conversation(s.id).subscribe((e) => events.push(e));
    provider.sessions.send(s.id, 'which index?', { governed: false, smart: false, model: '', assume: [] });
    await tick(20);
    const order = calls.map((c) => c.method).filter((m) => ['cli.exec', 'config.set', 'prompt.submit'].includes(m));
    expect(order).toEqual(['cli.exec', 'cli.exec', 'cli.exec', 'config.set', 'prompt.submit']);
    expect(calls.find((c) => c.method === 'config.set')?.params).toMatchObject({ session_id: 'g1', key: 'model', value: 'council --provider moa --once' });
    expect(provider.council.armed(s.id)).toBeNull();
    host.event('message.start', 'g1');
    host.event('moa.progress', 'g1', { label: C + ':opus', refs_done: 1, refs_total: 2 });
    host.event('moa.reference', 'g1', { label: C + ':opus', text: 'use a btree', index: 1, count: 2 });
    host.event('moa.reference', 'g1', { label: 'openai-codex:gpt-6-luna', text: 'use a hash index', index: 2, count: 2 });
    host.event('moa.phase', 'g1', { phase: 'aggregator', refs_done: 2, refs_total: 2, aggregator: C + ':sonnet' });
    host.event('message.delta', 'g1', { text: 'A btree.' });
    host.event('message.complete', 'g1', { text: 'A btree.', usage: { model: 'council' } });
    await tick(5);
    const turn = provider.sessions.conversation(s.id).snapshot().turns.find((t): t is AgentTurn => t.role === 'assistant');
    expect(turn?.council?.members.map((m) => m.text)).toEqual(['use a btree', 'use a hash index']);
    expect(turn?.council?.phase).toBe('done');
    expect(turn?.model).toBe(C + '/sonnet');   /* the combiner answered, not the preset's name */
    expect(turn?.why).toBe('Council of 2');
    expect(events.filter((e) => e.type === 'council').length).toBeGreaterThan(2);
  });
  it('waits for a new session\'s agent: the one-turn switch is tried again while the engine builds it', async () => {
    onceFails = 2;
    const s = provider.sessions.create('p');
    await provider.council.arm(s.id, CHOICE);
    provider.sessions.send(s.id, 'hi', { governed: false, smart: false, model: '', assume: [] });
    await new Promise((r) => setTimeout(r, 1300));
    expect(calls.filter((c) => c.method === 'config.set').length).toBe(3);
    expect(calls.some((c) => c.method === 'prompt.submit')).toBe(true);
  }, 10000);
  it('does not send the message to a model nobody chose when the switch is refused', async () => {
    onceFails = 99;
    const s = provider.sessions.create('p');
    await provider.council.arm(s.id, CHOICE);
    host.autoReply = (f) => { if (f['method'] === 'config.set') host.error(f['id'], 4002, 'model refused'); else gateway(f); };
    provider.sessions.send(s.id, 'hi', { governed: false, smart: false, model: '', assume: [] });
    await tick(30);
    expect(calls.some((c) => c.method === 'prompt.submit')).toBe(false);
    const turn = provider.sessions.conversation(s.id).snapshot().turns.find((t): t is AgentTurn => t.role === 'assistant');
    expect(turn?.paragraphs.join(' ')).toMatch(/council could not start/);
  });
});
