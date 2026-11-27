/* The first run's lab fixtures (boards O-P01 to O-P04): a scripted setup host and a providers host with the boards' content, so the
   real module (modules/onboarding/setup.ts) draws each step as the board draws it. Nothing here reaches a host. */
import { entries } from '../data/providers';
import type { ProviderState, ProvidersBridge } from '../host/providers-bridge';
import type { SetupBridge, SetupProgress, SetupStatus } from '../host/setup-bridge';
import type { ConnectorLogin } from '../host/bindings';
import type { SetupSignins } from '../modules/onboarding/setup';

export const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });
const step = (id: string, title: string, state: SetupStatus['steps'][number]['state'], detail = '') => ({ id, title, state, detail, code: null });
export const CONSENT = {
  form_id: 'setup.config', kind: 'setup', title: 'Change three settings boopis needs?', sensitive: false, origin: 'host', schema: { type: 'object', properties: {} }, submit: { label: 'Apply the changes' }, cancel: { label: 'Not now' },
  body: 'tools.tool_search.enabled = off (so pack, ship and dispatch show directly)\ndelegation.backend = boopis (so governed work can be routed to each model tier)\nplugins.entries.boopis.allow_gateway_injection = true (so a Claude Code Stop hook that blocks can continue the turn)',
  diff: [{ key: 'tools.tool_search.enabled', from: 'auto', to: 'off' }, { key: 'delegation.backend', from: null, to: 'boopis' }, { key: 'plugins.entries.boopis.allow_gateway_injection', from: null, to: true }]
};
const IDS = ['free', 'connected', 'later', 'anthropic', 'claude-subscription', 'chatgpt-subscription', 'openai-key', 'gemini', 'xai', 'xai-subscription'];
export const LADDER = { form_id: 'setup.ladder', kind: 'choice', title: 'Which model should do the work?', body: 'Pick where to start.', schema: { type: 'object', required: ['choice'], properties: { choice: { type: 'string', title: 'Model', enum: IDS, enumNames: IDS, default: 'free' } } }, submit: { label: 'Continue' }, cancel: { label: 'Skip' }, sensitive: false, origin: 'host', diff: [] };
const STEPS = (s: Record<string, SetupStatus['steps'][number]['state']>, detail: Record<string, string> = {}): SetupStatus['steps'] =>
  [['runtime', 'boopis engine'], ['plugin', 'boopis plugin'], ['config', 'Settings boopis needs'], ['models', 'Models and keys']].map(([id = '', t = '']) => step(id, t, s[id] ?? 'pending', detail[id] ?? ''));
export const AT_CONSENT = status({ steps: STEPS({ runtime: 'done', plugin: 'done', config: 'needs_input' }), form: CONSENT as never });
export const AT_MODELS = status({ steps: STEPS({ runtime: 'done', plugin: 'done', config: 'done', models: 'needs_input' }), form: LADDER as never });
export const DONE = status({ steps: STEPS({ runtime: 'done', plugin: 'done', config: 'done', models: 'done' }), done: true, receipt: { lines: [] } });
export const BLOCKED = status({ steps: STEPS({ runtime: 'blocked' }, { runtime: 'The engine could not be unpacked: the disk is full.' }) });
export const DECLINED = status({ steps: STEPS({ runtime: 'done', plugin: 'done', config: 'declined', models: 'done' }, { config: 'Not changed. boopis’s tools may hide behind the engine’s tool search.' }), done: true, receipt: { lines: [] } });

/** a setup host that answers from a script, one status per call; `hang` holds the first call with the unpack 62% through */
export class ScriptedSetup implements SetupBridge {
  private i = 0;
  answers: unknown[] = [];
  private listeners = new Set<(p: SetupProgress) => void>();
  constructor(private script: SetupStatus[], private hang = false) {}
  check() { return Promise.resolve({ hermes_installed: true, needed: true, reason: 'lab' }); }
  source() { return Promise.resolve(null); }
  onProgress(cb: (p: SetupProgress) => void) { this.listeners.add(cb); return Promise.resolve(() => { this.listeners.delete(cb); }); }
  advance(answer: Parameters<SetupBridge['advance']>[0]) {
    this.answers.push(answer);
    if (this.hang) { queueMicrotask(() => { for (const l of this.listeners) l({ step: 'runtime', phase: 'unpack', read: 126_480_000, total: 204_000_000 } as never); }); return new Promise<SetupStatus>(() => undefined); }
    const next = this.script[Math.min(this.i, this.script.length - 1)] as SetupStatus;
    this.i += 1;
    return Promise.resolve(next);
  }
}

/** every catalogue way at rest (keys wanted, sign-ins signed out, runtimes not found), with the board's changes */
export function providerStates(over: Readonly<Record<string, Partial<ProviderState>>> = {}): ProviderState[] {
  return entries().flatMap((e) => e.ways.filter((w) => !w.hidden && w.kind !== 'custom').map((w): ProviderState => ({
    provider: e.id, way: w.id, kind: w.kind as ProviderState['kind'], code: null, detail: null, plan: null, models_count: null, base_url: null, signin: null, checked_at: null, install: null,
    status: w.kind === 'key' ? 'needs_key' : w.kind === 'signin' ? 'signed_out' : 'not_found', ...over[w.id]
  })));
}
/** board O-P03: Claude Code and ChatGPT signed in, Ollama answering with two models */
export const FOUND = { 'anthropic.signin': { status: 'connected' as const }, 'openai.signin': { status: 'connected' as const, plan: 'ChatGPT Plus' } };
export const OLLAMA: Partial<ProviderState> = { status: 'found_local', models_count: 2, base_url: 'http://127.0.0.1:11434/v1' };
export function providersHost(list: ProviderState[], probe: ProviderState[] = []): ProvidersBridge {
  const no = (): Promise<never> => Promise.reject(new Error('lab'));
  return {
    list: () => Promise.resolve(list), probe: () => Promise.resolve(probe), setKey: no, remove: no, signOut: no, signinStart: () => new Promise<never>(() => undefined), signinCancel: () => Promise.resolve(),
    onSigninEnd: () => Promise.resolve(() => undefined), testEndpoint: no, addEndpoint: no, useLocal: no
  };
}
/** sign-ins that wait (the page stays open) or end as `login` says */
export function signinsFor(login: () => Promise<ConnectorLogin> = () => new Promise<never>(() => undefined)): SetupSignins {
  const far = Date.now() + 15 * 60000;
  return {
    chatgpt: { status: () => Promise.resolve({ state: 'signed_out', plan: null, code: null, account: null, notice: null }), start: () => Promise.resolve({ verification_url: 'https://example.com/authorize', user_code: '', expires_at: far }), cancel: () => Promise.resolve(), signOut: () => Promise.resolve({ revoked: true }), onEnd: () => Promise.resolve(() => undefined), open: () => Promise.resolve(), copy: () => Promise.resolve() } as never,
    login, open: () => Promise.resolve()
  };
}
export const NOT_SIGNED_IN: ConnectorLogin = { command_line: 'claude auth login', ok: false, code: 1, timed_out: false, output: [] } as ConnectorLogin;
