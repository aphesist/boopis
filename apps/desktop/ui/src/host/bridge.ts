/* The typed bridge to the Rust host (`src-tauri`): the gateway proxy as a small interface, so the gateway client and
   the live provider never touch Tauri directly and tests inject a fake. The commands and events are generated into
   bindings.ts (tauri-specta); never edit that file. The webview never sees a ticket, a token or a key: it holds only a
   connection id. */
import { Channel } from '@tauri-apps/api/core';
import { commands } from './bindings';
import type { Frame } from './bindings';
import { keepDetail, sentenceFor } from './errors';

export interface Connected {
  connectionId: number;
  /** the result of `runtime.describe` */
  describe: unknown;
}

/** an error from the host: a stable code (`hx.engine.unavailable`, `hx.engine.incompatible`, ...) and a message */
export class HostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HostError';
    this.code = code;
  }
}

export interface HostBridge {
  /** open a connection to the gateway of a profile (null: the active one); frames arrive on `onFrame` */
  connect(profile: string | null, onFrame: (frame: unknown) => void): Promise<Connected>;
  /** send a JSON-RPC frame; the host validates it and never alters `params` */
  send(connectionId: number, frame: unknown): Promise<void>;
  disconnect(connectionId: number): Promise<void>;
}

/** whether this page runs inside the Tauri webview */
export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** turn whatever `invoke` rejected with into a HostError */
export function asHostError(e: unknown): HostError {
  if (e instanceof HostError) return e;
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const { code, message } = e as { code: unknown; message: unknown };
    return new HostError(String(code), String(message));
  }
  /* not the host's: a script error or a cut-off call. Its words are raw, so the person reads the catalog's sentence and
     Diagnostics keeps them */
  const raw = e instanceof Error ? e.message : String(e);
  keepDetail('hx.host.unknown', raw);
  return new HostError('hx.host.unknown', sentenceFor('hx.host.unknown'));
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

/** the real bridge, over the generated commands and a Tauri Channel */
export function tauriBridge(): HostBridge {
  return {
    async connect(profile, onFrame) {
      const frames = new Channel<Frame>();
      frames.onmessage = (frame) => { onFrame(frame); };
      const done = await call(commands.gatewayConnect(profile, frames));
      return { connectionId: done.connection_id, describe: done.describe };
    },
    async send(id, frame) { await call(commands.gatewaySend(id, frame)); },
    async disconnect(id) { await call(commands.gatewayDisconnect(id)); }
  };
}
