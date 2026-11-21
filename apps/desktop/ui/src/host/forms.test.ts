import { describe, expect, it } from 'vitest';
import approvalFrames from './fixtures/approval.frames.json';
import { endpointForm, fieldsOf, fromGatewayEvent, fromHostForm, fromPluginEvent, replyFor, splitSecrets } from './forms';

const CRED = { type: 'object', required: ['value'], properties: { value: { type: 'string', title: 'API key', 'x-secret': true, 'x-secret-ref': 'secret://provider.main/api_key' } } };

describe('form fields', () => {
  it('reads the elicitation schema and the extensions, and drops what it cannot draw', () => {
    const f = fieldsOf({ required: ['a'], properties: {
      a: { type: 'string', enum: ['x', 'y'], enumNames: ['X', 'Y'], 'x-multi': true, 'x-other': true },
      b: { type: 'boolean', title: 'On' }, c: { type: 'object' }, d: { type: 'string', 'x-secret': true, 'x-secret-ref': 'secret://p.q/k' } } });
    expect(f.map((x) => x.name)).toEqual(['a', 'b', 'd']);
    expect(f[0]).toMatchObject({ required: true, multi: true, other: true, options: ['x', 'y'], optionNames: ['X', 'Y'] });
    expect(f[1]).toMatchObject({ title: 'On', required: false, options: null });
    expect(f[2]).toMatchObject({ secret: true, secretRef: 'secret://p.q/k' });
    expect(fieldsOf(null)).toEqual([]);
  });
});

