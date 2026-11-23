/* The live bots: each one a Hermes profile (ADR-0006), through Hermes's own methods and nothing else.
     the roster, a profile's model, role, skills and toolsets   `profiles.list`, `profiles.describe`, `profiles.configure`, `profiles.create`
     its schedule and its recent sessions                        `cron.manage` and `session.list` on the teammate's own link (the host's
                                                                  `connect(profile)`: Hermes binds a ticket to one profile)
     the models to pick from                                     `model.options` of the profile boopis is attached to, whose keys a new profile copies
     its look and boopis's own settings                          the plugin's store in the profile's `boopis/` folder (`plugin.boopis.bots.*`)
     archive, restore, delete                                    the plugin, through Hermes's `profile rename` and `profile delete`
     what its home needs beyond the profile                      the host (`../bots-bridge.ts`, ADR-0042): the plugins boopis manages, its
                                                                  boopis settings and Governed switch, the root's key wiring, its seat in groups
     setting its model                                           the host too (`bots_set_model`, `src-tauri/src/bots/model.rs`, the command
                                                                  line's own code): checked against what the bot can reach, written, read back
   a conversation with it                                     a session of its own profile on its own link (`./bot-chat.ts`)
   Nothing is written to a Hermes file here, and nothing is invented: what Hermes did not answer is null and says why in
   `info.notes`. */
import { sentenceFor, unlessEngine } from '../errors';
import { CONFIRM_MODEL } from '../bots-bridge';
import type { BotsBridge } from '../bots-bridge';
import { isFrontier } from '../../data/frontier';
import { logger } from '../../core/log';
import { NeedsConfirmation } from '../../data/confirm';
import { botIdBase, numbered } from '../../data/bot-id';
import { APPROVALS, SUGGESTIONS } from '../../data/bot-catalog';
import { TURN_LIMIT_DEFAULT } from '../../data/mock-groups';
import { scheduleWords } from '../../data/cron';
import { lineDiff, valueDiff } from '../../data/diff';
import type { BotPatch, BotSessions, BotsAdmin, BotsEvent, BotsSource, BotsSnapshot, CreatePlan, PlannedWrite, RemovalNote, SchedulesSource } from '../../data/provider';
import { emitter, feed, store } from '../../data/store';
import type { ArchivedBot, Bot, BotCatalog, BotInfo, BotJob, BotSession, Schedule, ThreadMessage } from '../../data/types';
import type { CronManageResult, ModelOptionsResult, ProfileRow, ProfilesDescribeResult, SessionListRow } from '../../vendor/hermes-shared/gateway-contract.generated';
import type { GatewayClient, GatewayEvent } from '../gateway';
import { whenLabel } from '../map';
import { isUnknownMethod } from './wire';
import { createBotChat } from './bot-chat';
import { botFrom, botName, capabilitiesFrom, isArchived, jobFrom, modelLabel, sessionFrom, sortJobs, splitModel } from './map-bots';
import type { Known, PluginBot } from './map-bots';

const log = logger('live-bots');

export interface BotsDeps {
  /** the user's own link: the roster, the models, the plugin */
  client: GatewayClient;
  /** a teammate's own link (Hermes binds a ticket to one profile); the desktop app's is the host's `connect(profile)` */
  linkTo?: (profile: string) => Promise<GatewayClient>;
  now?: () => Date;
  /** how often the roster is read again while the window is visible; null: never (tests) */
  pollMs?: number | null;
  /** the host's bot commands (the desktop app's); without them a bot is the bare profile the engine made */
  bridge?: BotsBridge | null;
  /** shows the one notice the host's repair left (a toast in the app) */
  notify?: (text: string) => void;
}
export interface LiveBots {
  source: BotsSource;
  schedules: SchedulesSource;
  /** the first roster is read (a failure is a note on the list, never a failed start) */
  ready: Promise<void>;
  /** tests: every read and refresh in flight has finished */
  settled(): Promise<void>;
  /** merged into `provider.info.unavailable` */
  unavailable: Readonly<Record<string, string>>;
}

export const NO_TEAMMATE_LINK = 'This build cannot talk to a teammate: its own link to the engine is not available here.';
export const NO_RUN_NOW = 'A routine cannot be run on demand from here yet.';
/** a bot's model is set by the host, which checks it against what the bot can reach and reads it back */
export const NO_MODEL_HOST = 'A bot’s model can be set in the desktop app.';
const FEATURED_LIMIT = 40;
const LOAD_AT_ONCE = 3;
const POLL_MS = 15_000;

