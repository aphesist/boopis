/* Who answers next, against a fake engine and plugin: the ladder and the providers become choices, a pick or Smart's rule is applied
   through the engine's model pick (`session.mutate` operation `model`, as the canonical owner gateway takes it: revision-fenced, with
   its confirmation exchange and its deferral on a running session) or, governed, the plugin's start tier, and a switch that fails stops
   the message (nobody is answered by a model nobody chose). The fake refuses `config.set {key: "model"}` as the engine does. */
import { describe, expect, it } from 'vitest';
import type { GatewayClient } from '../gateway';
import { createDetails } from './details';
import { choicesFrom, tiersFromHost } from './models';
import { GatewayError } from '../gateway';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const P = 'claude-subscription-directsdk-experimental';
const LADDER = [{ name: 'haiku', model: { provider: P, id: 'haiku' } }, { name: 'sonnet', model: { provider: P, id: 'sonnet' } }, { name: 'opus', model: { provider: P, id: 'opus' } }];
const OPTIONS = {
  model: 'haiku', provider: P,
  providers: [
    { slug: P, name: 'Claude Subscription DirectSDK (Experimental)', models: ['claude-haiku-5-5[1m]', 'claude-sonnet-5-5[1m]', 'claude-opus-5-5[1m]', 'claude-fable-5-2[1m]'], authenticated: true },
    { slug: 'openai-codex', name: 'OpenAI Codex', models: ['gpt-6-luna', 'gpt-5.1-codex-mini'], authenticated: true },
    { slug: 'gemini', name: 'Gemini', models: ['gemini-3.8-flash'], authenticated: false }
  ]
};

/* the canonical gateway's model pick, as gateway/session_mutations.py and session_mutation_model.py answer it */
interface Engine { revision: number; generation: number; running: boolean; guarded: Set<string>; refuse: boolean; receipts: Map<string, string> }
function mutate(e: Engine, params: Json): unknown {
  const fields = Object.keys(params).filter((k) => k !== 'expected_generation').sort().join(',');
  if (fields !== 'expected_revision,operation,payload,request_id,session_id' || params['operation'] !== 'model' || typeof params['expected_generation'] !== 'number') throw new GatewayError(4001, 'invalid_params', { reason: 'invalid_params' });
  const p = params['payload'] as Json;
  if (Object.keys(p).some((k) => !['model', 'provider', 'confirm', 'reasoning'].includes(k))) throw new GatewayError(4001, 'invalid_params', { reason: 'invalid_params' });
  if (e.refuse) throw new GatewayError(4001, 'model_resolution_failed', { reason: 'model_resolution_failed' });
  const fresh = { revision: e.revision, execution_generation: e.generation };
  if (params['expected_revision'] !== e.revision) throw new GatewayError(4001, 'revision_conflict', { reason: 'revision_conflict', ...fresh });
  if (params['expected_generation'] !== e.generation) throw new GatewayError(4001, 'stale_generation', { reason: 'stale_generation', ...fresh });
  const token = 'tok-' + p['model'] + '-' + e.revision;
  if (e.guarded.has(p['model']) && p['confirm'] !== token) return { session_id: 'g1', operation: 'model', status: 'confirmation_required', confirm_required: true, confirm: token, target_model: p['model'], confirm_message: p['model'] + ' costs more per token.', warnings: [{ kind: 'cost', title: 'Expensive', message: p['model'] + ' costs more per token.' }] };
  if (e.running) return { session_id: 'g1', operation: 'model', status: 'deferred', model: p['model'], ...fresh };
  e.receipts.set(params['request_id'] as string, p['model'] as string);
  e.revision++;
  return { session_id: 'g1', operation: 'model', revision: e.revision, execution_generation: e.generation };
}

