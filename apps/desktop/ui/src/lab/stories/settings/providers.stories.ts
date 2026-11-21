/* Settings > Models > Providers (ADR-0039): the section drawn on the stage from a fake host, in every state a row, a group and the
   forms in place can be in. The rows, heads, search, filter and buttons are the kit's own; the data are the catalogue's. */
import { fill, frames } from '../../story';
import type { Render, State, Story } from '../../types';
import { LONG_NAME, URLISH } from '../../fixtures';
import { entries } from '../../../data/providers';
import { mountProviders } from '../../../host/providers-view';
import type { ProviderState, ProvidersBridge } from '../../../host/providers-bridge';

type Over = Readonly<Record<string, Partial<ProviderState>>>;
const kindOf = (kind: string): ProviderState['kind'] => kind as ProviderState['kind'];
/** what the host answers when nothing is set up: keys missing, sign-ins out, runtimes never checked */
const baseline = (over: Over = {}, extra: ProviderState[] = []): ProviderState[] => [
  ...entries().flatMap((e) => e.ways.filter((w) => !w.hidden).map((w): ProviderState => ({
    provider: e.id, way: w.id, kind: kindOf(w.kind), code: null, detail: null, plan: null, models_count: null, base_url: null, signin: null, checked_at: null,
    status: w.kind === 'key' ? 'needs_key' : w.kind === 'signin' ? 'signed_out' : w.kind === 'local' ? 'not_found' : 'connected', ...over[w.id]
  }))),
  ...extra
];
const bridge = (list: () => Promise<ProviderState[]>, probe: ProviderState[] = []): ProvidersBridge => ({
  list, probe: () => Promise.resolve(probe),
  setKey: () => Promise.reject(new Error('lab')), remove: () => Promise.reject(new Error('lab')), signOut: () => Promise.reject(new Error('lab')),
  signinStart: () => Promise.reject(new Error('lab')), signinCancel: () => Promise.resolve(), onSigninEnd: () => Promise.resolve(() => undefined),
  testEndpoint: () => Promise.resolve({ outcome: 'listed', models: ['qwen3-coder-30b', 'llama-3.3-70b-instruct'], answered_at: null, status: 200, loopback: true, code: null, detail: null }),
  addEndpoint: () => Promise.reject(new Error('lab'))
});
const found = (way: string, base: string, n: number, detail: string): ProviderState => ({ provider: way.split('.')[0] ?? way, way, kind: 'local', status: 'found_local', code: null, detail, plan: null, models_count: n, base_url: base, signin: null, checked_at: 1 });
const endpoint = (slug: string, status: ProviderState['status'], base: string, detail: string | null = null): ProviderState => ({ provider: 'custom', way: 'custom.' + slug, kind: 'custom', status, code: status === 'error' ? 'hx.provider.unreachable' : null, detail, plan: null, models_count: null, base_url: base, signin: null, checked_at: null });

interface Opts { list?: ProviderState[]; probe?: ProviderState[]; fail?: string; after?: (el: HTMLElement) => void | Promise<void> }
/** the section in a settings sheet's own markup, read from a fake host */
const draw = (o: Opts = {}): Render => async ({ root }) => {
  const el = document.createElement('section');
  el.className = 'ui-set';
  el.setAttribute('aria-labelledby', 'hx-set-providers-h');
  fill(root, el);
  const b = bridge(o.fail ? () => Promise.reject(new Error(o.fail)) : () => Promise.resolve(o.list ?? baseline()), o.probe);
  const view = mountProviders(el, { bridge: b, toast: () => undefined, settle: 0 });
  await view.ready;
  await frames(2);
  if (o.after) { await o.after(el); await frames(3); if (el.querySelector('[data-prov-flow]:not([hidden])')) await new Promise((r) => setTimeout(r, 900)); }
};
const type = (el: HTMLElement, q: string): void => { const i = el.querySelector<HTMLInputElement>('#hx-prov-q'); if (i) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); } };
const pick = (el: HTMLElement, v: string): void => { el.querySelector<HTMLElement>(`.ui-chips [data-value="${v}"]`)?.click(); };
const press = (el: HTMLElement, sel: string): void => { el.querySelector<HTMLElement>(sel)?.click(); };
const W = 520;
const st = (tags: State['tags'], o: Opts, extra: Partial<State> = {}): State => ({ tags, render: draw(o), width: W, ...extra });

