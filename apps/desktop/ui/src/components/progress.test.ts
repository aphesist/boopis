// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { progressDots, setProgress } from './progress';

const on = (el: HTMLElement): number => el.querySelectorAll('.ui-progress__bar > i[data-on]').length;

describe('progress as dots', () => {
  it('fills the measure row in proportion and writes the percent beside it, as a progressbar', () => {
    const p = progressDots({ value: 40, label: 'Unpacking Hermes', dots: 10 });
    const bar = p.querySelector('.ui-progress__bar') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax')]).toEqual(['0', '100']);
    expect(bar.getAttribute('aria-label')).toBe('Unpacking Hermes');
    expect(bar.classList.contains('ui-measure')).toBe(true);
    expect(bar.querySelectorAll(':scope > i')).toHaveLength(10);
    expect(on(p)).toBe(4);
    expect(p.querySelector('.ui-progress__pct')?.textContent).toBe('40%');
  });
  it('is one travelling dot with no percent when nothing is known, and goes back to dots when it is', () => {
    const p = progressDots({ value: null, label: 'Setting up' });
    const bar = p.querySelector('.ui-progress__bar') as HTMLElement;
    expect(bar.hasAttribute('data-indeterminate')).toBe(true);
    expect(bar.getAttribute('aria-busy')).toBe('true');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.querySelectorAll('.ui-progress__run')).toHaveLength(1);
    expect(on(p)).toBe(0);
    expect(p.querySelector('.ui-progress__pct')?.textContent).toBe('');
    setProgress(p, 70);
    expect(bar.querySelector('.ui-progress__run')).toBeNull();
    expect(bar.hasAttribute('aria-busy')).toBe(false);
    expect(on(p)).toBe(7);
    setProgress(p, null);
    expect(bar.querySelectorAll('.ui-progress__run')).toHaveLength(1);
    expect(on(p)).toBe(0);
  });
  it('clamps and never draws more dots than the row has', () => {
    const p = progressDots({ value: 250, label: 'x', dots: 8 });
    expect(on(p)).toBe(8);
    expect(p.querySelector('.ui-progress__bar')?.getAttribute('aria-valuenow')).toBe('100');
    setProgress(p, -5);
    expect(on(p)).toBe(0);
    expect(progressDots({ value: 0, label: 'x', dots: 99 }).querySelectorAll('.ui-progress__bar > i')).toHaveLength(20);
  });
});
