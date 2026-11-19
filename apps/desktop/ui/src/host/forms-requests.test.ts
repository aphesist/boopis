/* Hermes's one-string prompts as forms (docs/FORMS.md section 6): the gateway's server requests `secret`, `sudo`,
   `vault.unlock_prompt`, `vault.save_login` and `vault.code`, and what each is answered with. The payloads are the ones of
   Hermes v0.23.2's contract (`tui_gateway/contracts/server_requests.py`). */
import { describe, expect, it } from 'vitest';
import { answerFor, fromGatewayEvent, fromServerRequest, isRequestMethod, REQUEST_METHODS, replyFor, splitSecrets } from './forms';
import type { FormModel } from './forms';

const SECRET = 'ghp_unit_test_0123456789';
const model = (method: string, params: Record<string, unknown>, id = 'srq-1'): FormModel => fromServerRequest(method, id, { session_id: 'S1', ...params }) as FormModel;
const props = (m: FormModel): Record<string, Record<string, unknown>> => (m.spec.schema.properties ?? {}) as Record<string, Record<string, unknown>>;

describe('which requests are forms', () => {
  it('lists the five string prompts and nothing else', () => {
    expect([...REQUEST_METHODS]).toEqual(['secret', 'sudo', 'vault.unlock_prompt', 'vault.save_login', 'vault.code']);
    for (const m of ['clarify', 'approval', 'preview.act', 'tour', 'theme.pick', 'setup_beat', 'terminal.read', 'window.read']) expect(isRequestMethod(m)).toBe(false);
    expect(fromServerRequest('clarify', 'srq-1', { session_id: 'S1' })).toBeNull();
  });
  it('needs the request id and the session it belongs to, since nothing could answer it otherwise', () => {
    expect(fromServerRequest('sudo', '', { session_id: 'S1' })).toBeNull();
    expect(fromServerRequest('sudo', 'srq-1', {})).toBeNull();
    expect(fromServerRequest('sudo', 'srq-1', { session_id: '' })).toBeNull();
  });
});

describe('secret (a skill needs an environment variable)', () => {
  const m = model('secret', { env_var: 'GITHUB_TOKEN', prompt: 'Enter value for GITHUB_TOKEN', metadata: { skill_name: 'github', help: 'Create one at github.com/settings/tokens', required_for: 'opening pull requests' } });

  it('is a credential form with one masked field, from Hermes, and the request id is the form id', () => {
    expect(m).toMatchObject({ id: 'srq-1', kind: 'credential', title: 'boopis needs GITHUB_TOKEN', sensitive: true, hold: false, origin: 'hermes' });
    expect(m.spec).toMatchObject({ id: 'srq-1', kind: 'credential', origin: { kind: 'hermes' }, submit: { label: 'Send it' }, cancel: { label: 'Skip' } });
    expect(props(m)['value']).toMatchObject({ type: 'string', title: 'GITHUB_TOKEN', 'x-secret': true });
    expect(m.spec.schema.required).toEqual(['value']);
    expect(m.source).toEqual({ kind: 'hermes-request', sessionId: 'S1', requestId: 'srq-1', method: 'secret' });
  });
  it('says what Hermes said, what the skill declared, and where the value goes', () => {
    expect(m.spec.why).toBe('Enter value for GITHUB_TOKEN. It is for the `github` skill. Needed for opening pull requests. Create one at github.com/settings/tokens.');
    expect(m.spec.effect).toMatch(/saves it in this bot.s own `\.env`/);
    expect(m.spec.effect).toMatch(/model never sees it/);
    expect(m.spec.receipt).toBe('Sent');
  });
  it('draws no deadline and no hold: Hermes gave none, and a typed secret is not an approval', () => {
    expect(m.spec.expiresAt).toBeUndefined();
    expect(m.spec.submit?.hold).toBeUndefined();
  });
  it('falls back to words of its own when the event carries almost nothing', () => {
    const bare = model('secret', {});
    expect(bare.title).toBe('boopis needs a credential');
    expect(bare.spec.why).toBe('boopis needs a value to continue.');
  });
  it('is answered with the value, skipped with an empty one', () => {
    expect(answerFor(m, { cancelled: false, values: {}, secrets: { value: SECRET } })).toEqual({ value: SECRET });
    expect(answerFor(m, { cancelled: true })).toEqual({ value: '' });
  });
});

