/* The live groups: the engine's Group Chat rooms (`groups.*`, ADR-0033), on the user's own link.
     a group                       a room: a name and two to six local profiles, `groups.create`, `groups.list`
     a message                     `groups.send`: the engine's room worker runs a Discussion: it hands the message to the members
                                   (all of them, or those the text names with `@handle`), each answers as its own profile,
                                   and the others read the answers in the next round (at most 3 rounds, 10 messages)
     the thread                    the room's log, `groups.log` read from a cursor: `message.user` and `message.member` are the
                                   messages, each member's by its member id; `turn.failed` (in boopis's words, `./turn-failed.ts`),
                                   `member.unavailable` and a discussion paused at its cap (`room.activity` bounded) are lines the app says
     who is replying               `groups.state` (`driver_status.member_activity`)
     rename                        `groups.rename`; stop `groups.stop`; continue after the cap `groups.continue`
     a message while members work  the engine runs one Discussion per thread, and a newer message in the thread ends it: a member
                                   still working has its answer dropped (`turn.cancelled`, `superseded_by_newer_user_event`,
                                   `gateway/hosted_room_discussion.py plan_publication`). The engine has no queue, steer or
                                   interjection for a room (`groups.send` is the only way in), so boopis holds the message
                                   until the Discussion is over (`room.activity` settled or bounded) and then sends it; "send now"
                                   stops the running turns first (`groups.stop`) and says so. The hold is the host's (`rooms/hold.rs`):
                                   one for this window, the command line and the local API, kept in a file so it survives the app
                                   closing; the host decides, sends and says what each room holds (`RoomsBridge`). `queued` here is
                                   only its mirror. Outside the desktop app there is no host, and a message goes straight in
   The engine moves a room's log with `groups.changed`; a slow poll is only the backstop. A room's roster is frozen when it is
   made, and a room cannot be archived (only disbanded, for good): so changing members makes a new room with the same name,
   and archiving a group is boopis's own mark on this computer (`core/settings`), which a restore takes off. Replies arrive
   whole, not word by word: the engine publishes a member's message when the member has finished it. */
import { loadBots, saveBots } from '../../core/settings';
import { logger } from '../../core/log';
import { GROUP_NATURE, ROUND_LIMIT_DEFAULT } from '../../data/mock-groups';
import type { GroupsEvent, GroupsSnapshot, GroupsSource } from '../../data/provider';
import { emitter, feed, store } from '../../data/store';
import type { ArchivedGroup, Bot, Group, GroupMember, GroupMessage, GroupQueued, GroupText, MemberActivity } from '../../data/types';
import type { GroupsListResult, GroupsLogResult, GroupsStateResult, Room, RoomEvent } from '../../vendor/hermes-shared/gateway-contract.generated';
import type { GatewayClient } from '../gateway';
import type { HeldMessage, RoomsBridge } from '../rooms-bridge';
import { clock } from '../map';
import { isUnknownMethod } from './wire';
import { turnFailedWords } from './turn-failed';

const log = logger('live-groups');
const POLL_MS = 8_000;
const WORKING_MS = 1_200;
const MIN = 2, MAX = 6;
const THREAD = 'main';
/** a Discussion that is open in the log but shows no sign of life (no turn running, nothing new in the log) for this long is
 *  taken as stuck: the engine's router waits 20 s at most and its worker polls every 5 s, so a healthy gap is far shorter */
const GRACE_MS = 45_000;
/** how long a room is followed for a held message (a turn may run half an hour: `turn_timeout_seconds` is 1830) */
const HOLD_WATCH_MS = 3 * 60 * 60_000;
export const NO_GROUPS = 'This version of boopis’s engine has no group chat.';
export const GROUPS_OFF = 'Group chat is not running in the engine. Restart boopis and try again.';

