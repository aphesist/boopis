/* "@model": one message answered by one model, and who answered each message, against a scripted gateway and plugin.
   The frames to check: the one-turn switch is `prompt.submit`'s own `model_override` (that admission alone runs the model, as the
   canonical owner gateway takes it); the session's own model is never set, so nothing is put back; a governed session first arms the
   plugin's one-turn exception. The fake refuses `config.set {key: "model"}` as the engine does (4001 use_session_mutation_model). */
import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../data/mock-provider';
import type { AgentTurn } from '../data';
import { GatewayClient } from './gateway';
import { createLiveProvider } from './live-provider';
import type { LiveProvider } from './live-provider';
import { FakeHost, S0_CREATE_PARAMS } from './testing';

const SESSION = 'local-attrib-1';
const P = 'claude-subscription-directsdk-experimental';
const NOW = new Date(2026, 10, 21, 10, 0, 0);
const META = { governed: false, smart: false, model: '', assume: [] };
const OPTIONS = { model: 'haiku', provider: P, providers: [{ slug: P, name: 'Claude Subscription', models: ['haiku', 'sonnet', 'opus'], authenticated: true }, { slug: 'openai-codex', name: 'OpenAI Codex', models: ['gpt-6-luna'], authenticated: true }] };
const LADDER = ['haiku', 'sonnet', 'opus'].map((n) => ({ name: n, model: { provider: P, id: n } }));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Opts { governed?: boolean; refuseSubmit?: boolean; messages?: unknown[]; turns?: unknown[]; armed?: boolean }
async function setup(o: Opts = {}): Promise<{ host: FakeHost; provider: LiveProvider; frames: () => string[] }> {
  const host = new FakeHost();
  host.describe = { instance_id: 'inst', capabilities: ['event-replay-v1', 'plugin-rpc-v1'], session_create: { parameters: S0_CREATE_PARAMS } };
  host.autoReply = (f) => {
    const id = f['id'], m = String(f['method']);
    switch (m) {
      case 'session.list': host.result(id, { sessions: (f['params'] as { include_hidden?: boolean }).include_hidden ? [] : [{ id: SESSION, title: '', preview: 'x', started_at: NOW.getTime() / 1000 }] }); break;
      case 'session.resume': host.result(id, { session_id: SESSION, message_count: 0, messages: o.messages ?? [], info: { model: 'haiku' } }); break;
      case 'model.options': host.result(id, OPTIONS); break;
      case 'session.info': host.result(id, { model: 'haiku', provider: P, cwd: '/w' }); break;
      case 'prompt.submit': if (o.refuseSubmit) host.error(id, -32000, 'refused'); else host.result(id, { status: 'streaming', admission_id: 'a1' }); break;
      case 'config.set': if ((f['params'] as { key?: string }).key === 'model') host.error(id, 4001, 'use_session_mutation_model', { reason: 'use_session_mutation_model' }); else host.result(id, {}); break;
      case 'session.mutate': host.result(id, { session_id: SESSION, operation: 'model', revision: 1, execution_generation: 0 }); break;
      case 'plugin.boopis.describe': host.result(id, { session: { session_id: SESSION, mode: o.governed ? 'governed' : 'ungoverned', locked: false, cwd: '/w' }, config: { mode: 'governed', cost_cap_usd: 2 } }); break;
      case 'plugin.boopis.cascade.state': host.result(id, { ladder: LADDER, status: 'idle' }); break;
      case 'plugin.boopis.ledger.tail': host.result(id, { events: [] }); break;
      case 'plugin.boopis.mode.once': host.result(id, { armed: o.armed !== false && (f['params'] as { armed: boolean }).armed }); break;
      case 'cli.exec': host.result(id, { code: 0, output: '{}' }); break;
      case 'config.get': host.result(id, { config: {} }); break;
      case 'plugin.boopis.turns.models': host.result(id, { turns: o.turns ?? [] }); break;
      default: host.result(id, {});
    }
  };
  const client = new GatewayClient(host);
  await client.connect();
  const provider = createLiveProvider({ defaultFolder: '/work/proj', client, now: () => NOW, mock: createMockProvider({ simulate: false }) });
  await provider.ready;
  provider.sessions.conversation(SESSION);
  await tick();
  provider.details.follow(SESSION);
  await tick(); await provider.settled();
  /* a frame as a line: a submit with the model it overrides for its turn, a model pick with its model, the plugin's arming with its flag */
  const line = (m: string, p: Record<string, unknown>): string => {
    const o = (m === 'prompt.submit' ? p['model_override'] : m === 'session.mutate' ? p['payload'] : null) as { model: string; provider?: string } | null | undefined;
    if (o) return m + ' ' + o.model + (o.provider ? ' --provider ' + o.provider : '');
    if (m === 'config.set') return m + ' ' + String(p['key']);
    return m === 'plugin.boopis.mode.once' ? m + ' ' + String(p['armed']) : m;
  };
  const frames = (): string[] => host.sent.map((s) => line(String(s.frame['method']), (s.frame['params'] ?? {}) as Record<string, unknown>));
  return { host, provider, frames };
}
/** the frames that switch a model, submit a message or arm the plugin's exception */
const SWITCHES = /^(config\.set|session\.mutate|prompt\.submit|plugin\.boopis\.mode\.once)/;
const after = (all: string[], from: string): string[] => all.slice(all.findIndex((x) => x.startsWith(from)));
const lastTurn = (p: LiveProvider): AgentTurn => p.sessions.conversation(SESSION).snapshot().turns.filter((t): t is AgentTurn => t.role === 'assistant').at(-1) as AgentTurn;

