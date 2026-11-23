/* The host's rooms as a small interface, so the live groups never touch Tauri and tests inject a fake.
   - Settings: the engine has one pair of discussion limits for every room and none per room; boopis keeps its own cap on rounds
     for a group (the file `rooms.json` in the app's data folder, `boopis run --group` reads it).
   - The room hold (`rooms/hold.rs` in the host): a message written while a group's members work waits for them and goes out when
     the discussion is over, because the engine drops the answer of a member still working when a newer message arrives. The hold
     is the host's, one for every client (this window, `boopis groups send` and `run --group`, the local API), kept in a file so
     it survives the app closing; the host sends held messages when the room is free and says when what a room holds changed. */
import { commands, events } from './bindings';
import type { HeldMessage } from './bindings';
import { asHostError } from './bridge';

export type RoomsCommands = Pick<typeof commands, 'roomSettingsGet' | 'roomSettingsSet' | 'roomSend' | 'roomUnhold' | 'roomSendNow' | 'roomHeld'>;
export type { HeldMessage };

export interface RoomSendResult { status: 'sent' | 'held'; eventId: string; held: HeldMessage[] }

export interface RoomsBridge {
  get(roomId: string): Promise<{ rounds: number | null; fallback: number }>;
  set(roomId: string, rounds: number | null): Promise<{ rounds: number | null; fallback: number }>;
  /** a message into the room through the hold: sent now when the members are not working, else held; `now` stops them first */
  send(roomId: string, text: string, now: boolean): Promise<RoomSendResult>;
  /** takes a held message back: its words, or null when it had already gone out (or was taken back elsewhere) */
  unhold(roomId: string, id: string): Promise<{ text: string | null; held: HeldMessage[] }>;
  /** sends a held message now: the running turns stop first */
  sendNow(roomId: string, id: string): Promise<RoomSendResult>;
  /** what the room holds now (a held message from an earlier run of the app, or from the command line) */
  held(roomId: string): Promise<HeldMessage[]>;
  /** told whenever what a room holds changes, through any client; returns the way to stop listening */
  onHeld(fn: (roomId: string, held: HeldMessage[]) => void): Promise<() => void>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriRoomsBridge(api: RoomsCommands = commands): RoomsBridge {
  const view = (v: { max_rounds: number | null; default_max_rounds: number }): { rounds: number | null; fallback: number } => ({ rounds: v.max_rounds, fallback: v.default_max_rounds });
  const sent = (v: { status: string; event_id: string; held: HeldMessage[] }): RoomSendResult => ({ status: v.status === 'held' ? 'held' : 'sent', eventId: v.event_id, held: v.held });
  return {
    get: async (id) => view(await call(api.roomSettingsGet(id))),
    set: async (id, rounds) => view(await call(api.roomSettingsSet(id, rounds))),
    send: async (id, text, now) => sent(await call(api.roomSend(id, text, now))),
    unhold: async (id, held) => call(api.roomUnhold(id, held)),
    sendNow: async (id, held) => sent(await call(api.roomSendNow(id, held))),
    held: async (id) => call(api.roomHeld(id)),
    onHeld: (fn) => events.roomHeldEvent.listen((e) => { fn(e.payload.room_id, e.payload.held); })
  };
}
