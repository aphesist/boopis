/* The first-run setup commands of the host, as a small interface so the view never touches Tauri and tests inject a fake. */
import { commands, events } from './bindings';
import type { Answer, Check, EngineView, ModelsView, SetupProgress, Source, Status_Deserialize } from './bindings';
import { asHostError } from './bridge';

export type SetupStatus = Status_Deserialize;
export type { SetupProgress, ModelsView, Source };
export type SourceInfo = EngineView;

export interface SetupBridge {
  /** whether setup still has to run (read-only) */
  check(): Promise<Check>;
  /** run setup as far as it goes; `answer` replies to the open form, `reconsider` asks about a declined consent again. Calling it
      with neither runs every step again from reality: that is what "Retry" and "Check again" are */
  advance(answer: Answer | null, reconsider: boolean): Promise<SetupStatus>;
  /** which engine this run uses (the one boopis carries, or the machine's), so the first screen says what setup is about to
      do; null when the host cannot say */
  source(): Promise<SourceInfo | null>;
  /** be told how far the unpack has come while `advance` runs; resolves to a function that stops listening */
  onProgress(cb: (p: SetupProgress) => void): Promise<() => void>;
  /** what the host wrote for the models (the summary after the hub); absent where a bridge cannot say */
  modelsView?(): Promise<ModelsView>;
  /** the host forgets the models choice so the next `advance` asks it again (the summary's "change my starting model") */
  reopen?(): Promise<void>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriSetupBridge(): SetupBridge {
  return {
    check: () => call(commands.setupCheck(null)),
    advance: async (answer, reconsider) => (await call(commands.setupAdvance(null, answer, reconsider))) as SetupStatus,
    source: () => Promise.resolve(commands.engineSourceGet()).catch(() => null),
    onProgress: (cb) => events.setupProgress.listen((e) => { cb(e.payload); }),
    modelsView: () => call(commands.setupModelsView(null)),
    reopen: reopenModels
  };
}

/** ask the host to forget the models choice, so the next `advance` asks it again (from a free-tier limit notice) */
export async function reopenModels(): Promise<void> {
  await call(commands.setupReopenModels(null));
}

/** the configured ladder (Settings > Models) */
export const loadModelsView = (): Promise<ModelsView> => call(commands.setupModelsView(null));

/** turn a heavy model (`fable`, `grok`) on or off for the saved ladder: heavy models are token-heavy or costly, so none is on a
    ladder unless the user asked (ADR-0037); resolves with the view as it is after */
export const setHeavy = (id: string, on: boolean): Promise<ModelsView> => call(commands.setupSetHeavy(id, on, null));
