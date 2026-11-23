// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clipSpots, tipsIfClipped } from './clip';

describe('cut text', () => {
  it('an item row takes its title and line as its tooltip while either is cut, and gives it back when neither is', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button class="ui-row ui-row--item"><span class="ui-row__title">Frontend Design</span><span class="ui-row__sub">Plugin · Anthropic</span></button>';
    document.body.append(host);
    const row = host.querySelector('button') as HTMLElement, sub = host.querySelector('.ui-row__sub') as HTMLElement;
    expect(clipSpots(host)[0]?.[2]).toBe('Frontend Design. Plugin · Anthropic');
    Object.defineProperty(sub, 'scrollWidth', { configurable: true, value: 300 });
    Object.defineProperty(sub, 'clientWidth', { configurable: true, value: 100 });
    tipsIfClipped(clipSpots(host));
    expect(row.getAttribute('data-tip')).toBe('Frontend Design. Plugin · Anthropic');
    Object.defineProperty(sub, 'scrollWidth', { configurable: true, value: 100 });
    tipsIfClipped(clipSpots(host));
    expect(row.hasAttribute('data-tip')).toBe(false);
  });
  it('never takes a tooltip the row already had', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button class="ui-row ui-row--item" data-tip="mine"><span class="ui-row__title">x</span></button>';
    document.body.append(host);
    const t = host.querySelector('.ui-row__title') as HTMLElement;
    Object.defineProperty(t, 'scrollWidth', { configurable: true, value: 300 });
    tipsIfClipped(clipSpots(host));
    expect(host.querySelector('button')?.getAttribute('data-tip')).toBe('mine');
  });
});
