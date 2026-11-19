/* TODAY'S MOCK CONTENT: the v6 mock-up's data.js, plus the content that lived inside its modules (the steps, the
   other sessions' histories, the diff, the bots' own data, the dock's last messages and schedules). Only
   mock-provider.ts reads this file. It is test and development data (STANDARDS section 1 rule 4): the live provider
   never falls back to it. */
import { APPROVALS, SUGGESTIONS } from './bot-catalog';
import type {
  ApprovalData, Bot, BotCatalog, BotConfig, Change, Connector, ContextUsage, DecisionKind, DiffFile, Environment, GovernanceState,
  LedgerStats, Schedule, SessionSummary, Step, Todo, Turn, User
} from './types';

export const USER: User = { name: 'enzo', initials: 'e' };

/* ───────── bots: the 11 in the owner's Figma dock, in order ───────── */
interface BotSeed { id: string; name: string; role: string; shape: string; color: string; state: string; attention?: string; /** boopis has no store for it: made with the `hermes` command */ outside?: boolean }
const BOT_SEEDS: readonly BotSeed[] = [
  { id: 'atlas',  name: 'atlas',  role: 'reviewer',          shape: 'circle',   color: '#efece6',   state: 'idle' },
  { id: 'nina',   name: 'nina',   role: 'deploys',           shape: 'triangle', color: '#f23b5a',   state: 'needs', attention: 'approval' },
  { id: 'kai',    name: 'kai',    role: 'docs and changelog', shape: 'circle',  color: '#4fc9a8',   state: 'working' },
  { id: 'iris',   name: 'iris',   role: 'design QA',         shape: 'flower',   color: '#3b82f6', state: 'idle' },
  { id: 'hex',    name: 'hex',    role: 'security review',   shape: 'hexagon',  color: '#a6a6ab', state: 'sleeping' },
  { id: 'sol',    name: 'sol',    role: 'night shift',       shape: 'circle',   color: '#f5a337', state: 'idle' },
  { id: 'noct',   name: 'noct',   role: 'on-call',           shape: 'circle',   color: '#1c1c24',    state: 'happy' },
  { id: 'terra',  name: 'terra',  role: 'data migrations',   shape: 'drop',     color: '#c4834a', state: 'thinking' },
  { id: 'nimbus', name: 'nimbus', role: 'inbox triage',      shape: 'cloud',    color: '#9b5cf6',    state: 'idle' },
  { id: 'vox',    name: 'vox',    role: 'release notes',     shape: 'circle',   color: '#6d5cf0', state: 'compute' },
  { id: 'moss',   name: 'moss',   role: 'flaky test hunter', shape: 'squircle', color: '#2fd26a',   state: 'speaking' }
];
const ACTIVITY: Record<string, string> = { kai: 'drafting the changelog for 2.4', terra: 'planning migration 0042', vox: 'collecting merged PRs since 2.3', moss: 'rerunning invoice.test.ts, 7 of 20' };
const SPENT: Record<string, string> = { nina: '0.02', kai: '0.11', moss: '0.24', terra: '0.07', vox: '0.05', atlas: '0.09' };
const CRON_DEFAULT: Record<string, string> = { sol: '0 2 * * *', hex: '0 9 * * 1', nimbus: '*/30 * * * *', moss: '0 */4 * * *', kai: '0 18 * * 1-5', vox: '0 10 * * 5' };
/** the last message of a bot that has no thread yet */
const LAST: Record<string, { t: string; text: string }> = {
  kai: { t: '14:21', text: 'Changelog for 0.23 is drafted. Two entries need your wording before I post it.' },
  iris: { t: '13:55', text: 'Checked the pricing page at three widths. Two spacing issues, both in the plan table.' },
  hex: { t: '09:12', text: 'Asleep until the next push to main. The last scan found nothing new.' },
  sol: { t: 'yesterday', text: 'The night shift starts at 02:00. Your digest will be ready by 08:00.' },
  noct: { t: '07:30', text: 'Quiet night. No pages and no alerts since 23:00.' },
  terra: { t: '14:30', text: 'Planning the invoices_v2 backfill. I will ask before anything writes.' },
  nimbus: { t: '14:15', text: 'Inbox sorted. Three drafts are waiting in your voice.' },
  vox: { t: '14:26', text: 'Collecting merged pull requests for the release notes.' },
  moss: { t: '14:29', text: 'invoice.test.ts fails only after midnight UTC. Writing a fix now.' }
};
export function ideasFor(role: string): readonly string[] {
  const r = role.toLowerCase();
  if (r.includes('review')) return ['Review the open PRs on billing-api', 'What changed since yesterday?'];
  if (r.includes('night')) return ['Prep tomorrow’s digest', 'What did you do last night?'];
  if (r.includes('inbox')) return ['Triage today’s email', 'Draft a reply to the Stripe thread'];
  if (r.includes('migration')) return ['Plan the cents migration', 'Dry run 0042 on a copy'];
  if (r.includes('test')) return ['Find flaky tests from this week', 'Rerun invoice.test.ts 20 times'];
  if (r.includes('release') || r.includes('changelog')) return ['Draft notes for 2.4', 'What shipped this week?'];
  return ['What are you working on?', 'Summarise yesterday'];
}
export const defaultConfig = (id: string): BotConfig => ({
  instructions: '', gov: id === 'noct' ? 'ungoverned' : 'governed', model: 'sonnet 5.5', cap: '0.60',
  cron: CRON_DEFAULT[id] ?? '',
  channels: { app: true, slack: ['nina', 'noct', 'hex'].includes(id), telegram: id === 'noct', email: id === 'nimbus' },
  approvals: { deploys: true, push: true, network: id !== 'nimbus', spend: true, people: true, outside: true },
  workspace: ['hex', 'moss', 'terra'].includes(id) ? 'sandbox' : 'worktree'
});
export const seedBots = (): Bot[] => BOT_SEEDS.map((b) => ({
  id: b.id, name: b.name, role: b.role, shape: b.shape, color: b.color, state: b.state, attention: b.attention ?? null,
  paused: false, activity: ACTIVITY[b.id] ?? '', spent: SPENT[b.id] ?? '0.00', last: LAST[b.id] ?? null, ideas: ideasFor(b.role), cfg: defaultConfig(b.id)
}));

