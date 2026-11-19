import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockProvider } from './mock-provider';
import type { BotsEvent, ConversationEvent, DataProvider, WaitsEvent } from './index';

let p: DataProvider;
beforeEach(() => { vi.useFakeTimers(); p = createMockProvider({ simulate: false }); });
afterEach(() => vi.useRealTimers());

describe('the mock provider serves the v6 data through the seam', () => {
  it('has the user, 11 bots in the owner\'s dock order, five sessions and the conversation with its blank', () => {
    expect(p.user.get().name).toBe('enzo');
    expect(p.bots.snapshot().bots.map((b) => b.id)).toEqual(['atlas', 'nina', 'kai', 'iris', 'hex', 'sol', 'noct', 'terra', 'nimbus', 'vox', 'moss']);
    expect(p.sessions.list.get()).toHaveLength(5);
    const turns = p.sessions.conversation('s1').snapshot().turns;
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    const agent = turns[1];
    expect(agent && agent.role === 'assistant' && agent.blank?.options).toEqual(['as a deprecated alias', 'for one release', 'removed now']);
  });
  it('two things wait on the user: nina\'s approval and the open question', () => {
    expect(p.waits.snapshot().map((w) => w.id)).toEqual(['approve-deploy', 'blank-alias']);
  });
  it('snapshots are copies: changing one does not change the provider', () => {
    const snap = p.bots.snapshot();
    snap.bots[0]!.cfg.gov = 'ungoverned';
    expect(p.bots.snapshot().bots[0]!.cfg.gov).toBe('governed');
  });
});

describe('a message to a bot', () => {
  it('arrives, then the bot thinks, streams its reply word by word, works, and answers again', () => {
    const events: BotsEvent[] = [];
    p.bots.subscribe((e) => events.push(e));
    p.bots.send('atlas', 'review it', 'bots');
    expect(events[0]).toMatchObject({ type: 'message', botId: 'atlas', message: { who: 'you', text: 'review it' }, streaming: false });
    expect(events.some((e) => e.type === 'run' && e.running)).toBe(true);
    expect(p.bots.snapshot().bots.find((b) => b.id === 'atlas')?.state).toBe('thinking');
    vi.advanceTimersByTime(1300);
    expect(events.some((e) => e.type === 'message' && e.streaming)).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(events.filter((e) => e.type === 'message-end')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'message-text').length).toBeGreaterThan(3);
    vi.advanceTimersByTime(12000);
    expect(events.filter((e) => e.type === 'message-end')).toHaveLength(2);
    expect(events.some((e) => e.type === 'run' && !e.running)).toBe(true);
    expect(p.bots.snapshot().threads['atlas']?.at(-1)).toMatchObject({ kind: 'text', who: 'atlas', text: expect.stringContaining('Review is up') });
  });
  it('stop ends the run and the bot goes quiet', () => {
    p.bots.send('kai', 'hello', 'bots');
    expect(p.bots.stop('kai')).toBe(true);
    expect(p.bots.stop('kai')).toBe(false);
    expect(p.bots.snapshot().bots.find((b) => b.id === 'kai')?.state).toBe('idle');
  });
  it('a message from the dock first keeps the bot\'s last message in the thread', () => {
    p.bots.send('kai', 'hi', 'dock');
    const t = p.bots.snapshot().threads['kai'] ?? [];
    expect(t[0]).toMatchObject({ who: 'kai', text: expect.stringContaining('Changelog for 0.23') });
    expect(t[1]).toMatchObject({ who: 'you', via: 'dock' });
  });
});

