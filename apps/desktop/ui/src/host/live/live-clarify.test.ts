/* Hermes's clarify, adapted onto the same form model the plugin's forms use, and answered through Hermes's own
   `clarify.respond` (never through the plugin). */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationEvent, FormWait } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { FakeHost } from '../testing';

const SID = 'local-clarify';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
let host: FakeHost;
let provider: LiveProvider;
let conv: ConversationEvent[];

beforeEach(async () => {
  host = new FakeHost();
  host.autoReply = (f) => {
    const id = f['id'];
    switch (f['method']) {
      case 'session.list': host.result(id, { sessions: (f['params'] as { include_hidden?: boolean }).include_hidden ? [] : [{ id: SID, title: 't', preview: 'p', started_at: 1 }] }); break;
      case 'session.resume': host.result(id, { session_id: SID, message_count: 0, messages: [], info: { model: 'sonnet 5.5' } }); break;
      case 'prompt.submit': host.result(id, { status: 'streaming', admission_id: 'a' }); break;
      case 'clarify.respond': host.result(id, { status: 'resolved', prompt_id: (f['params'] as { prompt_id: string }).prompt_id }); break;
      default: host.error(id, -32601, 'unexpected ' + String(f['method']), { reason: 'unknown_method' });
    }
  };
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ client, mock: createMockProvider({ simulate: false }) });
  await provider.ready;
  conv = [];
  provider.sessions.conversation(SID).subscribe((e) => conv.push(e));
  provider.sessions.send(SID, 'go', { governed: false, smart: false, model: '', assume: [] });
  await tick(); await tick();
  host.event('message.start', SID, {}, 1);
});
const forms = (): FormWait[] => provider.waits.snapshot().filter((w): w is FormWait => w.kind === 'form');

describe('clarify', () => {
  it('becomes a question form from the agent, in the conversation and in the dock', () => {
    host.event('clarify.request', SID, { kind: 'clarify', prompt_id: 'c1', execution_generation: 3, question: 'Which branch?', choices: ['main', 'dev'], multi_select: false }, 2);
    expect(forms()).toHaveLength(1);
    const f = forms()[0]?.data;
    expect(f).toMatchObject({ id: 'c1', kind: 'question', title: 'Which branch?', origin: { kind: 'agent', model: 'sonnet 5.5' } });
    expect(f?.schema.properties?.['answer']).toMatchObject({ enum: ['main', 'dev'], 'x-other': true });
    expect(conv.some((e) => e.type === 'form-opened' && e.form.id === 'c1')).toBe(true);
  });

  it('is answered with clarify.respond, carrying the generation and the prompt, and resolves everywhere', async () => {
    host.event('clarify.request', SID, { kind: 'clarify', prompt_id: 'c1', execution_generation: 3, question: 'Which branch?', choices: ['main', 'dev'], multi_select: false }, 2);
    await provider.forms.submit('c1', { values: { answer: 'dev' }, secrets: {} });
    expect(host.last('clarify.respond')?.['params']).toEqual({ session_id: SID, execution_generation: 3, prompt_id: 'c1', answer: 'dev' });
    expect(host.last('plugin.hypotaxis.form.submit')).toBeUndefined();
    expect(forms()).toHaveLength(0);
    expect(conv.some((e) => e.type === 'form-resolved' && e.formId === 'c1' && e.status === 'submitted')).toBe(true);
  });

  it('joins several answers, and a skip is an empty answer', async () => {
    host.event('clarify.request', SID, { kind: 'clarify', prompt_id: 'c2', execution_generation: 3, question: 'Which?', choices: ['a', 'b'], multi_select: true }, 2);
    expect(forms()[0]?.data.schema.properties?.['answer']).toMatchObject({ 'x-multi': true });
    await provider.forms.cancel('c2');
    expect((host.last('clarify.respond')?.['params'] as { answer: string }).answer).toBe('');
    expect(forms()).toHaveLength(0);
  });

  it('is gone when Hermes settles it itself', () => {
    host.event('clarify.request', SID, { kind: 'clarify', prompt_id: 'c3', execution_generation: 3, question: 'Q?', choices: [] }, 2);
    expect(forms()).toHaveLength(1);
    host.event('clarify.settled', SID, { prompt_id: 'c3' }, 3);
    expect(forms()).toHaveLength(0);
  });

  it('ignores a clarify with no prompt id, since nothing could answer it', () => {
    host.event('clarify.request', SID, { question: 'no id' }, 2);
    expect(forms()).toHaveLength(0);
  });
});