/** Test fixtures, never in the default data: a bot with a long name and a long role, for the long-name rules (an
    ellipsis where space is fixed, two lines in a header). The e2e build adds one with `?fixture=long`, a test adds it
    with `createMockProvider({ fixtures: ['long'] })`. */
type ThreadSeed = Array<{ who: string; t: string; text?: string; approval?: ApprovalData }>;
export const BOT_FIXTURES: Readonly<Record<string, { bot: BotSeed; thread: ThreadSeed }>> = {
  long: {
    bot: { id: 'cassiopeia-staging-deploy-guardian', name: 'cassiopeia-staging-deploy-guardian', role: 'watches every staging deploy and rolls back on a failed health check', shape: 'star', color: '#e8b04a', state: 'needs', attention: 'approval' },
    thread: [
      { who: 'you', t: '15:02', text: 'keep an eye on the staging deploys tonight' },
      { who: 'cassiopeia-staging-deploy-guardian', t: '15:03', text: 'On it. I will watch each deploy for ten minutes and roll back if the health check fails twice.' },
      { who: 'cassiopeia-staging-deploy-guardian', t: '15:40', approval: { title: 'roll back staging', quote: 'invoices-api 2.14.0 → 2.13.4', item: ['staging · invoices-api', 'health check failed 2 of 2'], meta: 'expires in 9 min', actions: ['deny', 'hold to approve'] } }
    ]
  },
  /* a profile made outside boopis (the "made outside boopis" mark), with a long enough name and role to check the mark's room */
  outside: {
    bot: { id: 'sage', name: 'sage', role: 'reads release notes', shape: 'drop', color: '#7fb68c', state: 'idle', outside: true },
    thread: []
  }
};
export const fixtureBot = (seed: BotSeed): Bot => ({
  id: seed.id, name: seed.name, role: seed.role, shape: seed.shape, color: seed.color, state: seed.state, attention: seed.attention ?? null,
  paused: false, activity: '', spent: '0.00', last: null, ideas: ideasFor(seed.role), cfg: defaultConfig(seed.id),
  ...(seed.outside ? { madeOutside: true as const } : {})
});

/** Archived bots, so the Bots tab's "Archived" group and "Restore bot…" show without Hermes. `id` is the profile's name now
    (`archived--<name>`), `when` as the lists say it. The second one's name is in use (nina is on the roster), so restoring it is refused. */
