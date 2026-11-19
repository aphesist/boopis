/* The mock provider: serves mock-data.ts through the DataProvider interfaces, and plays the part of the backend
   for everything a user can do (a reply streaming in, a run taking steps, an approval being decided). It reproduces
   the v6 mock-up's timings so the approved behaviour is unchanged. It exists for development, the smoke tests and the
   visual parity tests; the app never falls back to it when the live provider fails (STANDARDS section 1, rule 4). */
import { hhmm, reduced } from '../core/dom';
import type {
  BotsEvent, BotsSource, BotsSnapshot, DataProvider, DetailsSource, DictationSource, FeedforwardSource, FilesSource, FormsSource, ModsSource, RunSource, SchedulesSource, SessionsSource, WaitsEvent, WaitsSource
} from './provider';
import { botIdBase } from './bot-id';
import { createModsModel } from './mods-model';
import { emitter, feed, store } from './store';
import type {
  AgentTurn, ApprovalMessage, ArchivedBot, Bot, BotConfig, ContextUsage, ConversationEvent, DiffFile, RunSnapshot, SessionSummary, TextMessage, ThreadMessage, Turn, Wait
} from './types';
import * as M from './mock-data';

let nextId = 0;
const mid = (p: string): string => p + (++nextId).toString(36);
/** a timer that shortens under reduced motion, as the v6 bots module did */
const later = (fn: () => void, ms: number): number => window.setTimeout(fn, reduced() ? Math.min(ms, 300) : ms);
const BUSY = new Set(['working', 'thinking', 'speaking', 'compute']);

export interface MockOptions {
  /** run the live simulations (a ticking run, replies). Tests that need a still page turn it off. */
  simulate?: boolean;
  /** names from `BOT_FIXTURES` to add (a bot with a long name), or `none` for an empty roster: tests and the e2e build only */
  fixtures?: readonly string[];
}

