/* The host's bot commands (ADR-0042) as a small interface, so the live bots never touch Tauri and tests inject a fake. A bot
   is a profile the engine makes (`profiles.create`); what its home needs beyond that (the plugins boopis manages, its boopis
   settings and Governed switch, the root's key wiring, its seat in groups) is the host's to give, because the host runs the
   engine's own CLI in that home:
     prepare   after a bot is made (`fresh`), restored, or its model or Governed switch changed
     release   after a bot is archived or deleted: it leaves the groups
     notice    the one notice the host's repair at start left (bots made before governance was opt-in), taken once */
import { commands } from './bindings';
import { asHostError } from './bridge';

export type BotsCommands = Pick<typeof commands, 'botsPrepare' | 'botsRelease' | 'botsNotice'>;

export interface BotsBridge {
  /** give the bot what its home needs; `problems` are plain sentences, one per step that could not be done */
  prepare(name: string, fresh: boolean): Promise<{ changed: boolean; problems: readonly string[] }>;
  release(name: string): Promise<void>;
  notice(): Promise<string | null>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriBotsBridge(api: BotsCommands = commands): BotsBridge {
  return {
    prepare: (name, fresh) => call(api.botsPrepare(name, fresh)),
    release: async (name) => { await call(api.botsRelease(name)); },
    notice: () => call(api.botsNotice())
  };
}