describe('"@model" on an ungoverned session', () => {
  it('submits the text as written with the model as a one-turn override, and never sets the session model', async () => {
    const { host, provider, frames } = await setup();
    const sent = frames().length;
    provider.sessions.send(SESSION, '@GPT-6 Luna fix this', META);
    await tick(); await tick(); await tick();
    expect(frames().slice(sent).filter((f) => SWITCHES.test(f))).toEqual(['prompt.submit gpt-6-luna --provider openai-codex']);
    expect(host.last('prompt.submit')?.['params']).toMatchObject({ text: '@GPT-6 Luna fix this', model_override: { model: 'gpt-6-luna', provider: 'openai-codex' } });
    host.event('message.start', SESSION);
    expect(lastTurn(provider).model).toBe('openai-codex/gpt-6-luna');
    expect(lastTurn(provider).ungoverned).toBeUndefined();
  });
  it('the session\'s model and the sticky pick stay: the chip, the next message and the restored model', async () => {
    const { host, provider, frames } = await setup();
    expect(provider.details.setGovernance({ model: P + '/sonnet' })).toBeNull();
    provider.sessions.send(SESSION, 'first', META);
    await tick(); await tick(); await tick();
    host.event('message.complete', SESSION, { text: 'ok', outcome: 'completed', usage: { model: 'sonnet' } });
    const before = frames().length;
    provider.sessions.send(SESSION, '@GPT-6 Luna look', META);
    await tick(); await tick(); await tick();
    host.event('session.info', SESSION, { model: 'gpt-6-luna', provider: 'openai-codex' });   /* the engine names the mentioned model while it answers */
    expect(provider.details.governance.get().model).toBe(P + '/sonnet');
    host.event('message.complete', SESSION, { text: 'done', outcome: 'completed', usage: { model: 'gpt-6-luna' } });
    provider.sessions.send(SESSION, 'and after', META);
    await tick(); await tick(); await tick();
    /* the sticky pick was made once, before the first message; the mention rode on its own submit; nothing was switched back */
    expect(frames().filter((f) => f.startsWith('session.mutate'))).toEqual(['session.mutate sonnet --provider ' + P]);
    expect(frames().slice(before).filter((f) => SWITCHES.test(f))).toEqual(['prompt.submit gpt-6-luna --provider openai-codex', 'prompt.submit']);
    host.event('message.start', SESSION);
    expect(lastTurn(provider).model).toBe(P + '/sonnet');
  });
  it('Smart does not override a mention', async () => {
    const { host, provider, frames } = await setup();
    provider.details.setGovernance({ smart: true });
    const before = frames().length;
    provider.sessions.send(SESSION, 'design the whole sync layer, @GPT-6 Luna', { ...META, smart: true });
    await tick(); await tick(); await tick();
    expect(frames().slice(before).filter((f) => SWITCHES.test(f))).toEqual(['prompt.submit gpt-6-luna --provider openai-codex']);
    host.event('message.start', SESSION);
    expect(lastTurn(provider).why).toBe('You asked for GPT-6 Luna');
  });
  it('two models in one message are left as written for the session\'s model: no switch', async () => {
    const { host, provider, frames } = await setup();
    const before = frames().length;
    provider.sessions.send(SESSION, '@Claude Haiku rename it, @GPT-6 Luna test it', META);
    await tick(); await tick(); await tick();
    expect(frames().slice(before).filter((f) => SWITCHES.test(f))).toEqual(['prompt.submit']);
    expect(host.last('prompt.submit')?.['params']).toMatchObject({ text: '@Claude Haiku rename it, @GPT-6 Luna test it' });
  });
  it('a submit that is refused has nothing to put back: the session\'s model was never changed', async () => {
    const { provider, frames } = await setup({ refuseSubmit: true });
    const before = frames().length;
    provider.sessions.send(SESSION, '@GPT-6 Luna fix', META);
    await tick(); await tick(); await tick(); await tick();
    expect(frames().slice(before).filter((f) => SWITCHES.test(f))).toEqual(['prompt.submit gpt-6-luna --provider openai-codex']);
    expect(lastTurn(provider).paragraphs.join(' ')).toMatch(/not sent/);
  });
  it('a completed turn is bound to its stored rows, so a resume knows who answered', async () => {
    const { host, provider } = await setup();
    provider.sessions.send(SESSION, 'hello', META);
    await tick(); await tick(); await tick();
    host.event('message.complete', SESSION, { text: 'hi', outcome: 'completed', usage: { model: 'haiku' }, persisted_turn: { row_ids: [11, 12], user_row_id: 11, complete: true } });
    await tick();
    expect(host.last('plugin.boopis.turns.bind')?.['params']).toEqual({ session_id: SESSION, row_ids: [11, 12], user_row_id: 11 });
  });
});

