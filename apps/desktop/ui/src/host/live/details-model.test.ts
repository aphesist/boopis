/* Who answers next, against a fake engine and plugin: the ladder and the providers become choices, a pick or Smart's rule is applied
   through the engine's per-session model switch (config.set with --session) or, governed, the plugin's start tier, and a switch that
   fails stops the message (nobody is answered by a model nobody chose). */
import { describe, expect, it } from 'vitest';
import type { GatewayClient } from '../gateway';
import { createDetails } from './details';
import { choicesFrom, switchValue, tiersFromHost } from './models';

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

function setup(o: { governed?: boolean; ladder?: boolean; tiers?: Json[]; failSwitch?: boolean; model?: string; defaultMode?: string; frontier?: Json; hostGoverned?: Json } = {}) {
  const calls: { method: string; params: Json }[] = [];
  const client = {
    async requestRaw(method: string, params: Json): Promise<unknown> {
      calls.push({ method, params });
      switch (method) {
        case 'model.options': return OPTIONS;
        case 'session.info': return { model: o.model ?? 'haiku', provider: P, cwd: '/w' };
        case 'config.set': if (o.failSwitch) throw new Error('no such model'); return { key: 'model', value: params['value'], confirm_required: false };
        case 'plugin.boopis.describe': return { session: { session_id: 'g1', mode: o.governed ? 'governed' : 'ungoverned', locked: false, cwd: '/w' }, config: { mode: o.defaultMode ?? 'ungoverned', cost_cap_usd: 2 }, ...(o.frontier ? { frontier: o.frontier } : {}) };
        case 'plugin.boopis.cascade.state': return o.ladder === false ? { ladder: [], status: 'idle' } : { ladder: o.tiers ?? LADDER, status: 'idle' };
        case 'plugin.boopis.ledger.tail': return { events: [] };
        default: return {};
      }
    },
    request(method: string, params: Json): Promise<unknown> { return this.requestRaw(method, params); }
  };
  const d = createDetails({ client: client as unknown as GatewayClient, gwId: () => 'g1', now: () => 0, ...(o.hostGoverned ? { hostGoverned: async () => o.hostGoverned as never } : {}) });
  return { d, calls };
}
async function ready(o: Parameters<typeof setup>[0] = {}) {
  const s = setup(o);
  await s.d.start();
  s.d.source.follow('s1');
  await s.d.settled();
  return s;
}
const sets = (calls: { method: string; params: Json }[]): string[] => calls.filter((c) => c.method === 'config.set').map((c) => c.params['value'] as string);

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
  it('switches the session only: --session, with the provider', () => { expect(switchValue({ provider: P, model: 'sonnet' })).toBe('sonnet --provider ' + P + ' --session'); });
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
    expect(sets(calls)).toEqual(['sonnet --provider ' + P + ' --session']);
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
    expect(sets(calls)).toEqual(['sonnet --provider ' + P + ' --session', 'opus --provider ' + P + ' --session']);
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
    expect(sets(calls)).toEqual(['fable --provider ' + P + ' --session']);
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
  const SENTENCE = 'Claude Opus 5.5 or later, Claude Fable 5.2 or later, GPT-6.2 Astra or later, GPT-6.2 Sol or later, Gemini 4 Carbon or later, Gemini 4 Neon or later, Gemini 4 Hydrogen or later and Grok 4.7 or later';
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
