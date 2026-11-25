/* Provider patches for the bots stories: the mock's bots shaped as the live provider's (what Hermes reports about each, a
   live composer, its recent sessions), and groups with members at work. The live provider itself is checked over fake
   frames in `host/live/*.test.ts`; the lab draws what it shows. */
import type { Bot, BotInfo, BotsEvent, DataProvider, Group, GroupMember, GroupMessage, GroupsEvent, ThreadMessage } from '../data';
import { emitter } from '../data/store';
import { lookFor } from '@boopis/ui';
import { TEAM_SIX } from './fixtures';

const info = (b: Bot): BotInfo => ({
  profile: b.id, path: '/home/you/.local/share/boopis/engine/profiles/' + b.id, model: 'anthropic/claude-sonnet-4.6', provider: 'anthropic',
  skills: [{ name: 'git', label: 'git', enabled: true }, { name: 'web', label: 'web', enabled: true }], toolsets: [{ name: 'terminal', label: 'Terminal', enabled: true }], mcpServers: [],
  jobs: [
    { id: 'j1', name: 'morning', schedule: '0 9 * * 1-5', prompt: 'Review what changed', enabled: true, next: 'in 2 h', last: null, deliver: 'room:room-release@' + b.id },
    { id: 'j2', name: 'notes', schedule: 'every 2h', prompt: 'Keep the notes tidy', enabled: true, next: 'in 1 h', last: null, deliver: 'local' },
    { id: 'j3', name: 'digest', schedule: '0 18 * * *', prompt: 'Send the day\'s digest', enabled: false, next: '', last: 'ok', deliver: 'room:g-gone-1@' + b.id },
    { id: 'j4', name: 'ping', schedule: '30m', prompt: 'Say hello', enabled: true, next: 'in 30 min', last: null, deliver: '' }
  ],
  sessions: [
    { id: 's1', title: 'review the billing migration', when: '5m', messages: 14, source: 'gui' },
    { id: 's2', title: 'weekly dependency sweep', when: 'yesterday', messages: 6, source: 'cron' },
    { id: 's3', title: '', when: 'mon', messages: 2, source: 'gui' }
  ],
  soul: b.cfg.instructions, running: false, notes: {}
});

const THREAD = (id: string): ThreadMessage[] => [
  { kind: 'text', id: 'l1', who: 'you', t: '09:12', text: 'Can you look at the billing migration before I merge it?' },
  { kind: 'text', id: 'l2', who: id, t: '09:12', text: 'Yes. The migration is reversible, and it backfills in batches of 500, so it will not lock the table.\n\nOne thing to decide: it drops the old column in the same release. I would split that into the next one.' },
  { kind: 'note', id: 'l3', who: 'app', t: '09:14', text: 'The message was not sent: boopis could not reach this bot. Try again in a moment.' }
];

/** every bot reports what a live profile does and can be messaged; `thread` is what the open session said */
export function liveShaped(p: DataProvider, withThread = false): DataProvider {
  const bots = p.bots.snapshot().bots.map((b): Bot => ({ ...b, info: info(b), attention: null, state: 'idle', activity: '' }));
  return {
    ...p, info: { ...p.info, live: true },
    bots: {
      ...p.bots,
      snapshot: () => ({ bots, threads: Object.fromEntries(bots.map((b) => [b.id, withThread ? THREAD(b.id) : []])) }),
      sessions: { open: () => Promise.resolve(), fresh: () => undefined, current: () => null }
    }
  };
}

/** two members of every group are replying */
export function withWorking(p: DataProvider, count = 2): DataProvider {
  const snap = p.groups.snapshot;
  return { ...p, groups: { ...p.groups, snapshot: () => { const s = snap(); return { ...s, groups: s.groups.map((g) => ({ ...g, working: g.members.slice(0, count).map((m) => m.id), busy: true })) }; } } };
}

/** two members of every group are replying, and these messages wait for them (`Group.queued`) */
export function withQueue(p: DataProvider, texts: readonly string[], count = 1): DataProvider {
  const snap = p.groups.snapshot;
  return { ...p, groups: { ...p.groups, snapshot: () => { const s = snap(); return { ...s, groups: s.groups.map((g) => ({ ...g, working: g.members.slice(0, count).map((m) => m.id), busy: true, queued: texts.map((text, i) => ({ id: 'q' + i, text, t: '10:0' + i })) })) }; } } };
}

/** every group's thread, rewritten (the huddle's stories cut the sample thread short or lengthen a round) */
export function withGroupThread(p: DataProvider, edit: (thread: readonly GroupMessage[]) => readonly GroupMessage[]): DataProvider {
  const snap = p.groups.snapshot;
  return { ...p, groups: { ...p.groups, snapshot: () => { const s = snap(); return { ...s, threads: Object.fromEntries(Object.entries(s.threads).map(([k, v]) => [k, edit(v)])) }; } } };
}

