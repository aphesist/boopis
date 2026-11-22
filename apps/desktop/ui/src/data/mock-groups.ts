/* The mock provider's groups: rooms kept in memory, with replies written here. The live provider's are the engine's rooms
   (`host/live/groups.ts`). `simulate: false` keeps the page still (tests and the lab): a message is added and nobody answers. */
import type { ArchivedGroup, Bot, Group, GroupMember, GroupMessage } from './types';
import type { GroupsEvent, GroupsSnapshot, GroupsSource } from './provider';
import { emitter, feed, store } from './store';

const hhmm = (): string => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
let n = 0;
const gid = (p: string): string => p + (++n).toString(36);

export const GROUP_NATURE = 'Each member reads what you write and what the others said, and answers in its own words. Write @name to ask one of them.';
export const memberOf = (b: Pick<Bot, 'id' | 'name'>): GroupMember => ({ id: b.id, profile: b.id, handle: b.id, name: b.name });

export interface MockGroupsOptions { bots: () => readonly Bot[]; simulate: boolean; seed: boolean; /** the second sample room: a team at work on an episode (markdown, mentions, paths, code, rounds) */ paper?: boolean }

export function createMockGroups(o: MockGroupsOptions): GroupsSource {
  const ev = emitter<GroupsEvent>();
  const groups: Group[] = [];
  const threads: Record<string, GroupMessage[]> = {};
  const archivedList = store<readonly ArchivedGroup[]>([]);
  const kept = new Map<string, { group: Group; thread: GroupMessage[] }>();
  const find = (id: string): Group => { const g = groups.find((x) => x.id === id); if (!g) throw new Error('There is no group called ' + id + '.'); return g; };
  const botsOf = (ids: readonly string[]): GroupMember[] => ids.map((id) => { const b = o.bots().find((x) => x.id === id); if (!b) throw new Error(id + ' is not a bot you have.'); return memberOf(b); });
  const post = (groupId: string, m: GroupMessage): void => { (threads[groupId] ??= []).push(m); ev.emit({ type: 'message', groupId, message: m }); };
  const text = (who: string, t: string, round?: number, to?: readonly string[]): GroupMessage => ({ kind: 'text', id: gid('g'), who, t: hhmm(), text: t, ...(round != null ? { round } : {}), ...(to?.length ? { to } : {}) });

  if (o.seed) {
    const have = o.bots();
    const pick = have.slice(0, 3);
    if (pick.length >= 2) {
      const g: Group = { id: 'room-release', name: 'release crew', members: pick.map(memberOf), working: [], busy: false, queued: [] };
      groups.push(g);
      threads[g.id] = [
        text('you', 'Is Friday’s release safe to cut? @' + pick[0]!.id + ' what changed, @' + (pick[1]?.id ?? '') + ' what is left to deploy.'),
        text(pick[0]!.id, 'Eleven commits since the last tag, none touching billing. The risky one is the migration in 0142.', 0),
        text(pick[1]!.id, 'Staging is green. I would deploy after the migration has run once on the copy of production.', 0),
        ...(pick[2] ? [text(pick[2].id, 'I can write the notes while you decide. Nothing in the diff needs a heads-up to support.', 0)] : [])
      ];
    }
  }
  if (o.paper) {
    const team = ['kai', 'nina', 'moss', 'iris', 'hex', 'nimbus'].map((id) => o.bots().find((b) => b.id === id)).filter((b): b is Bot => !!b);
    if (team.length === 6) {
      const g: Group = { id: 'room-paper', name: 'paper past', members: team.map(memberOf), working: [], busy: false, queued: [] };
      groups.push(g);
      /* the sample room has a fixed clock, so what it draws does not change with the minute */
      threads[g.id] = PAPER_PAST.map((m, i) => ({ ...text(m.who, m.text, m.round, m.to), t: '09:' + String(2 + i).padStart(2, '0') }) as GroupMessage);
    }
  }
  const addressed = (g: Group, t: string): GroupMember[] => {
    const hit = g.members.filter((m) => new RegExp('@' + m.handle + '(?![\\w.:-])', 'i').test(t));
    return /@(all|everyone)\b/i.test(t) || !hit.length ? [...g.members] : hit;
  };

  /** the message into the room, and (when the page simulates) the members' replies; the next held message goes when they are done */
  function deliver(g: Group, t: string): void {
    post(g.id, text('you', t));
    if (!o.simulate) { ev.emit({ type: 'group', group: { ...g } }); return; }
    const who = addressed(g, t);
    g.working = who.map((m) => m.id); g.busy = true;
    const started = Date.now();
    const act = (): void => { g.activity = g.working.map((id, k) => ({ member: id, status: k === 0 ? 'running' as const : 'queued' as const, round: 0, startedAt: k === 0 ? started : null, tool: null })); };
    act();
    ev.emit({ type: 'group', group: { ...g } });
    who.forEach((m, i) => window.setTimeout(() => {
      if (!g.working.includes(m.id)) return;
      post(g.id, text(m.id, 'Seen. I will take my part and say so here when it is done.', 0, ['you']));
      g.working = g.working.filter((x) => x !== m.id);
      act();
      const next = g.working.length ? undefined : g.queued[0];
      if (next) { g.queued = g.queued.slice(1); deliver(g, next.text); return; }
      g.busy = g.working.length > 0;
      ev.emit({ type: 'group', group: { ...g } });
    }, 700 + i * 900));
  }

  const source: GroupsSource = {
    ...feed<GroupsSnapshot, GroupsEvent>(() => ({ groups: groups.map((g) => ({ ...g })), threads: Object.fromEntries(Object.entries(threads).map(([k, v]) => [k, [...v]])) }), ev),
    nature: GROUP_NATURE,
    limits: { min: 2, max: 6 },
    note: () => null,
    open: () => Promise.resolve(),
    send(groupId, t, how = 'when-done') {
      const g = find(groupId);
      if (g.working.length && how === 'when-done') {
        g.queued = [...g.queued, { id: gid('q'), text: t, t: hhmm() }];
        ev.emit({ type: 'group', group: { ...g } });
        return Promise.resolve('queued');
      }
      if (g.working.length) g.working = [];
      deliver(g, t);
      return Promise.resolve('sent');
    },
    unqueue(groupId, queuedId) {
      const g = find(groupId);
      const at = g.queued.find((q) => q.id === queuedId);
      if (!at) return null;
      g.queued = g.queued.filter((q) => q !== at);
      ev.emit({ type: 'group', group: { ...g } });
      return at.text;
    },
    sendNow(groupId, queuedId) {
      const g = find(groupId);
      const at = g.queued.find((q) => q.id === queuedId);
      if (!at) return Promise.resolve();
      g.queued = g.queued.filter((q) => q !== at);
      g.working = [];
      deliver(g, at.text);
      return Promise.resolve();
    },
    stop(groupId) { const g = find(groupId); const was = g.working.length > 0; g.working = []; delete g.activity; g.busy = false; if (was) ev.emit({ type: 'group', group: { ...g } }); return was; },
    continueTalk: () => Promise.resolve(),
    create(draft) {
      if (draft.bots.length < 2 || draft.bots.length > 6) return Promise.reject(new Error('A group is two to six bots.'));
      const g: Group = { id: gid('room-'), name: draft.name.trim() || 'new group', members: botsOf(draft.bots), working: [], busy: false, queued: [] };
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

const EP = 'episodes/2026-11-22-cooking-pot/';
/** the second sample room's thread (the chat research's "paper past" team): round 0 answers the user; later rounds are the bots
    among themselves, each sent to the teammates its mentions name */
const PAPER_PAST: ReadonlyArray<{ who: string; text: string; round?: number; to?: readonly string[] }> = [
  { who: 'you', text: 'Dry run for today: the medieval cooking pot. @kai you lead; nothing gets rendered or posted.' },
  { who: 'kai', round: 0, text: 'On it. I made `' + EP + '` with an empty `episode.json` and put three cards on the board.\n\n@nina research and script first: five beats, a source for every date. @moss waits for my fact-check before translating.' },
  { who: 'nina', round: 1, to: ['kai'], text: '**Research is in** `' + EP + 'research.md`, seven sources.\n\n- **Dates:** the hanging cauldron is the household pot from about 1300 to 1450; bronze for the rich, iron and clay for most.\n- **Beat 3:** pottage was the daily meal, mostly grain and what the garden gave ([household accounts, 1340s](https://example.org/household-accounts-1340)).\n- **Beat 5:** *a pot that was never emptied* is a popular claim. I found no source, so I flagged it for @kai to check.' },
  { who: 'kai', round: 2, to: ['moss'], text: 'Fact-check is in `' + EP + 'factcheck.md`. Beat 5 changes:\n\n> **Before:** "A pot hangs over the fire for months and is never emptied."\n> **After:** "A pot hangs over the fire all day, and the cook adds whatever there is."\n\nThe *months* claim has no source, so it goes. @moss translate this version, not the draft.' },
  { who: 'moss', round: 3, to: ['hex'], text: 'Beat 5 follows kai\'s correction in both languages:\n\n- **Vocabulary:** *caldeirão* in PT-BR and *caldero* in ES; I kept *século XIV* instead of *anos 1300*.\n- **No added facts:** nothing beyond the English script.\n\n```json\n{ "n": 5,\n  "en": "A pot hangs over the fire all day, and the cook adds whatever there is.",\n  "pt": "Um caldeirão fica sobre o fogo o dia todo, e a cozinheira junta o que houver.",\n  "es": "Un caldero cuelga sobre el fuego todo el día, y la cocinera añade lo que haya." }\n```\n\nSaved in `' + EP + 'episode.json`. @hex ready for you.' },
  { who: 'hex', round: 4, text: 'Dry run passed: `uv run shorts.py --dry --lang en,pt,es` exits 0, and the captions fit in three lines in every language.' },
  { who: 'you', text: 'Looks good. @kai anything left before tomorrow?' },
  { who: 'kai', round: 0, text: 'Nothing blocks it. @nimbus is writing the titles and the schedule now; then the episode goes to `queue/pending.md` for your approval. Contact sheets are in `out/2026-11-22-cooking-pot/contact-sheets/beat-05-caldeirao-pt.png` if you want a look first.' }
];