describe('"@model" on a governed session', () => {
  it('arms the one-turn exception, then submits with the one-turn override; the turn is marked ungoverned and any model can be named', async () => {
    const { host, provider, frames } = await setup({ governed: true });
    const before = frames().length;
    provider.sessions.send(SESSION, '@GPT-6 Luna fix this', META);
    await tick(); await tick(); await tick();
    expect(frames().slice(before).filter((f) => SWITCHES.test(f))).toEqual(['plugin.boopis.mode.once true', 'prompt.submit gpt-6-luna --provider openai-codex']);
    host.event('message.start', SESSION);
    expect(lastTurn(provider)).toMatchObject({ model: 'openai-codex/gpt-6-luna', ungoverned: true });
  });
  it('the next message is governed again: nothing is armed or switched, and the turn is not marked', async () => {
    const { host, provider, frames } = await setup({ governed: true });
    provider.sessions.send(SESSION, '@GPT-6 Luna fix this', META);
    await tick(); await tick(); await tick();
    host.event('message.complete', SESSION, { text: 'done', outcome: 'completed', usage: { model: 'gpt-6-luna' } });
    const before = frames().length;
    provider.sessions.send(SESSION, 'now the rest', META);
    await tick(); await tick(); await tick();
    expect(frames().slice(before).filter((f) => SWITCHES.test(f))).toEqual(['prompt.submit']);
    host.event('message.start', SESSION);
    expect(lastTurn(provider).ungoverned).toBeUndefined();
  });
  it('a message the engine refuses takes the arming back', async () => {
    const { provider, frames } = await setup({ governed: true, refuseSubmit: true });
    const before = frames().length;
    provider.sessions.send(SESSION, '@GPT-6 Luna fix', META);
    await tick(); await tick(); await tick(); await tick();
    const f = frames().slice(before);
    expect(f.filter((x) => x.startsWith('plugin.boopis.mode.once'))).toEqual(['plugin.boopis.mode.once true', 'plugin.boopis.mode.once false']);
    expect(lastTurn(provider).paragraphs.join(' ')).toMatch(/not sent/);
  });
  it('a plugin that does not arm it refuses the message rather than running it governed under another name', async () => {
    const { provider, frames } = await setup({ governed: true, armed: false });
    const before = frames().length;
    provider.sessions.send(SESSION, '@GPT-6 Luna fix', META);
    await tick(); await tick(); await tick(); await tick();
    expect(after(frames(), 'plugin.boopis.mode.once').slice(0, 1)).toEqual(['plugin.boopis.mode.once true']);
    expect(frames().slice(before).some((x) => x.startsWith('config.set') || x.startsWith('session.mutate') || x.startsWith('prompt.submit'))).toBe(false);
  });
});

