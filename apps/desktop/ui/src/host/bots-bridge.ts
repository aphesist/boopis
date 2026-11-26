/* The host's bot commands (ADR-0042) as a small interface, so the live bots never touch Tauri and tests inject a fake. A bot
   is a profile the engine makes (`profiles.create`); what its home needs beyond that (the plugins boopis manages, its boopis
   settings and Governed switch, the root's key wiring, its seat in groups) is the host's to give, because the host runs the
   engine's own CLI in that home:
     prepare   after a bot is made (`fresh`), restored, or its Governed switch changed
     setModel  a bot's model, the one way the host sets it for the app and the command line (`bots/model.rs`): refused when the
               bot cannot reach it (the sentence names what it can), written by the engine, read back; then the bot is prepared
     release   after a bot is archived or deleted: it leaves the groups
     notice    the one notice the host's repair at start left (bots made before governance was opt-in), taken once
     runLimit  the bot's cap on turns for a run from the command line (`goals.max_turns` in its own home), read and kept */
import { commands } from './bindings';
import { asHostError } from './bridge';

export type BotsCommands = Pick<typeof commands, 'botsPrepare' | 'botsSetModel' | 'botsRelease' | 'botsNotice' | 'botRunLimitGet' | 'botRunLimitSet'>;

/** the host's code for a model the engine asks the owner to confirm first; its message is the question */
export const CONFIRM_MODEL = 'hx.bots.confirm_model';

export interface BotsBridge {
  /** give the bot what its home needs; `problems` are plain sentences, one per step that could not be done */
  prepare(name: string, fresh: boolean): Promise<{ changed: boolean; problems: readonly string[] }>;
  /** make `provider`/`model` the bot's model (`confirm`: the owner said yes to the engine's question); the model read back, and
      what preparing the bot afterwards could not do. A refusal is a HostError whose message is the sentence to show */
  setModel(name: string, provider: string, model: string, confirm: boolean): Promise<{ provider: string; model: string; problems: readonly string[] }>;
  release(name: string): Promise<void>;
  notice(): Promise<string | null>;
  /** the bot's cap on turns for `boopis run --bot`, kept in its own configuration where the engine reads it */
  runLimit(name: string): Promise<{ turns: number | null; fallback: number }>;
  setRunLimit(name: string, turns: number | null): Promise<{ turns: number | null; fallback: number }>;
  /** a one-time owner grant (60 s, one use) the plugin redeems with the host before it changes a bot's tiers or cap (B47 H5) */
  ownerGrant?(purpose: 'bots.write.approvals' | 'bots.write.cap'): Promise<string>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriBotsBridge(api: BotsCommands = commands): BotsBridge {
  const view = (v: { max_turns: number | null; default_max_turns: number }): { turns: number | null; fallback: number } => ({ turns: v.max_turns, fallback: v.default_max_turns });
  return {
    prepare: (name, fresh) => call(api.botsPrepare(name, fresh)),
    setModel: (name, provider, model, confirm) => call(api.botsSetModel(name, provider, model, confirm)),
    release: async (name) => { await call(api.botsRelease(name)); },
    notice: () => call(api.botsNotice()),
    runLimit: async (name) => view(await call(api.botRunLimitGet(name))),
    setRunLimit: async (name, turns) => view(await call(api.botRunLimitSet(name, turns))),
    ownerGrant: (purpose) => call(commands.ownerGrant(purpose))
  };
}
