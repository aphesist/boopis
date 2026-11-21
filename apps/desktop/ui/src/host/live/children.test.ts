/* The tasks a session hands to other models: the engine's `subagent.*` frames folded into cards (live/children.ts), and the same
   frames through the live provider, over a fake gateway that plays what `tool_progress._progress_subagent` emits. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider } from '../../data/mock-provider';
import type { ChildTask, ConversationEvent } from '../../data';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { FakeHost } from '../testing';
import { childTime, foldChild, statusOf } from './children';
import { rosterOf, sendRoster } from './dispatch';

const SID = 'local-parent';
const CHILD_SESSION = 'child-session-1';
const META = { governed: false, smart: false, model: '', assume: [] };
const T0 = 1_000_000;
const frame = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ goal: 'fix the typo', task_count: 4, task_index: 0, ...extra });

describe('one frame folded into the turn\'s children', () => {
  it('a request, a start, tool and progress frames and a completion make one card that goes queued, running, done', () => {
    let list: ChildTask[] = [];
    const step = (type: string, p: Record<string, unknown>, at = T0): ChildTask => {
      const out = foldChild(list, type, frame(p) as never, at);
      expect(out).not.toBeNull();
      list = (out as { list: ChildTask[] }).list;
      return (out as { child: ChildTask }).child;
    };
    expect(step('subagent.spawn_requested', { delegation_id: 'd1' })).toMatchObject({ status: 'queued', goal: 'fix the typo', model: '' });
    expect(step('subagent.start', { delegation_id: 'd1', subagent_id: 'sa-1', model: 'claude-opus-5-5', child_session_id: CHILD_SESSION })).toMatchObject({ status: 'running', subagentId: 'sa-1', id: 'sa-1', model: 'claude-opus-5-5', childSession: CHILD_SESSION, startedAt: T0 });
    expect(list).toHaveLength(1);   /* the id-less request and the start with an id are one child */
    expect(step('subagent.tool', { subagent_id: 'sa-1', tool_name: 'read_file', tool_preview: 'src/a.ts', tool_count: 1 }, T0 + 1000)).toMatchObject({ now: 'read_file src/a.ts', tools: 1, startedAt: T0 });
    expect(step('subagent.thinking', { subagent_id: 'sa-1', text: 'the  typo is\nin the header' })).toMatchObject({ now: 'the typo is in the header' });
    expect(step('subagent.progress', { subagent_id: 'sa-1', text: 'editing', tool_count: 2 })).toMatchObject({ now: 'editing', tools: 2 });
    expect(step('subagent.complete', { subagent_id: 'sa-1', status: 'completed', summary: 'Fixed in README.md', duration_seconds: 7 })).toMatchObject({ status: 'done', summary: 'Fixed in README.md', seconds: 7, now: '' });
  });

  it('keeps four tasks of one delegation apart by their index, before any has an id', () => {
    let list: ChildTask[] = [];
    for (let i = 0; i < 4; i++) list = (foldChild(list, 'subagent.spawn_requested', frame({ task_index: i, goal: 'task ' + i, delegation_id: 'd1' }) as never, T0) as { list: ChildTask[] }).list;
    expect(list.map((c) => c.goal)).toEqual(['task 0', 'task 1', 'task 2', 'task 3']);
    list = (foldChild(list, 'subagent.start', frame({ task_index: 2, goal: 'task 2', delegation_id: 'd1', subagent_id: 'sa-2' }) as never, T0) as { list: ChildTask[] }).list;
    expect(list.map((c) => [c.goal, c.status, c.subagentId])).toEqual([['task 0', 'queued', ''], ['task 1', 'queued', ''], ['task 2', 'running', 'sa-2'], ['task 3', 'queued', '']]);
  });

  it('maps the engine\'s statuses, and never revives a child that ended', () => {
    expect(['completed', 'failed', 'error', 'timeout', 'interrupted', 'running', 'queued', undefined].map((s) => statusOf(s))).toEqual(['done', 'failed', 'failed', 'failed', 'stopped', 'running', 'queued', 'running']);
    const ended = (foldChild([], 'subagent.complete', frame({ subagent_id: 'x', status: 'interrupted' }) as never, T0) as { list: ChildTask[] }).list;
    expect(ended[0]).toMatchObject({ status: 'stopped', summary: 'Stopped before it finished.' });
    const late = foldChild(ended, 'subagent.tool', frame({ subagent_id: 'x', tool_name: 'terminal' }) as never, T0) as { child: ChildTask };
    expect(late.child.status).toBe('stopped');
    const failed = foldChild([], 'subagent.complete', frame({ subagent_id: 'y', status: 'error' }) as never, T0) as { child: ChildTask };
    expect(failed.child.summary).toBe('It ended without saying why.');   /* nothing is invented: it says it does not know */
  });

  it('ignores a frame of another kind, and writes a clock the way the turns do', () => {
    expect(foldChild([], 'tool.start', frame() as never, T0)).toBeNull();
    expect(childTime({ startedAt: T0, seconds: null, status: 'running' }, T0 + 64_000)).toBe('1m 04s');
    expect(childTime({ startedAt: T0, seconds: 7, status: 'done' }, T0 + 99_000)).toBe('7s');
    expect(childTime({ startedAt: null, seconds: null, status: 'queued' }, T0)).toBeUndefined();
  });
});

