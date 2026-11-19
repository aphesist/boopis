/* The free tier as the person sees it: what plan they are on, which model, what Hermes says about limits and when they
   lift. Everything is what Hermes reports (`free_tier.status`, `model.options`, a turn's `error_surface`) and nothing is
   invented: for the anonymous free tier Hermes sends no usage figures (its gauges belong to paid window plans), and the view
   says so instead of drawing a bar. Pure functions plus one loader; no DOM (plan-view.ts draws). */
import type { ErrorSurface, FreeTierStatusResult, ModelOptionsResult, PlanUsageGauge } from '../vendor/hermes-shared/gateway-contract.generated';
import type { GatewayClient } from './gateway';

/** one gauge as Hermes sends it, in the server's order: how much is used and when it resets */
export interface GaugeView { provider: string; title: string; usedPercent: number; resetsAtMs: number | null }
/** a limit Hermes named after a refused turn */
export interface LimitView { code: string; message: string; resetsAtMs: number | null }
export type PlanKind = 'free' | 'none' | 'unknown';
export type PlanState = 'ready' | 'claimable' | 'unavailable' | 'failed' | 'unknown';
export interface PlanView {
  kind: PlanKind;
  state: PlanState;
  /** Hermes's name for the plan ("Nous · free tier"), '' when it named none */
  label: string;
  model: string | null;
  /** one honest sentence about where things stand */
  detail: string;
  gauges: readonly GaugeView[];
  /** said when there are no gauges, so an empty space is not read as "unlimited" */
  gaugesNote: string | null;
  limit: LimitView | null;
  /** a browser check the account service is waiting on */
  checking: boolean;
}

/** "in about 5 minutes", "in about 2 hours": a wait in words, never a raw count of seconds */
export function inWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'in under a minute';
  if (s < 90 * 60) return `in about ${String(Math.round(s / 60))} minutes`;
  const h = Math.round(s / 3600);
  return h <= 1 ? 'in about an hour' : h < 48 ? `in about ${String(h)} hours` : `in about ${String(Math.round(h / 24))} days`;
}
const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** when a limit lifts, as Hermes said it; '' when Hermes did not say */
export function resetText(resetsAtMs: number | null, now: number): string {
  return resetsAtMs === null ? '' : resetsAtMs <= now ? 'It should lift shortly.' : `Hermes says it lifts ${inWords(resetsAtMs - now)}, at ${clock(resetsAtMs)}.`;
}

const FREE_TITLES: Readonly<Record<string, string>> = {
  free_tier_rate_limited: 'The free allowance is used up for now',
  free_tier_at_capacity: 'The free model is busy',
  free_tier_outage: 'The free model is not answering',
  free_tier_model_not_free: 'That model is not on the free tier',
  free_tier_feature_not_free: 'That is not on the free tier',
  free_tier_admission_closed: 'The free tier is full right now'
};
export const limitTitle = (code: string): string => FREE_TITLES[code] ?? (code.startsWith('usage_') ? 'A usage limit was reached' : 'The free tier stopped this turn');

/** the limit a refused turn names, from its `error_surface`; null for any other failure. Epoch seconds become milliseconds. */
export function limitFromSurface(s: ErrorSurface | null | undefined): LimitView | null {
  if (!s) return null;
  const message = typeof s['message'] === 'string' ? s['message'] : '';
  const sec = typeof s.resets_at === 'number' && Number.isFinite(s.resets_at) ? s.resets_at : null;
  if (s.code.startsWith('free_tier_')) return { code: s.code, message, resetsAtMs: sec === null ? null : Math.round(sec * 1000) };
  const u = s.usage_limit;
  if (u) return { code: 'usage_' + u.gauge_id, message: u.message, resetsAtMs: typeof u.resets_at_ms === 'number' ? u.resets_at_ms : sec === null ? null : Math.round(sec * 1000) };
  return null;
}

export function gaugesOf(options: ModelOptionsResult | null | undefined): GaugeView[] {
  const out: GaugeView[] = [];
  for (const row of options?.providers ?? []) {
    for (const g of (row.plan_usage?.gauges ?? []) as PlanUsageGauge[]) {
      out.push({ provider: row.name, title: g.title ?? g.label, usedPercent: Math.round((1 - Math.min(1, Math.max(0, g.left_fraction))) * 100), resetsAtMs: g.resets_at_ms ?? null });
    }
  }
  return out;
}

