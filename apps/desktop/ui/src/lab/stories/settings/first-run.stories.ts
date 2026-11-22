/* First run (host/first-run.ts, ADR-0040): every step and state of the first-run surface, drawn by the view itself against a scripted
   setup bridge and a fake host (the host is not in the lab): the welcome, the engine unpacking and its steps, the consent, the
   models hub (empty, partly and fully connected, each sign-in in progress, an error, a form in place), "do it later", the summary,
   the optional steps and the end. The hub's states drive it through its own data attributes (`data-do`, `data-way`), so the
   stories hold when the arrangement changes. */
import { entries } from '../../../data/providers';
import { runFirstRun } from '../../../host/first-run';
import type { ExtrasSource } from '../../../host/first-run';
import type { ChatgptBridge } from '../../../host/chatgpt-signin';
import { COPILOT_COPY, COPILOT_WAY } from '../../../host/copilot-signin';
import { mountSigninCard } from '../../../host/signin-card';
import type { SigninBridge, SigninEnd, SigninPage } from '../../../host/signin-card';
import { registerSigninCard } from '../../../host/providers-view';
import type { ProviderState, ProvidersBridge } from '../../../host/providers-bridge';
import type { SetupBridge, SetupProgress, SetupStatus } from '../../../host/setup-bridge';
import type { ModelsView } from '../../../host/bindings';
import { mountXaiSignin, XAI_WAY } from '../../../host/xai-signin';
import { frames } from '../../story';
import type { Render, State, Story } from '../../types';

type Over = Readonly<Record<string, Partial<ProviderState>>>;
const step = (id: string, title: string, state: SetupStatus['steps'][number]['state'], detail = '', code: string | null = null) => ({ id, title, state, detail, code });
const STEPS = (s: Record<string, SetupStatus['steps'][number]['state']>, detail: Record<string, string> = {}): SetupStatus['steps'] => [
  step('runtime', 'boopis engine', s['runtime'] ?? 'pending', detail['runtime']), step('plugin', 'boopis plugin', s['plugin'] ?? 'pending', detail['plugin']),
  step('hx', 'hx tool', s['hx'] ?? 'pending', detail['hx']), step('config', 'Settings boopis needs', s['config'] ?? 'pending', detail['config']),
  step('models', 'Models and keys', s['models'] ?? 'pending', detail['models']), step('restart', 'Start with boopis', s['restart'] ?? 'pending', detail['restart'])
];
const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });
const ALL_DONE = { runtime: 'done', plugin: 'done', hx: 'done', config: 'done', models: 'done', restart: 'done' } as const;

const CONSENT = { form_id: 'setup.config', kind: 'setup', title: 'Change three settings boopis needs?', body: 'tools.tool_search.enabled = off (so pack, ship and dispatch show directly)\ndelegation.backend = boopis (so governed work can be routed to each model tier)\nplugins.entries.boopis.allow_gateway_injection = true (so a Claude Code Stop hook that blocks can continue the turn)', schema: { type: 'object', properties: {} }, submit: { label: 'Apply the changes' }, cancel: { label: 'Not now' }, sensitive: false, origin: 'host', diff: [{ key: 'tools.tool_search.enabled', from: 'auto', to: 'off' }, { key: 'delegation.backend', from: null, to: 'boopis' }, { key: 'plugins.entries.boopis.allow_gateway_injection', from: null, to: true }] };
const ASK = { form_id: 'f-key', kind: 'credential', title: 'Add a key for your models', body: 'boopis needs one provider key to start. It goes to your keychain.', schema: { properties: { key: { type: 'string', title: 'Anthropic API key', 'x-secret': true } }, required: ['key'] }, submit: { label: 'Save key' }, cancel: { label: 'Skip' }, sensitive: true, origin: 'host', diff: [] };
const IDS = ['free', 'connected', 'later', 'openrouter-free', 'anthropic', 'claude-subscription', 'chatgpt-subscription', 'openai-key', 'gemini', 'xai', 'xai-subscription'];
const LADDER = { form_id: 'setup.ladder', kind: 'choice', title: 'Which model should do the work?', body: 'boopis runs governed work on a ladder of models, cheapest first, and only on frontier models. Pick where to start; you can change the ladder later.', schema: { type: 'object', required: ['choice'], properties: { choice: { type: 'string', title: 'Model', enum: IDS, enumNames: IDS, default: 'free' } } }, submit: { label: 'Continue' }, cancel: { label: 'Skip' }, sensitive: false, origin: 'host', diff: [] };
const AT_MODELS = status({ steps: STEPS({ runtime: 'done', plugin: 'done', hx: 'done', config: 'done', models: 'needs_input' }), form: LADDER as never });
const DONE = status({ steps: STEPS(ALL_DONE, { runtime: 'version 0.23.2, unpacked', models: 'ChatGPT subscription: gpt-6.2-sol on your ChatGPT sign-in', restart: 'boopis is ready' }), done: true, receipt: { lines: [] } });