export interface GroupsDeps {
  client: GatewayClient;
  /** the bots the user has, for names when a group is made */
  bots(): readonly Bot[];
  now?: () => Date;
  /** the host's room settings (the cap on rounds for a run); null outside the desktop app */
  bridge?: RoomsBridge | null;
  /** how often the rooms are read again while the window is visible; null: never (tests) */
  pollMs?: number | null;
}
interface Rec {
  room: Room;
  thread: GroupMessage[];
  seen: Set<number>;
  cursor: number;
  loaded: boolean;
  working: string[];
  /** what each member at work is doing (`member_activity`) */
  activity: MemberActivity[];
  watching: boolean;
  /** the member who answers a new conversation first, when the room routes through a lead (`groups.state` context) */
  lead: string | null;
  /** the messages the host holds for this room until its Discussion is over (a mirror of `rooms/hold.rs`) */
  queue: GroupQueued[];
  /** what the log says of the Discussions, as the engine's `_pending_discussion` reads it (`gateway/hosted_room_discussion.py`) */
  latest: Map<string, { id: string; seq: number }>;
  done: Map<string, number>;
  continued: Map<string, number>;
  stopped: number;
  /** when a turn was last seen running, and when the log last moved (ms) */
  aliveAt: number;
}
/** one row of `member_activity` as the app reads it: the status the room names (anything else is running), the round, when it started, the tool */
export function activityOf(a: { member_id: string; status: string; round_index?: number | null; started_at?: number | null; tool?: string | null }): MemberActivity {
  const status = a.status === 'queued' || a.status === 'stopping' ? a.status : 'running';
  return { member: a.member_id, status, round: typeof a.round_index === 'number' ? a.round_index : null, startedAt: typeof a.started_at === 'number' ? a.started_at * 1000 : null, tool: typeof a.tool === 'string' && a.tool ? a.tool : null };
}
const listWords = (n: readonly string[]): string => (n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + (n[n.length - 1] ?? ''));
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const uid = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'group';

export function memberFrom(m: { member_id?: string | null; profile?: string | null; handle?: string | null; display_name?: string | null }): GroupMember {
  const profile = (m.profile ?? '').trim();
  const id = (m.member_id ?? profile).trim();
  return { id, profile, handle: (m.handle ?? profile).trim(), name: (m.display_name ?? '').trim() || profile || id };
}