function setup(o: { governed?: boolean; ladder?: boolean; tiers?: Json[]; failSwitch?: boolean; model?: string; defaultMode?: string; frontier?: Json; hostGoverned?: Json; guarded?: string[]; revision?: number; generation?: number; running?: boolean } = {}) {
  const calls: { method: string; params: Json }[] = [];
  const engine: Engine = { revision: o.revision ?? 0, generation: o.generation ?? 0, running: o.running ?? false, guarded: new Set(o.guarded ?? []), refuse: o.failSwitch ?? false, receipts: new Map() };
  const client = {
    async requestRaw(method: string, params: Json): Promise<unknown> {
      calls.push({ method, params });
      switch (method) {
        case 'model.options': return OPTIONS;
        case 'session.info': return { model: o.model ?? 'haiku', provider: P, cwd: '/w' };
        case 'config.set': if (params['key'] === 'model') throw new GatewayError(4001, 'use_session_mutation_model', { reason: 'use_session_mutation_model' }); return {};
        case 'session.mutate': return mutate(engine, params);
        case 'plugin.boopis.describe': return { session: { session_id: 'g1', mode: o.governed ? 'governed' : 'ungoverned', locked: false, cwd: '/w' }, config: { mode: o.defaultMode ?? 'ungoverned', cost_cap_usd: 2 }, ...(o.frontier ? { frontier: o.frontier } : {}) };
        case 'plugin.boopis.cascade.state': return o.ladder === false ? { ladder: [], status: 'idle' } : { ladder: o.tiers ?? LADDER, status: 'idle' };
        case 'plugin.boopis.ledger.tail': return { events: [] };
        default: return {};
      }
    },
    request(method: string, params: Json): Promise<unknown> { return this.requestRaw(method, params); }
  };
  const d = createDetails({ client: client as unknown as GatewayClient, gwId: () => 'g1', now: () => 0, ...(o.hostGoverned ? { hostGoverned: async () => o.hostGoverned as never } : {}) });
  return { d, calls, engine };
}
async function ready(o: Parameters<typeof setup>[0] = {}) {
  const s = setup(o);
  await s.d.start();
  s.d.source.follow('s1');
  await s.d.settled();
  return s;
}
/* the picks that reached the engine, as `model --provider p` (one per `session.mutate`; a retry or a confirmed resend is another) */
const sets = (calls: { method: string; params: Json }[]): string[] => calls.filter((c) => c.method === 'session.mutate').map((c) => { const p = c.params['payload'] as Json; return p['model'] + (p['provider'] ? ' --provider ' + p['provider'] : ''); });

describe('choicesFrom', () => {
  const ladder = LADDER.map((t) => ({ name: t.name, provider: t.model.provider, id: t.model.id }));
  const c = choicesFrom(OPTIONS, ladder);
  it('lists the ladder first, with its tiers', () => {
    expect(c.slice(0, 3).map((x) => [x.value, x.tier, x.tierName])).toEqual([[P + '/haiku', 0, 'haiku'], [P + '/sonnet', 1, 'sonnet'], [P + '/opus', 2, 'opus']]);
    expect(c[0]?.providerName).toBe('Claude subscription');
  });
  it('folds the pinned id of a tier into the tier, keeps the rest, and leaves out a provider that is not signed in', () => {
    expect(c.map((x) => x.model)).toEqual(['haiku', 'sonnet', 'opus', 'claude-fable-5-2[1m]', 'gpt-6-luna', 'gpt-5.1-codex-mini']);
    expect(c.find((x) => x.provider === 'openai-codex')?.providerName).toBe('ChatGPT subscription');
  });
  it('reads the host\'s saved ladder, splitting the provider at the first slash', () => {
    expect(tiersFromHost([{ name: 'a', model: 'p/x/y' }])).toEqual([{ name: 'a', provider: 'p', id: 'x/y' }]);
  });
});