interface Rec {
  row: ProfileRow;
  plugin: PluginBot | undefined;
  detail: Known['detail'];
  jobs: BotJob[] | null;
  sessions: BotSession[] | null;
  notes: Record<string, string>;
  loaded: boolean;
  /** what it is doing in a conversation now: overrides the state Hermes's roster gives */
  live?: { state: string; activity: string; attention: string | null };
}
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const asJson = <T>(v: unknown): T => v as T;
/** how many roster reads after the start look for the host's notice (its repair runs in the background after the first link) */
const NOTICE_TRIES = 8;

/** why a bot cannot be governed on `provider`/`model` (governed mode runs only on frontier models, ADR-0037), null when it can */
export function governedRefusal(name: string, provider: string | null | undefined, model: string | null | undefined): string | null {
  const m = (model ?? '').trim();
  if (m && isFrontier(provider ?? '', m)) return null;
  return (m ? name + ' runs on ' + m + '. ' : name + ' has no model yet. ') + sentenceFor('hx.bots.governed_needs_frontier');
}

export function createLiveBots(deps: BotsDeps): LiveBots {
  const { client } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const recs = new Map<string, Rec>();
  const events = emitter<BotsEvent>();
  const schedules = store<readonly Schedule[]>([]);
  let providerModels: { label: string; provider: string; model: string }[] = [];
  let providerSlugs: string[] = [];
  let currentModel: string | null = null;
  let defaultHome: string | null = null;
  let profileNames = new Set<string>();
  let ownRecords: Map<string, PluginBot> = new Map();
  let rosterNote: string | null = null;
  /** the roster has been read once: the bots it had then were given what they need by the host's repair at start */
  let rosterSeen = false;
  /** bots this module makes or restores itself, which it prepares in that flow */
  const preparing = new Set<string>();
  const pending = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { pending.add(p); const done = (): void => { pending.delete(p); }; p.then(done, done); return p; };

  /* ───────── a conversation with a teammate ───────── */
  const chat = createBotChat({
    link: (id) => link(id), emit: (ev) => { events.emit(ev); }, now,
    live(id, st) { const r = recs.get(id); if (!r) return; if (st) r.live = st; else delete r.live; events.emit({ type: 'bot', bot: toBot(r) }); },
    changed(id) { const r = recs.get(id); if (r?.loaded) void track(loadLinked(id, r)); }
  });

  /* ───────── a teammate's own link ───────── */
  const links = new Map<string, Promise<GatewayClient>>();
  function link(id: string): Promise<GatewayClient> {
    let l = links.get(id);
    if (!l) {
      if (!deps.linkTo) return Promise.reject(new Error('this build cannot open a teammate’s own link'));
      l = deps.linkTo(id).then((c) => {
        c.onEvent((ev) => { onTeammateEvent(id, ev); });
        return c;
      });
      links.set(id, l);
      l.catch(() => { if (links.get(id) === l) links.delete(id); });
    }
    return l;
  }
  async function closeLink(id: string): Promise<void> {
    const l = links.get(id);
    links.delete(id);
    if (l) await l.then((c) => c.close(), () => undefined);
  }
  function onTeammateEvent(id: string, ev: GatewayEvent): void {
    if (chat.onEvent(id, ev)) return;
    if (ev.type === 'cron.changed' || ev.type === 'sessions.changed') { const r = recs.get(id); if (r?.loaded) void track(loadLinked(id, r)); }
  }

  /* ───────── what is known of a bot, as a Bot ───────── */
  const known = (r: Rec): Known => ({ row: r.row, plugin: r.plugin, detail: r.detail, jobs: r.jobs, sessions: r.sessions, notes: r.notes as BotInfo['notes'] });
  const toBot = (r: Rec): Bot => {
    const b = botFrom(known(r), now().getTime() / 1000);
    return r.live ? { ...b, state: r.live.state, activity: r.live.activity, attention: r.live.attention } : b;
  };
  const snapshotBots = (): Bot[] => [...recs.values()].map(toBot);
  const emptyThreads = (): Record<string, readonly ThreadMessage[]> => Object.fromEntries([...recs.keys()].map((id) => [id, [...chat.thread(id)]]));

  function rebuildSchedules(): void {
    const out: Schedule[] = [];
    for (const [id, r] of recs) for (const j of r.jobs ?? []) out.push({ id: id + '/' + j.id, bot: id, what: j.name || j.prompt, when: scheduleWords(j.schedule), next: j.enabled ? j.next : '', paused: !j.enabled });
    schedules.set(out);
  }

  /* ───────── the roster ───────── */
  const archivedNow = store<readonly ArchivedBot[]>([]);
  async function readOwn(): Promise<Map<string, PluginBot>> {
    try {
      const res = asJson<{ bots?: PluginBot[] }>(await client.requestRaw('plugin.boopis.bots.read', {}));
      return new Map((res.bots ?? []).map((b) => [b.name, b]));
    } catch (e) {
      log.warn('the teammates’ own records could not be read', e);
      return new Map();
    }
  }
  const emitFor = (before: Bot | undefined, after: Bot): void => {
    if (!before) events.emit({ type: 'bot-created', bot: after });
    else if (JSON.stringify(before) !== JSON.stringify(after)) events.emit({ type: 'bot', bot: after });
  };
  let refreshing: Promise<void> | null = null;
  let again = false;
  /** reads the roster; callers that arrive meanwhile share the next read, so a burst of events costs two reads at most */
  function refreshRoster(): Promise<void> {
    if (refreshing) { again = true; return refreshing; }
    refreshing = (async () => {
      try { do { again = false; await readRoster(); } while (again); } finally { refreshing = null; }
      void lookForNotice();
    })();
    return track(refreshing);
  }
  async function readRoster(): Promise<void> {
    let rows: ProfileRow[];
    try {
      const listed = await client.request('profiles.list', { include_sessions: true });
      rows = listed.profiles ?? [];
      rosterNote = null;
    } catch (e) {
      rosterNote = isUnknownMethod(e) ? 'This version of boopis\'s engine cannot list bots.' : 'The bots could not be read: ' + why(e);
      (isUnknownMethod(e) ? log.info : log.warn)('profiles.list failed', e);
      return;
    }
    ownRecords = await readOwn();
    profileNames = new Set(rows.map((r) => r.name));
    defaultHome = rows.find((r) => r.is_default)?.path ?? defaultHome;
    const mine = rows.filter((r) => !r.is_default && r.name !== 'default');
    const live = mine.filter((r) => !isArchived(r.name, ownRecords.get(r.name)));
    const gone = new Set([...recs.keys()].filter((id) => !live.some((r) => r.name === id)));
    const hadBefore = new Set(recs.keys());
    for (const row of live) {
      const plugin = ownRecords.get(row.name);
      const had = recs.get(row.name);
      const before = had ? toBot(had) : undefined;
      const r: Rec = had ?? { row, plugin, detail: null, jobs: null, sessions: fromRow(row), notes: {}, loaded: false };
      r.row = row; r.plugin = plugin;
      if (!r.loaded) r.sessions = r.sessions ?? fromRow(row);
      if (plugin?.problem) r.notes['store'] = plugin.problem; else delete r.notes['store'];
      if (ownRecords.size === 0 && !had) r.notes['store'] = r.notes['store'] ?? 'boopis’s own record of this teammate was not read, so its look is the one its name gives it';
      recs.set(row.name, r);
      if (r.loaded) emitFor(before, toBot(r)); else if (!had) { events.emit({ type: 'bot-created', bot: toBot(r) }); void track(loadDetail(row.name)); }
    }
    /* a bot that appears while the app runs, made anywhere else (the engine's own CLI, another client): given what its
       home needs once, like one made here (ADR-0042); one after another, so the host restarts the gateway once at most */
    const appeared = rosterSeen ? live.filter((row) => !hadBefore.has(row.name) && !preparing.has(row.name)).map((row) => row.name) : [];
    rosterSeen = true;
    if (appeared.length) void track((async () => { for (const id of appeared) await prepare(id, true); })());
    for (const id of gone) { recs.delete(id); chat.forget(id); events.emit({ type: 'bot-archived', id }); void closeLink(id); }
    if (ownRecords.size) for (const row of live) giveHandoffs(row.name);
    const t = now();
    archivedNow.set(mine.filter((r) => isArchived(r.name, ownRecords.get(r.name))).map((r): ArchivedBot => {
      const p = ownRecords.get(r.name);
      const at = p?.archived?.at ?? '';
      return { id: r.name, name: botName(r), was: p?.archived?.name ?? r.name.replace(/^archived--/, ''), at, when: at ? whenLabel(Date.parse(at) / 1000, t) : '' };
    }).sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0)));   /* the newest first; an archive with no date goes last */
    rebuildSchedules();
  }
  /** Every teammate is given the hand-off skill once per run of boopis (`plugin.boopis.bots.guide`, idempotent): the engine tells a
   *  room member nothing about the kanban board, so a cut-off turn files the same cards again and ordered cards run in parallel.
   *  A plugin that has no such method (an older one) is left alone. */
  const guided = new Set<string>();
  function giveHandoffs(name: string): void {
    if (guided.has(name)) return;
    guided.add(name);
    void track(client.requestRaw('plugin.boopis.bots.guide', { name }).then(() => undefined, (e: unknown) => { (isUnknownMethod(e) ? log.info : log.warn)('the hand-off skill was not given to ' + name, e); }));
  }
  /** a session row of the roster, for a teammate whose own link is not open (or not yet): the newest one Hermes names */
  function fromRow(row: ProfileRow): BotSession[] {
    const s = row.last_session;
    return s ? [{ id: s.id, title: (s.title ?? '').trim() || (s.preview ?? '').trim(), when: '', messages: typeof s.message_count === 'number' ? s.message_count : null, source: '' }] : [];
  }

  /* ───────── what one teammate reports (read when it is opened, and when it changes) ───────── */
  const queue: (() => void)[] = [];
  let running = 0;
  const slot = (): Promise<() => void> => new Promise((resolve) => {
    const go = (): void => { running++; resolve(() => { running--; queue.shift()?.(); }); };
    if (running < LOAD_AT_ONCE) go(); else queue.push(go);
  });
  const loading = new Map<string, Promise<void>>();
  function loadDetail(id: string): Promise<void> {
    const r = recs.get(id);
    if (!r) return Promise.resolve();
    const existing = loading.get(id);
    if (existing) return existing;
    const p = (async () => {
      const release = await slot();
      try {
        const before = toBot(r);
        try {
          const d = await client.request('profiles.describe', { name: id }) as ProfilesDescribeResult;
          r.detail = { ...capabilitiesFrom(d), soul: d.soul ?? '', model: d.model?.default ?? null, provider: d.model?.provider ?? null, role: d.description ?? null };
          delete r.notes['detail'];
        } catch (e) { r.notes['detail'] = 'boopis could not read this bot\'s details: ' + why(e); log.warn('profiles.describe failed', e); }
        await loadLinked(id, r);
        r.loaded = true;
        emitFor(before, toBot(r));
        rebuildSchedules();
      } finally { release(); loading.delete(id); }
    })();
    loading.set(id, p);
    return track(p);
  }
  /** its routines and sessions, on its own link */
  async function loadLinked(id: string, r: Rec): Promise<void> {
    try {
      const c = await link(id);
      const [cron, sess] = await Promise.all([
        c.request('cron.manage', { action: 'list', include_disabled: true }) as Promise<CronManageResult>,
        c.request('session.list', { limit: 8, include_hidden: false }) as Promise<{ sessions: SessionListRow[] }>
      ]);
      const t = now();
      if (cron.error) { r.jobs = null; r.notes['jobs'] = 'The schedule could not be read: ' + unlessEngine('hx.engine.refused', cron.error); } else { r.jobs = sortJobs((cron.jobs ?? []).map((j) => jobFrom(j, t))); delete r.notes['jobs']; }
      r.sessions = (sess.sessions ?? []).map((s) => sessionFrom(s, t)); delete r.notes['sessions'];
    } catch (e) {
      const t = 'Its schedule and sessions could not be read: ' + why(e);
      r.jobs = r.jobs ?? null; r.notes['jobs'] = t; r.notes['sessions'] = t;
      log.warn('a teammate’s link failed', e);
    }
    const bot = toBot(r);
    events.emit({ type: 'bot', bot });
    rebuildSchedules();
  }
  const need = (id: string): Rec => { const r = recs.get(id); if (!r) throw new Error('there is no teammate called ' + id); return r; };
  const governed = (r: Rec): boolean => r.plugin?.record?.settings?.gov === 'governed';

  /* ───────── what its home needs: the host's (ADR-0042) ───────── */
  /** gives the bot what its home needs; what could not be done is a note on the bot, never a failed save */
  async function prepare(id: string, fresh: boolean): Promise<void> {
    if (!deps.bridge) return;
    let problems: readonly string[];
    try { problems = (await deps.bridge.prepare(id, fresh)).problems; }
    catch (e) { problems = [why(e)]; }
    noteSetup(id, problems);
  }
  function noteSetup(id: string, problems: readonly string[]): void {
    const r = recs.get(id);
    if (problems.length) {
      log.warn('a bot was not given everything its home needs: ' + id, problems);
      if (r) r.notes['setup'] = 'boopis could not finish setting it up: ' + problems.join('; ');
    } else if (r) delete r.notes['setup'];
    if (r) events.emit({ type: 'bot', bot: toBot(r) });
  }
  /** the bot's model, set by the host the one way it is set (`bots_set_model`: checked against what the bot can reach, written,
      read back, then the bot prepared); what preparing could not do is a note. A model the engine asks about first is a
      NeedsConfirmation carrying its question */
  async function setModel(id: string, next: { provider: string; model: string }, confirm: boolean): Promise<void> {
    if (!deps.bridge) throw new Error(NO_MODEL_HOST);
    try { noteSetup(id, (await deps.bridge.setModel(id, next.provider, next.model, confirm)).problems); }
    catch (e) { throw (e as { code?: unknown } | null)?.code === CONFIRM_MODEL ? new NeedsConfirmation(why(e)) : e; }
  }
  async function release(id: string): Promise<void> {
    if (!deps.bridge) return;
    try { await deps.bridge.release(id); } catch (e) { log.warn('a bot kept its seat in groups: ' + id, e); }
  }
  let noticeTries = NOTICE_TRIES;
  async function lookForNotice(): Promise<void> {
    if (!deps.bridge || noticeTries <= 0) return;
    noticeTries--;
    try {
      const text = await deps.bridge.notice();
      if (text) { noticeTries = 0; deps.notify?.(text); }
    } catch (e) { log.info('the host had no notice to give', e); }
  }

  /* ───────── the models to pick from ───────── */
  async function readModels(): Promise<void> {
    try {
      const o = await client.request('model.options', {}) as ModelOptionsResult;
      const out: typeof providerModels = [];
      for (const p of o.providers ?? []) {
        if (p.authenticated === false) continue;
        const featured = p.featured_models?.length ? p.featured_models : (p.models ?? []).slice(0, FEATURED_LIMIT);
        for (const m of featured) out.push({ label: p.slug + '/' + m, provider: p.slug, model: m });
      }
      providerModels = out;
      providerSlugs = (o.providers ?? []).map((p) => p.slug);
      currentModel = o.model ? modelLabel(o.provider, o.model) : null;
    } catch (e) { (isUnknownMethod(e) ? log.info : log.warn)('model.options failed', e); }
  }
  const modelList = (): string[] => {
    const labels = providerModels.map((m) => m.label);
    return currentModel && !labels.includes(currentModel) ? [currentModel, ...labels] : labels;
  };
  const resolveModel = (label: string): { provider: string; model: string } => {
    const hit = providerModels.find((m) => m.label === label);
    if (hit) return { provider: hit.provider, model: hit.model };
    const split = splitModel(label, providerSlugs);
    if (!split) throw new Error('"' + label + '" is not a model of a configured provider');
    return split;
  };

  /* ───────── the plugin ───────── */
  const plug = <T>(method: string, params: Record<string, unknown>): Promise<T> => client.requestRaw('plugin.boopis.' + method, params) as Promise<T>;

  /* ───────── the admin: what only a real profile has ───────── */
  const base = (id: string): string => 'profiles/' + id + '/';
  const rolesOf = (r: Rec): string => (r.detail?.role ?? r.row.description ?? '').trim();

  function planCreate(name: string): CreatePlan {
    const wanted = botIdBase(name).replace(/^archived-+/, '') || 'bot';
    const taken = (n: string): boolean => profileNames.has(n) || recs.has(n);
    const profile = taken(wanted) || wanted === 'default' ? numbered(wanted, taken) : wanted;
    const notes: string[] = [];
    if (profile !== (name || '').trim().toLowerCase()) notes.push(name.trim() ? 'It will be called ' + profile + ': a bot\'s folder is named with lower case letters, digits and hyphens, and each name is used once.' : '');
    const model = currentModel && modelList().includes(currentModel) ? currentModel : modelList()[0] ?? null;
    if (!model) notes.push('No model provider is set up yet, so this bot is made without a model and cannot run until you add one.');
    return { profile, folder: defaultHome ? defaultHome.replace(/[\\/]+$/, '') + '/profiles/' + profile : null, model, notes: notes.filter(Boolean) };
  }

  const admin: BotsAdmin = {
    models: modelList,
    planCreate,
    async open(id) {
      need(id);
      await loadDetail(id);
      return toBot(need(id)).info as BotInfo;
    },
    async create(draft, opts) {
      const plan = planCreate(draft.name);
      const params: Record<string, unknown> = { name: plan.profile, description: draft.role.trim(), no_alias: true };
      if (draft.instructions.trim()) params['soul'] = draft.instructions.trim() + '\n';
      /* made on the main profile's model; its own is set by the host once its home has its provider's plugin (the engine could
         not resolve the provider for it before), and read back */
      const next = opts.model ? resolveModel(opts.model) : null;
      if (next && !deps.bridge) throw new Error(NO_MODEL_HOST);
      preparing.add(plan.profile);
      const made = await client.requestRaw('profiles.create', params).catch((e: unknown) => { preparing.delete(plan.profile); throw e; }) as { path?: string; warnings?: string[]; model_set?: boolean };
      try {
        /* a bot is ungoverned until the owner turns Governed on in its settings (ADR-0042) */
        await plug('bots.write', { name: plan.profile, look: { shape: draft.shape, color: draft.color }, settings: { gov: 'ungoverned', cap: '0.60', workspace: 'worktree' }, approvals: Object.fromEntries(APPROVALS.map((a) => [a.id, true])) });
      } catch (e) { log.warn('the new teammate’s own record was not saved', e); }
      if (made.warnings?.length) log.warn('Hermes warned while making ' + plan.profile + ': ' + made.warnings.join(' '));
      try {
        await refreshRoster(); await prepare(plan.profile, true);
        if (next && opts.model) {
          const asked = opts.model;
          /* it is made: a model it could not take is said on the bot, never as a bot that was not made */
          await setModel(plan.profile, next, false).catch((e: unknown) => {
            log.warn('a new teammate kept the main model', e);
            noteSetup(plan.profile, ['it runs on the main profile’s model, not ' + asked + ': ' + why(e) + (e instanceof NeedsConfirmation ? ' Pick it in its settings to confirm it.' : '')]);
          });
        }
      } finally { preparing.delete(plan.profile); }
      const r = need(plan.profile);
      await loadDetail(plan.profile);
      return toBot(r);
    },
    review(id, patch) {
      const r = need(id);
      const out: PlannedWrite[] = [];
      if (patch.role !== undefined) { const d = valueDiff(rolesOf(r), patch.role.trim()); if (d) out.push({ file: base(id) + 'profile.yaml: role', diff: d }); }
      if (patch.instructions !== undefined) { const d = lineDiff(r.detail?.soul ?? '', patch.instructions); if (d) out.push({ file: base(id) + 'SOUL.md', diff: d }); }
      if (patch.model !== undefined) { const d = valueDiff(modelLabel(r.detail?.provider, r.detail?.model) ?? '', patch.model); if (d) out.push({ file: base(id) + 'config.yaml: model', diff: d }); }
      const lines: string[] = [];
      for (const jobId of patch.removeRoutines ?? []) { const j = r.jobs?.find((x) => x.id === jobId); lines.push('- ' + (j ? scheduleWords(j.schedule) + ': ' + (j.name || j.prompt) : jobId)); }
      for (const j of patch.addRoutines ?? []) lines.push('+ ' + scheduleWords(j.schedule) + ': ' + (j.name || j.prompt));
      if (lines.length) out.push({ file: base(id) + 'cron: routines', diff: lines.join('\n') });
      return out;
    },
    async save(id, patch: BotPatch, opts) {
      const r = need(id);
      const failures: string[] = [];
      const params: Record<string, unknown> = { name: id };
      if (patch.role !== undefined) params['description'] = patch.role.trim();
      if (patch.instructions !== undefined) params['soul'] = patch.instructions;
      let next: { provider: string; model: string } | null = null;
      if (patch.model !== undefined) {
        next = resolveModel(patch.model);
        const refused = governed(r) ? governedRefusal(botName(r.row), next.provider, next.model) : null;
        if (refused) throw new Error(refused);
        if (!deps.bridge) throw new Error(NO_MODEL_HOST);
      }
      if (Object.keys(params).length > 1) {
        const res = await client.request('profiles.configure', params) as { ok?: boolean; applied?: Record<string, boolean | null> };
        for (const [key, ok] of Object.entries(res.applied ?? {})) if (ok === false) failures.push(({ soul: 'SOUL.md', description: 'the role' } as Record<string, string>)[key] ?? key);
      }
      /* the model is the host's to set: checked against what the bot can reach, written, read back, then the bot prepared */
      if (next) {
        try { await setModel(id, next, opts?.confirmModel === true); }
        catch (e) {
          if (e instanceof NeedsConfirmation) { r.loaded = false; await loadDetail(id); throw e; }
          failures.push('the model (' + why(e) + ')');
        }
      }
      if (patch.addRoutines?.length || patch.removeRoutines?.length) {
        try {
          const c = await link(id);
          for (const jobId of patch.removeRoutines ?? []) {
            const res = await c.request('cron.manage', { action: 'remove', name: jobId }) as CronManageResult;
            if (res.error) failures.push('removing a routine (' + res.error + ')');
          }
          for (const j of patch.addRoutines ?? []) {
            const res = await c.request('cron.manage', { action: 'add', name: j.name, schedule: j.schedule, prompt: j.prompt }) as CronManageResult;
            if (res.error) failures.push('the routine “' + (j.name || j.schedule) + '” (' + res.error + ')');
          }
        } catch (e) { failures.push('the routines (' + why(e) + ')'); }
      }
      r.loaded = false;
      await loadDetail(id);
      await refreshRoster();
      if (failures.length) throw new Error(failures.join(', ') + ' could not be saved. The rest was saved.');
    },
    async setRoutinePaused(id, jobId, paused) {
      const r = need(id);
      const c = await link(id);
      const res = await c.request('cron.manage', { action: paused ? 'pause' : 'resume', name: jobId }) as CronManageResult;
      if (res.error) throw new Error(res.error);
      await loadLinked(id, r);
    },
    async saveOwn(id, patch) {
      const r = need(id);
      const body: Record<string, unknown> = { name: id };
      if (patch.look) body['look'] = patch.look;
      if (patch.cfg) {
        const { approvals, ...settings } = patch.cfg;
        if (settings.gov === 'governed') {
          const refused = governedRefusal(botName(r.row), r.detail?.provider, r.detail?.model);
          if (refused) throw new Error(refused);
        }
        if (Object.keys(settings).length) body['settings'] = settings;
        if (approvals) body['approvals'] = approvals;
      }
      const res = await plug<{ record: PluginBot['record'] }>('bots.write', body);
      r.plugin = { ...(r.plugin ?? { name: id, path: r.row.path, problem: null, archived: null }), record: res.record };
      events.emit({ type: 'bot', bot: toBot(r) });
      if (patch.cfg?.gov) await prepare(id, false);   /* the Governed switch is the bot's plugin mode */
    },
    async removal(id): Promise<RemovalNote> {
      const r = need(id);
      const got = await plug<{ path: string; bytes: number; files: number; truncated: boolean; has_sessions: boolean; memory_files: number; skills: number; boopis_bytes: number }>('bots.inspect', { name: id });
      const mb = got.bytes < 1024 * 1024 ? Math.max(1, Math.round(got.bytes / 1024)) + ' KB' : (got.bytes / 1024 / 1024).toFixed(1) + ' MB';
      const lines = [
        'The folder ' + got.path + ' (' + mb + ' in ' + got.files + (got.truncated ? '+' : '') + ' files).',
        got.has_sessions ? 'All its sessions and what they said.' : 'It has no sessions.',
        got.memory_files ? 'Its memory (' + got.memory_files + ' ' + (got.memory_files === 1 ? 'file' : 'files') + ').' : 'It has no memory yet.',
        got.skills ? 'Its ' + got.skills + ' ' + (got.skills === 1 ? 'skill' : 'skills') + '.' : 'It has no skills of its own.',
        r.jobs === null ? 'Its routines, whatever they are.' : r.jobs.length ? 'Its ' + r.jobs.length + ' ' + (r.jobs.length === 1 ? 'routine' : 'routines') + '.' : 'It has no routines.',
        'Its look and its boopis settings.'
      ];
      return { folder: got.path, lines };
    },
    async archive(id) {
      const r = need(id);
      await loadDetail(id);
      const paused: string[] = [];
      try {
        const c = await link(id);
        for (const j of r.jobs ?? []) if (j.enabled) {
          const res = await c.request('cron.manage', { action: 'pause', name: j.id }) as CronManageResult;
          if (!res.error) paused.push(j.id);
        }
      } catch (e) { log.warn('a routine could not be paused before archiving', e); }
      await closeLink(id);
      let done: { name: string };
      try { done = await plug<{ name: string }>('bots.archive', { name: id, paused_jobs: paused }); }
      catch (e) {
        await resumeJobs(id, paused);
        throw e;
      }
      await release(id);
      await refreshRoster();
      return { undo: () => restoreArchived(done.name) };
    },
    async remove(id, confirm) {
      need(id);
      await closeLink(id);
      await plug('bots.delete', { name: id, confirm });
      await release(id);
      await refreshRoster();
    },
    note: () => rosterNote
  };
  /** brings an archived teammate back under its old name. A name that is in use again is refused before anything moves (the plugin refuses it too) */
  async function restoreArchived(name: string): Promise<void> {
    const was = archivedNow.get().find((a) => a.id === name)?.was;
    if (was && (profileNames.has(was) || recs.has(was))) throw new Error('there is a teammate called ' + was + ' already; archive or delete it, then restore');
    const coming = was ?? name.replace(/^archived--/, '');
    preparing.add(coming);   /* before it reappears, so a roster read meanwhile leaves it to this flow */
    let back: { name: string; paused_jobs: string[] };
    try { back = await plug<{ name: string; paused_jobs: string[] }>('bots.restore', { name }); } finally { preparing.delete(coming); }
    preparing.add(back.name);
    try { await refreshRoster(); await prepare(back.name, false); } finally { preparing.delete(back.name); }
    await resumeJobs(back.name, back.paused_jobs);
  }
  async function resumeJobs(id: string, jobs: readonly string[]): Promise<void> {
    if (!jobs.length) return;
    try {
      const c = await link(id);
      for (const j of jobs) await c.request('cron.manage', { action: 'resume', name: j });
      const r = recs.get(id);
      if (r) await loadLinked(id, r);
    } catch (e) { log.warn('the routines that were paused could not be resumed', e); }
  }

  /* ───────── the source ───────── */
  const catalog = (): BotCatalog => ({
    models: modelList(),
    /* Hermes's messaging channels are the profile's own and boopis does not set them; only this app is listed */
    channels: [{ id: 'app', name: 'This app', hint: 'always on' }],
    approvals: APPROVALS,
    suggestions: SUGGESTIONS,
    reserved: ['default']
  });
  const sessionsOf: BotSessions = { open: (id, sessionId) => { need(id); return chat.open(id, sessionId); }, fresh: (id) => { chat.fresh(id); }, current: (id) => chat.current(id) };
  const source: BotsSource = {
    ...feed<BotsSnapshot, BotsEvent>(() => ({ bots: snapshotBots(), threads: emptyThreads() }), events),
    catalog,
    send(id, text, via) {
      if (!recs.has(id)) { log.warn('there is no teammate called ' + id); return; }
      chat.send(id, text, via);
    },
    stop: (id) => chat.stop(id),
    workspace: (id) => chat.workspace(id),
    decide: (id, messageId, decision) => { chat.decide(id, messageId, decision); },
    update(id, patch) {
      if (patch.role !== undefined) admin.save(id, { role: patch.role }).catch((e: unknown) => { log.error('the role was not saved', e); });
      const { gov, cap, workspace, approvals } = patch.cfg ?? {};
      const own = { ...(gov ? { gov } : {}), ...(cap !== undefined ? { cap } : {}), ...(workspace ? { workspace } : {}) };
      if (Object.keys(own).length || approvals) admin.saveOwn(id, { cfg: { ...own, ...(approvals ? { approvals } : {}) } }).catch((e: unknown) => { log.error('the setting was not saved', e); });
      if (patch.look) admin.saveOwn(id, { look: patch.look }).catch((e: unknown) => { log.error('the look was not saved', e); });
    },
    create() { throw new Error('a bot is a folder of its own and is made with `admin.create`'); },
    archive(id) { admin.archive(id).catch((e: unknown) => { log.error('the bot was not archived', e); }); },
    archived: archivedNow,
    restore: restoreArchived,
    async runLimit(id) {
      need(id);
      if (!deps.bridge) return { turns: null, fallback: TURN_LIMIT_DEFAULT };
      return deps.bridge.runLimit(id);
    },
    async setRunLimit(id, turns) {
      need(id);
      if (!deps.bridge) throw new Error('The limit can be set in the desktop app.');
      return deps.bridge.setRunLimit(id, turns);
    },
    admin,
    sessions: sessionsOf
  };
  const schedulesSource: SchedulesSource = {
    list: schedules,
    runNow() { log.warn(NO_RUN_NOW); },
    setPaused(id, paused) {
      const at = id.indexOf('/');
      if (at < 0) return;
      admin.setRoutinePaused(id.slice(0, at), id.slice(at + 1), paused).catch((e: unknown) => { log.error('the routine was not ' + (paused ? 'paused' : 'resumed'), e); });
    }
  };

  /* ───────── the link ───────── */
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = (): void => { if (timer) return; timer = setTimeout(() => { timer = null; void refreshRoster(); }, 400); };
  client.onEvent((ev) => { if (ev.type === 'sessions.changed' || ev.type === 'cron.changed' || ev.type === 'profiles.changed') soon(); });
  client.onState((s) => { if (s.phase === 'ready' && s.reconnected) { void refreshRoster(); for (const [id, r] of recs) if (r.loaded) void track(loadLinked(id, r)); } });
  const poll = deps.pollMs === undefined ? POLL_MS : deps.pollMs;
  if (poll && typeof setInterval === 'function') setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void refreshRoster(); }, poll);

  const ready = Promise.all([readModels(), refreshRoster()]).then(() => undefined);
  return {
    source, schedules: schedulesSource, ready,
    settled: async () => { while (pending.size) await Promise.allSettled([...pending]); },
    unavailable: { ...(deps.linkTo ? {} : { 'bots.send': NO_TEAMMATE_LINK }), 'schedules.runNow': NO_RUN_NOW }
  };
}
