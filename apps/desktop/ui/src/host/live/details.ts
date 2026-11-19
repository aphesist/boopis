/* The details panels and the dock's run, from the gateway and the boopis plugin. One `SessionModel` per session
   (events fill it, reads complete it); the panels follow the session the user is looking at. Nothing is computed here
   that the plugin or Hermes can say: dollars are `ledger.stats` (from tokens), the ladder is `cascade.state`.
   Every read is allowed to fail on its own: a panel then says what it does not know, in `notes`, and the rest stands.
   Reconnects and lost events refetch what the events would have carried (`onLinkReady`, `onReplayGap`). */
import { logger } from '../../core/log';
import type { DetailsSource, RunSource, Watch } from '../../data/provider';
import { store } from '../../data/store';
import type { DetailsCan, DetailsNotes, DiffFile, Environment, FileCompletions, GovernanceState, ProviderInfo, RunSnapshot } from '../../data/types';
import type { GatewayClient, GatewayEvent } from '../gateway';
import { changesFrom, connectorsFrom, contextFrom, contextNote, costNote, diffFilesFrom, diffNote, environmentFrom, governanceFrom, ledgerFrom, runFrom } from './map-details';
import { blanksFromLedger } from './blanks';
import { applyEvent, newModel } from './session-model';
import type { Part, SessionModel } from './session-model';
import { isUnknownMethod } from './wire';
import type { BreakdownWire, CascadeWire, CompletionWire, DescribeWire, DiffWire, InfoWire, InventoryWire, McpStatusWire, StatsWire } from './wire';

const log = logger('live.details');
const PLUGIN = 'plugin.boopis.';
const REFRESH_MS = 150;
const NO_PLUGIN = 'The boopis plugin is not loaded in this Hermes, so there is no ladder, spend or ship history.';
const EMPTY_ENV: Environment = { cwd: '', branch: '', sandbox: '', runtime: '', harness: '', gate: '' };
const EMPTY_GOV: GovernanceState = { governed: false, smart: false, model: '', cap: '', spent: '', ladder: [], current: 0 };

export interface DetailsDeps {
  client: GatewayClient;
  /** the gateway's id of a UI session, null while it is only a placeholder here */
  gwId(uiId: string): string | null;
  now?: () => number;
  /** a read of a session finished (its blanks may have changed): the provider syncs its conversation and waits */
  onRefreshed?(uiId: string): void;
  /** what the Connectors section's switch and Sign in button do: the host switches a server through Hermes and runs Hermes's own OAuth
      flow for it. Without it (no desktop host) both controls are disabled and say nothing is wired */
  connectors?: { setEnabled(name: string, enabled: boolean): Promise<void>; signin(name: string): Promise<unknown> };
}
export interface LiveDetails {
  source: DetailsSource;
  run: RunSource;
  files: { complete(word: string, uiId: string | null): Promise<FileCompletions> };
  unavailable: ProviderInfo['unavailable'];
  model(uiId: string): SessionModel;
  /** the files of the session's kept ships, for the diff view (read from what the last `checkpoint.diff` said) */
  diffFiles(uiId: string): DiffFile[];
  /** the events of a session the UI knows: updates its record and publishes what changed */
  onEvent(uiId: string, ev: GatewayEvent): Part[];
  /** a session became live on the gateway (created or resumed) */
  onBound(uiId: string): void;
  onSent(uiId: string, text: string): void;
  /** the link came back after a loss, or events were lost for a session: read again what they would have said */
  onLinkReady(): void;
  onReplayGap(uiId: string): void;
  /** the mode and model the user chose before the first message, to apply at creation */
  chosen(uiId: string): { governed: boolean | null; model: string | null };
  /** whether a session about to be created is governed: the user's choice, else the plugin's default mode. An unknown
   *  default counts as governed (the plugin's own default), so a failure to read it never creates a session without the
   *  governed toolset. False when the plugin is not loaded (there is nothing to govern with). */
  governedAtCreation(uiId: string): boolean;
  /** the read of the global things (default mode, MCP servers, what this Hermes can do); part of `ready` */
  start(): Promise<void>;
  /** tests: every read in flight and every scheduled refresh done */
  settled(): Promise<void>;
}

