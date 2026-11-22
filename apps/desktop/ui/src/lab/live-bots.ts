/* Provider patches for the bots stories: the mock's bots shaped as the live provider's (what Hermes reports about each, a
   live composer, its recent sessions), and groups with members at work. The live provider itself is checked over fake
   frames in `host/live/*.test.ts`; the lab draws what it shows. */
import type { Bot, BotInfo, DataProvider, ThreadMessage } from '../data';

const info = (b: Bot): BotInfo => ({
  profile: b.id, path: '/home/you/.local/share/boopis/engine/profiles/' + b.id, model: 'anthropic/claude-sonnet-4.6', provider: 'anthropic',
  skills: [{ name: 'git', label: 'git', enabled: true }, { name: 'web', label: 'web', enabled: true }], toolsets: [{ name: 'terminal', label: 'Terminal', enabled: true }], mcpServers: [],
  jobs: [{ id: 'j1', name: 'morning', schedule: '0 9 * * 1-5', prompt: 'Review what changed', enabled: true, next: 'in 2 h', last: null }],
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
