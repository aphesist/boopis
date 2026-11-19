/* The first-run setup commands of the host, as a small interface so the view never touches Tauri and tests inject a fake. */
import { commands } from './bindings';
import type { Answer, Check, Status_Deserialize } from './bindings';
import { asHostError } from './bridge';

export type SetupStatus = Status_Deserialize;

export interface SetupBridge {
  /** whether setup still has to run (read-only) */
  check(): Promise<Check>;
  /** run setup as far as it goes; `answer` replies to the open form, `reconsider` asks about a declined consent again */
  advance(answer: Answer | null, reconsider: boolean): Promise<SetupStatus>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriSetupBridge(): SetupBridge {
  return {
    check: () => call(commands.setupCheck(null)),
    advance: async (answer, reconsider) => (await call(commands.setupAdvance(null, answer, reconsider))) as SetupStatus
  };
}

/** ask the host to forget the models choice, so the next `advance` asks it again (from a free-tier limit notice) */
export async function reopenModels(): Promise<void> {
  await call(commands.setupReopenModels(null));
}