describe('who answers next', () => {
  it('the choices are the ladder and the signed-in providers once a session is followed', async () => {
    const { d } = await ready();
    expect(d.source.choices.get().map((c) => c.value)).toContain(P + '/opus');
    expect(d.source.choices.get().some((c) => c.provider === 'gemini')).toBe(false);
  });
  it('the chip starts on the engine\'s own model', async () => {
    const { d } = await ready();
    expect(d.source.governance.get().model).toBe(P + '/haiku');
  });
  it('a pick is switched once, for this session only, before the message goes', async () => {
    const { d, calls } = await ready();
    expect(d.source.setGovernance({ model: P + '/sonnet' })).toBeNull();
    expect(d.source.governance.get().model).toBe(P + '/sonnet');
    expect(await d.prepareSend('s1', 'hello')).toEqual({ model: P + '/sonnet', why: null });
    expect(sets(calls)).toEqual(['sonnet --provider ' + P + '']);
    await d.prepareSend('s1', 'again');
    expect(sets(calls)).toHaveLength(1);
  });
  it('a pick of the model already answering switches nothing', async () => {
    const { d, calls } = await ready();
    d.source.setGovernance({ model: P + '/haiku' });
    await d.prepareSend('s1', 'hello');
    expect(sets(calls)).toEqual([]);
  });
  it('with nothing chosen the engine\'s model answers and nothing is switched', async () => {
    const { d, calls } = await ready();
    expect(await d.prepareSend('s1', 'hello')).toEqual({ model: '', why: null });
    expect(sets(calls)).toEqual([]);
  });
  it('Smart picks the tier for each message and says why', async () => {
    const { d, calls } = await ready();
    expect(d.source.setGovernance({ smart: true })).toBeNull();
    expect(d.source.governance.get().smart).toBe(true);
    expect(await d.prepareSend('s1', 'rename this label')).toEqual({ model: P + '/haiku', why: 'Smart: a short, plain request' });
    expect(await d.prepareSend('s1', 'debug why the login test is flaky')).toEqual({ model: P + '/sonnet', why: 'Smart: debugging' });
    expect(await d.prepareSend('s1', 'design the sync layer')).toEqual({ model: P + '/opus', why: 'Smart: design work' });
    expect(sets(calls)).toEqual(['sonnet --provider ' + P + '', 'opus --provider ' + P + '']);
  });
  it('Smart has no ladder to choose from: it says so instead of guessing', async () => {
    const { d } = await ready({ ladder: false });
    expect(d.source.setGovernance({ smart: true })).toMatch(/none is known/);
    expect(d.source.governance.get().smart).toBe(false);
  });
  it('a failed switch stops the message and says which model', async () => {
    const { d } = await ready({ failSwitch: true });
    d.source.setGovernance({ model: P + '/opus' });
    await expect(d.prepareSend('s1', 'hello')).rejects.toThrow(/could not be switched to Claude Opus.*not sent/);
  });
  it('choosing a model turns Smart off', async () => {
    const { d } = await ready();
    d.source.setGovernance({ smart: true });
    d.source.setGovernance({ smart: false, model: P + '/opus' });
    expect(d.source.governance.get()).toMatchObject({ smart: false, model: P + '/opus' });
  });
  it('failures of the last turns raise Smart\'s level', async () => {
    const { d } = await ready();
    d.source.setGovernance({ smart: true });
    d.onEvent('s1', { type: 'message.start', payload: {} });
    d.onEvent('s1', { type: 'tool.complete', payload: { is_error: true } });
    d.onEvent('s1', { type: 'message.complete', payload: { outcome: 'completed', usage: { model: 'haiku' } } });
    expect((await d.prepareSend('s1', 'try again')).why).toBe('Smart: the last turn failed');
  });
});

