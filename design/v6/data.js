/* Shared mock data for the boopis v6 mock-up. Read-only for module agents; propose additions in your report. */
window.HX_DATA = {
  user: { name: 'enzo', initials: 'e' },
  /* the 11 bots in the owner's Figma dock, in order; orb2 attributes */
  bots: [
    { id: 'atlas',  name: 'atlas',  role: 'reviewer',          shape: 'circle',   color: '#efece6', eyes: 'pill',   state: 'idle' },
    { id: 'nina',   name: 'nina',   role: 'deploys',           shape: 'triangle', color: '#f23b5a', eyes: 'pill',   state: 'needs', attention: 'approval' },
    { id: 'kai',    name: 'kai',    role: 'docs and changelog', shape: 'circle',  color: '#4fc9a8', eyes: 'pill',   state: 'working' },
    { id: 'iris',   name: 'iris',   role: 'design QA',         shape: 'flower',   color: '#3b82f6', eyes: 'circle wide', state: 'idle' },
    { id: 'hex',    name: 'hex',    role: 'security review',   shape: 'hexagon',  color: '#a6a6ab', eyes: 'square', state: 'sleeping' },
    { id: 'sol',    name: 'sol',    role: 'night shift',       shape: 'circle',   color: '#f5a337', eyes: 'circle', state: 'idle' },
    { id: 'noct',   name: 'noct',   role: 'on-call',           shape: 'circle',   color: '#1c1c24', eyes: 'arc',    state: 'happy' },
    { id: 'terra',  name: 'terra',  role: 'data migrations',   shape: 'drop',     color: '#c4834a', eyes: 'circle', state: 'thinking' },
    { id: 'nimbus', name: 'nimbus', role: 'inbox triage',      shape: 'cloud',    color: '#9b5cf6', eyes: 'arc',    state: 'idle' },
    { id: 'vox',    name: 'vox',    role: 'release notes',     shape: 'circle',   color: '#6d5cf0', eyes: 'matrix', state: 'compute' },
    { id: 'moss',   name: 'moss',   role: 'flaky test hunter', shape: 'squircle', color: '#2fd26a', eyes: 'bars',   state: 'speaking' }
  ],
  /* bots tab: example conversation with nina (a teammate) */
  botThreads: {
    nina: [
      { who: 'nina', t: '14:08', text: 'Tests are green on billing/cents. I can deploy it to staging and compare against 200 real invoices.' },
      { who: 'nina', t: '14:08', card: 'approval', data: { title: 'deploy to staging', quote: 'billing/cents → staging, dry run first', item: ['staging · invoices-api', 'read-only on invoices · 1 migration'], meta: 'expires in 9 min · ~$0.02', actions: ['deny', 'hold to approve'] } }
    ],
    atlas: [
      { who: 'you', t: '13:40', text: 'review the cents diff when it lands' },
      { who: 'atlas', t: '14:02', text: 'Reviewed. One nit: invoice.ts:88 still divides before rounding. Fixed in 9f3c1a2; 142 tests pass.' }
    ]
  },
  botSuggestions: [
    { name: 'night shift', desc: 'Works overnight and preps your morning digest', shape: 'hexagon', color: '#f5a337' },
    { name: 'inbox triage', desc: 'Sorts your email and drafts replies in your voice', shape: 'cloud', color: '#f472b6' },
    { name: 'chief of staff', desc: 'Manages your calendar and pulls your notes together', shape: 'squircle', color: '#ef4444' },
    { name: 'flaky test hunter', desc: 'Reruns failing tests and opens a fix when it finds one', shape: 'squircle', color: '#2fd26a' }
  ],
  /* test fixtures, not shown by default: a bot with a long name and a long role, for the long-name rules (ellipsis
     where space is fixed, two lines in a header). bots.test.html?fixture=long adds it to bots and botThreads. */
  botFixtures: {
    long: {
      bot: { id: 'cassiopeia-staging-deploy-guardian', name: 'cassiopeia-staging-deploy-guardian', role: 'watches every staging deploy and rolls back on a failed health check', shape: 'star', color: '#e8b04a', eyes: 'pill', state: 'needs', attention: 'approval' },
      thread: [
        { who: 'you', t: '15:02', text: 'keep an eye on the staging deploys tonight' },
        { who: 'cassiopeia-staging-deploy-guardian', t: '15:03', text: 'On it. I will watch each deploy for ten minutes and roll back if the health check fails twice.' },
        { who: 'cassiopeia-staging-deploy-guardian', t: '15:40', card: 'approval', data: { title: 'roll back staging', quote: 'invoices-api 2.14.0 → 2.13.4', item: ['staging · invoices-api', 'health check failed 2 of 2'], meta: 'expires in 9 min', actions: ['deny', 'hold to approve'] } }
      ]
    }
  },
  sessions: [
    { id: 's1', project: 'billing-api', title: 'proration drift in src/billing', when: 'now', running: true },
    { id: 's2', project: 'billing-api', title: 'webhook retries and idempotency', when: '2h' },
    { id: 's3', project: 'billing-api', title: 'audit log export', when: 'yesterday' },
    { id: 's4', project: 'marketing-site', title: 'pricing page copy', when: 'yesterday' },
    { id: 's5', project: 'bethunter', title: 'ios build on the macOS vm', when: 'mon' }
  ],
  /* the conversation shown in the Figma frame */
  conversation: [
    { role: 'user', text: 'proration drifts by a cent on long invoices. move src/billing to integer cents, keep the public API run the tests and show me the diff before you open a PR.' },
    { role: 'assistant', model: 'qwen3-coder → sonnet 5.5', steps: 6, escalated: 1, time: '3m 42s', cost: '$0.37',
      paragraphs: [
        'Everything under `src/billing` now works as integer cents. `prorateCents` rounds once, at the end, half away from zero. so a 31-day invoice split over three proration events no longer drifts.'
      ],
      bullets: [
        '`money.ts` adds a branded `Cents` type. Conversion happens only at the API edge.',
        'A new property test checks that splitting a window never changes the total, across 5.000 random splits.'
      ],
      blank: { question: 'One open question, should I keep the old export name prorate as a deprecated alias?', options: ['keep as deprecated alias', 'keep for one release', 'remove it now'] },
      ship: { title: 'ready to ship', quote: 'integer cents, public API unchanged', passed: 142, rolledBack: 1, files: 4, add: 96, del: 71, branch: 'cents/proration' }
    }
  ],
  composerDraft: 'refactor the proration helpers in src/billing to use integer cents, run the tests, then open a PR. keep it cheap.',
  assume: ['refactor', 'src/billing', 'npm test', 'draft a PR', 'governed starts on qwen'],
  /* right sidebar panels */
  context: { used: 76000, total: 200000, parts: [ ['system + tools', 9000], ['project memory', 4000], ['src/billing files', 41000], ['conversation', 22000] ] },
  connectors: [ { name: 'github', tools: 14, state: 'on' }, { name: 'postgres', tools: 6, state: 'on' }, { name: 'linear', tools: 9, state: 'sign in' }, { name: 'sentry', tools: 5, state: 'off' } ],
  output: [ '$ npm test -- billing', ' PASS  prorate.test.ts (5000 runs)', ' PASS  money.test.ts', ' FAIL  invoice.test.ts  › rounds per line item', '↩ rolled back invoice.ts', '$ npm test', ' Tests  142 passed', ' Time   4.18 s' ],
  environment: { cwd: '~/code/billing-api', branch: 'cents/proration', sandbox: 'bubblewrap · network off', runtime: 'node 22.11 · python 3.12', hermes: 'hermes-agent v0.23.2 (pinned)', gate: 'npm test' },
  todos: [ ['read proration call sites', 'done'], ['convert to integer cents', 'done'], ['round once per invoice', 'doing'], ['property test for half-cents', 'todo'], ['draft PR', 'todo'] ],
  changes: [ ['src/billing/money.ts', 41, 0], ['src/billing/prorate.ts', 27, 44], ['src/billing/invoice.ts', 9, 27], ['src/billing/prorate.test.ts', 19, 0] ],
  governance: { mode: 'governed', ladder: [ ['qwen3-coder', 'first try'], ['haiku 4.5', 'after 1 fail'], ['sonnet 5.5', 'after 2 fails'], ['opus 5.5', 'by request'] ], current: 2, cap: '$0.60', spent: '$0.37' },
  ledger: { tokens: '48.2k', cost: '$0.37', trips: 14, escalations: 1 }
};