describe('sudo', () => {
  it('is a credential form with the password field and the command it is for', () => {
    const m = model('sudo', { command: 'sudo apt-get install -y graphviz' });
    expect(m).toMatchObject({ kind: 'credential', title: 'boopis needs your sudo password', origin: 'hermes' });
    expect(m.spec.why).toBe('It wants to run `sudo apt-get install -y graphviz` as an administrator.');
    expect(props(m)['password']).toMatchObject({ 'x-secret': true, title: 'sudo password' });
    expect(m.spec.cancel).toEqual({ label: 'Cancel' });
    expect(answerFor(m, { cancelled: false, values: {}, secrets: { password: SECRET } })).toEqual({ value: SECRET });
    expect(answerFor(m, { cancelled: true })).toEqual({ value: '' });
  });
  /* DESIGN-SYSTEM.md 14.15: hold to approve is for an approval and nowhere else; a password is typed on purpose, so the submit is an ordinary button */
  it('is not held: hold to approve belongs to approvals, and the command is shown so the person can check it', () => {
    const m = model('sudo', { command: 'sudo rm /tmp/x' });
    expect(m.hold).toBe(false);
    expect(m.spec.submit).toEqual({ label: 'Send it' });
  });
  it('says so when Hermes did not name the command, and shows a command with a backtick whole', () => {
    expect(model('sudo', {}).spec.why).toMatch(/did not say which command/);
    expect(model('sudo', { command: 'sudo echo `id`' }).spec.why).toBe('It wants to run sudo echo `id` as an administrator.');
  });
});

describe('vault.unlock_prompt', () => {
  const m = model('vault.unlock_prompt', { backend: 'onepassword', display_name: '1Password' });
  it('asks for the master password of the manager Hermes names', () => {
    expect(m).toMatchObject({ kind: 'credential', title: 'Unlock 1Password' });
    expect(m.spec.submit).toEqual({ label: 'Unlock' });
    expect(m.spec.cancel).toEqual({ label: 'Keep locked' });
    expect(props(m)['password']).toMatchObject({ 'x-secret': true, title: 'Master password' });
    expect(answerFor(m, { cancelled: false, values: {}, secrets: { password: SECRET } })).toEqual({ value: SECRET });
    expect(answerFor(m, { cancelled: true })).toEqual({ value: '' });
  });
  it('names the backend when there is no display name', () => {
    expect(model('vault.unlock_prompt', { backend: 'bitwarden' }).title).toBe('Unlock bitwarden');
  });
});

describe('vault.save_login', () => {
  const m = model('vault.save_login', { origin: 'https://github.com', site: 'GitHub' });
  it('asks for the identifier in the clear and the password masked', () => {
    expect(m).toMatchObject({ kind: 'credential', title: 'Save your GitHub login?' });
    expect(m.spec.why).toMatch(/sign-in page at https:\/\/github\.com/);
    expect(props(m)['identifier']).toMatchObject({ title: 'Email or username' });
    expect(props(m)['identifier']?.['x-secret']).toBeUndefined();
    expect(props(m)['password']).toMatchObject({ 'x-secret': true });
    expect(m.spec.schema.required).toEqual(['identifier', 'password']);
    expect(m.spec.cancel).toEqual({ label: 'Don’t save' });
  });
  it('is answered with the pair as one JSON string, the identifier trimmed', () => {
    const r = answerFor(m, { cancelled: false, values: { identifier: '  me@example.com ' }, secrets: { password: SECRET } });
    expect(JSON.parse(r?.value ?? '')).toEqual({ identifier: 'me@example.com', password: SECRET });
    expect(answerFor(m, { cancelled: true })).toEqual({ value: '' });
  });
  it('sends nothing for half a pair', () => {
    expect(answerFor(m, { cancelled: false, values: { identifier: '' }, secrets: { password: SECRET } })).toEqual({ value: '' });
    expect(answerFor(m, { cancelled: false, values: { identifier: 'me' }, secrets: {} })).toEqual({ value: '' });
  });
  it('falls back to the origin for the site name, and has words when it has neither', () => {
    expect(model('vault.save_login', { origin: 'https://x.test' }).title).toBe('Save your https://x.test login?');
    expect(model('vault.save_login', {}).title).toBe('Save your site login?');
  });
});

