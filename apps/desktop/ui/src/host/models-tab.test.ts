// @vitest-environment jsdom
/* Settings > Models against fakes: the plan Hermes reports, the ladder the host read, and "Change models". */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatgptRows, claudeRows, geminiRows, governedRows, ladderRows, mountModels } from './models-tab';
import type { ChatgptBridge, ChatgptSigninEvent } from './chatgpt-signin';
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
beforeEach(() => { document.body.replaceChildren(); });

describe('Settings > Models', () => {
  it('shows the free plan Hermes reported and the ladder tier by tier, in the settings rows and the ladder list', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps());
    const heads = [...panel.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Plan', 'Governed mode', 'Model ladder', 'Claude subscription', 'ChatGPT subscription', 'Gemini', 'Change']);
    expect(panel.textContent).toContain('Free (Nous · free tier)');
    expect(panel.textContent).toContain('nous/welcome');
    const rows = [...panel.querySelectorAll('.ui-ladder--list > li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.ui-ladder__name')?.textContent).toContain('A 3B');
    expect(rows[0]?.querySelector('.ui-ladder__rule')?.textContent).toBe('small');
    expect(rows[1]?.querySelector('.ui-ladder__rule')?.textContent).toBe('big');
    expect(rows[0]?.getAttribute('aria-current'), 'the first tier is where a task starts').toBe('step');
    expect(panel.textContent).toContain('moves to the next only when its gate fails');
    expect(panel.querySelector('[role=img][aria-label^="Model ladder"], ol[aria-label="Model ladder"]')).toBeTruthy();
  });

  it('says the ladder is the built-in one when none is saved, and lists no tiers it was not told of', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ ladder: () => Promise.resolve({ state: 'default', tiers: [], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY }) }));
    expect(panel.querySelector('.ui-ladder--list')).toBeNull();
    expect(panel.textContent).toContain('No ladder is saved here, so boopis uses its built-in Claude ladder');
  });

  it('says a saved ladder it cannot read is not shown, and that Hermes could not be asked when it could not', async () => {
    const odd = document.createElement('div');
    await mountModels(odd, deps({ ladder: () => Promise.resolve({ state: 'unreadable', tiers: [], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY }) }));
    expect(odd.textContent).toContain('does not read as a list of named tiers');
    expect(odd.querySelector('.ui-ladder--list')).toBeNull();
    const down = document.createElement('div');
    await mountModels(down, deps({ ladder: () => Promise.reject(new Error('hermes is not installed')) }));
    expect(down.textContent).toContain('The ladder could not be read, so it is not shown: hermes is not installed');
    expect(down.querySelector('#hx-models-change'), 'the button is still there: choosing models does not need the read').toBeTruthy();
  });

  it('says the engine is not connected when the plan cannot be read, rather than drawing one', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ plan: () => Promise.resolve(null) }));
    expect(panel.textContent).toContain('boopis\'s engine is not connected, so the plan cannot be read.');
    expect(panel.textContent).not.toContain('Free (');
  });

  it('asks both again on refresh, so a changed plan and a changed ladder show', async () => {
    const panel = document.createElement('div');
    let ladder: ModelsView = { state: 'default', tiers: [], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY };
    const m = await mountModels(panel, deps({ ladder: () => Promise.resolve(ladder) }));
    expect(panel.querySelectorAll('.ui-ladder--list > li')).toHaveLength(0);
    ladder = SET;
    await m.refresh();
    expect(panel.querySelectorAll('.ui-ladder--list > li')).toHaveLength(2);
    expect(panel.querySelectorAll('section'), 'redrawn in place, not appended').toHaveLength(7);
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
    const rows = ladderRows({ state: 'set', tiers: [{ name: '<b>x</b>', model: 'a"b/c' }], claude: CLAUDE.missing, claude_plugin: false, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY }).join('');
    expect(rows).not.toContain('<b>x</b>');
    expect(rows).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('Settings > Models: the Claude subscription', () => {
  const text = (v: ModelsView | { error: string }): string => { const d = document.createElement('div'); d.innerHTML = claudeRows(v).join(''); return d.textContent ?? ''; };
  const view = (claude: Claude, plugin = false): ModelsView => ({ state: 'default', tiers: [], claude, claude_plugin: plugin, chatgpt: null, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY });

  it('says signed in with the plan and the version, and names no engine', () => {
    const t = text(view(CLAUDE.ready, true));
    expect(t).toContain('Signed in (Claude Max)');
    expect(t).toContain('2.1.328');
    expect(t).toContain('boopis never sees your Claude login');
    expect(t).not.toContain('Check again');
    expect(t).not.toContain('Hermes');
    expect(t).not.toContain('Not in this engine');
  });
  it('says when this engine does not include the subscription', () => {
    expect(text(view(CLAUDE.ready, false))).toContain('Not in this engine');
  });
  it('offers Sign in to Claude while signed out or on a metered login, and runs Claude Code\u2019s own login through the host table', async () => {
    const d = document.createElement('div');
    d.innerHTML = claudeRows(view(CLAUDE.out)).join('');
    expect(d.querySelector('#hx-claude-signin')?.textContent).toBe('Sign in to Claude');
    d.innerHTML = claudeRows(view(CLAUDE.metered)).join('');
    expect(d.querySelector('#hx-claude-signin')).toBeTruthy();
    d.innerHTML = claudeRows(view(CLAUDE.missing)).join('');
    expect(d.querySelector('#hx-claude-signin'), 'nothing to sign in to before it is installed').toBeNull();
    const panel = document.createElement('div');
    let claude = CLAUDE.out;
    const asked: string[] = [];
    const t = deps({
      ladder: () => Promise.resolve(view(claude, true)),
      login: (p) => { asked.push(p); claude = CLAUDE.ready; return Promise.resolve({ command_line: 'claude auth login --claudeai', ok: true, code: 0, timed_out: false, output: [] }); }
    });
    await mountModels(panel, t);
    panel.querySelector<HTMLButtonElement>('#hx-claude-signin')?.click();
    await tick(); await tick();
    expect(asked).toEqual(['claude-code']);
    expect(panel.textContent).toContain('Signed in (Claude Max)');
  });
  it('says not installed in its own words, with the commands to run and a way to look again', () => {
    const t = text(view(CLAUDE.missing));
    expect(t).toContain('Not installed');
    expect(t).toContain('npm install -g @anthropic-ai/claude-code');
    expect(t).toContain('claude auth login');
    expect(t).toContain('Not reported');
    expect(t).toContain('Check again');
  });
  it('says signed out, a login that is not the subscription, and an old version, each apart from the others', () => {
    expect(text(view(CLAUDE.out))).toContain('Not signed in');
    expect(text(view(CLAUDE.out))).toContain('2.1.328');
    expect(text(view(CLAUDE.metered))).toContain('Signed in, but not to your subscription');
    expect(text(view(CLAUDE.metered))).toContain('bills API usage');
    expect(text(view(CLAUDE.old))).toContain('Needs an update');
    expect(text(view(CLAUDE.old))).toContain('claude update');
    expect(text(view(CLAUDE.old))).toContain('2.1.200');
  });
  it('says it could not be read when the host could not be asked', () => { expect(text({ error: 'hermes is not installed' })).toContain('Not read: hermes is not installed'); });
  it('is drawn in the tab, from the same read as the ladder, and "Check again" reads again', async () => {
    const panel = document.createElement('div');
    let claude = CLAUDE.out;
    let reads = 0;
    await mountModels(panel, deps({ ladder: () => { reads += 1; return Promise.resolve(view(claude)); } }));
    expect(reads, 'one read for both sections').toBe(1);
    expect(panel.textContent).toContain('Not signed in');
    claude = CLAUDE.ready;
    panel.querySelector<HTMLButtonElement>('#hx-claude-check')?.click();
    await tick();
    expect(reads).toBe(2);
    expect(panel.textContent).toContain('Signed in (Claude Max)');
    expect(panel.querySelector('#hx-claude-check')).toBeNull();
  });
  it('is plain text: nothing from the CLI becomes markup', () => {
    const t = claudeRows(view({ ...CLAUDE.ready, plan: '<img src=x>', version: '"><b>' })).join('');
    expect(t).not.toContain('<img');
    expect(t).toContain('&lt;img src=x&gt;');
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

describe('Settings > Models: ChatGPT and Gemini (ADR-0030)', () => {
  const base: ModelsView = { state: 'default', tiers: [], claude: CLAUDE.ready, claude_plugin: true, chatgpt: { state: 'signed_out', plan: null, code: null }, gemini_key: false, governed: GOV_OK, heavy: NO_HEAVY };
  const text = (rows: string[]): string => { const d = document.createElement('div'); d.innerHTML = rows.join(''); return d.textContent ?? ''; };

  function fakeChatgpt(): ChatgptBridge & { calls: string[]; end: (e: ChatgptSigninEvent) => void } {
    let listener: ((e: ChatgptSigninEvent) => void) | null = null;
    const calls: string[] = [];
    return {
      calls,
      end: (e) => { listener?.(e); },
      status: () => Promise.resolve({ state: 'signed_out', plan: null, code: null }),
      start: () => { calls.push('start'); return Promise.resolve({ verification_url: 'https://auth.openai.com/codex/device', user_code: 'ABCD-1234' }); },
      cancel: () => { calls.push('cancel'); return Promise.resolve(); },
      signOut: () => { calls.push('signout'); return Promise.resolve(); },
      onEnd: (cb) => { listener = cb; return Promise.resolve(() => { listener = null; }); },
      open: (url) => { calls.push('open:' + url); return Promise.resolve(); },
      copy: (t) => { calls.push('copy:' + t); return Promise.resolve(); }
    };
  }

  it('says signed out, signed in with the plan, or not available, and offers Sign in or Sign out', () => {
    expect(text(chatgptRows(base, true))).toContain('Not signed in');
    const d = document.createElement('div');
    d.innerHTML = chatgptRows(base, true).join('');
    expect(d.querySelector('#hx-chatgpt-signin')).toBeTruthy();
    const inView: ModelsView = { ...base, chatgpt: { state: 'signed_in', plan: 'plus', code: null } };
    expect(text(chatgptRows(inView, true))).toContain('Signed in (Plus)');
    d.innerHTML = chatgptRows(inView, true).join('');
    expect(d.querySelector('#hx-chatgpt-signout')).toBeTruthy();
    expect(text(chatgptRows({ ...base, chatgpt: null }, true))).toContain('not available here');
    expect(text(chatgptRows({ error: 'x' }, true))).toContain('Not read: x');
    expect(text(chatgptRows(base, true))).not.toContain('Hermes');
  });

  it('says whether a Gemini key is saved and offers Add key, which asks the models question', async () => {
    expect(text(geminiRows(base))).toContain('No key');
    expect(text(geminiRows(base))).toContain('aistudio.google.com/apikey');
    expect(text(geminiRows({ ...base, gemini_key: true }))).toContain('Saved');
    const panel = document.createElement('div');
    const d = deps({ ladder: () => Promise.resolve(base) });
    await mountModels(panel, d);
    panel.querySelector<HTMLButtonElement>('#hx-gemini-add')?.click();
    await tick();
    expect(d.calls).toEqual(['change', 'close']);
  });

  it('Sign in draws the sign-in card in place, and the tab reads again once it is signed in', async () => {
    const panel = document.createElement('div');
    let current: ModelsView = base;
    const bridge = fakeChatgpt();
    await mountModels(panel, deps({ ladder: () => Promise.resolve(current), chatgpt: bridge }));
    panel.querySelector<HTMLButtonElement>('#hx-chatgpt-signin')?.click();
    await tick();
    panel.querySelector<HTMLButtonElement>('[data-signin="chatgpt"] [data-act="start"]')?.click();
    await tick(); await tick();
    expect(bridge.calls).toEqual(['start']);
    expect(panel.querySelector('[data-code]')?.textContent).toBe('ABCD-1234');
    current = { ...base, chatgpt: { state: 'signed_in', plan: 'pro', code: null } };
    bridge.end({ outcome: 'signed_in', message: '' });
    await tick(); await tick();
    expect(panel.textContent).toContain('Signed in (Pro)');
    panel.querySelector<HTMLButtonElement>('#hx-chatgpt-signout')?.click();
    await tick();
    expect(bridge.calls).toContain('signout');
  });

  it('a sign-in already waiting shows its code when the tab is drawn', async () => {
    const panel = document.createElement('div');
    const bridge = fakeChatgpt();
    bridge.status = () => Promise.resolve({ state: 'signing_in', plan: null, code: { verification_url: 'https://auth.openai.com/codex/device', user_code: 'WXYZ-9' } });
    await mountModels(panel, deps({ ladder: () => Promise.resolve({ ...base, chatgpt: { state: 'signing_in', plan: null, code: null } }), chatgpt: bridge }));
    await tick(); await tick();
    expect(panel.querySelector('[data-code]')?.textContent).toBe('WXYZ-9');
    expect(bridge.calls, 'it asks OpenAI for no new code').toEqual([]);
  });
});

describe('Settings > Models: governed mode (ADR-0037)', () => {
  const view = (governed: ModelsView['governed'], over: Partial<ModelsView> = {}): ModelsView => ({ ...SET, claude: CLAUDE.ready, governed, ...over });
  const NO: ModelsView['governed'] = { ...GOV_OK, available: false, why: 'tier \'haiku\' runs claude-subscription-directsdk-experimental/haiku, which is not a frontier model: it is not in a family on that list', tiers: [{ name: 'haiku', model: 'claude-subscription-directsdk-experimental/haiku', frontier: false, heavy: false }, { name: 'opus', model: 'claude-subscription-directsdk-experimental/opus', frontier: true, heavy: false }] };
  const text = (rows: string[]): string => { const d = document.createElement('div'); d.innerHTML = rows.join(''); return d.textContent ?? ''; };

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
    expect(t).toContain('sign in with your Claude subscription');
    expect(t).toContain('GPT-6.2 Astra');
    const panel = document.createElement('div');
    const d = deps({ ladder: () => Promise.resolve(view(NO, { tiers: NO.tiers.map((x) => ({ name: x.name, model: x.model })) })) });
    await mountModels(panel, d);
    panel.querySelector<HTMLButtonElement>('#hx-governed-change')?.click();
    await tick();
    expect(d.calls).toContain('change');
  });
  it('marks a saved tier that governed mode will not run', () => {
    const rows = ladderRows(view(NO, { tiers: NO.tiers.map((x) => ({ name: x.name, model: x.model })) })).join('');
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
  const text = (v: ModelsView): string => { const d = document.createElement('div'); d.innerHTML = governedRows(v).join(''); return d.textContent ?? ''; };

  it('says plainly why Fable is off by default: usage credits from the first request on a Pro plan, and token-heavy', () => {
    const t = text(fableView(false));
    expect(t).toContain('Climb to Fable');
    expect(t).toContain('bills usage credits from the first request');
    expect(t).toContain('token-heavy');
    expect(t).toContain('never adds it by itself');
  });
  it('lives in the governed section, not the Claude one, and marks the heavy models in the allowed list', () => {
    expect(claudeRows(fableView(false)).join('')).not.toContain('Climb to Fable');
    const d = document.createElement('div');
    d.innerHTML = governedRows(fableView(false)).join('');
    expect(d.textContent?.match(/Heavy: only when you turn it on/g)).toHaveLength(3); // Fable, Carbon and Grok
  });
  it('shows Carbon as a switch like the others once the saved ladder is a Gemini one, with its reason, and no separate row about it', () => {
    const v: ModelsView = { ...SET, heavy: [choice('fable'), choice('grok'), choice('carbon', { applies: true })] };
    const t = text(v);
    expect(t).toContain('Use Gemini 4 Carbon');
    expect(t).toContain('72.6%');
    expect(t).toContain('never adds it by itself');
    expect(t).not.toContain('Gemini 4 Carbon on the ladder');
    expect(governedRows(v).join('')).toContain('id="hx-heavy-carbon"');
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
    const sw = (): HTMLInputElement => panel.querySelector<HTMLInputElement>('#hx-heavy-fable') as HTMLInputElement;
    expect(sw().checked).toBe(false);
    sw().checked = true; sw().dispatchEvent(new Event('change'));
    await tick(); await tick();
    expect(calls).toEqual(['fable:true']);
    expect(sw().checked).toBe(true);
    sw().checked = false; sw().dispatchEvent(new Event('change'));
    await tick(); await tick();
    expect(calls).toEqual(['fable:true', 'fable:false']);
    expect(sw().checked).toBe(false);

    const d = deps({ ladder: () => Promise.resolve(fableView(false)), setHeavy: () => Promise.reject(new Error('Your Claude Code does not serve Fable yet (it needs 2.1.321).')) });
    const p2 = document.createElement('div');
    await mountModels(p2, d);
    const s2 = p2.querySelector<HTMLInputElement>('#hx-heavy-fable') as HTMLInputElement;
    s2.checked = true; s2.dispatchEvent(new Event('change'));
    await tick(); await tick();
    expect(d.calls.some((c) => c.includes('2.1.321'))).toBe(true);
  });
  it('is off and cannot be turned on while the host says it cannot (an old Claude Code), with the reason shown', () => {
    const d = document.createElement('div');
    d.innerHTML = governedRows(fableView(false, 'Your Claude Code does not serve Fable yet (it needs 2.1.321). Update it with `claude update`.')).join('');
    expect(d.querySelector<HTMLInputElement>('#hx-heavy-fable')?.disabled).toBe(true);
    expect(d.textContent).toContain('needs 2.1.321');
    // but one that is on can always be turned off
    d.innerHTML = governedRows(fableView(true, 'whatever')).join('');
    expect(d.querySelector<HTMLInputElement>('#hx-heavy-fable')?.disabled).toBe(false);
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
    const sw = panel.querySelector<HTMLInputElement>('#hx-heavy-grok') as HTMLInputElement;
    sw.checked = true; sw.dispatchEvent(new Event('change'));
    await tick(); await tick();
    expect(calls).toEqual(['grok:true']);
    expect(panel.textContent).toContain('Available');
    expect(panel.querySelector<HTMLInputElement>('#hx-heavy-grok')?.checked).toBe(true);
    expect(panel.textContent).toContain('heavy: on the ladder because you chose it');
  });
  it('without a way to ask the host the switches stay off', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ ladder: () => Promise.resolve(fableView(false)) }));
    expect(panel.querySelector<HTMLInputElement>('#hx-heavy-fable')?.disabled).toBe(true);
  });
});
