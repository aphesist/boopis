/* Hermes's string prompts (`secret`, `sudo`, `vault.*`) on the live provider: a server request of the gateway becomes a
   credential form in the conversation and in the dock, is answered by the response frame with the request's own id, closes
   when the gateway withdraws it, and leaves no copy of what was typed anywhere the app can read. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationEvent, FormWait } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { setLogLevel, setLogSink } from '../../core/log';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { FakeHost } from '../testing';
import { ReplaySecrets } from '../replay';

const SID = 'local-req';
const SECRET = 'ghp_unit_test_0123456789';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
let host: FakeHost;
let provider: LiveProvider;
let secrets: ReplaySecrets;
let conv: ConversationEvent[];
let logged: string[];
let resumeOpen: unknown[] | null;

const request = (id: string, method: string, params: Record<string, unknown>): void => { host.emit({ jsonrpc: '2.0', id, method, params: { session_id: SID, ...params } }); };
const forms = (): FormWait[] => provider.waits.snapshot().filter((w): w is FormWait => w.kind === 'form');
/** every frame the UI sent that answers a server request (a response, not a call) */
const responses = (): Record<string, unknown>[] => host.sent.map((s) => s.frame).filter((f) => f['method'] === undefined && typeof f['id'] === 'string');
/** everything the UI sent besides the answer: no frame of any other kind may hold a secret */
const calls = (): Record<string, unknown>[] => host.sent.map((s) => s.frame).filter((f) => f['method'] !== undefined);

async function open(): Promise<void> {
  host = new FakeHost();
  secrets = new ReplaySecrets();
  resumeOpen = null;
  host.autoReply = (f) => {
    const id = f['id'];
    switch (f['method']) {
      case 'session.list': host.result(id, { sessions: (f['params'] as { include_hidden?: boolean }).include_hidden ? [] : [{ id: SID, title: 't', preview: 'p', started_at: 1 }] }); break;
      case 'session.resume': host.result(id, { session_id: SID, message_count: 0, messages: [], info: { model: 'sonnet 5.5' }, ...(resumeOpen ? { open_requests: resumeOpen } : {}) }); break;
      case 'prompt.submit': host.result(id, { status: 'streaming', admission_id: 'a' }); break;
      case undefined: break;
      default: host.error(id, -32601, 'unexpected ' + String(f['method']), { reason: 'unknown_method' });
    }
  };
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ client, mock: createMockProvider({ simulate: false }), secrets, pickFolder: null });
  await provider.ready;
  conv = [];
  provider.sessions.conversation(SID).subscribe((e) => conv.push(e));
  provider.sessions.send(SID, 'go', { governed: false, smart: false, model: '', assume: [] });
  await tick(); await tick();
  host.event('message.start', SID, {}, 1);
}

beforeEach(async () => {
  logged = [];
  setLogLevel('debug');
  setLogSink((level, scope, message, data) => { logged.push([level, scope, message, JSON.stringify(data ?? null)].join(' ')); });
  await open();
});
afterEach(() => { setLogLevel('info'); });

describe('a request arrives', () => {
  it('becomes a credential form from Hermes, in the conversation and in the dock', () => {
    request('srq-a1', 'secret', { env_var: 'GITHUB_TOKEN', prompt: 'Enter value for GITHUB_TOKEN', metadata: { skill_name: 'github' } });
    expect(forms()).toHaveLength(1);
    expect(forms()[0]?.data).toMatchObject({ id: 'srq-a1', kind: 'credential', title: 'Hermes needs GITHUB_TOKEN', origin: { kind: 'hermes' } });
    expect(conv.some((e) => e.type === 'form-opened' && e.form.id === 'srq-a1')).toBe(true);
    const turn = provider.sessions.conversation(SID).snapshot().turns.find((t) => t.role === 'assistant' && t.forms?.length);
    expect(turn && turn.role === 'assistant' ? turn.forms?.map((f) => f.id) : []).toEqual(['srq-a1']);
  });
  it('is not answered until the person does: the agent waits, and nothing is sent', () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    expect(responses()).toEqual([]);
  });
  it('is one form for each request, and a repeat of the same id is not a second one', () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    request('srq-a2', 'vault.code', { site: 'GitHub' });
    expect(forms().map((w) => w.id)).toEqual(['srq-a1', 'srq-a2']);
  });
  it('keeps refusing what it cannot ask: a preview, a tour, a request it does not know', async () => {
    for (const method of ['preview.act', 'tour', 'terminal.read', 'something.new']) request('srq-x-' + method, method, {});
    await tick();
    const refused = responses().filter((f) => 'error' in f);
    expect(refused).toHaveLength(4);
    expect(refused.every((f) => (f['error'] as { code: number }).code === -32601)).toBe(true);
    expect(forms()).toHaveLength(0);
  });
  it('refuses a string prompt that names no session, since it could not be placed', async () => {
    host.emit({ jsonrpc: '2.0', id: 'srq-n', method: 'sudo', params: { command: 'sudo ls' } });
    await tick();
    expect(responses()).toEqual([expect.objectContaining({ id: 'srq-n', error: expect.objectContaining({ code: -32602 }) })]);
    expect(forms()).toHaveLength(0);
  });
});

