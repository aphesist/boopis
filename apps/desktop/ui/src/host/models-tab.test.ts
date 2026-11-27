// @vitest-environment jsdom
/* Settings > Models against fakes: the plan Hermes reports, the ladder the host read, and "Change models". */
import { kit } from '@boopis/ui';
import type { RowOpts } from '@boopis/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { governedRows, ladderRows, mountModels } from './models-tab';
import { registerSigninCard } from './providers-view';
import type { EndpointRequest, ProviderState, ProvidersBridge } from './providers-bridge';
import { entries } from '../data/providers';
import type { ModelsDeps } from './models-tab';
import { changeModels } from './change-models';
import { planView } from './free-tier';
import type { ModelsView } from './setup-bridge';
import type { SetupBridge } from './setup-bridge';

const NOW = 1_800_000_000_000;
const free = planView({ status: { has_guest: true, enabled: true, available: true, notice_pending: false, model: 'nous/welcome', label: 'Nous · free tier' }, options: null, limit: null }, NOW);
type Claude = ModelsView['claude'] & { version: string | null; plan: string | null };
const CLAUDE: Record<'ready' | 'out' | 'missing' | 'old' | 'metered', Claude> = {
  ready: { state: 'signed_in', version: '2.1.328', plan: 'Claude Max', detail: 'Claude Code 2.1.328 is signed in (Claude Max).', aliases: ['haiku', 'sonnet', 'opus'] },
  out: { state: 'signed_out', version: '2.1.328', plan: null, detail: 'Claude Code 2.1.328 is installed but not signed in. Sign in by running `claude auth login` in a terminal, then choose Check again.', aliases: ['haiku', 'sonnet', 'opus'] },
  missing: { state: 'not_installed', version: null, plan: null, detail: 'Claude Code is not installed. Install it with `npm install -g @anthropic-ai/claude-code`, then sign in by running `claude auth login` in a terminal.', aliases: [] },
  old: { state: 'old_version', version: '2.1.200', plan: null, detail: 'Claude Code 2.1.200 is older than the oldest one that serves a Claude model here (2.1.280). Update it with `claude update`, then choose Check again.', aliases: [] },
  metered: { state: 'metered', version: '2.1.328', plan: null, detail: 'Claude Code 2.1.328 is signed in with an Anthropic API key, which bills API usage instead of your Claude subscription.', aliases: ['haiku', 'sonnet', 'opus'] }
};
const ALLOWED = ['Claude Opus 5.5', 'Claude Fable 5.2', 'GPT-6.1 Terra', 'GPT-6.2 Astra', 'GPT-6.2 Sol', 'Gemini 4 Carbon', 'Gemini 4 Neon', 'Gemini 4 Hydrogen', 'Grok 4.7'];
const HEAVY_NAMES = ['Claude Fable 5.2', 'Gemini 4 Carbon', 'Grok 4.7'];
const GOV_OK: ModelsView['governed'] = { allowed: ALLOWED, heavy: HEAVY_NAMES, sentence: 'Claude Opus 5.5 or later, Claude Fable 5.2 or later, GPT-6.1 Terra or later, GPT-6.2 Astra or later, GPT-6.2 Sol or later, Gemini 4 Carbon or later, Gemini 4 Neon or later, Gemini 4 Hydrogen or later and Grok 4.7 or later', tiers: [], available: true, why: null };
const FABLE_WHY = 'Fable is token-heavy: Ramp\'s benchmark measured $3.79 a task against Opus\'s $1.53, and on a Claude Pro plan it bills usage credits from the first request. So boopis never adds it by itself.';
const GROK_WHY = 'Grok 4.7 is token-heavy: Ramp\'s benchmark measured it at $4.32 a task, with the most tool calls of any model (161 a task). So boopis never adds it by itself.';
const CARBON_WHY = 'Gemini 4 Carbon is the costliest frontier model in Ramp\'s benchmark: $5.19 a task against Neon\'s $4.38 and Hydrogen\'s $3.24, and it solved 72.6% where Neon solved 76.2%. So boopis never adds it by itself.';
const SWITCHES = { fable: ['Climb to Fable', FABLE_WHY], grok: ['Use Grok', GROK_WHY], carbon: ['Use Gemini 4 Carbon', CARBON_WHY] } as const;
const choice = (id: 'fable' | 'grok' | 'carbon', over: Partial<ModelsView['heavy'][number]> = {}): ModelsView['heavy'][number] => ({ id, label: SWITCHES[id][0], reason: SWITCHES[id][1], applies: false, on: false, blocked: null, ...over });
const NO_HEAVY: ModelsView['heavy'] = [choice('fable'), choice('grok'), choice('carbon')];
const SET: ModelsView = { state: 'set', tiers: [{ name: 'small', model: 'openrouter/a-3b:free' }, { name: 'big', model: 'openrouter/b-120b:free' }], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function deps(over: Partial<ModelsDeps> = {}): ModelsDeps & { calls: string[] } {
  const calls: string[] = [];
  return { calls, plan: () => Promise.resolve(free), ladder: () => Promise.resolve(SET), change: () => { calls.push('change'); return Promise.resolve(); }, closeSettings: () => { calls.push('close'); }, toast: (t) => { calls.push('toast:' + t); }, ...over };
}
const card = (rows: RowOpts[]): string => kit.html.card({ rows });
beforeEach(() => { document.body.replaceChildren(); });

describe('Settings > Models', () => {
  it('shows the free plan Hermes reported and the ladder tier by tier, in the settings rows and the ladder list', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps());
    const heads = [...panel.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Plan', 'Governed mode', 'Model ladder', 'Providers', 'Change']);
    expect(panel.textContent).toContain('Free (Nous · free tier)');
    expect(panel.textContent).toContain('nous/welcome');
    const rows = [...panel.querySelectorAll('[data-tier]')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.k7-row__label')?.textContent).toContain('A 3B');
    expect(rows[0]?.querySelector('.k7-row__value')?.textContent).toBe('small');
    expect(rows[1]?.querySelector('.k7-row__value')?.textContent).toBe('big');
    expect(rows[0]?.getAttribute('aria-current'), 'the first tier is where a task starts').toBe('step');
    expect(panel.textContent).toContain('A task moves up only when its gate fails');
    expect(panel.querySelector('[data-kit~="Card"][aria-label="Model ladder"]')).toBeTruthy();
  });

  it('says the ladder is the built-in one when none is saved, and lists no tiers it was not told of', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ ladder: () => Promise.resolve({ state: 'default', tiers: [], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY }) }));
    expect(panel.querySelector('[data-tier]')).toBeNull();
    expect(panel.textContent).toContain('The built-in ladder: Opus');
  });

  it('says a saved ladder it cannot read is not shown, and that Hermes could not be asked when it could not', async () => {
    const odd = document.createElement('div');
    await mountModels(odd, deps({ ladder: () => Promise.resolve({ state: 'unreadable', tiers: [], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY }) }));
    expect(odd.textContent).toContain('The saved ladder can’t be shown');
    expect(odd.querySelector('[data-tier]')).toBeNull();
    const down = document.createElement('div');
    await mountModels(down, deps({ ladder: () => Promise.reject(new Error('hermes is not installed')) }));
    expect(down.textContent).toContain('The ladder can’t be read: hermes is not installed');
    expect(down.querySelector('#hx-models-change'), 'the button is still there: choosing models does not need the read').toBeTruthy();
  });

  it('says the engine is not connected when the plan cannot be read, rather than drawing one', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ plan: () => Promise.resolve(null) }));
    expect(panel.textContent).toContain('Engine not connected.');
    expect(panel.textContent).not.toContain('Free (');
  });

  it('asks both again on refresh, so a changed plan and a changed ladder show', async () => {
    const panel = document.createElement('div');
    let ladder: ModelsView = { state: 'default', tiers: [], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY };
    const m = await mountModels(panel, deps({ ladder: () => Promise.resolve(ladder) }));
    expect(panel.querySelectorAll('[data-tier]')).toHaveLength(0);
    ladder = SET;
    await m.refresh();
    expect(panel.querySelectorAll('[data-tier]')).toHaveLength(2);
    expect(panel.querySelectorAll('.k7-section'), 'redrawn in place, not appended').toHaveLength(5);
  });

  it('"Change models" asks the question again and steps the dialog aside; a refusal is said and the dialog stays', async () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    const d = deps();
    await mountModels(panel, d);
    panel.querySelector<HTMLButtonElement>('#hx-models-change')?.click();
    await tick();
    expect(d.calls).toEqual(['change', 'close']);
    const bad = deps({ change: () => Promise.reject(new Error('setup.json is not valid')) });
    const other = document.createElement('div');
    await mountModels(other, bad);
    other.querySelector<HTMLButtonElement>('#hx-models-change')?.click();
    await tick();
    expect(bad.calls).toEqual(['toast:setup.json is not valid']);
  });

  it('rows are plain text with no markup from a tier name or model', () => {
    const rows = card(ladderRows({ state: 'set', tiers: [{ name: '<b>x</b>', model: 'a"b/c' }], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY }));
    expect(rows).not.toContain('<b>x</b>');
    expect(rows).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('change models', () => {
  const bridge = {} as SetupBridge;
  it('forgets the choice first, then shows the first-run view at once, under its own heading', async () => {
    const order: string[] = [];
    const run = vi.fn((_b: SetupBridge, o: { autostart: boolean; title: string }) => { order.push('run:' + o.title + ':' + String(o.autostart)); return Promise.resolve(); });
    const { done } = await changeModels({ reopen: () => { order.push('reopen'); return Promise.resolve(); }, run, bridge: () => bridge });
    await done;
    expect(order).toEqual(['reopen', 'run:Change models:true']);
    expect(run.mock.calls[0]?.[0]).toBe(bridge);
  });
  it('shows nothing when the host will not forget the choice', async () => {
    const run = vi.fn(() => Promise.resolve());
    await expect(changeModels({ reopen: () => Promise.reject(new Error('refused')), run, bridge: () => bridge })).rejects.toThrow('refused');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Settings > Models: governed mode (ADR-0037)', () => {
  const view = (governed: ModelsView['governed'], over: Partial<ModelsView> = {}): ModelsView => ({ ...SET, claude: CLAUDE.ready, governed, ...over });
  const NO: ModelsView['governed'] = { ...GOV_OK, available: false, why: 'tier \'haiku\' runs claude-subscription-directsdk-experimental/haiku, which is not a frontier model: it is not in a family on that list', tiers: [{ name: 'haiku', model: 'claude-subscription-directsdk-experimental/haiku', frontier: false, heavy: false }, { name: 'opus', model: 'claude-subscription-directsdk-experimental/opus', frontier: true, heavy: false }] };
  const text = (rows: RowOpts[]): string => { const d = document.createElement('div'); d.innerHTML = card(rows); return d.textContent ?? ''; };

  it('lists the models governed mode allows, as the host read them, and says it is available', () => {
    const t = text(governedRows(view(GOV_OK)));
    for (const name of ALLOWED) expect(t).toContain(name);
    expect(t).toContain('or later');
    expect(t).toContain('Available');
    expect(t).not.toContain('Unavailable');
  });
  it('says plainly when it is unavailable, why, and how to get a model, with Change models beside it', async () => {
    const t = text(governedRows(view(NO)));
    expect(t).toContain('Unavailable');
    expect(t).toContain('tier \'haiku\' runs');
    expect(t).toContain('GPT-6.2 Astra');   /* the allowed models are listed above the status, so it says how to get one by name */
    const panel = document.createElement('div');
    const d = deps({ ladder: () => Promise.resolve(view(NO, { tiers: NO.tiers.map((x) => ({ name: x.name, model: x.model })) })) });
    await mountModels(panel, d);
    panel.querySelector<HTMLButtonElement>('#hx-governed-change')?.click();
    await tick();
    expect(d.calls).toContain('change');
  });
  it('marks a saved tier that governed mode will not run', () => {
    const rows = card(ladderRows(view(NO, { tiers: NO.tiers.map((x) => ({ name: x.name, model: x.model })) })));
    expect(rows).toContain('haiku, not used in governed mode');
    expect(rows).not.toContain('opus, not used');
  });
  it('says it could not be read when the host could not be asked', () => {
    expect(text(governedRows({ error: 'no engine' }))).toContain('Not read: no engine');
  });
});

describe('Settings > Models: the heavy models\' switches (ADR-0037)', () => {
  const fableView = (on: boolean, blocked: string | null = null): ModelsView => ({ ...SET, state: 'set', claude: CLAUDE.ready, claude_plugin: true, heavy: [choice('fable', { applies: true, on, blocked }), choice('grok')] });
  const grokView = (on: boolean): ModelsView => ({ ...SET, state: on ? 'set' : 'default', tiers: on ? [{ name: 'grok', model: 'xai/grok-4.7' }] : [], claude: CLAUDE.missing, heavy: [choice('fable'), choice('grok', { applies: true, on })], governed: on ? { ...GOV_OK, tiers: [{ name: 'grok', model: 'xai/grok-4.7', frontier: true, heavy: true }] } : { ...GOV_OK, available: false, why: 'no ladder is saved, and the only frontier model an xAI key reaches is Grok 4.7 or later, a heavy model that governed mode runs only when you turn it on. Turn on Grok below' } });
  const text = (v: ModelsView): string => { const d = document.createElement('div'); d.innerHTML = card(governedRows(v)); return d.textContent ?? ''; };

  it('says plainly why Fable is off by default: usage credits from the first request on a Pro plan, and token-heavy', () => {
    const t = text(fableView(false));
    expect(t).toContain('Climb to Fable');
    expect(t).toContain('bills usage credits from the first request');
    expect(t).toContain('token-heavy');
    expect(t).toContain('never adds it by itself');
  });
  it('lives in the governed section, not the Claude one, and marks the heavy models in the allowed list', () => {
    const d = document.createElement('div');
    d.innerHTML = card(governedRows(fableView(false)));
    expect(d.textContent?.match(/Heavy: only when you turn it on/g)).toHaveLength(3); // Fable, Carbon and Grok
  });
  it('shows Carbon as a switch like the others once the saved ladder is a Gemini one, with its reason, and no separate row about it', () => {
    const v: ModelsView = { ...SET, heavy: [choice('fable'), choice('grok'), choice('carbon', { applies: true })] };
    const t = text(v);
    expect(t).toContain('Use Gemini 4 Carbon');
    expect(t).toContain('72.6%');
    expect(t).toContain('never adds it by itself');
    expect(t).not.toContain('Gemini 4 Carbon on the ladder');
    expect(card(governedRows(v))).toContain('id="hx-heavy-carbon"');
    // off the Gemini ladder there is no switch to show, and Neon never has one
    expect(text(fableView(false))).not.toContain('Use Gemini 4 Carbon');
    expect(text(v)).not.toMatch(/Neon[^.]*switch/);
  });
  it('shows nothing about a heavy model the saved ladder cannot take', () => {
    const t = text({ ...SET, claude: CLAUDE.ready });
    expect(t).not.toContain('Climb to Fable');
    expect(t).not.toContain('Use Grok');
  });
  it('turning Fable on asks the host with its id, then redraws; a refusal is shown', async () => {
    const calls: string[] = [];
    let view = fableView(false);
    const panel = document.createElement('div');
    await mountModels(panel, deps({ ladder: () => Promise.resolve(view), setHeavy: (id, on) => { calls.push(`${id}:${String(on)}`); view = fableView(on); return Promise.resolve(); } }));
    const sw = (): HTMLButtonElement => panel.querySelector<HTMLButtonElement>('#hx-heavy-fable') as HTMLButtonElement;
    const on = (b: HTMLButtonElement | null | undefined): boolean => b?.getAttribute('aria-checked') === 'true';
    expect(on(sw())).toBe(false);
    sw().click();
    await tick(); await tick();
    expect(calls).toEqual(['fable:true']);
    expect(on(sw())).toBe(true);
    sw().click();
    await tick(); await tick();
    expect(calls).toEqual(['fable:true', 'fable:false']);
    expect(on(sw())).toBe(false);

    const d = deps({ ladder: () => Promise.resolve(fableView(false)), setHeavy: () => Promise.reject(new Error('Your Claude Code does not serve Fable yet (it needs 2.1.321).')) });
    const p2 = document.createElement('div');
    await mountModels(p2, d);
    p2.querySelector<HTMLButtonElement>('#hx-heavy-fable')?.click();
    await tick(); await tick();
    expect(d.calls.some((c) => c.includes('2.1.321'))).toBe(true);
  });
  it('is off and cannot be turned on while the host says it cannot (an old Claude Code), with the reason shown', () => {
    const d = document.createElement('div');
    d.innerHTML = card(governedRows(fableView(false, 'Your Claude Code does not serve Fable yet (it needs 2.1.321). Update it with `claude update`.')));
    expect(d.querySelector<HTMLButtonElement>('#hx-heavy-fable')?.disabled).toBe(true);
    expect(d.textContent).toContain('needs 2.1.321');
    // but one that is on can always be turned off
    d.innerHTML = card(governedRows(fableView(true, 'whatever')));
    expect(d.querySelector<HTMLButtonElement>('#hx-heavy-fable')?.disabled).toBe(false);
  });
  it('with an xAI key alone, governed mode is unavailable in words, and the Grok switch is right there', async () => {
    const t = text(grokView(false));
    expect(t).toContain('Unavailable');
    expect(t).toContain('only frontier model an xAI key reaches is Grok 4.7 or later, a heavy model');
    expect(t).toContain('Turn on Grok below');
    expect(t).toContain('Use Grok');
    expect(t).toContain('token-heavy');
    const calls: string[] = [];
    let view = grokView(false);
    const panel = document.createElement('div');
    await mountModels(panel, deps({ ladder: () => Promise.resolve(view), setHeavy: (id, on) => { calls.push(`${id}:${String(on)}`); view = grokView(on); return Promise.resolve(); } }));
    panel.querySelector<HTMLButtonElement>('#hx-heavy-grok')?.click();
    await tick(); await tick();
    expect(calls).toEqual(['grok:true']);
    expect(panel.textContent).toContain('Available');
    expect(panel.querySelector('#hx-heavy-grok')?.getAttribute('aria-checked')).toBe('true');
    expect(panel.textContent).toContain('heavy, your choice');
  });
  it('without a way to ask the host the switches stay off', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ ladder: () => Promise.resolve(fableView(false)) }));
    expect(panel.querySelector<HTMLButtonElement>('#hx-heavy-fable')?.disabled).toBe(true);
  });
});


