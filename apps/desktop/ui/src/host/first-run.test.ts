// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runFirstRun } from './first-run';
import type { SetupBridge, SetupStatus } from './setup-bridge';
import { HostError } from './bridge';

const step = (id: string, state: SetupStatus['steps'][number]['state'], detail = '') => ({ id, title: id, state, detail, code: null });
const form = (id: string, kind: string, schema: unknown, extra: Partial<NonNullable<SetupStatus['form']>> = {}): NonNullable<SetupStatus['form']> => ({
  form_id: id, kind, title: 'Title ' + id, body: 'Why', schema, submit: { label: 'Go' }, cancel: { label: 'Skip' }, sensitive: false, origin: 'host', diff: [], ...extra });
const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });

class Fake implements SetupBridge {
  answers: unknown[] = [];
  constructor(private script: (SetupStatus | Error)[], private needed = true) {}
  check() { return Promise.resolve({ hermes_installed: true, needed: this.needed, reason: 'x' }); }
  advance(answer: Parameters<SetupBridge['advance']>[0], reconsider: boolean) {
    this.answers.push({ answer, reconsider });
    const next = this.script.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? status({}));
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

  it('asks before it starts, shows the install command when Hermes is missing and checks again on request', async () => {
    const bridge = new Fake([
      status({ steps: [step('hermes', 'blocked', 'missing')], install_command: 'curl -fsSL https://example.test/install.sh | bash' }),
      status({ steps: [step('hermes', 'blocked', 'missing')], install_command: 'curl -fsSL https://example.test/install.sh | bash' })]);
    void runFirstRun(bridge);
    await tick();
    expect(document.body.textContent).toContain('asks before it changes any Hermes setting');
    expect(bridge.answers).toHaveLength(0);
    await click('Set up');
    expect(document.body.textContent).toContain('curl -fsSL https://example.test/install.sh');
    expect(document.body.textContent).toContain('never runs it for you');
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
      const ladder = form('setup.ladder', 'choice', { type: 'object', required: ['choice'], properties: { choice: { type: 'string', enum: ['anthropic', 'main/fake-a'], enumNames: ['Claude', 'fake-a on main'] } } });
      const cred = form('setup.credential.main', 'credential', { type: 'object', required: ['value'], properties: { value: { type: 'string', title: 'API key', 'x-secret': true, 'x-secret-ref': 'secret://provider.main/api_key' } } }, { sensitive: true });
      const bridge = new Fake([status({ form: ladder }), status({ form: cred }), status({ done: true })]);
      void runFirstRun(bridge);
      await vi.advanceTimersByTimeAsync(0);
      await click('Set up');
      const options = document.querySelectorAll<HTMLElement>('.cd-opt');
      expect(options).toHaveLength(2);
      options[1]?.click();
      await click('Go');
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
      const options = [...document.querySelectorAll<HTMLElement>('.cd-opt')];
      expect(options.map((o) => o.querySelector('.cd-opt__text')?.textContent)).toEqual(names);
      expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
      expect(document.body.textContent).toContain('portal.nousresearch.com/terms');
      await click('Go');
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
      const ladder = form('setup.ladder', 'choice', { type: 'object', required: ['choice'], properties: { choice: { type: 'string', enum: ['a', 'b'] } } });
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

  it('shows a host error with its code and offers to try again', async () => {
    const bridge = new Fake([new HostError('hx.setup.state_invalid', 'setup.json is not valid'), status({ done: true })]);
    void runFirstRun(bridge);
    await tick();
    await click('Set up');
    expect(document.querySelector('[role=alert]')?.textContent).toContain('hx.setup.state_invalid');
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
});
