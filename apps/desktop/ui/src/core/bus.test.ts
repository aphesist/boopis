import { afterEach, describe, expect, it, vi } from 'vitest';
import { emit, off, on, resetBus } from './bus';

afterEach(() => resetBus());

describe('the typed event bus', () => {
  it('delivers a payload to every subscriber, in subscription order', () => {
    const seen: string[] = [];
    on('hx:tab', (d) => seen.push('a:' + d.tab));
    on('hx:tab', (d) => seen.push('b:' + d.tab));
    emit('hx:tab', { tab: 'bots' });
    expect(seen).toEqual(['a:bots', 'b:bots']);
  });
  it('returns an unsubscribe, and off removes the same handler', () => {
    const fn = vi.fn();
    const stop = on('hx:region', fn);
    emit('hx:region', { region: 'dock' });
    stop();
    emit('hx:region', { region: 'list' });
    expect(fn).toHaveBeenCalledTimes(1);
    const g = vi.fn();
    on('hx:region', g); off('hx:region', g);
    emit('hx:region', { region: 'bar' });
    expect(g).not.toHaveBeenCalled();
  });
  it('a handler that throws is logged and never stops the others', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = vi.fn();
    on('hx:notify', () => { throw new Error('boom'); });
    on('hx:notify', ok);
    emit('hx:notify', { text: 'x' });
    expect(ok).toHaveBeenCalledOnce();
    expect(err).toHaveBeenCalled();
  });
  it('a handler may unsubscribe itself while the event is being delivered', () => {
    const calls: number[] = [];
    const stop = on('hx:tab', () => { calls.push(1); stop(); });
    on('hx:tab', () => calls.push(2));
    emit('hx:tab', { tab: 'session' }); emit('hx:tab', { tab: 'session' });
    expect(calls).toEqual([1, 2, 2]);
  });
});
