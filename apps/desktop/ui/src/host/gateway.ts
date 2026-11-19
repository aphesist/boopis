/* A JSON-RPC client for `hermes-gateway-v1` over the host's proxy. It correlates requests with responses, hands out
   events, tracks the link's state (`connection.state` frames from the host) and never answers a server request
   itself without a handler: an unanswered request would hang the agent's turn, so the default is a refusal.

   Types come from Hermes's generated contract (vendor/hermes-shared, MIT): `RpcMethods` maps a method to its params
   and result. Plugin methods (`plugin.boopis.*`) are not in it and go through `requestRaw`. */
import { logger } from '../core/log';
import type { RpcMethod, RpcMethods } from '../vendor/hermes-shared/gateway-contract.generated';
import { asHostError } from './bridge';
import type { HostBridge } from './bridge';

const log = logger('gateway');

export type Unsubscribe = () => void;

/** an event as the gateway sends it (`params` of a `method: "event"` notification) */
export interface GatewayEvent {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
  seq?: number;
  replay_epoch?: string;
  [key: string]: unknown;
}

export type LinkPhase = 'connecting' | 'ready' | 'degraded' | 'incompatible';
export interface LinkState {
  phase: LinkPhase;
  /** true on the `ready` that follows a loss: events were replayed */
  reconnected: boolean;
  error: { code: string; message: string } | null;
}

export interface ServerRequest { id: string | number; method: string; params: unknown }

/** a JSON-RPC error answered by the gateway or the host */
export class GatewayError extends Error {
  readonly rpcCode: number;
  /** the stable `hx.*` code when there is one (host errors carry it in `data.code`; plugin errors in the message) */
  readonly code: string;
  readonly data: unknown;
  constructor(rpcCode: number, message: string, data?: unknown) {
    super(message);
    this.name = 'GatewayError';
    this.rpcCode = rpcCode;
    this.data = data;
    const fromData = data && typeof data === 'object' && 'code' in data ? String((data as { code: unknown }).code) : '';
    this.code = fromData || /\bhx\.[a-z_.]+/.exec(message)?.[0] || '';
  }
}

interface Pending { resolve(v: unknown): void; reject(e: unknown): void; method: string }
interface Frame { id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string; data?: unknown } }

export class GatewayClient {
  private connectionId: number | null = null;
  private nextId = 1;
  private readonly pending = new Map<number | string, Pending>();
  private readonly eventSubs = new Set<(e: GatewayEvent) => void>();
  private readonly stateSubs = new Set<(s: LinkState) => void>();
  private serverHandler: ((r: ServerRequest) => Promise<unknown> | unknown) | null = null;
  private current: LinkState = { phase: 'connecting', reconnected: false, error: null };
  describe: unknown = null;

  constructor(private readonly bridge: HostBridge) {}

  state(): LinkState { return this.current; }

  /** open the connection; resolves when the link is ready (the host waits for the gateway's handshake) */
  async connect(profile: string | null = null): Promise<void> {
    const done = await this.bridge.connect(profile, (frame) => { this.onFrame(frame); });
    this.connectionId = done.connectionId;
    this.describe = done.describe;
  }

  async close(): Promise<void> {
    const id = this.connectionId;
    this.connectionId = null;
    for (const p of this.pending.values()) p.reject(new GatewayError(-32000, 'the connection closed', { code: 'hx.hermes.unavailable' }));
    this.pending.clear();
    if (id !== null) await this.bridge.disconnect(id);
  }

  /** a typed call to a method of the generated contract */
  request<M extends RpcMethod>(method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']> {
    return this.requestRaw(method, params) as Promise<RpcMethods[M]['result']>;
  }

  /** a call to any method (plugin RPC, or a method newer than the vendored contract) */
  requestRaw(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.send({ jsonrpc: '2.0', id, method, params }).catch((e: unknown) => { this.pending.delete(id); reject(asHostError(e)); });
    });
  }

  onEvent(fn: (e: GatewayEvent) => void): Unsubscribe { this.eventSubs.add(fn); return () => { this.eventSubs.delete(fn); }; }
  onState(fn: (s: LinkState) => void): Unsubscribe { this.stateSubs.add(fn); return () => { this.stateSubs.delete(fn); }; }
  /** answer the gateway's own requests (clarify, secret, ...). Without a handler they are refused. */
  onServerRequest(fn: (r: ServerRequest) => Promise<unknown> | unknown): void { this.serverHandler = fn; }

  private async send(frame: unknown): Promise<void> {
    if (this.connectionId === null) throw new GatewayError(-32000, 'not connected', { code: 'hx.hermes.unavailable' });
    await this.bridge.send(this.connectionId, frame);
  }

  private onFrame(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const f = raw as Frame;
    if (f.method === 'event' && f.params && typeof f.params === 'object') { this.onEventFrame(f.params as GatewayEvent); return; }
    if (f.method !== undefined && f.id !== undefined && f.id !== null) { void this.onServerRequestFrame({ id: f.id, method: f.method, params: f.params }); return; }
    if (f.id !== undefined && f.id !== null) {
      const p = this.pending.get(f.id);
      if (!p) { log.debug('a response nobody waits for'); return; }
      this.pending.delete(f.id);
      if (f.error) p.reject(new GatewayError(f.error.code ?? -32000, f.error.message ?? p.method + ' failed', f.error.data));
      else p.resolve(f.result);
    }
  }

  private onEventFrame(ev: GatewayEvent): void {
    if (ev.type === 'connection.state') {
      const p = (ev.payload ?? {}) as { state?: LinkPhase; reconnected?: boolean; error?: { code: string; message: string } | null };
      this.current = { phase: p.state ?? this.current.phase, reconnected: p.reconnected === true, error: p.error ?? null };
      for (const fn of [...this.stateSubs]) fn(this.current);
    }
    for (const fn of [...this.eventSubs]) {
      try { fn(ev); } catch (e) { log.error('an event handler threw', e); }
    }
  }

  private async onServerRequestFrame(req: ServerRequest): Promise<void> {
    try {
      if (!this.serverHandler) throw new GatewayError(-32601, 'this client does not answer ' + req.method, { code: 'hx.host.unsupported' });
      const result = await this.serverHandler(req);
      await this.send({ jsonrpc: '2.0', id: req.id, result: result ?? {} });
    } catch (e) {
      const err = e instanceof GatewayError ? e : new GatewayError(-32000, e instanceof Error ? e.message : String(e));
      await this.send({ jsonrpc: '2.0', id: req.id, error: { code: err.rpcCode, message: err.message, data: { code: err.code } } }).catch((s: unknown) => { log.warn('could not answer a server request', s); });
    }
  }
}
