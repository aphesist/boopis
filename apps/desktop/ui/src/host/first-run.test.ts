// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesText, describeProgress, introText, runFirstRun } from './first-run';
import type { SetupBridge, SetupProgress, SetupStatus, SourceInfo } from './setup-bridge';
import { HostError } from './bridge';
import { choiceFor, stepsFor } from './first-run-ways';
import { way as catalogueWay } from '../data/providers';
import type { EndpointRequest, ProviderState, ProvidersBridge } from './providers-bridge';

const step = (id: string, state: SetupStatus['steps'][number]['state'], detail = '', code: string | null = null) => ({ id, title: id, state, detail, code });
const form = (id: string, kind: string, schema: unknown, extra: Partial<NonNullable<SetupStatus['form']>> = {}): NonNullable<SetupStatus['form']> => ({
  form_id: id, kind, title: 'Title ' + id, body: 'Why', schema, submit: { label: 'Go' }, cancel: { label: 'Skip' }, sensitive: false, origin: 'host', diff: [], ...extra });
const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });

const BUNDLED: SourceInfo = { running: 'bundled', carries_runtime: true };
class Fake implements SetupBridge {
  answers: unknown[] = [];
  listeners = new Set<(p: SetupProgress) => void>();
  /** when set, `advance` waits for it, so a test can send progress while a call is running */
  gate: Promise<void> | null = null;
  stopped = 0;
  constructor(private script: (SetupStatus | Error)[], private needed = true, public src: SourceInfo | null = BUNDLED) {}
  check() { return Promise.resolve({ hermes_installed: true, needed: this.needed, reason: 'x' }); }
  source() { return Promise.resolve(this.src); }
  onProgress(cb: (p: SetupProgress) => void) {
    this.listeners.add(cb);
    return Promise.resolve(() => { this.listeners.delete(cb); this.stopped += 1; });
  }
  emit(p: SetupProgress) { for (const l of [...this.listeners]) l(p); }
  async advance(answer: Parameters<SetupBridge['advance']>[0], reconsider: boolean) {
    this.answers.push({ answer, reconsider });
    if (this.gate) await this.gate;
    const next = this.script.shift();
    if (next instanceof Error) throw next;
    return next ?? status({});
  }
}
const tick = (): Promise<void> => (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : new Promise((r) => setTimeout(r, 0))).then(() => undefined);
const click = async (text: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === text);
  expect(b, 'button ' + text).toBeTruthy();
  b?.click();
  await tick();
};

beforeEach(() => { document.body.replaceChildren(); });

