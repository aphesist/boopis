// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFirstRun } from './first-run';
import type { ExtrasSource, FirstRunExit } from './first-run';
import type { SetupBridge, SetupProgress, SetupStatus } from './setup-bridge';
import type { ProviderState, ProvidersBridge } from './providers-bridge';
import type { ModelsView } from './bindings';
type HostModelsView = ModelsView;

/* The models hub of first run (ADR-0040): every way in one place, connect as many as you like, Continue reads what is connected,
   "Do it later" starts on the free models, and the summary says what was set up and lets the person change where to start. */
type Form = NonNullable<SetupStatus['form']>;
const IDS = ['free', 'openrouter-free', 'anthropic', 'claude-subscription', 'chatgpt-subscription', 'openai-key', 'gemini', 'xai', 'connected', 'later'];
const ladder = (): Form => ({ form_id: 'setup.ladder', kind: 'choice', title: 'Which model should do the work?', body: 'x', schema: { type: 'object', required: ['choice'], properties: { choice: { type: 'string', enum: IDS, enumNames: IDS, default: 'free' } } }, submit: { label: 'Continue' }, cancel: { label: 'Skip' }, sensitive: false, origin: 'host', diff: [] }) as never;
const step = (id: string, state: SetupStatus['steps'][number]['state'], detail = '') => ({ id, title: id, state, detail, code: null });
const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });
const AT_MODELS = status({ steps: [step('runtime', 'done'), step('models', 'needs_input')], form: ladder() });
const DONE = status({ steps: [step('runtime', 'done'), step('models', 'done', 'ChatGPT subscription: gpt-6.2-sol on your ChatGPT sign-in')], done: true, receipt: { lines: ['models: x'] } });

const state = (way: string, status: ProviderState['status'], extra: Partial<ProviderState> = {}): ProviderState =>
  ({ provider: way.split('.')[0] ?? way, way, kind: way.endsWith('signin') ? 'signin' : 'key', status, code: null, detail: null, plan: null, models_count: null, base_url: null, signin: null, checked_at: null, ...extra });

class Setup implements SetupBridge {
  answers: Array<Parameters<SetupBridge['advance']>[0]> = [];
  reopened = 0;
  constructor(private script: SetupStatus[], public view: Partial<HostModelsView> | null = null) {}
  check() { return Promise.resolve({ hermes_installed: true, needed: true, reason: 'x' }); }
  source() { return Promise.resolve({ running: 'bundled', carries_runtime: true } as never); }
  onProgress(_cb: (p: SetupProgress) => void) { return Promise.resolve(() => undefined); }
  advance(answer: Parameters<SetupBridge['advance']>[0]) { this.answers.push(answer); return Promise.resolve(this.script.length > 1 ? (this.script.shift() as SetupStatus) : (this.script[0] as SetupStatus)); }
  modelsView() { return Promise.resolve(this.view as ModelsView); }
  reopen() { this.reopened += 1; return Promise.resolve(); }
}
const providers = (list: ProviderState[]): ProvidersBridge => ({
  list: () => Promise.resolve(list), probe: () => Promise.resolve([]), setKey: () => Promise.reject(new Error('no')), remove: () => Promise.reject(new Error('no')),
  signOut: () => Promise.reject(new Error('no')), signinStart: () => Promise.reject(new Error('no')), signinCancel: () => Promise.resolve(),
  onSigninEnd: () => Promise.resolve(() => undefined), testEndpoint: () => Promise.reject(new Error('no')), addEndpoint: () => Promise.reject(new Error('no')), useLocal: () => Promise.reject(new Error('no'))
}) as never;
const signins = { chatgpt: { status: () => Promise.resolve({}), start: () => Promise.reject(new Error('no')), cancel: () => Promise.resolve(), signOut: () => Promise.resolve({ revoked: true }), onEnd: () => Promise.resolve(() => undefined), open: () => Promise.resolve(), copy: () => Promise.resolve() }, login: () => Promise.resolve({ ok: true, timed_out: false, output: [] }), open: () => Promise.resolve() } as never;

const tick = async (n = 6): Promise<void> => { for (let i = 0; i < n; i += 1) await vi.advanceTimersByTimeAsync(0); };
const btn = (text: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === text);
const click = async (text: string): Promise<void> => { const b = btn(text); expect(b, text).toBeTruthy(); b?.click(); await tick(); await vi.advanceTimersByTimeAsync(900); await tick(); };
const names = (): string[] => [...document.querySelectorAll('.ui-sso')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '');

const start = async (setup: Setup, list: ProviderState[], extras?: ExtrasSource, exits: FirstRunExit[] = []): Promise<void> => {
  void runFirstRun(setup, document.body, { providers: providers(list), signins, ...(extras ? { extras } : {}), onExit: (e) => { exits.push(e); } });
  await tick();
  await click('Set up');
  await tick(12);
};