describe('the sticky pick is the engine\'s session.mutate (never config.set)', () => {
  it('sends the canonical request: a request id, the fences, operation model, the model and its provider', async () => {
    const { d, calls } = await ready();
    d.onHandle('s1', { revision: 0, execution_generation: 0 });
    d.source.setGovernance({ model: 'openai-codex/gpt-6-luna' });
    await d.prepareSend('s1', 'hello');
    const m = calls.find((c) => c.method === 'session.mutate');
    expect(m?.params).toMatchObject({ session_id: 'g1', expected_revision: 0, expected_generation: 0, operation: 'model', payload: { model: 'gpt-6-luna', provider: 'openai-codex' } });
    expect(typeof m?.params['request_id']).toBe('string');
    expect(calls.some((c) => c.method === 'config.set')).toBe(false);
    expect(d.source.governance.get().model).toBe('openai-codex/gpt-6-luna');
  });
  it('a pick on stale fences is retried once with the ones the refusal carries, under the same request id', async () => {
    const { d, calls } = await ready({ revision: 7, generation: 3 });
    d.source.setGovernance({ model: P + '/sonnet' });
    expect(await d.prepareSend('s1', 'hello')).toEqual({ model: P + '/sonnet', why: null });
    const m = calls.filter((c) => c.method === 'session.mutate').map((c) => c.params);
    expect(m.map((x) => [x['expected_revision'], x['expected_generation']])).toEqual([[0, 0], [7, 3]]);
    expect(m[0]?.['request_id']).toBe(m[1]?.['request_id']);
    /* the receipt's revision is kept: the next pick is fenced right the first time, with a new request id */
    d.source.setGovernance({ model: P + '/opus' });
    await d.prepareSend('s1', 'again');
    const next = calls.filter((c) => c.method === 'session.mutate').map((c) => c.params).at(-1);
    expect([next?.['expected_revision'], next?.['expected_generation']]).toEqual([8, 3]);
    expect(next?.['request_id']).not.toBe(m[0]?.['request_id']);
  });
  it('the generation an event carries is the one the pick is fenced with', async () => {
    const { d, calls } = await ready({ generation: 5 });
    d.onEvent('s1', { type: 'message.start', payload: {}, execution_generation: 5 });
    d.onEvent('s1', { type: 'message.complete', payload: { outcome: 'completed' }, execution_generation: 5 });
    d.source.setGovernance({ model: P + '/sonnet' });
    await d.prepareSend('s1', 'hello');
    expect(calls.filter((c) => c.method === 'session.mutate').map((c) => c.params['expected_generation'])).toEqual([5]);
  });
  it('a guarded model asks the person first: nothing is switched, the message is not sent, and choosing it again sends the engine\'s token', async () => {
    const { d, calls, engine } = await ready({ guarded: ['opus'] });
    d.source.setGovernance({ model: P + '/opus' });
    await expect(d.prepareSend('s1', 'hello')).rejects.toThrow(/Switching to Claude Opus needs your confirmation: opus costs more per token\. To switch anyway, choose Claude Opus in the model menu again and send the message again\. The message was not sent\./);
    expect(engine.receipts.size).toBe(0);
    /* sending again without choosing it again asks again: a send is not a yes */
    await expect(d.prepareSend('s1', 'hello')).rejects.toThrow(/needs your confirmation/);
    expect(calls.filter((c) => c.method === 'session.mutate').every((c) => !('confirm' in (c.params['payload'] as Json)))).toBe(true);
    d.source.setGovernance({ model: P + '/opus' });
    expect(await d.prepareSend('s1', 'hello')).toEqual({ model: P + '/opus', why: null });
    const m = calls.filter((c) => c.method === 'session.mutate').map((c) => c.params);
    expect(m.at(-1)?.['payload']).toEqual({ model: 'opus', provider: P, confirm: 'tok-opus-0' });
    expect(new Set(m.map((x) => x['request_id'])).size).toBe(1);   /* one pick: one request id through the exchange */
    expect([...engine.receipts.values()]).toEqual(['opus']);
  });
  it('choosing another model drops the confirmation: its token is never sent for a different pick', async () => {
    const { d, calls } = await ready({ guarded: ['opus', 'sonnet'] });
    d.source.setGovernance({ model: P + '/opus' });
    await expect(d.prepareSend('s1', 'hello')).rejects.toThrow(/confirmation/);
    d.source.setGovernance({ model: P + '/sonnet' });
    await expect(d.prepareSend('s1', 'hello')).rejects.toThrow(/Switching to Claude Sonnet needs your confirmation/);
    expect(calls.filter((c) => c.method === 'session.mutate').some((c) => 'confirm' in (c.params['payload'] as Json))).toBe(false);
  });
  it('a pick while a turn runs is deferred by the engine to the next turn, and the turn says so instead of claiming the switch', async () => {
    const { d } = await ready({ running: true });
    d.source.setGovernance({ model: P + '/sonnet' });
    expect(await d.prepareSend('s1', 'hello')).toEqual({ model: P + '/sonnet', why: 'Claude Sonnet answers from the next turn: the turn that is running keeps its model' });
  });
  it('a deferred pick the engine later refuses is made again with the next message', async () => {
    const { d, calls, engine } = await ready({ running: true });
    d.source.setGovernance({ model: P + '/sonnet' });
    await d.prepareSend('s1', 'hello');
    await d.prepareSend('s1', 'again');
    expect(sets(calls)).toHaveLength(1);
    d.onEvent('s1', { type: 'session.updated', payload: { operation: 'model', status: 'refused', reason: 'model_resolution_failed', target_model: 'sonnet', model: 'haiku' } });
    engine.running = false;
    await d.prepareSend('s1', 'third');
    expect(sets(calls)).toHaveLength(2);
  });
  it('a refusal of the engine stops the message', async () => {
    const { d } = await ready({ failSwitch: true });
    d.source.setGovernance({ model: P + '/sonnet' });
    await expect(d.prepareSend('s1', 'hello')).rejects.toThrow(/could not be switched to Claude Sonnet.*not sent/);
  });
});

