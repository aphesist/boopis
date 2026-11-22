/* The mock store (ADR-0038): serves the fixture items of apps/shared/data/store.fixtures.json and the built-in sources through
   `StoreProvider`, so the store's screens can be built and tested without the host. It plays the host's part for everything
   a user can do (browse, search, review, install, update, roll back, remove, switch a source), and rejects with the same
   `hx.store.*` codes the host will (a removed item, an unpinned one, a plan that changed). It stages nothing and fetches
   nothing: the plans it makes for an item without a fixture plan are built from the item's own summary, and their hashes are
   a mock's (not a sha256 of anything). The fixture items are invented (see the file's description), never catalogue entries. */
import fixtureFile from '../../../../shared/data/store.fixtures.json';
import sourcesFile from '../../../../shared/data/store-sources.json';
import { store } from './store';
import type { StoreProvider } from './provider';
import type {
  InstallPlan, InstallReceipt, InstallRequest, ProjectPolicy, StageResult, StoreBrowse, StoreCodeRun, StoreComponent, StoreError, StoreFilter, StoreItem, StoreScope, StoreSource, StoreWarning, UpdateDiff
} from './types';

interface Fixtures { items: StoreItem[]; plans: InstallPlan[]; receipts: InstallReceipt[]; diffs: UpdateDiff[] }
const FX = fixtureFile as unknown as Fixtures;
const SRC = (sourcesFile as unknown as { sources: StoreSource[] }).sources;

const PAGE = 20;
const FETCHED = '2026-11-21T09:30:00Z';
const reject = (code: string, message: string): Promise<never> => Promise.reject<never>({ code, message } satisfies StoreError);
const clone = <T>(v: T): T => structuredClone(v);

/** a stand-in for a hash: 64 hex characters from the text (a mock's, not a sha256) */
function mockHash(text: string): string {
  let a = 0x811c9dc5; let out = '';
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < text.length; i++) { a ^= text.charCodeAt(i) + r; a = Math.imul(a, 0x01000193) >>> 0; }
    out += a.toString(16).padStart(8, '0');
  }
  return out;
}

export interface MockStoreOptions {
  /** start with nothing installed */
  empty?: boolean;
  /** pretend the network is down: the cache is served, `offline` is set, refreshes reject with `hx.store.offline` */
  offline?: boolean;
  /** more items, after the fixture's (the lab's long lists) */
  extraItems?: readonly StoreItem[];
  /** the sources as the host reports them at start: every one read (`read`, the default), or none read yet (`unread`: a first
      start, before the store has opened) */
  start?: 'read' | 'unread';
  /** how a source answers a read, by id, as the host would: after `ms` (Infinity: it never answers, for a read in progress),
      with the host's plain reason it could not be read (`error`), or with `items` */
  reads?: Readonly<Record<string, { ms?: number; error?: string; items?: number }>>;
  /** what "now" is for the times the sources report (the lab passes the real clock, so "read just now" stays true) */
  now?: () => number;
}

/** the two built-in places that hold nothing until the user adds one, and the fetches a read does not reach (as the host says) */
const NOT_READ = new Set(['compiled-in', 'github-api']);
const refreshableOf = (s: StoreSource): boolean => !NOT_READ.has(s.fetch) && !(!s.user_added && (s.id === 'marketplace-url' || s.id === 'local'));

