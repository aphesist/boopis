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
