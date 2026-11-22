/* The live groups: the engine's Group Chat rooms (`groups.*`, ADR-0033), on the user's own link.
     a group                       a room: a name and two to six local profiles, `groups.create`, `groups.list`
     a message                     `groups.send`: the engine's room worker runs a Discussion: it hands the message to the members
                                   (all of them, or those the text names with `@handle`), each answers as its own profile,
                                   and the others read the answers in the next round (at most 3 rounds, 10 messages)
     the thread                    the room's log, `groups.log` read from a cursor: `message.user` and `message.member` are the
                                   messages, each member's by its member id; `turn.failed`, `member.unavailable` and a discussion
                                   paused at its cap (`room.activity` bounded) are lines the app says
     who is replying               `groups.state` (`driver_status.member_activity`)
     rename                        `groups.rename`; stop `groups.stop`; continue after the cap `groups.continue`
   The engine moves a room's log with `groups.changed`; a slow poll is only the backstop. A room's roster is frozen when it is
   made, and a room cannot be archived (only disbanded, for good): so changing members makes a new room with the same name,
   and archiving a group is boopis's own mark on this computer (`core/settings`), which a restore takes off. Replies arrive
   whole, not word by word: the engine publishes a member's message when the member has finished it. */
import { loadBots, saveBots } from '../../core/settings';
import { logger } from '../../core/log';
import { GROUP_NATURE } from '../../data/mock-groups';
import type { GroupsEvent, GroupsSnapshot, GroupsSource } from '../../data/provider';
import { emitter, feed, store } from '../../data/store';
import type { ArchivedGroup, Bot, Group, GroupMember, GroupMessage, GroupText, MemberActivity } from '../../data/types';
import type { GroupsListResult, GroupsLogResult, GroupsStateResult, Room, RoomEvent } from '../../vendor/hermes-shared/gateway-contract.generated';
import type { GatewayClient } from '../gateway';
import { clock } from '../map';
import { isUnknownMethod } from './wire';

const log = logger('live-groups');
const POLL_MS = 8_000;
const WORKING_MS = 1_200;
const MIN = 2, MAX = 6;
const THREAD = 'main';
export const NO_GROUPS = 'This version of boopis’s engine has no group chat.';
export const GROUPS_OFF = 'Group chat is not running in the engine. Restart boopis and try again.';

export interface GroupsDeps {
  client: GatewayClient;
  /** the bots the user has, for names when a group is made */
  bots(): readonly Bot[];
  now?: () => Date;
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

  const toGroup = (r: Rec): Group => ({ id: r.room.room_id, name: r.room.name, members: r.room.members.map(memberFrom), working: [...r.working], ...(r.activity.length ? { activity: [...r.activity] } : {}) });
  const nameOf = (r: Rec, id: string): string => r.room.members.map(memberFrom).find((m) => m.id === id)?.name ?? id;
  const live = (): Rec[] => [...recs.values()].filter((r) => !archivedIds.has(r.room.room_id));

