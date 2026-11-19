/* A host that plays recorded frames: the transport of the tests that need no Tauri and no Hermes. It answers each
   request with the recorded response of the same method (in the order they were recorded; the last one again when the
   UI asks more often than the recording did) and, after a request that started work on the gateway (`prompt.submit`,
   `blank.fill`, `form.submit`), replays the events the recording shows following it. The frames come from a real gateway and plugin
   (`tests/e2e/record_ui_frames.py`); nothing here invents a value. A method the recording never saw is answered as the
   gateway answers an unknown one. Used by the unit tests and, in the e2e build only, by the Playwright smoke. */
import type { Connected, HostBridge } from './bridge';
import type { SecretsBridge } from './secrets';

export interface RecordedFrame { dir: 'in' | 'out'; frame: Record<string, unknown> }
const WORKS = new Set(['prompt.submit', 'plugin.boopis.blank.fill', 'plugin.boopis.form.submit', 'plugin.boopis.form.cancel', 'plugin.boopis.mod.press', 'plugin.boopis.mod.input', 'plugin.boopis.mod.select', 'plugin.boopis.mod.props']);

export class ReplayHost implements HostBridge {
  private onFrame: (f: unknown) => void = () => undefined;
  private readonly used = new Map<string, number>();
  /** every request the UI sent, in order (for assertions) */
  readonly requests: { method: string; params: unknown }[] = [];

  constructor(private readonly frames: readonly RecordedFrame[]) {}

  connect(_profile: string | null, onFrame: (f: unknown) => void): Promise<Connected> {
    this.onFrame = onFrame;
    const describe = this.frames.find((r, i) => r.dir === 'in' && this.methodOfResponse(i) === 'runtime.describe')?.frame['result'];
    return Promise.resolve({ connectionId: 1, describe: describe ?? { capabilities: [] } });
  }
  disconnect(): Promise<void> { return Promise.resolve(); }