describe('who answered, after a resume', () => {
  it('each past turn shows its own recorded model, the engine\'s switch note is not a message, and an unrecorded turn is unknown', async () => {
    const { provider } = await setup({
      messages: [
        { role: 'user', row_id: 1, text: 'one' }, { role: 'assistant', row_id: 2, text: 'A' },
        { role: 'user', row_id: 3, text: '[Model switched to gpt-6-luna via provider openai-codex. From this point forward ...]', display_kind: 'model_switch' },
        { role: 'user', row_id: 4, text: 'two' }, { role: 'assistant', row_id: 5, text: 'B' },
        { role: 'user', row_id: 6, text: 'three' }, { role: 'assistant', row_id: 7, text: 'C' }
      ],
      turns: [{ model: P + '/haiku', route: [], ungoverned: false, row_ids: [1, 2] }, { model: 'openai-codex/gpt-6-luna', route: [], ungoverned: true, row_ids: [4, 5] }]
    });
    const turns = provider.sessions.conversation(SESSION).snapshot().turns;
    expect(turns.filter((t) => t.role === 'user')).toHaveLength(3);
    const agents = turns.filter((t): t is AgentTurn => t.role === 'assistant');
    expect(agents.map((a) => a.model)).toEqual([P + '/haiku', 'openai-codex/gpt-6-luna', '']);
    expect(agents.map((a) => a.ungoverned === true)).toEqual([false, true, false]);
  });
});

describe('a plugin older than this UI', () => {
  it('has no turns.models: every past turn is unknown, and that is not reported as a fault', async () => {
    const { loadTurnBook } = await import('./live/attribution');
    const old = { requestRaw: () => Promise.reject(Object.assign(new Error('unknown method'), { rpcCode: -32601 })) } as unknown as GatewayClient;
    expect((await loadTurnBook(old, 'g1')).size).toBe(0);
  });
});

const COUNCIL_CHOICE = { members: [{ provider: P, model: 'opus' }, { provider: 'openai-codex', model: 'gpt-6-luna' }], combiner: { provider: P, model: 'sonnet' } };
const MOA = { model: 'boopis-council', provider: 'moa' };

