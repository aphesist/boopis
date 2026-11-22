/* The live groups against a fake engine that keeps rooms and their logs the way `groups.*` answers (the shapes are the engine's:
   `tui_gateway/methods_groups.py`, `gateway/hosted_rooms.py`). Every call is recorded, so the tests say which method did what. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot, GroupsEvent } from '../../data';
import type { GatewayClient, GatewayEvent } from '../gateway';
import type { RoomsBridge } from '../rooms-bridge';
import { createLiveGroups } from './groups';
import { ROUND_LIMIT_DEFAULT } from '../../data/mock-groups';

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

async function open(setup?: (e: FakeEngine) => void, bridge?: RoomsBridge) {
  const e = new FakeEngine();
  setup?.(e);
  const g = createLiveGroups({ client: e.client, bots: () => BOTS, now: () => new Date('2026-11-19T10:00:00Z'), pollMs: null, ...(bridge ? { bridge } : {}) });
  const events: GroupsEvent[] = [];
  g.source.subscribe((x) => events.push(x));
  await g.ready; await g.settled();
  return { e, g, events };
}
beforeEach(() => { localStorage.clear(); });

describe('a group is an engine room of local profiles', () => {
  it('lists the rooms as groups, a member being the profile it is', async () => {
    const { g } = await open((e) => { e.rooms.push(room('r1', 'release crew', ['atlas', 'nina'])); });
    expect(g.source.snapshot().groups).toEqual([{ id: 'r1', name: 'release crew', working: [], busy: false, queued: [], members: [{ id: 'atlas', profile: 'atlas', handle: 'atlas', name: 'atlas' }, { id: 'nina', profile: 'nina', handle: 'nina', name: 'Nina' }] }]);
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
  it('a message said into the open room from outside (the local API) shows as the owner’s own when the engine says the room moved, and the replies follow', async () => {
    const { e, g, events } = await open((x) => { x.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); });
    await g.source.open('r1');
    events.length = 0;
    // the island's `groups.send` is the app's: the engine appends a message.user and tells every window the room moved
    e.push('r1', 'message.user', { thread_id: 'main', text: 'status?' }, { kind: 'user', id: 'u' });
    e.working = true; e.activity = [{ member_id: 'atlas', status: 'running' }];
    e.emit({ type: 'groups.changed', payload: { room_ids: ['r1'] } });
    await tickAll();
    expect(g.source.snapshot().threads['r1']).toMatchObject([{ kind: 'text', who: 'you', text: 'status?' }]);
    expect(JSON.stringify(g.source.snapshot().threads['r1'])).not.toMatch(/island|api|endpoint|client/i);
    expect(events.find((x) => x.type === 'message')).toMatchObject({ groupId: 'r1', message: { who: 'you', text: 'status?' } });
    expect(g.source.snapshot().groups[0]!.working).toEqual(['atlas']);   // the room shows its members replying, as for a message typed here
    e.push('r1', 'message.member', { member_id: 'atlas', text: 'All green.' }, { kind: 'member', id: 'atlas', profile: 'atlas' });
    e.working = false; e.activity = [];
    e.emit({ type: 'groups.changed', payload: { room_ids: ['r1'] } });
    await tickAll();
    expect(g.source.snapshot().threads['r1']!.map((m) => m.kind === 'text' ? m.text : '')).toEqual(['status?', 'All green.']);
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

/* A newer message in a room ends the running Discussion: the engine drops a working member's answer (`turn.cancelled`,
   `superseded_by_newer_user_event`). It has no queue, steer or interjection for a room, so boopis holds a message written
   meanwhile and sends it when the Discussion is over. These tests say that no `groups.send` goes out while the room is busy
   unless the user chose "send now", which stops the running turns first. */