export function createMockProvider(opts: MockOptions = {}): DataProvider {
  const simulate = opts.simulate !== false;

  /* ───────── bots and their threads ───────── */
  const bots: Bot[] = M.seedBots();
  const threads: Record<string, ThreadMessage[]> = {};
  const seedThread = (id: string, list: ReturnType<typeof M.seedThreads>[string]): void => {
    threads[id] = list.map((m): ThreadMessage => m.approval
      ? { kind: 'approval', id: mid('m'), who: m.who, t: m.t, data: m.approval }
      : { kind: 'text', id: mid('m'), who: m.who, t: m.t, text: m.text ?? '' });
  };
  for (const [id, list] of Object.entries(M.seedThreads())) seedThread(id, list);
  /* `none` is the empty roster (a profile with no bots yet): the dock's "+" alone. A fixture that adds a bot still adds it. */
  if (opts.fixtures?.includes('none')) bots.length = 0;
  for (const name of opts.fixtures ?? []) {
    const f = M.BOT_FIXTURES[name];
    if (f) { bots.push(M.fixtureBot(f.bot)); seedThread(f.bot.id, f.thread); }
  }
  const botsEv = emitter<BotsEvent>();
  const archivedSeeds = M.ARCHIVED_SEEDS.map((a) => ({ id: 'archived--' + a.bot.id, name: 'archived--' + a.bot.id, was: a.bot.id, at: a.at, when: a.when, seed: a.bot }));
  const archivedBots = store<readonly ArchivedBot[]>(archivedSeeds.map(({ seed: _seed, ...row }) => row));
  const botById = (id: string): Bot | undefined => bots.find((b) => b.id === id);
  const threadOf = (id: string): ThreadMessage[] => (threads[id] ??= []);
  const cloneBot = (b: Bot): Bot => ({ ...b, ideas: [...b.ideas], last: b.last ? { ...b.last } : null, cfg: { ...b.cfg, channels: { ...b.cfg.channels }, approvals: { ...b.cfg.approvals } } });
  const announceBot = (b: Bot): void => botsEv.emit({ type: 'bot', bot: cloneBot(b) });
  function setBotState(id: string, state: string, activity?: string): void {
    const b = botById(id); if (!b) return;
    b.state = state;
    if (activity !== undefined) b.activity = activity;
    announceBot(b);
  }

  const runs = new Map<string, { timers: number[] }>();
  function endRun(id: string, run: { timers: number[] }): void {
    if (runs.get(id) !== run) return;
    for (const t of run.timers) clearTimeout(t);
    runs.delete(id);
    botsEv.emit({ type: 'run', botId: id, running: false });
  }
  function stream(id: string, text: string, done?: () => void, run?: { timers: number[] }): void {
    const m: TextMessage = { kind: 'text', id: mid('m'), who: id, t: hhmm(), text: '' };
    const list = threadOf(id);
    list.push(m);
    botsEv.emit({ type: 'message', botId: id, message: { ...m }, streaming: true });
    const b = botById(id);
    const prev = b ? b.state : 'idle';
    if (b) setBotState(id, 'speaking');
    const words = text.split(/(\s+)/);
    let i = 0;
    const finish = (): void => {
      const k = list.findIndex((x) => x.id === m.id);
      if (k >= 0) list[k] = { ...m, text };
      botsEv.emit({ type: 'message-end', botId: id, messageId: m.id, text });
      const cur = botById(id);
      if (cur && cur.state === 'speaking') setBotState(id, prev);
    };
    const step = (): void => {
      if (run && runs.get(id) !== run) { finish(); return; }
      if (i >= words.length || reduced()) { finish(); done?.(); return; }
      i += 2;
      const part = words.slice(0, i).join('');
      const k = list.findIndex((x) => x.id === m.id);
      if (k >= 0) list[k] = { ...m, text: part };
      botsEv.emit({ type: 'message-text', botId: id, messageId: m.id, text: part });
      setTimeout(step, 38);
    };
    step();
  }
  function respond(id: string): void {
    const b = botById(id); if (!b) return;
    const prior = runs.get(id);
    if (prior) { endRun(id, prior); if (BUSY.has(b.state)) setBotState(id, 'idle', ''); }
    const run = { timers: [] as number[] };
    runs.set(id, run);
    botsEv.emit({ type: 'run', botId: id, running: true });
    const alive = (): boolean => runs.get(id) === run;
    const at = (fn: () => void, ms: number): void => { run.timers.push(later(() => { if (alive()) fn(); }, ms)); };
    setBotState(id, 'thinking');
    const pair = M.REPLY[id] ?? ['On it. I’ll keep this inside ' + (b.cfg.workspace === 'sandbox' ? 'my sandbox' : 'my worktree') + ' and report back here.', 'Done. Notes are above; nothing needed your approval.'];
    at(() => {
      stream(id, pair[0], () => {
        if (!alive()) return;
        setBotState(id, 'working', '');
        at(() => stream(id, pair[1], () => {
          if (!alive()) return;
          endRun(id, run);
          setBotState(id, 'happy', '');
          later(() => { const c = botById(id); if (c && c.state === 'happy') setBotState(id, 'idle'); }, 4200);
        }, run), 4200);
      }, run);
    }, 1300);
  }

  /* ───────── what waits on the user ───────── */
  const waits: Wait[] = [];
  const waitsEv = emitter<WaitsEvent>();
  const ninaAsk = threadOf('nina').find((m): m is ApprovalMessage => m.kind === 'approval');
  if (ninaAsk) waits.push({ id: 'approve-deploy', kind: 'approval', bot: 'nina', who: 'nina', title: ninaAsk.data.title, data: { from: 'nina', title: ninaAsk.data.title, quote: ninaAsk.data.quote ?? '', item: ninaAsk.data.item ?? [], meta: ninaAsk.data.meta ?? '' } });
  const s1Agent = M.S1_TURNS.find((t): t is AgentTurn => t.role === 'assistant' && !!t.blank);
  if (s1Agent?.blank) waits.push({ id: 'blank-alias', kind: 'blank', who: 'proration drift', title: 'keep prorate as a deprecated alias?', data: { model: s1Agent.model, question: s1Agent.blank.question, short: M.BLANK_DOCK_SHORT, options: M.BLANK_DOCK_OPTIONS } });
  function dropWait(id: string, outcome: string): void {
    const i = waits.findIndex((w) => w.id === id); if (i < 0) return;
    waits.splice(i, 1);
    waitsEv.emit({ type: 'resolved', id, outcome });
  }

  function decide(botId: string, messageId: string, decision: 'approved' | 'denied'): void {
    const list = threadOf(botId), k = list.findIndex((m) => m.id === messageId);
    const m = list[k];
    if (!m || m.kind !== 'approval' || m.resolved) return;
    const at = hhmm();
    list[k] = { ...m, resolved: decision, resolvedAt: at };
    const b = botById(botId);
    if (b) b.attention = null;
    botsEv.emit({ type: 'message-resolved', botId, messageId, resolved: decision, resolvedAt: at });
    const w = waits.find((x) => x.bot === botId && x.kind === 'approval');
    if (w) dropWait(w.id, decision);
    if (decision === 'approved') {
      setBotState(botId, 'working', 'deploying billing/cents to staging');
      later(() => stream(botId, 'Deployed to staging. The dry run matched all 200 invoices to the cent. Should I schedule production for tonight?', () => {
        setBotState(botId, 'happy', '');
        later(() => { const c = botById(botId); if (c && c.state === 'happy') setBotState(botId, 'idle'); }, 5000);
      }), 3200);
    } else {
      setBotState(botId, 'idle', '');
      later(() => stream(botId, 'Holding. Nothing was deployed; the branch stays on billing/cents until you say otherwise.'), 700);
    }
  }

  const botsSource: BotsSource = {
    ...feed<BotsSnapshot, BotsEvent>(() => ({ bots: bots.map(cloneBot), threads: Object.fromEntries(Object.entries(threads).map(([k, v]) => [k, [...v]])) }), botsEv),
    catalog: () => M.CATALOG,
    send(botId, text, via) {
      const b = botById(botId); if (!b) return;
      const list = threadOf(botId);
      if (via === 'dock' && !list.some((m) => m.kind === 'text' && m.text) && b.last) {
        const seed: TextMessage = { kind: 'text', id: mid('m'), who: botId, t: b.last.t, text: b.last.text };
        list.push(seed);
        botsEv.emit({ type: 'message', botId, message: seed, streaming: false });
      }
      const m: TextMessage = { kind: 'text', id: mid('m'), who: 'you', t: hhmm(), text, via };
      list.push(m);
      botsEv.emit({ type: 'message', botId, message: m, streaming: false });
      respond(botId);
    },
    stop(botId) {
      const run = runs.get(botId); if (!run) return false;
      endRun(botId, run);
      const b = botById(botId);
      if (b && BUSY.has(b.state)) setBotState(botId, 'idle', '');
      return true;
    },
    decide,
    update(id, patch) {
      const b = botById(id); if (!b) return;
      if (patch.role !== undefined) b.role = patch.role;
      if (patch.cfg) b.cfg = { ...b.cfg, ...patch.cfg, channels: { ...b.cfg.channels, ...patch.cfg.channels }, approvals: { ...b.cfg.approvals, ...patch.cfg.approvals } } as BotConfig;
      /* a boopis setting is saved in the bot's own store, which a bot made outside boopis did not have: the mark goes */
      if (patch.cfg && ['gov', 'cap', 'workspace', 'approvals'].some((k) => k in patch.cfg!)) delete b.madeOutside;
      announceBot(b);
    },
    create(draft) {
      const base = botIdBase(draft.name);
      let id = base, n = 2;
      while (botById(id)) id = base + '-' + n++;
      const role = shortRole(draft.role);
      const nb: Bot = {
        id, name: id, role, shape: draft.shape, color: draft.color, state: 'happy', attention: null, paused: false, activity: '', spent: '0.00', last: null, ideas: M.ideasFor(role),
        cfg: { instructions: draft.instructions, gov: 'governed', model: 'sonnet 5.5', cap: '0.60', cron: '', channels: { app: true, slack: false, telegram: false, email: false }, approvals: { deploys: true, push: true, network: true, spend: true, people: true, outside: true }, workspace: 'worktree' }
      };
      bots.push(nb);
      botsEv.emit({ type: 'bot-created', bot: cloneBot(nb) });
      later(() => stream(id, 'Hi, I’m ' + id + '. ' + (nb.cfg.instructions ? 'My brief: “' + nb.cfg.instructions.replace(/\s+/g, ' ') + '”' : 'Tell me what you need.') + ' I ask before deploying, pushing or spending past my cap. Open settings to give me a schedule or more channels.', () => {
        later(() => { const c = botById(id); if (c && c.state === 'happy') setBotState(id, 'idle'); }, 3000);
      }), 900);
      return cloneBot(nb);
    },
    archive(id) {
      const i = bots.findIndex((b) => b.id === id); if (i < 0 || bots.length < 2) return;
      bots.splice(i, 1);
      botsEv.emit({ type: 'bot-archived', id });
    },
    archived: archivedBots,
    restore(id) {
      const a = archivedSeeds.find((x) => x.id === id);
      if (!a) return Promise.reject(new Error(id + ' is not archived'));
      if (botById(a.was)) return Promise.reject(new Error('there is a teammate called ' + a.was + ' already; archive or delete it, then restore'));
      const nb = M.fixtureBot({ ...a.seed, id: a.was, name: a.was });
      bots.push(nb);
      archivedSeeds.splice(archivedSeeds.indexOf(a), 1);
      archivedBots.set(archivedSeeds.map(({ seed: _seed, ...row }) => row));
      botsEv.emit({ type: 'bot-created', bot: cloneBot(nb) });
      return Promise.resolve();
    }
  };
  const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
  function shortRole(t: string): string {
    const first = (String(t || '').trim().split(/[.,;:\n]/)[0] ?? '').trim();
    if (!first) return 'teammate';
    let out = '';
    for (const w of first.split(/\s+/)) { if ((out + ' ' + w).trim().length > 28) break; out = (out + ' ' + w).trim(); }
    return lowerFirst(out || first.slice(0, 28));
  }

  /* ───────── details ───────── */
  const used = (c: ContextUsage): number => c.parts.reduce((a, p) => a + p[1], 0);
  const withUsed = (c: ContextUsage): ContextUsage & { used: number } => ({ ...c, parts: c.parts.map((p) => [p[0], p[1]] as const), used: used(c) });
  const context = store(withUsed(M.CONTEXT));
  const todos = store([...M.TODOS]);
  const changes = store([...M.CHANGES]);
  const connectors = store(M.CONNECTORS.map((c) => ({ ...c })));
  const governance = store({ ...M.GOVERNANCE });
  const bumpContext = (part: string, by: number): void => context.update((c) => withUsed({ ...c, parts: c.parts.map((p) => (p[0] === part ? ([p[0], Math.max(0, p[1] + by)] as const) : p)) }));
  const details: DetailsSource = {
    context, todos, changes,
    output: store([...M.OUTPUT]), connectors, environment: store({ ...M.ENVIRONMENT }), governance, ledger: store({ ...M.LEDGER }),
    compactContext() {
      const conv = context.get().parts.find((p) => p[0] === 'conversation');
      const freed = conv ? Math.max(0, conv[1] - 5000) : 0;
      if (freed) bumpContext('conversation', -freed);
      return Promise.resolve(freed);
    },
    setGovernance(patch) { governance.update((g) => ({ ...g, ...patch })); return null; },
    models: store(M.CATALOG.models), follow() { /* the mock has one session's details */ }, notes: store({}), can: store({ compact: true, connectors: true, signIn: true }),
    setConnector(name, on) { connectors.update((l) => l.map((c) => (c.name === name ? { ...c, state: on ? 'on' : 'off' } : c))); },
    signIn(name) {
      return new Promise((resolve) => { setTimeout(() => { connectors.update((l) => l.map((c) => (c.name === name ? { ...c, state: 'on' } : c))); resolve(); }, 900); });
    }
  };

  /* ───────── sessions ───────── */
  const sessionList = store<readonly SessionSummary[]>(M.SESSIONS.map((s) => ({ ...s })));
  const archived = store<readonly SessionSummary[]>([]);
  const convs = new Map<string, Turn[]>();
  const convEv = new Map<string, ReturnType<typeof emitter<ConversationEvent>>>();
  const forkable = new Set<string>();
  convs.set('s1', [...M.S1_TURNS]);
  for (const id of ['s2', 's3', 's4', 's5']) { const t = M.historyTurns(id); if (t) { convs.set(id, [...t]); forkable.add(id); } }
  const turnsOf = (id: string): Turn[] => { let t = convs.get(id); if (!t) { t = []; convs.set(id, t); } return t; };
  const evOf = (id: string): ReturnType<typeof emitter<ConversationEvent>> => { let e = convEv.get(id); if (!e) { e = emitter<ConversationEvent>(); convEv.set(id, e); } return e; };
  const patchSession = (id: string, patch: Partial<SessionSummary>): void => sessionList.update((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const sessionRuns = new Map<string, { stop(): void }>();

  const sessions: SessionsSource = {
    list: sessionList, archived,
    draft: () => M.COMPOSER_DRAFT,
    conversation: (id) => feed(() => ({ turns: [...turnsOf(id)] }), evOf(id)),
    diff: (_id, answers): readonly DiffFile[] => M.diffFor(answers.blank),
    create(project) {
      const cur = sessionList.get();
      const s: SessionSummary = { id: 'n' + Date.now().toString(36), project: project ?? cur[0]?.project ?? 'billing-api', title: 'New session', when: 'now' };
      sessionList.set([s, ...cur]);
      return s;
    },
    rename(id, title) { patchSession(id, { title }); },
    fork(id) {
      const list = [...sessionList.get()], i = list.findIndex((s) => s.id === id), s = list[i];
      if (!s) return null;
      const n: SessionSummary = { id: 'f' + Date.now().toString(36), project: s.project, title: s.title + ' (fork)', when: 'now' };
      list.splice(i + 1, 0, n);
      if (forkable.has(id)) { convs.set(n.id, [...turnsOf(id)]); forkable.add(n.id); }
      sessionList.set(list);
      return n;
    },
    archive(id) {
      const list = [...sessionList.get()], i = list.findIndex((s) => s.id === id); if (i < 0) return;
      const [s] = list.splice(i, 1);
      sessionList.set(list);
      if (s) archived.set([s, ...archived.get()]);
    },
    restore(id) {
      const a = [...archived.get()], i = a.findIndex((s) => s.id === id); if (i < 0) return;
      const [s] = a.splice(i, 1);
      archived.set(a);
      if (s) sessionList.set([...sessionList.get(), s]);
    },
    send(id, text, meta) {
      sessions.stop(id);
      const turns = turnsOf(id), ev = evOf(id);
      const user: Turn = { id: mid('t'), role: 'user', at: hhmm(), text };
      turns.push(user); ev.emit({ type: 'turn-added', turn: user });
      const start = meta.governed && meta.smart ? ((meta.assume.join(' ').match(/starts on (\w+)/) ?? [0, 'qwen'])[1] as string) : (meta.model.split(' ')[0] ?? '');
      const model = ({ qwen: 'qwen3-coder', haiku: 'haiku 4.5', sonnet: 'sonnet 5.5', opus: 'opus 5.5' } as Record<string, string>)[start] ?? meta.model;
      const turn: AgentTurn = { id: mid('t'), role: 'assistant', model, time: '0s', cost: '', stepCount: 0, steps: [], paragraphs: [], bullets: [], status: 'running' };
      turns.push(turn); ev.emit({ type: 'turn-added', turn });
      patchSession(id, { running: true, when: 'now' });
      const skip = meta.assume.includes('>no test run');
      const steps = [
        { title: 'Read ' + (meta.assume.find((x) => x.startsWith('>src')) ?? '>src/billing').slice(1), meta: [model], time: '0:06' },
        { title: 'Edited 3 files', meta: [model], time: '0:21' },
        skip ? { title: 'Skipped tests, as asked', mono: false, time: '0:05' } : { title: 'npm test', mono: true, meta: ['142 passed'], time: '0:05' }
      ];
      let i = 0, secs = 0, timer = 0;
      const tick = window.setInterval(() => { secs++; }, 1000);
      const finish = (stopped: boolean): void => {
        clearInterval(tick); clearTimeout(timer); sessionRuns.delete(id);
        const total = steps.slice(0, i).reduce((a, st) => a + (+st.time.split(':')[0]!) * 60 + (+st.time.split(':')[1]!), 0);
        const cost = '$0.0' + (i + 1);
        const paragraphs = [stopped ? 'Stopped. Nothing was committed; the edits so far are under Changes.' :
          'Done. The helpers in `src/billing` take and return `Cents`. ' + (skip ? 'Tests were skipped.' : 'All 142 tests pass.') + (meta.assume.some((x) => /PR/.test(x)) ? ' The draft PR is ready for you.' : '')];
        const k = turns.findIndex((t) => t.id === turn.id);
        turns[k] = { ...turn, status: stopped ? 'stopped' : 'done', time: (total || secs || 1) + 's', cost, stepCount: i, steps: steps.slice(0, i), paragraphs };
        ev.emit({ type: 'turn-finished', turnId: turn.id, time: (total || secs || 1) + 's', cost, stepCount: i, paragraphs, stopped });
        patchSession(id, { running: false });
        bumpContext('conversation', 3000);
      };
      const next = (): void => {
        if (i < steps.length) { const st = steps[i++]!; ev.emit({ type: 'step-added', turnId: turn.id, step: st }); timer = window.setTimeout(next, 900); return; }
        finish(false);
      };
      sessionRuns.set(id, { stop: () => finish(true) });
      timer = window.setTimeout(next, 700);
    },
    stop(id) { sessionRuns.get(id)?.stop(); },
    answerBlank(id, answer) {
      const turns = turnsOf(id), k = turns.findIndex((t) => t.role === 'assistant' && !!t.blank);
      const t = turns[k];
      if (!t || t.role !== 'assistant' || !t.blank) return;
      turns[k] = { ...t, blank: { ...t.blank, answer } };
      evOf(id).emit({ type: 'blank-answered', turnId: t.id, answer });
      dropWait('blank-alias', answer);
    },
    openPullRequest() { todos.update((l) => l.map((t) => (t[0] === 'draft PR' ? ([t[0], 'done'] as const) : t))); }
  };

  const waitsSource: WaitsSource = {
    ...feed<readonly Wait[], WaitsEvent>(() => [...waits], waitsEv),
    resolve(id, outcome) {
      const w = waits.find((x) => x.id === id); if (!w) return;
      if (w.kind === 'approval') {
        const m = threadOf(w.bot).find((x): x is ApprovalMessage => x.kind === 'approval' && !x.resolved);
        if (m) decide(w.bot, m.id, outcome === 'denied' ? 'denied' : 'approved'); else dropWait(id, outcome);
      } else sessions.answerBlank('s1', M.BLANK_FROM_DOCK[outcome] ?? outcome);
    }
  };

  /* ───────── forms: the mock answers after a short delay (the live provider asks the plugin and the host); nothing is stored ───────── */
  const answer = (ms: number): Promise<void> => new Promise((ok) => { later(ok, ms); });
  const forms: FormsSource = {
    submit: () => answer(700), cancel: () => answer(50), signin: () => answer(1600),
    can: { signin: true, upload: true, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null)
  };

  /* ───────── the dock's run (it ticks once a second while running) ───────── */
  const ladder = M.GOVERNANCE.ladder;
  const run = store<RunSnapshot>({
    title: M.RUN_SEED.title, model: ladder[M.GOVERNANCE.current]?.[0] ?? 'sonnet 5.5', step: M.RUN_SEED.step, escalated: M.RUN_SEED.escalated, elapsed: M.RUN_SEED.elapsed,
    cost: M.RUN_SEED.cost, cap: M.RUN_SEED.cap, ladder, current: M.GOVERNANCE.current, tokens: M.LEDGER.tokens, trips: M.LEDGER.trips,
    governed: M.GOVERNANCE.governed, network: M.RUN_SEED.network, stopped: false
  });
  if (simulate) {
    setInterval(() => {
      const r = run.get();
      if (r.stopped || document.hidden) return;
      run.set({ ...r, elapsed: r.elapsed + 1, cost: Math.min(r.cap ?? 0, (r.cost ?? 0) + 0.0004) });
    }, 1000);
  }
  governance.subscribe((g) => { const r = run.get(); if (r.governed !== g.governed) run.set({ ...r, governed: g.governed }); });
  const runSource: RunSource = {
    current: run,
    stop() { const r = run.get(); if (!r.stopped) run.set({ ...r, stopped: true }); },
    setSetting(key, on) {
      if (key === 'governed') details.setGovernance({ governed: on });
      else run.set({ ...run.get(), network: on });
    }
  };

  const schedStore = store(M.SCHEDULES.map((s) => ({ ...s })));
  const schedules: SchedulesSource = {
    list: schedStore,
    runNow() { /* the mock has nothing to start */ },
    setPaused(id, paused) { schedStore.update((l) => l.map((s) => (s.id === id ? { ...s, paused } : s))); }
  };
  const feedforward: FeedforwardSource = { catalog: () => M.DECISIONS };
  const dictation: DictationSource = {
    start(_o, onTranscript) { const t = window.setTimeout(() => onTranscript('and update the changelog'), 2200); return () => clearTimeout(t); }
  };
  const files: FilesSource = {
    pick: (kind) => (kind === 'file' ? 'invoices-sample.csv' : 'src/billing/fixtures'),
    complete: (word) => Promise.resolve({ items: M.FILE_PATHS.filter((p) => p.includes(word.replace(/^@(file:)?/, ''))).map((p) => ({ text: '@file:' + p, display: p.slice(p.lastIndexOf('/') + 1), meta: '' })) })
  };

  /* the mock has no mods: a session's mods are always empty, and a press goes nowhere */
  const noMods = createModsModel();
  const mods: ModsSource = { ...noMods.source, press() { /* no mods */ }, input() { /* no mods */ }, select() { /* no mods */ }, props() { /* no mods */ } };
  return { info: { live: false, preview: new Set(), unavailable: {} }, ready: Promise.resolve(), user: store(M.USER), sessions, details, bots: botsSource, waits: waitsSource, forms, run: runSource, schedules, feedforward, dictation, files, mods };
}
