/* The mock provider's groups: rooms kept in memory, with replies written here. The live provider's are the engine's rooms
   (`host/live/groups.ts`). `simulate: false` keeps the page still (tests and the lab): a message is added and nobody answers. */
import type { ArchivedGroup, Bot, Group, GroupMember, GroupMessage } from './types';
import type { GroupsEvent, GroupsSnapshot, GroupsSource } from './provider';
import { emitter, feed, store } from './store';

const hhmm = (): string => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
let n = 0;
const gid = (p: string): string => p + (++n).toString(36);

/** the cap a group without its own has (`rooms/settings.rs`) */
export const ROUND_LIMIT_DEFAULT = 30;
export const GROUP_NATURE = 'Each member reads what you write and what the others said, and answers in its own words. Write @name to ask one of them.';
export const memberOf = (b: Pick<Bot, 'id' | 'name'>): GroupMember => ({ id: b.id, profile: b.id, handle: b.id, name: b.name });

export interface MockGroupsOptions { bots: () => readonly Bot[]; simulate: boolean; seed: boolean }

export function createMockGroups(o: MockGroupsOptions): GroupsSource {
  const ev = emitter<GroupsEvent>();
  const groups: Group[] = [];
  const threads: Record<string, GroupMessage[]> = {};
  const archivedList = store<readonly ArchivedGroup[]>([]);
  const kept = new Map<string, { group: Group; thread: GroupMessage[] }>();
  const limits = new Map<string, number>();
  const find = (id: string): Group => { const g = groups.find((x) => x.id === id); if (!g) throw new Error('There is no group called ' + id + '.'); return g; };
  const botsOf = (ids: readonly string[]): GroupMember[] => ids.map((id) => { const b = o.bots().find((x) => x.id === id); if (!b) throw new Error(id + ' is not a bot you have.'); return memberOf(b); });
  const post = (groupId: string, m: GroupMessage): void => { (threads[groupId] ??= []).push(m); ev.emit({ type: 'message', groupId, message: m }); };
  const text = (who: string, t: string): GroupMessage => ({ kind: 'text', id: gid('g'), who, t: hhmm(), text: t });

  if (o.seed) {
    const have = o.bots();
    const pick = have.slice(0, 3);
    if (pick.length >= 2) {
      const g: Group = { id: 'room-release', name: 'release crew', members: pick.map(memberOf), working: [] };
      groups.push(g);
      threads[g.id] = [
        text('you', 'Is Friday’s release safe to cut? @' + pick[0]!.id + ' what changed, @' + (pick[1]?.id ?? '') + ' what is left to deploy.'),
        text(pick[0]!.id, 'Eleven commits since the last tag, none touching billing. The risky one is the migration in 0142.'),
        text(pick[1]!.id, 'Staging is green. I would deploy after the migration has run once on the copy of production.'),
        ...(pick[2] ? [text(pick[2].id, 'I can write the notes while you decide. Nothing in the diff needs a heads-up to support.')] : [])
      ];
    }
  }
  const nameList = (g: Group, who: readonly string[]): string => who.map((w) => g.members.find((m) => m.id === w)?.name ?? w).join(' and ');
  const addressed = (g: Group, t: string): GroupMember[] => {
    const hit = g.members.filter((m) => new RegExp('@' + m.handle + '(?![\\w.:-])', 'i').test(t));
    return /@(all|everyone)\b/i.test(t) || !hit.length ? [...g.members] : hit;
  };

  const source: GroupsSource = {
    ...feed<GroupsSnapshot, GroupsEvent>(() => ({ groups: groups.map((g) => ({ ...g })), threads: Object.fromEntries(Object.entries(threads).map(([k, v]) => [k, [...v]])) }), ev),
    nature: GROUP_NATURE,
    limits: { min: 2, max: 6 },
    note: () => null,
    open: () => Promise.resolve(),
    send(groupId, t) {
      const g = find(groupId);
      post(groupId, text('you', t));
      if (!o.simulate) return;
      const who = addressed(g, t);
      g.working = who.map((m) => m.id);
      ev.emit({ type: 'group', group: { ...g } });
      who.forEach((m, i) => window.setTimeout(() => {
        if (!g.working.includes(m.id)) return;
        post(groupId, text(m.id, 'Seen. I will take my part and say so here when it is done.'));
        g.working = g.working.filter((x) => x !== m.id);
        ev.emit({ type: 'group', group: { ...g } });
      }, 700 + i * 900));
      void nameList;
    },
    stop(groupId) { const g = find(groupId); const was = g.working.length > 0; g.working = []; if (was) ev.emit({ type: 'group', group: { ...g } }); return was; },
    continueTalk: () => Promise.resolve(),
    roundLimit: (id) => Promise.resolve({ rounds: limits.get(id) ?? null, fallback: ROUND_LIMIT_DEFAULT }),
    setRoundLimit(id, rounds) {
      if (rounds === null) limits.delete(id);
      else if (Number.isInteger(rounds) && rounds >= 1 && rounds <= 1000) limits.set(id, rounds);
      else return Promise.reject(new Error('A group runs for 1 to 1000 rounds.'));
      return Promise.resolve({ rounds: limits.get(id) ?? null, fallback: ROUND_LIMIT_DEFAULT });
    },
    create(draft) {
      if (draft.bots.length < 2 || draft.bots.length > 6) return Promise.reject(new Error('A group is two to six bots.'));
      const g: Group = { id: gid('room-'), name: draft.name.trim() || 'new group', members: botsOf(draft.bots), working: [] };
      groups.push(g); threads[g.id] = [];
      ev.emit({ type: 'group-created', group: { ...g } });
      return Promise.resolve({ ...g });
    },
    rename(id, name) { const g = find(id); const i = groups.indexOf(g); groups[i] = { ...g, name: name.trim() || g.name }; ev.emit({ type: 'group', group: { ...groups[i]! } }); return Promise.resolve(); },
    async setMembers(id, bots) {
      const old = find(id);
      const made = await source.create({ name: old.name, bots });
      await source.archive(id);
      return made;
    },
    archive(id) {
      const g = find(id);
      groups.splice(groups.indexOf(g), 1);
      kept.set(id, { group: g, thread: threads[id] ?? [] });
      archivedList.set([{ id, name: g.name, members: g.members }, ...archivedList.get()]);
      ev.emit({ type: 'group-archived', id });
      return Promise.resolve({ undo: () => source.restore(id) });
    },
    archived: archivedList,
    restore(id) {
      const k = kept.get(id); if (!k) return Promise.reject(new Error('That group is not archived.'));
      kept.delete(id);
      archivedList.set(archivedList.get().filter((a) => a.id !== id));
      groups.push(k.group); threads[id] = k.thread;
      ev.emit({ type: 'group-created', group: { ...k.group } });
      return Promise.resolve();
    }
  };
  return source;
}
