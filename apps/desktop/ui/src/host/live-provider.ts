/* The live data provider: the Hermes gateway (through the host's proxy) and the boopis plugin behind the same
   `DataProvider` interfaces the mock provider implements. This file is the sessions: the list, the conversation stream,
   sending, stopping, approvals and blanks. The details panels, the run, the diff and file mentions live in `./live/`
   (`details.ts`). Only `bots`, `schedules` and the feedforward catalog are the MOCK provider's, named in MOCK_SOURCES and
   announced as previews through `info.preview`; nothing falls back to the mock when the gateway fails (the failure is
   shown), and a mock source is never mistaken for live. */
import { logger } from '../core/log';
import { createMockProvider } from '../data/mock-provider';
import type { DataProvider, SessionsSource, WaitsEvent, WaitsSource } from '../data/provider';
import { emitter, feed, store } from '../data/store';
import type { AgentTurn, BlankData, BlankWait, ConversationEvent, FormStatus, FormWait, SendMeta, SessionSummary, Turn, User, UserTurn, Wait, WaitOutcome } from '../data/types';
import { readFlag } from '../core/settings';
import { createDetails } from './live/details';
import { createLiveBots } from './live/bots';
import { todosFrom } from './live/map-details';
import { blankData } from './live/blanks';
import { createModsHost } from './live/mods';
import { chooseAnotherModel, createFormsHost, hasHostDialogs, hostCancelSignin, hostSignin, tauriPickFolder } from './live/forms';
import type { XSignin } from './live/forms';
import { tauriConnectorsBridge } from './connectors-bridge';
import type { FormEntry } from './live/forms';
import { tauriSecrets } from './secrets';
import type { SecretsBridge } from './secrets';
import type { GatewayClient, GatewayEvent } from './gateway';
import type { RpcMethods } from '../vendor/hermes-shared/gateway-contract.generated';
import { approvalToWait, choiceFor, clock, elapsed, failedStep, paragraphs, reduceLedger, sessionRowToSummary, toolStep, transcriptToTurns } from './map';
import type { LedgerTotals } from './map';

const log = logger('live');

/** the toolsets of a governed session: only the plugin's tools (docs/ARCHITECTURE.md section 4); fixed at `session.create` */
const GOVERNED_TOOLSETS = ['boopis'];

/** the sources still served by the mock provider, shown to the user as previews (`info.preview`) or empty:
 *  the feedforward catalog (the plugin's feedforward RPC is not built). Everything the Sessions section reads is live, and
 *  so are the bots and their schedules: Hermes profiles (`live/bots.ts`). `sessions.openPullRequest` stays unwired and says so. */
export const MOCK_SOURCES = ['feedforward'] as const;

export interface LiveOptions {
  client: GatewayClient;
  now?: () => Date;
  /** the provider whose sources stay mock; created when omitted */
  mock?: DataProvider;
  /** the keychain forms save secrets to (the host's, in the desktop app); without one a credential form says it cannot save */
  secrets?: SecretsBridge;
  /** the folder dialog forms use; the host's own in the desktop app */
  pickFolder?: (() => Promise<string | null>) | null;
  /** what a free-tier limit notice does with "choose another model"; the host's setup in the desktop app */
  onFreeTierChoice?: (choice: string) => Promise<void>;
  /** runs a sign-in field in the host (default in the desktop app: Hermes's OAuth for a connector, or the provider's own login command); null: none */
  signin?: ((s: XSignin) => Promise<void>) | null;
  /** the Connectors section's switch and Sign in (default in the desktop app: the host's connector commands) */
  connectors?: { setEnabled(name: string, enabled: boolean): Promise<void>; signin(name: string): Promise<unknown> };
  cancelSignin?: ((s: XSignin) => Promise<void>) | null;
  /** a teammate's own link to Hermes (the host's `connect(profile)`); without one its schedule and sessions are shown as unknown */
  linkTo?: (profile: string) => Promise<GatewayClient>;
  /** how often the teammates are read again (ms); null never (tests) */
  botsPollMs?: number | null;
}

