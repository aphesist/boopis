/* The live sources end to end over recorded frames: the real gateway's and plugin's answers, played back to the
   provider through the replay host. No mock content may reach a panel. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationEvent, WaitsEvent } from '../../data';
import { GatewayClient } from '../gateway';
import { createLiveProvider } from '../live-provider';
import type { LiveProvider } from '../live-provider';
import { ReplayHost } from '../replay';
import { eventsOf, fixtures, resultOf } from '../testing';
import type { RecordedFrame } from '../replay';

const SID = (resultOf<{ sessions: { id: string; message_count: number }[] }>(fixtures.session, 'session.list').sessions.find((s) => s.message_count > 0) as { id: string }).id;
const TRIPS = resultOf<{ round_trips: number }>(fixtures.session, 'plugin.boopis.ledger.stats').round_trips;
const NOW = new Date(2026, 10, 19, 1, 0, 0);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let host: ReplayHost;
let provider: LiveProvider;
async function open(frames: readonly RecordedFrame[]): Promise<void> {
  host = new ReplayHost(frames);
  const client = new GatewayClient(host);
  await client.connect();
  provider = createLiveProvider({ client, now: () => NOW });
  await provider.ready;
}
const count = (method: string): number => host.requests.filter((r) => r.method === method).length;

describe('the details panels follow a session and show only what Hermes and the plugin said', () => {
  beforeEach(async () => { await open(fixtures.session); });

  it('learns what this Hermes cannot do, and says why', () => {
    expect(provider.info.live).toBe(true);
    expect(provider.info.unavailable['sessions.fork']).toMatch(/cannot fork a session/);
    expect(provider.info.unavailable['sessions.compact']).toMatch(/cannot compact on request/);
    expect([...provider.info.preview]).toEqual(['feedforward']);
  });

  it('fills every panel from the gateway and the plugin', async () => {
    provider.sessions.conversation(SID);
    provider.details.follow(SID);
    await tick(); await provider.settled();
    const d = provider.details;
    expect(d.context.get()).toMatchObject({ total: 200000, parts: [['System prompt', 1685], ['Tool definitions', 1727], ['Rules', 423], ['Conversation', 886]] });
    expect(d.todos.get()).toEqual([['read the call sites', 'done'], ['round once per invoice', 'doing'], ['add a property test', 'todo']]);
    expect(d.changes.get()).toEqual([['src/a.py', 1, 1]]);
    expect(provider.sessions.diff(SID, { blank: null })[0]?.hunks[0]?.[1]).toContain('+    return 2');
    expect(d.connectors.get()[0]).toMatchObject({ name: 'fakemcp' });
    expect(d.environment.get()).toMatchObject({ cwd: '/work/proj', branch: 'master', harness: 'boopis 0.1.0' });
    expect(d.governance.get()).toMatchObject({ governed: false, locked: true, cap: '$2.00', model: 'custom:main/fake-a' });
    expect(d.governance.get().ladder.map((l) => l[0])).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(d.ledger.get()).toMatchObject({ trips: TRIPS, escalations: 0 });
    expect(d.models.get()).toEqual(['custom:main/fake-a']);
    expect(d.can.get()).toEqual({ compact: false, connectors: false, signIn: false });
    expect(d.notes.get().environment).toMatch(/fork, compact/);
    expect(JSON.stringify([d.context.get(), d.environment.get(), d.output.get()])).not.toMatch(/billing|proration|enzo/i);
  });

  it('answers a refused control with the reason, and never pretends', async () => {
    provider.details.follow(SID);
    await tick(); await provider.settled();
    expect(provider.details.setGovernance({ governed: true })).toMatch(/fixed once the first message/);
    expect(provider.details.setGovernance({ model: 'custom:main/fake-b' })).toBeNull();   /* a pick is applied when the message goes out */
    expect(provider.details.setGovernance({ smart: true })).toBeNull();                    /* the ladder is known: Smart has tiers to choose from */
    expect(provider.details.governance.get().smart).toBe(true);
    expect(provider.details.setGovernance({ cap: '$1.00' })).toMatch(/cost_cap_usd/);
    expect(provider.details.governance.get().governed).toBe(false);
  });

  it('streams a turn into the output, the tasks, the run and the changes, then reads the plugin again', async () => {
    provider.sessions.conversation(SID);
    provider.details.follow(SID);
    await tick(); await provider.settled();
    const diffReads = count('plugin.boopis.checkpoint.diff');
    provider.sessions.send(SID, 'round once per invoice', { governed: false, smart: false, model: '', assume: [] });
    await tick();
    expect(provider.run.current.get().title).toBe('round once per invoice');
    await provider.settled();
    expect(provider.details.output.get().some((l) => l.startsWith('$ ship src/a.py'))).toBe(true);
    expect(provider.details.output.get().some((l) => /PASS {2}shipped/.test(l))).toBe(true);
    expect(provider.details.todos.get()).toHaveLength(3);
    expect(provider.run.current.get()).toMatchObject({ step: 3, stopped: false, trips: TRIPS });
    expect(count('plugin.boopis.checkpoint.diff')).toBeGreaterThan(diffReads);
  });
});