const view = (tiers: Array<{ name: string; model: string }>, available = true, why: string | null = null): ModelsView => ({ state: tiers.length ? 'set' : 'default', tiers, claude: {} as never, claude_plugin: true, chatgpt: null, gemini_key: false, governed: { allowed: [], heavy: [], sentence: '', tiers: [], available, why }, heavy: [] }) as never;
const SOL = view([{ name: 'terra', model: 'openai-codex/gpt-6.1-terra' }, { name: 'sol', model: 'openai-codex/gpt-6.2-sol' }, { name: 'astra', model: 'openai-codex/gpt-6.2-astra' }]);
const FREE = view([{ name: 'free', model: 'nous/nous/welcome' }], false, 'Governed mode runs only on frontier models. Connect one in Settings, Models.');

const kindOf = (kind: string): ProviderState['kind'] => kind as ProviderState['kind'];
const baseline = (over: Over = {}, extra: ProviderState[] = []): ProviderState[] => [
  ...entries().flatMap((e) => e.ways.filter((w) => !w.hidden && w.kind !== 'custom').map((w): ProviderState => ({
    provider: e.id, way: w.id, kind: kindOf(w.kind), code: null, detail: null, plan: null, models_count: null, base_url: null, signin: null, checked_at: null, install: null,
    status: w.kind === 'key' ? 'needs_key' : w.kind === 'signin' ? 'signed_out' : w.kind === 'local' ? 'not_found' : 'connected', ...over[w.id]
  }))), ...extra
];
const SOME = baseline({ 'openai.signin': { status: 'connected', plan: 'ChatGPT Plus' }, 'google.key': { status: 'connected', models_count: 9 } });
const EVERYTHING = baseline({
  'anthropic.signin': { status: 'connected', plan: 'Claude Max' }, 'openai.signin': { status: 'connected', plan: 'ChatGPT Plus' }, 'github-copilot.signin': { status: 'connected' }, 'xai.signin': { status: 'connected', plan: 'SuperGrok' },
  'google.key': { status: 'connected', models_count: 9 }, 'deepseek.key': { status: 'connected', models_count: 3 }, 'openrouter.key': { status: 'connected', models_count: 200 }
}, [{ provider: 'custom', way: 'custom.lab-server', kind: 'custom', status: 'connected', code: null, detail: null, plan: null, models_count: null, base_url: 'http://127.0.0.1:8000/v1', signin: null, checked_at: 1, install: null }]);
/* the Claude subscription's card in each state the host reports (claude.rs, ADR-0029 as amended on 22 November 2026) */
const INSTALL_WINDOWS = { kind: 'install', command: 'irm https://claude.ai/install.ps1 | iex', shell: 'PowerShell', page: 'https://code.claude.com/docs/en/setup' } as const;
const INSTALL_MAC = { kind: 'install', command: 'curl -fsSL https://claude.ai/install.sh | bash', shell: 'Terminal', page: 'https://code.claude.com/docs/en/setup' } as const;
const UPDATE = { kind: 'update', command: 'claude update', shell: 'a terminal', page: 'https://code.claude.com/docs/en/setup#update-claude-code' } as const;
const CLAUDE: Readonly<Record<'missing' | 'desktop' | 'broken' | 'old' | 'metered', Partial<ProviderState>>> = {
  missing: { status: 'needs_install', detail: 'Claude Code, Anthropic’s command-line tool, is not installed yet. boopis runs your Claude plan through it: install it, then choose Check again.', install: INSTALL_WINDOWS },
  desktop: { status: 'needs_install', detail: 'The Claude desktop app is here, but its Claude Code works only inside the app. boopis needs the Claude Code command-line tool, which is separate: install it, then choose Check again.', install: INSTALL_MAC },
  broken: { status: 'error', code: 'hx.provider.cli_failed', detail: 'Claude Code is installed (C:\\Users\\ana\\AppData\\Roaming\\npm\\claude.cmd), but the system could not start it. Install it again with Anthropic’s installer, then choose Check again.', install: INSTALL_WINDOWS },
  old: { status: 'error', code: 'hx.provider.needs_update', detail: 'Claude Code 2.1.200 is older than the oldest one that serves a Claude model here (2.1.280). Update it with `claude update`, then choose Check again.', install: UPDATE },
  metered: { status: 'error', code: 'hx.provider.metered', detail: 'Claude Code 2.1.328 is signed in with an Anthropic API key, which bills API usage instead of your Claude subscription. Choose Sign in to Claude to sign in with your Claude account, then Check again.' }
};
const TROUBLE = baseline({ 'openai.signin': { status: 'connected', plan: 'ChatGPT Plus' }, 'google.key': { status: 'error', code: 'hx.provider.key_rejected', detail: 'Google refused the key.' }, 'anthropic.signin': CLAUDE.broken });
const OLLAMA: ProviderState = { provider: 'ollama', way: 'ollama.local', kind: 'local', status: 'found_local', code: null, detail: 'llama3.2:latest, qwen3:8b', plan: null, models_count: 2, base_url: 'http://127.0.0.1:11434/v1', signin: null, checked_at: 1, install: null };

