/* The store's host commands (docs/PROTOCOL.md section 1a) as a small interface, so the live provider never touches Tauri and
   tests inject a fake. The host validates every input again; nothing here returns a secret (a key goes in `install`'s request to
   the keychain and no further). Every call goes through the generated `commands` (`bindings.ts`), so a command or argument the
   host does not have is a compile error here, and `store-bridge.test.ts` checks that every `store_*` command is reached. */
import { commands } from './bindings';
import type {
  InstallReceipt, InstallPlan, InstallRequest, StageResult, StoreBrowse, StoreDetail, StoreFilter, StoreScope, StoreSource, UninstallResult, UpdateDiff
} from '../data/types';
import { asHostError } from './bridge';

/** the generated commands the store uses: the whole object in the app, a double in tests */
export type StoreCommands = Pick<typeof commands,
  'storeCatalogList' | 'storeSearch' | 'storeRefresh' | 'storeItemDetail' | 'storeStage' | 'storePlan' | 'storeInstall' | 'storeUninstall' |
  'storeInstalled' | 'storeUpdateCheck' | 'storeUpdate' | 'storeRollback' | 'storeSetEnabled' | 'storeSources' | 'storeSourceSetEnabled' |
  'storeSourceAdd' | 'storeSourceRemove'>;

export interface StoreBridge {
  catalogList(filter?: StoreFilter, cursor?: string | null, limit?: number): Promise<StoreBrowse>;
  search(query: string, filter?: StoreFilter, cursor?: string | null, limit?: number): Promise<StoreBrowse>;
  refresh(source?: string): Promise<StoreSource[]>;
  itemDetail(id: string): Promise<StoreDetail>;
  stage(id: string): Promise<StageResult>;
  plan(stageId: string, scope?: StoreScope): Promise<InstallPlan>;
  install(request: InstallRequest): Promise<InstallReceipt>;
  uninstall(id: string, deleteCredentials: boolean): Promise<UninstallResult>;
  installed(): Promise<InstallReceipt[]>;
  updateCheck(id?: string): Promise<UpdateDiff[]>;
  update(id: string, request: InstallRequest): Promise<InstallReceipt>;
  rollback(id: string): Promise<InstallReceipt>;
  /** switch an installed item on or off (takes effect in the next session) */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  sources(): Promise<StoreSource[]>;
  sourceSetEnabled(id: string, enabled: boolean): Promise<void>;
  sourceAdd(input: { url?: string; path?: string; label?: string }): Promise<StoreSource>;
  sourceRemove(id: string): Promise<void>;
}

const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

/* Two answers are cast, as `connectors-bridge.ts` casts its own: the generator types a byte count (`f64`) as `number | null`, which
   only a non-finite number would be and the host never sends, so the UI's `number` is right. Everything else is assigned as the
   generator typed it, so a field the host renames or drops fails to compile here. */
export function tauriStoreBridge(api: StoreCommands = commands): StoreBridge {
  return {
    catalogList: (filter, cursor, limit) => call(api.storeCatalogList(orNull(filter), orNull(cursor), orNull(limit))),
    search: (query, filter, cursor, limit) => call(api.storeSearch(query, orNull(filter), orNull(cursor), orNull(limit))),
    refresh: (source) => call(api.storeRefresh(orNull(source))),
    itemDetail: (id) => call(api.storeItemDetail(id, null)),
    stage: async (id) => (await call(api.storeStage(id, null))) as StageResult,
    plan: async (stageId, scope) => (await call(api.storePlan(stageId, orNull(scope), null))) as InstallPlan,
    install: (request) => call(api.storeInstall(request, null)),
    uninstall: (id, deleteCredentials) => call(api.storeUninstall(id, deleteCredentials, null)),
    installed: () => call(api.storeInstalled(null)),
    updateCheck: (id) => call(api.storeUpdateCheck(orNull(id), null)),
    update: (id, request) => call(api.storeUpdate(id, request, null)),
    rollback: (id) => call(api.storeRollback(id, null)),
    setEnabled: async (id, enabled) => { await call(api.storeSetEnabled(id, enabled, null)); },
    sources: () => call(api.storeSources()),
    sourceSetEnabled: async (id, enabled) => { await call(api.storeSourceSetEnabled(id, enabled)); },
    sourceAdd: (input) => call(api.storeSourceAdd(orNull(input.url), orNull(input.path), orNull(input.label))),
    sourceRemove: async (id) => { await call(api.storeSourceRemove(id)); }
  };
}
