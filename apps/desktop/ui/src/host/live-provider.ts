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
import type { AgentTurn, BlankData, CouncilChoice, BlankWait, ConversationEvent, FormStatus, FormWait, SendMeta, SessionSummary, Turn, User, UserTurn, Wait, WaitOutcome } from '../data/types';
import { readFlag } from '../core/settings';
import { createDetails } from './live/details';
import { applyMoa, createCouncil, isCouncilReport, finishedCouncil, startedCouncil, valueOfSlot } from './live/council';
import { createLiveBots } from './live/bots';
import { createLiveGroups } from './live/groups';
import { todosFrom } from './live/map-details';
import { blankData } from './live/blanks';
import { createModsHost } from './live/mods';
import { foldChild, isSubagentEvent } from './live/children';
import { sendRoster } from './live/dispatch';
import { loadModelsView } from './setup-bridge';
import { tiersFromHost } from './live/models';
import { chooseAnotherModel, createFormsHost, hasHostDialogs, hostCancelSignin, hostSignin, tauriPickFolder } from './live/forms';
import type { XSignin } from './live/forms';
import { tauriConnectorsBridge } from './connectors-bridge';
import { createLiveStore } from './live/store';
import { tauriStoreBridge } from './store-bridge';
import type { StoreBridge } from './store-bridge';
import { inTauri } from './bridge';
import type { FormEntry } from './live/forms';
import { tauriSecrets } from './secrets';
import { dropsFromHost, pickAttachments } from './attach';
import { hostPaths } from './paths';
import { stageAttachments, withRefs } from './live/attachments';
import type { SecretsBridge } from './secrets';
import type { GatewayClient, GatewayEvent } from './gateway';
import type { RpcMethods } from '../vendor/hermes-shared/gateway-contract.generated';
import { bindTurn, loadTurnBook } from './live/attribution';
import { approvalToWait, choiceFor, clock, elapsed, failedStep, paragraphs, reduceLedger, sessionRowToSummary, sessionTitle, toolStep, transcriptToTurns } from './map';
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
  /** the store's host commands (default in the desktop app: the host's `store_*` commands; elsewhere none, and the store says so: it never shows fixtures) */
  storeBridge?: StoreBridge | null;
}