let host: FakeHost;
let provider: LiveProvider;
let conv: ConversationEvent[];
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const calls = (method: string): Record<string, unknown>[] => host.sent.filter((s) => s.frame['method'] === method).map((s) => s.frame['params'] as Record<string, unknown>);

function gateway(f: Record<string, unknown>): void {
  const id = f['id'];
  switch (f['method']) {
    case 'session.list': host.result(id, { sessions: [] }); break;
    case 'model.options': host.result(id, { providers: [{ slug: 'xai', name: 'xAI', models: ['grok-4'], authenticated: true }, { slug: 'gemini', name: 'Gemini', models: ['gemini-3.8-flash'], authenticated: false }] }); break;
    case 'session.create': host.result(id, { session_id: SID, info: { model: 'claude-sonnet-5-5' } }); break;
    case 'prompt.submit': host.result(id, { status: 'streaming', admission_id: 'a1' }); break;
    case 'subagent.interrupt': host.result(id, { found: true, subagent_id: (f['params'] as { subagent_id: string }).subagent_id }); break;
    case 'session.transcript': host.result(id, { session_id: CHILD_SESSION, rows: [{ role: 'user', text: 'fix the typo', row_kind: 'message' }, { role: 'tool', name: 'read_file', context: 'README.md', row_kind: 'message' }, { role: 'assistant', text: 'Fixed in README.md', row_kind: 'message' }], next_cursor: null, reset: false }); break;
    case 'plugin.boopis.dispatch.roster': host.result(id, { aliases: [{ alias: 'opus', provider: 'claude-subscription-directsdk', model: 'claude-opus-5-5' }] }); break;
    default: host.result(id, {});
  }
}
const ev = (type: string, p: Record<string, unknown>): void => { host.event(type, SID, frame(p)); };
const turnId = (): string => (conv.find((e): e is Extract<ConversationEvent, { type: 'turn-added' }> => e.type === 'turn-added' && e.turn.role === 'assistant') as { turn: { id: string } }).turn.id;
const lastChild = (): ChildTask => ([...conv].reverse().find((e): e is Extract<ConversationEvent, { type: 'child-updated' }> => e.type === 'child-updated') as { child: ChildTask }).child;

beforeEach(async () => {
  host = new FakeHost();
  host.describe = { instance_id: 'inst', capabilities: ['event-replay-v1', 'plugin-rpc-v1'] };
  host.autoReply = gateway;
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ client, mock: createMockProvider({ simulate: false }) });
  await provider.ready;
  const s = provider.sessions.create(null);
  conv = [];
  provider.sessions.conversation(s.id).subscribe((e) => conv.push(e));
  provider.sessions.send(s.id, 'send this to opus, this to codex', META);
  await tick(); await tick(); await tick();
  Object.assign(globalThis, { __sid: s.id });
});