export interface ArchivedSeed { bot: BotSeed; at: string; when: string }
export const ARCHIVED_SEEDS: readonly ArchivedSeed[] = [
  { bot: { id: 'ledger', name: 'ledger', role: 'month-end close', shape: 'squircle', color: '#c4834a', state: 'idle' }, at: '2026-11-18T09:30:00+00:00', when: 'yesterday' },
  { bot: { id: 'nina', name: 'nina', role: 'old deploy runs', shape: 'triangle', color: '#f23b5a', state: 'idle' }, at: '2026-11-16T17:05:00+00:00', when: 'mon' }
];

export const NINA_APPROVAL: ApprovalData = {
  id: 'approve-deploy', title: 'deploy to staging', quote: 'billing/cents → staging, dry run first',
  item: ['staging · invoices-api', 'read-only on invoices · 1 migration'], meta: 'expires in 9 min · ~$0.02', actions: ['deny', 'hold to approve']
};
/** bot threads: the example conversation with nina (a teammate) and atlas */
export const seedThreads = (): Record<string, ThreadSeed> => ({
  nina: [
    { who: 'nina', t: '14:08', text: 'Tests are green on billing/cents. I can deploy it to staging and compare against 200 real invoices.' },
    { who: 'nina', t: '14:08', approval: NINA_APPROVAL }
  ],
  atlas: [
    { who: 'you', t: '13:40', text: 'review the cents diff when it lands' },
    { who: 'atlas', t: '14:02', text: 'Reviewed. One nit: invoice.ts:88 still divides before rounding. Fixed in 9f3c1a2; 142 tests pass.' }
  ]
});
/** the canned replies of a bot: one when it starts, one when it finishes */
export const REPLY: Record<string, readonly [string, string]> = {
  atlas: ['I’ll read it line by line and flag anything that changes behaviour.', 'Review is up: two nits, nothing blocking. Notes are on the PR.'],
  nina: ['I’ll stage it first and compare before anything touches production.', 'Staged. Everything matches; production is waiting for your approval.'],
  kai: ['Noted. I’ll fold it into the changelog draft.', 'Changelog updated. Three entries moved under `fixed`.'],
  hex: ['Waking up. I’ll scan the diff for secrets and unsafe calls.', 'No secrets, no new network calls. One dependency is two majors behind.']
};

export const CATALOG: BotCatalog = {
  models: ['opus 5.5', 'sonnet 5.5', 'haiku 4.5', 'qwen3-coder'],
  channels: [
    { id: 'app', name: 'This app', hint: 'always on' }, { id: 'slack', name: 'Slack', hint: '#billing-alerts' },
    { id: 'telegram', name: 'Telegram', hint: '@enzo' }, { id: 'email', name: 'Email', hint: 'enzo@boopis.dev' }
  ],
  approvals: APPROVALS,
  suggestions: SUGGESTIONS
};

export const SCHEDULES: readonly Schedule[] = [
  { id: 'nimbus-triage', bot: 'nimbus', what: 'inbox triage', when: 'every hour at :15', next: 'in 7 min', paused: false },
  { id: 'moss-flaky', bot: 'moss', what: 'rerun flaky tests', when: 'every 6 hours', next: 'in 2 h', paused: false },
  { id: 'sol-digest', bot: 'sol', what: 'morning digest', when: 'nightly at 02:00', next: 'in 11 h', paused: false },
  { id: 'kai-changelog', bot: 'kai', what: 'changelog draft', when: 'fridays at 17:00', next: 'friday', paused: false },
  { id: 'atlas-review', bot: 'atlas', what: 'review open pull requests', when: 'mondays at 09:00', next: 'monday', paused: false }
];