describe('vault.code', () => {
  const m = model('vault.code', { site: 'GitHub', hint: 'Sent to ***1234' });
  it('asks for the one-time code, masked, with the site and Hermes\'s hint', () => {
    expect(m).toMatchObject({ kind: 'credential', title: 'Verification code for GitHub' });
    expect(m.spec.why).toBe('GitHub is asking for a one-time code (text message, email or an authenticator app). Sent to ***1234.');
    expect(props(m)['code']).toMatchObject({ 'x-secret': true });
    expect(m.spec.cancel).toEqual({ label: 'Skip' });
  });
  it('is answered without the spaces and dashes a code is typed with', () => {
    expect(answerFor(m, { cancelled: false, values: {}, secrets: { code: '123 456' } })).toEqual({ value: '123456' });
    expect(answerFor(m, { cancelled: false, values: {}, secrets: { code: '123-456' } })).toEqual({ value: '123456' });
    expect(answerFor(m, { cancelled: true })).toEqual({ value: '' });
  });
  it('has words when the request names no site', () => {
    expect(model('vault.code', { site: null, hint: null }).title).toBe('Verification code');
  });
});

describe('where a request\'s value can go', () => {
  const m = model('secret', { env_var: 'X' });
  it('is not sent as a method call: a server request is answered by its response frame', () => {
    expect(replyFor(m, { cancelled: false, values: {}, provided: ['value'] })).toBeNull();
    expect(replyFor(m, { cancelled: true })).toBeNull();
  });
  it('is not for the keychain: the field names no place to store it, so splitting it off for the host would refuse', () => {
    expect(() => splitSecrets(m, { value: SECRET })).toThrow(/names no place to store it/);
  });
  it('is answered by no other source\'s form', () => {
    const approval = fromGatewayEvent('approval.request', 'S1', { prompt_id: 'p', execution_generation: 1, choices: ['once', 'deny'], command: 'x' }) as FormModel;
    expect(answerFor(approval, { cancelled: false, values: { choice: 'once' }, secrets: {} })).toBeNull();
  });
  it('never puts a value in the form it builds, whatever it was asked with', () => {
    for (const f of [m, model('sudo', { command: 'sudo ls' }), model('vault.code', { site: 'x' })]) {
      const json = JSON.stringify(f);
      expect(json).not.toContain(SECRET);
      expect(f.fields.every((x) => x.default === undefined)).toBe(true);
    }
  });
});

/* MCP elicitation: Hermes v0.23.2 sends the gateway no elicitation event and no schema. A form-mode elicitation is asked through the
   turn's clarify callback, one question per field, as the question text; so it is drawn by the clarify adapter, as a question, and
   nothing in the event names the server. The adapter must not guess a server from the words, which a model can also write. */
describe('an MCP elicitation, as Hermes sends it', () => {
  const asked = { kind: 'clarify', prompt_id: 'c1', execution_generation: 2, question: 'linear asks: Which team?\n\nTeam (one of: Core, Web; required)', choices: ['Core', 'Web'], multi_select: false };
  it('arrives as a clarify question and is drawn as one, from the agent, with no MCP origin', () => {
    const m = fromGatewayEvent('clarify.request', 'S1', asked, 'sonnet 5.5') as FormModel;
    expect(m.kind).toBe('question');
    expect(m.spec.origin).toEqual({ kind: 'agent', model: 'sonnet 5.5' });
    expect(m.spec.origin).not.toMatchObject({ kind: 'mcp' });
    expect(m.spec.title).toBe(asked.question);
  });
});
