// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
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
const tick = () => new Promise((r) => setTimeout(r, 0));
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
    const consent = form('setup.config', 'setup', { type: 'object', properties: {} }, { diff: [{ key: 'tools.tool_search.enabled', from: null, to: 'off' }] });
    const bridge = new Fake([status({ steps: [step('config', 'needs_input')], form: consent }), status({ steps: [step('config', 'done')], done: true, receipt: { lines: ['Hermes settings: 3 settings changed'] } })]);
    let finished = false;
    void runFirstRun(bridge).then(() => { finished = true; });
    await tick();
    await click('Set up');
    expect(document.querySelector('table[aria-label="The exact changes"]')?.textContent).toContain('tools.tool_search.enabled');
    expect(document.body.textContent).toContain('not set');
    await click('Go'); // a submit button: the form's own submit handler runs
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(bridge.answers[1]).toEqual({ answer: { form_id: 'setup.config', cancelled: false, values: {}, secrets: {} }, reconsider: false });
    expect(document.body.textContent).toContain('You are set');
    expect(document.body.textContent).toContain('3 settings changed');
    await click('Open hypotaxis');
    expect(finished).toBe(true);
    expect(document.querySelector('.hx-first-run')).toBeNull();
  });

  it('sends a choice, and a secret only in the secrets part, then clears the field', async () => {
    const ladder = form('setup.ladder', 'choice', { type: 'object', required: ['choice'], properties: { choice: { type: 'string', enum: ['anthropic', 'main/fake-a'], enumNames: ['Claude', 'fake-a on main'] } } });
    const cred = form('setup.credential.main', 'credential', { type: 'object', required: ['value'], properties: { value: { type: 'string', title: 'API key', 'x-secret': true, 'x-secret-ref': 'secret://provider.main/api_key' } } }, { sensitive: true });
    const bridge = new Fake([status({ form: ladder }), status({ form: cred }), status({ done: true })]);
    void runFirstRun(bridge);
    await tick();
    await click('Set up');
    const radios = document.querySelectorAll<HTMLInputElement>('input[type=radio]');
    expect(radios).toHaveLength(2);
    radios[1]!.checked = true;
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(bridge.answers[1]).toMatchObject({ answer: { form_id: 'setup.ladder', values: { choice: 'main/fake-a' }, secrets: {} } });
    const key = document.querySelector<HTMLInputElement>('input[type=password]');
    expect(key).toBeTruthy();
    key!.value = 'sk-typed-secret';
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(bridge.answers[2]).toMatchObject({ answer: { form_id: 'setup.credential.main', values: {}, secrets: { value: 'sk-typed-secret' } } });
    expect(key!.value).toBe('');
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