export function createDetails(deps: DetailsDeps): LiveDetails {
  const { client } = deps;
  const now = deps.now ?? ((): number => Date.now());
  const models = new Map<string, SessionModel>();
  const model = (id: string): SessionModel => { let m = models.get(id); if (!m) { m = newModel(); models.set(id, m); } return m; };
  let followed = '';
  let defaultMode: 'governed' | 'ungoverned' | null = null;
  let mcp: McpStatusWire | null = null;
  let pluginOk = true;
  const unavailable: Record<string, string> = {};
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { inflight.add(p); void p.finally(() => { inflight.delete(p); }).catch(() => undefined); return p; };

  const context = store<ReturnType<DetailsSource['context']['get']>>({ total: 0, parts: [], used: 0 });
  const todos = store<ReturnType<DetailsSource['todos']['get']>>([]);
  const changes = store<ReturnType<DetailsSource['changes']['get']>>([]);
  const output = store<readonly string[]>([]);
  const connectors = store<ReturnType<DetailsSource['connectors']['get']>>([]);
  const environment = store<Environment>(EMPTY_ENV);
  const governance = store<GovernanceState>(EMPTY_GOV);
  const ledger = store(ledgerFrom(null));
  const modelList = store<readonly string[]>([]);
  const notes = store<DetailsNotes>({});
  const can = store<DetailsCan>({ compact: false, connectors: false, signIn: false });
  const run = store<RunSnapshot>(runFrom({ title: '', model: '', steps: 0, elapsedSeconds: 0, stopped: false, governed: false, stats: null, cascade: null, cap: null }));

  const locked = (m: SessionModel): boolean => m.started || m.describe?.session?.locked === true;
  const governedOf = (m: SessionModel): boolean => (locked(m) ? m.describe?.session?.mode === 'governed' : (m.wantGoverned ?? m.describe?.session?.mode === 'governed') || (m.describe?.session == null && m.wantGoverned == null && defaultMode === 'governed'));
  const modelOf = (m: SessionModel): string => m.wantModel ?? m.info?.model ?? m.usage?.model ?? '';

  /* ───────── publish: the followed session's record into the panels ───────── */
  function publishFollowed(parts: readonly Part[]): void {
    const m = model(followed);
    const has = (...p: Part[]): boolean => p.some((x) => parts.includes(x));
    const known = contextFrom(m.breakdown, m.usage);
    if (has('usage', 'info')) {
      context.set(known ?? { total: 0, parts: [], used: 0 });
      environment.set(environmentFrom(m.info, m.describe));
      modelList.set([...new Set([modelOf(m)].filter(Boolean))]);
    }
    if (has('todos')) todos.set(m.todos);
    if (has('diff')) changes.set(changesFrom(m.diff));
    if (has('output')) output.set(m.output);
    if (has('stats')) ledger.set(ledgerFrom(m.stats));
    if (has('usage', 'info', 'stats', 'cascade')) governance.set(governanceFrom({ describe: m.describe, cascade: m.cascade, stats: m.stats, model: modelOf(m), governed: governedOf(m), locked: locked(m) }));
    connectors.set(connectorsFrom(mcp, m.inventory));
    notes.set({
      ...(known ? (contextNote(m.breakdown, true) ? { context: contextNote(m.breakdown, true) } : {}) : { context: contextNote(null, false) }),
      ...(m.diff?.unavailable || m.diff?.truncated ? { changes: diffNote(m.diff) } : {}),
      ...(costNote(m.stats) ? { governance: costNote(m.stats) } : {}),
      ...(!pluginOk ? { governance: NO_PLUGIN } : {}),
      ...(Object.keys(unavailable).length ? { environment: 'Not available on this Hermes: ' + Object.keys(unavailable).map((k) => k.replace('sessions.', '')).join(', ') + '.' } : {})
    });
    publishRun();
  }
  function runFocus(): string {
    let best = '', at = -1;
    for (const [id, m] of models) if (m.running && (m.turnStartedAt ?? 0) > at) { best = id; at = m.turnStartedAt ?? 0; }
    return best || followed;
  }
  function publishRun(): void {
    const id = runFocus(), m = model(id);
    const end = m.running ? now() : (m.turnEndedAt ?? now());
    const elapsed = m.turnStartedAt == null ? 0 : Math.max(0, Math.floor((end - m.turnStartedAt) / 1000));
    const cap = m.describe?.config?.cost_cap_usd ?? null;
    run.set(runFrom({ title: m.title, model: modelOf(m), steps: m.steps, elapsedSeconds: elapsed, stopped: m.stopped && !m.running, governed: governedOf(m), stats: m.stats, cascade: m.cascade, cap }));
    ticking();
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  function ticking(): void {
    const any = [...models.values()].some((m) => m.running);
    if (any && !timer) timer = setInterval(publishRun, 1000);
    else if (!any && timer) { clearInterval(timer); timer = null; }
  }

  /* ───────── reads ───────── */
  async function read<T>(method: string, params: unknown): Promise<T | null> {
    try { return (await client.requestRaw(method, params)) as T; } catch (e) {
      if (method.startsWith(PLUGIN) && isUnknownMethod(e)) pluginOk = false;
      else log.warn(method + ' failed', e);
      return null;
    }
  }
  async function refresh(uiId: string, parts: readonly Part[]): Promise<void> {
    const gw = deps.gwId(uiId);
    const m = model(uiId);
    const p = { session_id: gw };
    const want = (...x: Part[]): boolean => x.some((y) => parts.includes(y));
    const jobs: Promise<void>[] = [];
    if (gw && want('info', 'usage')) {
      jobs.push(read<InfoWire>('session.info', p).then((r) => { if (r) { m.info = { ...(m.info ?? {}), ...r }; if (r.usage) m.usage = r.usage; } }));
      jobs.push(read<BreakdownWire>('session.context_breakdown', p).then((r) => { if (r) m.breakdown = r; }));
    }
    if (pluginOk && gw) {
      if (want('stats')) jobs.push(read<StatsWire>(PLUGIN + 'ledger.stats', p).then((r) => { if (r) m.stats = r; }));
      if (want('cascade')) jobs.push(read<CascadeWire>(PLUGIN + 'cascade.state', p).then((r) => { if (r) m.cascade = r; }));
      if (want('info')) jobs.push(read<DescribeWire>(PLUGIN + 'describe', p).then((r) => { if (r) m.describe = r; }));
      if (want('diff')) jobs.push(read<DiffWire>(PLUGIN + 'checkpoint.diff', p).then((r) => { if (r) m.diff = r; }));
    }
    if (pluginOk && gw && want('info')) {
      jobs.push(read<{ events: { type: string; payload: Record<string, unknown> }[] }>(PLUGIN + 'ledger.tail', { ...p, since_seq: -1, limit: 1000 }).then((r) => {
        if (!r) return;
        for (const b of blanksFromLedger(r.events)) {
          const mine = m.blanks.find((x) => x.id === b.id);
          if (!mine) m.blanks.push(b); else if (mine.answer === null && b.answer !== null) mine.answer = b.answer;
        }
      }));
    }
    await Promise.all(jobs);
    if (want('info') && pluginOk && m.info?.cwd) m.inventory = await read<InventoryWire>(PLUGIN + 'compat.inventory', { cwd: m.info.cwd });
    if (uiId === followed) publishFollowed([...parts, 'info']);
    deps.onRefreshed?.(uiId);
  }
  const pending = new Map<string, Set<Part>>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  function schedule(uiId: string, parts: readonly Part[]): void {
    const set = pending.get(uiId) ?? new Set<Part>();
    for (const p of parts) set.add(p);
    pending.set(uiId, set);
    flushTimer ??= setTimeout(flush, REFRESH_MS);
  }
  function flush(): void {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    for (const [id, set] of [...pending]) { pending.delete(id); void track(refresh(id, [...set])); }
  }
  const ALL: readonly Part[] = ['info', 'usage', 'stats', 'cascade', 'diff', 'todos', 'output'];

  async function start(): Promise<void> {
    const caps = ((client.describe as { capabilities?: string[] } | null)?.capabilities) ?? [];
    pluginOk = caps.length === 0 || caps.includes('plugin-rpc-v1');
    const jobs: Promise<void>[] = [];
    if (pluginOk) jobs.push(read<DescribeWire>(PLUGIN + 'describe', {}).then((r) => { defaultMode = r?.config?.mode ?? null; }));
    jobs.push(read<McpStatusWire>('mcp.servers.status', {}).then((r) => { mcp = r; }));
    /* what this Hermes cannot do is learned by asking with a session id that matches nothing: only "no such method" counts */
    const probe = async (method: string, key: string, why: string): Promise<void> => {
      try { await client.requestRaw(method, { session_id: '' }); } catch (e) { if (isUnknownMethod(e)) unavailable[key] = why; }
    };
    jobs.push(probe('session.branch', 'sessions.fork', 'This Hermes has no session.branch, so a session cannot be forked.'));
    jobs.push(probe('session.compress', 'sessions.compact', 'This Hermes has no session.compress; it compacts on its own when the window fills.'));
    await Promise.all(jobs);
    can.set({ compact: !unavailable['sessions.compact'], connectors: !!deps.connectors, signIn: !!deps.connectors });
    publishFollowed([]);
  }
  /** the servers' state again, after the host changed one */
  async function reloadMcp(): Promise<void> {
    mcp = await read<McpStatusWire>('mcp.servers.status', {});
    publishFollowed([]);
  }

  /* ───────── the source ───────── */
  const watch = <T>(s: Watch<T>): Watch<T> => s;
  const source: DetailsSource = {
    context: watch(context), todos: watch(todos), changes: watch(changes), output: watch(output), connectors: watch(connectors), environment: watch(environment),
    governance: watch(governance), ledger: watch(ledger), models: watch(modelList), notes: watch(notes), can: watch(can),
    follow(id) {
      if (id === followed) return;
      followed = id;
      const m = model(id);
      publishFollowed(['todos', 'diff', 'output', 'stats', 'usage', 'info', 'cascade']);
      if (deps.gwId(id)) void track(refresh(id, ALL)); else m.describe ??= null;
    },
    async compactContext() {
      const gw = deps.gwId(followed), m = model(followed);
      if (!gw || unavailable['sessions.compact']) return 0;
      const before = contextFrom(m.breakdown, m.usage)?.used ?? 0;
      await read('session.compress', { session_id: gw });
      await refresh(followed, ['usage', 'info']);
      return Math.max(0, before - (contextFrom(m.breakdown, m.usage)?.used ?? before));
    },
    setGovernance(patch) {
      const m = model(followed), gw = deps.gwId(followed);
      if (patch.smart !== undefined && patch.smart) return 'Smart (the automatic model choice) is not built yet. In governed mode the ladder picks the model.';
      if (patch.cap !== undefined) return 'The cost cap is the plugin’s cost_cap_usd setting; it cannot be changed from here yet.';
      if (patch.governed !== undefined) {
        if (locked(m)) return 'The mode is fixed once the first message is sent (prompt caching). Start a new session to change it.';
        m.wantGoverned = patch.governed;
        if (gw && pluginOk) void track(read(PLUGIN + 'mode.set', { session_id: gw, mode: patch.governed ? 'governed' : 'ungoverned' }).then(() => refresh(followed, ['info'])));
      }
      if (patch.model !== undefined) {
        if (locked(m)) return 'Changing the model of a session that has started is not wired yet.';
        m.wantModel = patch.model;
      }
      publishFollowed(['info', 'usage']);
      return null;
    },
    setConnector(name, on) {
      const c = deps.connectors;
      if (!c) { log.warn('turning a connector on or off needs the desktop host'); return; }
      void track(c.setEnabled(name, on).then(reloadMcp)).catch((e: unknown) => { log.warn('could not switch a connector', e); void reloadMcp().catch(() => undefined); });
    },
    async signIn(name) {
      const c = deps.connectors;
      if (!c) { log.warn('signing in to a connector needs the desktop host'); return; }
      try { await c.signin(name); } finally { await reloadMcp().catch(() => undefined); }
    }
  };
  const runSource: RunSource = {
    current: watch(run),
    stop() { const gw = deps.gwId(runFocus()); if (gw) client.request('session.interrupt', { session_id: gw }).catch((e: unknown) => { log.warn('could not stop', e); }); },
    setSetting(key, on) { if (key === 'governed') void source.setGovernance({ governed: on }); else log.warn('the sandbox network switch is not wired yet'); }
  };

  return {
    source, run: runSource, unavailable, model, start, diffFiles: (id) => diffFilesFrom(model(id).diff),
    files: {
      async complete(word, uiId) {
        const gw = uiId ? deps.gwId(uiId) : null;
        if (!gw) return { items: [], unavailable: 'Mentions need a started session: send a first message.' };
        try {
          const r = (await client.requestRaw('complete.path', { session_id: gw, cwd: model(uiId ?? '').info?.cwd ?? null, word })) as CompletionWire;
          return { items: (r.items ?? []).map((i) => ({ text: i.text, display: i.display ?? i.text, meta: i.meta ?? '' })) };
        } catch (e) { return { items: [], unavailable: isUnknownMethod(e) ? 'This Hermes cannot complete file names (no complete.path).' : 'File names could not be listed: ' + (e instanceof Error ? e.message : String(e)) }; }
      }
    },
    onEvent(uiId, ev) {
      const parts = applyEvent(model(uiId), ev, now());
      if (!parts.length) return parts;
      const later: Part[] = parts.filter((p) => p === 'stats' || p === 'cascade' || p === 'diff');
      const here = parts.filter((p) => !later.includes(p));
      if (ev.type === 'message.complete') { schedule(uiId, ['info', 'usage', 'stats', 'cascade', 'diff']); flush(); } else if (later.length) schedule(uiId, later);
      if (uiId === followed) publishFollowed(here);
      else publishRun();
      return parts;
    },
    onBound(uiId) { void track(refresh(uiId, ALL)); },
    onSent(uiId, text) { const m = model(uiId); m.started = true; m.title = text.split('\n')[0]?.trim().slice(0, 80) ?? ''; publishRun(); },
    onLinkReady() { void track(read<McpStatusWire>('mcp.servers.status', {}).then((r) => { mcp = r; })); for (const [id] of models) if (deps.gwId(id)) void track(refresh(id, ALL)); },
    onReplayGap(uiId) { models.set(uiId, Object.assign(newModel(), { title: model(uiId).title, started: true })); void track(refresh(uiId, ALL)); },
    chosen(uiId) { const m = model(uiId); return { governed: m.wantGoverned, model: m.wantModel }; },
    governedAtCreation(uiId) { return pluginOk && (model(uiId).wantGoverned ?? (defaultMode ?? 'governed') === 'governed'); },
    async settled() { flush(); while (inflight.size) await Promise.allSettled([...inflight]); }
  };
}
