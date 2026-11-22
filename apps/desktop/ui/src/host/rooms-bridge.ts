/* The host's room settings as a small interface, so the live groups never touch Tauri and tests inject a fake. The engine has one
   pair of discussion limits for every room and none per room; boopis keeps its own cap on rounds for a group (the file
   `rooms.json` in the app's data folder, `boopis run --group` reads it) and these two commands read and write it. */
import { commands } from './bindings';
import { asHostError } from './bridge';

export type RoomsCommands = Pick<typeof commands, 'roomSettingsGet' | 'roomSettingsSet'>;

export interface RoomsBridge {
  get(roomId: string): Promise<{ rounds: number | null; fallback: number }>;
  set(roomId: string, rounds: number | null): Promise<{ rounds: number | null; fallback: number }>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriRoomsBridge(api: RoomsCommands = commands): RoomsBridge {
  const view = (v: { max_rounds: number | null; default_max_rounds: number }): { rounds: number | null; fallback: number } => ({ rounds: v.max_rounds, fallback: v.default_max_rounds });
  return {
    get: async (id) => view(await call(api.roomSettingsGet(id))),
    set: async (id, rounds) => view(await call(api.roomSettingsSet(id, rounds)))
  };
}