describe('a message written while the members are working', () => {
  const sends = (e: FakeEngine): Json[] => e.calls.filter((c) => c.method === 'groups.send').map((c) => c.params);
  const names = (e: FakeEngine): string[] => e.calls.map((c) => c.method).filter((m) => m === 'groups.send' || m === 'groups.stop');
  const crew = (e: FakeEngine): void => { e.rooms.push(room('r1', 'crew', ['atlas', 'nina'])); };
  /** a Discussion in the log, the members still at it */
  const running = (e: FakeEngine, closed = false): Json => {
    const u = e.push('r1', 'message.user', { thread_id: 'main', text: 'review the diff' }, { kind: 'user', id: 'u' });
    e.working = !closed; e.activity = closed ? [] : [{ member_id: 'atlas', status: 'running' }];
    if (closed) e.push('r1', 'room.activity', { status: 'settled', discussion_event_id: u['event_id'], thread_id: 'main' });
    return u;
  };
  const finish = (e: FakeEngine, u: Json): void => {
    e.working = false; e.activity = [];
    e.push('r1', 'message.member', { member_id: 'atlas', text: 'Done.' }, { kind: 'member', id: 'atlas', profile: 'atlas' });
    e.push('r1', 'room.activity', { status: 'settled', discussion_event_id: u['event_id'], thread_id: 'main' });
  };

  it('is sent at once when the room is quiet', async () => {
    const { e, g } = await open(crew);
    await g.source.open('r1');
    await expect(g.source.send('r1', 'hello')).resolves.toBe('sent');
    expect(sends(e)).toHaveLength(1);
    expect(g.source.snapshot().groups[0]).toMatchObject({ queued: [] });
  });
  it('is sent at once when the last Discussion is over, whatever its members said', async () => {
    const { e, g } = await open((x) => { crew(x); running(x, true); });
    await g.source.open('r1');
    expect(g.source.snapshot().groups[0]!.busy).toBe(false);
    await expect(g.source.send('r1', 'next')).resolves.toBe('sent');
    expect(sends(e)).toHaveLength(1);
  });
  it('is held, not sent, while a member is working: nothing is stopped and nothing reaches the engine', async () => {
    const { e, g, events } = await open((x) => { crew(x); running(x); });
    await g.source.open('r1');
    expect(g.source.snapshot().groups[0]).toMatchObject({ busy: true, working: ['atlas'] });
    await expect(g.source.send('r1', 'also check billing')).resolves.toBe('queued');
    expect(names(e)).toEqual([]);
    expect(g.source.snapshot().groups[0]!.queued).toMatchObject([{ text: 'also check billing' }]);
    expect(events.filter((x) => x.type === 'group').at(-1)).toMatchObject({ group: { queued: [{ text: 'also check billing' }] } });
    expect(JSON.stringify(g.source.snapshot().threads['r1'])).not.toMatch(/also check billing/);   // it is not in the room yet
  });
  it('is held in the gap between two members’ turns, when nobody is working but the Discussion is still open', async () => {
    const { e, g } = await open((x) => { crew(x); running(x); x.working = false; x.activity = []; });
    await g.source.open('r1');
    e.push('r1', 'message.member', { member_id: 'atlas', text: 'First part.' }, { kind: 'member', id: 'atlas', profile: 'atlas' });   // the log moves: the Discussion shows life
    expect(await g.source.send('r1', 'one more thing')).toBe('queued');
    expect(sends(e)).toEqual([]);
  });
  it('goes out once the Discussion is over, as one message in the same thread, and the held list empties', async () => {
    vi.useFakeTimers();
    try {
      let u: Json = {};
      const { e, g } = await open((x) => { crew(x); u = running(x); });
      await g.source.open('r1');
      await g.source.send('r1', 'also check billing');
      await vi.advanceTimersByTimeAsync(3000);
      expect(sends(e)).toEqual([]);   // still working
      finish(e, u);
      await vi.advanceTimersByTimeAsync(3000);
      expect(sends(e)).toMatchObject([{ room_id: 'r1', payload: { thread_id: 'main', text: 'also check billing' } }]);
      expect(g.source.snapshot().groups[0]!.queued).toEqual([]);
      expect(names(e)).toEqual(['groups.send']);   // never a stop
      expect(g.source.snapshot().threads['r1']!.map((m) => (m.kind === 'text' ? m.text : m.kind))).toEqual(['review the diff', 'Done.', 'also check billing']);
    } finally { vi.useRealTimers(); }
  });
  it('sends several held messages one at a time, each after the Discussion the one before opened is over', async () => {
    vi.useFakeTimers();
    try {
      let u: Json = {};
      const { e, g } = await open((x) => { crew(x); u = running(x); });
      await g.source.open('r1');
      await g.source.send('r1', 'first'); await g.source.send('r1', 'second');
      expect(g.source.snapshot().groups[0]!.queued.map((q) => q.text)).toEqual(['first', 'second']);
      finish(e, u);
      await vi.advanceTimersByTimeAsync(3000);
      expect(sends(e).map((p) => (p['payload'] as Json)['text'])).toEqual(['first']);   // the second waits for the first's answers
      expect(g.source.snapshot().groups[0]).toMatchObject({ busy: true, queued: [{ text: 'second' }] });
      const opened = e.logs['r1']!.filter((x) => x['kind'] === 'message.user').at(-1) as Json;
      finish(e, opened);
      await vi.advanceTimersByTimeAsync(3000);
      expect(sends(e).map((p) => (p['payload'] as Json)['text'])).toEqual(['first', 'second']);
      expect(g.source.snapshot().groups[0]!.queued).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('a Discussion with no sign of life for a while is taken as stuck, and the held message goes out', async () => {
    vi.useFakeTimers();
    try {
      const { e, g } = await open((x) => { crew(x); running(x); x.working = false; x.activity = []; });
      await g.source.open('r1');
      e.push('r1', 'message.member', { member_id: 'atlas', text: 'First part.' }, { kind: 'member', id: 'atlas', profile: 'atlas' });
      await g.source.send('r1', 'still there?');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sends(e)).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sends(e)).toMatchObject([{ payload: { text: 'still there?' } }]);
    } finally { vi.useRealTimers(); }
  });
  it('can be taken back before it is sent: its words come back and nothing is sent', async () => {
    vi.useFakeTimers();
    try {
      let u: Json = {};
      const { e, g } = await open((x) => { crew(x); u = running(x); });
      await g.source.open('r1');
      await g.source.send('r1', 'never mind this');
      const id = g.source.snapshot().groups[0]!.queued[0]!.id;
      expect(g.source.unqueue('r1', id)).toBe('never mind this');
      expect(g.source.unqueue('r1', id)).toBeNull();
      expect(g.source.snapshot().groups[0]!.queued).toEqual([]);
      finish(e, u);
      await vi.advanceTimersByTimeAsync(5000);
      expect(sends(e)).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('"send now" stops the running turns first and then sends, in that order, and says so by doing it', async () => {
    const { e, g } = await open((x) => { crew(x); running(x); });
    await g.source.open('r1');
    await expect(g.source.send('r1', 'drop that, do this', 'now')).resolves.toBe('sent');
    expect(names(e)).toEqual(['groups.stop', 'groups.send']);
    expect(g.source.snapshot().groups[0]!.queued).toEqual([]);
  });
  it('a held message sent now leaves the others held, and stops first', async () => {
    const { e, g } = await open((x) => { crew(x); running(x); });
    await g.source.open('r1');
    await g.source.send('r1', 'a'); await g.source.send('r1', 'b');
    const [, second] = g.source.snapshot().groups[0]!.queued;
    await g.source.sendNow('r1', second!.id);
    expect(names(e)).toEqual(['groups.stop', 'groups.send']);
    expect(sends(e)[0]).toMatchObject({ payload: { text: 'b' } });
    expect(g.source.snapshot().groups[0]!.queued.map((q) => q.text)).toEqual(['a']);
  });
  it('"send now" on a quiet room does not stop anything', async () => {
    const { e, g } = await open((x) => { crew(x); running(x, true); });
    await g.source.open('r1');
    await g.source.send('r1', 'hi', 'now');
    expect(names(e)).toEqual(['groups.send']);
  });
  it('a held message that the engine refuses says so in the thread and is not tried again', async () => {
    vi.useFakeTimers();
    try {
      let u: Json = {};
      const { e, g, events } = await open((x) => { crew(x); u = running(x); });
      await g.source.open('r1');
      await g.source.send('r1', 'doomed');
      const orig = e.call.bind(e);
      let tries = 0;
      e.call = (m, p) => { if (m === 'groups.send') { tries++; return Promise.reject(new Error('the room is gone')); } return orig(m, p); };
      finish(e, u);
      await vi.advanceTimersByTimeAsync(6000);
      expect(events.some((x) => x.type === 'message' && x.message.kind === 'note' && /The message was not sent: the room is gone/.test(x.message.text))).toBe(true);
      expect(g.source.snapshot().groups[0]!.queued).toEqual([]);
      expect(tries).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it('stopping the room also ends a Discussion that is between turns, and a stopped room is not busy', async () => {
    const { e, g } = await open((x) => { crew(x); running(x); x.working = false; x.activity = []; });
    await g.source.open('r1');
    e.push('r1', 'message.member', { member_id: 'atlas', text: 'First part.' }, { kind: 'member', id: 'atlas', profile: 'atlas' });
    e.emit({ type: 'groups.changed', payload: { room_ids: ['r1'] } });
    await tickAll(); await g.settled();
    expect(g.source.stop('r1')).toBe(true);
    expect(e.calls.map((c) => c.method)).toContain('groups.stop');
    e.push('r1', 'room.stop_requested', { cancel_id: 'x' });
    e.emit({ type: 'groups.changed', payload: { room_ids: ['r1'] } });
    await tickAll(); await g.settled();
    expect(g.source.snapshot().groups[0]!.busy).toBe(false);
  });
  it('says in the thread when a member’s answer was dropped because a newer message arrived', async () => {
    const { e, g } = await open(crew);
    e.push('r1', 'turn.cancelled', { member_id: 'nina', reason: 'superseded_by_newer_user_event' });
    e.push('r1', 'turn.cancelled', { member_id: 'atlas', reason: 'member turn cancelled' });
    await g.source.open('r1');
    expect(g.source.snapshot().threads['r1']).toMatchObject([{ kind: 'note', text: 'Nina’s turn was stopped because a newer message arrived, so its answer is not shown.' }]);
  });
  it('after a continue, the discussion is open again', async () => {
    const { e, g } = await open((x) => { crew(x); const u = running(x, true); x.push('r1', 'room.continued', { discussion_event_id: u['event_id'], thread_id: 'main', grant: 1 }); });
    await g.source.open('r1');
    expect(g.source.snapshot().groups[0]!.busy).toBe(false);   // open, but showed no life yet in this session: taken as not running
    void e;
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

describe('boopis’s own cap on rounds for a group', () => {
  const bridge = (kept: Map<string, number>): RoomsBridge => ({
    get: (id) => Promise.resolve({ rounds: kept.get(id) ?? null, fallback: 30 }),
    set: (id, rounds) => { if (rounds === null) kept.delete(id); else kept.set(id, rounds); return Promise.resolve({ rounds: kept.get(id) ?? null, fallback: 30 }); }
  });
  it('reads and keeps the cap through the host, and the engine is never asked', async () => {
    const kept = new Map<string, number>();
    const { e, g } = await open((x) => { x.rooms.push(room('r1', 'release crew', ['atlas', 'nina'])); }, bridge(kept));
    expect(await g.source.roundLimit('r1')).toEqual({ rounds: null, fallback: 30 });
    expect(await g.source.setRoundLimit('r1', 12)).toEqual({ rounds: 12, fallback: 30 });
    expect(await g.source.roundLimit('r1')).toEqual({ rounds: 12, fallback: 30 });
    expect(await g.source.setRoundLimit('r1', null)).toEqual({ rounds: null, fallback: 30 });
    expect(e.calls.some((c) => /max_rounds|max_messages|config\.set/.test(JSON.stringify(c)))).toBe(false);
  });
  it('says so where there is no host to keep it, and for a group that is not there', async () => {
    const { g } = await open((x) => { x.rooms.push(room('r1', 'release crew', ['atlas', 'nina'])); });
    expect(await g.source.roundLimit('r1')).toEqual({ rounds: null, fallback: ROUND_LIMIT_DEFAULT });
    await expect(g.source.setRoundLimit('r1', 12)).rejects.toThrow(/desktop app/);
    await expect(g.source.roundLimit('nope')).rejects.toThrow();
  });
});