describe('a mod asks (`$.ui.ask`, a permission): the origin is an object', () => {
  const ASK = { form_id: 'f1', kind: 'choice', title: 'Which tests?', body: '', schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string', title: 'Run', enum: ['a', 'b'] } } }, submit: { label: 'Use this' } };
  it('keeps the mod as who asks, with its name, instead of the agent', () => {
    const m = fromPluginEvent('s', { ...ASK, origin: { kind: 'mod', plugin: 'test-runner' } }, 'fake-a');
    expect(m?.spec.origin).toEqual({ kind: 'mod', plugin: 'test-runner' });
    expect(m?.origin).toBe('mod');
    expect(m?.source).toEqual({ kind: 'plugin', sessionId: 's' });
  });
  it('is still answered through the plugin like any form', () => {
    const m = fromPluginEvent('s', { ...ASK, origin: { kind: 'mod', plugin: 'test-runner' } }) as NonNullable<ReturnType<typeof fromPluginEvent>>;
    expect(replyFor(m, { cancelled: false, values: { answer: 'a' }, provided: [] })).toEqual({ method: 'plugin.boopis.form.submit', params: { session_id: 's', form_id: 'f1', values: { answer: 'a' }, provided: [] } });
  });
  it('does not take an object origin for a mod when it names no plugin, nor an unknown kind: those are the agent\'s', () => {
    expect(fromPluginEvent('s', { ...ASK, origin: { kind: 'mod' } }, 'm')?.spec.origin).toEqual({ kind: 'agent', model: 'm' });
    expect(fromPluginEvent('s', { ...ASK, origin: { kind: 'other', plugin: 'x' } }, 'm')?.spec.origin).toEqual({ kind: 'agent', model: 'm' });
  });
  it('words still work: agent, plugin and the rest', () => {
    expect(fromPluginEvent('s', { ...ASK, origin: 'plugin' })?.spec.origin).toEqual({ kind: 'plugin' });
    expect(fromPluginEvent('s', ASK, 'm')?.spec.origin).toEqual({ kind: 'agent', model: 'm' });
  });
});

describe('the sources', () => {
  it('turns a host form into a model with its diff and buttons', () => {
    const m = fromHostForm({ form_id: 'setup.config', kind: 'setup', title: 't', body: 'b', schema: { type: 'object', properties: {} }, submit: { label: 'Apply' }, cancel: { label: 'No' },
      sensitive: false, origin: 'host', diff: [{ key: 'a.b', from: null, to: 'off' }] });
    expect(m).toMatchObject({ id: 'setup.config', submitLabel: 'Apply', cancelLabel: 'No', diff: [{ key: 'a.b', from: null, to: 'off' }], source: { kind: 'host' } });
    expect(replyFor(m, { cancelled: true })).toBeNull();
  });

  it('turns the plugin event into a form and answers with form.submit, naming the secrets saved', () => {
    const m = fromPluginEvent('s1', { form_id: 'f1', kind: 'credential', title: 'Add a key', schema: CRED, sensitive: true, origin: 'agent', submit: { label: 'Save' } });
    expect(m).toMatchObject({ id: 'f1', sensitive: true, submitLabel: 'Save' });
    expect(fromPluginEvent('s1', {})).toBeNull();
    expect(replyFor(m!, { cancelled: false, values: {}, provided: ['value'] })).toEqual({ method: 'plugin.boopis.form.submit', params: { session_id: 's1', form_id: 'f1', values: {}, provided: ['value'] } });
    expect(replyFor(m!, { cancelled: true })).toEqual({ method: 'plugin.boopis.form.cancel', params: { session_id: 's1', form_id: 'f1' } });
  });

  it('adapts the recorded approval.request and answers through approval.respond', () => {
    const frame = approvalFrames.map((r) => r.frame as { params?: { type?: string; session_id?: string; payload?: Record<string, unknown> } }).find((f) => f.params?.type === 'approval.request');
    const p = frame?.params;
    expect(p).toBeTruthy();
    const m = fromGatewayEvent('approval.request', p?.session_id ?? '', p?.payload ?? {});
    expect(m).toMatchObject({ kind: 'approval', origin: 'hermes', fields: [{ name: 'choice' }] });
    expect(m?.body).toContain('chmod');
    const yes = replyFor(m!, { cancelled: false, values: { choice: 'session' } });
    expect(yes).toEqual({ method: 'approval.respond', params: { session_id: p?.session_id, execution_generation: p?.payload?.['execution_generation'], prompt_id: p?.payload?.['prompt_id'], choice: 'session' } });
    expect(replyFor(m!, { cancelled: true })?.params['choice']).toBe('deny');
  });

  it('adapts clarify.request, joins several answers and treats cancel as an empty answer', () => {
    const m = fromGatewayEvent('clarify.request', 's2', { kind: 'clarify', prompt_id: 'c1', execution_generation: 4, question: 'Which?', choices: ['a', 'b'], multi_select: true });
    expect(m).toMatchObject({ kind: 'question', title: 'Which?', fields: [{ multi: true, other: true, options: ['a', 'b'] }] });
    expect(replyFor(m!, { cancelled: false, values: { answer: ['a', 'b'] } })).toEqual({ method: 'clarify.respond', params: { session_id: 's2', execution_generation: 4, prompt_id: 'c1', answer: 'a, b' } });
    expect(replyFor(m!, { cancelled: true })?.params['answer']).toBe('');
    expect(fromGatewayEvent('message.delta', 's', { prompt_id: 'x', execution_generation: 1 })).toBeNull();
    expect(fromGatewayEvent('clarify.request', 's', { question: 'no id' })).toBeNull();
  });
});

describe('secrets', () => {
  const m = fromPluginEvent('s1', { form_id: 'f1', kind: 'credential', title: 't', schema: CRED, sensitive: true })!;

  it('splits a secret off to the keychain target and keeps it out of what the agent gets', () => {
    const { plain, secrets } = splitSecrets(m, { value: 'sk-secret', note: 'n' });
    expect(plain).toEqual({ note: 'n' });
    expect(secrets).toEqual([{ field: 'value', service: 'boopis.provider.main', account: 'api_key', value: 'sk-secret' }]);
    expect(JSON.stringify(plain)).not.toContain('sk-secret');
  });

  it('leaves an empty secret out and refuses a secret with nowhere to go', () => {
    expect(splitSecrets(m, { value: '' }).secrets).toEqual([]);
    const bad = fromPluginEvent('s', { form_id: 'f', schema: { type: 'object', properties: { k: { type: 'string', 'x-secret': true } } } })!;
    expect(() => splitSecrets(bad, { k: 'v' })).toThrow(/no place to store/);
  });
});

describe('the endpoint form kind (ADR-0039)', () => {
  it('draws the first step from the catalogue: name, address, wire, an optional secret key, keep-up-to-date; no models yet', () => {
    const m = endpointForm('test');
    expect(m.kind).toBe('endpoint');
    expect(m.spec.kind).toBe('endpoint');
    expect(m.fields.map((f) => f.name)).toEqual(['name', 'base_url', 'api_mode', 'key', 'discover']);
    const key = m.fields.find((f) => f.name === 'key');
    expect(key).toMatchObject({ secret: true, required: false, default: undefined });
    expect(m.fields.find((f) => f.name === 'api_mode')).toMatchObject({ options: ['chat_completions', 'codex_responses', 'anthropic_messages'], optionNames: ['OpenAI chat', 'OpenAI Responses', 'Anthropic'], default: 'chat_completions' });
    expect(m.fields.filter((f) => f.required).map((f) => f.name)).toEqual(['name', 'base_url', 'api_mode']);
    expect(m.submitLabel).toBe('Test');
  });
  it('draws the second step with exactly the models Test found, all ticked, and no secret field', () => {
    const m = endpointForm('save', { found: ['a', 'b'], values: { name: 'My server', base_url: 'http://127.0.0.1:8000/v1', api_mode: 'chat_completions', discover: false } });
    expect(m.fields.map((f) => f.name)).toEqual(['name', 'base_url', 'api_mode', 'discover', 'picks', 'extra_models']);
    const picks = m.fields.find((f) => f.name === 'picks');
    expect(picks).toMatchObject({ multi: true, options: ['a', 'b'], default: ['a', 'b'] });
    expect(m.fields.some((f) => f.secret)).toBe(false);
    expect(m.fields.find((f) => f.name === 'name')?.default).toBe('My server');
    expect(m.fields.find((f) => f.name === 'discover')?.default).toBe(false);
    expect(m.submitLabel).toBe('Save endpoint');
  });
  it('asks for ids by hand when Test found none', () => {
    const m = endpointForm('save', { found: [] });
    expect(m.fields.map((f) => f.name)).toContain('extra_models');
    expect(m.fields.map((f) => f.name)).not.toContain('picks');
    expect(m.body).toContain('lists no models');
  });
});
