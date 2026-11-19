import { describe, expect, it, vi } from 'vitest';
import { listenConnectorRestarts, noticeText } from './connectors-notice';
import type { RestartNotice } from './connectors-notice';

describe('the notice of a restart that waited for idle sessions', () => {
  it('says what the host told it, and a plain sentence when it told nothing', () => {
    expect(noticeText({ names: ['a'], ok: true, message: 'Hermes restarted to read the key. a connected, 2 tools' })).toBe('Hermes restarted to read the key. a connected, 2 tools');
    expect(noticeText({ names: [], ok: true, message: '' })).toBe('Hermes restarted.');
    expect(noticeText({ names: [], ok: false, message: '' })).toBe('Hermes was not restarted.');
  });
  it('shows each notice as a toast while listening, and stops when told', async () => {
    let send: (n: RestartNotice) => void = () => undefined;
    const stop = vi.fn();
    const toasts: string[] = [];
    const off = await listenConnectorRestarts((t) => { toasts.push(t); }, (cb) => { send = cb; return Promise.resolve(stop); });
    send({ names: ['x'], ok: false, message: 'Hermes was not restarted (gave up). The key is saved; restart Hermes to use it.' });
    expect(toasts).toEqual(['Hermes was not restarted (gave up). The key is saved; restart Hermes to use it.']);
    off();
    expect(stop).toHaveBeenCalled();
  });
});