export function createLiveGroups(deps: GroupsDeps) {
  const { client } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const recs = new Map<string, Rec>();
  const events = emitter<GroupsEvent>();
  const archivedIds = new Set<string>(loadBots().archivedGroups);
  const archivedList = store<readonly ArchivedGroup[]>([]);
  let unavailable: string | null = null;
  const pending = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { pending.add(p); const done = (): void => { pending.delete(p); }; p.then(done, done); return p; };

  /** a Discussion the room has not finished: the newest user message of a thread, not stopped and not closed by a
   *  `room.activity` (settled or bounded) that came after the last `room.continued` */
  const open = (r: Rec): boolean => {
    for (const u of r.latest.values()) if (u.seq > r.stopped && !((r.done.get(u.id) ?? 0) > (r.continued.get(u.id) ?? 0))) return true;
    return false;
  };
  /** members are working, or a Discussion is open and showed life lately: a message sent now would cut it short */
  const busyOf = (r: Rec): boolean => r.working.length > 0 || (open(r) && Date.now() - r.aliveAt < GRACE_MS);
  const toGroup = (r: Rec): Group => ({ id: r.room.room_id, name: r.room.name, members: r.room.members.map(memberFrom), working: [...r.working], busy: busyOf(r), queued: r.queue.map((q) => ({ ...q })), ...(r.activity.length ? { activity: [...r.activity] } : {}), ...(r.lead ? { lead: r.lead } : {}) });
  const signature = (r: Rec): string => r.working.join(',') + '|' + busyOf(r) + '|' + r.queue.map((q) => q.id).join(',') + '|' + JSON.stringify(r.activity) + '|' + (r.lead ?? '');
  const publish = (r: Rec): void => { if (!archivedIds.has(r.room.room_id)) events.emit({ type: 'group', group: toGroup(r) }); };
  const nameOf = (r: Rec, id: string): string => r.room.members.map(memberFrom).find((m) => m.id === id)?.name ?? id;
  /** the host's hold for a room, mirrored: what the strip shows */
  const setHeld = (r: Rec, held: readonly HeldMessage[]): void => {
    const next = held.map((h): GroupQueued => ({ id: h.id, text: h.text, t: h.at === null ? '' : clock(new Date(h.at * 1000)) }));
    if (next.map((q) => q.id).join() === r.queue.map((q) => q.id).join()) return;
    r.queue = next;
    publish(r);
    if (next.length) watch(r);
  };
  const live = (): Rec[] => [...recs.values()].filter((r) => !archivedIds.has(r.room.room_id));

  /* ───────── a room's log as the thread ───────── */
  /** a member's message: the round it answers in (0 is the answer to the user) and the members it was sent to, as the room says */
  function roundOf(p: Record<string, unknown>): Pick<GroupText, 'round' | 'to'> {
    const round = typeof p['round_index'] === 'number' && Number.isInteger(p['round_index']) && p['round_index'] >= 0 ? p['round_index'] : null;
    const to = Array.isArray(p['recipient_member_ids']) ? p['recipient_member_ids'].filter((x): x is string => typeof x === 'string' && !!x) : [];
    return { ...(round !== null ? { round } : {}), ...(to.length ? { to } : {}) };
  }
  /** the room's lead passing a message on (`room.assignment`): a hand-off, "kai gave this to nina and moss" (the lead keeping it is a quiet line) */
  function assignmentNote(r: Rec, e: RoomEvent, t: string): GroupMessage | null {
    const p = e.payload ?? {};
    const lead = typeof p['lead_member_id'] === 'string' ? p['lead_member_id'] : '';
    const ids = Array.isArray(p['member_ids']) ? p['member_ids'].filter((x): x is string => typeof x === 'string') : [];
    if (!lead) return null;
    const to = ids.filter((x) => x !== lead);
    /* the lead kept it (it answers itself, or the engine fell back to it): no work changed hands, so it is a plain line */
    if (p['fallback'] === true || !to.length) return { kind: 'note', id: e.event_id, t, text: nameOf(r, lead) + ' is answering this one.' };
    return { kind: 'note', id: e.event_id, t, text: nameOf(r, lead) + ' gave this to ' + listWords(to.map((x) => nameOf(r, x))) + '.', handoff: { from: lead, to } };
  }
  function messageOf(r: Rec, e: RoomEvent): GroupMessage | null {
    const p = e.payload ?? {};
    const t = clock(new Date((e.created_at ?? now().getTime() / 1000) * 1000));
    const text = typeof p['text'] === 'string' ? p['text'].trim() : '';
    switch (e.kind) {
      case 'message.user': return text ? { kind: 'text', id: e.event_id, who: 'you', t, text } : null;
      case 'message.member': return text ? { kind: 'text', id: e.event_id, who: String(p['member_id'] ?? e.actor?.id ?? ''), t, text, ...roundOf(p) } : null;
      case 'turn.failed': return { kind: 'note', id: e.event_id, t, text: turnFailedWords(nameOf(r, String(p['member_id'] ?? '')), typeof p['error'] === 'string' ? p['error'] : '', typeof p['reason_code'] === 'string' ? p['reason_code'] : null) };
      case 'member.unavailable': return { kind: 'note', id: e.event_id, t, text: nameOf(r, String(p['member_id'] ?? '')) + ' is not available.' };
      case 'room.assignment': return assignmentNote(r, e, t);
      case 'turn.cancelled': return p['reason'] === 'superseded_by_newer_user_event' ? { kind: 'note', id: e.event_id, t, text: nameOf(r, String(p['member_id'] ?? '')) + '’s turn was stopped because a newer message arrived, so its answer is not shown.' } : null;
      case 'room.stop_requested': return { kind: 'note', id: e.event_id, t, text: 'Stopped.' };
      case 'room.activity': return p['status'] === 'bounded' && typeof p['discussion_event_id'] === 'string' ? { kind: 'note', id: e.event_id, t, text: 'The conversation paused at its limit.', more: p['discussion_event_id'] } : null;
      default: return null;
    }
  }
  /** what an event does to the room's Discussions (the engine's own reading of its log) */
  function follow(r: Rec, e: RoomEvent): void {
    const p = e.payload ?? {};
    const id = typeof p['discussion_event_id'] === 'string' ? p['discussion_event_id'] : '';
    switch (e.kind) {
      case 'message.user': r.latest.set(typeof p['thread_id'] === 'string' ? p['thread_id'] : THREAD, { id: e.event_id, seq: e.seq }); break;
      case 'room.activity': if (id && (p['status'] === 'settled' || p['status'] === 'bounded')) r.done.set(id, Math.max(r.done.get(id) ?? 0, e.seq)); break;
      case 'room.continued': if (id) r.continued.set(id, Math.max(r.continued.get(id) ?? 0, e.seq)); break;
      case 'room.stop_requested': r.stopped = Math.max(r.stopped, e.seq); break;
      default: break;
    }
  }
  function ingest(r: Rec, evs: readonly RoomEvent[], announce: boolean): void {
    for (const e of evs) {
      if (r.seen.has(e.seq)) continue;
      r.seen.add(e.seq);
      r.cursor = Math.max(r.cursor, e.seq);
      follow(r, e);
      if (announce) r.aliveAt = Date.now();
      const m = messageOf(r, e);
      if (!m || r.thread.some((x) => x.id === m.id)) continue;
      r.thread.push(m);
      if (announce) events.emit({ type: 'message', groupId: r.room.room_id, message: m });
    }
  }
  async function readLog(r: Rec, announce = true): Promise<void> {
    for (let guard = 0; guard < 50; guard++) {
      let page: GroupsLogResult;
      try { page = await client.request('groups.log', { room_id: r.room.room_id, since_seq: r.cursor, limit: 200 }); }
      catch (e) {
        if (/ahead of/.test(why(e))) { r.cursor = 0; r.seen.clear(); r.thread = []; r.latest.clear(); r.done.clear(); r.continued.clear(); r.stopped = 0; continue; }
        throw e;
      }
      ingest(r, page.events ?? [], announce);
      if (!page.has_more) return;
    }
  }
  async function readState(r: Rec): Promise<boolean> {
    const st = await client.request('groups.state', { room_id: r.room.room_id }) as GroupsStateResult;
    r.room = { ...r.room, ...st.room };
    const d = st.driver_status;
    const acts = d?.working ? (d.member_activity ?? []) : [];
    const active = acts.map((a) => a.member_id);
    const was = signature(r);
    r.working = active;
    r.activity = acts.map(activityOf);
    /* the engine routes a new conversation through the lead only when the message names nobody; an @name brings that member in at
       once (gateway/hosted_room_lead.py `routes_through_lead`), which the room says */
    const ctx = st.context;
    r.lead = ctx?.routing === 'lead' && ctx.lead_member_id ? ctx.lead_member_id : null;
    if (active.length) r.aliveAt = Date.now();
    if (was !== signature(r)) publish(r);
    return !!d?.working;
  }
  /** follows a room while its members work (and while the host holds a message for them): the log and who is replying, until two
   *  reads in a row find it idle. The host sends a held message when the Discussion is over. */
  function watch(r: Rec): void {
    if (r.watching) return;
    r.watching = true;
    void track((async () => {
      let idle = 0;
      const began = Date.now();
      try {
        for (let i = 0; ; i++) {
          const holding = r.queue.length > 0;
          if (holding ? Date.now() - began > HOLD_WATCH_MS : idle >= 2 || i >= 600) break;
          await new Promise((res) => setTimeout(res, i < 250 ? WORKING_MS : 5 * WORKING_MS));
          const busy = await readState(r);
          await readLog(r);
          idle = busy || busyOf(r) ? 0 : idle + 1;
        }
      } catch (e) { log.warn('a room could not be followed', e); }
      finally { r.watching = false; if (r.working.length) { r.working = []; r.activity = []; publish(r); } }
    })());
  }
  /** the message into the room, straight in: outside the desktop app only (no host, so no hold); true when the engine took it */
  async function post(r: Rec, text: string): Promise<boolean> {
    const id = r.room.room_id;
    try {
      const res = await track(client.request('groups.send', { room_id: id, event_id: 'ui-' + uid(), payload: { thread_id: THREAD, text } }));
      ingest(r, [res.event], true);
      publish(r);
      watch(r);
      return true;
    } catch (e) {
      log.error('the message to a group was not sent', e);
      events.emit({ type: 'message', groupId: id, message: { kind: 'note', id: 'n-' + uid(), t: clock(now()), text: 'The message was not sent: ' + why(e) } });
      return false;
    }
  }
  /** the room as it is now, so that a message is held or sent on what the engine says and not on a poll's last answer */
  async function fresh(r: Rec): Promise<void> {
    try { await readLog(r); await readState(r); } catch (e) { log.warn('a room could not be read before a message', e); }
  }

  /* ───────── the rooms ───────── */
  function publishArchived(): void {
    archivedList.set([...recs.values()].filter((r) => archivedIds.has(r.room.room_id)).map((r): ArchivedGroup => ({ id: r.room.room_id, name: r.room.name, members: r.room.members.map(memberFrom) })));
  }
  let refreshing: Promise<void> | null = null;
  function refreshRooms(): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = track((async () => {
      try {
        const res = await client.request('groups.list', { limit: 500 }) as GroupsListResult;
        unavailable = null;
        const rooms = (res.rooms ?? []).filter((x) => !x.disbanded_at);
        const ids = new Set(rooms.map((x) => x.room_id));
        for (const room of rooms) {
          const had = recs.get(room.room_id);
          if (!had) {
            const r: Rec = { room, thread: [], seen: new Set(), cursor: 0, loaded: false, working: [], activity: [], watching: false, lead: null, queue: [], latest: new Map(), done: new Map(), continued: new Map(), stopped: 0, aliveAt: 0 };
            recs.set(room.room_id, r);
            if (!archivedIds.has(room.room_id)) events.emit({ type: 'group-created', group: toGroup(r) });
          } else if (had.room.name !== room.name || had.room.revision !== room.revision) {
            had.room = { ...had.room, ...room };
            if (!archivedIds.has(room.room_id)) events.emit({ type: 'group', group: toGroup(had) });
          }
        }
        for (const [id, r] of recs) if (!ids.has(id)) { recs.delete(id); if (!archivedIds.has(id)) events.emit({ type: 'group-archived', id }); void r; }
        publishArchived();
      } catch (e) {
        unavailable = isUnknownMethod(e) ? NO_GROUPS : 'Groups could not be read: ' + why(e);
        (isUnknownMethod(e) ? log.info : log.warn)('groups.list failed', e);
      }
    })().finally(() => { refreshing = null; }));
    return refreshing;
  }
  async function refreshOpen(ids?: readonly string[] | null): Promise<void> {
    await refreshRooms();
    for (const r of recs.values()) {
      if (!r.loaded || (ids && !ids.includes(r.room.room_id))) continue;
      await track(readLog(r).then(() => readState(r))).then(() => { if (r.working.length || r.queue.length) watch(r); }, (e: unknown) => { log.warn('a room could not be read', e); });
    }
  }
  async function checkDriver(): Promise<void> {
    try {
      const cap = await client.request('groups.capabilities', {}) as { driver?: boolean };
      if (cap.driver === false && !unavailable) unavailable = GROUPS_OFF;
    } catch (e) { if (isUnknownMethod(e)) unavailable = NO_GROUPS; }
  }
  const need = (id: string): Rec => { const r = recs.get(id); if (!r) throw new Error('There is no group called ' + id + '.'); return r; };

  /** `groups.stop`: the running turns end and the Discussion with them (the engine's stop fence) */
  async function halt(r: Rec): Promise<void> {
    try { await client.request('groups.stop', { room_id: r.room.room_id, cancel_id: 'stop-' + uid() }); }
    catch (e) { log.warn('could not stop a group', e); }
    watch(r);
  }

  /* ───────── the source ───────── */
  const snapshot = (): GroupsSnapshot => ({ groups: live().map(toGroup), threads: Object.fromEntries(live().map((r) => [r.room.room_id, [...r.thread]])) });
  async function create(draft: { name: string; bots: readonly string[] }): Promise<Group> {
    const picked = [...new Set(draft.bots)];
    if (picked.length < MIN || picked.length > MAX) throw new Error('A group is ' + MIN + ' to ' + MAX + ' bots.');
    const members = picked.map((id) => {
      const b = deps.bots().find((x) => x.id === id);
      if (!b) throw new Error(id + ' is not a bot you have.');
      return { member_id: id, profile: id, handle: id, display_name: b.name };
    });
    const name = draft.name.trim() || members.map((m) => m.display_name).join(', ');
    const res = await client.request('groups.create', { room_id: 'g-' + slug(name) + '-' + uid(), name, members });
    await refreshRooms();
    const r = recs.get(res.room.room_id);
    if (!r) throw new Error('The group was made but could not be read back.');
    r.loaded = true;
    return toGroup(r);
  }
  const source: GroupsSource = {
    ...feed<GroupsSnapshot, GroupsEvent>(snapshot, events),
    nature: GROUP_NATURE,
    limits: { min: MIN, max: MAX },
    note: () => unavailable,
    async open(id) {
      const r = need(id);
      if (r.loaded) return;
      r.loaded = true;
      try {
        await readLog(r, false); await readState(r);
        events.emit({ type: 'thread', groupId: id, messages: [...r.thread] });
        if (deps.bridge) setHeld(r, await deps.bridge.held(id));
        if (r.working.length) watch(r);
      }
      catch (e) { r.loaded = false; throw e; }
    },
    async send(id, text, how = 'when-done') {
      const r = recs.get(id);
      if (!r) { log.warn('there is no group called ' + id); return 'sent'; }
      if (!r.loaded) { try { await source.open(id); } catch (e) { log.warn('a room could not be read before a message', e); } }
      if (!deps.bridge) {
        await fresh(r);
        if (how === 'now' && busyOf(r)) await halt(r);
        await post(r, text);
        return 'sent';
      }
      try {
        const res = await deps.bridge.send(id, text, how === 'now');
        setHeld(r, res.held);
        if (res.status === 'held') { watch(r); return 'queued'; }
        await fresh(r);
        watch(r);
        return 'sent';
      } catch (e) {
        log.error('the message to a group was not sent', e);
        events.emit({ type: 'message', groupId: id, message: { kind: 'note', id: 'n-' + uid(), t: clock(now()), text: 'The message was not sent: ' + why(e) } });
        return 'sent';
      }
    },
    unqueue(id, queuedId) {
      const r = recs.get(id);
      const at = r ? r.queue.findIndex((q) => q.id === queuedId) : -1;
      if (!r || at < 0) return null;
      const [gone] = r.queue.splice(at, 1) as [GroupQueued];
      publish(r);
      /* the words come back at once; the host takes it out of its hold, or says it had already gone out */
      if (deps.bridge) {
        void track(deps.bridge.unhold(id, queuedId).then((res) => {
          setHeld(r, res.held);
          if (res.text === null) events.emit({ type: 'message', groupId: id, message: { kind: 'note', id: 'n-' + uid(), t: clock(now()), text: 'That message had already gone out before it was taken back.' } });
        }, (e: unknown) => { log.warn('a held message could not be taken back', e); }));
      }
      return gone.text;
    },
    async sendNow(id, queuedId) {
      const r = need(id);
      if (!deps.bridge) return;
      const res = await deps.bridge.sendNow(id, queuedId);
      setHeld(r, res.held);
      await fresh(r);
      watch(r);
    },
    stop(id) {
      const r = recs.get(id);
      if (!r || !busyOf(r)) return false;
      void halt(r);
      return true;
    },
    async continueTalk(id, more) { const r = need(id); await client.request('groups.continue', { room_id: id, discussion_event_id: more }); watch(r); },
    create,
    async roundLimit(id) {
      need(id);
      if (!deps.bridge) return { rounds: null, fallback: ROUND_LIMIT_DEFAULT };
      return deps.bridge.get(id);
    },
    async setRoundLimit(id, rounds) {
      need(id);
      if (!deps.bridge) throw new Error('The limit can be set in the desktop app.');
      return deps.bridge.set(id, rounds);
    },
    async rename(id, name) {
      const r = need(id);
      const n = name.trim();
      if (!n) throw new Error('A group needs a name.');
      const res = await client.request('groups.rename', { room_id: id, event_id: 'rn-' + uid(), name: n });
      r.room = { ...r.room, ...res.room };
      events.emit({ type: 'group', group: toGroup(r) });
    },
    async setMembers(id, bots) {
      const old = need(id);
      const made = await create({ name: old.room.name, bots });
      await source.archive(id);
      return made;
    },
    archive(id) {
      need(id);
      archivedIds.add(id);
      saveBots({ archivedGroups: [...archivedIds] });
      publishArchived();
      events.emit({ type: 'group-archived', id });
      return Promise.resolve({ undo: () => source.restore(id) });
    },
    archived: archivedList,
    restore(id) {
      const r = need(id);
      archivedIds.delete(id);
      saveBots({ archivedGroups: [...archivedIds] });
      publishArchived();
      events.emit({ type: 'group-created', group: toGroup(r) });
      return Promise.resolve();
    }
  };

  /* ───────── the link ───────── */
  client.onEvent((ev) => {
    if (ev.type !== 'groups.changed') return;
    const ids = Array.isArray(ev.payload?.['room_ids']) ? (ev.payload['room_ids'] as string[]) : null;
    void refreshOpen(ids);
  });
  client.onState((s) => { if (s.phase === 'ready' && s.reconnected) void refreshOpen(null); });
  /* what a room holds changed in the host (a message held, sent or taken back, from this window, the command line or the local API) */
  if (deps.bridge) void deps.bridge.onHeld((roomId, held) => { const r = recs.get(roomId); if (r) setHeld(r, held); }).catch((e: unknown) => { log.warn('the room hold cannot be followed', e); });
  const poll = deps.pollMs === undefined ? POLL_MS : deps.pollMs;
  if (poll && typeof setInterval === 'function') setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void refreshOpen(null); }, poll);

  const ready = Promise.all([refreshRooms(), checkDriver()]).then(() => undefined);
  return { source, ready, settled: async () => { while (pending.size) await Promise.allSettled([...pending]); } };
}