/* ───────── sessions ───────── */
export const SESSIONS: readonly SessionSummary[] = [
  { id: 's1', project: 'billing-api', title: 'proration drift in src/billing', when: 'now', running: false },
  { id: 's2', project: 'billing-api', title: 'webhook retries and idempotency', when: '2h' },
  { id: 's3', project: 'billing-api', title: 'audit log export', when: 'yesterday' },
  { id: 's4', project: 'marketing-site', title: 'pricing page copy', when: 'yesterday' },
  { id: 's5', project: 'bethunter', title: 'ios build on the macOS vm', when: 'mon' }
];
export const COMPOSER_DRAFT = 'refactor the proration helpers in src/billing to use integer cents, run the tests, then open a PR. keep it cheap.';
export const STEPS: readonly Step[] = [
  { title: 'Read 9 files in src/billing', meta: ['qwen3-coder'], time: '0:18' },
  { title: 'Moved the proration helpers to integer cents', meta: ['qwen3-coder'], time: '0:52' },
  { title: 'npm test -- billing', mono: true, meta: ['1 failed', 'invoice.test.ts, rounds per line item'], time: '0:21', kind: 'fail' },
  { title: 'Rolled back invoice.ts and escalated to sonnet 5.5', meta: ['Governance, after a failed gate'], time: '0:09', kind: 'escalate' },
  { title: 'Rounded once per invoice and added the property test', meta: ['sonnet 5.5'], time: '1:58' },
  { title: 'npm test', mono: true, meta: ['142 passed'], time: '0:04' }
];
/** what answering the open question rewrites the sentence into, and the change it makes to the diff */
export const BLANK_REWRITES: Record<string, { lead: string; tail: string; alias: string | null }> = {
  'as a deprecated alias': { lead: 'Keeping `prorate`', tail: 'that forwards to `prorateCents`.', alias: '+/** @deprecated use prorateCents */\n+export const prorate = prorateCents;' },
  'for one release': { lead: 'Keeping `prorate`', tail: ', then removing it. The changelog says so.', alias: '+/** @deprecated removed in the next minor */\n+export const prorate = prorateCents;' },
  'removed now': { lead: '`prorate` is', tail: '. The public API exports only `prorateCents`.', alias: null }
};
/** the dock's wording of the same question, mapped to the session's */
export const BLANK_FROM_DOCK: Record<string, string> = { 'keep as deprecated alias': 'as a deprecated alias', 'keep for one release': 'for one release', 'remove it now': 'removed now' };
export const BLANK_DOCK_OPTIONS: readonly string[] = ['keep as deprecated alias', 'keep for one release', 'remove it now'];
export const BLANK_DOCK_SHORT = 'Keep prorate as a deprecated alias?';

export const S1_TURNS: readonly Turn[] = [
  { id: 't1', role: 'user', at: '14:01', text: 'proration drifts by a cent on long invoices. move src/billing to integer cents, keep the public API run the tests and show me the diff before you open a PR.' },
  { id: 't2', role: 'assistant', model: 'qwen3-coder → sonnet 5.5', time: '3m 42s', cost: '$0.37', stepCount: 6, steps: STEPS, status: 'done',
    paragraphs: ['Everything under `src/billing` now works as integer cents. `prorateCents` rounds once, at the end, half away from zero. so a 31-day invoice split over three proration events no longer drifts.'],
    bullets: ['`money.ts` adds a branded `Cents` type. Conversion happens only at the API edge.', 'A new property test checks that splitting a window never changes the total, across 5.000 random splits.'],
    blank: { question: 'One open question, should I keep the old export name prorate as a deprecated alias?', short: 'Keep the old name prorate?', options: ['as a deprecated alias', 'for one release', 'removed now'],
      rewrites: Object.fromEntries(Object.entries(BLANK_REWRITES).map(([k, v]) => [k, { lead: v.lead, tail: v.tail }])) },
    ship: { title: 'ready to ship', quote: 'integer cents, public API unchanged', passed: 142, rolledBack: 1, files: 4, add: 96, del: 71, branch: 'cents/proration' } }
];
interface History { user: string; at: string; model: string; time: string; cost: string; steps: number; paras: readonly string[] }
const HISTORIES: Record<string, History> = {
  s2: { user: 'webhooks retry forever when the provider times out. cap retries and make the handlers idempotent.', at: '12:10', model: 'haiku 4.5', time: '1m 50s', cost: '$0.06', steps: 4,
    paras: ['Retries now stop after 5 attempts with exponential backoff. Every handler checks `Idempotency-Key` before it writes, so a repeated delivery returns `200` and changes nothing.'] },
  s3: { user: 'add a csv export for the audit log, filtered by date range.', at: 'Tue', model: 'qwen3-coder', time: '58s', cost: '$0.02', steps: 3,
    paras: ['`GET /audit/export?from=&to=` streams a CSV in pages of 1,000 rows. The date filter uses the existing index on `created_at`.'] },
  s4: { user: 'tighten the pricing page copy, keep the three plans.', at: 'Tue', model: 'sonnet 5.5', time: '41s', cost: '$0.03', steps: 2,
    paras: ['The plan names stay. Each plan now leads with its price and the one limit that decides it, and the comparison table lost two rows nobody asked about.'] },
  s5: { user: 'the ios build fails on the macos vm, find out why.', at: 'Mon', model: 'qwen3-coder → sonnet 5.5', time: '6m 12s', cost: '$0.41', steps: 7,
    paras: ['The VM ships Xcode 16.0 and the project needs 16.1 for the `iOS 18.1` SDK. Pinning the runner image fixes the build; I left the change on a branch.'] }
};
export const historyTurns = (id: string): readonly Turn[] | null => {
  const h = HISTORIES[id]; if (!h) return null;
  return [
    { id: id + '-u', role: 'user', at: h.at, text: h.user },
    { id: id + '-a', role: 'assistant', model: h.model, time: h.time, cost: h.cost, stepCount: h.steps, steps: [], paragraphs: h.paras, bullets: [], status: 'done' }
  ];
};