/** a sign-in that the host runs and the person has not finished: the page, and a code when the lab uses one */
const waiting = (page: SigninPage): SigninBridge => ({ waiting: () => Promise.resolve(null), start: () => Promise.resolve(page), cancel: () => Promise.resolve(), onEnd: (cb: (e: SigninEnd) => void) => { void cb; return Promise.resolve(() => undefined); }, open: () => Promise.resolve(), copy: () => Promise.resolve() });
const FAR = (): number => Date.now() + 15 * 60000;
const chatgptBridge: ChatgptBridge = {
  status: () => Promise.resolve({ state: 'signed_out', plan: null, code: null, account: null, notice: null }),
  start: () => Promise.resolve({ verification_url: 'https://auth.openai.com/api/accounts/authorize?state=lab', user_code: '', expires_at: FAR() }),
  cancel: () => Promise.resolve(), signOut: () => Promise.resolve({ revoked: true }), onEnd: () => Promise.resolve(() => undefined), open: () => Promise.resolve(), copy: () => Promise.resolve()
};
const signins = { chatgpt: chatgptBridge, login: () => new Promise<never>(() => undefined), open: () => Promise.resolve() } as never;

const providersBridge = (list: ProviderState[], probe: ProviderState[] = []): ProvidersBridge => ({
  list: () => Promise.resolve(list), probe: () => Promise.resolve(probe),
  setKey: () => Promise.reject(new Error('lab')), remove: () => Promise.reject(new Error('lab')), signOut: () => Promise.reject(new Error('lab')),
  signinStart: () => Promise.reject(new Error('lab')), signinCancel: () => Promise.resolve(), onSigninEnd: () => Promise.resolve(() => undefined),
  testEndpoint: () => Promise.reject(new Error('lab')), addEndpoint: () => Promise.reject(new Error('lab')), useLocal: () => Promise.reject(new Error('lab'))
});

