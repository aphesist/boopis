/* The Session tab's S0 controls over the live link (ADR-0057, ADR-0058): the launch settings a session is created with, the
   capability map every control reads, the permission step (in place or continued), the yolo check and the rewind.

   - Launch: nothing is sent until the first message; then `session.create` carries the folder (`cwd`, `cwd_explicit`),
     the model and provider the person picked, the effort (`reasoning`) and `toolsets: ["boopis"]`, only the names
     `runtime.describe` lists, and `mode.set` the step and `surface: "session"` (session-launch.md 3.3).
   - The map: `capabilities.ts` from `runtime.describe`, the probes, the plugin's `describe {}`, its `describe {cwd}` for the
     launch folder, and the session's own `describe`. Refreshed on follow, on a launch change and when a read lands.
   - The step: among the three governed steps in place (`careful.set`); across the Full access line the provider continues
     the thread on a new engine session (`continueOn`). Either way the thread gets its line.
   - Yolo: another client can switch a session's yolo on, which approves the plugin's cards with no person; before each
     submit in a governed step it is read and switched back, and if that fails nothing is sent (section 5.6).
   - Rewind: `checkpoint.rewind`, its result mapped for the sheet, its line added by the provider. */
import { logger } from '../../core/log';
import { KEYS, readJSON, writeJSON } from '../../core/settings';
import { store } from '../../data/store';
import { CAREFUL_STEPS, DEFAULT_CAREFUL } from '../../data/session-s0';
import type { CarefulStep, LaunchSettings, NewLine, RewindResult, SessionCapabilities, SessionControls } from '../../data/session-s0';
import type { GatewayClient } from '../gateway';
import { capabilitiesFrom, launchStep, stepName } from './capabilities';
import type { FolderDescribe, PluginDescribe, SessionDescribe } from './capabilities';
import type { LiveDetails } from './details';
import { splitValue } from './models';
import { isUnknownMethod } from './wire';

const log = logger('live.session');
const PLUGIN = 'plugin.boopis.';
const CLIENT = { name: 'boopis', version: '0.2.0' };

export interface ControlsDeps {
  client: GatewayClient;
  details: LiveDetails;
  gwId(uiId: string): string | null;
  started(uiId: string): boolean;
  running(uiId: string): boolean;
  addLine(uiId: string, line: NewLine): void;
  /** continue the thread on a new engine session with this step; resolves with why not, or null */
  continueOn(uiId: string, step: CarefulStep, because: string): Promise<string | null>;
  head(uiId: string): string | null;
  /** the model the session answers with now ('provider/model' or the engine's id), '' when unknown */
  modelOf(uiId: string): string;
  /** the folder a new session starts in when nothing else says (Settings > Sessions' default) */
  defaultFolder?: string | null;
  pickFolder: (() => Promise<string | null>) | null;
}

interface Saved { careful?: CarefulStep; folder?: string | null }
const saved = (): Saved => readJSON<Saved>(KEYS.sessionLaunch) ?? {};
const save = (patch: Saved): void => { writeJSON(KEYS.sessionLaunch, { ...saved(), ...patch } as Record<string, unknown>); };
const isStep = (s: unknown): s is CarefulStep => typeof s === 'string' && (CAREFUL_STEPS as readonly string[]).includes(s);

export interface LiveControls extends SessionControls {
  /** the `session.create` params of a session about to be made, or why it cannot be (fail closed) */
  createParams(uiId: string): { params: Record<string, unknown> } | { refused: string };
  /** the `session.create` params of the engine session a started session continues on: its folder and model */
  continueParams(uiId: string): { params: Record<string, unknown> } | { refused: string };
  /** read what the launch folder offers (its gate) before the session is made, so the step is decided on what is known */
  prepare(uiId: string): Promise<void>;
  /** the `mode.set` params of a session just made */
  modeParams(uiId: string, gw: string): Record<string, unknown>;
  /** the yolo check; rejects when yolo is on and could not be switched off */
  yoloCheck(uiId: string, gw: string): Promise<void>;
  /** the session followed by the panels changed, or something it reads did */
  refresh(): void;
  /** the global reads; part of `ready` */
  start(): Promise<void>;
  /** tests: every read in flight is done */
  settled(): Promise<void>;
}