describe('Smart never picks a heavy model (ADR-0037)', () => {
  const FABLE_TIER = { name: 'fable', model: { provider: P, id: 'fable' } };
  const WITH_FABLE = [...LADDER, FABLE_TIER];
  const MESSAGES = ['hello', 'rename this label', 'debug why the login test is flaky', 'design the sync layer', 'x '.repeat(900), 'a\n```\n' + 'l\n'.repeat(60) + '```'];

  it('spreads its levels over the tiers that are not heavy: a ladder with Fable on top still starts on Opus at its highest', async () => {
    const { d, calls } = await ready({ tiers: WITH_FABLE });
    d.source.setGovernance({ smart: true });
    const picked: string[] = [];
    for (const text of MESSAGES) picked.push((await d.prepareSend('s1', text)).model);
    expect(picked.length).toBe(MESSAGES.length);
    expect(picked.every((v) => v.startsWith(P + '/') && !v.endsWith('/fable')), picked.join()).toBe(true);
    expect(picked).toContain(P + '/opus');
    expect(sets(calls).some((v) => v.startsWith('fable'))).toBe(false);
  });
  it('governed, the start tier is never the heavy one (a failed gate may still climb to it: that is the user\'s ladder)', async () => {
    const { d, calls } = await ready({ governed: true, tiers: WITH_FABLE });
    d.source.setGovernance({ smart: true });
    for (const text of MESSAGES) await d.prepareSend('s1', text);
    const starts = calls.filter((c) => c.method === 'plugin.boopis.cascade.start_tier').map((c) => c.params['start_tier']);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts).not.toContain('fable');
  });
  it('the user\'s own pick of the heavy tier is theirs and is applied as it is', async () => {
    const { d, calls } = await ready({ tiers: WITH_FABLE });
    expect(d.source.setGovernance({ model: P + '/fable' })).toBeNull();
    expect(await d.prepareSend('s1', 'hello')).toEqual({ model: P + '/fable', why: null });
    expect(sets(calls)).toEqual(['fable --provider ' + P + '']);
  });
  it('a ladder of heavy tiers alone gives Smart nothing to choose from, and it says so', async () => {
    const { d } = await ready({ tiers: [FABLE_TIER] });
    expect(d.source.setGovernance({ smart: true })).toMatch(/every tier of it is a heavy model/);
    expect(d.source.governance.get().smart).toBe(false);
  });
});