describe('a cost the plugin could not price is unknown', () => {
  it('shows "unknown" with the reason, and a run with no cost', async () => {
    await open(fixtures.unpriced);
    const id = (resultOf<{ sessions: { id: string }[] }>(fixtures.unpriced, 'session.list').sessions[0] as { id: string }).id;
    provider.details.follow(id);
    await tick(); await provider.settled();
    expect(provider.details.ledger.get().cost).toBe('unknown');
    expect(provider.details.governance.get().spent).toBe('');
    expect(provider.details.notes.get().governance).toMatch(/cost: unknown — no price for custom\/fake-a/);
    expect(provider.run.current.get()).toMatchObject({ cost: null, cap: null });
  });
});

describe('blanks', () => {
  beforeEach(async () => { await open(fixtures.session); });
  const blankId = (eventsOf(fixtures.session, 'plugin.boopis.blank.opened')[0]?.payload as { blank_id: string }).blank_id;

  it('opens as a wait and in the conversation, and is answered through blank.fill', async () => {
    const conv = provider.sessions.conversation(SID);
    const seen: ConversationEvent[] = [], waits: WaitsEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    provider.waits.subscribe((e) => waits.push(e));
    provider.details.follow(SID);
    await tick(); await provider.settled();
    provider.sessions.send(SID, 'keep going', { governed: false, smart: false, model: '', assume: [] });
    await tick(); await provider.settled();

    const added = waits.find((w): w is Extract<WaitsEvent, { type: 'added' }> => w.type === 'added' && w.wait.id === blankId);
    expect(added?.wait).toMatchObject({ kind: 'blank', title: 'Keep the old alias?', data: { options: ['yes', 'no'], id: blankId } });
    const opened = seen.find((e) => e.type === 'blank-opened');
    expect(opened).toMatchObject({ type: 'blank-opened', blank: { question: 'Keep the old alias?' } });
    expect(provider.waits.snapshot().some((w) => w.id === blankId)).toBe(true);

    provider.waits.resolve(blankId, 'yes, for one release');
    await tick(); await provider.settled();
    const fill = host.requests.find((r) => r.method === 'plugin.boopis.blank.fill');
    expect(fill?.params).toEqual({ session_id: SID, blank_id: blankId, answer: 'yes, for one release' });
    expect(seen.some((e) => e.type === 'blank-answered' && e.answer === 'yes, for one release')).toBe(true);
    expect(waits.some((w) => w.type === 'resolved' && w.id === blankId)).toBe(true);
    expect(provider.waits.snapshot().some((w) => w.id === blankId)).toBe(false);
    /* the plugin could not hand the answer to the model (delivered: false), so it goes as the user's own message */
    expect(count('prompt.submit')).toBe(2);
  });

  it('is rebuilt from the ledger for a session resumed after a restart', async () => {
    const conv = provider.sessions.conversation(SID);
    const seen: ConversationEvent[] = [];
    conv.subscribe((e) => seen.push(e));
    await tick(); await provider.settled();
    expect(provider.waits.snapshot().map((w) => w.kind)).toEqual(['blank']); // the ledger says one blank was opened and not yet answered
    expect(seen.some((e) => e.type === 'blank-opened')).toBe(true);
  });
});