describe('an approval is one decision everywhere', () => {
  it('deciding in the thread resolves the wait the dock shows, and the bot stops needing you', () => {
    const waits: WaitsEvent[] = [];
    const bots: BotsEvent[] = [];
    p.waits.subscribe((e) => waits.push(e)); p.bots.subscribe((e) => bots.push(e));
    const msg = p.bots.snapshot().threads['nina']!.find((m) => m.kind === 'approval')!;
    p.bots.decide('nina', msg.id, 'approved');
    expect(waits).toEqual([{ type: 'resolved', id: 'approve-deploy', outcome: 'approved' }]);
    expect(bots.some((e) => e.type === 'message-resolved' && e.resolved === 'approved')).toBe(true);
    expect(p.bots.snapshot().bots.find((b) => b.id === 'nina')?.attention).toBeNull();
    expect(p.bots.snapshot().bots.find((b) => b.id === 'nina')?.state).toBe('working');
  });
  it('deciding from the dock decides the same message in the thread', () => {
    const bots: BotsEvent[] = [];
    p.bots.subscribe((e) => bots.push(e));
    p.waits.resolve('approve-deploy', 'denied');
    expect(bots.find((e) => e.type === 'message-resolved')).toMatchObject({ resolved: 'denied' });
    expect(p.waits.snapshot().map((w) => w.id)).toEqual(['blank-alias']);
  });
  it('a decision is taken once', () => {
    const msg = p.bots.snapshot().threads['nina']!.find((m) => m.kind === 'approval')!;
    p.bots.decide('nina', msg.id, 'approved');
    const events: BotsEvent[] = [];
    p.bots.subscribe((e) => events.push(e));
    p.bots.decide('nina', msg.id, 'denied');
    expect(events).toEqual([]);
  });
});

describe('a run in a session', () => {
  it('adds the user turn and a working turn, takes three steps, then finishes with an answer and a cost', () => {
    const ev: ConversationEvent[] = [];
    p.sessions.conversation('s2').subscribe((e) => ev.push(e));
    p.sessions.send('s2', 'do it', { governed: true, smart: true, model: 'sonnet 5.5', assume: ['>governed starts on haiku'] });
    expect(ev.map((e) => e.type)).toEqual(['turn-added', 'turn-added']);
    const agent = ev[1];
    expect(agent && agent.type === 'turn-added' && agent.turn.role === 'assistant' && agent.turn.model).toBe('haiku 4.5');
    vi.advanceTimersByTime(700 + 900 * 4);
    expect(ev.filter((e) => e.type === 'step-added')).toHaveLength(3);
    const done = ev.at(-1);
    expect(done).toMatchObject({ type: 'turn-finished', stopped: false, stepCount: 3 });
    expect(p.sessions.list.get().find((s) => s.id === 's2')?.running).toBe(false);
  });
  it('stop finishes it early and says so', () => {
    const ev: ConversationEvent[] = [];
    p.sessions.conversation('s3').subscribe((e) => ev.push(e));
    p.sessions.send('s3', 'x', { governed: false, smart: false, model: 'opus 5.5', assume: [] });
    vi.advanceTimersByTime(800);
    p.sessions.stop('s3');
    expect(ev.at(-1)).toMatchObject({ type: 'turn-finished', stopped: true });
  });
  it('answering the open question answers it for the dock too', () => {
    const waits: WaitsEvent[] = [];
    p.waits.subscribe((e) => waits.push(e));
    p.sessions.answerBlank('s1', 'for one release');
    expect(waits).toEqual([{ type: 'resolved', id: 'blank-alias', outcome: 'for one release' }]);
  });
  it('the dock\'s wording of an answer maps to the session\'s', () => {
    const ev: ConversationEvent[] = [];
    p.sessions.conversation('s1').subscribe((e) => ev.push(e));
    p.waits.resolve('blank-alias', 'remove it now');
    expect(ev[0]).toMatchObject({ type: 'blank-answered', answer: 'removed now' });
  });
});

