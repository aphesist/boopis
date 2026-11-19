/* Pure mappings from gateway and plugin results to the details entities (`data/types.ts`). No state and no I/O, so each
   is tested against recorded frames. A value the sender did not give is `null`, empty or "unknown" (AGENTS.md
   invariant 5, ADR-0012): nothing here computes a cost (the plugin does, from tokens) or invents a name. */
import type { Change, ContextUsage, Connector, DiffFile, Environment, GovernanceState, LedgerStats, RunSnapshot, Todo, TodoState } from '../../data/types';
import { UNKNOWN_COST, dollars, kTokens } from './format';
import type { BreakdownWire, CascadeWire, DescribeWire, DiffWire, InfoWire, InventoryWire, McpStatusWire, StatsWire, TodoWire, UsageWire } from './wire';

/* ───────── context ───────── */
/** the context measure: Hermes's own categories out of the model's window; null while the window is unknown */
export function contextFrom(breakdown: BreakdownWire | null, usage: UsageWire | null): (ContextUsage & { used: number }) | null {
  const total = breakdown?.context_max || usage?.context_max || 0;
  if (total <= 0) return null;
  const parts = (breakdown?.categories ?? []).map((c) => [c.label, c.tokens] as const);
  const used = breakdown?.context_used ?? usage?.context_used ?? parts.reduce((a, p) => a + p[1], 0);
  return { total, parts, used };
}
export const contextNote = (b: BreakdownWire | null, known: boolean): string =>
  !known ? 'Hermes has not reported this session’s context window yet.' : b?.context_estimated ? 'The last response’s count plus an estimate of what came after.' : '';

/* ───────── tasks ───────── */
const TODO: Record<string, TodoState | undefined> = { pending: 'todo', in_progress: 'doing', completed: 'done' };
/** Hermes's todo list; a cancelled task is no longer a task and is left out */
export function todosFrom(list: readonly TodoWire[] | null | undefined): Todo[] {
  const out: Todo[] = [];
  for (const t of list ?? []) {
    const state = TODO[t.status ?? ''];
    if (state && typeof t.content === 'string' && t.content.trim()) out.push([t.content.trim(), state]);
  }
  return out;
}

/* ───────── connectors ───────── */
/** Hermes's MCP servers and their status, then the servers only a project's Claude settings name (from `compat.inventory`) */
export function connectorsFrom(status: McpStatusWire | null, inventory: InventoryWire | null): Connector[] {
  const out: Connector[] = [];
  for (const s of status?.servers ?? []) {
    const state = s.needs_auth ? 'sign in' : s.disabled || s.status === 'failed' ? 'off' : 'on';
    out.push({ name: s.name, tools: s.tools, state, ...(s.status === 'failed' ? { hint: 'failed to connect' } : s.status === 'configured' || s.status === 'lazy' ? { hint: s.tools ? s.tools + ' tools' : 'connects when used' } : {}) });
  }
  const known = new Set(out.map((c) => c.name));
  for (const i of inventory?.items ?? []) {
    if (i.kind !== 'mcp' || known.has(i.name)) continue;
    known.add(i.name);
    out.push({ name: i.name, tools: 0, state: i.status === 'active' ? 'on' : 'off', hint: 'Claude settings: ' + i.status });
  }
  return out;
}

/* ───────── environment ───────── */
const homeRelative = (p: string): string => p; // the gateway sends the folder as the session knows it
export function environmentFrom(info: InfoWire | null, describe: DescribeWire | null): Environment {
  const release = info?.release_date ? ' (release ' + info.release_date + ')' : '';
  const version = info?.version && info.version !== 'unknown' ? ' ' + info.version : '';
  return {
    cwd: homeRelative(info?.cwd ?? describe?.session?.cwd ?? ''),
    branch: info?.branch ?? '',
    sandbox: describe?.hx ? 'hx sandbox' + (describe.kernel?.ok === false ? ' (kernel down)' : '') : '',
    runtime: info ? 'Hermes' + version + release : '',
    harness: describe?.version ? 'boopis ' + describe.version : '',
    gate: ''
  };
}

