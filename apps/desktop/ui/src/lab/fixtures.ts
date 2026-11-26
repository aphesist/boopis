/* The lab's typed fixtures. Real data first: the cards' and forms' data are the v6 mock-up's own gallery data
   (design/v6/cards.test.html, built from its data.js and the port's mock-data.ts); the bots are the mock's roster. The
   rest are the hard cases every story needs: long names, unbroken strings, many lines, many items, right to left. */
import type { Bot } from '../data/types';
import type { CardData } from '../modules/cards';
import { endpointForm } from '../host/forms';
import { S1_TURNS, STEPS } from '../data/mock-data';

/* ───────── text ───────── */
export const LONG_NAME = 'cassiopeia-staging-deploy-guardian';
export const LONG_TITLE = 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close and the auditors arrive on Monday';
export const UNBROKEN = 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard_v2_final.ts';
export const URLISH = 'https://billing-api.internal.example.com/v2/invoices/inv_01HZX9Q2Y7K3M8N4P6R5S0T1V2W3/reconcile?dry_run=true&compare=200';
export const MULTILINE = 'First line of the request.\nSecond line, after a break.\n\nA paragraph after a blank line, then a long one that wraps across the composer more than once because it keeps going.';
export const PARAGRAPH = 'Everything under src/billing now works as integer cents. prorateCents rounds once, at the end, half away from zero, so a 31-day invoice split over three proration events no longer drifts.';
/** Arabic and Hebrew: the app does not translate, but names and pasted text can be right to left */
export const RTL = 'مرحبا بالعالم، هذا نص طويل من اليمين إلى اليسار · שלום עולם';

export const STEPS_SEED = STEPS;
export const TURNS_SEED = S1_TURNS;

/* ───────── bots ───────── */
const SHAPES = ['circle', 'triangle', 'flower', 'hexagon', 'drop', 'cloud', 'squircle', 'star'];
const COLORS = ['#efece6', '#f23b5a', '#4fc9a8', '#3b82f6', '#a6a6ab', '#f5a337', '#1c1c24', '#c4834a', '#9b5cf6', '#6d5cf0', '#2fd26a'];
const STATES = ['idle', 'working', 'thinking', 'sleeping', 'happy', 'needs', 'speaking', 'compute'];
/** `n` bots: the mock's roster first, then generated ones (bot data, not interface colour) */
export function manyBots(n: number, seed: readonly Bot[]): Bot[] {
  const out: Bot[] = seed.slice(0, n).map((b) => ({ ...b }));
  const tpl = seed[0];
  for (let i = out.length; i < n && tpl; i++) {
    const id = 'bot-' + String(i).padStart(3, '0');
    out.push({ ...tpl, id, name: id, role: 'generated teammate ' + i, shape: SHAPES[i % SHAPES.length]!, color: COLORS[i % COLORS.length]!, state: STATES[i % STATES.length]!, attention: i % 17 === 0 ? 'approval' : null, last: null, activity: '' });
  }
  return out;
}
/** the owner's six teammates as their saved records draw them (`<profile>/boopis/bot.json`, 22 November 2026): the looks every
    place must agree on (bot data, not interface colour) */
export const TEAM_SIX = [
  { id: 'kai', name: 'kai', shape: 'circle', color: '#4fc9a8', state: 'idle' },
  { id: 'nina', name: 'nina', shape: 'triangle', color: '#f23b5a', state: 'idle' },
  { id: 'moss', name: 'moss', shape: 'squircle', color: '#2fd26a', state: 'idle' },
  { id: 'iris', name: 'iris', shape: 'flower', color: '#3b82f6', state: 'idle' },
  { id: 'hex', name: 'hex', shape: 'hexagon', color: '#a6a6ab', state: 'idle' },
  { id: 'nimbus', name: 'nimbus', shape: 'cloud', color: '#9b5cf6', state: 'idle' }
] as const;
export const BOT_LIKE = { id: 'nina', name: 'nina', shape: 'triangle', color: '#f23b5a', eyes: 'pill', state: 'needs', attention: 'approval' } as const;
export const BOT_LONG = { id: LONG_NAME, name: LONG_NAME, shape: 'star', color: '#e8b04a', eyes: 'pill', state: 'working', attention: null } as const;

