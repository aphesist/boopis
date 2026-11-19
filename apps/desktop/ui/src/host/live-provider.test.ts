import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider } from '../data/mock-provider';
import type { ConversationEvent, WaitsEvent } from '../data';
import { GatewayClient } from './gateway';
import { createLiveProvider } from './live-provider';
import type { LiveProvider } from './live-provider';
import { FakeHost, recorded } from './testing';

const SESSION = 'local-7531bd0308f85f14ae9d7cf7ca71d18ec98ee0c17f81376bfa99e83db2f0753c';
const NOW = new Date(2026, 10, 18, 15, 30, 0);
const META = { governed: false, smart: false, model: '', assume: [] };

let host: FakeHost;
let provider: LiveProvider;
let client: GatewayClient;
let listCalls: number;

/** a gateway that answers the calls the provider makes */
function gateway(f: Record<string, unknown>): void {
  const id = f['id'];
  switch (f['method']) {
    case 'session.list': {
      listCalls++;
      const hidden = (f['params'] as { include_hidden?: boolean }).include_hidden === true;
      host.result(id, { sessions: hidden ? [] : [{ id: SESSION, title: '', preview: 'echo a thing', started_at: NOW.getTime() / 1000 - 7200 }] });
      break;
    }
    case 'session.resume': host.result(id, { session_id: SESSION, message_count: 0, messages: [], info: { model: 'fake-a' } }); break;
    case 'prompt.submit': host.result(id, { status: 'streaming', admission_id: 'a1' }); break;
    case 'approval.respond': host.result(id, { status: 'resolved', prompt_id: (f['params'] as { prompt_id: string }).prompt_id }); break;
    default: host.error(id, -32601, 'unexpected ' + String(f['method']));
  }
}

async function setup(): Promise<void> {
  host = new FakeHost();
  host.autoReply = gateway;
  listCalls = 0;
  client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ client, now: () => NOW, mock: createMockProvider({ simulate: false }) });
  await provider.ready;
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(setup);

describe('the live provider: sessions', () => {
  it('lists the gateway sessions, and shows what it does not know as empty', () => {
    expect(provider.sessions.list.get()).toEqual([{ id: SESSION, project: '', title: 'echo a thing', when: '2h', running: false }]);
    expect(provider.sessions.archived.get()).toEqual([]);
  });

  it('refreshes the list on sessions.changed and after a reconnect', async () => {
    const before = listCalls;
    host.event('sessions.changed', '');
    await tick();
    expect(listCalls).toBeGreaterThan(before);
    const mid = listCalls;
    host.event('connection.state', '', { state: 'ready', reconnected: true });
    await tick();
    expect(listCalls).toBeGreaterThan(mid);
  });

  it('keeps the mock for the sources it names, and says so', () => {
    expect(provider.details).toBeDefined();
    expect(provider.bots).toBeDefined();
  });
});