interface Running { turn: AgentTurn; text: string; steps: AgentTurn['steps'][number][]; startedAt: number }
interface Convo {
  uiId: string;
  /** the gateway's id for the session once it is live there */
  gwId: string | null;
  /** the last `execution_generation` an event of this session carried (steering needs it) */
  generation: number;
  turns: Turn[];
  events: ReturnType<typeof emitter<ConversationEvent>>;
  hydrated: boolean;
  model: string;
  running: Running | null;
}

export interface LiveProvider extends DataProvider {
  /** ledger totals from `plugin.boopis.ledger.appended`; not yet wired into `details.ledger` (mock) */
  ledger: { totals(): LedgerTotals; subscribe(fn: (t: LedgerTotals) => void): () => void };
  /** tests: every read of the details and every refresh in flight has finished */
  settled(): Promise<void>;
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
    if (!c) { c = { uiId, gwId: null, generation: 0, turns: [], events: emitter<ConversationEvent>(), hydrated: false, model: '', running: null }; convos.set(uiId, c); }
    return c;
  };
  const bind = (c: Convo, gwId: string): void => { c.gwId = gwId; byGw.set(gwId, c.uiId); };
  const details = createDetails({ client, ...(opts.connectors ? { connectors: opts.connectors } : hasHostDialogs() ? { connectors: tauriConnectorActions() } : {}), now: () => now().getTime(), gwId: (id) => convos.get(id)?.gwId ?? (id.startsWith('new-') ? null : id), onRefreshed: (id) => { const c = convos.get(id); if (c) syncBlanks(c); } });
  /* Claude Code mods: what a session's mods draw (`mod.*` events) and the answers sent back; one `ModSession` per session */
  const modsHost = createModsHost({ client, uiOf: (gw) => byGw.get(gw), gwOf: (id) => convos.get(id)?.gwId ?? null });
  const user = store<User>({ name: 'you', initials: 'y' });
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
    void modsHost.attach(c.uiId);   /* the mods already loaded in a resumed session */
    c.model = res.info.model ?? '';
    c.turns = transcriptToTurns(res.messages, c.model, c.uiId + ':');
    c.hydrated = true;
    if (c.turns.some((t) => t.role === 'user')) details.model(c.uiId).started = true;
    details.model(c.uiId).todos = todosFromResume(res);
    c.events.emit({ type: 'reset' });
    details.onBound(c.uiId);
    void formsHost.reload(res.session_id, c.model);   /* the forms still open when the session was last seen */
  }
  async function ensureLive(c: Convo): Promise<string> {
    if (c.gwId) return c.gwId;
    if (c.hydrated) { // a session made here, not yet on the gateway
      const governed = details.governedAtCreation(c.uiId);
      /* the toolset is fixed here for good (Hermes's prompt cache): a governed session has only the boopis tools, so no
         Hermes tool the plugin would have to police ever reaches the model. The generated contract's create params do not
         list `toolsets` yet (the gateway's canonical ones do), hence the raw call. */
      const res = await client.requestRaw('session.create', { source: 'gui', ...(governed ? { toolsets: GOVERNED_TOOLSETS } : {}) }) as RpcMethods['session.create']['result'];
      const want = details.chosen(c.uiId);
      if (want.governed !== null || governed) {
        /* the mode must match the toolset, and a failure is fatal for this session: it is closed and never bound, so
           nothing is sent to it and a retry makes a fresh one. Running a session whose mode is unknown is not an option. */
        try { await client.requestRaw('plugin.boopis.mode.set', { session_id: res.session_id, mode: governed ? 'governed' : 'ungoverned' }); }
        catch (e) {
          log.error('the mode could not be set; the session was closed', e);
          await client.request('session.close', { session_id: res.session_id }).catch((closeErr: unknown) => { log.warn('the session could not be closed', closeErr); });
          throw new Error('The session was not started: its ' + (governed ? 'governed' : 'ungoverned') + ' mode could not be set (' + (e instanceof Error ? e.message : String(e)) + ').');
        }
      }
      bind(c, res.session_id);
      c.model = res.info.model ?? '';
      details.onBound(c.uiId);
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
  /** the turn a form or a blank raised in this session belongs to: the one running, else the last answer */
  const raisingTurn = (c: Convo): AgentTurn | undefined => {
    if (c.running) return c.running.turn;
    for (let i = c.turns.length - 1; i >= 0; i--) { const t = c.turns[i]; if (t && t.role === 'assistant') return t; }
    return undefined;
  };

  /* ───────── forms: the plugin's and Hermes's requests, in the conversation and in the dock, answered in either ───────── */
  const noKeychain: SecretsBridge = { set: () => Promise.reject(new Error('The keychain is only available in the desktop app.')) };
  const formsHost = createFormsHost({
    client, secrets: opts.secrets ?? (hasHostDialogs() ? tauriSecrets() : noKeychain),
    pickFolder: opts.pickFolder !== undefined ? opts.pickFolder : hasHostDialogs() ? tauriPickFolder : null,
    ...((opts.onFreeTierChoice ?? (hasHostDialogs() ? chooseAnotherModel : null)) ? { onFreeTierChoice: opts.onFreeTierChoice ?? chooseAnotherModel } : {}),
    signin: opts.signin !== undefined ? opts.signin : hasHostDialogs() ? hostSignin : null,
    cancelSignin: opts.cancelSignin !== undefined ? opts.cancelSignin : hasHostDialogs() ? hostCancelSignin : null,
    hooks: {
      opened(entry: FormEntry) {
        const uiId = byGw.get(entry.gwSession), c = uiId ? convos.get(uiId) : undefined;
        if (waitList.some((x) => x.id === entry.spec.id)) return;
        const w: FormWait = { id: entry.spec.id, kind: 'form', who: 'agent', title: entry.spec.title, data: entry.spec };
        waitList.push(w); waitsEv.emit({ type: 'added', wait: w });
        const t = c ? raisingTurn(c) : undefined;
        if (c && t) { t.forms = [...(t.forms ?? []), entry.spec]; c.events.emit({ type: 'form-opened', turnId: t.id, form: entry.spec }); }
      },
      resolved(entry: FormEntry, status: FormStatus) {
        const uiId = byGw.get(entry.gwSession), c = uiId ? convos.get(uiId) : undefined;
        const t = c?.turns.find((x): x is AgentTurn => x.role === 'assistant' && !!x.forms?.some((f) => f.id === entry.spec.id));
        if (c && t) { t.forms = (t.forms ?? []).map((f) => (f.id === entry.spec.id ? { ...f, resolved: status } : f)); c.events.emit({ type: 'form-resolved', turnId: t.id, formId: entry.spec.id, status }); }
        settle(entry.spec.id, status);
      }
    }
  });
  const approvalRoute = new Map<string, { gwSession: string; generation: number }>();

  function onEvent(ev: GatewayEvent): void {
    if (ev.type === 'sessions.changed') { refreshList().catch((e: unknown) => { log.warn('could not refresh the session list', e); }); return; }
    if (ev.type === 'plugin.boopis.ledger.appended') { ledgerTotals = reduceLedger(ledgerTotals, (ev.payload ?? {}) as { type?: unknown; payload?: unknown }); for (const f of [...ledgerSubs]) f(ledgerTotals); }
    const uiId = ev.session_id ? byGw.get(ev.session_id) : undefined;
    if (!uiId) return; // another client's session, or global
    const c = convos.get(uiId);
    if (!c) return;
    const p = ev.payload ?? {};
    if (typeof ev.execution_generation === 'number') c.generation = ev.execution_generation;
    if (modsHost.handle(uiId, ev)) return;
    details.onEvent(uiId, ev);
    if (ev.type.startsWith('plugin.boopis.blank.')) { syncBlanks(c); return; }
    if (formsHost.handle(ev, { gwSession: ev.session_id ?? '', model: c.model })) return;
    switch (ev.type) {
      case 'session.info': { const profile = p['profile_name']; if (typeof profile === 'string' && profile) user.set({ name: profile, initials: profile.slice(0, 1).toLowerCase() }); const m = p['model']; if (typeof m === 'string' && m) c.model = m; const t = p['title']; if (typeof t === 'string' && t) patchSession(uiId, { title: t }); break; }
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
        if (!modsHost.known(uiId)) void modsHost.attach(uiId);   /* mods load at a session's first prompt */
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
  /* ───────── blanks: the plugin's open questions, in the conversation and as waits ───────── */
  const blankRoute = new Map<string, string>();
  const announced = new Map<string, 'open' | 'answered'>();
  function syncBlanks(c: Convo): void {
    for (const b of details.model(c.uiId).blanks) {
      const seen = announced.get(b.id);
      const turnIdx = (): number => { const r = c.running ? c.turns.indexOf(c.running.turn) : -1; if (r >= 0) return r; for (let i = c.turns.length - 1; i >= 0; i--) if (c.turns[i]?.role === 'assistant') return i; return -1; };
      if (b.answer === null && seen === undefined) {
        announced.set(b.id, 'open');
        const data: BlankData = blankData(b);
        const w: BlankWait = { id: b.id, kind: 'blank', who: 'agent', title: data.short, data };
        blankRoute.set(b.id, c.uiId);
        waitList.push(w); waitsEv.emit({ type: 'added', wait: w });
        const i = turnIdx(), t = c.turns[i];
        if (t && t.role === 'assistant' && !t.blank) { t.blank = data; c.events.emit({ type: 'blank-opened', turnId: t.id, blank: data }); }
      } else if (b.answer !== null && seen !== 'answered') {
        announced.set(b.id, 'answered');
        if (waitList.some((w) => w.id === b.id)) settle(b.id, b.answer);
        const t = c.turns.find((x): x is AgentTurn => x.role === 'assistant' && x.blank?.id === b.id);
        if (t?.blank) { t.blank = { ...t.blank, answer: b.answer }; c.events.emit({ type: 'blank-answered', turnId: t.id, answer: b.answer }); }
      }
    }
  }
  function answerBlank(id: string, answer: string): void {
    const c = convo(id), b = details.model(id).blanks.find((x) => x.answer === null);
    if (!b || !c.gwId) return;
    const gw = c.gwId;
    client.requestRaw('plugin.boopis.blank.fill', { session_id: gw, blank_id: b.id, answer })
      .then((res) => {
        if ((res as { delivered?: boolean } | null)?.delivered !== false) return;
        /* the plugin recorded the answer but could not hand it to the model: send it as the user's own message */
        const text = 'Answer to "' + b.question + '": ' + answer;
        if (c.running) return client.requestRaw('session.steer', { session_id: gw, text, execution_generation: c.generation });
        sessions.send(id, text, { governed: false, smart: false, model: '', assume: [] });
        return undefined;
      })
      .catch((e: unknown) => { log.error('the answer was not delivered', e); });
  }
  function settle(id: string, outcome: WaitOutcome): void {
    const i = waitList.findIndex((w) => w.id === id);
    if (i < 0) return;
    waitList.splice(i, 1);
    approvalRoute.delete(id);
    blankRoute.delete(id);
    waitsEv.emit({ type: 'resolved', id, outcome });
  }

  /* ───────── the link ───────── */
  client.onEvent(onEvent);
  client.onState((s) => {
    if (s.phase === 'ready' && s.reconnected) { for (const c of convos.values()) if (c.gwId) { void formsHost.reload(c.gwId, c.model); void modsHost.attach(c.uiId); } refreshList().catch((e: unknown) => { log.warn('could not refresh after reconnecting', e); }); details.onLinkReady(); }
  });
  client.onEvent((ev) => {
    if (ev.type !== 'connection.replay_gap' || typeof ev.payload?.['session_id'] !== 'string') return;
    const uiId = byGw.get(ev.payload['session_id']);
    const c = uiId ? convos.get(uiId) : undefined;
    if (c) { c.running = null; details.onReplayGap(c.uiId); resume(c).catch((e: unknown) => { log.warn('could not reload a session after lost events', e); }); }
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
    diff: (id) => details.diffFiles(id),
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
    fork(id) {
      if (details.unavailable['sessions.fork']) return null;
      const src = list.get().find((x) => x.id === id);
      if (!src) return null;
      const s: SessionSummary = { id: 'new-' + nextId('f'), project: src.project, title: src.title + ' (fork)', when: 'now' };
      const c = convo(s.id);
      c.hydrated = true;
      const at = list.get().findIndex((x) => x.id === id);
      list.set([...list.get().slice(0, at + 1), s, ...list.get().slice(at + 1)]);
      ensureLive(convo(id))
        .then((gw) => client.requestRaw('session.branch', { session_id: gw }))
        .then((res) => {
          const r = res as { session_id: string; messages?: Parameters<typeof transcriptToTurns>[0]; info?: { model?: string } };
          bind(c, r.session_id);
          c.turns = transcriptToTurns(r.messages ?? [], r.info?.model ?? '', s.id + ':');
          details.model(s.id).started = true;
          c.events.emit({ type: 'reset' });
          details.onBound(s.id);
        })
        .catch((e: unknown) => { log.error('the session was not forked', e); list.set(list.get().filter((x) => x.id !== s.id)); });
      return s;
    },
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
      void meta; // governed and Smart live in the details source (the user's choice, applied when the session is created)
      const c = convo(id);
      details.onSent(id, text);
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
    answerBlank,
    openPullRequest: () => { log.warn('pull requests are not wired yet'); }
  };

  const waits: WaitsSource = {
    ...feed(() => [...waitList], waitsEv),
    resolve(id, outcome) {
      if (formsHost.openIds().includes(id)) return;   /* a form is answered with its values, through `forms` */
      const blankSession = blankRoute.get(id);
      if (blankSession) { answerBlank(blankSession, outcome); return; }
      const route = approvalRoute.get(id);
      if (!route) return;
      client.requestRaw('approval.respond', { session_id: route.gwSession, execution_generation: route.generation, prompt_id: id, choice: choiceFor(outcome) }) /* canonical shape, verified in S0; the vendored contract lags it */
        .then(() => { settle(id, outcome); })
        .catch((e: unknown) => { log.error('the approval was not delivered', e); });
    }
  };

  const liveBots = createLiveBots({ client, now, ...(opts.linkTo ? { linkTo: opts.linkTo } : {}), ...(opts.botsPollMs !== undefined ? { pollMs: opts.botsPollMs } : {}) });
  Object.assign(details.unavailable, liveBots.unavailable);
  const ready = Promise.all([refreshList(), details.start(), liveBots.ready]).then(() => undefined);
  const flag = readFlag('feedforward');
  return {
    ...mock,
    info: { live: true, preview: new Set(['feedforward']), unavailable: details.unavailable },
    ready, sessions, waits, user, forms: formsHost.source, bots: liveBots.source, schedules: liveBots.schedules,
    details: details.source, run: details.run, mods: modsHost.source,
    files: { pick: () => null, complete: (word, id) => details.files.complete(word, id) },
    dictation: { start: () => () => undefined }, // nothing hears you yet: the mock's transcript is invented text
    feedforward: { catalog: () => (flag ? mock.feedforward.catalog() : []) },
    settled: async () => { await details.settled(); await liveBots.settled(); },
    ledger: { totals: () => ledgerTotals, subscribe(fn) { ledgerSubs.add(fn); return () => { ledgerSubs.delete(fn); }; } }
  };
}

/** the todo list a resumed session carries (`todo_state`), as the panel shows it */
function todosFromResume(res: unknown): ReturnType<typeof todosFrom> {
  const state = (res as { todo_state?: { todos?: Parameters<typeof todosFrom>[0] } | null }).todo_state;
  return todosFrom(state?.todos);
}

/** the details panel's connector controls, over the host's connector commands (desktop app only) */
function tauriConnectorActions(): { setEnabled(name: string, enabled: boolean): Promise<void>; signin(name: string): Promise<unknown> } {
  const bridge = tauriConnectorsBridge();
  return { setEnabled: (name, enabled) => bridge.setEnabled(name, enabled), signin: (name) => bridge.signin(name) };
}
