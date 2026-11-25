import { describe, expect, it } from 'vitest';
import { eventsOf, fixtures, resultOf } from '../testing';
import { frontierFrom, changesFrom, connectorsFrom, contextFrom, costNote, diffFilesFrom, environmentFrom, governanceFrom, ledgerFrom, ladderFrom, outputFor, planNote, runFrom, shipLine, todosFrom } from './map-details';
import { kTokens, dollars } from './format';
import type { BreakdownWire, CascadeWire, DescribeWire, DiffWire, InfoWire, InventoryWire, McpStatusWire, StatsWire } from './wire';

const S = fixtures.session, U = fixtures.unpriced;
const info = resultOf<InfoWire>(S, 'session.info');
const breakdown = resultOf<BreakdownWire>(S, 'session.context_breakdown');
const stats = resultOf<StatsWire>(S, 'plugin.boopis.ledger.stats');
const unpriced = resultOf<StatsWire>(U, 'plugin.boopis.ledger.stats');
const cascade = resultOf<CascadeWire>(S, 'plugin.boopis.cascade.state');
const describe_ = resultOf<DescribeWire>(S, 'plugin.boopis.describe', 1);
const diff = resultOf<DiffWire>(S, 'plugin.boopis.checkpoint.diff');

describe('context, from the recorded session', () => {
  it('is Hermes’s categories out of the model window, and says when it is estimated', () => {
    const c = contextFrom(breakdown, info.usage ?? null);
    expect(c?.total).toBe(200000);
    expect(c?.parts.map((p) => p[0])).toEqual(['System prompt', 'Tool definitions', 'Rules', 'Conversation']);
    expect(c?.used).toBe(breakdown.context_used);
  });
  it('is unknown, not zero, while the window is unknown', () => {
    expect(contextFrom({ categories: [], context_max: 0, context_used: 0 }, null)).toBeNull();
    expect(contextFrom(null, null)).toBeNull();
  });
});

describe('tasks', () => {
  it('maps Hermes’s todo.updated and leaves out a cancelled task', () => {
    const p = eventsOf(S, 'todo.updated')[0]?.payload as { todos: never[] };
    expect(todosFrom(p.todos)).toEqual([['read the call sites', 'done'], ['round once per invoice', 'doing'], ['add a property test', 'todo']]);
    expect(todosFrom([{ content: 'x', status: 'cancelled' }, { content: '  ', status: 'pending' }, { status: 'pending' }])).toEqual([]);
  });
});

describe('connectors', () => {
  const status = resultOf<McpStatusWire>(S, 'mcp.servers.status');
  const inventory = resultOf<InventoryWire>(S, 'plugin.boopis.compat.inventory');
  it('is the MCP servers Hermes runs (this one connects on first use, so it has no tool count yet)', () => {
    expect(connectorsFrom(status, inventory)).toEqual([{ name: 'fakemcp', tools: 0, state: 'on', hint: 'connects when used' }]);
    expect(connectorsFrom({ servers: [{ name: 'live', tools: 4, connected: true, disabled: false, status: 'connected' }] }, null)).toEqual([{ name: 'live', tools: 4, state: 'on' }]);
  });
  it('adds a server only a project’s Claude settings name, as not running', () => {
    const c = connectorsFrom(status, { items: [{ kind: 'mcp', name: 'github', status: 'untrusted' }, { kind: 'mcp', name: 'fakemcp', status: 'active' }, { kind: 'hook', name: 'x', status: 'active' }] });
    expect(c.map((x) => [x.name, x.state, x.hint])).toEqual([['fakemcp', 'on', 'connects when used'], ['github', 'off', 'Claude settings: untrusted']]);
  });
  it('shows a server that needs a sign-in, and one that failed', () => {
    const c = connectorsFrom({ servers: [{ name: 'a', tools: 0, connected: false, disabled: false, status: 'configured', needs_auth: true }, { name: 'b', tools: 0, connected: false, disabled: false, status: 'failed' }] }, null);
    expect(c.map((x) => [x.state, x.hint])).toEqual([['sign in', 'connects when used'], ['off', 'failed to connect']]);
  });
});

describe('environment', () => {
  it('is what the session and the plugin say, and empty where nothing says it', () => {
    expect(environmentFrom(info, describe_)).toEqual({ cwd: '/work/proj', branch: 'master', sandbox: 'hx sandbox', runtime: 'boopis engine (release 2026.9.24)', harness: 'boopis 0.1.0', gate: '' });
    expect(environmentFrom(null, null)).toEqual({ cwd: '', branch: '', sandbox: '', runtime: '', harness: '', gate: '' });
  });
});

