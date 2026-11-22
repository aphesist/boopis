import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class { onmessage: ((m: unknown) => void) | null = null; }
}));

import { asHostError, HostError, inTauri, tauriBridge } from './bridge';

beforeEach(() => { invoke.mockReset(); });

describe('the typed bridge', () => {
  it('connects through the generated command and gives back only an id and the describe result', async () => {
    invoke.mockResolvedValue({ connection_id: 7, describe: { instance_id: 'i' } });
    const got: unknown[] = [];
    const done = await tauriBridge().connect('nina', (f) => got.push(f));
    expect(done).toEqual({ connectionId: 7, describe: { instance_id: 'i' } });
    const [cmd, args] = invoke.mock.calls[0] as [string, { profile: string; frames: { onmessage: (m: unknown) => void } }];
    expect(cmd).toBe('gateway_connect');
    expect(args.profile).toBe('nina');
    args.frames.onmessage({ jsonrpc: '2.0', method: 'event' }); // a frame arriving on the Channel reaches the callback untouched
    expect(got).toEqual([{ jsonrpc: '2.0', method: 'event' }]);
  });

  it('hands each frame of a batch on in order, then acknowledges the batch once', async () => {
    invoke.mockResolvedValue({ connection_id: 9, describe: {} });
    const got: unknown[] = [];
    const reload = vi.fn();
    await tauriBridge(reload).connect(null, (f) => { got.push(f); if ((f as { bad?: boolean }).bad) throw new Error('bad'); });
    const frames = (invoke.mock.calls[0] as [string, { frames: { onmessage: (m: unknown) => void } }])[1].frames;
    invoke.mockClear();
    frames.onmessage([{ n: 1 }, { n: 2, bad: true }, { n: 3 }]);
    expect(got).toEqual([{ n: 1 }, { n: 2, bad: true }, { n: 3 }]);   /* a frame that throws costs nothing of the rest */
    expect(invoke.mock.calls.filter(([c]) => c === 'gateway_ack')).toEqual([['gateway_ack', { connectionId: 9 }, undefined]]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('acknowledges what arrived before the connection id was known, once it is', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    invoke.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const pending = tauriBridge(vi.fn()).connect(null, () => undefined);
    const frames = (invoke.mock.calls[0] as [string, { frames: { onmessage: (m: unknown) => void } }])[1].frames;
    frames.onmessage({ jsonrpc: '2.0', method: 'event', params: { type: 'connection.state', payload: { state: 'ready' } } });
    frames.onmessage([{ a: 1 }, { b: 2 }]);
    expect(invoke.mock.calls.filter(([c]) => c === 'gateway_ack')).toHaveLength(0);
    invoke.mockResolvedValue(null);
    resolve({ connection_id: 4, describe: {} });
    await pending;
    expect(invoke.mock.calls.filter(([c]) => c === 'gateway_ack')).toHaveLength(2);
  });

  it('reloads the page when the host dropped the connection as too slow', async () => {
    invoke.mockResolvedValue({ connection_id: 2, describe: {} });
    const reload = vi.fn();
    await tauriBridge(reload).connect(null, () => undefined);
    const frames = (invoke.mock.calls[0] as [string, { frames: { onmessage: (m: unknown) => void } }])[1].frames;
    frames.onmessage({ jsonrpc: '2.0', method: 'event', params: { type: 'connection.state', payload: { state: 'degraded', reason: 'lost' } } });
    expect(reload).not.toHaveBeenCalled();
    frames.onmessage({ jsonrpc: '2.0', method: 'event', params: { type: 'connection.state', payload: { state: 'degraded', reason: 'slow_consumer' } } });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('sends a frame as it is and disconnects by id', async () => {
    invoke.mockResolvedValue(null);
    const frame = { jsonrpc: '2.0', id: 1, method: 'session.list', params: { limit: 5 } };
    await tauriBridge().send(3, frame);
    expect(invoke).toHaveBeenCalledWith('gateway_send', { connectionId: 3, frame }, undefined);
    await tauriBridge().disconnect(3);
    expect(invoke).toHaveBeenLastCalledWith('gateway_disconnect', { connectionId: 3 }, undefined);
  });

  it('turns a host rejection into a HostError with its stable code', async () => {
    invoke.mockRejectedValue({ code: 'hx.engine.incompatible', message: 'Hermes 0.22.0 is older than the required >=0.23.2' });
    const err = await tauriBridge().connect(null, () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HostError);
    expect((err as HostError).code).toBe('hx.engine.incompatible');
  });

  it('normalises other failures', () => {
    expect(asHostError(new Error('boom')).code).toBe('hx.host.unknown');
    expect(asHostError('text').message).toBe('text');
    const e = new HostError('hx.x', 'm');
    expect(asHostError(e)).toBe(e);
  });

  it('knows whether it runs in the Tauri webview', () => {
    expect(inTauri()).toBe(false);
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    expect(inTauri()).toBe(true);
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });
});