describe('answering', () => {
  it('a secret goes in the response frame with the request id, and in no other frame', async () => {
    request('srq-a1', 'secret', { env_var: 'GITHUB_TOKEN', prompt: 'p' });
    await provider.forms.submit('srq-a1', { values: {}, secrets: { value: SECRET } });
    expect(responses()).toEqual([{ jsonrpc: '2.0', id: 'srq-a1', result: { value: SECRET } }]);
    expect(JSON.stringify(calls())).not.toContain(SECRET);
    expect(secrets.stored.size).toBe(0);
    expect(forms()).toHaveLength(0);
    expect(conv.some((e) => e.type === 'form-resolved' && e.formId === 'srq-a1' && e.status === 'submitted')).toBe(true);
  });
  it('a sudo password and a master password go the same way', async () => {
    request('srq-s', 'sudo', { command: 'sudo apt-get update' });
    request('srq-u', 'vault.unlock_prompt', { backend: 'bitwarden', display_name: 'Bitwarden' });
    await provider.forms.submit('srq-s', { values: {}, secrets: { password: SECRET } });
    await provider.forms.submit('srq-u', { values: {}, secrets: { password: SECRET + '-2' } });
    expect(responses()).toEqual([
      { jsonrpc: '2.0', id: 'srq-s', result: { value: SECRET } },
      { jsonrpc: '2.0', id: 'srq-u', result: { value: SECRET + '-2' } }
    ]);
    expect(secrets.stored.size).toBe(0);
  });
  it('a login is the pair as one JSON string; a code has no spaces', async () => {
    request('srq-l', 'vault.save_login', { origin: 'https://github.com', site: 'GitHub' });
    request('srq-c', 'vault.code', { site: 'GitHub', hint: null });
    await provider.forms.submit('srq-l', { values: { identifier: ' me@example.com ' }, secrets: { password: SECRET } });
    await provider.forms.submit('srq-c', { values: {}, secrets: { code: '123 456' } });
    const [login, code] = responses().map((f) => (f['result'] as { value: string }).value);
    expect(JSON.parse(login ?? '')).toEqual({ identifier: 'me@example.com', password: SECRET });
    expect(code).toBe('123456');
  });
  it('a skip is an empty value, which is how Hermes is told, and the form is cancelled everywhere', async () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    await provider.forms.cancel('srq-a1');
    expect(responses()).toEqual([{ jsonrpc: '2.0', id: 'srq-a1', result: { value: '' } }]);
    expect(forms()).toHaveLength(0);
    expect(conv.some((e) => e.type === 'form-resolved' && e.formId === 'srq-a1' && e.status === 'cancelled')).toBe(true);
  });
  it('an answer that did not reach Hermes leaves the form open, with words that never echo what was typed', async () => {
    request('srq-a1', 'secret', { env_var: 'X', prompt: 'p' });
    const send = host.send.bind(host);
    host.send = (id, frame) => ((frame as Record<string, unknown>)['method'] === undefined ? Promise.reject(new Error('link down: ' + JSON.stringify(frame))) : send(id, frame));
    await expect(provider.forms.submit('srq-a1', { values: {}, secrets: { value: SECRET } })).rejects.toThrow('The answer was not delivered. Try again.');
    await expect(provider.forms.submit('srq-a1', { values: {}, secrets: { value: SECRET } })).rejects.not.toThrow(SECRET);
    expect(forms()).toHaveLength(1);
    expect(logged.join('\n')).not.toContain(SECRET);
  });
  it('is no longer open once answered: a second answer is refused', async () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    await provider.forms.submit('srq-a1', { values: {}, secrets: { password: SECRET } });
    await expect(provider.forms.submit('srq-a1', { values: {}, secrets: { password: SECRET } })).rejects.toThrow(/no longer open/);
    expect(responses()).toHaveLength(1);
  });
});

