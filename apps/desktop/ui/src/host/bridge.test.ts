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
