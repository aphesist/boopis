/* The live data provider: the Hermes gateway (through the host's proxy) behind the same `DataProvider` interfaces the
   mock provider implements. Wired end to end today: the session list, the conversation stream (`message.delta` and
   `message.complete`, `tool.start` and `tool.complete`), sending, stopping, and approvals (`approval.request` and
   `approval.respond`, as the dock's waits). Everything else (details, bots, run, schedules, feedforward, dictation, files, user)
   is served by the MOCK provider, on purpose and listed in MOCK_SOURCES, behind `VITE_DATA_PROVIDER=live`: nothing
   falls back to the mock when the gateway fails (the failure is shown), and a mock source is never mistaken for live. */
import { logger } from '../core/log';
import { createMockProvider } from '../data/mock-provider';
import type { DataProvider, SessionsSource, WaitsEvent, WaitsSource } from '../data/provider';
import { emitter, feed, store } from '../data/store';
import type { AgentTurn, ConversationEvent, DiffFile, SendMeta, SessionSummary, Turn, UserTurn, Wait, WaitOutcome } from '../data/types';
import type { GatewayClient, GatewayEvent } from './gateway';
import { approvalToWait, choiceFor, clock, elapsed, failedStep, paragraphs, reduceLedger, sessionRowToSummary, toolStep, transcriptToTurns } from './map';
import type { LedgerTotals } from './map';

const log = logger('live');

/** the sources served by the mock provider while the live one is a skeleton */
export const MOCK_SOURCES = ['user', 'details', 'bots', 'run', 'schedules', 'feedforward', 'dictation', 'files', 'sessions.diff', 'sessions.fork', 'sessions.answerBlank', 'sessions.openPullRequest'] as const;

export interface LiveOptions {
  client: GatewayClient;
  now?: () => Date;
  /** the provider whose sources stay mock; created when omitted */
  mock?: DataProvider;
}

interface Running { turn: AgentTurn; text: string; steps: AgentTurn['steps'][number][]; startedAt: number }
interface Convo {
  uiId: string;
  /** the gateway's id for the session once it is live there */
  gwId: string | null;
  turns: Turn[];
  events: ReturnType<typeof emitter<ConversationEvent>>;
  hydrated: boolean;
  model: string;
  running: Running | null;
}

export interface LiveProvider extends DataProvider {
  /** ledger totals from `plugin.hypotaxis.ledger.appended`; not yet wired into `details.ledger` (mock) */
  ledger: { totals(): LedgerTotals; subscribe(fn: (t: LedgerTotals) => void): () => void };
}