describe('a council turn: the model chip', () => {
  it('reads "Council of N" for the turn and never the engine\'s name for it, whatever the engine reports', async () => {
    const { host, provider } = await councilTurn();
    host.event('message.start', SESSION);
    expect(provider.details.governance.get().council).toBe(2);
    host.event('session.info', SESSION, { ...MOA, cwd: '/w', usage: { model: 'boopis-council', input: 1 } });
    host.event('session.usage', SESSION, { usage: { model: 'boopis-council' } });
    await tick(); await provider.settled();
    const gov = provider.details.governance.get();
    expect(gov.model).toBe(P + '/haiku');   /* the session's own model, not the preset */
    expect(gov.council).toBe(2);
    expect(JSON.stringify([gov, provider.details.models.get(), provider.details.environment.get()])).not.toMatch(/moa|boopis-council/);
  });
  it('a read of the session info that still names the preset does not change the model either', async () => {
    const { host, provider } = await councilTurn();
    const orig = host.autoReply;
    host.autoReply = (f) => { if (f['method'] === 'session.info') host.result(f['id'], { ...MOA, cwd: '/w' }); else orig?.(f); };
    host.event('message.start', SESSION);
    host.event('message.complete', SESSION, { text: 'combined', outcome: 'completed', usage: { model: 'boopis-council' } });
    await tick(); await provider.settled(); await tick(); await provider.settled();
    expect(provider.details.governance.get().model).toBe(P + '/haiku');
    expect(provider.details.governance.get().council).toBeUndefined();   /* the turn is over: the chip is the session's model again */
  });
  it('a council a slash command started (no armed choice) never makes the preset the session\'s model', async () => {
    const { host, provider } = await setup();
    host.event('session.info', SESSION, MOA);
    host.event('session.usage', SESSION, { usage: { model: 'boopis-council' } });
    expect(provider.details.governance.get().model).toBe(P + '/haiku');
  });
});

