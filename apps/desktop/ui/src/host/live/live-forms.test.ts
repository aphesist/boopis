/* Forms on the live provider, over the frames a real gateway and the plugin recorded (tests/e2e/record_ui_frames.py, the
   `forms` scenario): the plugin's `form.opened` and `form.resolved`, the answers, the secret that reaches the keychain and
   nothing else, and Hermes's clarify adapted onto the same model. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationEvent, FormWait, WaitsEvent } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { ReplayHost, ReplaySecrets } from '../replay';
import { eventsOf, fixtures, resultOf } from '../testing';
import type { SecretsBridge } from '../secrets';

const SID = (resultOf<{ sessions: { id: string; message_count: number }[] }>(fixtures.forms, 'session.list').sessions.find((s) => s.message_count > 0) as { id: string }).id;
const OPENED = eventsOf(fixtures.forms, 'plugin.boopis.form.opened').map((e) => e.payload);
const idOf = (kind: string): string => String(OPENED.find((p) => p['kind'] === kind)?.['form_id']);
const NOW = new Date(2026, 10, 19, 1, 0, 0);
const SECRET = 'sk-unit-test-0123456789abcdef';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let host: ReplayHost;
let provider: LiveProvider;
let secrets: ReplaySecrets;
let waits: WaitsEvent[];
let conv: ConversationEvent[];
async function open(over: { secrets?: SecretsBridge } = {}): Promise<void> {
  host = new ReplayHost(fixtures.forms);
  secrets = new ReplaySecrets();
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ defaultFolder: '/work/proj', client, now: () => NOW, mock: createMockProvider({ simulate: false }), secrets: over.secrets ?? secrets, pickFolder: null });
  await provider.ready;
  waits = []; conv = [];
  provider.waits.subscribe((e) => waits.push(e));
  provider.sessions.conversation(SID).subscribe((e) => conv.push(e));
  provider.sessions.send(SID, 'ask me three things', { governed: false, smart: false, model: '', assume: [] });
  await tick(); await tick();
}
const formWaits = (): FormWait[] => provider.waits.snapshot().filter((w): w is FormWait => w.kind === 'form');
const methods = (): string[] => host.requests.map((r) => r.method);

describe('what the plugin raises', () => {
  beforeEach(async () => { await open(); });

  it('makes a wait of kind form for each form.opened, in the order the plugin sent them, with the agent as the origin', () => {
    expect(formWaits().map((w) => w.data.kind)).toEqual(['credential', 'question', 'setup']);
    for (const w of formWaits()) expect(w.data.origin).toEqual({ kind: 'agent', model: 'fake-a' });
    expect(waits.filter((e) => e.type === 'added')).toHaveLength(3);
  });
  it('keeps the whole schema, with its secret reference, the choices and the expiry', () => {
    const [cred, q, setup] = formWaits().map((w) => w.data);
    expect(cred?.schema.properties?.['value']).toMatchObject({ 'x-secret': true, 'x-secret-ref': 'secret://provider.openai/api_key' });
    expect(cred?.submit?.label).toBe('Save');
    expect(q?.schema.properties?.['answer']).toMatchObject({ enum: ['yes', 'no'], 'x-other': true });
    expect(setup?.schema.required).toEqual(['gate']);
    expect(cred?.expiresAt).toBeGreaterThan(0);
    expect(cred?.why).toMatch(/keychain/);
  });
  it('puts each form in the turn that raised it and says so on the conversation feed', () => {
    const opened = conv.filter((e): e is Extract<ConversationEvent, { type: 'form-opened' }> => e.type === 'form-opened');
    expect(opened.map((e) => e.form.kind)).toEqual(['credential', 'question', 'setup']);
    const turn = provider.sessions.conversation(SID).snapshot().turns.find((t) => t.role === 'assistant' && t.forms?.length);
    expect(turn && turn.role === 'assistant' ? turn.forms?.map((f) => f.id) : []).toEqual([idOf('credential'), idOf('question'), idOf('setup')]);
    expect(opened.every((e) => e.turnId === (turn as { id: string }).id)).toBe(true);
  });
  it('does not make a second wait of a form it already knows (a replay, a reconnect)', () => {
    expect(formWaits()).toHaveLength(3);
    expect(methods()).toContain('plugin.boopis.form.list');
  });
});

describe('answering', () => {
  beforeEach(async () => { await open(); });

  it('a question goes to the plugin as form.submit, and every place hears that it is resolved', async () => {
    await provider.forms.submit(idOf('question'), { values: { answer: 'yes' }, secrets: {} });
    const req = host.requests.find((r) => r.method === 'plugin.boopis.form.submit') as { params: Record<string, unknown> };
    expect(req.params).toMatchObject({ form_id: idOf('question'), values: { answer: 'yes' }, provided: [] });
    expect(waits).toContainEqual({ type: 'resolved', id: idOf('question'), outcome: 'submitted' });
    expect(conv).toContainEqual(expect.objectContaining({ type: 'form-resolved', formId: idOf('question'), status: 'submitted' }));
    expect(formWaits().map((w) => w.data.kind)).toEqual(['credential', 'setup']);
    const turn = provider.sessions.conversation(SID).snapshot().turns.find((t) => t.role === 'assistant' && t.forms?.length);
    expect(turn && turn.role === 'assistant' ? turn.forms?.find((f) => f.id === idOf('question'))?.resolved : '').toBe('submitted');
  });

  it('a secret goes to the keychain under the reference the field names, and to nothing else', async () => {
    await provider.forms.submit(idOf('credential'), { values: {}, secrets: { value: SECRET } });
    expect([...secrets.stored]).toEqual([['boopis.provider.openai/api_key', SECRET]]);
    const req = host.requests.find((r) => r.method === 'plugin.boopis.form.submit') as { params: Record<string, unknown> };
    expect(req.params).toMatchObject({ form_id: idOf('credential'), values: {}, provided: ['value'] });
    expect(JSON.stringify(host.requests)).not.toContain(SECRET);
    expect(JSON.stringify(waits)).not.toContain(SECRET);
    expect(JSON.stringify(conv)).not.toContain(SECRET);
    expect(JSON.stringify(provider.waits.snapshot())).not.toContain(SECRET);
  });

  it('saves the secret before it tells the plugin, so the plugin can confirm it with the host', async () => {
    const order: string[] = [];
    await open({ secrets: { set: () => { order.push('keychain'); return Promise.resolve(); } } });
    const orig = host.send.bind(host);
    host.send = (id, frame) => { const m = (frame as { method?: string }).method; if (m === 'plugin.boopis.form.submit') order.push('plugin'); return orig(id, frame); };
    await provider.forms.submit(idOf('credential'), { values: {}, secrets: { value: SECRET } });
    expect(order).toEqual(['keychain', 'plugin']);
  });

  it('leaves the form open, tells the person why, and sends the plugin nothing when the keychain refuses', async () => {
    await open({ secrets: { set: () => Promise.reject(new Error('the keychain is locked')) } });
    await expect(provider.forms.submit(idOf('credential'), { values: {}, secrets: { value: SECRET } })).rejects.toThrow(/keychain/);
    expect(methods()).not.toContain('plugin.boopis.form.submit');
    expect(formWaits().map((w) => w.data.kind)).toContain('credential');
  });

  it('refuses a secret field that names no place to store it, and says so, before anything is saved', async () => {
    host.emitEvent('plugin.boopis.form.opened', SID, { form_id: 'bare', kind: 'credential', title: 'Key', schema: { type: 'object', properties: { k: { type: 'string', 'x-secret': true } } }, submit: {}, origin: 'agent' });
    expect(formWaits().some((x) => x.id === 'bare')).toBe(true);
    await expect(provider.forms.submit('bare', { values: {}, secrets: { k: SECRET } })).rejects.toThrow(/no place to store/);
    expect(secrets.stored.size).toBe(0);
    expect(JSON.stringify(host.requests)).not.toContain(SECRET);
  });

  it('cancelling sends form.cancel and clears the form everywhere', async () => {
    await provider.forms.cancel(idOf('setup'));
    expect(methods()).toContain('plugin.boopis.form.cancel');
    expect(waits).toContainEqual({ type: 'resolved', id: idOf('setup'), outcome: 'cancelled' });
    expect(formWaits().map((w) => w.data.kind)).toEqual(['credential', 'question']);
  });

  it('a form the plugin resolves on its own (another device answered it, or it lapsed) leaves every place', () => {
    host.emitEvent('plugin.boopis.form.resolved', SID, { form_id: idOf('question'), status: 'expired' });
    expect(waits).toContainEqual({ type: 'resolved', id: idOf('question'), outcome: 'expired' });
    expect(conv).toContainEqual(expect.objectContaining({ type: 'form-resolved', formId: idOf('question'), status: 'expired' }));
    expect(formWaits().map((w) => w.data.kind)).toEqual(['credential', 'setup']);
  });

  it('answering a form that is no longer open says so', async () => {
    await provider.forms.submit(idOf('question'), { values: { answer: 'yes' }, secrets: {} });
    await expect(provider.forms.submit(idOf('question'), { values: { answer: 'no' }, secrets: {} })).rejects.toThrow(/no longer open/);
  });

  it('says what this build cannot do: no sign-in, no upload, no folder dialog in a plain browser', async () => {
    expect(provider.forms.can).toEqual({ signin: false, upload: false, folder: false });
    await expect(provider.forms.signin('x', 'y')).rejects.toThrow(/not available/);
    expect(await provider.forms.pickFolder()).toBeNull();
  });

  it('the wait list resolves a form only through forms, never through waits.resolve', () => {
    provider.waits.resolve(idOf('question'), 'approved');
    expect(methods()).not.toContain('plugin.boopis.form.submit');
    expect(formWaits()).toHaveLength(3);
  });
});