export function diffFor(answer: string | null): DiffFile[] {
  const rw = (answer && BLANK_REWRITES[answer]) || BLANK_REWRITES['as a deprecated alias']!;
  const alias = rw.alias;
  return [
    { path: 'src/billing/money.ts', add: 41, del: 0, hunks: [['@@ -0,0 +1,7 @@', [
      "+export type Cents = number & { readonly __brand: 'Cents' };", '+', '+export const toCents = (amount: number): Cents =>', '+  Math.round(amount * 100) as Cents;', '+',
      '+export const roundHalfAway = (x: number): Cents =>', '+  (Math.sign(x) * Math.round(Math.abs(x))) as Cents;']]] },
    { path: 'src/billing/prorate.ts', add: 27, del: 44, hunks: [['@@ -12,10 +12,12 @@ export function', [
      ' export function prorateCents(total: Cents, used: number, days: number): Cents {', '-  const daily = amount / days;', '-  return Math.round(daily * used * 100) / 100;',
      '+  return roundHalfAway((total * used) / days);', ' }', ...(alias ? alias.split('\n') : ['-export const prorate = prorateCents;'])]]] },
    { path: 'src/billing/invoice.ts', add: 9, del: 27, hunks: [['@@ -84,7 +84,4 @@ function total', [
      '   const lines = invoice.lines.map(toCents);', '-  const parts = lines.map((l) => Math.round(l / periods) * periods);', '-  return parts.reduce((a, b) => a + b, 0) / 100;',
      '+  return fromCents(prorateCents(sum(lines), used, days));']]] },
    { path: 'src/billing/prorate.test.ts', add: 19, del: 0, hunks: [['@@ -40,0 +41,6 @@', [
      '+test.prop([fc.integer({ min: 1, max: 10_000_00 }), fc.array(fc.nat(31))])(', "+  'splitting a window never changes the total',", '+  (total, cuts) => {', '+    expect(sumSplits(total, cuts)).toBe(total);', '+  }', '+);']]] }
  ];
}