/** the first `count` bots are also running a kanban card (the engine's worker session of the same profile) */
export function withKanbanWorker(p: DataProvider, title: string, count = 1): DataProvider {
  const snap = p.bots.snapshot;
  return { ...p, bots: { ...p.bots, snapshot: () => { const s = snap(); return { ...s, bots: s.bots.map((b, i): Bot => (i < count && b.info ? { ...b, state: 'working', activity: 'kanban task: ' + title, info: { ...b.info, running: true, worker: { title } } } : b)) }; } } };
}

/** members of every group at work, each in a status and a tool (what the room's `member_activity` says); no start time, so no clock runs */
export function withActivity(p: DataProvider, acts: ReadonlyArray<{ at: number; status: 'queued' | 'running' | 'stopping'; tool?: string | null }>): DataProvider {
  const snap = p.groups.snapshot;
  return { ...p, groups: { ...p.groups, snapshot: () => { const s = snap(); return { ...s, groups: s.groups.map((g) => {
    const list = acts.flatMap((a) => { const m = g.members[a.at]; return m ? [{ member: m.id, status: a.status, round: 0, startedAt: null, tool: a.tool ?? null }] : []; });
    return { ...g, working: list.map((a) => a.member), activity: list };
  }) }; } } };
}

/** a bot's reply is under way: the page is told it runs (and the bot says it is working), so its thread shows the pending entry */
export function withRun(p: DataProvider, botId: string, activity = 'reading factcheck.md'): DataProvider {
  const snap = p.bots.snapshot;
  return { ...p, bots: { ...p.bots,
    snapshot: () => { const s = snap(); return { ...s, bots: s.bots.map((b) => (b.id === botId ? { ...b, state: 'working' as const, activity } : b)) }; },
    subscribe: (fn) => { const off = p.bots.subscribe(fn); const t = window.setTimeout(() => { fn({ type: 'run', botId, running: true }); }, 0); return () => { window.clearTimeout(t); off(); }; }
  } };
}
/** the thread of a bot's own chat as markdown: headings, lists, a quote, a table, fenced code and a path */
export function withMarkdownThread(p: DataProvider, botId: string): DataProvider {
  const snap = p.bots.snapshot;
  const text = '**Done.** The migration is reversible:\n\n- backfills in batches of *500*\n- keeps the old column until the next release\n\n> Split the drop into its own release.\n\n```sql\nALTER TABLE invoices ADD COLUMN cents bigint;\nUPDATE invoices SET cents = round(amount * 100);\n```\n\nSee `src/billing/money.ts` and [the runbook](https://example.org/runbook). @nina can check it too.';
  return { ...p, bots: { ...p.bots, snapshot: () => { const s = snap(); return { ...s, threads: { ...s.threads, [botId]: [
    { kind: 'text', id: 'md1', who: 'you', t: '09:12', text: 'Can you look at the billing migration, and tell me what to split?' },
    { kind: 'text', id: 'md2', who: botId, t: '09:12', text }
  ] } }; } } };
}

/* ───────── the owner's team (22 November 2026): six bots, one room ───────── */
const member = (id: string): GroupMember => ({ id, profile: id, handle: id, name: id });
/** groups as the owner's sidebar holds them, from one member to six: the six-member room, three (release crew), a long
    name, a pair, and one whose other member is no longer a bot of the user (so its stack is one orb); members are bots
    of the roster */
export function teamGroups(p: DataProvider): DataProvider {
  const groups: Group[] = [
    { id: 'g-paper-past-', name: 'paper past', members: TEAM_SIX.map((b) => member(b.id)), working: [], busy: false, queued: [] },
    { id: 'g-release', name: 'release crew', members: ['atlas', 'nina', 'kai'].map(member), working: [], busy: false, queued: [] },
    { id: 'g-close', name: 'the quarterly close review with finance, audit and the platform team', members: ['atlas', 'terra', 'vox', 'sol', 'noct'].map(member), working: [], busy: false, queued: [] },
    { id: 'g-pair', name: 'pair', members: ['kai', 'nina'].map(member), working: [], busy: false, queued: [] },
    { id: 'g-night', name: 'night desk', members: [member('sol'), { id: 'umbra', profile: 'umbra', handle: 'umbra', name: 'umbra' }], working: [], busy: false, queued: [] }
  ];
  return { ...p, groups: { ...p.groups, snapshot: () => ({ groups, threads: Object.fromEntries(groups.map((g) => [g.id, []])) }) } };
}
/** each group row's member stack sits in its own slot: nothing of its text starts before the stack ends, in the open
    sidebar, and in the rail the stack stays inside the row; the problems, in words */