describe('the live provider: children over fake subagent frames', () => {
  it('tells the plugin the models before it makes the session, then sends the message', () => {
    const order = host.sent.map((s) => s.frame['method']).filter((m) => ['plugin.boopis.dispatch.roster', 'session.create', 'prompt.submit'].includes(String(m)));
    expect(order).toEqual(['plugin.boopis.dispatch.roster', 'session.create', 'prompt.submit']);
    expect(calls('plugin.boopis.dispatch.roster')).toEqual([{ models: [{ provider: 'xai', model: 'grok-4' }] }]);   /* only the models signed in */
  });

  it('draws a child per task in the turn that raised them, with the engine\'s words', async () => {
    ev('message.start', {});
    ev('subagent.spawn_requested', { delegation_id: 'd1', task_index: 0, goal: 'summarise the repo' });
    ev('subagent.spawn_requested', { delegation_id: 'd1', task_index: 1, goal: 'review the diff' });
    ev('subagent.start', { delegation_id: 'd1', task_index: 0, goal: 'summarise the repo', subagent_id: 'sa-0', model: 'claude-opus-5-5', child_session_id: CHILD_SESSION });
    ev('subagent.tool', { subagent_id: 'sa-0', goal: 'summarise the repo', tool_name: 'search_files', tool_preview: 'TODO' });
    await tick();
    const updates = conv.filter((e) => e.type === 'child-updated');
    expect(updates).toHaveLength(4);
    expect(updates.every((e) => e.type === 'child-updated' && e.turnId === turnId())).toBe(true);
    expect(lastChild()).toMatchObject({ id: 'sa-0', model: 'claude-opus-5-5', status: 'running', now: 'search_files TODO', childSession: CHILD_SESSION });
    const turn = provider.sessions.conversation((globalThis as { __sid?: string }).__sid as string).snapshot().turns.find((t) => t.role === 'assistant');
    expect(turn && turn.role === 'assistant' ? turn.children?.map((c) => [c.goal, c.status]) : null).toEqual([['summarise the repo', 'running'], ['review the diff', 'queued']]);
  });

  it('stops a child by the engine\'s subagent id, and the card ends when the engine says it was interrupted', async () => {
    ev('message.start', {});
    ev('subagent.start', { subagent_id: 'sa-0', goal: 'long job', model: 'gpt-6-luna' });
    await tick();
    provider.sessions.stopChild?.((globalThis as { __sid?: string }).__sid as string, 'sa-0');
    await tick();
    expect(calls('subagent.interrupt')).toEqual([{ session_id: SID, subagent_id: 'sa-0' }]);
    ev('subagent.complete', { subagent_id: 'sa-0', goal: 'long job', status: 'interrupted', duration_seconds: 3 });
    await tick();
    expect(lastChild()).toMatchObject({ status: 'stopped', seconds: 3 });
  });

  it('does not stop a child that has no id yet, and says nothing is wrong', async () => {
    ev('message.start', {});
    ev('subagent.spawn_requested', { delegation_id: 'd1', goal: 'not started' });
    await tick();
    provider.sessions.stopChild?.((globalThis as { __sid?: string }).__sid as string, lastChild().id);
    await tick();
    expect(calls('subagent.interrupt')).toEqual([]);
  });

  it('reads what a child did from its own session, without binding it', async () => {
    ev('message.start', {});
    ev('subagent.start', { subagent_id: 'sa-0', goal: 'fix the typo', model: 'claude-opus-5-5', child_session_id: CHILD_SESSION });
    await tick();
    const turns = await provider.sessions.childTranscript?.((globalThis as { __sid?: string }).__sid as string, 'sa-0');
    expect(calls('session.transcript')).toEqual([{ session_id: CHILD_SESSION, limit: 200, order: 'oldest' }]);
    expect(calls('session.resume')).toEqual([]);   /* read only: the child's session is never attached for writing */
    expect(turns?.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(turns?.[1]).toMatchObject({ role: 'assistant', stepCount: 1, paragraphs: ['Fixed in README.md'] });
  });

  it('refuses to read a child that has no session yet, with a sentence', async () => {
    ev('message.start', {});
    ev('subagent.spawn_requested', { delegation_id: 'd1', goal: 'not started' });
    await tick();
    await expect(provider.sessions.childTranscript?.((globalThis as { __sid?: string }).__sid as string, lastChild().id)).rejects.toThrow(/no session of its own/);
  });

  it('keeps the cards in the turn that ended, so a result that arrives later still lands there', async () => {
    ev('message.start', {});
    ev('subagent.start', { subagent_id: 'sa-0', goal: 'job', model: 'grok-4' });
    host.event('message.complete', SID, { text: 'Sent.', outcome: 'completed' });
    await tick();
    ev('subagent.complete', { subagent_id: 'sa-0', goal: 'job', status: 'completed', summary: 'Done it' });
    await tick();
    expect(lastChild()).toMatchObject({ status: 'done', summary: 'Done it' });
    const turns = provider.sessions.conversation((globalThis as { __sid?: string }).__sid as string).snapshot().turns.filter((t) => t.role === 'assistant');
    expect(turns).toHaveLength(1);
    expect(turns[0] && turns[0].role === 'assistant' ? turns[0].children?.[0]?.summary : '').toBe('Done it');
  });
});

describe('telling the plugin which models can be named', () => {
  it('sends the models in the order given, without the ones that name no model', () => {
    expect(rosterOf([{ provider: 'a', model: 'm1' }, { provider: 'b', model: '' }, { provider: 'c', model: 'm3' }])).toEqual([{ provider: 'a', model: 'm1' }, { provider: 'c', model: 'm3' }]);
  });
  it('returns the plugin\'s words, and nothing when the plugin refuses or there is nothing to name', async () => {
    const ok = { requestRaw: (_m: string, _p: unknown): Promise<unknown> => Promise.resolve({ aliases: [{ alias: 'opus', provider: 'p', model: 'claude-opus-5-5' }] }) };
    expect(await sendRoster(ok, [{ provider: 'p', model: 'claude-opus-5-5' }])).toEqual([{ alias: 'opus', provider: 'p', model: 'claude-opus-5-5' }]);
    const asked: unknown[] = [];
    const no = { requestRaw: (m: string, p: unknown): Promise<unknown> => { asked.push([m, p]); return Promise.reject(new Error('unknown method')); } };
    expect(await sendRoster(no, [{ provider: 'p', model: 'm' }])).toEqual([]);
    expect(asked).toEqual([['plugin.boopis.dispatch.roster', { models: [{ provider: 'p', model: 'm' }] }]]);
    expect(await sendRoster(no, [])).toEqual([]);
    expect(asked).toHaveLength(1);   /* nothing to name: no call */
  });
});