describe('the gateway withdraws it (request.cancel)', () => {
  const cancel = (id: string, method: string, reason: string, seq: number): void => { host.event('request.cancel', SID, { id, method, reason }, seq); };
  it('a timeout is expiry: the form closes and says it expired', () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    cancel('srq-a1', 'sudo', 'timeout', 2);
    expect(forms()).toHaveLength(0);
    expect(conv.some((e) => e.type === 'form-resolved' && e.formId === 'srq-a1' && e.status === 'expired')).toBe(true);
    expect(responses()).toEqual([]);   /* it is not answered: Hermes no longer waits */
  });
  it('an interrupt, a closed session and a shutdown cancel it', () => {
    request('srq-a1', 'secret', { env_var: 'A', prompt: 'p' });
    request('srq-a2', 'vault.code', { site: 'x' });
    request('srq-a3', 'sudo', { command: 'c' });
    cancel('srq-a1', 'secret', 'interrupted', 2); cancel('srq-a2', 'vault.code', 'session_closed', 3); cancel('srq-a3', 'sudo', 'shutdown', 4);
    expect(forms()).toHaveLength(0);
    expect(conv.filter((e) => e.type === 'form-resolved').map((e) => (e as { status: string }).status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });
  it('another window answering it settles it here as answered', () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    cancel('srq-a1', 'sudo', 'resolved', 2);
    expect(forms()).toHaveLength(0);
    expect(conv.some((e) => e.type === 'form-resolved' && e.formId === 'srq-a1' && e.status === 'submitted')).toBe(true);
  });
  it('closes only that request, and never a form of another source', () => {
    request('srq-a1', 'sudo', { command: 'c' });
    request('srq-a2', 'secret', { env_var: 'B', prompt: 'p' });
    host.event('clarify.request', SID, { kind: 'clarify', prompt_id: 'c1', execution_generation: 1, question: 'Q?', choices: [] }, 2);
    cancel('srq-a1', 'sudo', 'timeout', 3);
    cancel('c1', 'clarify', 'timeout', 4);   /* a clarify is not this module's to close */
    expect(forms().map((w) => w.id)).toEqual(['srq-a2', 'c1']);
  });
  it('answers nothing for a request that was withdrawn before the person did', async () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    cancel('srq-a1', 'sudo', 'timeout', 2);
    await expect(provider.forms.submit('srq-a1', { values: {}, secrets: { password: SECRET } })).rejects.toThrow(/no longer open/);
    expect(responses()).toEqual([]);
  });
});

describe('a resumed session', () => {
  it('draws again the string prompts it still has open (`open_requests`), and answers them by their own ids', async () => {
    /* a fresh page on the same gateway: nothing is remembered here, and the gateway still waits */
    resumeOpen = [
      { id: 'srq-r1', method: 'sudo', params: { session_id: SID, command: 'sudo ls' } },
      { id: 'srq-r2', method: 'clarify', params: { session_id: SID, questions: [] } },
      { id: 'srq-r3', method: 'vault.code', params: { session_id: SID, site: 'GitHub', hint: null } }
    ];
    const client2 = new GatewayClient(host);
    await client2.connect();
    const gone = createLiveProvider({ client: client2, mock: createMockProvider({ simulate: false }), secrets, pickFolder: null });
    await gone.ready;
    gone.sessions.conversation(SID).subscribe(() => undefined);
    gone.sessions.send(SID, 'again', { governed: false, smart: false, model: '', assume: [] });
    await tick(); await tick();
    const open2 = gone.waits.snapshot().filter((w): w is FormWait => w.kind === 'form');
    expect(open2.map((w) => w.id)).toEqual(['srq-r1', 'srq-r3']);
    await gone.forms.submit('srq-r1', { values: {}, secrets: { password: SECRET } });
    expect(responses()).toEqual([{ jsonrpc: '2.0', id: 'srq-r1', result: { value: SECRET } }]);
  });
});

describe('nothing keeps what was typed', () => {
  it('is in no state the app holds after a submit: not the waits, not the turns, not the log, not another frame', async () => {
    request('srq-a1', 'secret', { env_var: 'GITHUB_TOKEN', prompt: 'p' });
    request('srq-a2', 'vault.save_login', { origin: 'https://github.com', site: 'GitHub' });
    await provider.forms.submit('srq-a1', { values: {}, secrets: { value: SECRET } });
    await provider.forms.submit('srq-a2', { values: { identifier: 'me@example.com' }, secrets: { password: SECRET + '-pw' } });
    const state = JSON.stringify([provider.waits.snapshot(), provider.sessions.conversation(SID).snapshot(), conv]);
    for (const text of [state, logged.join('\n'), JSON.stringify(calls()), JSON.stringify([...secrets.stored])]) {
      expect(text).not.toContain(SECRET);
    }
    /* the answer itself is the only place it went */
    expect(JSON.stringify(responses())).toContain(SECRET);
  });
  it('is in no log when the answer fails or the form is cancelled', async () => {
    request('srq-a1', 'sudo', { command: 'sudo ls' });
    await provider.forms.cancel('srq-a1');
    request('srq-a2', 'secret', { env_var: 'A', prompt: 'p' });
    host.send = () => Promise.reject(new Error('down'));
    await provider.forms.submit('srq-a2', { values: {}, secrets: { value: SECRET } }).catch(() => undefined);
    expect(logged.join('\n')).not.toContain(SECRET);
  });
});
