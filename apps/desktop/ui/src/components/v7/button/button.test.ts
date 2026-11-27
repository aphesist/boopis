// @vitest-environment jsdom
/* Button: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '../index';
import { contract } from './button';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.button>[0] = { label: 'Allow' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Button', () => {
  it('draws the component its contract names (data-kit="Button")', () => {
    const el = put(kit.button(EX));
    expect(el.matches('[data-kit~="Button"]') || !!el.querySelector('[data-kit~="Button"]')).toBe(true);
    expect(contract.name).toBe('Button');
  });
  it('draws its variant and size as data, 36 and secondary unless said', () => {
    const b = put(kit.button({ label: 'Allow' }));
    expect([b.dataset['variant'], b.dataset['size']]).toEqual(['secondary', '36']);
    const p = put(kit.button({ label: 'Allow', variant: 'primary', size: 28 }));
    expect([p.dataset['variant'], p.dataset['size']]).toEqual(['primary', '28']);
  });
  it('a split is a primary with its own menu half, named', () => {
    const s = put(kit.button({ label: 'Commit', variant: 'split', menuLabel: 'Commit options' }));
    const halves = s.querySelectorAll('button');
    expect(halves.length).toBe(2);
    expect(halves[1]?.getAttribute('aria-haspopup')).toBe('menu');
    expect(halves[1]?.getAttribute('aria-label')).toBe('Commit options');
  });
});

describe('scene: Button', () => {
  it('a hold commits after --dur-hold, and a release before it does nothing', () => {
    vi.useFakeTimers();
    const b = put(kit.button({ label: 'Hold to allow once', hold: true }));
    let n = 0; b.addEventListener('ui:commit', () => { n++; });
    b.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
    vi.advanceTimersByTime(500); b.dispatchEvent(new PointerEvent('pointerup'));
    vi.advanceTimersByTime(1000);
    expect(n).toBe(0);
    b.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
    expect(b.hasAttribute('data-holding')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(n).toBe(1);
    expect(b.hasAttribute('data-held')).toBe(true);
    vi.useRealTimers();
  });
  it('from the keyboard Enter twice confirms, the first press saying so', () => {
    const b = put(kit.button({ label: 'Hold to allow once', hold: true }));
    let n = 0; b.addEventListener('ui:commit', () => { n++; });
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(b.hasAttribute('data-armed')).toBe(true);
    expect(b.textContent).toContain('Press again to confirm');
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(n).toBe(1);
  });
});