/* ───────── governance, ledger, run ───────── */
const tierLabel = (t: { name: string; model: { id: string } }): string => t.model.id || t.name;
const tierRule = (i: number): string => (i === 0 ? 'first try' : 'after a failed gate');
export function ladderFrom(cascade: CascadeWire | null): ReadonlyArray<readonly [string, string]> {
  return (cascade?.ladder ?? []).map((t, i) => [tierLabel(t), tierRule(i)] as const);
}
export function governanceFrom(o: { describe: DescribeWire | null; cascade: CascadeWire | null; stats: StatsWire | null; model: string; governed: boolean; locked: boolean }): GovernanceState {
  const cap = o.describe?.config?.cost_cap_usd;
  const cost = o.stats?.cost_usd;
  return {
    governed: o.governed, smart: false, model: o.model, cap: cap == null ? '' : dollars(cap), spent: cost == null ? '' : dollars(cost),
    ladder: ladderFrom(o.cascade), current: Math.max(0, o.cascade?.tier_index ?? 0), locked: o.locked
  };
}
export function ledgerFrom(stats: StatsWire | null): LedgerStats {
  const t = stats?.tokens;
  const total = t ? (t.input_uncached ?? 0) + (t.output ?? 0) + (t.cache_read ?? 0) + (t.cache_write ?? 0) : 0;
  return { tokens: stats ? kTokens(total) : '', cost: stats?.cost_usd == null ? UNKNOWN_COST : dollars(stats.cost_usd), trips: stats?.round_trips ?? 0, escalations: stats?.escalations ?? 0 };
}
/** why a cost is unknown, in the words ADR-0012 asks for; '' when it is known */
export const costNote = (s: StatsWire | null): string => (s && s.cost_usd == null ? 'cost: unknown — no price for ' + ((s.unpriced_models ?? []).join(', ') || 'this model') : '');
/** a session that ran only on a plan (the Claude subscription): its cost is zero because the plan covers it, and a list price a
    tool reports is an estimate, never a charge; '' for any other session */
export const planNote = (s: StatsWire | null): string => (s?.subscription === true ? 'cost: none, covered by your Claude plan (a list price is an estimate, not a charge)' : '');

export interface RunInput {
  title: string; model: string; steps: number; elapsedSeconds: number; stopped: boolean; governed: boolean;
  stats: StatsWire | null; cascade: CascadeWire | null; cap: number | null;
}
export function runFrom(i: RunInput): RunSnapshot {
  return {
    title: i.title, model: i.model, step: i.steps, escalated: i.stats?.escalations ?? 0, elapsed: i.elapsedSeconds,
    cost: i.stats?.cost_usd ?? null, cap: i.cap, ladder: ladderFrom(i.cascade), current: Math.max(0, i.cascade?.tier_index ?? 0),
    tokens: ledgerFrom(i.stats).tokens, trips: i.stats?.round_trips ?? 0, governed: i.governed, network: false, stopped: i.stopped
  };
}

/* ───────── changes and diff ───────── */
export function changesFrom(diff: DiffWire | null): Change[] { return (diff?.files ?? []).map((f) => [f.path, f.add, f.del] as const); }
export function diffFilesFrom(diff: DiffWire | null): DiffFile[] {
  return (diff?.files ?? []).map((f) => ({ path: f.path, add: f.add, del: f.del, hunks: f.hunks.map((h) => [h.header, h.lines] as const) }));
}
export const diffNote = (d: DiffWire | null): string => d?.unavailable ?? (d?.truncated ? 'A very large change: some lines are not shown.' : '');

/* ───────── output ───────── */
export const OUTPUT_MAX_LINES = 400;
const LINE_MAX = 300;
const clip = (l: string): string => (l.length > LINE_MAX ? l.slice(0, LINE_MAX) + '…' : l);
/** a finished tool call as the terminal shows it: the command (or the tool and what it was asked), then its output */
export function outputFor(p: { name?: string; context?: string | null; args?: Record<string, unknown> | null; result_text?: string | null; summary?: string | null; is_error?: boolean | null }): string[] {
  const command = typeof p.args?.['command'] === 'string' ? p.args['command'] : '';
  const head = '$ ' + (command || [p.name ?? '', p.context ?? ''].filter(Boolean).join(' '));
  const body = (p.result_text ?? p.summary ?? '').split('\n').filter((l) => l.trim());
  return [clip(head), ...body.slice(0, 12).map(clip), ...(body.length > 12 ? ['… ' + (body.length - 12) + ' more lines'] : []), ...(p.is_error ? ['FAIL  ' + (p.name ?? 'tool') + ' failed'] : [])];
}
/** a ship's gate verdict as a line the output panel colours */
export function shipLine(p: { status: string; ship_id: string; files?: { path: string }[]; gate?: { verdict?: string; gates?: string[] } }): string[] {
  const files = (p.files ?? []).map((f) => f.path).join(', ');
  const verdict = p.gate?.verdict === 'pass' ? 'PASS' : p.gate?.verdict ? 'FAIL' : '';
  return ['$ ship ' + files, ` ${verdict ? verdict + '  ' : ''}${p.status === 'shipped' ? 'shipped' : p.status === 'restored' ? '↩ rolled back, every file is back as it was' : p.status}${p.gate?.gates?.length ? ' (' + p.gate.gates.join(', ') + ')' : ''}`];
}
export const capLines = (lines: readonly string[]): string[] => (lines.length > OUTPUT_MAX_LINES ? lines.slice(lines.length - OUTPUT_MAX_LINES) : [...lines]);