const MIXED = baseline({
  'anthropic.signin': { status: 'connected', plan: 'Claude Max' }, 'openai.key': { status: 'connected', models_count: 14 },
  'deepseek.key': { status: 'connected', models_count: 3 }, 'anthropic.key': { status: 'error', code: 'hx.provider.key_rejected', detail: 'Anthropic refused the key.' }
}, [endpoint('lab-server', 'connected', 'http://127.0.0.1:8000/v1')]);
const OLLAMA = found('ollama.local', 'http://127.0.0.1:11434/v1', 3, 'llama3.2:latest, qwen3:8b and 1 more');
const ALL_LOCAL = [OLLAMA, found('lm-studio.local', 'http://127.0.0.1:1234/v1', 1, 'qwen/qwen3-4b'), found('llama-cpp.local', 'http://127.0.0.1:8080/v1', 1, 'Qwen3-8B-Q4.gguf'), found('vllm.local', 'http://127.0.0.1:8000/v1', 2, 'meta/llama, mistral')];
const EVERY = baseline({
  'anthropic.signin': { status: 'error', code: 'hx.provider.not_installed', detail: 'Claude Code is not installed. Install it, then sign in by running `claude auth login`.' },
  'anthropic.key': { status: 'connected', plan: null, models_count: 6 }, 'openai.signin': { status: 'signing_in' }, 'openai.key': { status: 'error', code: 'hx.provider.unreachable', detail: 'OpenAI could not be reached.' },
  'google.key': { status: 'error', code: 'hx.provider.key_rejected', detail: 'Google refused the key.' }, 'xai.signin': { status: 'connected', plan: 'SuperGrok' },
  'ollama.local': { status: 'not_found', checked_at: 1 }, 'vllm.local': { status: 'error', code: 'hx.provider.unreachable', detail: 'Something is listening on 127.0.0.1:8000 but did not answer in time.', checked_at: 1 }
});

const providers: Story = {
  id: 'settings/providers', title: 'Settings: Providers', area: 'settings', kind: 'surface', covers: ['surface:settings-providers'],
  states: {
    typical: st(['typical'], { list: MIXED, probe: [OLLAMA] }),
    'nothing set up': st(['empty'], {}),
    'every state in words': st(['variant', 'error'], { list: EVERY }),
    'found on this computer': st(['variant'], { probe: ALL_LOCAL }),
    'more providers, open': st(['open'], {}, { render: draw({ list: MIXED, after: (el) => { press(el, '#hx-prov-more'); } }) }),
    'search: a lab in the tail': st(['variant'], {}, { render: draw({ after: (el) => { type(el, 'meta'); } }) }),
    'search: no match': st(['empty'], {}, { render: draw({ after: (el) => { type(el, 'no such lab'); } }) }),
    'filter: connected': st(['variant'], {}, { render: draw({ list: MIXED, after: (el) => { pick(el, 'connected'); } }) }),
    'filter: sign in': st(['variant'], {}, { render: draw({ list: MIXED, after: (el) => { pick(el, 'signin'); } }) }),
    'filter: on this computer': st(['variant'], {}, { render: draw({ probe: [OLLAMA], after: (el) => { pick(el, 'local'); } }) }),
    'filter: custom, with endpoints': st(['variant'], {}, { render: draw({ list: baseline({}, [endpoint('lab-server', 'connected', 'http://127.0.0.1:8000/v1'), endpoint('team-gateway', 'error', 'https://llm.example.com/v1', 'Nothing answered at that address.')]), after: (el) => { pick(el, 'custom'); } }) }),
    'could not read': st(['error'], { fail: 'provider_list is not built yet' }),
    'long names and reasons': st(['long'], { list: baseline({ 'openai.key': { status: 'error', code: 'hx.provider.key_rejected', detail: 'OpenAI refused the key: ' + URLISH + ' ' + LONG_NAME } }, [endpoint(LONG_NAME, 'error', URLISH, URLISH)]) }),
    'many endpoints': st(['many'], { list: baseline({}, Array.from({ length: 12 }, (_, i) => endpoint('server-' + String(i + 1), i % 4 === 0 ? 'error' : 'connected', 'http://127.0.0.1:' + String(8000 + i) + '/v1', i % 4 === 0 ? 'Nothing answered at that address.' : null))) }),
    narrow: st(['size'], { list: MIXED, probe: [OLLAMA] }, { width: 340 }),
    'a key row hovered': st(['hover'], { list: MIXED }, { force: [{ sel: '[data-do="key"]', state: 'hover' }] }),
    'a key row focused': st(['focus'], { list: MIXED }, { force: [{ sel: '[data-do="key"]', state: 'focus' }] }),
    'the filter focused': st(['focus'], { list: MIXED }, { force: [{ sel: '.ui-chip[aria-checked="true"]', state: 'focus' }] }),
    'a key form in place': st(['open'], {}, { render: draw({ after: (el) => { press(el, '[data-do="key"][data-way="google.key"]'); } }) }),
    'remove asks first': st(['open'], {}, { render: draw({ list: MIXED, after: (el) => { press(el, '[data-do="remove"][data-way="openai.key"]'); } }) }),
    'the endpoint form, first step': st(['open'], {}, { render: draw({ after: (el) => { press(el, '[data-do="endpoint"]'); } }) }),
    'the endpoint form, models found': st(['success'], {}, { render: draw({ after: async (el) => {
      press(el, '[data-do="endpoint"]');
      const set = (n: string, v: string): void => { const i = el.querySelector<HTMLInputElement>(`[data-name="${n}"]`); if (i) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('name', 'Lab server'); set('base_url', 'http://127.0.0.1:8000/v1');
      press(el, '[data-action="submit"]');
      await new Promise((r) => setTimeout(r, 120));
    } }) })
  }
};
export default providers;
