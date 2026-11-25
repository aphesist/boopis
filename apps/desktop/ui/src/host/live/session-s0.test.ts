/* The Session tab's S0 through the live provider, over a fake gateway (docs/specs/session-launch.md 11, checkpoint-rewind.md
   12.15): a running turn's snapshot is whole, so a session switched back to draws what it has; the step changes in place with
   careful.set and across the Full access line on a new engine session that carries the thread; a rewind's dry run and the
   real one, its line with Undo, and Undo spent by a later change; kept ships and rewinds read back on a resume. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider } from '../../data/mock-provider';
import type { AgentTurn, ConversationEvent } from '../../data';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { FakeHost, S0_CREATE_PARAMS } from '../testing';

const OLD = 'local-old', NEW = 'local-new';
const META = { governed: false, smart: false, model: '', assume: [] };
let host: FakeHost;
let provider: LiveProvider;
let careful = 'supervised';
let checkpoints: Record<string, unknown>[] = [];
const tick = async (n = 3): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const calls = (m: string): Record<string, unknown>[] => host.sent.filter((s) => s.frame['method'] === m).map((s) => s.frame['params'] as Record<string, unknown>);

function gateway(f: Record<string, unknown>): void {
  const id = f['id'], p = (f['params'] ?? {}) as Record<string, unknown>;
  switch (f['method']) {
    case 'session.list': host.result(id, { sessions: (p['include_hidden'] === true) ? [] : [{ id: OLD, title: 'fix it', preview: '', started_at: 1 }] }); break;
    case 'session.resume': host.result(id, { session_id: OLD, message_count: 2, messages: [{ role: 'user', content: 'fix it', row_id: 1 }, { role: 'assistant', content: 'fixed', row_id: 2 }], info: { model: 'claude-opus-5-5', cwd: '/work/proj' }, revision: 3, execution_generation: 1 }); break;
    case 'session.create': host.result(id, { session_id: NEW, info: { model: 'claude-opus-5-5', cwd: '/work/proj' }, revision: 1, execution_generation: 1 }); break;
    case 'session.transcript': host.result(id, { rows: [{ role: 'user', text: 'fix it' }, { role: 'tool', text: 'x' }, { role: 'assistant', text: 'fixed' }] }); break;
    case 'prompt.submit': host.result(id, { status: 'streaming' }); break;
    case 'plugin.boopis.describe': host.result(id, p['session_id'] ? { session: { session_id: p['session_id'], mode: careful === 'full' ? 'ungoverned' : 'governed', locked: true, cwd: '/work/proj', careful, rewind: { ok: true } } } : {}); break;
    case 'plugin.boopis.turns.models': host.result(id, { turns: [{ model: 'anthropic/claude-opus-5-5', row_ids: [1, 2], turn_id: 'T1' }] }); break;
    case 'plugin.boopis.ledger.tail': host.result(id, { events: [], head_seq: -1 }); break;
    case 'plugin.boopis.checkpoint.list': host.result(id, { checkpoints }); break;
    case 'plugin.boopis.careful.set': careful = String(p['careful']); host.result(id, { careful, applies: 'now' }); break;
    case 'plugin.boopis.continue.arm': host.result(id, { armed: true, messages_carried: 2, messages_omitted: 0, tokens_est: 18000 }); break;
    case 'plugin.boopis.checkpoint.rewind': host.result(id, p['dry_run'] ? { status: 'planned', isolation: 'shared_unchanged', files: [{ path: 'a.ts', action: 'restore' }] } : { status: 'rewound', isolation: 'shared_unchanged', files: [{ path: 'a.ts', action: 'restore' }], rewind_ship_id: 'r1', undo: { ship_id: 's2' } }); break;
    default: if (String(f['method']).startsWith('plugin.boopis.')) host.result(id, {}); else host.error(id, -32601, 'unknown method');
  }
}

async function setup(): Promise<void> {
  localStorage.clear();
  careful = 'supervised';
  host = new FakeHost();
  host.describe = { instance_id: 'inst', capabilities: ['plugin-rpc-v1'], session_create: { parameters: S0_CREATE_PARAMS } };
  host.autoReply = gateway;
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ defaultFolder: '/work/proj', client, mock: createMockProvider({ simulate: false }) });
  await provider.ready;
}
async function open(): Promise<ConversationEvent[]> {
  const seen: ConversationEvent[] = [];
  provider.sessions.conversation(OLD).subscribe((e) => seen.push(e));
  provider.details.follow(OLD);
  await tick(6);
  await provider.settled();
  await tick(2);
  return seen;
}

beforeEach(async () => { checkpoints = []; await setup(); });

describe('a running turn, seen from elsewhere', () => {
  it('holds its steps, its text and its start in the snapshot, so a redraw shows what it has', async () => {
    await open();
    provider.sessions.send(OLD, 'go on', META);
    await tick();
    host.event('message.start', OLD);
    for (let i = 0; i < 5; i++) host.event('tool.start', OLD, { name: 'read_file', context: 'f' + i + '.ts' });
    host.event('message.delta', OLD, { text: 'Half way' });
    await tick();
    const t = provider.sessions.conversation(OLD).snapshot().turns.find((x): x is AgentTurn => x.role === 'assistant' && x.status === 'running');
    expect(t?.steps).toHaveLength(5);
    expect(t?.paragraphs.join(' ')).toBe('Half way');
    expect(typeof t?.startedAt).toBe('number');
  });
  it('the list row of a background session shows its own running state', async () => {
    await open();
    provider.sessions.send(OLD, 'go on', META);
    await tick();
    host.event('message.start', OLD);
    await tick();
    expect(provider.sessions.list.get().find((s) => s.id === OLD)?.running).toBe(true);
    host.event('message.complete', OLD, { text: 'done', outcome: 'completed' });
    await tick();
    expect(provider.sessions.list.get().find((s) => s.id === OLD)?.running).toBe(false);
  });
});

describe('the permission step mid-session', () => {
  it('among the governed steps it changes in place, keeps the engine session and says so in the thread', async () => {
    const seen = await open();
    expect(provider.sessionControls?.launch.get().careful).toBe('supervised');
    expect(await provider.sessionControls?.setCareful('auto')).toBeNull();
    expect(calls('plugin.boopis.careful.set')).toEqual([{ session_id: OLD, careful: 'auto' }]);
    expect(calls('session.create')).toEqual([]);
    const line = seen.find((e): e is Extract<ConversationEvent, { type: 'line' }> => e.type === 'line');
    expect(line?.line).toMatchObject({ kind: 'settings', text: 'Permissions changed to Auto', cost: null });
  });
  it('across the Full access line it continues the thread on a new engine session, carrying its messages', async () => {
    const seen = await open();
    expect(await provider.sessionControls?.setCareful('full')).toBeNull();
    expect(calls('session.create')[0]).toMatchObject({ cwd: '/work/proj', toolsets: ['boopis'], model: 'claude-opus-5-5' });
    expect(calls('plugin.boopis.mode.set')[0]).toMatchObject({ session_id: NEW, mode: 'ungoverned', careful: 'full', surface: 'session' });
    expect(calls('plugin.boopis.continue.arm')[0]).toEqual({ session_id: NEW, parent_session_id: OLD, because: ['Full access'], rows: [{ role: 'user', text: 'fix it' }, { role: 'assistant', text: 'fixed' }] });
    expect(calls('session.mutate').some((p) => p['operation'] === 'sidebar' && p['session_id'] === OLD)).toBe(true);
    expect(calls('session.detach')).toContainEqual({ session_id: OLD, end_reason: 'continued' });
    const line = [...seen].reverse().find((e): e is Extract<ConversationEvent, { type: 'line' }> => e.type === 'line');
    expect(line?.line).toMatchObject({ kind: 'settings', text: 'Settings changed: continued with Full access' });
    expect(line?.line.kind === 'settings' && line.line.cost).toMatch(/18,000 tokens without the cache \(cost unknown\)/);
    /* the visible thread is now on the new engine session */
    provider.sessions.send(OLD, 'next', META);
    await tick();
    expect(calls('prompt.submit').at(-1)).toMatchObject({ session_id: NEW, text: 'next' });
  });
  it('a continuation that fails leaves the thread on its session, with its settings, and says so', async () => {
    await open();
    host.autoReply = (f) => { if (f['method'] === 'plugin.boopis.continue.arm') host.error(f['id'], -32000, 'hx.mode.locked: no'); else gateway(f); };
    const why = await provider.sessionControls?.setCareful('full');
    expect(why).toMatch(/^Settings were not changed/);
    expect(calls('session.detach')).toContainEqual({ session_id: NEW, end_reason: 'launch_failed' });
    provider.sessions.send(OLD, 'next', META);
    await tick();
    expect(calls('prompt.submit').at(-1)).toMatchObject({ session_id: OLD });
  });
});