/* ───────── Providers (ADR-0039) ───────── */
const state = (way: string, status: ProviderState['status'], extra: Partial<ProviderState> = {}): ProviderState => {
  const kind = (way.endsWith('.local') ? 'local' : way.endsWith('.key') || way.includes('.key-') || way.startsWith('opencode.') ? 'key' : way === 'custom.endpoint' || way.startsWith('custom.') ? 'custom' : 'signin') as ProviderState['kind'];
  return { provider: way.split('.')[0] ?? way, way, kind, status, code: null, detail: null, plan: null, models_count: null, base_url: null, signin: null, checked_at: null, install: null, ...extra };
};
/** the host's answer for every way of the catalogue: keys missing, sign-ins out, runtimes not found (never probed) */
const baseline = (): ProviderState[] => entries().flatMap((e) => e.ways.filter((w) => !w.hidden).map((w) => state(w.id, w.kind === 'key' ? 'needs_key' : w.kind === 'signin' ? 'signed_out' : w.kind === 'local' ? 'not_found' : 'connected')))
  .filter((x) => x.way !== 'custom.endpoint');   /* the host leaves the add-one row out and lists the endpoints made */

function fakeProviders(over: Partial<Record<string, unknown>> = {}): ProvidersBridge & { calls: string[]; keys: string[]; added: EndpointRequest[]; list: () => Promise<ProviderState[]> } {
  const calls: string[] = [];
  const keys: string[] = [];
  const added: EndpointRequest[] = [];
  const b = {
    calls, keys, added,
    list: () => { calls.push('list'); return Promise.resolve(baseline()); },
    probe: () => { calls.push('probe'); return Promise.resolve([] as ProviderState[]); },
    setKey: (way: string, key: string) => { calls.push('setKey:' + way); keys.push(key); return Promise.resolve(state(way, 'connected')); },
    remove: (way: string) => { calls.push('remove:' + way); return Promise.resolve(state(way, 'needs_key')); },
    signOut: (way: string) => { calls.push('signOut:' + way); return Promise.resolve(state(way, 'signed_out')); },
    signinStart: () => Promise.reject(new Error('not here')),
    signinCancel: () => Promise.resolve(),
    onSigninEnd: () => Promise.resolve(() => undefined),
    testEndpoint: () => { calls.push('test'); return Promise.resolve({ outcome: 'listed' as const, models: ['llama3.2:latest', 'qwen3:8b'], answered_at: null, status: 200, loopback: true, code: null, detail: null }); },
    addEndpoint: (r: EndpointRequest) => { added.push(r); return Promise.resolve(state('custom.' + r.name, 'connected')); },
    useLocal: (way: string, model: string | null) => { calls.push(`useLocal:${way}:${model ?? ''}`); return Promise.resolve(state(way, 'found_local', { detail: 'Using qwen3-coder-30b.' })); },
    ...over
  };
  return b as never;
}
async function providersPanel(bridge: ProvidersBridge, extra: Partial<ModelsDeps> = {}): Promise<HTMLElement> {
  const panel = document.createElement('div');
  document.body.append(panel);
  await mountModels(panel, deps({ providers: bridge, ...extra }));
  await tick(); await tick();
  return panel;
}
const section = (panel: HTMLElement): HTMLElement => panel.querySelector('[aria-labelledby="hx-set-providers-h"]') as HTMLElement;
const heads = (panel: HTMLElement): string[] => [...section(panel).querySelectorAll('h3')].map((h) => h.textContent ?? '');
const labelOf = (r: Element): string => r.querySelector('.k7-row__label')?.firstChild?.textContent ?? '';
const rowOf = (panel: HTMLElement, label: string): HTMLElement | undefined => [...section(panel).querySelectorAll<HTMLElement>('.k7-row')].find((r) => labelOf(r) === label);
const type = (el: HTMLInputElement, v: string): void => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };

