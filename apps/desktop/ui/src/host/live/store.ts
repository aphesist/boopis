/* The store on the live provider: the host's `store_*` commands (host/store-bridge.ts) behind `StoreProvider`, and a project's
   switch over the plugin's `store.policy.*` RPCs. Nothing here is a fixture: what the host does not send is empty or unknown,
   and a failure rejects with the stable code and sentence (`{code, message}`), never the engine's own words (ADR-0031). */
import { logger } from '../../core/log';
import { store } from '../../data/store';
import type { StoreProvider } from '../../data/provider';
import type { InstallReceipt, InstallPlan, InstallRequest, ProjectPolicy, StageResult, StoreError, StoreScope, StoreSource, UpdateDiff } from '../../data/types';
import { unlessEngine } from '../errors';
import type { StoreBridge } from '../store-bridge';

const log = logger('store');

export interface LiveStoreOptions {
  /** the host's commands; null where there is no host (the page build): browsing and installing say so */
  bridge: StoreBridge | null;
  /** the plugin's RPCs over the gateway (`plugin.boopis.store.policy.get`); null: the project switch says it cannot be read */
  plugin?: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | null;
}

/** whatever a call rejected with, as the store's error: the stable code and a sentence that never quotes the engine */
export function toStoreError(e: unknown): StoreError {
  const o = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown };
  const code = typeof o.code === 'string' ? o.code : 'hx.host.unknown';
  const message = typeof o.message === 'string' && o.message ? o.message : 'boopis could not do that. Try again.';
  return { code, message: unlessEngine(code, message) };
}
const fail = (e: unknown): Promise<never> => Promise.reject<never>(toStoreError(e));
const noHost: StoreError = { code: 'hx.host.unavailable', message: 'The store works in the desktop app. This window has no connection to it.' };

export function createLiveStore(opts: LiveStoreOptions): StoreProvider & { settled(): Promise<void> } {
  const { bridge, plugin } = opts;
  const sources = store<readonly StoreSource[]>([]);
  const installed = store<readonly InstallReceipt[]>([]);
  const updates = store<readonly UpdateDiff[]>([]);
  /** stages made by `reviewUpdate`: their install is `store_update` */
  const updateStages = new Map<string, string>();
  const pending = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { pending.add(p); void p.finally(() => pending.delete(p)).catch(() => undefined); return p; };
  const need = (): StoreBridge => { if (!bridge) throw noHost; return bridge; };
  const loadSources = async (): Promise<void> => { try { sources.set(await need().sources()); } catch (e) { log.warn('the sources were not read', e); } };
  const loadInstalled = async (): Promise<void> => { try { installed.set(await need().installed()); } catch (e) { log.warn('the installed list was not read', e); } };
  if (bridge) { void track(loadSources()); void track(loadInstalled()); }

  const run = async <T>(fn: (b: StoreBridge) => Promise<T>): Promise<T> => {
    try { return await fn(need()); } catch (e) { return fail(e); }
  };
  const afterInstall = async (r: InstallReceipt): Promise<InstallReceipt> => {
    await loadInstalled();
    updates.update((l) => l.filter((d) => d.item_id !== r.item_id));
    return r;
  };
  const projectCall = async (method: string, params: Record<string, unknown>): Promise<ProjectPolicy> => {
    if (!plugin) return fail({ code: 'hx.host.unavailable', message: 'boopis cannot read this project\'s setting right now.' });
    try { return (await plugin('store.' + method, params)) as ProjectPolicy; } catch (e) { return fail(e); }
  };

  return {
    can: bridge ? { install: true } : { install: false, reason: noHost.message },
    sources, installed, updates,
    browse: (filter, cursor) => run((b) => b.catalogList(filter, cursor ?? null)),
    search: (query, filter, cursor) => run((b) => b.search(query, filter, cursor ?? null)),
    detail: (id) => run((b) => b.itemDetail(id)),
    async review(id: string, scope?: StoreScope): Promise<{ stage: StageResult; plan: InstallPlan }> {
      return run(async (b) => { const stage = await b.stage(id); return { stage, plan: await b.plan(stage.stage_id, scope) }; });
    },
    async install(request: InstallRequest): Promise<InstallReceipt> {
      const id = updateStages.get(request.stage_id);
      const r = await run((b) => (id ? b.update(id, request) : b.install(request)));
      updateStages.delete(request.stage_id);
      return afterInstall(r);
    },
    async checkUpdates(id) {
      const found = await run((b) => b.updateCheck(id));
      updates.update((l) => [...l.filter((d) => (id ? d.item_id !== id : false)), ...found]);
      return found;
    },
    async reviewUpdate(id) {
      const out = await run(async (b) => { const stage = await b.stage(id); return { stage, plan: await b.plan(stage.stage_id) }; });
      updateStages.set(out.stage.stage_id, id);
      return out;
    },
    async setEnabled(id, enabled) { await run((b) => b.setEnabled(id, enabled)); await loadInstalled(); },
    async rollback(id) { return afterInstall(await run((b) => b.rollback(id))); },
    async uninstall(id, o) {
      const r = await run((b) => b.uninstall(id, !!o?.deleteSecrets));
      await loadInstalled();
      updates.update((l) => l.filter((d) => d.item_id !== id));
      return r;
    },
    async refresh(source) {
      const list = await run((b) => b.refresh(source));
      sources.set(list);
      return list;
    },
    async setSourceEnabled(id, enabled) { await run((b) => b.sourceSetEnabled(id, enabled)); await loadSources(); },
    async addSource(input) { const s = await run((b) => b.sourceAdd(input)); await loadSources(); return s; },
    async removeSource(id) { await run((b) => b.sourceRemove(id)); await loadSources(); },
    projectPolicy: (project) => projectCall('policy.get', { cwd: project }),
    setProjectPolicy: (project, block) => projectCall('policy.set', { cwd: project, block }),
    settled: async () => { while (pending.size) await Promise.allSettled([...pending]); }
  };
}