describe('first run', () => {
  it('does nothing when setup is not needed', async () => {
    await runFirstRun(new Fake([], false));
    expect(document.querySelector('.hx-first-run')).toBeNull();
  });

  it('opens with the logo\'s hero, one logo, and keeps that same element while the steps are redrawn', async () => {
    const bridge = new Fake([status({ steps: [step('hermes', 'blocked', 'missing')], install_command: 'x' })]);
    void runFirstRun(bridge);
    await tick();
    const hero = document.querySelector('boopis-logo');
    expect(document.querySelectorAll('boopis-logo')).toHaveLength(1);
    expect(hero?.getAttribute('letters')).toBe('play');
    await click('Set up');
    expect(document.querySelectorAll('boopis-logo')).toHaveLength(1);
    expect(document.querySelector('boopis-logo')).toBe(hero);
  });

  it('asks before it starts, never shows the engine\'s installer when it is missing, and checks again on request', async () => {
    const bridge = new Fake([
      status({ steps: [step('hermes', 'blocked', 'missing')], install_command: 'curl -fsSL https://example.test/install.sh | bash' }),
      status({ steps: [step('hermes', 'blocked', 'missing')], install_command: 'curl -fsSL https://example.test/install.sh | bash' })]);
    void runFirstRun(bridge);
    await tick();
    expect(document.body.textContent).toContain('It asks before it changes any setting');
    expect(bridge.answers).toHaveLength(0);
    await click('Set up');
    expect(document.body.textContent).not.toContain('curl -fsSL https://example.test/install.sh');
    await click('Check again');
    expect(bridge.answers).toEqual([{ answer: null, reconsider: false }, { answer: null, reconsider: false }]);
  });

  it('draws the consent form with the exact diff and sends the answer, then the receipt', async () => {
    vi.useFakeTimers();
    try {
      const consent = form('setup.config', 'setup', { type: 'object', properties: {} }, { diff: [{ key: 'tools.tool_search.enabled', from: null, to: 'off' }] });
      const bridge = new Fake([status({ steps: [step('config', 'needs_input')], form: consent }), status({ steps: [step('config', 'done')], done: true, receipt: { lines: ['Hermes settings: 3 settings changed'] } })]);
      let finished = false;
      void runFirstRun(bridge).then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      const card = document.querySelector('hx-card[data-kind="form"]');
      expect(card, 'the form is drawn by the form card').toBeTruthy();
      expect(card?.querySelector('.cd-diff')?.textContent).toContain('tools.tool_search.enabled');
      expect(card?.querySelector('[data-action="defer"]'), 'setup has nowhere to wait: no "Later"').toBeNull();
      await click('Go');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[1]).toEqual({ answer: { form_id: 'setup.config', cancelled: false, values: {}, secrets: {} }, reconsider: false });
      expect(document.body.textContent).toContain('You are set');
      expect(document.body.textContent).toContain('3 settings changed');
      await click('Open boopis');
      expect(finished).toBe(true);
      expect(document.querySelector('.hx-first-run')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('sends a choice, and a secret only in the secrets part, then clears the field', async () => {
    vi.useFakeTimers();
    try {
      const ladder = form('setup.ladder', 'choice', { type: 'object', required: ['choice'], properties: { choice: { type: 'string', enum: ['anthropic', 'main/fake-a'], enumNames: ['Claude: Opus (needs an Anthropic API key)', 'fake-a on main'] } } });
      const cred = form('setup.credential.main', 'credential', { type: 'object', required: ['value'], properties: { value: { type: 'string', title: 'API key', 'x-secret': true, 'x-secret-ref': 'secret://provider.main/api_key' } } }, { sensitive: true });
      const bridge = new Fake([status({ form: ladder }), status({ form: cred }), status({ done: true })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      /* two steps: how to connect, then which provider; nothing goes to the host until the second is answered */
      const ways = document.querySelectorAll<HTMLElement>('.cd-opt');
      expect([...ways].map((o) => o.textContent?.replace(/\d$/, ''))).toEqual(['Use an API key', 'A model you already set up']);
      ways[1]?.click();
      await click('Continue');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers).toHaveLength(1);
      const labs = document.querySelectorAll<HTMLElement>('.cd-opt');
      expect([...labs].map((o) => o.textContent?.replace(/\d$/, ''))).toEqual(['fake-a on main']);
      await click('Use this');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.ladder', values: { choice: 'main/fake-a' }, secrets: {} } });
      const key = document.querySelector<HTMLInputElement>('input[type=password]');
      expect(key).toBeTruthy();
      key!.value = 'sk-typed-secret';
      key!.dispatchEvent(new Event('input'));
      await click('Go');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[2]).toMatchObject({ answer: { form_id: 'setup.credential.main', values: {}, secrets: { value: 'sk-typed-secret' } } });
      expect(key!.value).toBe('');
      expect(document.body.innerHTML).not.toContain('sk-typed-secret');
    } finally { vi.useRealTimers(); }
  });

  it('offers the free models first and already chosen, so one press of Continue is the whole setup of a model', async () => {
    vi.useFakeTimers();
    try {
      const names = ['Free models (Nous free tier, no account)', 'OpenRouter free models (needs a free OpenRouter key)', 'Claude: haiku, sonnet, opus (needs an Anthropic API key)'];
      const ladder = form('setup.ladder', 'choice', { type: 'object', required: ['choice'], properties: { choice: { type: 'string', title: 'Model', enum: ['free', 'openrouter-free', 'anthropic'], enumNames: names, default: 'free' } } }, { body: 'Free models need no account and no key. Terms: https://portal.nousresearch.com/terms' });
      const bridge = new Fake([status({ form: ladder }), status({ done: true, receipt: { lines: ['Models and keys: Nous free tier (nous/welcome): one model at every tier'] } })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      /* step 1: free is first and already chosen; the host's own words (the free tier's terms) are on the card */
      const ways = [...document.querySelectorAll<HTMLElement>('.cd-opt')];
      expect(ways.map((o) => o.textContent?.replace(/\d$/, ''))).toEqual(['Free models (no account)', 'Use an API key']);
      expect(ways.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      expect(document.body.textContent).toContain('portal.nousresearch.com/terms');
      await click('Continue');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.ladder', values: { choice: 'free' }, secrets: {} } });
      expect(document.body.textContent).toContain('one model at every tier');
    } finally { vi.useRealTimers(); }
  });

  it('asks for the free OpenRouter models with several picks and sends them as a list', async () => {
    vi.useFakeTimers();
    try {
      const ids = ['a/small-3b:free', 'b/mid-27b:free', 'c/big-120b:free'];
      const pick = form('setup.openrouter', 'choice', { type: 'object', required: ['picks'], properties: { picks: { type: 'string', title: 'Free models', 'x-multi': true, enum: ids, enumNames: ids, default: [ids[0], ids[2]] } } });
      const bridge = new Fake([status({ form: pick }), status({ done: true })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      const options = [...document.querySelectorAll<HTMLElement>('.cd-opt')];
      expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true']);
      options[1]?.click();
      await click('Go');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.openrouter', values: { picks: [ids[0], ids[2], ids[1]] } } });   /* in the order picked: the host orders them by size */
    } finally { vi.useRealTimers(); }
  });

  it('says what went wrong inside the card when the host refuses the answer, and the form stays open', async () => {
    vi.useFakeTimers();
    try {
      const ladder = form('setup.other', 'choice', { type: 'object', required: ['choice'], properties: { choice: { type: 'string', enum: ['a', 'b'] } } });
      const bridge = new Fake([status({ form: ladder }), new HostError('hx.setup.state_invalid', 'setup.json is not valid')]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      document.querySelectorAll<HTMLElement>('.cd-opt')[0]?.click();
      await click('Go');
      await vi.advanceTimersByTimeAsync(200);
      expect(document.querySelector('hx-card [role=alert]')?.textContent).toContain('setup.json is not valid');
      expect(document.querySelector('hx-card')?.getAttribute('data-state')).toBe('open');
    } finally { vi.useRealTimers(); }
  });

  it('shows a host error in its plain words, without the code, and offers to try again', async () => {
    const bridge = new Fake([new HostError('hx.setup.state_invalid', 'setup.json is not valid'), status({ done: true })]);
    void runFirstRun(bridge);
    await tick();
    await click('Set up');
    expect(document.querySelector('[role=alert]')?.textContent).toContain('setup.json is not valid');
    expect(document.querySelector('[role=alert]')?.textContent).not.toContain('hx.setup.state_invalid');
    await click('Set up');
    expect(document.body.textContent).toContain('You are set');
  });

  it('offers to review a declined consent', async () => {
    const bridge = new Fake([status({ steps: [step('config', 'declined', 'Not changed.')] }), status({})]);
    void runFirstRun(bridge);
    await tick();
    await click('Set up');
    await click('Review again');
    expect(bridge.answers[1]).toEqual({ answer: null, reconsider: true });
  });
  it('says what the bundled engine is about to do, and never names the engine', async () => {
    const bridge = new Fake([]);
    void runFirstRun(bridge);
    await tick();
    const text = document.querySelector('.hx-first-run')?.textContent ?? '';
    expect(text).toContain('boopis comes with its own engine');
    expect(text).toContain('unpacks it into boopis\'s own folder and sets it up');
    expect(text).toContain('Nothing else on this computer is touched');
    expect(text).not.toMatch(/hermes/i);
    expect(text).not.toContain('Nothing is installed without you');
    expect(text, 'no em dash, no exclamation mark, and the product is lowercase').not.toMatch(/[\u2014!]|Boopis/);
  });

  it('says when it runs on the engine already on this computer, and claims nothing when it cannot tell', () => {
    const own: SourceInfo = { running: 'existing', carries_runtime: true };
    expect(introText(own)).toContain('engine already installed on this computer');
    expect(introText(own)).not.toMatch(/hermes/i);
    expect(introText(own)).not.toContain('unpacks');
    expect(introText({ ...BUNDLED, carries_runtime: false })).toContain('already installed on this computer');
    const unknown = introText(null);
    expect(unknown).toContain('asks before it changes any setting');
    expect(unknown).not.toMatch(/unpacks|already installed on this computer/);
  });

  it('shows the unpack as dots that fill with the archive\'s own bytes, then goes back to the steps', async () => {
    let release: () => void = () => undefined;
    const bridge = new Fake([status({ steps: [step('runtime', 'done', 'unpacked Hermes 0.23.2')], done: true, receipt: { lines: [] } })]);
    bridge.gate = new Promise<void>((r) => { release = r; });
    void runFirstRun(bridge);
    await tick();
    await click('Set up');
    // nothing is known yet: one dot travelling, no percent
    let bar = document.querySelector<HTMLElement>('[role=progressbar]');
    expect(bar?.hasAttribute('data-indeterminate')).toBe(true);
    expect(bar?.hasAttribute('aria-valuenow')).toBe(false);
    expect(document.querySelectorAll('.ui-progress__bar > i[data-on]')).toHaveLength(0);
    bridge.emit({ step: 'runtime', phase: 'verify', read: 50_000_000, total: 200_000_000 });
    bar = document.querySelector<HTMLElement>('[role=progressbar]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('25');
    expect(bar?.getAttribute('aria-label')).toBe('Checking boopis\'s engine');
    expect(bar?.hasAttribute('data-indeterminate')).toBe(false);
    expect(document.querySelector('.ui-progress__pct')?.textContent).toBe('25%');
    expect(document.querySelector('#fr-work-bytes')?.textContent).toBe('50.0 MB of 200 MB');
    // dots in proportion: 25% of 10 rounds to 3
    expect(document.querySelectorAll('.ui-progress__bar > i[data-on]')).toHaveLength(3);
    bridge.emit({ step: 'runtime', phase: 'unpack', read: 100_000_000, total: 200_000_000 });
    expect(document.querySelector('[role=progressbar]')?.getAttribute('aria-label')).toBe('Unpacking boopis\'s engine');
    expect(document.querySelector('#fr-work-label')?.textContent).toBe('Unpacking boopis\'s engine');
    expect(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(document.querySelectorAll('.ui-progress__bar > i[data-on]')).toHaveLength(5);
    expect(document.querySelector('.hx-first-run')?.querySelector('.ui-progress__bar')?.tagName, 'a row of dots, never a bar element').toBe('SPAN');
    expect(document.querySelector('progress, meter')).toBeNull();
    release();
    await tick();
    expect(document.querySelector('[role=progressbar]')).toBeNull();
    expect(document.querySelector('[data-state=done]')?.textContent).toContain('unpacked Hermes 0.23.2');
    expect(bridge.stopped, 'the listener is dropped when the call ends').toBe(1);
    expect(bridge.listeners.size).toBe(0);
  });

  it('never invents a figure: an event with no size keeps the dot travelling', async () => {
    expect(describeProgress({ step: 'runtime', phase: 'unpack', read: null, total: null })).toEqual({ label: 'Unpacking boopis\'s engine', value: null, bytes: '' });
    expect(describeProgress({ step: 'runtime', phase: 'unpack', read: 5, total: 0 }).value).toBeNull();
    expect(describeProgress({ step: 'runtime', phase: 'verify', read: 999, total: 1000 }).value, 'a whole percent, rounded down: never 100 before it is').toBe(99);
    expect(describeProgress({ step: 'runtime', phase: 'verify', read: 2000, total: 1000 }).value).toBe(100);
    expect(bytesText(0)).toBe('0 B');
    expect(bytesText(1500)).toBe('2 kB');
    expect(bytesText(12_340_000)).toBe('12.3 MB');
    expect(bytesText(310_000_000)).toBe('310 MB');
    expect(bytesText(1_240_000_000)).toBe('1.2 GB');
  });

  it('still runs when the host cannot send progress', async () => {
    const bridge = new Fake([status({ done: true, receipt: { lines: [] } })]);
    bridge.onProgress = () => Promise.reject(new Error('no events'));
    void runFirstRun(bridge);
    await tick();
    await click('Set up');
    expect(document.body.textContent).toContain('You are set');
  });

  it('offers Retry on a stopped step, which runs setup again without restarting anything', async () => {
    const stopped = step('runtime', 'blocked', 'the Hermes runtime is missing; reinstall the app', 'hx.setup.runtime_missing');
    const bridge = new Fake([status({ steps: [stopped, step('receipt', 'pending')] }), status({ steps: [step('runtime', 'done', 'unpacked Hermes 0.23.2'), step('hermes', 'done')], done: true, receipt: { lines: ['ok'] } })]);
    void runFirstRun(bridge);
    await tick();
    await click('Set up');
    const retry = document.querySelector<HTMLButtonElement>('[data-retry="runtime"]');
    expect(retry?.textContent).toBe('Retry');
    expect(retry?.getAttribute('aria-label'), 'the name carries the visible text, first').toBe('Retry runtime');
    expect(document.querySelectorAll('[data-retry]'), 'only the stopped step has one').toHaveLength(1);
    await click('Retry');
    expect(bridge.answers).toEqual([{ answer: null, reconsider: false }, { answer: null, reconsider: false }]);
    expect(document.body.textContent).toContain('You are set');
    expect(document.querySelector('[data-retry]')).toBeNull();
  });

  it('gives every kind of stopped step its Retry, and a missing engine keeps its single "Check again"', async () => {
    for (const id of ['runtime', 'hermes', 'plugin', 'hx', 'config', 'models', 'restart']) {
      document.body.replaceChildren();
      const bridge = new Fake([status({ steps: [step(id, 'blocked', 'it stopped')] })]);
      void runFirstRun(bridge);
      await tick();
      await click('Set up');
      expect(document.querySelector(`[data-retry="${id}"]`), id).toBeTruthy();
    }
    document.body.replaceChildren();
    const missing = new Fake([status({ steps: [step('hermes', 'blocked', 'missing')], install_command: 'curl x | bash' })]);
    void runFirstRun(missing);
    await tick();
    await click('Set up');
    expect(document.querySelector('[data-retry]')).toBeNull();
    expect([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Check again')).toHaveLength(1);
  });

  it('shows the Claude Code commands to run, then "Check again" asks the host again with the same form open', async () => {
    vi.useFakeTimers();
    try {
      const empty = { type: 'object', properties: {} };
      const help = form('setup.claude', 'setup', empty, { title: 'Install Claude Code to use your Claude subscription', body: 'Claude Code is not installed.', submit: { label: 'Check again' }, cancel: { label: 'Choose another model' },
        contents: [['1. Install it', '`npm install -g @anthropic-ai/claude-code`'], ['2. Sign in', '`claude auth login`']] });
      const bridge = new Fake([status({ steps: [step('models', 'needs_input')], form: help }), status({ steps: [step('models', 'needs_input')], form: help })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      const card = document.querySelector('hx-card[data-kind="form"]');
      const lines = [...(card?.querySelectorAll('.cd-contents .cd-well__line') ?? [])].map((l) => l.textContent);
      expect(lines).toEqual(['1. Install itnpm install -g @anthropic-ai/claude-code', '2. Sign inclaude auth login']);
      expect(document.body.textContent).not.toContain('Sign in with');
      await click('Check again');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[1]).toEqual({ answer: { form_id: 'setup.claude', cancelled: false, values: {}, secrets: {} }, reconsider: false });
      expect(document.querySelector('hx-card[data-kind="form"] .cd-contents')).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it('shows what installing the plugin is before it does anything: the pinned build, where from, where to', async () => {
    vi.useFakeTimers();
    try {
      const review = form('setup.claude.install', 'connector', { type: 'object', properties: {} }, { title: 'Install the Claude subscription plugin?', submit: { label: 'Install the plugin' }, cancel: { label: 'Choose another model' },
        contents: [['Plugin', 'claude-subscription-directsdk 0.3.5 (official, from Hermes\'s plugin catalog)'], ['Into', '/home/u/.hermes/plugins']], pinned: '6313fad5ddf2c060e7b16782f4860c0d5cdbfcac',
        effect: 'Runs `hermes plugins install claude-subscription-directsdk --no-enable` in this profile, then restarts Hermes once to load it.' });
      const bridge = new Fake([status({ steps: [step('models', 'needs_input')], form: review }), status({ done: true })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      const card = document.querySelector('hx-card[data-kind="form"]');
      expect(card?.textContent).toContain('claude-subscription-directsdk 0.3.5');
      expect(card?.querySelector('.cd-pinned')?.textContent).toContain('6313fad5ddf2c060e7b16782f4860c0d5cdbfcac');
      expect(card?.textContent).toContain('hermes plugins install claude-subscription-directsdk --no-enable');
      expect(bridge.answers, 'showing it answers nothing').toHaveLength(1);
      await click('Install the plugin');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.claude.install', cancelled: false } });
    } finally { vi.useRealTimers(); }
  });

  it('starts at once for "Change models", under its own heading, with no first screen', async () => {
    const bridge = new Fake([status({ steps: [step('models', 'needs_input')] })]);
    void runFirstRun(bridge, document.body, { autostart: true, title: 'Change models' });
    await tick();
    await tick();
    expect(bridge.answers).toEqual([{ answer: null, reconsider: false }]);
    expect(document.querySelector('#fr-title')?.textContent).toBe('Change models');
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Set up')).toBe(false);
  });
});


describe('first run: the models question in two steps (ADR-0039)', () => {
  const IDS = ['free', 'openrouter-free', 'anthropic', 'claude-subscription', 'chatgpt-subscription', 'gemini', 'xai'];
  const NAMES = ['Free models (Nous free tier, no account)', 'OpenRouter free models (needs a free OpenRouter key)', 'Claude: Opus (needs an Anthropic API key)', 'Claude subscription (your Claude Code login)', 'ChatGPT subscription (sign in with your ChatGPT account)', 'Gemini (a free API key from Google AI Studio)', 'xAI: an API key from xAI'];
  const ladder = (): NonNullable<SetupStatus['form']> => form('setup.ladder', 'choice', { type: 'object', required: ['choice'], properties: { choice: { type: 'string', enum: IDS, enumNames: NAMES, default: 'free' } } });
  const names = (): (string | undefined)[] => [...document.querySelectorAll<HTMLElement>('.cd-opt')].map((o) => o.textContent?.replace(/\d$/, ''));
  const pickWay = async (label: string): Promise<void> => {
    const row = [...document.querySelectorAll<HTMLElement>('.cd-opt')].find((o) => o.textContent?.replace(/\d$/, '') === label);
    expect(row, label).toBeTruthy();
    row?.click();
    await click('Continue');
    await vi.advanceTimersByTimeAsync(900);
  };

  it('asks how to connect first: free, then subscriptions, keys; a model on this computer only where the app can look', async () => {
    vi.useFakeTimers();
    try {
      void runFirstRun(new Fake([status({ form: ladder() })]));
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      expect(document.body.textContent).toContain('How do you want to connect?');
      expect(names()).toEqual(['Free models (no account)', 'Sign in to a subscription', 'Use an API key']);
    } finally { vi.useRealTimers(); }
  });

  it('lists the labs for a way in the host\'s own words, and Back returns to the first step without telling the host anything', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new Fake([status({ form: ladder() }), status({ done: true })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      await pickWay('Sign in to a subscription');
      expect(names()).toEqual(['Claude subscription (your Claude Code login)', 'ChatGPT subscription (sign in with your ChatGPT account)']);
      await click('Back');
      await vi.advanceTimersByTimeAsync(900);
      expect(names()[0]).toBe('Free models (no account)');
      expect(bridge.answers).toHaveLength(1);
      await pickWay('Use an API key');
      expect(names()).toEqual(['Claude: Opus (needs an Anthropic API key)', 'Gemini (a free API key from Google AI Studio)', 'OpenRouter free models (needs a free OpenRouter key)', 'xAI: an API key from xAI']);   /* the catalogue's rank order */
      const labs = document.querySelectorAll<HTMLElement>('.cd-opt');
      labs[1]?.click();
      await click('Use this');
      await vi.advanceTimersByTimeAsync(900);
      expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.ladder', cancelled: false, values: { choice: 'gemini' } } });
    } finally { vi.useRealTimers(); }
  });

  it('skips with the host\'s own button, which leaves the question unanswered', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new Fake([status({ form: ladder() }), status({ done: true })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      await click('Skip');
      expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.ladder', cancelled: true } });
    } finally { vi.useRealTimers(); }
  });

  describe('a model on this computer', () => {
    const found = (way: string, extra: Partial<ProviderState> = {}): ProviderState => ({ provider: way.split('.')[0] ?? way, way, kind: 'local', status: 'found_local', code: null, detail: null, plan: null, models_count: 2, base_url: catalogueWay(way)?.way.base_url?.default ?? null, signin: null, checked_at: 1, ...extra });
    const providers = (probe: ProviderState[]): ProvidersBridge & { added: EndpointRequest[]; used: string[]; probes: number } => {
      const b = { added: [] as EndpointRequest[], used: [] as string[], probes: 0,
        probe: () => { b.probes += 1; return Promise.resolve(probe); },
        testEndpoint: () => Promise.resolve({ outcome: 'listed', models: ['llama3.2:latest', 'qwen3:8b'], answered_at: null, status: 200, loopback: true, code: null, detail: null }),
        addEndpoint: (r: EndpointRequest) => { b.added.push(r); return Promise.resolve({} as ProviderState); },
        useLocal: (way: string, model: string | null) => { b.used.push(`${way}:${model ?? ''}`); return Promise.resolve({ detail: 'Using qwen3-coder-30b.' } as ProviderState); } };
      return b as never;
    };
    it('asks the runtimes when chosen, lists what answered, saves it under the catalogue\'s name with its first model, and leaves the ladder question unanswered', async () => {
      vi.useFakeTimers();
      try {
        const p = providers([found('ollama.local'), { ...found('vllm.local'), status: 'not_found' }]);
        const bridge = new Fake([status({ form: ladder() }), status({ done: true })]);
        void runFirstRun(bridge, document.body, { providers: p });
        await vi.advanceTimersByTimeAsync(0);
        await click('Set up');
        expect(p.probes, 'nothing is probed before the choice').toBe(0);
        await pickWay('Use a model on this computer');
        expect(p.probes).toBe(1);
        expect(names()).toEqual(['Ollama on this computer (2 models)']);
        await click('Use this');
        await vi.advanceTimersByTimeAsync(900);
        expect(p.added).toHaveLength(1);
        expect(p.added[0]).toMatchObject({ name: 'ollama', base_url: 'http://127.0.0.1:11434/v1', key: null, use_model: 'llama3.2:latest', discover: true });
        expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.ladder', cancelled: true } });
        expect(document.body.textContent).toContain('Governed mode stays off for models on this computer');
      } finally { vi.useRealTimers(); }
    });
    it('uses LM Studio as the engine\u2019s own provider, with the models the host got from it, not as an endpoint', async () => {
      vi.useFakeTimers();
      try {
        const p = providers([found('lm-studio.local')]);
        const bridge = new Fake([status({ form: ladder() }), status({ done: true })]);
        void runFirstRun(bridge, document.body, { providers: p });
        await vi.advanceTimersByTimeAsync(0);
        await click('Set up');
        await pickWay('Use a model on this computer');
        expect(names()).toEqual(['LM Studio on this computer (2 models)']);
        await click('Use this');
        await vi.advanceTimersByTimeAsync(900);
        expect(p.added, 'no custom-lmstudio endpoint').toHaveLength(0);
        expect(p.used).toEqual(['lm-studio.local:']);
        expect(document.body.textContent).toContain('Using qwen3-coder-30b.');
        expect(document.body.textContent).toContain('Governed mode stays off for models on this computer');
      } finally { vi.useRealTimers(); }
    });
    it('says so when nothing answered, and Check again asks again', async () => {
      vi.useFakeTimers();
      try {
        const p = providers([]);
        void runFirstRun(new Fake([status({ form: ladder() })]), document.body, { providers: p });
        await vi.advanceTimersByTimeAsync(0);
        await click('Set up');
        await pickWay('Use a model on this computer');
        expect(document.querySelector('[data-fr-none]')?.textContent).toContain('Nothing answered on this computer');
        await click('Check again');
        expect(p.probes).toBe(2);
      } finally { vi.useRealTimers(); }
    });
  });
});

describe('first run ways: regrouping the host\'s choices from the catalogue', () => {
  it('maps a way to the host\'s choice by its own id, its slug or engine, or the id used before the catalogue', () => {
    const w = (id: string) => catalogueWay(id)?.way as NonNullable<ReturnType<typeof catalogueWay>>['way'];
    expect(choiceFor(w('google.key'), ['gemini'])).toBe('gemini');
    expect(choiceFor(w('openai.key'), ['openai-key'])).toBe('openai-key');
    expect(choiceFor(w('deepseek.key'), ['deepseek.key'])).toBe('deepseek.key');
    expect(choiceFor(w('deepseek.key'), ['gemini'])).toBeNull();
  });
  it('lists a choice no way claims under "a model you already set up", and offers nothing it has no choice for', () => {
    const s = stepsFor(['free', 'main/fake-a'], ['Free', 'fake-a on main'], false);
    expect(s?.ways.map((x) => x.id)).toEqual(['free', 'configured']);
    expect(s?.labs.signin).toEqual([]);
    expect(stepsFor([], [], true)).toBeNull();
  });
});
