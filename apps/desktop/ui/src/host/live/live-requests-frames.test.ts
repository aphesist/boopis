/* Hermes's string prompts over the frames a real gateway sent (tests/e2e/record_ui_frames.py, the `requests` scenario): a skill
   whose token is missing (`secret`), a `sudo` command that is answered, and one that is withdrawn by an interrupt
   (`request.cancel`). What the person typed in the recording is not in it; the answers here are typed by the tests. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationEvent, FormWait } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { setLogLevel, setLogSink } from '../../core/log';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { ReplayHost, ReplaySecrets } from '../replay';
import { fixtures, resultOf } from '../testing';

const FRAMES = fixtures.requests;
const SID = (resultOf<{ sessions: { id: string; message_count: number }[] }>(FRAMES, 'session.list').sessions.find((s) => s.message_count > 0) as { id: string }).id;
/** the requests of the gateway in the recording, in order: [secret, sudo (withdrawn), sudo (answered)] */
const ASKED = FRAMES.filter((r) => r.dir === 'in' && typeof r.frame['id'] === 'string' && String(r.frame['id']).startsWith('srq-')).map((r) => r.frame as { id: string; method: string; params: Record<string, unknown> });
const TYPED = 'typed-in-the-test-0123456789';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const META = { governed: false, smart: false, model: '', assume: [] as string[] };

let host: ReplayHost;
let provider: LiveProvider;
let secrets: ReplaySecrets;
let conv: ConversationEvent[];
let logged: string[];
const forms = (): FormWait[] => provider.waits.snapshot().filter((w): w is FormWait => w.kind === 'form');
const resolved = (): { formId: string; status: string }[] => conv.filter((e): e is Extract<ConversationEvent, { type: 'form-resolved' }> => e.type === 'form-resolved').map((e) => ({ formId: e.formId, status: e.status }));
async function turn(text: string): Promise<void> { provider.sessions.send(SID, text, META); await tick(); await tick(); await tick(); }

beforeEach(async () => {
  logged = [];
  setLogLevel('debug');
  setLogSink((level, scope, message, data) => { logged.push([level, scope, message, JSON.stringify(data ?? null)].join(' ')); });
  host = new ReplayHost(FRAMES);
  secrets = new ReplaySecrets();
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ client, mock: createMockProvider({ simulate: false }), secrets, pickFolder: null });
  await provider.ready;
  conv = [];
  provider.sessions.conversation(SID).subscribe((e) => conv.push(e));
});

describe('what the real gateway sent', () => {
  it('recorded one secret request and two sudo requests, with the shapes of Hermes\'s contract', () => {
    expect(ASKED.map((a) => a.method)).toEqual(['secret', 'sudo', 'sudo']);
    expect(ASKED[0]?.params).toMatchObject({ session_id: SID, env_var: 'BOOPIS_TEST_TOKEN', prompt: 'Enter the test token', metadata: { skill_name: 'needs-token', required_for: 'the recording' } });
    expect(ASKED[1]?.params).toEqual({ session_id: SID, command: 'sudo true # never' });
  });
});

describe('a skill whose token is missing (secret)', () => {
  it('opens a credential form from Hermes with what the skill said, in the conversation and in the dock', async () => {
    await turn('use the skill');
    const f = forms();
    expect(f).toHaveLength(1);
    expect(f[0]?.data).toMatchObject({ id: ASKED[0]?.id, kind: 'credential', title: 'Hermes needs BOOPIS_TEST_TOKEN', origin: { kind: 'hermes' } });
    expect(f[0]?.data.why).toContain('Enter the test token');
    expect(f[0]?.data.why).toContain('needs-token');
    expect(conv.some((e) => e.type === 'form-opened' && e.form.id === ASKED[0]?.id)).toBe(true);
    expect(host.responses).toEqual([]);   /* the agent waits */
  });
  it('is answered by the response frame of its own id, then Hermes\'s own `request.cancel: resolved` finds it closed, and the turn goes on', async () => {
    await turn('use the skill');
    await provider.forms.submit(ASKED[0]?.id as string, { values: {}, secrets: { value: TYPED } });
    await tick(); await tick();
    expect(host.responses).toEqual([{ id: ASKED[0]?.id, result: { value: TYPED } }]);
    expect(forms()).toHaveLength(0);
    expect(resolved()).toEqual([{ formId: ASKED[0]?.id, status: 'submitted' }]);   /* once: the gateway's own "resolved" does not close it again */
    expect(host.requests.map((r) => r.method).filter((m) => m.startsWith('plugin.boopis.form'))).not.toContain('plugin.boopis.form.submit');
    expect(secrets.stored.size).toBe(0);
  });
});

describe('a sudo request the gateway withdraws (the turn was interrupted)', () => {
  it('closes as cancelled when the recording shows `request.cancel: interrupted`, and nothing is answered', async () => {
    await turn('use the skill');
    await provider.forms.submit(ASKED[0]?.id as string, { values: {}, secrets: { value: TYPED } });
    await tick(); await tick();
    await turn('run sudo');
    expect(forms().map((w) => w.id)).toEqual([ASKED[1]?.id]);
    expect(forms()[0]?.data.why).toBe('It wants to run `sudo true # never` as an administrator.');
    const before = host.responses.length;
    provider.sessions.stop(SID);
    await tick(); await tick();
    expect(host.requests.map((r) => r.method)).toContain('session.interrupt');
    expect(forms()).toHaveLength(0);
    expect(resolved().at(-1)).toEqual({ formId: ASKED[1]?.id, status: 'cancelled' });
    expect(host.responses).toHaveLength(before);
  });
});

describe('a sudo request that is answered', () => {
  it('carries the password in the response frame and in no other frame, state, log or store', async () => {
    await turn('use the skill');
    await provider.forms.submit(ASKED[0]?.id as string, { values: {}, secrets: { value: TYPED + '-token' } });
    await tick(); await tick();
    await turn('run sudo');
    provider.sessions.stop(SID);
    await tick(); await tick();
    await turn('run sudo again');
    expect(forms().map((w) => w.id)).toEqual([ASKED[2]?.id]);
    expect(forms()[0]?.data.why).toBe('It wants to run `sudo true` as an administrator.');
    await provider.forms.submit(ASKED[2]?.id as string, { values: {}, secrets: { password: TYPED } });
    await tick(); await tick();
    expect(host.responses.at(-1)).toEqual({ id: ASKED[2]?.id, result: { value: TYPED } });
    expect(forms()).toHaveLength(0);
    expect(resolved().at(-1)).toEqual({ formId: ASKED[2]?.id, status: 'submitted' });
    const kept = JSON.stringify([provider.waits.snapshot(), provider.sessions.conversation(SID).snapshot(), conv, host.requests, [...secrets.stored], logged]);
    expect(kept).not.toContain(TYPED);
  });
});