/* ───────── forms (cards.test.html `F`, as their senders send them; FORMS.md section 2) ───────── */
export const FORM_SPECS: Readonly<Record<string, CardData>> = {
  credential: { id: 'f-openai', kind: 'credential', origin: { kind: 'agent', model: 'sonnet 5.5' }, title: 'Add your OpenAI key', why: 'The embeddings step calls text-embedding-3-small, and your OpenAI provider has no key yet. I’ll keep working on the parts that don’t need it.', effect: 'Saves to your keychain and connects the OpenAI provider. sonnet 5.5 never sees the key.', provider: 'OpenAI', expires: 'expires in 30 min',
    schema: { properties: { key: { type: 'string', title: 'OpenAI API key', 'x-secret': true, placeholder: 'sk-…', pattern: '^sk-[A-Za-z0-9_-]{20,}$', 'x-error': 'That doesn’t look like an OpenAI key: it starts with sk- and is at least 23 characters', description: 'From platform.openai.com, API keys. Paste it once; boopis keeps it.' } }, required: ['key'] } },
  question: { id: 'f-rounding', kind: 'question', origin: { kind: 'teammate', ids: ['atlas'] }, title: 'How should line items round before the total?', why: 'invoice.ts:88 divides before rounding. Pick a rule and I’ll apply it to every line item.', effect: 'Your answer goes back to atlas mid-review.',
    schema: { properties: { rule: { type: 'string', title: 'Rounding rule', enum: ['half-away', 'half-even', 'none'], enumNames: ['Half away from zero', 'Half to even (banker’s)', 'Don’t round line items'], 'x-other': true } }, required: ['rule'] } },
  permission: { id: 'f-publish', kind: 'permission', origin: { kind: 'agent', model: 'sonnet 5.5' }, title: 'Allow npm publish in billing-api?', why: 'To publish @acme/billing 2.4.0 to the npm registry, as you asked.', effect: 'Always writes the rule to boopis.yaml for this project. Deny stops the publish; nothing else changes.',
    schema: { properties: { scope: { type: 'string', title: 'Allow', enum: ['once', 'session', 'always', 'deny'], enumNames: ['Once', 'For this session', 'Always, in this project', 'Deny'], default: 'once' } }, required: ['scope'] }, cancel: false },
  setup: { id: 'f-gate', kind: 'setup', origin: { kind: 'plugin' }, title: 'Set the gate command for billing-api', file: 'boopis.yaml', why: 'Every ship ends at the gate, and this project has none yet. I found npm test in package.json.',
    diff: ' project: billing-api\n+gate:\n+  command: npm test\n+  timeout: 5m\n+  network: false\n governance:\n-  cap: $0.60\n+  cap: $1.00', effect: 'Writes boopis.yaml for this project only. Nothing outside the project changes.',
    schema: { properties: { gate: { type: 'string', title: 'Gate command', default: 'npm test', 'x-mono': true, minLength: 2 }, timeout: { type: 'integer', title: 'Timeout in minutes', default: 5, minimum: 1, maximum: 60 }, network: { type: 'boolean', title: 'Allow network during the gate', description: 'Off keeps the gate hermetic.', default: false } }, required: ['gate', 'timeout'] } },
  signin: { id: 'f-linear', kind: 'signin', origin: { kind: 'teammate', ids: ['kai'] }, title: 'Sign in to Linear', provider: 'Linear', why: 'I file the changelog as Linear issues. I only learn that sign-in worked.', effect: 'Saves the Linear token to your keychain. kai never sees it.',
    schema: { properties: { linear: { 'x-signin': { provider: 'Linear', host: 'linear.app', flow: 'browser' } } }, required: ['linear'] } },
  approval: { id: 'f-deploy', kind: 'approval', origin: { kind: 'teammate', ids: ['nina'] }, title: 'Deploy billing/cents to staging', why: 'Tests are green. A dry run first, then 200 real invoices compared to the cent.', effect: 'Deploys to staging (invoices-api). Production is untouched. Costs about $0.02.', expires: 'expires in 9 min',
    schema: { properties: { note: { type: 'string', title: 'Note for nina', 'x-multiline': true } } } },
  connector: { id: 'f-sentry', kind: 'connector', origin: { kind: 'teammate', ids: ['kai'] }, title: 'Install the Sentry MCP server', name: 'sentry-mcp 0.9.2', why: 'kai asked for Sentry errors in the morning digest.', contents: [['5 tools', 'issues, events, releases, projects, alerts'], ['Network', 'sentry.io only'], ['Runs', 'in the sandbox, no file access']], pinned: 'sha256:9f2c04e1…b17a',
    effect: 'Installs into this profile and pins the hash. You can remove it from Connectors.', schema: { properties: {} } },
  choice: { id: 'f-remote', kind: 'choice', origin: { kind: 'host' }, title: 'Pick a folder for Remote Control', why: 'A cloud session asked to use a folder on this computer.', effect: 'Shares only this folder with the session, until you stop it.',
    schema: { properties: { folder: { 'x-picker': 'folder', title: 'Folder', default: '~/code/billing-api' }, model: { 'x-picker': 'model', title: 'Model for the session', default: 'sonnet 5.5' } }, required: ['folder'] } },
  plan: { id: 'f-plan', kind: 'plan', origin: { kind: 'agent', model: 'sonnet 5.5' }, title: 'Approve the plan before I start', plan: ['Move `src/billing` to integer cents behind a `Cents` type', 'Round once per invoice, half away from zero', 'Add a property test across 5,000 random splits', 'Open a draft PR with the diff'],
    effect: 'Starts the work in plan order. Nothing is written until you approve.', schema: { properties: { changes: { type: 'string', title: 'Anything to change?', 'x-multiline': true } } } },
  feedback: { id: 'f-feedback', kind: 'feedback', origin: { kind: 'host' }, title: 'Was this result right?', effect: 'Stored for you only. It feeds nothing automatically.',
    schema: { properties: { verdict: { type: 'string', title: 'The result was', enum: ['right', 'partly', 'wrong'], enumNames: ['Right', 'Partly right', 'Wrong'] }, note: { type: 'string', title: 'What was off?', 'x-multiline': true } }, required: ['verdict'] } },
  theme: { id: 'f-theme', kind: 'theme', origin: { kind: 'mod', plugin: 'sunset' }, title: 'Apply sunset’s colours?', why: 'The sunset mod proposes a warmer accent.', swatches: [['Accent', '#e0a458'], ['Ground', '#1b1712'], ['Text', '#f3e9da']], preview: false, schema: { properties: {} } },
  endpoint: { ...endpointForm('test').spec, origin: { kind: 'host' } } as unknown as CardData,
  'endpoint-found': { ...endpointForm('save', { found: ['qwen3-coder-30b', 'llama-3.3-70b-instruct', 'mistral-small-3.2'], values: { name: 'Lab server', base_url: 'http://127.0.0.1:8000/v1' } }).spec, origin: { kind: 'host' } } as unknown as CardData,
  multi: { id: 'f-rerun', kind: 'question', origin: { kind: 'teammate', ids: ['moss'] }, title: 'Which suites should I rerun?', why: 'Three suites flaked overnight.', effect: 'moss reruns them on the next free runner.',
    schema: { properties: { suites: { type: 'string', title: 'Suites', 'x-multi': true, enum: ['invoice.test.ts', 'prorate.test.ts', 'webhook.test.ts'] }, log: { 'x-upload': true, title: 'Failing log' } }, required: ['suites'] } }
};
/** the form card's states (modules/cards/form.ts) */
export const FORM_STATES = ['open', 'invalid', 'submitting', 'done', 'deferred', 'expired', 'cancelled'] as const;
/** forms whose every string is long: one teammate with a long name, five askers, a relay, a long model */
export const FORM_LONG: Readonly<Record<string, CardData>> = {
  one: { id: 'long-one', kind: 'approval', origin: { kind: 'teammate', ids: [LONG_NAME] }, title: LONG_TITLE, why: URLISH, effect: 'Deploys to staging only. ' + UNBROKEN, expires: 'expires in 9 min', schema: { properties: { note: { type: 'string', title: 'Note for ' + LONG_NAME, 'x-multiline': true } } } },
  five: { id: 'long-five', kind: 'permission', origin: { kind: 'teammate', ids: ['nina', 'atlas', 'kai', 'moss', 'iris'] }, title: 'Allow npm publish?', schema: { properties: { scope: { type: 'string', title: 'Allow', enum: ['once', 'session', 'always', 'deny'], default: 'once' } }, required: ['scope'] } },
  relay: { id: 'long-relay', kind: 'question', origin: { kind: 'teammate', ids: [LONG_NAME], via: 'atlas' }, title: 'Keep staging up overnight?', why: 'atlas is asking for ' + LONG_NAME + ', who is in the review.', schema: { properties: { keep: { type: 'string', title: 'Keep it up', enum: ['yes', 'no'] } }, required: ['keep'] } },
  model: { ...FORM_SPECS['permission'], id: 'long-model', origin: { kind: 'agent', model: 'claude-sonnet-5-5-20261101-extended-context-preview' } }
};