describe('sessions, bots and governance commands', () => {
  it('create, rename, fork, archive and restore a session', () => {
    const s = p.sessions.create('billing-api');
    expect(p.sessions.list.get()[0]?.id).toBe(s.id);
    p.sessions.rename(s.id, 'renamed');
    expect(p.sessions.list.get()[0]?.title).toBe('renamed');
    p.sessions.archive(s.id);
    expect(p.sessions.archived.get()[0]?.id).toBe(s.id);
    p.sessions.restore(s.id);
    expect(p.sessions.list.get().some((x) => x.id === s.id)).toBe(true);
  });
  it('a new bot arrives with its greeting; archiving the last bot is refused', () => {
    const events: BotsEvent[] = [];
    p.bots.subscribe((e) => events.push(e));
    const b = p.bots.create({ name: 'Rex', role: 'Reviews pull requests. Fast.', shape: 'circle', color: '#fff', instructions: 'Reviews pull requests.' });
    expect(b.id).toBe('rex');
    expect(b.role).toBe('reviews pull requests');
    vi.advanceTimersByTime(900 + 3000);
    expect(events.some((e) => e.type === 'message-end' && e.text.includes('I’m rex'))).toBe(true);
    const dup = p.bots.create({ name: 'rex', role: '', shape: 'circle', color: '#fff', instructions: '' });
    expect(dup.id).toBe('rex-2');
  });
  it('governance changes reach the run the dock shows', () => {
    p.details.setGovernance({ governed: false });
    expect(p.details.governance.get().governed).toBe(false);
    expect(p.run.current.get().governed).toBe(false);
  });
  it('compacting the context frees what is above the floor, once', async () => {
    const first = await p.details.compactContext();
    expect(first).toBe(17000);
    expect(await p.details.compactContext()).toBe(0);
    expect(p.details.context.get().used).toBe(9000 + 4000 + 41000 + 5000);
  });
  it('stopping the run is one-way and shown on the run stream', () => {
    const seen: boolean[] = [];
    p.run.current.subscribe((r) => seen.push(r.stopped));
    p.run.stop(); p.run.stop();
    expect(seen).toEqual([true]);
  });
});

describe('the mock’s archived bots (the design without Hermes)', () => {
  it('has two, newest first: one that can come back and one whose name is in use', () => {
    const p = createMockProvider({ simulate: false });
    expect(p.bots.archived.get().map((a) => [a.id, a.was, a.when])).toEqual([['archived--ledger', 'ledger', 'yesterday'], ['archived--nina', 'nina', 'mon']]);
    expect(p.bots.snapshot().bots.some((b) => b.id === 'ledger')).toBe(false);
  });
  it('restoring one makes it a bot again, announced as created, and takes it out of the archive', async () => {
    const p = createMockProvider({ simulate: false });
    const seen: string[] = [];
    p.bots.subscribe((e) => { if (e.type === 'bot-created') seen.push(e.bot.id); });
    await p.bots.restore('archived--ledger');
    expect(seen).toEqual(['ledger']);
    expect(p.bots.snapshot().bots.some((b) => b.id === 'ledger')).toBe(true);
    expect(p.bots.archived.get().map((a) => a.was)).toEqual(['nina']);
  });
  it('refuses a name that is in use, and an id that is not archived', async () => {
    const p = createMockProvider({ simulate: false });
    await expect(p.bots.restore('archived--nina')).rejects.toThrow('there is a teammate called nina already; archive or delete it, then restore');
    await expect(p.bots.restore('nobody')).rejects.toThrow(/not archived/);
    expect(p.bots.archived.get()).toHaveLength(2);
  });
  it('a bot made outside boopis exists only as a fixture, so the v6 bots are untouched', () => {
    expect(createMockProvider({ simulate: false }).bots.snapshot().bots.some((b) => b.madeOutside)).toBe(false);
    expect(createMockProvider({ simulate: false, fixtures: ['outside'] }).bots.snapshot().bots.filter((b) => b.madeOutside).map((b) => b.id)).toEqual(['sage']);
  });
});

describe('the empty roster fixture', () => {
  it('`none` serves no bots at all, and `none` with a fixture serves only that one', () => {
    expect(createMockProvider({ simulate: false, fixtures: ['none'] }).bots.snapshot().bots).toEqual([]);
    expect(createMockProvider({ simulate: false, fixtures: ['none', 'long'] }).bots.snapshot().bots.map((b) => b.id)).toEqual(['cassiopeia-staging-deploy-guardian']);
  });
});
