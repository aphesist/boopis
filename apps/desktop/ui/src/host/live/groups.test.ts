/* The live groups against a fake engine that keeps rooms and their logs the way `groups.*` answers (the shapes are the engine's:
   `tui_gateway/methods_groups.py`, `gateway/hosted_rooms.py`). Every call is recorded, so the tests say which method did what. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot, GroupsEvent } from '../../data';
import type { GatewayClient, GatewayEvent } from '../gateway';
import { createLiveGroups } from './groups';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bot = (id: string, name = id): Bot => ({ id, name, role: '', shape: 'circle', color: '#fff', state: 'idle', attention: null, paused: false, activity: '', spent: '', last: null, ideas: [], cfg: { instructions: '', gov: 'governed', model: '', cap: '0.6', cron: '', channels: {}, approvals: {}, workspace: 'worktree' } });
const BOTS = [bot('atlas'), bot('nina', 'Nina'), bot('kai')];

class FakeEngine {
  context: Record<string, unknown> | null = null;
  calls: { method: string; params: Json }[] = [];
  rooms: Json[] = [];
  logs: Record<string, Json[]> = {};
  working = false;
  activity: Json[] = [];
  driver = true;
  subs = new Set<(e: GatewayEvent) => void>();
  private seq = 0;
  push(room: string, kind: string, payload: Json, actor: Json = { kind: 'gateway', id: 'g' }): Json {
    const e = { room_id: room, seq: ++this.seq, event_id: 'e' + this.seq, kind, actor, payload, created_at: 1763546400 + this.seq };
    (this.logs[room] ??= []).push(e);
    return e;
  }
  client = {
    request: (m: string, p: Json) => this.call(m, p),
    requestRaw: (m: string, p: Json) => this.call(m, p),
    onEvent: (fn: (e: GatewayEvent) => void) => { this.subs.add(fn); return () => this.subs.delete(fn); },
    onState: () => () => undefined
  } as unknown as GatewayClient;
  async call(method: string, p: Json): Promise<unknown> {
    this.calls.push({ method, params: p });
    switch (method) {
      case 'groups.capabilities': return { driver: this.driver };
      case 'groups.list': return { rooms: this.rooms, next_offset: null };
      case 'groups.create': {
        const room = { room_id: p['room_id'], name: p['name'], members: p['members'], authority_gateway_id: 'g', authority_epoch: 1, revision: 1, created_at: 1, updated_at: 1 };
        this.rooms.push(room);
        return { room };
      }
      case 'groups.rename': { const r = this.rooms.find((x) => x['room_id'] === p['room_id']) as Json; r['name'] = p['name']; r['revision']++; return { room: r }; }
      case 'groups.send': return { event: this.push(p['room_id'], 'message.user', p['payload'], { kind: 'user', id: 'u' }), accepted: true };
      case 'groups.log': {
        const all = (this.logs[p['room_id']] ?? []).filter((e) => e['seq'] > p['since_seq']);
        return { events: all, cursor: all.at(-1)?.['seq'] ?? p['since_seq'], latest_seq: all.at(-1)?.['seq'] ?? 0, has_more: false, authority: { gateway_id: 'g', epoch: 1 } };
      }
      case 'groups.state': return { room: this.rooms.find((x) => x['room_id'] === p['room_id']), driver_status: { working: this.working, member_activity: this.activity }, ...(this.context ? { context: this.context } : {}) };
      case 'groups.stop': case 'groups.continue': return { cancelled: 1 };
      default: throw new Error('unknown method ' + method);
    }
  }
  emit(ev: GatewayEvent): void { for (const f of this.subs) f(ev); }
}
const room = (id: string, name: string, profiles: string[]): Json => ({ room_id: id, name, members: profiles.map((x) => ({ member_id: x, profile: x, handle: x, display_name: x === 'nina' ? 'Nina' : x })), authority_gateway_id: 'g', authority_epoch: 1, revision: 1, created_at: 1, updated_at: 1 });
const tickAll = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

async function open(setup?: (e: FakeEngine) => void) {
  const e = new FakeEngine();
  setup?.(e);
  const g = createLiveGroups({ client: e.client, bots: () => BOTS, now: () => new Date('2026-11-19T10:00:00Z'), pollMs: null });
  const events: GroupsEvent[] = [];
  g.source.subscribe((x) => events.push(x));
  await g.ready; await g.settled();
  return { e, g, events };
}
beforeEach(() => { localStorage.clear(); });

describe('a group is an engine room of local profiles', () => {
  it('lists the rooms as groups, a member being the profile it is', async () => {
    const { g } = await open((e) => { e.rooms.push(room('r1', 'release crew', ['atlas', 'nina'])); });
    expect(g.source.snapshot().groups).toEqual([{ id: 'r1', name: 'release crew', working: [], members: [{ id: 'atlas', profile: 'atlas', handle: 'atlas', name: 'atlas' }, { id: 'nina', profile: 'nina', handle: 'nina', name: 'Nina' }] }]);
  });
  it('makes a room with the bots as members, handles being their profile names, and says it arrived', async () => {
    const { e, g, events } = await open();
    const made = await g.source.create({ name: 'Release Crew', bots: ['atlas', 'nina', 'kai'] });
    const call = e.calls.find((c) => c.method === 'groups.create')!.params;
    expect(call['name']).toBe('Release Crew');
    expect(call['room_id']).toMatch(/^g-release-crew-[0-9a-f]{12}$/);
    expect(call['members']).toEqual([{ member_id: 'atlas', profile: 'atlas', handle: 'atlas', display_name: 'atlas' }, { member_id: 'nina', profile: 'nina', handle: 'nina', display_name: 'Nina' }, { member_id: 'kai', profile: 'kai', handle: 'kai', display_name: 'kai' }]);
    expect(made.members).toHaveLength(3);
    expect(events.some((x) => x.type === 'group-created')).toBe(true);
  });
  it('refuses fewer than two or more than six bots, and a bot the user does not have, before asking the engine', async () => {
    const { e, g } = await open();
    await expect(g.source.create({ name: 'x', bots: ['atlas'] })).rejects.toThrow(/2 to 6/);
    await expect(g.source.create({ name: 'x', bots: ['atlas', 'ghost'] })).rejects.toThrow(/not a bot you have/);
    expect(e.calls.map((c) => c.method)).not.toContain('groups.create');
  });
  it('renames through groups.rename', async () => {
    const { e, g } = await open((x) => { x.rooms.push(room('r1', 'old', ['atlas', 'nina'])); });
    await g.source.rename('r1', ' new name ');
    expect(e.calls.find((c) => c.method === 'groups.rename')!.params).toMatchObject({ room_id: 'r1', name: 'new name' });
    expect(g.source.snapshot().groups[0]!.name).toBe('new name');
  });
  it('says why when the engine has no group chat, or its room worker is off', async () => {
    const off = await open((x) => { x.driver = false; });
    expect(off.g.source.note()).toMatch(/not running/);
    const none = await open((x) => { x.call = (m: string) => Promise.reject(Object.assign(new Error('unknown method ' + m), { rpcCode: -32601 })); });
    expect(none.g.source.note()).toMatch(/no group chat/);
  });
});

describe('talking to a group', () => {
  it('sends the message to the room, as one thread, and shows it at once', async () => {
    const { e, g, events } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    await g.source.open('r1');
    g.source.send('r1', '@nina what is left?');
    await tickAll();
    expect(e.calls.find((c) => c.method === 'groups.send')!.params).toMatchObject({ room_id: 'r1', payload: { thread_id: 'main', text: '@nina what is left?' } });
    expect(events.filter((x) => x.type === 'message')).toHaveLength(1);
    expect(g.source.snapshot().threads['r1']).toMatchObject([{ kind: 'text', who: 'you', text: '@nina what is left?' }]);
  });
  it('shows each member’s reply attributed to it, in the order of the log, and the same event never twice', async () => {
    vi.useFakeTimers();
    try {
      const { e, g } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
      await g.source.open('r1');
      g.source.send('r1', 'hello');
      await vi.advanceTimersByTimeAsync(0);
      e.working = true; e.activity = [{ member_id: 'atlas', status: 'running' }, { member_id: 'nina', status: 'queued' }];
      e.push('r1', 'message.member', { member_id: 'atlas', text: 'Eleven commits.' }, { kind: 'member', id: 'atlas', profile: 'atlas' });
      await vi.advanceTimersByTimeAsync(1300);
      expect(g.source.snapshot().groups[0]!.working).toEqual(['atlas', 'nina']);
      e.working = false; e.activity = [];
      e.push('r1', 'message.member', { member_id: 'nina', text: 'Staging is green.' }, { kind: 'member', id: 'nina', profile: 'nina' });
      await vi.advanceTimersByTimeAsync(4000);
      const thread = g.source.snapshot().threads['r1']!;
      expect(thread.map((m) => (m.kind === 'text' ? [m.who, m.text] : m.kind))).toEqual([['you', 'hello'], ['atlas', 'Eleven commits.'], ['nina', 'Staging is green.']]);
      expect(g.source.snapshot().groups[0]!.working).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('knows when a room routes through a lead, which the room says', async () => {
    const { g } = await open((x) => { x.rooms.push(room('r1', 'paper past', ['kai', 'nina'])); x.context = { purpose: '', notes: '', routing: 'lead', lead_member_id: 'kai' }; });
    await g.source.open('r1');
    expect(g.source.snapshot().groups[0]).toMatchObject({ lead: 'kai' });
    const everyone = await open((x) => { x.rooms.push(room('r1', 'paper past', ['kai', 'nina'])); x.context = { purpose: '', notes: '', routing: 'everyone', lead_member_id: 'kai' }; });
    await everyone.g.source.open('r1');
    expect(everyone.g.source.snapshot().groups[0]!.lead).toBeUndefined();
  });
  it('says in the thread when a member could not reply, and offers to continue a conversation that paused at its limit', async () => {
    const { e, g } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    e.push('r1', 'turn.failed', { member_id: 'nina', error: 'Traceback boom' });
    e.push('r1', 'room.activity', { status: 'bounded', discussion_event_id: 'd1', thread_id: 'main', reason_code: 'x' });
    await g.source.open('r1');
    const notes = g.source.snapshot().threads['r1']!;
    expect(notes).toMatchObject([{ kind: 'note', text: 'Nina could not reply. Try again. If it keeps failing, the details are in Settings, General, Diagnostics.' }, { kind: 'note', more: 'd1' }]);
    expect(JSON.stringify(notes)).not.toMatch(/Traceback/);   // the engine's words stay out of the thread
    await g.source.continueTalk('r1', 'd1');
    expect(e.calls.find((c) => c.method === 'groups.continue')!.params).toEqual({ room_id: 'r1', discussion_event_id: 'd1' });
  });
  it('reads the log again when the engine says the room moved', async () => {
    const { e, g } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    await g.source.open('r1');
    e.push('r1', 'message.member', { member_id: 'atlas', text: 'later' });
    e.emit({ type: 'groups.changed', payload: { room_ids: ['r1'] } });
    await tickAll(); await g.settled();
    expect(g.source.snapshot().threads['r1']).toMatchObject([{ who: 'atlas', text: 'later' }]);
  });
  it('a message that is not accepted says so in the thread', async () => {
    const { e, g, events } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    const orig = e.call.bind(e);
    e.call = (m, p) => (m === 'groups.send' ? Promise.reject(new Error('the room is busy')) : orig(m, p));
    g.source.send('r1', 'hi');
    await tickAll();
    expect(events.find((x) => x.type === 'message')).toMatchObject({ message: { kind: 'note', text: 'The message was not sent: the room is busy' } });
  });
  it('stops the replies only while members are working', async () => {
    const { e, g } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    expect(g.source.stop('r1')).toBe(false);
    e.working = true; e.activity = [{ member_id: 'atlas', status: 'running' }];
    await g.source.open('r1');
    expect(g.source.stop('r1')).toBe(true);
    expect(e.calls.map((c) => c.method)).toContain('groups.stop');
  });
});

describe('archiving and changing members, which the engine’s rooms cannot do themselves', () => {
  it('archives as a mark on this computer, keeps the room, and a restore brings it back', async () => {
    const { e, g, events } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    const undo = await g.source.archive('r1');
    expect(g.source.snapshot().groups).toEqual([]);
    expect(g.source.archived.get()).toMatchObject([{ id: 'r1', name: 'crew' }]);
    expect(e.calls.map((c) => c.method)).not.toContain('groups.disband');
    expect(events.at(-1)).toEqual({ type: 'group-archived', id: 'r1' });
    expect(JSON.parse(localStorage.getItem('hx.v6.bots') ?? '{}').archivedGroups).toEqual(['r1']);
    await undo.undo();
    expect(g.source.snapshot().groups).toHaveLength(1);
    expect(g.source.archived.get()).toEqual([]);
  });
  it('a different set of members is a new room with the same name, and the old one is archived', async () => {
    const { e, g } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    const made = await g.source.setMembers('r1', ['atlas', 'kai']);
    expect(e.calls.find((c) => c.method === 'groups.create')!.params['name']).toBe('crew');
    expect(made.id).not.toBe('r1');
    expect(g.source.snapshot().groups.map((x) => x.id)).toEqual([made.id]);
    expect(g.source.archived.get().map((x) => x.id)).toEqual(['r1']);
  });
  it('remembers what was archived across a restart', async () => {
    localStorage.setItem('hx.v6.bots', JSON.stringify({ archivedGroups: ['r1'] }));
    const { g } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    expect(g.source.snapshot().groups).toEqual([]);
    expect(g.source.archived.get()).toHaveLength(1);
  });
});