  /* ───────── a room's log as the thread ───────── */
  /** a member's message: the round it answers in (0 is the answer to the user) and the members it was sent to, as the room says */
  function roundOf(p: Record<string, unknown>): Pick<GroupText, 'round' | 'to'> {
    const round = typeof p['round_index'] === 'number' && Number.isInteger(p['round_index']) && p['round_index'] >= 0 ? p['round_index'] : null;
    const to = Array.isArray(p['recipient_member_ids']) ? p['recipient_member_ids'].filter((x): x is string => typeof x === 'string' && !!x) : [];
    return { ...(round !== null ? { round } : {}), ...(to.length ? { to } : {}) };
  }
  /** the room's lead passing a message on (`room.assignment`): a quiet line, "kai gave this to nina and moss" */
  function assignmentNote(r: Rec, e: RoomEvent, t: string): GroupMessage | null {
    const p = e.payload ?? {};
    const lead = typeof p['lead_member_id'] === 'string' ? p['lead_member_id'] : '';
    const ids = Array.isArray(p['member_ids']) ? p['member_ids'].filter((x): x is string => typeof x === 'string') : [];
    if (!lead) return null;
    const others = ids.filter((x) => x !== lead).map((x) => nameOf(r, x));
    const text = p['fallback'] === true || !others.length ? nameOf(r, lead) + ' is answering this one.' : nameOf(r, lead) + ' gave this to ' + listWords(others) + '.';
    return { kind: 'note', id: e.event_id, t, text };
  }
  function messageOf(r: Rec, e: RoomEvent): GroupMessage | null {
    const p = e.payload ?? {};
    const t = clock(new Date((e.created_at ?? now().getTime() / 1000) * 1000));
    const text = typeof p['text'] === 'string' ? p['text'].trim() : '';
    switch (e.kind) {
      case 'message.user': return text ? { kind: 'text', id: e.event_id, who: 'you', t, text } : null;
      case 'message.member': return text ? { kind: 'text', id: e.event_id, who: String(p['member_id'] ?? e.actor?.id ?? ''), t, text, ...roundOf(p) } : null;
      case 'turn.failed': return { kind: 'note', id: e.event_id, t, text: nameOf(r, String(p['member_id'] ?? '')) + ' could not reply.' };
      case 'member.unavailable': return { kind: 'note', id: e.event_id, t, text: nameOf(r, String(p['member_id'] ?? '')) + ' is not available.' };
      case 'room.assignment': return assignmentNote(r, e, t);
      case 'room.stop_requested': return { kind: 'note', id: e.event_id, t, text: 'Stopped.' };
      case 'room.activity': return p['status'] === 'bounded' && typeof p['discussion_event_id'] === 'string' ? { kind: 'note', id: e.event_id, t, text: 'The conversation paused at its limit.', more: p['discussion_event_id'] } : null;
      default: return null;
    }
  }
  function ingest(r: Rec, evs: readonly RoomEvent[], announce: boolean): void {
    for (const e of evs) {
      if (r.seen.has(e.seq)) continue;
      r.seen.add(e.seq);
      r.cursor = Math.max(r.cursor, e.seq);
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
        if (/ahead of/.test(why(e))) { r.cursor = 0; r.seen.clear(); r.thread = []; continue; }
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
    const was = r.working.join(',') + '|' + JSON.stringify(r.activity);
    r.working = active;
    r.activity = acts.map(activityOf);
    if (was !== active.join(',') + '|' + JSON.stringify(r.activity)) events.emit({ type: 'group', group: toGroup(r) });
    return !!d?.working;
  }
  /** follows a room while its members work: the log and who is replying, until two reads in a row find it idle */
  function watch(r: Rec): void {
    if (r.watching) return;
    r.watching = true;
    void track((async () => {
      let idle = 0;
      try {
        for (let i = 0; i < 600 && idle < 2; i++) {
          await new Promise((res) => setTimeout(res, WORKING_MS));
          const busy = await readState(r);
          await readLog(r);
          idle = busy ? 0 : idle + 1;
        }
      } catch (e) { log.warn('a room could not be followed', e); }
      finally { r.watching = false; if (r.working.length) { r.working = []; r.activity = []; events.emit({ type: 'group', group: toGroup(r) }); } }
    })());
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
            const r: Rec = { room, thread: [], seen: new Set(), cursor: 0, loaded: false, working: [], activity: [], watching: false };
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
      await track(readLog(r).then(() => readState(r))).then(() => { if (r.working.length) watch(r); }, (e: unknown) => { log.warn('a room could not be read', e); });
    }
  }
  async function checkDriver(): Promise<void> {
    try {
      const cap = await client.request('groups.capabilities', {}) as { driver?: boolean };
      if (cap.driver === false && !unavailable) unavailable = GROUPS_OFF;
    } catch (e) { if (isUnknownMethod(e)) unavailable = NO_GROUPS; }
  }
  const need = (id: string): Rec => { const r = recs.get(id); if (!r) throw new Error('There is no group called ' + id + '.'); return r; };

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
      try { await readLog(r, false); await readState(r); events.emit({ type: 'thread', groupId: id, messages: [...r.thread] }); if (r.working.length) watch(r); }
      catch (e) { r.loaded = false; throw e; }
    },
    send(id, text) {
      const r = recs.get(id);
      if (!r) { log.warn('there is no group called ' + id); return; }
      const failed = (e: unknown): void => { log.error('the message to a group was not sent', e); events.emit({ type: 'message', groupId: id, message: { kind: 'note', id: 'n-' + uid(), t: clock(now()), text: 'The message was not sent: ' + why(e) } }); };
      void track(client.request('groups.send', { room_id: id, event_id: 'ui-' + uid(), payload: { thread_id: THREAD, text } }).then((res) => {
        ingest(r, [res.event], true);
        watch(r);
      }, failed));
    },
    stop(id) {
      const r = recs.get(id);
      if (!r || !r.working.length) return false;
      void client.request('groups.stop', { room_id: id, cancel_id: 'stop-' + uid() }).catch((e: unknown) => { log.warn('could not stop a group', e); });
      return true;
    },
    async continueTalk(id, more) { const r = need(id); await client.request('groups.continue', { room_id: id, discussion_event_id: more }); watch(r); },
    create,
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
  const poll = deps.pollMs === undefined ? POLL_MS : deps.pollMs;
  if (poll && typeof setInterval === 'function') setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void refreshOpen(null); }, poll);

  const ready = Promise.all([refreshRooms(), checkDriver()]).then(() => undefined);
  return { source, ready, settled: async () => { while (pending.size) await Promise.allSettled([...pending]); } };
}