export function createMockStore(opts: MockStoreOptions = {}): StoreProvider {
  const items = [...FX.items.map(clone), ...(opts.extraItems ?? []).map(clone)];
  const byId = (id: string): StoreItem | undefined => items.find((i) => i.id === id);
  const stamp = (): string => (opts.now ? new Date(opts.now()).toISOString() : FETCHED);
  const count = (id: string): number => items.filter((i) => i.source === id).length;
  const unread = opts.start === 'unread';
  const sources = store<readonly StoreSource[]>(SRC.map((s) => {
    const refreshable = refreshableOf(s);
    const read = !unread || !refreshable;
    return { ...clone(s), enabled: s.default_on, refreshed_at: read ? stamp() : null, items: read ? count(s.id) : 0, error: null, refreshable, stale: !read && s.default_on };
  }));
  const installed = store<readonly InstallReceipt[]>(opts.empty ? [] : FX.receipts.map(clone));
  const updates = store<readonly UpdateDiff[]>([]);
  const staged = new Map<string, InstallPlan>();
  const policy = new Map<string, boolean | null>();
  const GOVERNED = new Set(['~/work/api']);
  let nextStage = 0;

  const searched = (filter: StoreFilter | undefined): StoreItem[] => {
    /* a source holds items once it was read: before its first read the host has no copy of it */
    const on = new Set(sources.get().filter((s) => s.enabled && s.refreshed_at).map((s) => s.id));
    const have = new Set(installed.get().map((r) => r.item_id));
    return items.filter((i) => on.has(i.source)
      && (!filter?.kind || i.kind === filter.kind) && (!filter?.tier || i.tier === filter.tier) && (!filter?.source || i.source === filter.source)
      && (filter?.installed === undefined || have.has(i.id) === filter.installed)
      && !(filter?.hide_unpinned && i.pinned === null));
  };
  const page = (list: StoreItem[], cursor: string | null | undefined, recommended: boolean): StoreBrowse => {
    const at = Math.max(0, Number(cursor ?? 0) || 0);
    const slice = list.slice(at, at + PAGE);
    return {
      items: slice.map(clone), total: list.length, next_cursor: at + PAGE < list.length ? String(at + PAGE) : null,
      ...(recommended && at === 0 ? { recommended: list.filter((i) => i.tier === 'recommended').map(clone) } : {}),
      refreshed_at: opts.offline ? '2026-11-20T09:30:00Z' : FETCHED, stale: !!opts.offline || sources.get().some((s) => s.enabled && s.stale), offline: !!opts.offline
    };
  };
  const rank = (i: StoreItem, words: readonly string[]): number => {
    let score = 0;
    for (const w of words) {
      if (i.title.toLowerCase().includes(w)) score += 4;
      else if (i.id.toLowerCase().includes(w) || i.publisher.toLowerCase().includes(w)) score += 2;
      else if (i.summary.toLowerCase().includes(w) || i.tags?.some((t) => t.includes(w))) score += 1;
      else return 0;
    }
    return score;
  };

  /** the fixture's plan when the item has one, else one built from the item's summary */
  function planFor(item: StoreItem, scope: StoreScope): InstallPlan {
    const fixture = FX.plans.find((p) => p.item_id === item.id);
    if (fixture && JSON.stringify(fixture.scope) === JSON.stringify(scope)) return clone(fixture);
    const c = item.components;
    const components: StoreComponent[] = [
      ...Array.from({ length: c.skills }, (_, n): StoreComponent => ({ type: 'skill', name: `skill ${n + 1}` })),
      ...Array.from({ length: c.commands }, (_, n): StoreComponent => ({ type: 'command', name: `command ${n + 1}` })),
      ...Array.from({ length: c.hooks }, (_, n): StoreComponent => ({ type: 'hook', name: `hook ${n + 1}` })),
      ...Array.from({ length: c.mcp_servers }, (_, n): StoreComponent => ({ type: 'mcp-server', name: `server ${n + 1}` })),
      ...Array.from({ length: c.modules }, (_, n): StoreComponent => ({ type: 'module', name: `module ${n + 1}` })),
      ...Array.from({ length: c.python }, (_, n): StoreComponent => ({ type: 'python-plugin', name: `python file ${n + 1}` }))
    ];
    const layer = item.kind === 'connector' ? 'connector' : item.kind === 'plugin' || item.kind === 'mod' ? 'plugin' : 'engine';
    const code: StoreCodeRun[] = [
      ...(c.hooks ? [{ what: 'hook', command: 'hooks/hooks.json', where: 'outside-sandbox' } satisfies StoreCodeRun] : []),
      ...(c.scripts ? [{ what: 'script', command: 'scripts/', where: item.kind === 'mod' ? 'sandbox' : 'outside-sandbox' } satisfies StoreCodeRun] : []),
      ...(c.python ? [{ what: 'python', command: 'plugin files', where: 'engine-process' } satisfies StoreCodeRun] : []),
      ...(item.kind === 'connector' ? [{ what: 'mcp-command', command: item.pinned?.repo ?? 'remote server', where: 'outside-sandbox' } satisfies StoreCodeRun] : [])
    ];
    const warnings: StoreWarning[] = [{ code: 'next-session', level: 'info', text: 'It takes effect in new sessions.' }];
    if (item.tier === 'not-reviewed') warnings.unshift({ code: 'unreviewed', level: 'strong', text: 'Nobody has reviewed this item. Read what it runs before you install it.' });
    if (item.kind === 'engine-plugin') warnings.unshift({ code: 'engine-process', level: 'strong', text: 'This is Python that runs inside the engine, in every session, outside boopis\'s sandbox.' });
    const plan: InstallPlan = {
      item_id: item.id, kind: item.kind, title: item.title, source: item.source, publisher: item.publisher, version: item.version,
      pinned: item.pinned as NonNullable<StoreItem['pinned']>, tree_sha256: item.provenance.tree_sha256, stage_id: 'stg-mock', layer,
      components, code_runs: code, hosts: item.hosts, secrets: item.secrets, files_written: [{ path: '~/.local/share/boopis/engine/', purpose: 'the item\'s files' }],
      scope, consent: code.map((r, n) => ({ id: 'run-' + n, text: `Run ${r.command} (${r.where}).`, runs_code: true })), warnings,
      governed: { allowed: true, switch_blocks: item.kind === 'engine-plugin', text: item.kind === 'engine-plugin' ? 'Allowed. It runs in every session outside the sandbox; a governed project\'s switch is on by default and stops it there.' : 'Allowed.' },
      cost: { tools: null, context_tokens: null }, tier: item.tier, scan: item.provenance.scan, sessions_open: 0, plan_hash: ''
    };
    plan.plan_hash = mockHash(JSON.stringify({ ...plan, sessions_open: 0 }));
    return plan;
  }

  function refuse(item: StoreItem | undefined): Promise<never> | null {
    if (!item) return reject('hx.store.not_found', 'That item is not in the store.');
    if (item.removed) return reject('hx.store.removed', 'This item was taken down by its source, so it cannot be installed.');
    if (!item.pinned) return reject('hx.store.unpinned', 'This item is not pinned to an exact version, so boopis will not install it.');
    if (item.provenance.scan.verdict === 'dangerous') return reject('hx.store.dangerous_verdict', 'The check found something dangerous in this item, so boopis will not install it.');
    return null;
  }
  async function review(id: string, scope?: StoreScope): Promise<{ stage: StageResult; plan: InstallPlan }> {
    const item = byId(id);
    const bad = refuse(item); if (bad) return bad;
    const found = item as StoreItem;
    const plan = planFor(found, scope ?? installed.get().find((r) => r.item_id === id)?.scope ?? { level: 'bot', bot: 'default' });
    const stage_id = plan.stage_id ?? 'stg-' + (++nextStage);
    plan.stage_id = stage_id;
    staged.set(stage_id, plan);
    return { stage: { stage_id, item_id: id, pinned: plan.pinned, tree_sha256: plan.tree_sha256, files: plan.files_written.length, bytes: 0, scan: plan.scan, expires_at: '2026-11-21T10:30:00Z' }, plan: clone(plan) };
  }
  const policyOf = (project: string): ProjectPolicy => {
    const governed = GOVERNED.has(project); const explicit = policy.get(project) ?? null;
    return { project, governed, explicit, effective: explicit ?? governed };
  };

  return {
    can: { install: true },
    sources, installed, updates,
    browse: (filter, cursor) => Promise.resolve(page(searched(filter), cursor, !filter || Object.keys(filter).length === 0)),
    search(query, filter, cursor) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return Promise.resolve(page(searched(filter), cursor, false));
      const hits = searched(filter).map((i) => [i, rank(i, words)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([i]) => i);
      return Promise.resolve(page(hits, cursor, false));
    },
    detail(id) {
      const item = byId(id);
      if (!item) return reject('hx.store.not_found', 'That item is not in the store.');
      const planned = FX.plans.find((p) => p.item_id === id);
      return Promise.resolve({
        item: clone(item), installed: clone(installed.get().find((r) => r.item_id === id) ?? null), update: clone(updates.get().find((d) => d.item_id === id) ?? null),
        governed: planned?.governed ?? { allowed: true, switch_blocks: item.kind === 'engine-plugin', text: item.kind === 'engine-plugin' ? 'Allowed. It runs in every session outside the sandbox; governed projects can turn engine plugins off.' : 'Allowed.' },
        cost: planned?.cost ?? { tools: null, context_tokens: null }
      });
    },
    review,
    async install(req: InstallRequest) {
      const plan = staged.get(req.stage_id);
      if (!plan) return reject('hx.store.stage_missing', 'The downloaded copy is gone. Open the item again to download it.');
      if (req.plan_hash !== plan.plan_hash) return reject('hx.store.plan_changed', 'What would be installed changed since the card was shown, so nothing was installed. Review it again.');
      const have = installed.get().find((r) => r.item_id === plan.item_id);
      const update = have && updates.get().some((d) => d.item_id === plan.item_id);
      if (have && !update && have.pinned.value === plan.pinned.value) return reject('hx.store.already_installed', 'That item is already installed.');
      const receipt: InstallReceipt = {
        item_id: plan.item_id, kind: plan.kind, title: plan.title, source: plan.source, layer: plan.layer, version: plan.version, pinned: plan.pinned,
        plan_hash: plan.plan_hash, tree_sha256: plan.tree_sha256, installed_at: new Date().toISOString(), scope: plan.scope,
        files: plan.files_written.map((f) => f.path), enabled: true, effective: 'next-session',
        previous: have ? { version: have.version, pinned: have.pinned, tree_sha256: have.tree_sha256 } : null,
        steps: [{ name: 'stage', ok: true }, { name: 'install', ok: true }], notes: ['It takes effect in new sessions.']
      };
      installed.update((l) => [...l.filter((r) => r.item_id !== plan.item_id), receipt]);
      updates.update((l) => l.filter((d) => d.item_id !== plan.item_id));
      staged.delete(req.stage_id);
      return clone(receipt);
    },
    checkUpdates(id) {
      if (opts.offline) return reject('hx.store.offline', 'You are offline, so boopis cannot do that now. Browsing still works from the last copy it saved.');
      const have = new Set(installed.get().map((r) => r.item_id));
      const found = FX.diffs.filter((d) => have.has(d.item_id) && (!id || d.item_id === id)).map(clone);
      updates.update((l) => [...l.filter((d) => !found.some((f) => f.item_id === d.item_id)), ...found]);
      return Promise.resolve(found);
    },
    async reviewUpdate(id) {
      if (!installed.get().some((r) => r.item_id === id)) return reject('hx.store.not_installed', 'That item is not installed.');
      const diff = updates.get().find((d) => d.item_id === id);
      const out = await review(id);
      if (diff?.to) { out.plan.version = diff.to.version; out.plan.pinned = diff.to.pinned; out.plan.plan_hash = mockHash(JSON.stringify(out.plan)); staged.set(out.stage.stage_id, out.plan); }
      return { stage: out.stage, plan: clone(out.plan) };
    },
    setEnabled(id, enabled) {
      if (!installed.get().some((r) => r.item_id === id)) return reject('hx.store.not_installed', 'That item is not installed.');
      installed.update((l) => l.map((r) => (r.item_id === id ? { ...r, enabled } : r)));
      return Promise.resolve();
    },
    rollback(id) {
      const have = installed.get().find((r) => r.item_id === id);
      if (!have) return reject('hx.store.not_installed', 'That item is not installed.');
      if (!have.previous) return reject('hx.store.no_previous', 'There is no earlier version to go back to.');
      const back: InstallReceipt = { ...clone(have), version: have.previous.version, pinned: have.previous.pinned, tree_sha256: have.previous.tree_sha256 ?? null, previous: null, installed_at: new Date().toISOString() };
      installed.update((l) => l.map((r) => (r.item_id === id ? back : r)));
      return Promise.resolve(clone(back));
    },
    uninstall(id, o) {
      const have = installed.get().find((r) => r.item_id === id);
      if (!have) return reject('hx.store.not_installed', 'That item is not installed.');
      installed.update((l) => l.filter((r) => r.item_id !== id));
      updates.update((l) => l.filter((d) => d.item_id !== id));
      const keys = byId(id)?.secrets.map((s) => s.id) ?? [];
      return Promise.resolve({ item_id: id, removed: [...have.files], kept_secrets: o?.deleteSecrets ? [] : keys, notes: [] });
    },
    async refresh(source) {
      if (opts.offline) return reject('hx.store.offline', 'You are offline, so boopis cannot do that now. Browsing still works from the last copy it saved.');
      const ids = sources.get().filter((s) => (source ? s.id === source : s.enabled && s.refreshable)).map((s) => s.id);
      let failed: string | null = null;
      for (const id of ids) {
        const how = opts.reads?.[id] ?? {};
        if (how.ms) await new Promise((r) => { if (Number.isFinite(how.ms)) setTimeout(r, how.ms); });
        if (how.error) failed = how.error;
        sources.update((l) => l.map((s) => (s.id !== id ? s : how.error ? { ...s, error: how.error, stale: true } : { ...s, refreshed_at: stamp(), items: how.items ?? count(id), error: null, stale: false })));
      }
      if (failed && source) return reject('hx.store.source_unreachable', failed);
      return sources.get();
    },
    setSourceEnabled(id, enabled) {
      if (!sources.get().some((s) => s.id === id)) return reject('hx.store.invalid_source', 'That is not a source boopis knows.');
      sources.update((l) => l.map((s) => (s.id === id ? { ...s, enabled } : s)));
      return Promise.resolve();
    },
    addSource(input) {
      const where = input.url ?? input.path;
      if (!where || (input.url && !/^https:\/\//.test(input.url))) return reject('hx.store.invalid_source', 'That address is not one boopis can use as a source.');
      if (sources.get().some((s) => s.url === input.url && s.path === input.path)) return reject('hx.store.invalid_source', 'That source is already added.');
      const s: StoreSource = {
        id: 'added-' + mockHash(where).slice(0, 8), label: input.label ?? where, kinds: ['skill', 'connector', 'plugin', 'mod'], fetch: input.url ? 'git-marketplace' : 'local',
        default_tier: 'not-reviewed', default_on: true, user_added: true, engine_origin: false, ...(input.url ? { url: input.url } : { path: input.path as string }),
        terms: 'not-applicable', enabled: true, refreshed_at: FETCHED, items: 0, error: null
      };
      sources.update((l) => [...l, s]);
      return Promise.resolve(clone(s));
    },
    removeSource(id) {
      const s = sources.get().find((x) => x.id === id);
      if (!s?.user_added) return reject('hx.store.invalid_source', 'Only a source you added can be removed. Switch a built-in one off instead.');
      sources.update((l) => l.filter((x) => x.id !== id));
      return Promise.resolve();
    },
    projectPolicy: (project) => Promise.resolve(policyOf(project)),
    setProjectPolicy(project, block) { policy.set(project, block); return Promise.resolve(policyOf(project)); }
  };
}