/* ───────── the details panel ───────── */
export const CONTEXT: ContextUsage = { total: 200000, parts: [['system + tools', 9000], ['project memory', 4000], ['src/billing files', 41000], ['conversation', 22000]] };
export const CONNECTORS: readonly Connector[] = [{ name: 'github', tools: 14, state: 'on' }, { name: 'postgres', tools: 6, state: 'on' }, { name: 'linear', tools: 9, state: 'sign in' }, { name: 'sentry', tools: 5, state: 'off' }];
export const OUTPUT: readonly string[] = ['$ npm test -- billing', ' PASS  prorate.test.ts (5000 runs)', ' PASS  money.test.ts', ' FAIL  invoice.test.ts  › rounds per line item', '↩ rolled back invoice.ts', '$ npm test', ' Tests  142 passed', ' Time   4.18 s'];
export const ENVIRONMENT: Environment = { cwd: '~/code/billing-api', branch: 'cents/proration', sandbox: 'bubblewrap · network off', runtime: 'node 22.11 · python 3.12', harness: 'boopis engine v0.23.2 (pinned)', gate: 'npm test' };
export const TODOS: readonly Todo[] = [['read proration call sites', 'done'], ['convert to integer cents', 'done'], ['round once per invoice', 'doing'], ['property test for half-cents', 'todo'], ['draft PR', 'todo']];
export const CHANGES: readonly Change[] = [['src/billing/money.ts', 41, 0], ['src/billing/prorate.ts', 27, 44], ['src/billing/invoice.ts', 9, 27], ['src/billing/prorate.test.ts', 19, 0]];
export const GOVERNANCE: GovernanceState = {
  governed: true, smart: true, model: 'sonnet 5.5', cap: '$0.60', spent: '$0.37', current: 2,
  ladder: [['qwen3-coder', 'first try'], ['haiku 4.5', 'after 1 fail'], ['sonnet 5.5', 'after 2 fails'], ['opus 5.5', 'by request']]
};
export const LEDGER: LedgerStats = { tokens: '48.2k', cost: '$0.37', trips: 14, escalations: 1 };
/** the run the dock shows (the current session's last turn) */
export const RUN_SEED = { title: 'proration drift in src/billing', step: 6, escalated: 1, elapsed: 222, cost: 0.37, cap: 0.6, network: false };

/* ───────── the composer's feedforward catalog (how the agent reads decision words) ───────── */
export const DECISIONS: readonly DecisionKind[] = [
  { id: 'verb', pattern: '\\b(refactor|rewrite|fix|review|migrate)\\b', title: 'Read as', single: true, fallback: 'refactor',
    guess: [['review', 'review'], ['fix', 'fix'], ['rewrite', 'rewrite']],
    options: [
      { value: 'refactor', label: 'refactor', desc: 'Same behaviour, new structure', assume: '>refactor' },
      { value: 'rewrite', label: 'rewrite', desc: 'Behaviour may change; I will list how', assume: '>rewrite' },
      { value: 'fix', label: 'fix', desc: 'The smallest change that makes it right', assume: '>fix, smallest change' },
      { value: 'review', label: 'review only', desc: 'Read and comment, no edits', assume: '>review, no edits' }
    ] },
  { id: 'path', pattern: '\\b(?:src|lib|app|packages|tests?)\\/[\\w\\-./]*[\\w]', title: 'Scope', single: false, fallback: 'self', guess: [], options: null },
  { id: 'tests', pattern: '\\b(run (?:the )?tests|run tests|test it)\\b', title: 'Run', single: false, fallback: 'all', guess: [],
    options: [
      { value: 'all', label: 'npm test', mono: true, desc: 'The whole suite, the gate for this repo', assume: '>npm test' },
      { value: 'scoped', label: 'npm test -- billing', mono: true, desc: 'Only the billing tests, faster', assume: '>npm test -- billing' },
      { value: 'none', label: 'Skip tests', desc: 'No test run; the PR will say so', assume: '>no test run' }
    ] },
  { id: 'pr', pattern: '\\b(open a (?:PR|pull request)|draft a PR|push (?:it|a branch))\\b', title: 'When done', single: false, fallback: 'draft', guess: [['push', 'branch']],
    options: [
      { value: 'draft', label: 'Draft a PR', desc: 'You mark it ready', assume: '>draft a PR' },
      { value: 'ready', label: 'Open a ready PR', desc: 'Asks atlas for a review', assume: '>ready PR' },
      { value: 'branch', label: 'Push the branch only', desc: 'No PR yet', assume: '>push branch, no PR' }
    ] },
  { id: 'cost', pattern: '\\b(cheap(?:ly)?|balanced|thorough(?:ly)?)\\b', title: 'Spend', single: true, fallback: 'cheap', guess: [['balanced', 'balanced'], ['thorough', 'thorough']],
    options: [
      { value: 'cheap', label: 'Cheap', desc: 'Start on qwen3-coder, climb on failure', start: 'qwen' },
      { value: 'balanced', label: 'Balanced', desc: 'Start on haiku 4.5', start: 'haiku' },
      { value: 'thorough', label: 'Thorough', desc: 'Start on sonnet 5.5', start: 'sonnet' }
    ] }
];

/** the paths the mock offers when you mention a file */
export const FILE_PATHS: readonly string[] = ['src/billing/money.ts', 'src/billing/prorate.ts', 'src/billing/invoice.ts', 'src/billing/prorate.test.ts'];