describe('who answers next, governed', () => {
  it('a pick on the ladder is where the ladder starts, and the plugin is told', async () => {
    const { d, calls } = await ready({ governed: true });
    expect(d.source.setGovernance({ model: P + '/sonnet' })).toBeNull();
    expect(await d.prepareSend('s1', 'hello')).toEqual({ model: P + '/sonnet', why: null });
    expect(calls.filter((c) => c.method === 'plugin.boopis.cascade.start_tier').map((c) => c.params)).toEqual([{ session_id: 'g1', start_tier: 'sonnet' }]);
    expect(sets(calls)).toEqual([]);
  });
  it('a model off the ladder cannot be picked', async () => {
    const { d } = await ready({ governed: true });
    expect(d.source.setGovernance({ model: 'openai-codex/gpt-6-luna' })).toMatch(/ladder runs the work/);
  });
  it('Smart picks the starting tier', async () => {
    const { d, calls } = await ready({ governed: true });
    d.source.setGovernance({ smart: true });
    expect(await d.prepareSend('s1', 'design the sync layer')).toEqual({ model: P + '/opus', why: 'Smart: design work' });
    expect(calls.some((c) => c.method === 'plugin.boopis.cascade.start_tier' && c.params['start_tier'] === 'opus')).toBe(true);
  });
});

describe('governed mode needs a frontier model (ADR-0037)', () => {
  const SENTENCE = 'Claude Opus 5.5 or later, Claude Fable 5.2 or later, GPT-6.1 Terra or later, GPT-6.2 Astra or later, GPT-6.2 Sol or later, Gemini 4 Carbon or later, Gemini 4 Neon or later, Gemini 4 Hydrogen or later and Grok 4.7 or later';
  const NO = { allowed: ['Claude Opus 5.5'], sentence: SENTENCE, available: false, why: 'Governed mode runs only on frontier models, and tier \'free\' runs nous/welcome, which is not one.' };
  const OK = { allowed: ['Claude Opus 5.5'], sentence: SENTENCE, available: true, why: null };

  it('a new session does not start governed when the plugin says no frontier model can run, and the state says why', async () => {
    const { d } = await ready({ defaultMode: 'governed', frontier: NO });
    expect(d.governedAtCreation('new-1')).toBe(false);
    const g = d.source.governance.get();
    expect(g.governed).toBe(false);
    expect(g.frontier?.available).toBe(false);
    expect(g.frontier?.why).toContain('nous/welcome');
    expect(g.frontier?.sentence).toBe(SENTENCE);
  });
  it('the host\'s word counts too: a saved ladder with a cheap tier, or no key for the built-in ladder', async () => {
    const { d } = await ready({ defaultMode: 'governed', frontier: OK, hostGoverned: { available: false, why: 'tier \'haiku\' runs a/b, which is not a frontier model', sentence: SENTENCE, allowed: ['Claude Opus 5.5'] } });
    expect(d.governedAtCreation('new-1')).toBe(false);
    expect(d.source.governance.get().frontier?.why).toContain('tier \'haiku\'');
  });
  it('turning governed on is refused with the reason while it cannot run, and allowed again when it can', async () => {
    const no = await ready({ defaultMode: 'governed', frontier: NO });
    expect(no.d.source.setGovernance({ governed: true })).toContain('Governed mode runs only on frontier models (' + SENTENCE + ')');
    expect(no.d.source.setGovernance({ governed: false })).toBeNull();
    const yes = await ready({ defaultMode: 'governed', frontier: OK });
    expect(yes.d.governedAtCreation('new-1')).toBe(true);
    expect(yes.d.source.governance.get().frontier).toBeUndefined();
    expect(yes.d.source.setGovernance({ governed: true })).toBeNull();
  });
  it('a session whose own model is not frontier is refused, with the plugin\'s sentence', async () => {
    const f = { ...OK, session_model: { provider: 'anthropic', model: 'claude-sonnet-5-5', frontier: false, why: 'this session runs anthropic/claude-sonnet-5-5, which is not one' } };
    const { d } = await ready({ governed: true, frontier: f });
    expect(d.source.governance.get().frontier?.why).toContain('claude-sonnet-5-5');
  });
  it('an older plugin that says nothing about it leaves governed mode as it was', async () => {
    const { d } = await ready({ defaultMode: 'governed' });
    expect(d.governedAtCreation('new-1')).toBe(true);
    expect(d.source.governance.get().frontier).toBeUndefined();
  });
});