export function groupRowOverlaps(): string[] {
  const out: string[] = [];
  for (const row of document.querySelectorAll<HTMLElement>('.bt-group-rows [data-gid]')) {
    const st = row.querySelector('.ui-stack')?.getBoundingClientRect();
    if (!st) continue;
    const r = row.getBoundingClientRect(), name = row.getAttribute('data-gid');
    if (st.left < r.left - 0.5 || st.right > r.right + 0.5) out.push(name + ': its stack reaches outside the row');
    for (const t of row.querySelectorAll<HTMLElement>('.k7-lrow__title, .k7-lrow__sub')) {
      const tr = t.getBoundingClientRect();
      if (tr.width > 0 && getComputedStyle(t).display !== 'none' && tr.left < st.right - 0.5) out.push(name + ': its ' + (t.classList.contains('k7-lrow__title') ? 'name' : 'members line') + ' starts ' + (st.right - tr.left).toFixed(1) + 'px under its stack');
    }
  }
  return out;
}
/** The owner's six, as boopis first read them: profiles made with the hermes command, with no record yet, so each wears
    the look its name gives (kai a blue star). `recordsArrive` then sends each with the look saved in its record (kai a teal
    circle), the way the live provider does when it reads the records on the next roster read. */
const arrivals = emitter<BotsEvent>();
let team: Bot[] = [];
export function teamBeforeRecords(p: DataProvider): DataProvider {
  const tpl = p.bots.snapshot().bots[0] as Bot;
  const made = TEAM_SIX.map((t): Bot => ({ ...tpl, id: t.id, name: t.name, role: t.name + ' of the Paper Past team', ...lookFor(t.name), state: 'idle', attention: null, activity: '', last: null, madeOutside: true }));
  const live = liveShaped({ ...p, bots: { ...p.bots, snapshot: () => ({ bots: made, threads: {} }) } });
  team = [...live.bots.snapshot().bots];
  return teamGroups({
    ...live,
    bots: {
      ...live.bots,
      snapshot: () => ({ bots: [...team], threads: Object.fromEntries(team.map((b) => [b.id, []])) }),
      subscribe: (fn) => { const a = live.bots.subscribe(fn), b = arrivals.subscribe(fn); return () => { a(); b(); }; }
    }
  });
}
export function recordsArrive(): void {
  team = team.map((b) => {
    const t = TEAM_SIX.find((x) => x.id === b.id);
    if (!t) return b;
    const { madeOutside: _gone, ...rest } = b;
    return { ...rest, shape: t.shape, color: t.color };
  });
  for (const b of team) arrivals.emit({ type: 'bot', bot: { ...b } });
}
/** every orb of the six on the page wears its saved look; the mismatches, in words ("kai in the roster: star #3b82f6") */
export function lookMismatches(): string[] {
  const out: string[] = [];
  for (const t of TEAM_SIX) {
    for (const o of document.querySelectorAll('.ui-orb[data-bot="' + t.id + '"] > orb-avatar')) {
      const got = o.getAttribute('shape') + ' ' + o.getAttribute('color');
      if (got !== t.shape + ' ' + t.color) out.push(t.id + ' in ' + (o.closest('#hx-side') ? 'the roster' : o.closest('.dk') ? 'the dock' : o.closest('.bt-p, .bt-presence') ? 'its room' : 'the page') + ': ' + got);
    }
  }
  return out;
}

/** what a state's interaction can push into the running app, as the engine's live updates do: a bot changes state, a group's
    members start or stop replying. `window.__labDrive.bot(id, patch)` and `.group(id, patch)` reach every subscriber, the
    sidebar and the dock alike; the stability check samples what the page does with them (an orb must stay the same node). */
export function drivable(p: DataProvider): DataProvider {
  const botFns = new Set<(e: BotsEvent) => void>(), groupFns = new Set<(e: GroupsEvent) => void>();
  const bots = new Map(p.bots.snapshot().bots.map((b) => [b.id, b] as const));
  const groups = new Map(p.groups.snapshot().groups.map((g) => [g.id, g] as const));
  (window as unknown as Record<string, unknown>)['__labDrive'] = {
    bot(id: string, patch: Partial<Bot>): void { const b = bots.get(id); if (!b) return; const next = { ...b, ...patch }; bots.set(id, next); for (const f of botFns) f({ type: 'bot', bot: next }); },
    /** a message arrives in a room, as the engine publishes one */
    message(groupId: string, message: GroupMessage): void { for (const f of groupFns) f({ type: 'message', groupId, message }); },
    group(id: string, patch: Partial<Group>): void { const g = groups.get(id); if (!g) return; const next = { ...g, ...patch }; groups.set(id, next); for (const f of groupFns) f({ type: 'group', group: next }); }
  };
  return {
    ...p,
    bots: { ...p.bots, subscribe: (fn) => { botFns.add(fn); const off = p.bots.subscribe(fn); return () => { botFns.delete(fn); off(); }; } },
    groups: { ...p.groups, subscribe: (fn) => { groupFns.add(fn); const off = p.groups.subscribe(fn); return () => { groupFns.delete(fn); off(); }; } }
  };
}