describe('reconnect and replay', () => {
  beforeEach(async () => { await open(fixtures.session); });

  it('reads the plugin, the MCP servers and the session list again when the link comes back', async () => {
    provider.sessions.conversation(SID);
    provider.details.follow(SID);
    await tick(); await provider.settled();
    const before = { stats: count('plugin.boopis.ledger.stats'), mcp: count('mcp.servers.status'), list: count('session.list') };
    host.emitState('degraded');
    host.emitState('ready', true);
    await tick(); await provider.settled();
    expect(count('plugin.boopis.ledger.stats')).toBeGreaterThan(before.stats);
    expect(count('mcp.servers.status')).toBeGreaterThan(before.mcp);
    expect(count('session.list')).toBeGreaterThan(before.list);
  });

  it('reloads the transcript and the details of a session whose events were lost', async () => {
    provider.sessions.conversation(SID);
    provider.details.follow(SID);
    await tick(); await provider.settled();
    const resumes = count('session.resume'), infos = count('session.info');
    host.emitEvent('connection.replay_gap', '', { session_id: SID });
    await tick(); await provider.settled();
    expect(count('session.resume')).toBeGreaterThan(resumes);
    expect(count('session.info')).toBeGreaterThan(infos);
  });
});

describe('files, fork and what stays a preview', () => {
  beforeEach(async () => { await open(fixtures.session); });

  it('completes a mention through complete.path, and is honest when there is nothing or no session', async () => {
    provider.sessions.conversation(SID);
    provider.details.follow(SID);
    await tick(); await provider.settled();
    expect(await provider.files.complete('@file:src/', SID)).toEqual({ items: [{ text: '@file:src/a.py', display: 'a.py', meta: '' }] });
    expect(host.requests.find((r) => r.method === 'complete.path')?.params).toMatchObject({ session_id: SID, cwd: '/work/proj', word: '@file:src/' });
    expect((await provider.files.complete('@file:', 'new-s1')).unavailable).toMatch(/started session/);
  });

  it('does not fork on a Hermes without session.branch', () => {
    expect(provider.sessions.fork(SID)).toBeNull();
    expect(count('session.branch')).toBe(1); // the probe only
  });

  it('keeps the feedforward reading off unless the preview flag is on, and hears nothing', () => {
    expect(provider.feedforward.catalog()).toEqual([]);
    expect(provider.dictation.start({ botId: null }, () => { throw new Error('nothing was heard'); })).toBeTypeOf('function');
    expect(provider.user.get().name).not.toBe('enzo');
  });
});

describe('the Connectors section\'s controls over the host', () => {
  it('stay disabled with no host, and with one switch a server and sign in through it, then read Hermes\'s status again', async () => {
    await open(fixtures.session);
    expect(provider.details.can.get()).toMatchObject({ connectors: false, signIn: false });

    const calls: string[] = [];
    host = new ReplayHost(fixtures.session);
    const client = new GatewayClient(host);
    await client.connect();
    provider = createLiveProvider({ client, now: () => NOW, connectors: { setEnabled: (n, on) => { calls.push(`enable:${n}:${String(on)}`); return Promise.resolve(); }, signin: (n) => { calls.push('signin:' + n); return Promise.resolve({}); } } });
    await provider.ready;
    provider.details.follow(SID);
    await tick(); await provider.settled();
    expect(provider.details.can.get()).toMatchObject({ connectors: true, signIn: true });
    const before = count('mcp.servers.status');
    provider.details.setConnector('fakemcp', false);
    await tick(); await provider.settled();
    await provider.details.signIn('fakemcp');
    expect(calls).toEqual(['enable:fakemcp:false', 'signin:fakemcp']);
    expect(count('mcp.servers.status'), 'the state is asked again after each change').toBeGreaterThanOrEqual(before + 2);
  });

  it('say nothing was switched when the host refuses, and ask Hermes again so the switch shows the truth', async () => {
    host = new ReplayHost(fixtures.session);
    const client = new GatewayClient(host);
    await client.connect();
    provider = createLiveProvider({ client, now: () => NOW, connectors: { setEnabled: () => Promise.reject(new Error('refused')), signin: () => Promise.reject(new Error('refused')) } });
    await provider.ready;
    provider.details.follow(SID);
    await tick(); await provider.settled();
    const before = count('mcp.servers.status');
    provider.details.setConnector('fakemcp', false);
    await tick(); await provider.settled();
    expect(count('mcp.servers.status')).toBeGreaterThan(before);
    await expect(provider.details.signIn('fakemcp')).rejects.toThrow('refused');
  });
});