describe('Settings > Models: Providers', () => {
  it('draws one head per lab with one row per way, a status word and one button, from the catalogue and the host\'s states', async () => {
    const panel = await providersPanel(fakeProviders());
    const h = heads(panel);
    expect(h.slice(0, 4)).toEqual(['Providers', 'Anthropic', 'OpenAI', 'Google Gemini']);
    expect(h).toContain('On this computer');
    expect(h).toContain('Your own endpoint');
    const claude = rowOf(panel, 'Claude subscription') as HTMLElement;
    expect(claude.querySelector('[data-status]')?.textContent).toBe('Not signed in');
    const key = rowOf(panel, 'Anthropic API key') as HTMLElement;
    expect(key.querySelector('[data-status]')?.textContent).toBe('No key');
    expect([...key.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Add key']);
    expect(key.querySelector('button')?.getAttribute('aria-label')).toBe('Add key, Anthropic API key');
  });

  it('says every state in words: connected with the plan, a problem with its reason, not installed, a runtime not yet checked', async () => {
    const list = baseline().map((s) => s.way === 'anthropic.signin' ? { ...s, status: 'connected' as const, plan: 'Claude Max' }
      : s.way === 'anthropic.key' ? { ...s, status: 'error' as const, code: 'hx.provider.key_rejected', detail: 'Anthropic refused the key.' }
        : s.way === 'openai.key' ? { ...s, status: 'connected' as const, models_count: 7 } : s);
    const panel = await providersPanel(fakeProviders({ list: () => Promise.resolve(list) }));
    expect(rowOf(panel, 'Claude subscription')?.querySelector('[data-status]')?.textContent).toBe('Connected (Claude Max)');
    const bad = rowOf(panel, 'Anthropic API key') as HTMLElement;
    expect(bad.querySelector('[data-status]')?.textContent).toBe('Key refused');
    expect(bad.textContent).toContain('Anthropic refused the key.');
    expect([...bad.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Change key', 'Remove']);
    expect(rowOf(panel, 'OpenAI API key')?.textContent).toContain('7 models found.');
    expect(rowOf(panel, 'Ollama on this computer')?.querySelector('[data-status]')?.textContent).toBe('Not checked');
  });

  it('never shows a state by colour alone: every status is a non-empty word beside its row', async () => {
    const panel = await providersPanel(fakeProviders());
    const marks = [...section(panel).querySelectorAll('[data-status]')];
    expect(marks.length).toBeGreaterThan(10);
    for (const m of marks) expect(m.textContent?.trim().length, m.getAttribute('data-status') ?? '').toBeGreaterThan(2);
    expect(section(panel).innerHTML).not.toMatch(/style="[^"]*(color|background)/);
  });

  it('collapses the labs under More providers, and search and filters still reach them', async () => {
    const panel = await providersPanel(fakeProviders());
    const more = section(panel).querySelector<HTMLButtonElement>('#hx-prov-more') as HTMLButtonElement;
    expect(more.textContent).toMatch(/^More providers \(\d+\)$/);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    const tail = section(panel).querySelector<HTMLElement>('#hx-prov-tail') as HTMLElement;
    expect(tail.hidden).toBe(true);
    expect(tail.textContent).toContain('Meta (Muse)');
    more.click();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(tail.hidden).toBe(false);
    more.click();
    const q = section(panel).querySelector<HTMLInputElement>('#hx-prov-q') as HTMLInputElement;
    type(q, 'meta');
    expect(heads(panel)).toContain('Meta (Muse)');
    expect(section(panel).querySelector('#hx-prov-more'), 'a search lists everything flat').toBeNull();
    type(q, 'qwen');
    expect(heads(panel), 'a hidden way is found by nothing').not.toContain('Alibaba');
    type(q, 'no such lab');
    expect(section(panel).querySelector('[data-prov-none]')?.textContent).toContain('No provider matches');
    type(q, 'claude');
    expect(heads(panel)).toContain('Anthropic');
  });

  it('filters by how a lab is reached, and Connected lists only what is connected', async () => {
    const list = baseline().map((s) => (s.way === 'deepseek.key' ? { ...s, status: 'connected' as const } : s));
    const panel = await providersPanel(fakeProviders({ list: () => Promise.resolve(list) }));
    const pick = (v: string): void => { (section(panel).querySelector(`[data-prov-bar] [data-value="${v}"]`) as HTMLElement).click(); };
    pick('connected');
    const labels = [...section(panel).querySelectorAll('.k7-row')].map(labelOf);
    expect(labels).toContain('DeepSeek API key');
    expect(labels).not.toContain('Anthropic API key');
    pick('signin');
    expect([...section(panel).querySelectorAll('.k7-row')].map(labelOf)).toContain('Claude subscription');
    expect(section(panel).textContent).not.toContain('Anthropic API key');
    pick('local');
    expect(heads(panel)).toContain('On this computer');
    expect(section(panel).textContent).not.toContain('Claude subscription');
    pick('custom');
    expect(heads(panel)).toContain('Your own endpoint');
    expect(rowOf(panel, 'Your own endpoint')?.querySelector('button')?.textContent ?? [...section(panel).querySelectorAll('button')].map((b) => b.textContent).join()).toContain('Add endpoint');
  });

  it('shows the terms notes as quiet lines under their rows', async () => {
    const panel = await providersPanel(fakeProviders());
    const notes = [...section(panel).querySelectorAll('[data-note]')].map((n) => n.textContent ?? '');
    expect(notes.some((n) => n.includes('Google has no sign-in'))).toBe(true);
    expect(notes.some((n) => n.includes('GLM Coding Plan'))).toBe(true);
    expect(notes.some((n) => n.includes('Kimi Code'))).toBe(true);
  });

  it('asks the runtimes once when drawn and again on Check again, never when typing, filtering or redrawing', async () => {
    const b = fakeProviders();
    const panel = await providersPanel(b);
    expect(b.calls.filter((c) => c === 'probe')).toHaveLength(1);
    type(section(panel).querySelector<HTMLInputElement>('#hx-prov-q') as HTMLInputElement, 'ollama');
    (section(panel).querySelector('[data-prov-bar] [data-value="local"]') as HTMLElement).click();
    expect(b.calls.filter((c) => c === 'probe')).toHaveLength(1);
    (section(panel).querySelector('[data-do="recheck"]') as HTMLElement).click();
    await tick();
    expect(b.calls.filter((c) => c === 'probe')).toHaveLength(2);
  });

  it('puts a runtime that answered under "Found on this computer" with one Use button, once', async () => {
    const found = state('ollama.local', 'found_local', { base_url: 'http://127.0.0.1:11434/v1', models_count: 2, detail: 'llama3.2:latest, qwen3:8b', checked_at: 1 });
    const b = fakeProviders({ probe: () => Promise.resolve([found]) });
    const panel = await providersPanel(b);
    expect(heads(panel)[1]).toBe('Found on this computer');
    const row = rowOf(panel, 'Ollama on this computer') as HTMLElement;
    expect(row.querySelector('[data-status]')?.textContent).toBe('Running on this computer');
    expect(row.textContent).toContain('llama3.2:latest, qwen3:8b');
    expect([...section(panel).querySelectorAll('.k7-row')].filter((x) => labelOf(x) === 'Ollama on this computer')).toHaveLength(1);
    (row.querySelector('[data-do="use"]') as HTMLElement).click();
    await tick(); await tick(); await tick();
    expect(b.added).toHaveLength(1);
    expect(b.added[0]).toMatchObject({ name: 'ollama', base_url: 'http://127.0.0.1:11434/v1', api_mode: 'chat_completions', key: null, use_model: 'llama3.2:latest', discover: true });
  });

  it('uses LM Studio through the engine\u2019s own provider: no endpoint named custom-lmstudio, no model of ours', async () => {
    const found = state('lm-studio.local', 'found_local', { base_url: 'http://127.0.0.1:1234/v1', models_count: 2, detail: 'qwen3-coder-30b, gemma-4-12b', checked_at: 1 });
    const b = fakeProviders({ probe: () => Promise.resolve([found]) });
    const panel = await providersPanel(b);
    const row = rowOf(panel, 'LM Studio on this computer') as HTMLElement;
    expect(row, 'the found LM Studio row').toBeTruthy();
    (row.querySelector('[data-do="use"]') as HTMLElement).click();
    await tick(); await tick(); await tick();
    expect(b.added, 'it is the built-in provider, not an endpoint').toHaveLength(0);
    expect(b.calls.filter((c) => c.startsWith('useLocal'))).toEqual(['useLocal:lm-studio.local:']);
    expect(b.calls, 'the host asks LM Studio itself; nothing is tested from the page').not.toContain('test');
  });

  it('has no Found group when nothing answered', async () => {
    const panel = await providersPanel(fakeProviders());
    expect(heads(panel)).not.toContain('Found on this computer');
  });

  it('says it could not be read when the host cannot list, rather than drawing rows', async () => {
    const panel = await providersPanel(fakeProviders({ list: () => Promise.reject(new Error('provider_list is not built yet')) }));
    expect(section(panel).textContent).toContain('Not read: provider_list is not built yet');
    expect(section(panel).querySelectorAll('.k7-row')).toHaveLength(0);
  });

  it('offers the user\'s own grok program only while the xAI sign-in is not connected', async () => {
    const out = await providersPanel(fakeProviders());
    expect(rowOf(out, 'Your own Grok program')).toBeTruthy();
    const list = baseline().map((s) => (s.way === 'xai.signin' ? { ...s, status: 'connected' as const } : s));
    const inn = await providersPanel(fakeProviders({ list: () => Promise.resolve(list) }));
    expect(rowOf(inn, 'Your own Grok program')).toBeUndefined();
  });

  it('offers Sign in for SuperGrok and Copilot through the shared card, and a registered card replaces one', async () => {
    const panel = await providersPanel(fakeProviders());
    for (const [label, word] of [['SuperGrok subscription', 'Sign in with xAI'], ['GitHub Copilot subscription', 'Sign in with GitHub']] as const) {
      expect(rowOf(panel, label)?.querySelector('[data-do="signin"] .ui-sso__label')?.textContent, label).toBe(word);
    }
    rowOf(panel, 'SuperGrok subscription')?.querySelector<HTMLButtonElement>('[data-do="signin"]')?.click();
    expect(section(panel).querySelector('[data-signin="xai"] [data-act="start"]')?.textContent, 'the shared card, with the lab\u2019s own button').toContain('Sign in with xAI');
    const other = await providersPanel(fakeProviders());
    rowOf(other, 'GitHub Copilot subscription')?.querySelector<HTMLButtonElement>('[data-do="signin"]')?.click();
    expect(section(other).querySelector('[data-signin="github-copilot.signin"] [data-act="start"]')?.textContent).toContain('Sign in with GitHub');
    let mounted = 0;
    registerSigninCard('xai.signin', (host, done) => { mounted += 1; host.append(document.createTextNode('card')); void done; return { destroy: () => undefined }; });
    const again = await providersPanel(fakeProviders());
    const btn = rowOf(again, 'SuperGrok subscription')?.querySelector<HTMLButtonElement>('[data-do="signin"]') as HTMLButtonElement;
    expect(btn.querySelector('.ui-sso__label')?.textContent).toBe('Sign in with xAI');
    btn.click();
    expect(mounted).toBe(1);
    expect(section(again).textContent).toContain('card');
    expect(section(again).querySelector('[data-prov-body]')?.hasAttribute('hidden')).toBe(true);
  });

  it('Add key opens the credential card in place; the key goes to the host command and never into the page\'s text', async () => {
    const b = fakeProviders();
    const panel = await providersPanel(b, { });
    (rowOf(panel, 'Gemini API key')?.querySelector('[data-do="key"]') as HTMLElement).click();
    const card = section(panel).querySelector('[data-prov-flow]') as HTMLElement;
    expect(card.textContent).toContain('aistudio.google.com/apikey');
    const input = card.querySelector<HTMLInputElement>('input[data-secret="key"]') as HTMLInputElement;
    expect(input.type).toBe('password');
    type(input, 'AIza-SECRET-VALUE-123');
    expect(card.textContent).not.toContain('SECRET-VALUE');
    expect(card.innerHTML).not.toContain('SECRET-VALUE');
    (card.querySelector('[data-action="submit"]') as HTMLElement).click();
    await tick(); await tick();
    expect(b.keys).toEqual(['AIza-SECRET-VALUE-123']);
    expect(b.calls).toContain('setKey:google.key');
    expect(section(panel).innerHTML).not.toContain('SECRET-VALUE');
  });

  it('Remove asks first, and removes through the host command', async () => {
    const list = baseline().map((s) => (s.way === 'deepseek.key' ? { ...s, status: 'connected' as const } : s));
    const b = fakeProviders({ list: () => Promise.resolve(list) });
    const panel = await providersPanel(b);
    (rowOf(panel, 'DeepSeek API key')?.querySelector('[data-do="remove"]') as HTMLElement).click();
    expect(section(panel).textContent).toContain('Remove DeepSeek API key?');
    expect(b.calls.some((c) => c.startsWith('remove:'))).toBe(false);
  });
});