describe('what a turn showed survives a resume', () => {
  it('a council turn is bound with its members\' answers, and read back as the same block with the combiner as the model', async () => {
    const { host } = await councilTurn();
    host.event('message.start', SESSION);
    host.event('moa.reference', SESSION, { label: P + ':opus', text: 'Use a partial index.', count: 2 });
    host.event('moa.reference', SESSION, { label: 'openai-codex:gpt-6-luna', text: '[failed: 401 token sk-secret]', count: 2 });
    host.event('moa.aggregating', SESSION, { aggregator: P + ':sonnet', refs_done: 2, refs_total: 2 });
    host.event('message.complete', SESSION, { text: 'combined', outcome: 'completed', usage: { model: 'boopis-council' }, persisted_turn: { row_ids: [2, 3], user_row_id: 2 } });
    await tick();
    const sent = host.last('plugin.boopis.turns.bind')?.['params'] as { council?: { members: { model: string; state: string; text: string }[]; combiner: string } };
    expect(sent.council).toEqual({ members: [{ model: P + '/opus', state: 'answered', text: 'Use a partial index.' }, { model: 'openai-codex/gpt-6-luna', state: 'failed', text: '' }], combiner: P + '/sonnet' });
    expect(JSON.stringify(sent)).not.toContain('sk-secret');
  });
  it('a resumed council turn draws the members, the combiner and no "waiting" member; the preset\'s name is never the model', async () => {
    const { provider } = await setup({
      messages: [{ role: 'user', row_id: 1, text: 'which index?' }, { role: 'assistant', row_id: 2, text: 'combined' }],
      turns: [{ model: 'moa/boopis-council', route: [], ungoverned: false, row_ids: [1, 2], council: { members: [{ model: P + '/opus', state: 'answered', text: 'Use a partial index.', cut: true }, { model: 'openai-codex/gpt-6-luna', state: 'failed', text: '' }, { model: 'gemini/pro', state: 'waiting', text: '' }], combiner: P + '/sonnet' } }]
    });
    const [t] = provider.sessions.conversation(SESSION).snapshot().turns.filter((x): x is AgentTurn => x.role === 'assistant');
    expect(t?.model).toBe(P + '/sonnet');
    expect(t?.why).toBe('Council of 3');
    expect(t?.council).toMatchObject({ phase: 'done', done: 1, total: 3, combiner: { provider: P, model: 'sonnet' } });
    expect(t?.council?.members.map((m) => [m.slot.model, m.state, m.text, m.cut === true])).toEqual([['opus', 'answered', 'Use a partial index.', true], ['gpt-6-luna', 'failed', '', false], ['pro', 'failed', '', false]]);
  });
  it('task cards are bound from the turn\'s subagent frames, and read back with no stop and no clock', async () => {
    const { host, provider } = await setup();
    provider.sessions.send(SESSION, 'send this to codex', META);
    await tick(); await tick(); await tick();
    host.event('message.start', SESSION);
    host.event('subagent.start', SESSION, { subagent_id: 'sa1', task_index: 0, goal: 'fix the parser', model: 'gpt-6-luna', child_session_id: 'child-1' });
    host.event('subagent.complete', SESSION, { subagent_id: 'sa1', task_index: 0, goal: 'fix the parser', model: 'gpt-6-luna', status: 'completed', summary: 'Fixed it.', duration_seconds: 12.5, tool_count: 4, child_session_id: 'child-1' });
    host.event('message.complete', SESSION, { text: 'done', outcome: 'completed', usage: { model: 'haiku' }, persisted_turn: { row_ids: [2, 3], user_row_id: 2 } });
    await tick();
    const sent = host.last('plugin.boopis.turns.bind')?.['params'] as { children?: unknown[]; council?: unknown };
    expect(sent.children).toEqual([{ model: 'gpt-6-luna', goal: 'fix the parser', status: 'done', summary: 'Fixed it.', child_session_id: 'child-1', tool_count: 4, duration_ms: 12500 }]);
    expect(sent.council).toBeUndefined();
  });
  it('resumed cards: a finished one keeps everything and can open its session, one that never ended is stopped, none can be stopped', async () => {
    const { provider } = await setup({
      messages: [{ role: 'user', row_id: 1, text: 'tasks' }, { role: 'assistant', row_id: 2, text: 'done' }],
      turns: [{ model: P + '/haiku', route: [], ungoverned: false, row_ids: [1, 2], children: [
        { model: 'gpt-6-luna', goal: 'fix the parser', status: 'done', summary: 'Fixed it.', child_session_id: 'child-1', tool_count: 4, duration_ms: 12500, cut: true },
        { model: 'gemini/pro', goal: 'write docs', status: 'running', summary: '', child_session_id: '', tool_count: 0 }
      ] }]
    });
    const [t] = provider.sessions.conversation(SESSION).snapshot().turns.filter((x): x is AgentTurn => x.role === 'assistant');
    expect(t?.model).toBe(P + '/haiku');
    const [a, b] = t?.children ?? [];
    expect(a).toMatchObject({ model: 'gpt-6-luna', goal: 'fix the parser', status: 'done', summary: 'Fixed it.', childSession: 'child-1', tools: 4, seconds: 12.5, subagentId: '', startedAt: null, cut: true });
    expect(b).toMatchObject({ status: 'stopped', startedAt: null });
    expect(new Set(t?.children?.map((c) => c.id)).size).toBe(2);
  });
  it('a mix: recorded turns draw their blocks, an unrecorded turn draws none', async () => {
    const { provider } = await setup({
      messages: [
        { role: 'user', row_id: 1, text: 'one' }, { role: 'assistant', row_id: 2, text: 'A' },
        { role: 'user', row_id: 3, text: 'two' }, { role: 'assistant', row_id: 4, text: 'B' },
        { role: 'user', row_id: 5, text: 'three' }, { role: 'assistant', row_id: 6, text: 'C' }
      ],
      turns: [
        { model: 'moa/boopis-council', route: [], ungoverned: false, row_ids: [1, 2], council: { members: [{ model: P + '/opus', state: 'answered', text: 'x' }, { model: 'openai-codex/gpt-6-luna', state: 'answered', text: 'y' }], combiner: P + '/sonnet' } },
        { model: P + '/haiku', route: [], ungoverned: false, row_ids: [3, 4] }
      ]
    });
    const agents = provider.sessions.conversation(SESSION).snapshot().turns.filter((x): x is AgentTurn => x.role === 'assistant');
    expect(agents.map((a) => [!!a.council, !!a.children, a.model])).toEqual([[true, false, P + '/sonnet'], [false, false, P + '/haiku'], [false, false, '']]);
  });
});

async function councilTurn(): Promise<Awaited<ReturnType<typeof setup>>> {
  const s = await setup();
  await s.provider.council.arm(SESSION, COUNCIL_CHOICE);
  s.provider.sessions.send(SESSION, 'which index?', META);
  await tick(); await tick(); await tick();
  return s;
}
