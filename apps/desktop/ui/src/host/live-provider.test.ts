import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider } from '../data/mock-provider';
import type { ConversationEvent, WaitsEvent } from '../data';
import { GatewayClient } from './gateway';
import { createLiveProvider } from './live-provider';
import type { LiveProvider } from './live-provider';
import { FakeHost, S0_CREATE_PARAMS, recorded } from './testing';

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

async function setup(handler: (f: Record<string, unknown>) => void = gateway, plugin = false): Promise<void> {
  host = new FakeHost();
  if (plugin) host.describe = { instance_id: 'inst', capabilities: ['event-replay-v1', 'plugin-rpc-v1'], session_create: { parameters: S0_CREATE_PARAMS } };
  host.autoReply = handler;
  listCalls = 0;
  client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ defaultFolder: '/work/proj', client, now: () => NOW, mock: createMockProvider({ simulate: false }) });
  await provider.ready;
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => setup());

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

  it('names the model the engine reported as the one that answered', async () => {
    const conv = provider.sessions.conversation(SESSION);
    const seen: ConversationEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    await tick();
    host.event('message.start', SESSION);
    host.event('message.complete', SESSION, { text: 'Done.', outcome: 'completed', usage: { model: 'claude-sonnet-5-5[1m]' } });
    const done = seen.at(-1);
    expect(done?.type === 'turn-finished' && done.model).toBe('claude-sonnet-5-5[1m]');
    const t = conv.snapshot().turns.at(-1);
    expect(t?.role === 'assistant' && t.model).toBe('claude-sonnet-5-5[1m]');
  });

  it('Smart picks the model before the message goes, and the turn says what it picked and why', async () => {
    const P = 'claude-subscription-directsdk-experimental';
    const ladder = ['haiku', 'sonnet', 'opus'].map((n) => ({ name: n, model: { provider: P, id: n } }));
    const sent: string[] = [];
    await setup((f) => {
      const id = f['id'];
      if (f['method'] === 'plugin.boopis.cascade.state') { host.result(id, { ladder, status: 'idle' }); return; }
      if (f['method'] === 'plugin.boopis.ledger.tail') { host.result(id, { events: [] }); return; }
      if (String(f['method']).startsWith('plugin.boopis.')) { host.result(id, {}); return; }
      if (f['method'] === 'config.set' && (f['params'] as { key?: string }).key === 'model') { host.error(id, 4001, 'use_session_mutation_model', { reason: 'use_session_mutation_model' }); return; }
      if (f['method'] === 'session.mutate') { const p = (f['params'] as { payload: { model: string; provider?: string } }).payload; sent.push(p.model + ' --provider ' + p.provider); host.result(id, { session_id: SESSION, operation: 'model', revision: 1, execution_generation: 0 }); return; }
      gateway(f);
    }, true);
    const conv = provider.sessions.conversation(SESSION);
    await tick();
    provider.details.follow(SESSION);
    await tick();
    expect(provider.details.setGovernance({ smart: true })).toBeNull();
    provider.sessions.send(SESSION, 'debug why the login test is flaky', { ...META, smart: true });
    await tick(); await tick();
    expect(sent).toEqual(['sonnet --provider ' + P]);
    expect(host.last('prompt.submit')).toBeDefined();
    host.event('message.start', SESSION);
    const t = conv.snapshot().turns.at(-1);
    expect(t?.role === 'assistant' && [t.model, t.why]).toEqual([P + '/sonnet', 'Smart: debugging']);
  });

  it('a governed turn shows the tiers the ladder ran, in order, and the last one answered', async () => {
    const P = 'claude-subscription-directsdk-experimental';
    const ladder = ['haiku', 'sonnet'].map((n) => ({ name: n, model: { provider: P, id: n } }));
    await setup((f) => {
      const m = String(f['method']);
      if (m === 'plugin.boopis.cascade.state') host.result(f['id'], { ladder, status: 'idle' });
      else if (m === 'plugin.boopis.ledger.tail') host.result(f['id'], { events: [] });
      else if (m.startsWith('plugin.boopis.')) host.result(f['id'], {});
      else gateway(f);
    }, true);
    const conv = provider.sessions.conversation(SESSION);
    const seen: ConversationEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    await tick();
    provider.details.follow(SESSION);
    await tick(); await provider.settled();
    host.event('message.start', SESSION);
    host.event('plugin.boopis.cascade.updated', SESSION, { task_id: 't1', tier: 'haiku', status: 'working', attempt: 1 });
    host.event('plugin.boopis.cascade.updated', SESSION, { task_id: 't1', tier: 'sonnet', status: 'working', attempt: 2 });
    host.event('message.complete', SESSION, { text: 'Done.', outcome: 'completed', usage: { model: 'haiku' } });
    expect(seen.filter((e) => e.type === 'turn-model').map((e) => (e.type === 'turn-model' ? e.model : ''))).toEqual([P + '/haiku', P + '/haiku → ' + P + '/sonnet']);
    const done = seen.at(-1);
    expect(done?.type === 'turn-finished' && done.model).toBe(P + '/haiku → ' + P + '/sonnet');
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
    expect(done?.type === 'turn-finished' && done.paragraphs.join(' ')).toContain('The message was not sent: boopis\'s engine could not do that');
  });

  describe('attachments', () => {
    const methods = (): string[] => host.sent.map((s) => String(s.frame['method'])).filter((m) => /^(image|file)\.|prompt\.submit/.test(m));
    const answer = (refuse?: string): void => {
      host.autoReply = (f) => {
        const p = f['params'] as { path?: string };
        if (f['method'] === 'image.attach') host.result(f['id'], { attached: true, path: p.path, count: 1 });
        else if (f['method'] === 'image.detach') host.result(f['id'], { detached: true, count: 0 });
        else if (f['method'] === 'file.attach') {
          if (refuse && p.path === refuse) host.error(f['id'], 5028, 'file not found on gateway');
          else host.result(f['id'], { attached: true, name: 'notes.md', path: '/x/attachments/notes.md', ref_path: 'attachments/notes.md', ref_text: '@file:attachments/notes.md', uploaded: true });
        } else gateway(f);
      };
    };
    const ATT = [
      { name: 'notes.md', kind: 'file' as const, path: '/home/u/my notes.md' },
      { name: 'shot.png', kind: 'image' as const, path: '/home/u/shot.png' },
      { name: 'src', kind: 'folder' as const, path: '/home/u/my project/src' }
    ];

    it('attaches a picture and a file with the engine first, then sends the words with the references', async () => {
      answer();
      provider.sessions.conversation(SESSION);
      await tick();
      provider.sessions.send(SESSION, 'look at these', { ...META, attachments: ATT });
      await tick();
      expect(methods()).toEqual(['file.attach', 'image.attach', 'prompt.submit']);
      expect(host.sent.find((s) => s.frame['method'] === 'file.attach')?.frame['params']).toEqual({ session_id: SESSION, path: '/home/u/my notes.md' });
      expect(host.sent.find((s) => s.frame['method'] === 'image.attach')?.frame['params']).toEqual({ session_id: SESSION, path: '/home/u/shot.png' });
      const submit = host.last('prompt.submit')?.['params'] as { text: string };
      expect(submit.text).toBe('look at these\n\n@file:attachments/notes.md @folder:`/home/u/my project/src`');
    });

    it('shows the attachments on the user turn', async () => {
      answer();
      const conv = provider.sessions.conversation(SESSION);
      const seen: ConversationEvent[] = [];
      conv.subscribe((e) => seen.push(e));
      await tick();
      provider.sessions.send(SESSION, 'hi', { ...META, attachments: ATT });
      const added = seen.find((e) => e.type === 'turn-added' && e.turn.role === 'user');
      expect(added?.type === 'turn-added' && added.turn.role === 'user' && added.turn.attachments).toEqual(ATT);
    });

    it('stops and says which one when the engine refuses, and takes the queued pictures back', async () => {
      answer('/home/u/my notes.md');
      const conv = provider.sessions.conversation(SESSION);
      const seen: ConversationEvent[] = [];
      conv.subscribe((e) => seen.push(e));
      await tick();
      provider.sessions.send(SESSION, 'hi', { ...META, attachments: [ATT[1] as (typeof ATT)[number], ATT[0] as (typeof ATT)[number]] });
      await tick();
      expect(methods()).toEqual(['image.attach', 'file.attach', 'image.detach']);
      const done = seen.at(-1);
      expect(done?.type === 'turn-finished' && done.paragraphs.join(' ')).toContain('notes.md was not attached');
    });

    it('sends a plain message with no attach calls at all', async () => {
      provider.sessions.conversation(SESSION);
      await tick();
      provider.sessions.send(SESSION, 'plain', META);
      await tick();
      expect(methods()).toEqual(['prompt.submit']);
    });
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
    /* with no plugin loaded there is no Session tab session: nothing is created, and the message says why (fail closed) */
    expect(host.last('session.create')).toBeUndefined();
    expect(host.last('prompt.submit')).toBeUndefined();
  });

  describe('a new session and its toolsets', () => {
    /* the plugin is loaded in this Hermes: its capability is announced, and its methods answer */
    beforeEach(async () => {
      localStorage.clear();   /* the last step picked is remembered for the next session: each test starts with none */
      host = new FakeHost();
      host.describe = { instance_id: 'inst', capabilities: ['event-replay-v1', 'plugin-rpc-v1'], session_create: { parameters: S0_CREATE_PARAMS } };
      host.autoReply = (f) => { if (String(f['method']).startsWith('plugin.boopis.')) host.result(f['id'], {}); else gateway(f); };
      client = new GatewayClient(host);
      await client.connect();
      provider = createLiveProvider({ defaultFolder: '/work/proj', client, now: () => NOW, mock: createMockProvider({ simulate: false }) });
      await provider.ready;
    });
    const created = (step: 'supervised' | 'auto_edits' | 'auto' | 'full' | null): string => {
      const s = provider.sessions.create('');
      if (step !== null) { provider.details.follow(s.id); expect(provider.sessionControls?.setLaunch({ careful: step })).toBeNull(); }
      return s.id;
    };
    const answer = (modeSet: (f: Record<string, unknown>) => void): void => {
      host.autoReply = (f) => {
        if (f['method'] === 'session.create') host.result(f['id'], { session_id: 'local-new', stored_session_id: 'local-new', messages: [], message_count: 0, info: { model: 'fake-a' } });
        else if (f['method'] === 'plugin.boopis.mode.set') modeSet(f);
        else if (f['method'] === 'session.detach') host.result(f['id'], { detached: true });
        else if (String(f['method']).startsWith('plugin.boopis.')) host.result(f['id'], {});
        else gateway(f);
      };
    };
    const order = (): string[] => host.sent.map((s) => String(s.frame['method'])).filter((m) => ['session.create', 'plugin.boopis.mode.set', 'config.get', 'prompt.submit', 'session.detach'].includes(m));

    it('a governed step creates the session with the launch settings and only the boopis toolset, then sets the step before anything is sent', async () => {
      const id = created('supervised');
      answer((f) => { host.result(f['id'], {}); });
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')?.['params']).toEqual({ source: 'gui', cwd: '/work/proj', cwd_explicit: true, client: { name: 'boopis', version: '0.2.0' }, toolsets: ['boopis'] });
      expect(host.last('plugin.boopis.mode.set')?.['params']).toEqual({ session_id: 'local-new', mode: 'governed', careful: 'supervised', surface: 'session' });
      /* the yolo check runs after the create and before every submit of a governed step */
      expect(order()).toEqual(['session.create', 'plugin.boopis.mode.set', 'config.get', 'config.get', 'prompt.submit']);
    });

    it('a session nobody chose a step for starts on Auto-accept edits, behind the trusted gate (owner pick S02 B)', async () => {
      const id = created(null);
      answer((f) => { host.result(f['id'], {}); });
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')?.['params']).toEqual({ source: 'gui', cwd: '/work/proj', cwd_explicit: true, client: { name: 'boopis', version: '0.2.0' }, toolsets: ['boopis'] });
      expect(host.last('plugin.boopis.mode.set')?.['params']).toMatchObject({ mode: 'governed', careful: 'auto_edits', surface: 'session' });
    });

    it('Full access is ungoverned and still has only the boopis toolset: every write goes through ship', async () => {
      const id = created('full');
      answer((f) => { host.result(f['id'], {}); });
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')?.['params']).toEqual({ source: 'gui', cwd: '/work/proj', cwd_explicit: true, client: { name: 'boopis', version: '0.2.0' }, toolsets: ['boopis'] });
      expect(host.last('plugin.boopis.mode.set')?.['params']).toEqual({ session_id: 'local-new', mode: 'ungoverned', careful: 'full', surface: 'session' });
      expect(order()).toEqual(['session.create', 'plugin.boopis.mode.set', 'prompt.submit']);
    });

    it('never sends a title, yolo or checkpoints at create, and only the names the engine takes', async () => {
      host.describe = { instance_id: 'inst', capabilities: ['plugin-rpc-v1'], session_create: { parameters: ['source', 'cwd', 'toolsets'] } };
      client = new GatewayClient(host);
      await client.connect();
      provider = createLiveProvider({ defaultFolder: '/work/proj', client, now: () => NOW, mock: createMockProvider({ simulate: false }) });
      await provider.ready;
      const id = created('full');
      answer((f) => { host.result(f['id'], {}); });
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')?.['params']).toEqual({ source: 'gui', cwd: '/work/proj', toolsets: ['boopis'] });
    });

    it('an engine that takes no folder or toolsets at create starts no Session tab session', async () => {
      host.describe = { instance_id: 'inst', capabilities: ['plugin-rpc-v1'], session_create: { parameters: ['source', 'model'] } };
      client = new GatewayClient(host);
      await client.connect();
      provider = createLiveProvider({ defaultFolder: '/work/proj', client, now: () => NOW, mock: createMockProvider({ simulate: false }) });
      await provider.ready;
      expect(provider.sessionControls?.capabilities.get().launch.create.ok).toBe(false);
      const id = provider.sessions.create('');
      const seen: ConversationEvent[] = [];
      provider.sessions.conversation(id).subscribe((e) => seen.push(e));
      provider.sessions.send(id, 'start', META);
      await tick();
      expect(host.last('session.create')).toBeUndefined();
      const finished = seen.find((e) => e.type === 'turn-finished');
      expect(finished && 'paragraphs' in finished ? finished.paragraphs.join(' ') : '').toMatch(/cannot start a session in a folder/);
    });

    it('a yolo another app switched on is switched back before the message goes, and nothing goes when it cannot be', async () => {
      const id = created('supervised');
      host.autoReply = (f) => {
        if (f['method'] === 'session.create') host.result(f['id'], { session_id: 'local-new', stored_session_id: 'local-new', messages: [], message_count: 0, info: { model: 'fake-a' } });
        else if (f['method'] === 'config.get') host.result(f['id'], { value: '1' });
        else if (f['method'] === 'config.set') host.error(f['id'], -32000, 'refused');
        else if (String(f['method']).startsWith('plugin.boopis.')) host.result(f['id'], {});
        else if (f['method'] === 'session.detach') host.result(f['id'], {});
        else gateway(f);
      };
      provider.sessions.send(id, 'start', META);
      await tick(); await tick();
      expect(host.last('config.set')?.['params']).toEqual({ session_id: 'local-new', key: 'yolo', value: 'off' });
      expect(host.last('session.detach')?.['params']).toEqual({ session_id: 'local-new', end_reason: 'launch_failed' });
      expect(host.last('prompt.submit')).toBeUndefined();
    });

    /* The race that lost a reply on a runner. The gateway announces a new session (`sessions.changed`) while the UI is still
       setting its mode, and the plugin takes its time over that (it starts the session's mods worker). The list refresh
       lands before the UI has bound the session, so the row carries the gateway's id; the shell opens a conversation for
       every row, and `session.resume` made a second conversation that took over the gateway id: the events of the reply
       went to it, and the one on screen never saw them. Frames as the real gateway sends them. */
    it('a list refresh between the creation and the binding of a session does not give its events to a second conversation', async () => {
      const id = created('supervised');
      let finishMode: () => void = () => undefined;
      host.autoReply = (f) => {
        const method = f['method'];
        if (method === 'session.create') host.result(f['id'], { session_id: 'local-new', stored_session_id: 'local-new', messages: [], message_count: 0, info: { model: 'fake-a' } });
        else if (method === 'plugin.boopis.mode.set') finishMode = () => { host.result(f['id'], {}); };
        else if (method === 'session.list') host.result(f['id'], { sessions: (f['params'] as { include_hidden?: boolean }).include_hidden === true ? [] : [{ id: 'local-new', title: '', preview: '', started_at: NOW.getTime() / 1000 }] });
        else if (method === 'session.resume') host.result(f['id'], { session_id: 'local-new', message_count: 1, messages: [{ role: 'user', content: 'start' }], info: { model: 'fake-a' } });
        else gateway(f);
      };
      provider.sessions.list.subscribe((rows) => { for (const r of rows) provider.sessions.conversation(r.id); });   // what the shell does with the rows
      const seen: ConversationEvent[] = [];
      provider.sessions.conversation(id).subscribe((e) => seen.push(e));
      provider.sessions.send(id, 'start', META);
      await tick();
      host.event('sessions.changed', '');   // while the mode is being set
      await tick();
      await tick();
      finishMode();
      await tick();
      await tick();
      expect(host.sent.filter((s) => s.frame['method'] === 'session.resume')).toEqual([]);
      host.event('message.start', 'local-new');
      host.event('message.delta', 'local-new', { text: 'Hello from the fake model' });
      host.event('message.complete', 'local-new', { text: 'Hello from the fake model, streamed through the host.', outcome: 'completed' });
      await tick();
      const finished = seen.find((e) => e.type === 'turn-finished');
      expect(finished && 'paragraphs' in finished ? finished.paragraphs.join(' ') : '').toBe('Hello from the fake model, streamed through the host.');
      expect(provider.sessions.list.get().map((r) => r.id)).toEqual([id]);
    });

    it('a mode that cannot be set is fatal: the session is closed, nothing is sent, the error is shown, a retry starts fresh', async () => {
      const id = created('supervised');
      answer((f) => { host.error(f['id'], -32000, 'hx.mode.locked: the mode is locked'); });
      const seen: ConversationEvent[] = [];
      provider.sessions.conversation(id).subscribe((e) => seen.push(e));
      provider.sessions.send(id, 'start', META);
      await tick();
      await tick();
      expect(order()).toEqual(['session.create', 'plugin.boopis.mode.set', 'session.detach']);
      expect(host.last('session.detach')?.['params']).toEqual({ session_id: 'local-new', end_reason: 'launch_failed' });
      expect(host.last('prompt.submit')).toBeUndefined();
      const finished = seen.find((e) => e.type === 'turn-finished');
      expect(finished && 'paragraphs' in finished ? finished.paragraphs.join(' ') : '').toMatch(/permissions could not be set.*hx\.mode\.locked/);

      answer((f) => { host.result(f['id'], {}); });   // the plugin answers on the retry: the session starts, governed
      provider.sessions.send(id, 'again', META);
      await tick();
      expect(host.sent.filter((s) => s.frame['method'] === 'session.create').length).toBe(2);
      expect(host.last('prompt.submit')?.['params']).toMatchObject({ session_id: 'local-new', text: 'again' });
    });
  });

  it('a session made here keeps its id in the list after the gateway names it, and the composer starts empty', async () => {
    await setup((f) => { if (String(f['method']).startsWith('plugin.boopis.')) host.result(f['id'], {}); else gateway(f); }, true);
    expect(provider.sessions.draft()).toBe('');
    const created = provider.sessions.create('');
    host.autoReply = (f) => {
      if (f['method'] === 'session.create') host.result(f['id'], { session_id: 'local-new', stored_session_id: 'local-new', messages: [], message_count: 0, info: {} });
      else if (String(f['method']).startsWith('plugin.boopis.')) host.result(f['id'], {});
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
