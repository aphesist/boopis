// @vitest-environment jsdom
/* The free tier on the UI side: what Hermes reports becomes the plan view and the limit notice, and nothing else does. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorSurface, FreeTierStatusResult, ModelOptionsResult } from '../vendor/hermes-shared/gateway-contract.generated';
import { currentPlan, inWords, limitFromSurface, loadPlan, planLines, planView, registerPlanSource, rememberLimit, resetLimitMemory, resetText } from './free-tier';
import { LIMIT_CHOICES, fromFreeTierLimit, replyFor } from './forms';
import { createFormsHost } from './live/forms';
import type { FormEntry } from './live/forms';
import { planRows, planSection, mountPlan } from './plan-view';
import { reportText } from './renderer';
import type { GatewayClient, GatewayEvent } from './gateway';

const NOW = 1_800_000_000_000;
const status = (over: Partial<FreeTierStatusResult> = {}): FreeTierStatusResult => ({ has_guest: true, enabled: true, available: true, notice_pending: false, model: 'nous/welcome', label: 'Nous · free tier', ...over });
const surface = (over: Record<string, unknown> = {}): ErrorSurface => ({ layer: 'provider', code: 'free_tier_rate_limited', retryable: true, message: "You've used up the allowance for chatting without signing in. It refreshes in about 5 minutes.", resets_at: NOW / 1000 + 300, ...over }) as ErrorSurface;

beforeEach(() => { resetLimitMemory(); registerPlanSource(null); });

describe('the plan view', () => {
  it('names the plan, the one model and says no usage figures are sent for it', () => {
    const v = planView({ status: status(), options: null, limit: null }, NOW);
    expect(v).toMatchObject({ kind: 'free', state: 'ready', label: 'Nous · free tier', model: 'nous/welcome' });
    expect(v.detail).toContain('one model, nous/welcome, no account');
    expect(v.gauges).toEqual([]);
    expect(v.gaugesNote).toMatch(/No usage figures are reported/);
  });
  it('shows gauges only where Hermes sent them, from the fraction it sent, in its order', () => {
    const options: ModelOptionsResult = { providers: [{ slug: 'nous', name: 'Nous', plan_usage: { kind: 'window', gauges: [{ label: 'day', left_fraction: 0.75, style: 'ok', resets_at_ms: NOW + 3_600_000, title: 'Today' }, { label: 'week', left_fraction: 0.2, style: 'warn' }] } }, { slug: 'x', name: 'X' }] };
    const v = planView({ status: status(), options, limit: null }, NOW);
    expect(v.gauges).toEqual([{ provider: 'Nous', title: 'Today', usedPercent: 25, resetsAtMs: NOW + 3_600_000 }, { provider: 'Nous', title: 'week', usedPercent: 80, resetsAtMs: null }]);
    expect(v.gaugesNote).toBeNull();
  });
  it('says not claimable, claimable and failed in Hermes words without a number it was not given', () => {
    expect(planView({ status: status({ available: false, enabled: false }), options: null, limit: null }).state).toBe('unavailable');
    expect(planView({ status: status({ available: false, enabled: true }), options: null, limit: null }).state).toBe('claimable');
    const failed = planView({ status: status({ available: false, error: 'Lots of people are getting started right now', retry_after: 300 }), options: null, limit: null });
    expect(failed.state).toBe('failed');
    expect(failed.detail).toBe('Lots of people are getting started right now. It suggests trying again in about 5 minutes.');
    const unknown = planView({ status: null, options: null, limit: null });
    expect(unknown).toMatchObject({ kind: 'unknown', model: null });
  });
  it('carries the last limit and when Hermes says it lifts, and a pending browser check', () => {
    const limit = limitFromSurface(surface());
    expect(limit).toEqual({ code: 'free_tier_rate_limited', message: expect.stringContaining('allowance') as string, resetsAtMs: NOW + 300_000 });
    const v = planView({ status: status({ challenge: { type: 'browser', url: 'https://portal.nousresearch.com/challenge/x', required: true, expires_in: 300, message: 'm' } }), options: null, limit }, NOW);
    expect(v.checking).toBe(true);
    expect(v.detail).toContain('in about 5 minutes');
  });
  it('words a wait and a reset the way a person reads them', () => {
    expect(inWords(20_000)).toBe('in under a minute');
    expect(inWords(300_000)).toBe('in about 5 minutes');
    expect(inWords(2 * 3_600_000)).toBe('in about 2 hours');
    expect(resetText(null, NOW)).toBe('');
    expect(resetText(NOW - 1, NOW)).toBe('It should lift shortly.');
    expect(resetText(NOW + 300_000, NOW)).toContain('in about 5 minutes');
  });
});

describe('a limit from a refused turn', () => {
  it('is read only from a free-tier code or a usage-window limit; any other failure is not a limit', () => {
    expect(limitFromSurface(null)).toBeNull();
    expect(limitFromSurface(surface({ code: 'rate_limit', message: undefined }))).toBeNull();
    const usage = limitFromSurface(surface({ code: 'usage_window', usage_limit: { gauge_id: 'day', scope: 'all', limit_name: 'daily', message: 'You hit your daily limit', resets_at_ms: NOW + 1000 } }));
    expect(usage).toEqual({ code: 'usage_day', message: 'You hit your daily limit', resetsAtMs: NOW + 1000 });
    expect(limitFromSurface(surface({ resets_at: undefined }))?.resetsAtMs).toBeNull();
  });
});

describe('the notice and its choices', () => {
  const limit = (): NonNullable<ReturnType<typeof limitFromSurface>> => limitFromSurface(surface()) as NonNullable<ReturnType<typeof limitFromSurface>>;
  it('is a choice form with Hermes sentence, when it lifts, and the other way on; no number is invented', () => {
    const f = fromFreeTierLimit(limit(), 's1:7', NOW);
    expect(f).toMatchObject({ kind: 'choice', title: 'The free allowance is used up for now', cancelLabel: 'Dismiss', source: { kind: 'free-tier' } });
    expect(f.body).toContain("You've used up the allowance");
    expect(f.body).toContain('in about 5 minutes');
    expect(f.fields[0]?.options).toEqual([...LIMIT_CHOICES]);
    expect(f.fields[0]?.optionNames).toEqual(['Choose another model', 'Wait until it lifts']);
    expect(replyFor(f, { cancelled: false, values: { choice: 'choose' } }), 'answered by the host, never sent to the gateway').toBeNull();
  });
  it('is raised by a refused turn, remembered for Settings, and "choose" runs the host while "wait" does nothing', async () => {
    const opened: FormEntry[] = [];
    const chosen: string[] = [];
    const host = createFormsHost({
      client: { requestRaw: () => Promise.resolve({}) } as unknown as GatewayClient, secrets: { set: () => Promise.resolve() },
      hooks: { opened: (e) => { opened.push(e); }, resolved: () => undefined }, onFreeTierChoice: (c) => { chosen.push(c); return Promise.resolve(); }
    });
    const turn = (seq: number, error_surface: unknown): GatewayEvent => ({ type: 'message.complete', session_id: 'g1', seq, payload: { status: 'error', error_surface } });
    expect(host.handle(turn(1, surface({ code: 'rate_limit' })), { gwSession: 'g1', model: 'm' }), 'a turn is never "a form event"').toBe(false);
    expect(opened).toHaveLength(0);
    expect(host.handle(turn(2, surface()), { gwSession: 'g1', model: 'm' })).toBe(false);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.spec.title).toBe('The free allowance is used up for now');
    expect(host.handle(turn(2, surface()), { gwSession: 'g1', model: 'm' })).toBe(false);
    expect(opened, 'the same refusal twice raises one notice').toHaveLength(1);
    await host.source.submit(opened[0]?.spec.id ?? '', { values: { choice: 'choose' }, secrets: {} });
    expect(chosen).toEqual(['choose']);
    host.handle(turn(3, surface()), { gwSession: 'g1', model: 'm' });
    await host.source.submit(opened[1]?.spec.id ?? '', { values: { choice: 'wait' }, secrets: {} });
    expect(chosen).toEqual(['choose', 'wait']);   // the host's handler decides that 'wait' is nothing
    expect(host.openIds()).toEqual([]);
  });
});

describe('loading the plan', () => {
  it('asks Hermes for the status and the catalogue, and leaves out what it cannot answer', async () => {
    const asked: string[] = [];
    const client = { request: vi.fn((m: string) => { asked.push(m); return m === 'free_tier.status' ? Promise.resolve(status()) : Promise.reject(new Error('no catalogue')); }) } as unknown as Pick<GatewayClient, 'request'>;
    rememberLimit(limitFromSurface(surface()));
    const v = await loadPlan(client, NOW);
    expect(asked).toEqual(['free_tier.status', 'model.options']);
    expect(v.kind).toBe('free');
    expect(v.limit?.code).toBe('free_tier_rate_limited');
    expect(v.gauges).toEqual([]);
  });
  it('is null when no live connection registered a way to ask', async () => {
    expect(await currentPlan()).toBeNull();
    registerPlanSource(() => Promise.reject(new Error('down')));
    expect(await currentPlan()).toBeNull();
  });
});

describe('where it is shown', () => {
  const base = { session: 'x11', hyprland: false, gpus: [], set: [], environment: [], webkit: { version: null, origin: null, library: null }, frame_rate: { policy: 'auto', refresh_millihertz: null, monitor: null, preference_off: null, refusal: null, rule: null, power_profile: 'balanced', platform_profile: null }, gpu: { policy: 'auto', policy_source: 'default', rule: 'r', set: [], env_source: null, display_gpu: null, dedicated_gpu: null, power: 'ac', warning: null, restart_advice: null }, policy: 'auto', rule: 'r', note: null, choices: [] } as unknown as Parameters<typeof reportText>[0];
  const display = { devicePixelRatio: 1, innerWidth: 100, innerHeight: 100, userAgent: 'ua' };
  it('Diagnostics: the report says the plan, the model and the last limit as text, one fact a line', () => {
    const plan = planView({ status: status(), options: null, limit: limitFromSurface(surface()) }, NOW);
    const text = reportText({ ...base, plan }, display);
    expect(text).toContain('models plan: free (ready), Nous · free tier, model nous/welcome');
    expect(text).toContain('No usage figures are reported for this plan');
    expect(text).toContain('last limit: free_tier_rate_limited');
    expect(reportText(base, display), 'without a live connection the report is as it was').not.toContain('models plan');
    expect(planLines(plan, NOW).every((l) => !l.includes('undefined'))).toBe(true);
  });
  it('Settings: rows with the plan, the model, the limit with its reset and the empty-gauge note', () => {
    const plan = planView({ status: status(), options: null, limit: limitFromSurface(surface()) }, NOW);
    const html = JSON.stringify(planRows(plan, NOW));
    for (const word of ['Plan', 'Free (Nous · free tier)', 'Model', 'nous/welcome', 'Limit', 'rate limited', 'in about 5 minutes', 'Usage']) expect(html).toContain(word);
    const sec = planSection(plan, NOW);
    expect(sec.querySelector('.k7-shead__title')?.textContent).toBe('Plan');
    expect(sec.querySelector('[data-kit~="Card"]')).not.toBeNull();
  });
  it('Settings: mounting asks Hermes, redraws on refresh and says so when Hermes cannot be asked', async () => {
    const panel = document.createElement('div');
    let answer: ReturnType<typeof planView> | null = null;
    const mounted = await mountPlan(panel, () => Promise.resolve(answer));
    expect(panel.textContent).toContain('boopis\'s engine is not connected');
    answer = planView({ status: status(), options: null, limit: null }, NOW);
    await mounted.refresh();
    expect(panel.querySelectorAll('section')).toHaveLength(1);
    expect(panel.textContent).toContain('nous/welcome');
  });
});
