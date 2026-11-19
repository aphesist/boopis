/* Test helpers for the host seam: a scripted host (the proxy's UI-facing side) and the recorded frames. Imported by tests only. */
import approvalFrames from './fixtures/approval.frames.json';
import turnFrames from './fixtures/turn-with-tool.frames.json';
import type { Connected, HostBridge } from './bridge';

export const recorded = { turn: turnFrames as unknown as Record<string, unknown>[], approval: approvalFrames as unknown as { dir: string; frame: Record<string, unknown> }[] };

/** a HostBridge a test drives: it records what the client sends and lets the test play the gateway */
export class FakeHost implements HostBridge {
  sent: { connectionId: number; frame: Record<string, unknown> }[] = [];
  private onFrame: (f: unknown) => void = () => undefined;
  disconnected: number[] = [];
  describe: unknown = { instance_id: 'inst', capabilities: ['event-replay-v1'] };
  failConnect: unknown = null;
  /** called with each frame the client sends, so a test can answer requests */
  autoReply: ((frame: Record<string, unknown>) => void) | null = null;

  connect(_profile: string | null, onFrame: (f: unknown) => void): Promise<Connected> {
    if (this.failConnect) return Promise.reject(this.failConnect);
    this.onFrame = onFrame;
    return Promise.resolve({ connectionId: 1, describe: this.describe });
  }
  send(connectionId: number, frame: unknown): Promise<void> {
    const f = frame as Record<string, unknown>;
    this.sent.push({ connectionId, frame: f });
    this.autoReply?.(f);
    return Promise.resolve();
  }
  disconnect(connectionId: number): Promise<void> { this.disconnected.push(connectionId); return Promise.resolve(); }

  /** the gateway sends a frame */
  emit(frame: unknown): void { this.onFrame(frame); }
  result(id: unknown, result: unknown): void { this.emit({ jsonrpc: '2.0', id, result }); }
  error(id: unknown, code: number, message: string, data?: unknown): void { this.emit({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }); }
  event(type: string, session_id: string, payload: Record<string, unknown> = {}, seq = 0): void {
    this.emit({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload, seq, replay_epoch: 'e1' } });
  }
  last(method: string): Record<string, unknown> | undefined { return [...this.sent].reverse().find((s) => s.frame['method'] === method)?.frame; }
}

/* the frames recorded against a real gateway and the plugin (tests/e2e/record_ui_frames.py) */
import sessionFrames from '../../tests/fixtures/frames/session.frames.json';
import unpricedFrames from '../../tests/fixtures/frames/unpriced.frames.json';
import formsFrames from '../../tests/fixtures/frames/forms.frames.json';
import modsFrames from '../../tests/fixtures/frames/mods.frames.json';
import requestsFrames from '../../tests/fixtures/frames/requests.frames.json';
import type { RecordedFrame } from './replay';

export const fixtures = { session: sessionFrames as unknown as RecordedFrame[], unpriced: unpricedFrames as unknown as RecordedFrame[], forms: formsFrames as unknown as RecordedFrame[], mods: modsFrames as unknown as RecordedFrame[], requests: requestsFrames as unknown as RecordedFrame[] };

/** the result the recording shows for a method (the first one, or the n-th) */
export function resultOf<T>(frames: readonly RecordedFrame[], method: string, n = 0): T {
  const outs = frames.filter((r) => r.dir === 'out' && r.frame['method'] === method);
  const out = outs[n];
  if (!out) throw new Error('the recording has no ' + method);
  const res = frames.find((r) => r.dir === 'in' && r.frame['id'] === out.frame['id'] && 'result' in r.frame);
  if (!res) throw new Error('no result for ' + method);
  return res.frame['result'] as T;
}
/** the payloads of the events of a type the recording shows, in order */
export function eventsOf(frames: readonly RecordedFrame[], type: string): { session_id?: string; payload: Record<string, unknown> }[] {
  return frames.filter((r) => r.dir === 'in' && r.frame['method'] === 'event' && (r.frame['params'] as { type: string }).type === type).map((r) => r.frame['params'] as { session_id?: string; payload: Record<string, unknown> });
}
/** the events of the recorded turn, as the gateway client hands them out */
export const turnEvents = (frames: readonly RecordedFrame[]): GatewayEventLike[] => frames.filter((r) => r.dir === 'in' && r.frame['method'] === 'event').map((r) => r.frame['params'] as GatewayEventLike);
export interface GatewayEventLike { type: string; session_id?: string; payload?: Record<string, unknown>; [k: string]: unknown }
