/* The first-run setup commands of the host, as a small interface so the view never touches Tauri and tests inject a fake. */
import { commands, events } from './bindings';
import type { Answer, Check, ModelsView, SetupProgress, Source, SourceView_Serialize, Status_Deserialize } from './bindings';
import { asHostError } from './bridge';

export type SetupStatus = Status_Deserialize;
export type { SetupProgress, ModelsView, Source };
export type SourceInfo = SourceView_Serialize;

export interface SetupBridge {
  /** whether setup still has to run (read-only) */
  check(): Promise<Check>;
  /** run setup as far as it goes; `answer` replies to the open form, `reconsider` asks about a declined consent again. Calling it
      with neither runs every step again from reality: that is what "Retry" and "Check again" are */
  advance(answer: Answer | null, reconsider: boolean): Promise<SetupStatus>;
  /** which Hermes this run uses, so the first screen says what setup is about to do; null when the host cannot say */
  source(): Promise<SourceInfo | null>;
  /** be told how far the unpack has come while `advance` runs; resolves to a function that stops listening */
  onProgress(cb: (p: SetupProgress) => void): Promise<() => void>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriSetupBridge(): SetupBridge {
  return {
    check: () => call(commands.setupCheck(null)),
    advance: async (answer, reconsider) => (await call(commands.setupAdvance(null, answer, reconsider))) as SetupStatus,
    source: () => call(commands.hermesSourceGet()).catch(() => null),
    onProgress: (cb) => events.setupProgress.listen((e) => { cb(e.payload); })
  };
}

/** ask the host to forget the models choice, so the next `advance` asks it again (from a free-tier limit notice) */
export async function reopenModels(): Promise<void> {
  await call(commands.setupReopenModels(null));
}

/** the configured ladder, read through Hermes (Settings > Models) */
export const loadModelsView = (): Promise<ModelsView> => call(commands.setupModelsView(null));
/** the advanced setting "Use my own Hermes" (Settings > General) */
export const loadSource = (): Promise<SourceInfo> => call(commands.hermesSourceGet());
export const saveSource = (source: Source): Promise<SourceInfo> => call(commands.hermesSourceSet(source));
