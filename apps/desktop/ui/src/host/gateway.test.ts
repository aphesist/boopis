import { describe, expect, it } from 'vitest';
import { GatewayClient, GatewayError } from './gateway';
import type { GatewayEvent, LinkState } from './gateway';
import { FakeHost } from './testing';

async function connected(): Promise<{ host: FakeHost; client: GatewayClient }> {
  const host = new FakeHost();
  const client = new GatewayClient(host);
  await client.connect();
  return { host, client };
}

describe('the gateway client', () => {
  it('keeps the describe result of the handshake', async () => {
    const { client } = await connected();
    expect((client.describe as { instance_id: string }).instance_id).toBe('inst');
  });

  it('matches responses to requests by id, whatever the order', async () => {
    const { host, client } = await connected();
    const a = client.request('session.list', { limit: 1 });
    const b = client.request('session.list', { limit: 2 });
    const [ia, ib] = host.sent.map((s) => s.frame['id']);
    expect(ia).not.toBe(ib);
    host.result(ib, { sessions: [{ id: 'b' }] });
    host.result(ia, { sessions: [{ id: 'a' }] });
    expect((await a).sessions[0]?.id).toBe('a');
    expect((await b).sessions[0]?.id).toBe('b');
    expect(host.sent[0]?.frame['params']).toEqual({ limit: 1 });
  });

  it('rejects with the stable code a host or plugin error carries', async () => {
    const { host, client } = await connected();
    const p = client.requestRaw('plugin.boopis.mode.set', {});
    host.error(host.sent[0]?.frame['id'], -32000, 'plugin_rpc_failed', { code: 'hx.mode.locked' });
    await expect(p).rejects.toMatchObject({ name: 'GatewayError', code: 'hx.mode.locked' });
    const q = client.requestRaw('plugin.boopis.mode.set', {});
    host.error(host.sent[1]?.frame['id'], -32000, 'HxError: hx.mode.locked: the first prompt was sent');
    await expect(q).rejects.toMatchObject({ code: 'hx.mode.locked' }); // plugin errors carry the code first in the message
    expect(new GatewayError(1, 'plain').code).toBe('');
  });

  it('hands out events and tracks the link state from host frames', async () => {
    const { host, client } = await connected();
    const events: GatewayEvent[] = [];
    const states: LinkState[] = [];
    client.onEvent((e) => events.push(e));
    client.onState((s) => states.push(s));
    host.event('connection.state', '', { state: 'degraded', error: { code: 'hx.engine.unavailable', message: 'gone' } });
    host.event('connection.state', '', { state: 'ready', reconnected: true });
    host.event('message.delta', 's1', { text: 'hi' }, 4);
    expect(states.map((s) => [s.phase, s.reconnected])).toEqual([['degraded', false], ['ready', true]]);
    expect(states[0]?.error?.code).toBe('hx.engine.unavailable');
    expect(events.map((e) => e.type)).toEqual(['connection.state', 'connection.state', 'message.delta']);
    expect(client.state().phase).toBe('ready');
  });

  it('refuses a server request it has no handler for, so a turn never hangs', async () => {
    const { host } = await connected();
    host.emit({ jsonrpc: '2.0', id: 'srv-1', method: 'clarify', params: { q: '?' } });
    await Promise.resolve();
    const reply = host.sent.at(-1)?.frame as { id: string; error: { data: { code: string } } };
    expect(reply.id).toBe('srv-1');
    expect(reply.error.data.code).toBe('hx.host.unsupported');
  });

  it('answers a server request through its handler', async () => {
    const { host, client } = await connected();
    client.onServerRequest((r) => ({ echoed: r.method }));
    host.emit({ jsonrpc: '2.0', id: 9, method: 'clarify', params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(host.sent.at(-1)?.frame).toEqual({ jsonrpc: '2.0', id: 9, result: { echoed: 'clarify' } });
  });

  it('fails pending requests when it closes, and requests after that', async () => {
    const { host, client } = await connected();
    const p = client.requestRaw('x', {});
    await client.close();
    await expect(p).rejects.toMatchObject({ code: 'hx.engine.unavailable' });
    expect(host.disconnected).toEqual([1]);
    await expect(client.requestRaw('y', {})).rejects.toMatchObject({ code: 'hx.engine.unavailable' });
  });

  it('shows a connect failure as the host sent it', async () => {
    const host = new FakeHost();
    host.failConnect = { code: 'hx.engine.incompatible', message: 'too old' };
    await expect(new GatewayClient(host).connect()).rejects.toMatchObject({ code: 'hx.engine.incompatible' });
  });
});

describe('the engine\'s own refusals (ADR-0031)', () => {
  it('shows the catalog sentence and keeps the engine\'s words for Diagnostics; ours stay as they are', async () => {
    const { GatewayError } = await import('./gateway');
    const { engineDetails } = await import('./errors');
    const raw = GatewayError.fromFrame(-32000, 'hermes refused updates.check: OSError: [Errno 13]', { reason: 'x' });
    expect(raw.code).toBe('hx.engine.refused');
    expect(raw.message).not.toMatch(/hermes|OSError/i);
    expect(raw.message).toContain('Diagnostics');
    expect(raw.data).toEqual({ reason: 'x' });
    expect(engineDetails().at(-1)?.detail).toContain('OSError');
    const ours = GatewayError.fromFrame(-32000, 'The ledger could not be opened.', { code: 'hx.ledger.unavailable' });
    expect(ours.message).toBe('The ledger could not be opened.');
    expect(GatewayError.fromFrame(-32601, 'unknown method', { reason: 'unknown_method' }).rpcCode).toBe(-32601);
  });
});