  send(_connectionId: number, frame: unknown): Promise<void> {
    const f = frame as { id?: number; method?: string; params?: unknown };
    if (f.method === undefined || f.id === undefined) return Promise.resolve();
    this.requests.push({ method: f.method, params: f.params });
    queueMicrotask(() => { this.answer(f.id as number, f.method as string, (f.params as { session_id?: unknown } | undefined)?.session_id, f.params as { form_id?: unknown } | undefined); });
    return Promise.resolve();
  }
  /** the host's own frames: a lost link and its return, for the reconnect tests */
  emitState(state: 'degraded' | 'ready', reconnected = false): void {
    this.onFrame({ jsonrpc: '2.0', method: 'event', params: { type: 'connection.state', payload: { state, reconnected } } });
  }
  emitEvent(type: string, session_id: string, payload: Record<string, unknown>): void {
    this.onFrame({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload } });
  }

  private methodOfResponse(i: number): string | undefined {
    const id = this.frames[i]?.frame['id'];
    return this.frames.find((r) => r.dir === 'out' && r.frame['id'] === id)?.frame['method'] as string | undefined;
  }
  private answer(id: number, method: string, sessionId: unknown, params?: { form_id?: unknown }): void {
    let outs = this.frames.map((r, i) => ({ r, i })).filter((x) => x.r.dir === 'out' && x.r.frame['method'] === method);
    /* a request about a session is answered with what the recording shows for that session; a session it never saw is not found */
    const about = (x: { r: RecordedFrame }): unknown => (x.r.frame['params'] as { session_id?: unknown } | undefined)?.session_id;
    /* a request about a form is answered with what the recording shows for that form, whatever order the UI answers them in */
    const formOf = (x: { r: RecordedFrame }): unknown => (x.r.frame['params'] as { form_id?: unknown } | undefined)?.form_id;
    if (typeof params?.form_id === 'string' && outs.some((x) => formOf(x) === params.form_id)) outs = outs.filter((x) => formOf(x) === params.form_id);
    if (typeof sessionId === 'string' && sessionId && outs.some((x) => about(x) !== undefined)) {
      outs = outs.filter((x) => about(x) === sessionId);
      if (!outs.length) { this.onFrame({ jsonrpc: '2.0', id, error: { code: 4004, message: method + ': session not found' } }); return; }
    }
    const key = method + '|' + String(sessionId ?? '');
    const n = this.used.get(key) ?? 0;
    const pick = outs[Math.min(n, outs.length - 1)];
    this.used.set(key, n + 1);
    if (!pick) { this.onFrame({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method: ' + method + ' \u2014 not available on this Hermes backend', data: { reason: 'unknown_method' } } }); return; }
    const reqId = pick.r.frame['id'];
    const resIdx = this.frames.findIndex((r) => r.dir === 'in' && r.frame['id'] === reqId && ('result' in r.frame || 'error' in r.frame));
    const res = this.frames[resIdx]?.frame;
    /* events the gateway sent while it handled the request come before its answer (the plugin announces `blank.filled` first) */
    if (WORKS.has(method) && resIdx > pick.i) for (let i = pick.i + 1; i < resIdx; i++) { const r = this.frames[i] as RecordedFrame; if (r.dir === 'in' && r.frame['method'] === 'event') this.onFrame(r.frame); }
    if (res) this.onFrame({ ...res, id });
    if (!WORKS.has(method) || resIdx < 0) return;
    for (let i = resIdx + 1; i < this.frames.length; i++) {
      const r = this.frames[i] as RecordedFrame;
      if (r.dir === 'out') break;
      if (r.frame['method'] === 'event') this.onFrame(r.frame);
    }
  }
}

/** the recorded frames of a fixture, fetched from where the e2e server mounts them (e2e builds only) */
export async function loadFrames(name: string): Promise<RecordedFrame[]> {
  const res = await fetch('/__frames/' + name + '.frames.json');
  if (!res.ok) throw new Error('no recorded frames named ' + name);
  return rebaseClock((await res.json()) as RecordedFrame[], Date.now());
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** Fields the gateway sends as Unix time (seconds, or milliseconds for `checked_at`); every other time is an ISO string. */
const EPOCH_SECONDS = new Set(['started_at', 'last_active_at', 'timestamp', 'refreshed_at']);
const EPOCH_MS = new Set(['checked_at']);

/** Moves a recording's clock to `now`: every time in it shifts by the same amount, so the intervals stay as recorded (a
    form that expired an hour after it was raised still does) and nothing recorded goes stale as the wall clock moves on.
    The recording starts at its earliest time. */
export function rebaseClock(frames: readonly RecordedFrame[], now: number): RecordedFrame[] {
  let start = Infinity;
  const scan = (v: unknown, key?: string): void => {
    if (typeof v === 'string' && ISO_UTC.test(v)) start = Math.min(start, Date.parse(v));
    else if (typeof v === 'number' && key && EPOCH_SECONDS.has(key)) start = Math.min(start, v * 1000);
    else if (typeof v === 'number' && key && EPOCH_MS.has(key)) start = Math.min(start, v);
    else if (Array.isArray(v)) v.forEach((x) => scan(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, k);
  };
  scan(frames);
  if (!Number.isFinite(start)) return frames.map((f) => ({ ...f }));
  const shift = now - start;
  const move = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string' && ISO_UTC.test(v)) return new Date(Date.parse(v) + shift).toISOString();
    if (typeof v === 'number' && key && EPOCH_SECONDS.has(key)) return v + shift / 1000;
    if (typeof v === 'number' && key && EPOCH_MS.has(key)) return v + shift;
    if (Array.isArray(v)) return v.map((x) => move(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, move(x, k)]));
    return v;
  };
  return frames.map((f) => move(f) as RecordedFrame);
}

/** A keychain that keeps what it is given in memory, for the tests: they read `stored` to see that a secret reached the host's
    keychain (and nowhere else). Test code only; the app's keychain is the host's. */
export class ReplaySecrets implements SecretsBridge {
  readonly stored = new Map<string, string>();
  set(service: string, account: string, value: string): Promise<void> { this.stored.set(service + '/' + account, value); return Promise.resolve(); }
}