interface Running { /** the tiers the ladder ran this turn on, as 'provider/model', in order */ tiers: string[]; turn: AgentTurn; text: string; steps: AgentTurn['steps'][number][]; startedAt: number }
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
  /** why Smart chose the model of the message just sent; read by the turn that starts */
  why: string | null;
  /** the message just sent went to one model only (an "@" mention): the turn that starts answers with it, the session's `model` stays */
  once: { model: string; ungoverned: boolean } | null;
  running: Running | null;
  /** the council running this turn (set when its message goes out, spent when the turn finishes) */
  council: CouncilChoice | null;
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
  /** the sessions being made on the gateway, until each is bound to the id the UI knows it by */
  const creating = new Set<Promise<string>>();
  const convo = (uiId: string): Convo => {
    let c = convos.get(uiId);
    if (!c) { c = { uiId, gwId: null, generation: 0, turns: [], events: emitter<ConversationEvent>(), hydrated: false, model: '', why: null, once: null, running: null, council: null }; convos.set(uiId, c); }
    return c;
  };
  const bind = (c: Convo, gwId: string): void => { c.gwId = gwId; byGw.set(gwId, c.uiId); };
  const details = createDetails({ client, ...(hasHostDialogs() ? { hostLadder: async () => { const v = await loadModelsView(); return v.state === 'set' ? tiersFromHost(v.tiers) : []; }, hostGoverned: async () => (await loadModelsView()).governed } : {}), ...(opts.connectors ? { connectors: opts.connectors } : hasHostDialogs() ? { connectors: tauriConnectorActions() } : {}), now: () => now().getTime(), gwId: (id) => convos.get(id)?.gwId ?? (id.startsWith('new-') ? null : id), onRefreshed: (id) => { const c = convos.get(id); if (c) syncBlanks(c); } });
  const councilHost = createCouncil({ client, gwId: (id) => convos.get(id)?.gwId ?? null, context: (id) => details.councilContext(id) });
  /* Claude Code mods: what a session's mods draw (`mod.*` events) and the answers sent back; one `ModSession` per session */
  const modsHost = createModsHost({ client, uiOf: (gw) => byGw.get(gw), gwOf: (id) => convos.get(id)?.gwId ?? null });
  const user = store<User>({ name: 'you', initials: 'y' });
  const patchSession = (id: string, patch: Partial<SessionSummary>): void => list.update((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  /* ───────── the session list ───────── */
  async function refreshList(): Promise<void> {
    const [active, hidden] = await Promise.all([client.request('session.list', { limit: 100 }), client.request('session.list', { limit: 100, include_hidden: true })]);
    /* A session being made here is named by the gateway before the UI has bound that name to its own id. A list that
       lands in between would show the row under the gateway's id, and the shell would open a second conversation for it
       (`session.resume`) that takes the gateway's id over: the reply's events would then go to a conversation nobody is
       looking at. So the refresh waits for the sessions in the making. */
    if (creating.size > 0) await Promise.allSettled([...creating]);
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
    await sendRoster(client, details.source.choices.get());   /* its tools are rebuilt now: the models it can name are today's */
    const res = await client.request('session.resume', { session_id: c.uiId });
    bind(c, res.session_id);
    void modsHost.attach(c.uiId);   /* the mods already loaded in a resumed session */
    c.model = res.info.model && !isCouncilReport((res.info as { provider?: string }).provider, res.info.model) ? res.info.model : '';
    c.turns = transcriptToTurns(res.messages, c.uiId + ':', await loadTurnBook(client, res.session_id));   /* each past turn has its own recorded model, or none */
    c.hydrated = true;
    if (c.turns.some((t) => t.role === 'user')) details.model(c.uiId).started = true;
    details.model(c.uiId).todos = todosFromResume(res);
    c.events.emit({ type: 'reset' });
    details.onBound(c.uiId);
    formsHost.restore(res.session_id, (res as { open_requests?: unknown }).open_requests);   /* Hermes's string prompts still waiting */
    void formsHost.reload(res.session_id, c.model);   /* the forms still open when the session was last seen */
  }
  async function ensureLive(c: Convo): Promise<string> {
    if (c.gwId) return c.gwId;
    if (c.hydrated) { // a session made here, not yet on the gateway
      const making = createLive(c);
      creating.add(making);
      try { return await making; } finally { creating.delete(making); }
    }
    await resume(c);
    return c.gwId ?? c.uiId;
  }
  async function createLive(c: Convo): Promise<string> {
    const governed = details.governedAtCreation(c.uiId);
    /* the toolset is fixed here for good (Hermes's prompt cache): a governed session has only the boopis tools, so no
       Hermes tool the plugin would have to police ever reaches the model. The generated contract's create params do not
       list `toolsets` yet (the gateway's canonical ones do), hence the raw call. */
    await sendRoster(client, details.source.choices.get());   /* the models a message can send a task to, fixed with the session's tools (a governed session has no delegate_task: it is harmless there) */
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
    c.model = res.info.model && !isCouncilReport((res.info as { provider?: string }).provider, res.info.model) ? res.info.model : '';
    details.onBound(c.uiId);
    return res.session_id;
  }

  /* ───────── events → the conversation ───────── */
  /** the council that answers this turn (or none): the chip reads "Council of N" meanwhile (never the engine's name for the turn) */
  function setCouncil(c: Convo, choice: CouncilChoice | null): void {
    c.council = choice;
    details.councilTurn(c.uiId, choice ? choice.members.length : null);
  }
  function startTurn(c: Convo): Running {
    if (c.running) return c.running;
    /* a council turn: the combiner is the model that answers (the engine's own name for the turn, the preset's, is not a model) */
    const council = c.council ? startedCouncil(c.council) : undefined;
    const turn: AgentTurn = { id: nextId('t'), role: 'assistant', model: c.council ? valueOfSlot(c.council.combiner) : c.once?.model || c.model || details.currentModel(c.uiId), ...(c.once?.ungoverned ? { ungoverned: true } : {}), ...(c.council ? { why: 'Council of ' + c.council.members.length } : c.why ? { why: c.why } : {}), ...(council ? { council } : {}), time: '0s', cost: '', stepCount: 0, steps: [], paragraphs: [], bullets: [], status: 'running' };
    c.turns.push(turn);
    c.running = { turn, tiers: [], text: '', steps: [], startedAt: Date.now() };
    c.why = null;
    c.events.emit({ type: 'turn-added', turn });
    patchSession(c.uiId, { running: true, when: 'now' });
    return c.running;
  }
  function addStep(c: Convo, r: Running, step: AgentTurn['steps'][number]): void {
    r.steps.push(step);
    c.events.emit({ type: 'step-added', turnId: r.turn.id, step });
  }
  function finishTurn(c: Convo, text: string | null, stopped: boolean, answered?: string): AgentTurn | null {
    const r = c.running;
    if (!r) return null;
    const finalText = text ?? r.text;
    const paras = paragraphs(finalText);
    const time = elapsed(Date.now() - r.startedAt);
    const i = c.turns.indexOf(r.turn);
    /* who answered: the tiers the ladder ran (governed), else the model the engine reported for the turn */
    const model = r.tiers.length ? r.tiers.join(' → ') : r.turn.council ? r.turn.model : answered || r.turn.model;
    const done: AgentTurn = { ...r.turn, model, ...(r.turn.council ? { council: finishedCouncil(r.turn.council) } : {}), time, stepCount: r.steps.length, steps: r.steps, paragraphs: paras, status: stopped ? 'stopped' : 'done' };
    if (i >= 0) c.turns[i] = done;
    c.running = null; setCouncil(c, null);
    if (done.council) c.events.emit({ type: 'council', turnId: r.turn.id, council: done.council });
    c.events.emit({ type: 'turn-finished', turnId: r.turn.id, time, cost: '', stepCount: r.steps.length, paragraphs: paras, stopped, model, ...(r.turn.why ? { why: r.turn.why } : {}) });
    patchSession(c.uiId, { running: false });
    return done;
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

  /* a task handed to another model: the engine's `subagent.*` frames, folded into the turn that started it (live/children.ts) */
  function childFrame(c: Convo, type: string, p: Record<string, unknown>): void {
    if (!isSubagentEvent(type)) return;
    const t = raisingTurn(c);
    if (!t) return;
    const folded = foldChild(t.children ?? [], type, p as never, Date.now());
    if (!folded) return;
    t.children = folded.list;
    c.events.emit({ type: 'child-updated', turnId: t.id, child: folded.child });
  }
  const childOf = (id: string, childId: string): { gw: string; child: import('../data/types').ChildTask } | null => {
    const c = convos.get(id);
    if (!c?.gwId) return null;
    for (const t of c.turns) if (t.role === 'assistant') { const child = t.children?.find((x) => x.id === childId); if (child) return { gw: c.gwId, child }; }
    return null;
  };

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
      case 'session.info': { const profile = p['profile_name']; if (typeof profile === 'string' && profile) user.set({ name: profile, initials: profile.slice(0, 1).toLowerCase() }); const m = p['model']; if (typeof m === 'string' && m && !c.once && !c.council && !isCouncilReport(typeof p['provider'] === 'string' ? p['provider'] : null, m)) c.model = m;   /* an "@" message or a council names its own model here (a council's is the preset's name on the provider `moa`, which is not a model, also when a slash command asked for it); the session's stays */ const t = p['title']; if (typeof t === 'string' && t) patchSession(uiId, { title: sessionTitle({ title: t, preview: '' }) }); break; }
      case 'message.start': startTurn(c); break;
      case 'subagent.spawn_requested': case 'subagent.start': case 'subagent.progress': case 'subagent.thinking': case 'subagent.tool': case 'subagent.complete': childFrame(c, ev.type, p); break;
      case 'moa.reference': case 'moa.progress': case 'moa.phase': case 'moa.aggregating': {
        /* the council's members answering, and the combiner starting: a turn that none armed (a slash command) still shows them */
        const r = startTurn(c), next = applyMoa(r.turn.council ?? null, ev);
        if (next) { r.turn.council = next; c.events.emit({ type: 'council', turnId: r.turn.id, council: next }); }
        break;
      }
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
        const usage = p['usage'] as { model?: unknown } | undefined;
        const finished = finishTurn(c, text, outcome !== 'completed', typeof usage?.model === 'string' ? usage.model : undefined);
        c.once = null;   /* the engine has put the session's model back; the plugin governs the next message again */
        if (ev.session_id) bindTurn(client, ev.session_id, p['persisted_turn'], { council: finished?.council, children: finished?.children });   /* who answered, and what the turn showed, kept for a resume */
        if (!modsHost.known(uiId)) void modsHost.attach(uiId);   /* mods load at a session's first prompt */
        break;
      }
      case 'plugin.boopis.cascade.updated': {
        /* governed: the tier a task attempt runs on. The turn shows the tiers in order, the last one answered */
        const r = c.running, tier = p['tier'];
        const t = typeof tier === 'string' ? details.model(uiId).cascade?.ladder?.find((x) => x.name === tier) : undefined;
        if (r && t) {
          const ref = t.model.provider + '/' + t.model.id;
          if (r.tiers[r.tiers.length - 1] !== ref) { r.tiers.push(ref); c.events.emit({ type: 'turn-model', turnId: r.turn.id, model: r.tiers.join(' → ') }); }
        }
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
  /* the gateway's own requests: the string prompts (secret, sudo, vault) are forms; anything else is refused, as before */
  client.onServerRequest((r) => formsHost.serverRequest(r));
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
          c.turns = transcriptToTurns(r.messages ?? [], s.id + ':');   /* a branch is a new session: nothing recorded who answered its copied turns */
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
      // governed mode lives in the details source; who answers is decided per message below, and the attachments ride here
      const c = convo(id);
      details.onSent(id, text);
      const attachments = meta.attachments ?? [];
      const asked = councilHost.armed(id);   /* a council armed for this message: it goes out below (`councilHost.start`) */
      const user: UserTurn = { id: nextId('t'), role: 'user', at: clock(now()), text, ...(attachments.length ? { attachments } : {}) };
      c.turns.push(user);
      c.events.emit({ type: 'turn-added', turn: user });
      let abortOnce: (() => Promise<void>) | null = null;
      ensureLive(c)
        /* who answers is decided now, for this message: Smart's rule or the user's pick, applied through the engine before it goes */
        .then(async (gw) => {
          /* a council armed for this message: Smart or the pick as usual, then the council's own one-turn switch (next step); a mention does not apply */
          if (asked) { const who = await details.prepareSend(id, text, { attachments: attachments.length }); if (who.model) c.model = who.model; c.why = who.why; return gw; }
          /* "@model": this message only goes to that model (the engine's one-turn switch); the session's model and the sticky pick stay. Smart does not override it. */
          const keep = c.model;
          c.once = { model: '', ungoverned: false };   /* the engine reports the switch while it is made: those reports name the mentioned model, not the session's */
          let mention: Awaited<ReturnType<typeof details.prepareMention>>;
          try { mention = await details.prepareMention(id, text, { idle: !c.running }); } catch (e) { c.once = null; c.model = keep; throw e; }
          if (mention) { c.model = keep; c.once = { model: mention.model, ungoverned: mention.ungoverned }; c.why = mention.why; abortOnce = mention.abort; return gw; }
          c.once = null; c.model = keep;
          const who = await details.prepareSend(id, text, { attachments: attachments.length }); if (who.model) c.model = who.model; c.why = who.why; return gw;
        })
        .then(async (gw) => { if (asked) setCouncil(c, await councilHost.start(id)); return gw; })
        .then(async (gw) => {
          const refs = attachments.length ? await stageAttachments((m, p) => client.requestRaw(m, p), gw, attachments) : [];   /* files, pictures and folders go first (live/attachments.ts) */
          return client.requestRaw('prompt.submit', { session_id: gw, text: withRefs(text, refs), submission_id: 'sub-' + crypto.randomUUID() }); /* the gateway requires submission_id; the vendored contract does not list it yet */
        })
        .catch(async (e: unknown) => {
          log.error('the message was not accepted', e);
          c.once = null; setCouncil(c, null);
          await abortOnce?.();   /* nothing started: the exception and the switch are taken back */
          startTurn(c);
          finishTurn(c, 'The message was not sent: ' + (e instanceof Error ? e.message : String(e)), true);
        });
    },
    stop(id) {
      const gw = convos.get(id)?.gwId;
      if (gw) client.request('session.interrupt', { session_id: gw }).catch((e: unknown) => { log.warn('could not stop', e); });
    },
    answerBlank,
    stopChild(id, childId) {
      const hit = childOf(id, childId);
      if (!hit?.child.subagentId) return;
      client.request('subagent.interrupt', { session_id: hit.gw, subagent_id: hit.child.subagentId }).catch((e: unknown) => { log.warn('could not stop the task', e); });
    },
    async childTranscript(id, childId) {
      const hit = childOf(id, childId);
      if (!hit?.child.childSession) throw new Error('This task has no session of its own to read yet.');
      const res = await (await client.requestRaw('session.transcript', { session_id: hit.child.childSession, limit: 200, order: 'oldest' })) as { rows?: unknown[] };
      /* every answer in a child's own session is the child's model (the turn book is the parent session's) */
      return transcriptToTurns((res.rows ?? []) as never, childId + ':').map((t) => (t.role === 'assistant' ? { ...t, model: hit.child.model } : t));
    },
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
  const liveGroups = createLiveGroups({ client, bots: () => liveBots.source.snapshot().bots, now, ...(opts.botsPollMs !== undefined ? { pollMs: opts.botsPollMs } : {}) });
  const liveStore = createLiveStore({ bridge: opts.storeBridge !== undefined ? opts.storeBridge : inTauri() ? tauriStoreBridge() : null, plugin: (method, params) => client.requestRaw('plugin.boopis.' + method, params) });
  const ready = Promise.all([refreshList(), details.start(), liveBots.ready, liveGroups.ready]).then(() => undefined);
  const flag = readFlag('feedforward');
  return {
    ...mock,
    info: { live: true, preview: new Set(['feedforward']), unavailable: details.unavailable },
    ready, sessions, waits, user, forms: formsHost.source, bots: liveBots.source, groups: liveGroups.source, schedules: liveBots.schedules,
    details: details.source, run: details.run, mods: modsHost.source, store: liveStore,
    council: councilHost, files: { pick: (kind) => pickAttachments(kind), drops: dropsFromHost(), complete: (word, id) => details.files.complete(word, id), paths: hostPaths() },
    dictation: { start: () => () => undefined }, // nothing hears you yet: the mock's transcript is invented text
    feedforward: { catalog: () => (flag ? mock.feedforward.catalog() : []) },
    settled: async () => { await liveStore.settled(); await details.settled(); await liveBots.settled(); await liveGroups.settled(); },
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