describe('governance, the ladder and the ledger', () => {
  it('takes the ladder from cascade.state and the cap and spend from the plugin', () => {
    expect(ladderFrom(cascade)).toEqual([['claude-haiku-5-5', 'first try'], ['claude-sonnet-5-5', 'after a failed gate'], ['claude-opus-5-5', 'after a failed gate']]);
    const g = governanceFrom({ describe: describe_, cascade, stats, model: 'fake-a', governed: false, locked: true });
    expect(g).toMatchObject({ governed: false, smart: false, model: 'fake-a', cap: '$2.00', locked: true, current: 0 });
    expect(g.spent).toBe(dollars(stats.cost_usd as number));
  });
  it('shows an unpriced model’s cost as unknown, with the reason (ADR-0012)', () => {
    expect(unpriced.cost_usd).toBeNull();
    expect(ledgerFrom(unpriced)).toMatchObject({ cost: 'unknown', trips: 4 });
    expect(costNote(unpriced)).toBe('cost: unknown — no price for custom/fake-a, main/fake-a');
    expect(governanceFrom({ describe: null, cascade: null, stats: unpriced, model: 'm', governed: true, locked: false }).spent).toBe('');
    expect(costNote(stats)).toBe('');
  });
  it('says a plan covers a session that ran only on one, and says nothing for any other', () => {
    const plan: StatsWire = { cost_usd: 0, cost_api_equivalent_usd: null, subscription: true, unpriced_models: ['claude-subscription-directsdk-experimental/sonnet'], round_trips: 2 };
    expect(planNote(plan)).toBe('cost: none, covered by your Claude plan (a list price is an estimate, not a charge)');
    expect(ledgerFrom(plan).cost, 'billed zero is shown as the plugin computed it, never a list price').toBe(dollars(0));
    expect(planNote({ ...plan, subscription: false })).toBe('');
    expect(planNote(stats)).toBe('');
    expect(planNote(null)).toBe('');
  });
  it('never computes a cost: the run carries the plugin’s number or null', () => {
    const run = (st: StatsWire | null, cap: number | null) => runFrom({ title: 't', model: 'fake-a', steps: 3, elapsedSeconds: 12, stopped: false, governed: false, stats: st, cascade: null, cap });
    expect(run(stats, 2).cost).toBe(stats.cost_usd);
    expect(run(unpriced, null)).toMatchObject({ cost: null, cap: null, trips: 4, step: 3, elapsed: 12 });
    expect(run(null, null).tokens).toBe('');
  });
  it('prints token counts compactly', () => { expect(kTokens(999)).toBe('999'); expect(kTokens(48_200)).toBe('48.2k'); expect(kTokens(200_000)).toBe('200k'); expect(dollars(0.0004)).toBe('$0.00040'); });
});

describe('changes and the diff, from checkpoint.diff', () => {
  it('lists the shipped files with their line counts and carries the hunks', () => {
    expect(changesFrom(diff)).toEqual([['src/a.py', 1, 1]]);
    expect(diffFilesFrom(diff)[0]?.hunks).toEqual([['@@ -1,2 +1,2 @@', [' def hello():', '-    return 1', '+    return 2']]]);
  });
  it('is empty when nothing shipped', () => { expect(changesFrom({ files: [] })).toEqual([]); expect(changesFrom(null)).toEqual([]); });
});

describe('output, from tool steps and ships', () => {
  it('shows a tool call as a command line then its output, and a ship as its verdict', () => {
    const complete = eventsOf(S, 'tool.complete').map((e) => e.payload);
    const lines = complete.flatMap((p) => outputFor(p as Parameters<typeof outputFor>[0]));
    expect(lines[0]).toMatch(/^\$ todo_list/);
    expect(lines.some((l) => l.startsWith('$ ship'))).toBe(true);
    const ship = eventsOf(S, 'plugin.boopis.ship.completed')[0]?.payload as Parameters<typeof shipLine>[0];
    expect(shipLine(ship)).toEqual(['$ ship src/a.py', ' PASS  shipped (T0.scope, T0.visible_tests)']);
  });
  it('marks a failed tool and bounds a long result', () => {
    expect(outputFor({ name: 'terminal', args: { command: 'make' }, result_text: 'a\nb', is_error: true })).toEqual(['$ make', 'a', 'b', 'FAIL  terminal failed']);
    const long = outputFor({ name: 't', result_text: Array.from({ length: 40 }, (_, i) => 'l' + i).join('\n') });
    expect(long).toHaveLength(14);
    expect(long.at(-1)).toBe('… 28 more lines');
  });
});

describe('frontierFrom (ADR-0037)', () => {
  const ok = { allowed: ['Claude Opus 5.5'], sentence: 'S', available: true, why: null };
  it('says nothing when neither side did', () => { expect(frontierFrom(null, null)).toBeNull(); });
  it('is available only when every voice says so, and carries the first reason', () => {
    expect(frontierFrom(ok, { available: true, sentence: 'S', allowed: [] })?.available).toBe(true);
    expect(frontierFrom({ ...ok, available: false, why: 'plugin' }, { available: false, why: 'host', sentence: 'S', allowed: [] })).toMatchObject({ available: false, why: 'plugin' });
    expect(frontierFrom(ok, { available: false, why: 'host', sentence: 'S', allowed: [] })).toMatchObject({ available: false, why: 'host' });
    expect(frontierFrom({ ...ok, session_model: { provider: 'a', model: 'b', frontier: false, why: 'model' } }, null)).toMatchObject({ available: false, why: 'model' });
  });
  it('governanceFrom carries it only when governed mode cannot run', () => {
    const base = { describe: null, cascade: null, stats: null, model: 'm', governed: false, locked: false };
    expect(governanceFrom({ ...base, frontier: frontierFrom(ok, null) }).frontier).toBeUndefined();
    expect(governanceFrom({ ...base, frontier: frontierFrom({ ...ok, available: false, why: 'w' }, null) }).frontier?.why).toBe('w');
  });
});
