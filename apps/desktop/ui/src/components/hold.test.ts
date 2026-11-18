import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_FALLBACK_MS, holdEase, holdOf, wireHold } from './hold';
import { html } from './html';
import { frag } from '../core/dom';

/* OWNER DECISION: hold to approve takes 1 second, everywhere. The clock is faked: no sleeps. */
let btn: HTMLButtonElement;
let commits: number;
const key = (type: 'keydown' | 'keyup', k: string, repeat = false): void => { btn.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === ' ' ? 'Space' : k, repeat, bubbles: true, cancelable: true })); };

beforeEach(() => {
  vi.useFakeTimers();
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  const wrap = frag('<div>' + html.hold({}) + '</div>');
  document.body.append(wrap);
  btn = wrap.querySelector('button') as HTMLButtonElement;
  wireHold(btn);
  commits = 0;
  btn.addEventListener('ui:commit', () => { commits++; });
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('hold to approve', () => {
  it('the fallback duration is one second', () => { expect(HOLD_FALLBACK_MS).toBe(1000); });
  it('holding Space does not approve before 1 s, and approves right after it', () => {
    key('keydown', ' ');
    expect(btn.dataset['state']).toBe('holding');
    vi.advanceTimersByTime(950);
    expect(btn.dataset['state']).toBe('holding');
    expect(holdOf(btn)?.progress).toBeLessThan(1);
    vi.advanceTimersByTime(100);
    expect(btn.dataset['state']).toBe('done');
    vi.advanceTimersByTime(300);
    expect(commits).toBe(1);
  });
  it('releasing before 1 s cancels: it drains back and never commits', () => {
    key('keydown', ' ');
    vi.advanceTimersByTime(600);
    key('keyup', ' ');
    vi.advanceTimersByTime(2000);
    expect(btn.dataset['state']).toBe('idle');
    expect(holdOf(btn)?.progress).toBe(0);
    expect(commits).toBe(0);
  });
  it('the key repeat of a held Space neither restarts nor shortens the hold', () => {
    key('keydown', ' ');
    vi.advanceTimersByTime(500);
    key('keydown', ' ', true); key('keydown', ' ', true);
    vi.advanceTimersByTime(400);
    expect(btn.dataset['state']).toBe('holding');
    vi.advanceTimersByTime(150);
    expect(btn.dataset['state']).toBe('done');
  });
  it('Enter twice approves: the first press arms it, the second commits', () => {
    key('keydown', 'Enter');
    expect(btn.hasAttribute('data-armed')).toBe(true);
    expect(btn.dataset['state']).toBe('idle');
    key('keydown', 'Enter');
    expect(btn.dataset['state']).toBe('done');
    vi.advanceTimersByTime(300);
    expect(commits).toBe(1);
  });
  it('an armed Enter disarms itself after a few seconds', () => {
    key('keydown', 'Enter');
    vi.advanceTimersByTime(4100);
    expect(btn.hasAttribute('data-armed')).toBe(false);
    key('keydown', 'Enter');
    expect(btn.dataset['state']).toBe('idle');
  });
  it('a host that cancels ui:commit leaves the button ready again', () => {
    btn.addEventListener('ui:commit', (e) => e.preventDefault());
    key('keydown', ' ');
    vi.advanceTimersByTime(1400);
    expect(btn.dataset['state']).toBe('idle');
  });
  it('data-ms overrides the duration for a host that needs a different one', () => {
    const wrap = frag('<div>' + html.hold({ ms: 400 }) + '</div>');
    document.body.append(wrap);
    const b = wrap.querySelector('button') as HTMLButtonElement;
    wireHold(b);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    vi.advanceTimersByTime(450);
    expect(b.dataset['state']).toBe('done');
  });
  it('the fill eases but is monotonic and ends at 1', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) { const v = holdEase(i / 10); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(holdEase(0)).toBe(0);
    expect(holdEase(1)).toBe(1);
  });
});