export function createLiveProvider(opts: LiveOptions): LiveProvider {
  const { client } = opts;
  const now = opts.now ?? ((): Date => new Date());
  const mock = opts.mock ?? createMockProvider();
  let counter = 0;
  const nextId = (p: string): string => p + (++counter).toString(36);

  const list = store<readonly SessionSummary[]>([]);
  const archived = store<readonly SessionSummary[]>([]);
  const convos = new Map<string, Convo>();
  const byGw = new Map<string, string>();
  const convo = (uiId: string): Convo => {
    let c = convos.get(uiId);
    if (!c) { c = { uiId, gwId: null, turns: [], events: emitter<ConversationEvent>(), hydrated: false, model: '', running: null }; convos.set(uiId, c); }
    return c;
  };
  const bind = (c: Convo, gwId: string): void => { c.gwId = gwId; byGw.set(gwId, c.uiId); };
  const patchSession = (id: string, patch: Partial<SessionSummary>): void => list.update((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  /* ───────── the session list ───────── */
  async function refreshList(): Promise<void> {
    const [active, hidden] = await Promise.all([client.request('session.list', { limit: 100 }), client.request('session.list', { limit: 100, include_hidden: true })]);
    const t = now();
    /* a session made here keeps the id the UI knows it by, even after the gateway names it */
    const named = (r: (typeof active.sessions)[number]): SessionSummary => { const id = byGw.get(r.id) ?? r.id; return { ...sessionRowToSummary(r, t), id, running: convos.get(id)?.running != null }; };
    const rows = active.sessions.map(named);
    const known = new Set(rows.map((r) => r.id));
    const placeholders = list.get().filter((s) => s.id.startsWith('new-') && convos.get(s.id)?.gwId === null && !known.has(s.id));
    list.set([...placeholders, ...rows]);
    archived.set(hidden.sessions.filter((r) => !known.has(byGw.get(r.id) ?? r.id)).map((r) => sessionRowToSummary(r, t)));
  }

  /* ───────── a session becomes live on the gateway (created, or resumed with its transcript) ───────── */
  async function resume(c: Convo): Promise<void> {
    const res = await client.request('session.resume', { session_id: c.uiId });
    bind(c, res.session_id);
    c.model = res.info.model ?? '';
    c.turns = transcriptToTurns(res.messages, c.model, c.uiId + ':');
    c.hydrated = true;
    c.events.emit({ type: 'reset' });
  }
  async function ensureLive(c: Convo): Promise<string> {
    if (c.gwId) return c.gwId;
    if (c.hydrated) { // a session made here, not yet on the gateway
      const res = await client.request('session.create', { source: 'gui' });
      bind(c, res.session_id);
      c.model = res.info.model ?? '';
      return res.session_id;
    }
    await resume(c);
    return c.gwId ?? c.uiId;
  }

  /* ───────── events → the conversation ───────── */
  function startTurn(c: Convo): Running {
    if (c.running) return c.running;
    const turn: AgentTurn = { id: nextId('t'), role: 'assistant', model: c.model, time: '0s', cost: '', stepCount: 0, steps: [], paragraphs: [], bullets: [], status: 'running' };
    c.turns.push(turn);
    c.running = { turn, text: '', steps: [], startedAt: Date.now() };
    c.events.emit({ type: 'turn-added', turn });
    patchSession(c.uiId, { running: true, when: 'now' });
    return c.running;
  }
  function addStep(c: Convo, r: Running, step: AgentTurn['steps'][number]): void {
    r.steps.push(step);
    c.events.emit({ type: 'step-added', turnId: r.turn.id, step });
  }
  function finishTurn(c: Convo, text: string | null, stopped: boolean): void {
    const r = c.running;
    if (!r) return;
    const finalText = text ?? r.text;
    const paras = paragraphs(finalText);
    const time = elapsed(Date.now() - r.startedAt);
    const i = c.turns.indexOf(r.turn);
    const done: AgentTurn = { ...r.turn, time, stepCount: r.steps.length, steps: r.steps, paragraphs: paras, status: stopped ? 'stopped' : 'done' };
    if (i >= 0) c.turns[i] = done;
    c.running = null;
    c.events.emit({ type: 'turn-finished', turnId: r.turn.id, time, cost: '', stepCount: r.steps.length, paragraphs: paras, stopped });
    patchSession(c.uiId, { running: false });
  }

  const waitList: Wait[] = [];
  const waitsEv = emitter<WaitsEvent>();
  const approvalRoute = new Map<string, { gwSession: string; generation: number }>();

  function onEvent(ev: GatewayEvent): void {
    if (ev.type === 'sessions.changed') { refreshList().catch((e: unknown) => { log.warn('could not refresh the session list', e); }); return; }
    if (ev.type === 'plugin.hypotaxis.ledger.appended') { ledgerTotals = reduceLedger(ledgerTotals, (ev.payload ?? {}) as { type?: unknown; payload?: unknown }); for (const f of [...ledgerSubs]) f(ledgerTotals); return; }
    const uiId = ev.session_id ? byGw.get(ev.session_id) : undefined;
    if (!uiId) return; // another client's session, or global
    const c = convos.get(uiId);
    if (!c) return;
    const p = ev.payload ?? {};
    switch (ev.type) {
      case 'session.info': { const m = p['model']; if (typeof m === 'string' && m) c.model = m; const t = p['title']; if (typeof t === 'string' && t) patchSession(uiId, { title: t }); break; }
      case 'message.start': startTurn(c); break;
      case 'tool.start': addStep(c, startTurn(c), toolStep(p)); break;
      case 'tool.complete': if (p['is_error'] === true) addStep(c, startTurn(c), failedStep(p)); break;
      case 'message.delta': {
        const r = startTurn(c);
        const t = p['text'];
        if (typeof t === 'string' && t) { r.text += t; c.events.emit({ type: 'turn-text', turnId: r.turn.id, paragraphs: paragraphs(r.text) }); }
        break;
      }
      case 'message.complete': {
        const text = typeof p['text'] === 'string' ? p['text'] : null;
        const outcome = typeof p['outcome'] === 'string' ? p['outcome'] : 'completed';
        if (!c.running) startTurn(c);
        finishTurn(c, text, outcome !== 'completed');
        break;
      }
      case 'approval.request': {
        const w = approvalToWait(ev);
        if (!w || waitList.some((x) => x.id === w.id)) break;
        const gen = typeof p['execution_generation'] === 'number' ? p['execution_generation'] : 0;
        approvalRoute.set(w.id, { gwSession: ev.session_id ?? '', generation: gen });
        waitList.push(w);
        waitsEv.emit({ type: 'added', wait: w });
        break;
      }
      case 'approval.settled': {
        const id = typeof p['prompt_id'] === 'string' ? p['prompt_id'] : '';
        settle(id, 'approved'); // the gateway settled it (here or elsewhere); who decided is on the ledger
        break;
      }
      default: break;
    }
  }
  function settle(id: string, outcome: WaitOutcome): void {
    const i = waitList.findIndex((w) => w.id === id);
    if (i < 0) return;
    waitList.splice(i, 1);
    approvalRoute.delete(id);
    waitsEv.emit({ type: 'resolved', id, outcome });
  }

  /* ───────── the link ───────── */
  client.onEvent(onEvent);
  client.onState((s) => {
    if (s.phase === 'ready' && s.reconnected) refreshList().catch((e: unknown) => { log.warn('could not refresh after reconnecting', e); });
  });
  client.onEvent((ev) => {
    if (ev.type !== 'connection.replay_gap' || typeof ev.payload?.['session_id'] !== 'string') return;
    const uiId = byGw.get(ev.payload['session_id']);
    const c = uiId ? convos.get(uiId) : undefined;
    if (c) { c.running = null; resume(c).catch((e: unknown) => { log.warn('could not reload a session after lost events', e); }); }
  });
  let ledgerTotals: LedgerTotals = { tokens: 0, trips: 0 };
  const ledgerSubs = new Set<(t: LedgerTotals) => void>();

  /* ───────── the sources ───────── */
  const sessions: SessionsSource = {
    list, archived,
    draft: () => '', /* the composer starts empty: the mock's draft is invented text */
    conversation(id) {
      const c = convo(id);
      if (!c.hydrated && !c.gwId) {
        c.hydrated = true;
        if (!list.get().some((s) => s.id === id)) return feed(() => ({ turns: [...c.turns] }), c.events); // not a gateway session (the UI's placeholder): nothing to load
        resume(c).catch((e: unknown) => { c.hydrated = false; log.warn('could not load session ' + id, e); });
      }
      return feed(() => ({ turns: [...c.turns] }), c.events);
    },
    diff: (): readonly DiffFile[] => [],
    create(project) {
      const s: SessionSummary = { id: 'new-' + nextId('s'), project: project ?? '', title: 'New session', when: 'now' };
      const c = convo(s.id);
      c.hydrated = true; // empty, and not on the gateway until the first message
      list.set([s, ...list.get()]);
      return s;
    },
    rename(id, title) {
      patchSession(id, { title });
      const gw = convos.get(id)?.gwId ?? id;
      client.request('session.title', { session_id: gw, title }).catch((e: unknown) => { log.warn('could not rename', e); });
    },
    fork: () => { log.warn('forking a live session is not wired yet'); return null; },
    archive(id) {
      const s = list.get().find((x) => x.id === id);
      list.set(list.get().filter((x) => x.id !== id));
      if (s) archived.set([s, ...archived.get()]);
      client.request('session.archive', { session_id: convos.get(id)?.gwId ?? id, archived: true }).catch((e: unknown) => { log.warn('could not archive', e); });
    },
    restore(id) {
      const s = archived.get().find((x) => x.id === id);
      archived.set(archived.get().filter((x) => x.id !== id));
      if (s) list.set([...list.get(), s]);
      client.request('session.archive', { session_id: id, archived: false }).catch((e: unknown) => { log.warn('could not restore', e); });
    },
    send(id, text, meta: SendMeta) {
      void meta; // governed and Smart are the plugin's (hypotaxis-v1); the gateway call below is the plain turn
      const c = convo(id);
      const user: UserTurn = { id: nextId('t'), role: 'user', at: clock(now()), text };
      c.turns.push(user);
      c.events.emit({ type: 'turn-added', turn: user });
      ensureLive(c)
        .then((gw) => client.requestRaw('prompt.submit', { session_id: gw, text, submission_id: 'sub-' + crypto.randomUUID() })) /* the gateway requires submission_id; the vendored contract does not list it yet */
        .catch((e: unknown) => {
          log.error('the message was not accepted', e);
          startTurn(c);
          finishTurn(c, 'The message was not sent: ' + (e instanceof Error ? e.message : String(e)), true);
        });
    },
    stop(id) {
      const gw = convos.get(id)?.gwId;
      if (gw) client.request('session.interrupt', { session_id: gw }).catch((e: unknown) => { log.warn('could not stop', e); });
    },
    answerBlank: () => { log.warn('blanks come from the plugin (hypotaxis-v1) and are not wired yet'); },
    openPullRequest: () => { log.warn('pull requests are not wired yet'); }
  };

  const waits: WaitsSource = {
    ...feed(() => [...waitList], waitsEv),
    resolve(id, outcome) {
      const route = approvalRoute.get(id);
      if (!route) return;
      client.requestRaw('approval.respond', { session_id: route.gwSession, execution_generation: route.generation, prompt_id: id, choice: choiceFor(outcome) }) /* canonical shape, verified in S0; the vendored contract lags it */
        .then(() => { settle(id, outcome); })
        .catch((e: unknown) => { log.error('the approval was not delivered', e); });
    }
  };

  const ready = refreshList();
  return {
    ...mock, ready, sessions, waits,
    ledger: { totals: () => ledgerTotals, subscribe(fn) { ledgerSubs.add(fn); return () => { ledgerSubs.delete(fn); }; } }
  };
}