export interface PlanInput { status: FreeTierStatusResult | null; options: ModelOptionsResult | null; limit: LimitView | null }

/** what to say about the plan: Hermes's own words and numbers, and where it said nothing, that it said nothing */
export function planView({ status, options, limit }: PlanInput, now = Date.now()): PlanView {
  const gauges = gaugesOf(options);
  const note = gauges.length ? null : 'Hermes reports no usage figures for this plan. Its limits show here when one is reached.';
  const base = { gauges, gaugesNote: note, limit, checking: !!status?.challenge, label: status?.label ?? '', model: status?.model ?? null };
  if (!status) return { ...base, kind: 'unknown', state: 'unknown', detail: 'Hermes did not report the plan.', gaugesNote: gauges.length ? null : 'Hermes reported no usage figures.', model: null };
  if (status.error && !status.available) {
    const wait = status.retry_after ? ` It suggests trying again ${inWords(status.retry_after * 1000)}.` : '';
    return { ...base, kind: 'none', state: 'failed', detail: `${status.error}.${wait}`.replace(/\.\./g, '.'), gaugesNote: null };
  }
  if (status.available) return { ...base, kind: 'free', state: 'ready', detail: `${status.label || 'Free tier'}: one model${status.model ? `, ${status.model}` : ''}, no account.` + (limit ? ` ${limitTitle(limit.code)}.${limit.message ? ' ' + limit.message : ''} ${resetText(limit.resetsAtMs, now)}`.trimEnd() : '') };
  if (status.enabled) return { ...base, kind: 'none', state: 'claimable', detail: 'The free tier is not set up yet. Choose it in setup.', gaugesNote: null };
  return { ...base, kind: 'none', state: 'unavailable', detail: 'The free tier is not in use here.', gaugesNote: null };
}

/** the last limit a turn named, kept so Settings and Diagnostics can show it after the notice is gone */
let last: LimitView | null = null;
export const rememberLimit = (l: LimitView | null): void => { if (l) last = l; };
export const lastLimit = (): LimitView | null => last;
export const resetLimitMemory = (): void => { last = null; };

type Asker = Pick<GatewayClient, 'request'>;
/** ask Hermes; a question it cannot answer leaves that part out (it is shown as unknown, not guessed) */
export async function loadPlan(client: Asker, now = Date.now()): Promise<PlanView> {
  const [status, options] = await Promise.allSettled([client.request('free_tier.status', {}), client.request('model.options', {})]);
  return planView({ status: status.status === 'fulfilled' ? status.value : null, options: options.status === 'fulfilled' ? options.value : null, limit: last }, now);
}

/** the plan lines of the Diagnostics report: one fact a line */
export function planLines(p: PlanView, now = Date.now()): string[] {
  const out = [`models plan: ${p.kind}${p.state === 'unknown' ? '' : ` (${p.state})`}${p.label ? `, ${p.label}` : ''}${p.model ? `, model ${p.model}` : ''}`, `  ${p.detail}`];
  if (p.checking) out.push('  a browser check from the account service is running');
  for (const g of p.gauges) out.push(`  ${g.provider} ${g.title}: ${String(g.usedPercent)}% used${g.resetsAtMs === null ? '' : `, resets ${inWords(g.resetsAtMs - now)}`}`);
  if (p.gaugesNote) out.push(`  ${p.gaugesNote}`);
  if (p.limit) out.push(`  last limit: ${p.limit.code}${p.limit.message ? `: ${p.limit.message}` : ''}${p.limit.resetsAtMs === null ? '' : `; ${resetText(p.limit.resetsAtMs, now)}`}`);
  return out;
}

/** where the live connection says how to ask Hermes about the plan (registered when it connects) */
let source: (() => Promise<PlanView>) | null = null;
export const registerPlanSource = (fn: (() => Promise<PlanView>) | null): void => { source = fn; };
export async function currentPlan(): Promise<PlanView | null> {
  if (!source) return null;
  try { return await source(); } catch { return null; }
}