class Fake implements SetupBridge {
  private i = 0;
  listeners = new Set<(p: SetupProgress) => void>();
  constructor(private script: SetupStatus[], private model: ModelsView | null = null, private hang = false) {}
  check() { return Promise.resolve({ hermes_installed: true, needed: true, reason: 'lab' }); }
  source() { return Promise.resolve({ saved: null, from_env: null, next: 'bundled', running: 'bundled', carries_runtime: true } as never); }
  onProgress(cb: (p: SetupProgress) => void) { this.listeners.add(cb); return Promise.resolve(() => { this.listeners.delete(cb); }); }
  advance() {
    if (this.hang) { for (const l of this.listeners) l({ step: 'runtime', phase: 'unpack', read: 92_000_000, total: 204_000_000 } as never); return new Promise<SetupStatus>(() => undefined); }
    const next = this.script[Math.min(this.i, this.script.length - 1)] as SetupStatus;
    this.i += 1;
    return Promise.resolve(next);
  }
  modelsView() { return Promise.resolve(this.model as ModelsView); }
  reopen() { this.i = Math.max(0, this.i - 1); return Promise.resolve(); }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const press = (root: HTMLElement, sel: string): void => { root.querySelector<HTMLElement>(sel)?.click(); };
const pressText = (root: HTMLElement, text: string): void => { [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === text)?.click(); };
const EXTRAS: ExtrasSource = {
  connectors: () => Promise.resolve([{ name: 'GitHub', line: 'Pull requests, issues and code search.' }, { name: 'Linear', line: 'Issues and projects.' }, { name: 'A database', line: 'Read-only queries against your own database.' }]),
  store: () => Promise.resolve([{ name: 'Repo reader', line: 'Reads a repository before it edits it.' }, { name: 'Release notes', line: 'Writes release notes from merged work.' }])
};

interface Run { script: SetupStatus[]; model?: ModelsView | null; list?: ProviderState[]; probe?: ProviderState[]; hang?: boolean; extras?: ExtrasSource; onWelcome?: boolean; after?: (root: HTMLElement) => Promise<void> | void; noProviders?: boolean }
const draw = (r: Run): Render => async ({ root }) => {
  /* the shared cards for xAI and Copilot, with a host that has a page ready (the real ones reach the host) */
  registerSigninCard(XAI_WAY, (host, done) => mountXaiSignin(host, waiting({ url: 'https://auth.x.ai/device', code: 'LMNP-4821', expiresAt: FAR() }), { onSignedIn: done }));
  registerSigninCard(COPILOT_WAY, (host, done) => mountSigninCard(host, waiting({ url: 'https://github.com/login/device', code: 'WDJB-MJHT', expiresAt: FAR() }), COPILOT_COPY, { onSignedIn: done }));
  void runFirstRun(new Fake(r.script, r.model ?? null, r.hang), root, { signins, extras: r.extras ?? EXTRAS, ...(r.noProviders ? {} : { providers: providersBridge(r.list ?? baseline(), r.probe ?? []) }) });
  await wait(300);
  if (r.onWelcome) return;
  pressText(root, 'Set up');
  await wait(r.hang ? 300 : 900);
  await frames(2);
  if (r.after) { await r.after(root); await frames(3); }
};
const FR = (tags: State['tags'], r: Run, extra: Partial<State> = {}): State => ({ tags, render: draw(r), scope: '.hx-first-run', allow: { 'stability.render': 'the welcome logo plays once' }, ...extra });
const hub = (list: ProviderState[], extra: Partial<Run> = {}): Run => ({ script: [AT_MODELS], list, ...extra });
const through = async (root: HTMLElement, ...labels: string[]): Promise<void> => { for (const l of labels) { pressText(root, l); await wait(1000); } };

const first: Story = {
  id: 'settings/first-run', title: 'First run', area: 'settings', kind: 'surface', covers: ['surface:first-run'], mock: { url: '/v6/__index.html', note: 'the mock has no first run' },
  states: {
    welcome: FR(['typical'], { script: [AT_MODELS], onWelcome: true }),
    'unpacking the engine': FR(['loading'], { script: [AT_MODELS], hang: true }),
    'steps running': FR(['variant'], { script: [status({ steps: STEPS({ runtime: 'done', plugin: 'done', hx: 'pending' }) })] }),
    'consent: the three settings': FR(['variant'], { script: [status({ steps: STEPS({ runtime: 'done', plugin: 'done', hx: 'done', config: 'needs_input' }), form: CONSENT as never })] }),
    'consent declined': FR(['disabled'], { script: [status({ steps: STEPS({ runtime: 'done', plugin: 'done', hx: 'done', config: 'declined', models: 'done', restart: 'done' }, { config: 'Not changed. Without these, pack, ship and dispatch may hide behind tool search.' }), done: true, receipt: { lines: ['You declined the settings boopis needs, so some features are off.'] } })] }),
    'a question (a key)': FR(['variant'], { script: [status({ steps: STEPS({ runtime: 'done', plugin: 'done', hx: 'done', config: 'done', models: 'needs_input' }), form: ASK as never })] }),
    blocked: FR(['error'], { script: [status({ steps: STEPS({ runtime: 'blocked' }, { runtime: 'The engine could not be unpacked: the disk is full.' }) })] }),
    'blocked, no engine': FR(['error'], { script: [status({ steps: STEPS({ runtime: 'blocked' }, { runtime: 'No engine was found on this computer.' }), install_command: 'curl -fsSL https://example.invalid/install.sh | sh' })] }),
    'models hub, nothing connected': FR(['empty'], hub(baseline())),
    'models hub, partly connected': FR(['variant'], hub(SOME)),
    'models hub, everything connected': FR(['many'], hub(EVERYTHING, { probe: [OLLAMA] })),
    'models hub, a runtime found on this computer': FR(['variant'], hub(baseline(), { probe: [OLLAMA] })),
    'models hub, trouble in words': FR(['error'], hub(TROUBLE)),
    'models hub, Claude Code not installed (Windows)': FR(['variant'], hub(baseline({ 'openai.signin': { status: 'connected', plan: 'ChatGPT Plus' }, 'anthropic.signin': CLAUDE.missing }))),
    'models hub, Claude Code: only the desktop app’s copy': FR(['variant'], hub(baseline({ 'anthropic.signin': CLAUDE.desktop }))),
    'models hub, Claude Code did not start': FR(['error'], hub(baseline({ 'anthropic.signin': CLAUDE.broken }))),
    'models hub, Claude Code too old': FR(['variant'], hub(baseline({ 'anthropic.signin': CLAUDE.old }))),
    'models hub, Claude Code billed per use': FR(['variant'], hub(baseline({ 'anthropic.signin': CLAUDE.metered }))),
    'models hub, a key form in place': FR(['open'], hub(baseline(), { after: (root) => { press(root, '[data-do="key"][data-way="google.key"]'); } })),
    'models hub, more providers open': FR(['open'], hub(baseline(), { after: (root) => { press(root, '#hx-prov-more'); } })),
    'models hub, a connected key can be removed': FR(['variant'], hub(SOME, { after: (root) => { press(root, '[data-do="remove"][data-way="google.key"]'); } })),
    'sign-in: ChatGPT, at its button': FR(['open'], hub(baseline(), { after: (root) => { press(root, '[data-do="signin"][data-way="openai.signin"]'); } })),
    'sign-in: ChatGPT, waiting': FR(['loading'], hub(baseline(), { after: async (root) => { press(root, '[data-do="signin"][data-way="openai.signin"]'); await wait(900); press(root, '[data-act="start"]'); await wait(300); } })),
    'sign-in: GitHub, the code': FR(['loading'], hub(baseline(), { after: async (root) => { press(root, '[data-do="signin"][data-way="github-copilot.signin"]'); await wait(900); press(root, '[data-act="start"]'); await wait(300); } })),
    'sign-in: xAI, the code': FR(['loading'], hub(baseline(), { after: async (root) => { press(root, '[data-do="signin"][data-way="xai.signin"]'); await wait(900); press(root, '[data-act="start"]'); await wait(300); } })),
    'sign-in: Claude, waiting for the browser': FR(['loading'], hub(baseline(), { after: (root) => { press(root, '[data-do="signin"][data-way="anthropic.signin"]'); } })),
    'do it later: the summary': FR(['variant'], { script: [AT_MODELS, status({ steps: STEPS({ ...ALL_DONE }, { models: 'Nous free tier: one model at every tier' }), done: true, receipt: { lines: [] } })], model: FREE, list: baseline(), after: (root) => through(root, 'Do it later') }),
    'summary: a ladder from what is connected': FR(['success'], { script: [AT_MODELS, DONE], model: SOL, list: SOME, after: (root) => through(root, 'Continue') }),
    'summary: several labs, change the start': FR(['variant'], { script: [AT_MODELS, DONE], model: SOL, list: EVERYTHING, after: (root) => through(root, 'Continue') }),
    'summary: choose where to start': FR(['open'], { script: [AT_MODELS, DONE], model: SOL, list: EVERYTHING, after: (root) => through(root, 'Continue', 'Change my starting model') }),
    'optional: connectors': FR(['variant'], { script: [AT_MODELS, DONE], model: FREE, list: baseline(), after: (root) => through(root, 'Do it later', 'Continue') }),
    'optional: connectors, none to list': FR(['empty'], { script: [AT_MODELS, DONE], model: FREE, list: baseline(), extras: { connectors: () => Promise.resolve([]), store: () => Promise.resolve([]) }, after: (root) => through(root, 'Do it later', 'Continue') }),
    'optional: the store': FR(['variant'], { script: [AT_MODELS, DONE], model: FREE, list: baseline(), after: (root) => through(root, 'Do it later', 'Continue', 'Skip') }),
    done: FR(['success'], { script: [AT_MODELS, DONE], model: FREE, list: baseline(), after: (root) => through(root, 'Do it later', 'Continue', 'Skip', 'Skip') }),
    'done, with a declined step': FR(['disabled'], { script: [status({ steps: STEPS({ runtime: 'done', plugin: 'declined', hx: 'skipped', config: 'done', models: 'done', restart: 'done' }, { plugin: 'The plugin was declined: boopis runs without its tools.' }), done: true, receipt: { lines: ['Windows: mods are off.'] } })] }),
    'without a host to look at (the models question as the host asks it)': FR(['variant'], { script: [AT_MODELS], noProviders: true }),
    'long details': FR(['long'], { script: [status({ steps: STEPS({ runtime: 'done', plugin: 'blocked' }, { plugin: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard_v2_final.ts could not be written: permission denied (EACCES) while unpacking' }) })] })
  }
};

export default first;