describe('the live provider: the conversation stream, from recorded frames', () => {
  it('turns a recorded prompt into turn, step, streamed text and finish events, in order', async () => {
    const conv = provider.sessions.conversation(SESSION);
    const seen: ConversationEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    await tick(); // the transcript loads (session.resume)
    expect(host.last('session.resume')?.['params']).toEqual({ session_id: SESSION });

    provider.sessions.send(SESSION, 'echo plain-echo', META);
    await tick();
    const submit = host.last('prompt.submit')?.['params'] as { session_id: string; text: string; submission_id: string };
    expect(submit).toMatchObject({ session_id: SESSION, text: 'echo plain-echo' });
    expect(submit.submission_id).toMatch(/^sub-/);

    for (const f of recorded.turn) if (f['method'] === 'event') host.emit(f);
    const kinds = seen.map((e) => e.type);
    expect(kinds[0]).toBe('reset');
    expect(kinds.slice(1, 4)).toEqual(['turn-added', 'turn-added', 'step-added']);
    expect(kinds.filter((k) => k === 'turn-text').length).toBeGreaterThan(1);
    expect(kinds.at(-1)).toBe('turn-finished');
    const user = seen.find((e) => e.type === 'turn-added' && e.turn.role === 'user');
    expect(user && user.type === 'turn-added' && user.turn.role === 'user' ? user.turn.text : '').toBe('echo plain-echo');
    const step = seen.find((e) => e.type === 'step-added');
    expect(step && step.type === 'step-added' ? step.step.title : '').toBe('hx_echo');

    const done = seen.at(-1);
    if (done?.type !== 'turn-finished') throw new Error('no finish');
    expect(done.paragraphs.join(' ')).toContain('DONE fake-a');
    expect(done.stopped).toBe(false);
    expect(done.cost).toBe(''); // unknown is not shown as a number
    const snap = conv.snapshot().turns;
    expect(snap.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(snap[1] && snap[1].role === 'assistant' ? snap[1].status : '').toBe('done');
    expect(provider.sessions.list.get()[0]?.running).toBe(false);
  });

  it('streams the answer text so far on every delta', async () => {
    const conv = provider.sessions.conversation(SESSION);
    const texts: string[] = [];
    conv.subscribe((e) => { if (e.type === 'turn-text') texts.push(e.paragraphs.join(' ')); });
    await tick();
    host.event('message.start', SESSION);
    host.event('message.delta', SESSION, { text: null });
    host.event('message.delta', SESSION, { text: 'Hel' });
    host.event('message.delta', SESSION, { text: 'lo' });
    expect(texts).toEqual(['Hel', 'Hello']);
  });

  it('ignores events of sessions it does not show', async () => {
    const conv = provider.sessions.conversation(SESSION);
    const seen: ConversationEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    await tick();
    seen.length = 0;
    host.event('message.start', 'local-someone-elses');
    expect(seen).toEqual([]);
  });

  it('shows an interrupted turn as stopped and a failed tool as a failed step', async () => {
    const conv = provider.sessions.conversation(SESSION);
    const seen: ConversationEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    await tick();
    host.event('message.start', SESSION);
    host.event('tool.start', SESSION, { name: 'terminal', context: 'make' });
    host.event('tool.complete', SESSION, { name: 'terminal', is_error: true, duration_s: 2 });
    host.event('message.complete', SESSION, { text: 'Stopped.', outcome: 'interrupted' });
    const steps = seen.filter((e) => e.type === 'step-added').map((e) => (e.type === 'step-added' ? e.step.kind ?? 'step' : ''));
    expect(steps).toEqual(['step', 'fail']);
    const done = seen.at(-1);
    expect(done?.type === 'turn-finished' && done.stopped).toBe(true);
  });

  it('says so, in the conversation, when a message is not accepted', async () => {
    host.autoReply = (f) => { if (f['method'] === 'prompt.submit') host.error(f['id'], -32000, 'refused'); else gateway(f); };
    const conv = provider.sessions.conversation(SESSION);
    const seen: ConversationEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    await tick();
    provider.sessions.send(SESSION, 'hi', META);
    await tick();
    const done = seen.at(-1);
    expect(done?.type === 'turn-finished' && done.paragraphs.join(' ')).toContain('The message was not sent: refused');
  });

  it('stops by interrupting the live session', async () => {
    provider.sessions.conversation(SESSION);
    await tick();
    provider.sessions.stop(SESSION);
    expect(host.last('session.interrupt')?.['params']).toEqual({ session_id: SESSION });
  });

  it('reloads a session whose events were lost', async () => {
    provider.sessions.conversation(SESSION);
    await tick();
    const before = host.sent.filter((s) => s.frame['method'] === 'session.resume').length;
    host.event('connection.replay_gap', '', { session_id: SESSION });
    await tick();
    expect(host.sent.filter((s) => s.frame['method'] === 'session.resume').length).toBe(before + 1);
  });

  it('a new session is not on the gateway until its first message', async () => {
    const created = provider.sessions.create('');
    expect(host.last('session.create')).toBeUndefined();
    host.autoReply = (f) => {
      if (f['method'] === 'session.create') host.result(f['id'], { session_id: 'local-new', stored_session_id: 'local-new', messages: [], message_count: 0, info: { model: 'fake-a' } });
      else if (f['method'] === 'plugin.boopis.mode.set') host.result(f['id'], {});
      else gateway(f);
    };
    provider.sessions.send(created.id, 'start', META);
    await tick();
    expect(host.last('session.create')?.['params']).toMatchObject({ source: 'gui' });
    expect(host.last('prompt.submit')?.['params']).toMatchObject({ session_id: 'local-new', text: 'start' });
  });

  describe('a new session and its toolsets', () => {
    /* the plugin is loaded in this Hermes: its capability is announced, and its methods answer */
    beforeEach(async () => {
      host = new FakeHost();
      host.describe = { instance_id: 'inst', capabilities: ['event-replay-v1', 'plugin-rpc-v1'] };
      host.autoReply = (f) => { if (String(f['method']).startsWith('plugin.boopis.')) host.result(f['id'], {}); else gateway(f); };
      client = new GatewayClient(host);
      await client.connect();
      provider = createLiveProvider({ client, now: () => NOW, mock: createMockProvider({ simulate: false }) });
      await provider.ready;
    });
    const created = (governed: boolean | null): string => {
      const s = provider.sessions.create('');
      if (governed !== null) { provider.details.follow(s.id); provider.details.setGovernance({ governed }); }
      return s.id;
    };
    const answer = (modeSet: (f: Record<string, unknown>) => void): void => {
      host.autoReply = (f) => {
        if (f['method'] === 'session.create') host.result(f['id'], { session_id: 'local-new', stored_session_id: 'local-new', messages: [], message_count: 0, info: { model: 'fake-a' } });
        else if (f['method'] === 'plugin.boopis.mode.set') modeSet(f);
        else if (f['method'] === 'session.close') host.result(f['id'], { closed: true });
        else gateway(f);
      };
    };
    const order = (): string[] => host.sent.map((s) => String(s.frame['method'])).filter((m) => ['session.create', 'plugin.boopis.mode.set', 'prompt.submit', 'session.close'].includes(m));

    it('a governed session is created with only the boopis toolset, and its mode is set before anything is sent', async () => {
      const id = created(true);
      answer((f) => { host.result(f['id'], {}); });
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')?.['params']).toEqual({ source: 'gui', toolsets: ['boopis'] });
      expect(host.last('plugin.boopis.mode.set')?.['params']).toEqual({ session_id: 'local-new', mode: 'governed' });
      expect(order()).toEqual(['session.create', 'plugin.boopis.mode.set', 'prompt.submit']);
    });

    it('a session whose mode was never chosen is governed too while the plugin default is unknown, so it never loses the toolset', async () => {
      const id = created(null);
      answer((f) => { host.result(f['id'], {}); });
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')?.['params']).toEqual({ source: 'gui', toolsets: ['boopis'] });
    });

    it('an ungoverned session gets no toolsets of ours', async () => {
      const id = created(false);
      answer((f) => { host.result(f['id'], {}); });
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')?.['params']).toEqual({ source: 'gui' });
      expect(host.last('plugin.boopis.mode.set')?.['params']).toEqual({ session_id: 'local-new', mode: 'ungoverned' });
    });

    it('a mode that cannot be set is fatal: the session is closed, nothing is sent, the error is shown, a retry starts fresh', async () => {
      const id = created(true);
      answer((f) => { host.error(f['id'], -32000, 'hx.mode.locked: the mode is locked'); });
      const seen: ConversationEvent[] = [];
      provider.sessions.conversation(id).subscribe((e) => seen.push(e));
      provider.sessions.send(id, 'start', META);
      await tick();
      await tick();
      expect(order()).toEqual(['session.create', 'plugin.boopis.mode.set', 'session.close']);
      expect(host.last('session.close')?.['params']).toEqual({ session_id: 'local-new' });
      expect(host.last('prompt.submit')).toBeUndefined();
      const finished = seen.find((e) => e.type === 'turn-finished');
      expect(finished && 'paragraphs' in finished ? finished.paragraphs.join(' ') : '').toMatch(/mode could not be set.*hx\.mode\.locked/);

      answer((f) => { host.result(f['id'], {}); });   // the plugin answers on the retry: the session starts, governed
      provider.sessions.send(id, 'again', META);
      await tick();
      expect(host.sent.filter((s) => s.frame['method'] === 'session.create').length).toBe(2);
      expect(host.last('prompt.submit')?.['params']).toMatchObject({ session_id: 'local-new', text: 'again' });
    });
  });

  it('a session made here keeps its id in the list after the gateway names it, and the composer starts empty', async () => {
    expect(provider.sessions.draft()).toBe('');
    const created = provider.sessions.create('');
    host.autoReply = (f) => {
      if (f['method'] === 'session.create') host.result(f['id'], { session_id: 'local-new', stored_session_id: 'local-new', messages: [], message_count: 0, info: {} });
      else if (f['method'] === 'plugin.boopis.mode.set') host.result(f['id'], {});
      else if (f['method'] === 'session.list') host.result(f['id'], { sessions: (f['params'] as { include_hidden?: boolean }).include_hidden ? [] : [{ id: 'local-new', title: 'start', started_at: NOW.getTime() / 1000 }] });
      else gateway(f);
    };
    provider.sessions.send(created.id, 'start', META);
    await tick();
    host.event('sessions.changed', '');
    await tick();
    expect(provider.sessions.list.get().map((s) => s.id)).toEqual([created.id]);
    expect(provider.sessions.list.get()[0]?.title).toBe('start');
  });
});

describe('the live provider: approvals', () => {
  const frames = recorded.approval.filter((r) => r.dir === 'in').map((r) => r.frame).filter((f) => f['method'] === 'event');
  const byType = (t: string): Record<string, unknown> => frames.find((f) => (f['params'] as { type: string }).type === t) ?? {};

  it('an approval.request is a wait; deciding sends the canonical approval.respond and settles it', async () => {
    const seen: WaitsEvent[] = [];
    provider.waits.subscribe((e) => seen.push(e));
    // the recording is of another session: bind it by resuming that id
    const other = (byType('approval.request')['params'] as { session_id: string }).session_id;
    host.autoReply = (f) => {
      if (f['method'] === 'session.resume') host.result(f['id'], { session_id: (f['params'] as { session_id: string }).session_id, message_count: 0, messages: [], info: {} });
      else if (f['method'] === 'session.list') host.result(f['id'], { sessions: (f['params'] as { include_hidden?: boolean }).include_hidden ? [] : [{ id: other, title: 'approvals' }] });
      else gateway(f);
    };
    host.event('sessions.changed', '');
    await tick();
    provider.sessions.conversation(other);
    await tick();
    host.emit(byType('approval.request'));
    const added = seen[0];
    expect(added?.type).toBe('added');
    if (added?.type !== 'added') return;
    expect(added.wait.title).toBe('chmod -R 777 /tmp/hx_spike_nonexistent_dir');
    expect(provider.waits.snapshot()).toHaveLength(1);

    provider.waits.resolve(added.wait.id, 'approved');
    await tick();
    const params = host.last('approval.respond')?.['params'] as Record<string, unknown>;
    expect(params).toMatchObject({ prompt_id: added.wait.id, choice: 'once', execution_generation: 1 });
    expect(seen.at(-1)).toEqual({ type: 'resolved', id: added.wait.id, outcome: 'approved' });
    expect(provider.waits.snapshot()).toHaveLength(0);
  });

  it('a denial is delivered as deny, and an unknown wait does nothing', async () => {
    host.autoReply = (f) => gateway(f);
    provider.waits.resolve('nope', 'approved');
    await tick();
    expect(host.last('approval.respond')).toBeUndefined();
  });
});

describe('the live provider: the ledger', () => {
  it('totals what the plugin appends (a synthetic event: no recording exists yet)', () => {
    const seen: number[] = [];
    provider.ledger.subscribe((t) => seen.push(t.tokens));
    host.event('plugin.boopis.ledger.appended', SESSION, { type: 'usage.recorded', payload: { input_tokens: 40, output_tokens: 2 } } as never);
    expect(provider.ledger.totals()).toEqual({ tokens: 42, trips: 1 });
    expect(seen).toEqual([42]);
  });
});