export function createControls(deps: ControlsDeps): LiveControls {
  const { client, details } = deps;
  const launches = new Map<string, { folder: string | null; pick: CarefulStep; effort: string | null }>();
  const folders = new Map<string, FolderDescribe | null>();
  let plugin: PluginDescribe | null = null;
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { inflight.add(p); void p.finally(() => { inflight.delete(p); }).catch(() => undefined); return p; };

  const followed = (): string => details.followedId();
  const launchOf = (uiId: string): { folder: string | null; pick: CarefulStep; effort: string | null } => {
    let l = launches.get(uiId);
    if (!l) {
      const s = saved();
      const cwd = details.model(followedBefore(uiId)).info?.cwd ?? null;
      l = { folder: s.folder ?? cwd ?? deps.defaultFolder ?? null, pick: isStep(s.careful) ? s.careful : DEFAULT_CAREFUL, effort: null };
      launches.set(uiId, l);
    }
    return l;
  };
  /* the folder a new session starts in by default is the project the person was looking at (its own folder) */
  let lastFollowed = '';
  const followedBefore = (uiId: string): string => (lastFollowed && lastFollowed !== uiId ? lastFollowed : uiId);

  function inputFor(uiId: string): Parameters<typeof capabilitiesFrom>[0] {
    const m = details.model(uiId), l = launchOf(uiId);
    const started = deps.started(uiId);
    const folder = started ? m.info?.cwd ?? m.describe?.session?.cwd ?? l.folder : l.folder;
    return {
      runtime: client.describe as Parameters<typeof capabilitiesFrom>[0]['runtime'],
      unavailable: details.unavailable,
      plugin,
      folder: folder ? folders.get(folder) ?? null : null,
      session: (m.describe?.session ?? null) as SessionDescribe | null,
      frontier: details.frontierView(uiId),
      launchFolder: l.folder,
      started, running: deps.running(uiId)
    };
  }
  const capsOf = (uiId: string): SessionCapabilities => capabilitiesFrom(inputFor(uiId));
  const capabilities = store<SessionCapabilities>(capsOf(''));
  const launchView = (uiId: string): LaunchSettings => {
    const l = launchOf(uiId);
    /* a started session's step is its own, as the plugin says it */
    const own = (details.model(uiId).describe?.session as SessionDescribe | null | undefined)?.careful;
    if (deps.started(uiId) && isStep(own)) return { folder: details.model(uiId).info?.cwd ?? l.folder, careful: own, effort: l.effort, fellBack: false };
    const { step, fellBack } = launchStep(l.pick, capsOf(uiId));
    return { folder: l.folder, careful: step, effort: l.effort, fellBack };
  };
  const launch = store<LaunchSettings>({ folder: null, careful: DEFAULT_CAREFUL, effort: null, fellBack: false });

  function publish(): void {
    const id = followed();
    capabilities.set(capsOf(id));
    launch.set(launchView(id));
  }
  /** what `describe {cwd}` says of a folder (its gate and the gate's sandbox), read once per folder and again on refresh */
  const reading = new Map<string, Promise<void>>();
  function readFolder(folder: string | null, again = false): Promise<void> {
    if (!folder || !plugin) return Promise.resolve();
    const now = reading.get(folder);
    if (now && !again) return now;
    if (!folders.has(folder)) folders.set(folder, null);
    const p = track((client.requestRaw(PLUGIN + 'describe', { cwd: folder }) as Promise<FolderDescribe>).then(
      (r) => { folders.set(folder, r); publish(); },
      (e: unknown) => { log.warn('what the folder offers could not be read', e); folders.delete(folder); reading.delete(folder); publish(); }
    ));
    reading.set(folder, p);
    return p;
  }

  const controls: LiveControls = {
    capabilities, launch, pickFolder: deps.pickFolder,
    head: (uiId) => deps.head(uiId),
    setLaunch(patch) {
      const id = followed();
      if (deps.started(id)) return 'The session has started: change it from the composer\'s line instead.';
      const l = launchOf(id);
      if (patch.folder !== undefined) { l.folder = patch.folder; save({ folder: patch.folder }); void readFolder(patch.folder); }
      if (patch.effort !== undefined) l.effort = patch.effort;
      if (patch.careful !== undefined) {
        const a = capsOf(id).launch.careful[patch.careful];
        if (!a.ok) return a.why;
        l.pick = patch.careful; save({ careful: patch.careful });
      }
      /* governed or not follows the step: Full access is the one ungoverned step */
      const why = details.source.setGovernance({ governed: launchView(id).careful !== 'full' });
      publish();
      return why;
    },
    async setCareful(step) {
      const id = followed(), gw = deps.gwId(id);
      if (!deps.started(id) || !gw) return controls.setLaunch({ careful: step });
      const a = capsOf(id).session.changeCareful[step];
      if (!a.ok) return a.why;
      const now = (details.model(id).describe?.session as SessionDescribe | null | undefined)?.careful;
      if (now === step) return null;
      if (a.inPlace) {
        try {
          const r = (await client.requestRaw(PLUGIN + 'careful.set', { session_id: gw, careful: step })) as { applies?: string } | null;
          deps.addLine(id, { kind: 'settings', text: 'Permissions changed to ' + stepName(step) + (r?.applies === 'next_turn' ? ' (applies when this turn ends)' : ''), cost: null });
          details.refreshSession(id);
          return null;
        } catch (e) { return 'Permissions were not changed: ' + reason(e); }
      }
      return deps.continueOn(id, step, stepName(step));
    },
    async rewind(uiId, shipId, o = {}) {
      const gw = deps.gwId(uiId);
      if (!gw) return { status: 'refused', isolation: 'refused', why: 'The session has not started yet.', files: [] };
      try {
        const r = (await client.requestRaw(PLUGIN + 'checkpoint.rewind', { session_id: gw, ship_id: shipId, ...(o.dryRun ? { dry_run: true } : {}), ...(o.expectHead ? { expect_head: o.expectHead } : {}) })) as RewindWire;
        return rewindFrom(r);
      } catch (e) { return { status: 'refused', isolation: 'refused', why: 'Nothing was rewound: ' + reason(e), files: [] }; }
    },
    createParams(uiId) {
      const caps = capsOf(uiId), l = launchView(uiId);
      if (!caps.launch.create.ok) return { refused: caps.launch.create.why };
      if (!l.folder) return { refused: 'Add a folder to start: a session works in a project folder.' };
      const a = caps.launch.careful[l.careful];
      if (!a.ok) return { refused: stepName(l.careful) + ' is not available: ' + a.why };
      const p = caps.engine.createParams;
      const chosen = details.chosen(uiId);
      const pick = chosen.model && !details.model(uiId).smart ? splitValue(chosen.model) : null;
      const params: Record<string, unknown> = { source: 'gui', cwd: l.folder, toolsets: ['boopis'] };
      if (p.has('cwd_explicit')) params['cwd_explicit'] = true;
      if (p.has('client')) params['client'] = CLIENT;
      if (pick?.model && p.has('model')) { params['model'] = pick.model; if (pick.provider && pick.provider !== 'auto' && p.has('provider')) params['provider'] = pick.provider; }
      if (l.effort && p.has('reasoning')) params['reasoning'] = l.effort;
      return { params };
    },
    continueParams(uiId) {
      const caps = capsOf(uiId), m = details.model(uiId);
      if (!caps.launch.create.ok) return { refused: caps.launch.create.why };
      const cwd = m.info?.cwd ?? m.describe?.session?.cwd ?? null;
      if (!cwd) return { refused: 'the session\'s folder is not known' };
      const p = caps.engine.createParams;
      const now = splitValue(deps.modelOf(uiId));
      const params: Record<string, unknown> = { source: 'gui', cwd, toolsets: ['boopis'] };
      if (p.has('cwd_explicit')) params['cwd_explicit'] = true;
      if (p.has('client')) params['client'] = CLIENT;
      if (now.model && p.has('model')) { params['model'] = now.model; if (now.provider && now.provider !== 'auto' && p.has('provider')) params['provider'] = now.provider; }
      return { params };
    },
    prepare: (uiId) => readFolder(deps.started(uiId) ? details.model(uiId).info?.cwd ?? null : launchOf(uiId).folder),
    modeParams(uiId, gw) {
      const step = launchView(uiId).careful;
      return { session_id: gw, mode: step === 'full' ? 'ungoverned' : 'governed', careful: step, surface: 'session' };
    },
    async yoloCheck(uiId, gw) {
      let on: unknown;
      try { on = ((await client.requestRaw('config.get', { session_id: gw, key: 'yolo' })) as { value?: unknown } | null)?.value; }
      catch (e) {
        if (isUnknownMethod(e)) return;   /* an engine with no per-session config cannot have another client switch it either */
        throw new Error('Whether this session approves everything on its own could not be read (' + reason(e) + '), so nothing was sent.');
      }
      if (on !== '1' && on !== 1 && on !== true && on !== 'on') return;
      try { await client.requestRaw('config.set', { session_id: gw, key: 'yolo', value: 'off' }); log.warn('yolo was on for a governed session; switched back', uiId); }
      catch (e) { throw new Error('Another app set this session to approve everything on its own, and boopis could not switch that off (' + reason(e) + '), so nothing was sent.'); }
    },
    refresh() {
      const id = followed();
      if (id !== lastFollowed) { if (lastFollowed && !launches.has(id) && !deps.started(id)) launchOf(id); lastFollowed = id; }
      const m = details.model(id);
      void readFolder(deps.started(id) ? m.info?.cwd ?? null : launchOf(id).folder);
      publish();
    },
    async start() {
      try { plugin = (await client.requestRaw(PLUGIN + 'describe', {})) as PluginDescribe; }
      catch (e) { plugin = null; log.info('the plugin\'s describe was not read: Session tab sessions cannot start', e); }
      controls.refresh();
    },
    async settled() { while (inflight.size) await Promise.allSettled([...inflight]); }
  };
  return controls;
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface RewindWire {
  status?: string; isolation?: string; why?: string; from_commit?: string; to_commit?: string;
  files?: { path?: string; action?: string }[]; rewind_ship_id?: string; undo?: { ship_id?: string } | null;
}
const ACTIONS = new Set(['restore', 'delete', 'recreate']);
const STATUSES = new Set(['rewound', 'planned', 'nothing_to_do', 'refused']);
/** the plugin's answer as the sheet reads it; anything it did not say stays unsaid (a status it did not give is a refusal) */
export function rewindFrom(r: RewindWire | null): RewindResult {
  const status = r?.status && STATUSES.has(r.status) ? (r.status as RewindResult['status']) : 'refused';
  const iso = r?.isolation === 'own_worktree' || r?.isolation === 'shared_unchanged' ? r.isolation : 'refused';
  return {
    status, isolation: iso,
    ...(r?.why ? { why: r.why } : status === 'refused' ? { why: 'The rewind was refused.' } : {}),
    ...(r?.from_commit ? { fromCommit: r.from_commit } : {}), ...(r?.to_commit ? { toCommit: r.to_commit } : {}),
    files: (r?.files ?? []).filter((f): f is { path: string; action: 'restore' | 'delete' | 'recreate' } => typeof f.path === 'string' && ACTIONS.has(f.action ?? '')),
    ...(r?.rewind_ship_id ? { rewindShipId: r.rewind_ship_id } : {}),
    ...(r?.undo?.ship_id ? { undo: { shipId: r.undo.ship_id } } : {})
  };
}
