/* The typed bridge to the Rust host (`src-tauri`): the gateway proxy as a small interface, so the gateway client and
   the live provider never touch Tauri directly and tests inject a fake. The commands and events are generated into
   bindings.ts (tauri-specta); never edit that file. The webview never sees a ticket, a token or a key: it holds only a
   connection id. */
import { Channel } from '@tauri-apps/api/core';
import { commands } from './bindings';
import type { Frame } from './bindings';
import { keepDetail, sentenceFor } from './errors';
import { logger } from '../core/log';

const log = logger('bridge');

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

/** whether a frame is the host saying it closed this connection because the page fell too far behind */
const droppedAsSlow = (f: unknown): boolean => {
  const p = (f as { method?: unknown; params?: { type?: unknown; payload?: { state?: unknown; reason?: unknown } } } | null);
  return p?.method === 'event' && p.params?.type === 'connection.state' && p.params.payload?.state === 'degraded' && p.params.payload.reason === 'slow_consumer';
};

/** the real bridge, over the generated commands and a Tauri Channel.

    The host delivers frames in batches (a JSON array, or one frame alone) and sends the next batch only after the page
    acknowledges one (`gateway_ack`): a page that is busy, hidden or stuck takes no more, and the frames wait in the
    host's bounded queue, where runs of text merge, instead of piling up as scripts inside the web view. Each batch is
    handled to the end before it is acknowledged. A page that still fell so far behind that the host closed its
    connection reloads: it reads its sessions from the engine again instead of replaying every frame it missed. */
export function tauriBridge(reload: () => void = () => { location.reload(); }): HostBridge {
  return {
    async connect(profile, onFrame) {
      const frames = new Channel<Frame>();
      let id: number | null = null, owed = 0;
      const ack = (n: number): void => { if (id === null) { owed += n; return; } for (let i = 0; i < n; i++) commands.gatewayAck(id).catch(() => undefined); };
      frames.onmessage = (message) => {
        const batch: unknown[] = Array.isArray(message) ? message as unknown[] : [message];
        let slow = false;
        for (const f of batch) {
          if (droppedAsSlow(f)) slow = true;
          try { onFrame(f); } catch (e) { log.error('a frame from the host could not be handled', e); }   /* one bad frame must not cost the rest of its batch */
        }
        ack(1);
        if (slow) reload();
      };
      const done = await call(commands.gatewayConnect(profile, frames));
      id = done.connection_id;
      if (owed) { const n = owed; owed = 0; ack(n); }
      return { connectionId: done.connection_id, describe: done.describe };
    },
    async send(id, frame) { await call(commands.gatewaySend(id, frame)); },
    async disconnect(id) { await call(commands.gatewayDisconnect(id)); }
  };
}