beforeEach(() => { document.body.replaceChildren(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the models hub', () => {
  it('lists every lab in one place: the four sign-ins as branded buttons first, then the keys and the rest, with Continue off until something is connected', async () => {
    const setup = new Setup([AT_MODELS]);
    await start(setup, [state('openai.signin', 'signed_out'), state('github-copilot.signin', 'signed_out'), state('xai.signin', 'signed_out'), state('anthropic.signin', 'signed_out'), state('google.key', 'needs_key')]);
    expect(document.querySelector('h1')?.textContent).toBe('Connect your labs');
    expect(names()).toEqual(['Continue with ChatGPT', 'Continue with GitHub', 'Continue with Claude', 'Continue with xAI'].sort((a, b) => names().indexOf(a) - names().indexOf(b)));
    expect(names().sort()).toEqual(['Continue with ChatGPT', 'Continue with Claude', 'Continue with GitHub', 'Continue with xAI']);
    expect(document.querySelector('.fr-plates')).toBeTruthy();
    expect(document.querySelectorAll('.fr-plate')).toHaveLength(4);
    expect(document.body.textContent).toContain('Gemini');
    expect(document.body.textContent, 'Gemini is a key, never a sign-in').not.toMatch(/Continue with Google|Sign in with Google/);
    const go = document.querySelector<HTMLButtonElement>('[data-fr-continue]');
    expect(go?.disabled).toBe(true);
    expect(document.querySelectorAll('.ui-btn--primary'), 'one primary action in the step: Continue').toHaveLength(1);
    expect(btn('Do it later'), 'the quiet way out').toBeTruthy();
    expect(document.body.textContent).toContain('Settings, Models');
    expect(document.querySelector('.fr-progress__text')?.textContent).toBe('Step 2 of 4');
    expect(document.querySelector('.fr-line__i[aria-current="step"]')?.textContent).toBe('Models');
    expect(document.querySelector('[data-fr-sum]')?.textContent).toBe('Nothing connected yet');
  });

  it('shows each lab\'s state in words and continues with what is connected, sending the host the one answer "connected"', async () => {
    const setup = new Setup([AT_MODELS, DONE], { state: 'set', tiers: [{ name: 'sol', model: 'openai-codex/gpt-6.2-sol' }, { name: 'astra', model: 'openai-codex/gpt-6.2-astra' }], governed: { available: true, why: null, allowed: [], heavy: [], sentence: '', tiers: [] } } as never);
    await start(setup, [state('openai.signin', 'connected', { plan: 'ChatGPT Plus' }), state('github-copilot.signin', 'signed_out'), state('google.key', 'connected')]);
    expect(document.querySelector('.fr-plate[data-way="openai.signin"]')?.textContent).toContain('connected');
    expect(document.querySelector('.fr-plate[data-way="openai.signin"]')?.textContent).toContain('ChatGPT Plus');
    expect(document.querySelector('.fr-plate[data-way="github-copilot.signin"]')?.textContent).toContain('not connected');
    expect(document.querySelector('.fr-tile[data-way="google.key"]')?.getAttribute('data-state'), 'a connected key tile inverts').toBe('connected');
    const go = document.querySelector<HTMLButtonElement>('[data-fr-continue]');
    expect(go?.disabled).toBe(false);
    expect(document.querySelector('[data-fr-sum]')?.textContent).toBe('2 connected. Starts on OpenAI (ChatGPT Plus).');
    await click('Continue');
    expect(setup.answers.at(-1)).toEqual({ form_id: 'setup.ladder', cancelled: false, values: { choice: 'connected' }, secrets: {} });
    // the summary: what it starts with, the ladder, whether governed mode can run, what is connected
    const text = document.body.textContent ?? '';
    expect(document.querySelector('h1')?.textContent).toBe('Your models are set');
    expect(text).toContain('Starts with');
    expect(document.querySelector('[data-fr-summary] .ui-ladder')).toBeTruthy();
    expect(text).toContain('Governed mode');
    expect(text).toContain('OpenAI, Google Gemini');
  });

  it('"Do it later" answers the host with the free choice and says, once, where to connect any time; the summary is the free models', async () => {
    const setup = new Setup([AT_MODELS, status({ steps: [step('runtime', 'done'), step('models', 'done', 'Nous free tier')], done: true, receipt: { lines: [] } })], { state: 'set', tiers: [{ name: 'free', model: 'nous/nous/welcome' }], governed: { available: false, why: 'Needs a frontier model.', allowed: [], heavy: [], sentence: '', tiers: [] } } as never);
    await start(setup, []);
    expect(document.querySelectorAll('[data-fr-later-line]')).toHaveLength(1);
    expect(document.querySelector('[data-fr-later-line]')?.textContent).toContain('Settings, Models');
    await click('Do it later');
    expect(setup.answers.at(-1)).toEqual({ form_id: 'setup.ladder', cancelled: false, values: { choice: 'later' }, secrets: {} });
    expect(document.querySelector('h1')?.textContent).toBe('You are starting on the free models');
    expect(document.body.textContent).toContain('You can connect any lab at any time in Settings, Models.');
    expect(document.body.textContent).toContain('The free models');
    expect(document.body.textContent).toContain('Needs a frontier model.');
  });

  it('lets the person change where to start among the labs that are connected: the host forgets, asks again and is answered with that lab\'s own choice', async () => {
    const view = { state: 'set', tiers: [{ name: 'sol', model: 'openai-codex/gpt-6.2-sol' }], governed: { available: true, why: null, allowed: [], heavy: [], sentence: '', tiers: [] } } as never;
    const setup = new Setup([AT_MODELS, DONE, status({ steps: [step('runtime', 'done'), step('models', 'needs_input')], form: ladder() }), DONE], view);
    await start(setup, [state('openai.signin', 'connected'), state('google.key', 'connected')]);
    await click('Continue');
    await click('Change my starting model');
    expect(document.querySelector('h1')?.textContent).toBe('Which one should boopis start with?');
    const radios = [...document.querySelectorAll<HTMLElement>('[role=radio]')].map((r) => r.textContent?.trim());
    expect(radios).toEqual(['OpenAI', 'Google Gemini']);
    document.querySelectorAll<HTMLElement>('[role=radio]')[1]?.click();
    await click('Use this');
    expect(setup.reopened).toBe(1);
    expect(setup.answers.at(-1)).toEqual({ form_id: 'setup.ladder', cancelled: false, values: { choice: 'gemini' }, secrets: {} });
    expect(document.querySelector('h1')?.textContent).toBe('Your models are set');
  });

  it('offers no change when only one lab is connected, and none for a lab the host sets up no route for', async () => {
    const setup = new Setup([AT_MODELS, DONE], { state: 'set', tiers: [{ name: 'sol', model: 'openai-codex/gpt-6.2-sol' }], governed: { available: true, why: null, allowed: [], heavy: [], sentence: '', tiers: [] } } as never);
    await start(setup, [state('openai.signin', 'connected'), state('deepseek.key', 'connected')]);
    await click('Continue');
    expect(btn('Change my starting model')).toBeUndefined();
  });
});

describe('the optional steps and the end', () => {
  const view = { state: 'set', tiers: [{ name: 'free', model: 'nous/x' }], governed: { available: false, why: null, allowed: [], heavy: [], sentence: '', tiers: [] } } as never;
  const extras: ExtrasSource = { connectors: () => Promise.resolve([{ name: 'GitHub', line: 'Pull requests and issues.' }]), store: () => Promise.resolve([{ name: 'A skill', line: 'Does a thing.' }]) };
  const toExtras = async (exits: FirstRunExit[] = []): Promise<Setup> => {
    const setup = new Setup([AT_MODELS, DONE], view);
    await start(setup, [], extras, exits);
    await click('Do it later');
    await click('Continue');
    return setup;
  };

  it('are short, each skippable: connectors, then the store, then the end', async () => {
    await toExtras();
    expect(document.querySelector('h1')?.textContent).toBe('Connect your tools');
    expect(document.body.textContent).toContain('Pull requests and issues.');
    expect(document.querySelector('.fr-progress__text')?.textContent).toBe('Step 3 of 4');
    await click('Skip');
    expect(document.querySelector('h1')?.textContent).toBe('Look at the store');
    expect(document.body.textContent).toContain('Does a thing.');
    await click('Skip');
    expect(document.querySelector('h1')?.textContent).toBe('You are set');
    expect(document.querySelector('.fr-progress__text')?.textContent).toBe('All steps done');
  });

  it('can open the connectors after the app starts: the first-run view does not open a screen that is not there yet', async () => {
    const exits: FirstRunExit[] = [];
    await toExtras(exits);
    await click('Open Connectors');
    expect(document.querySelector('h1')?.textContent).toBe('You are set');
    await click('Open boopis');
    expect(exits).toEqual([{ open: 'connectors' }]);
    expect(document.querySelector('.hx-first-run')).toBeNull();
  });

  it('shows no list when the host cannot read one, and still lets the person skip', async () => {
    const setup = new Setup([AT_MODELS, DONE], view);
    await start(setup, [], { connectors: () => Promise.reject(new Error('offline')), store: () => Promise.resolve([]) });
    await click('Do it later');
    await click('Continue');
    expect(document.querySelector('h1')?.textContent).toBe('Connect your tools');
    expect(document.querySelector('[aria-label="Some connectors"]')).toBeNull();
    await click('Skip');
    expect(document.querySelector('[aria-label="Recommended in the store"]')).toBeNull();
  });
});