describe('rewind', () => {
  it('reads kept ships and rewinds back on a resume, maps them to their turns, and finds the head', async () => {
    checkpoints = [{ ship_id: 's1', kind: 'ship', turn_id: 'T1', files: ['a.ts'] }, { ship_id: 's2', kind: 'ship', turn_id: 'T1', files: ['a.ts'] }];
    await open();
    const a = provider.sessions.conversation(OLD).snapshot().turns.find((x): x is AgentTurn => x.role === 'assistant');
    expect(a?.kept).toEqual(['s1', 's2']);
    expect(provider.sessionControls?.head(OLD)).toBe('s2');
    expect(provider.sessionControls?.capabilities.get().session.rewind.ok).toBe(true);
  });
  it('a dry run writes nothing; the real one adds its line with Undo; a later kept ship spends the Undo', async () => {
    checkpoints = [{ ship_id: 's1', kind: 'ship', turn_id: 'T1', files: ['a.ts'] }, { ship_id: 's2', kind: 'ship', turn_id: 'T1', files: ['a.ts'] }];
    const seen = await open();
    const plan = await provider.sessionControls?.rewind(OLD, 's1', { dryRun: true, expectHead: 's2' });
    expect(plan).toMatchObject({ status: 'planned', files: [{ path: 'a.ts', action: 'restore' }] });
    expect(calls('plugin.boopis.checkpoint.rewind')[0]).toEqual({ session_id: OLD, ship_id: 's1', dry_run: true, expect_head: 's2' });
    expect(seen.some((e) => e.type === 'line')).toBe(false);
    const r = await provider.sessionControls?.rewind(OLD, 's1', { expectHead: 's2' });
    expect(r?.status).toBe('rewound');
    const lines = provider.sessions.conversation(OLD).snapshot().lines ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'checkpoint', action: 'rewound', to: { shipId: 's1', label: 'after turn 1' }, files: 1, rewindShipId: 'r1', undoShipId: 's2' });
    /* the plugin's own event for the same rewind adds nothing */
    host.event('plugin.boopis.checkpoint.rewound', OLD, { rewind_ship_id: 'r1', files: [{ path: 'a.ts' }] });
    await tick();
    expect(provider.sessions.conversation(OLD).snapshot().lines).toHaveLength(1);
    /* a new kept ship: the rewind's undo is no longer the last change */
    provider.sessions.send(OLD, 'more', META);
    await tick();
    host.event('message.start', OLD);
    host.event('plugin.boopis.ship.completed', OLD, { ship_id: 's3', status: 'shipped' });
    await tick();
    const after = provider.sessions.conversation(OLD).snapshot().lines ?? [];
    expect(after[0]).toMatchObject({ undoShipId: null });
    expect(provider.sessionControls?.head(OLD)).toBe('s3');
    expect(seen.some((e) => e.type === 'turn-kept')).toBe(true);
  });
  it('an undo is said as one', async () => {
    checkpoints = [{ ship_id: 's1', kind: 'ship', turn_id: 'T1', files: ['a.ts'] }];
    await open();
    await provider.sessionControls?.rewind(OLD, 's1', { undo: true });
    expect((provider.sessions.conversation(OLD).snapshot().lines ?? [])[0]).toMatchObject({ action: 'undone' });
  });
  it('a refusal comes back as words, never as an exception', async () => {
    await open();
    host.autoReply = (f) => { if (f['method'] === 'plugin.boopis.checkpoint.rewind') host.result(f['id'], { status: 'refused', isolation: 'refused', why: 'Another session is working in this folder.', files: [] }); else gateway(f); };
    expect(await provider.sessionControls?.rewind(OLD, null)).toMatchObject({ status: 'refused', why: 'Another session is working in this folder.' });
  });
});
