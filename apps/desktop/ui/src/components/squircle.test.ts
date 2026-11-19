import { afterEach, describe, expect, it, vi } from 'vitest';
import { squircle } from './squircle';

/* jsdom has no layout: a ResizeObserver that reports the sizes a test gives it, and the radii the element declares */
type Entry = { target: Element; borderBoxSize: { inlineSize: number; blockSize: number }[] };
let cb: ((e: Entry[]) => void) | null = null;
class FakeRO { constructor(fn: (e: Entry[]) => void) { cb = fn; } observe(): void { /* sized by the test */ } unobserve(): void { /* */ } disconnect(): void { /* */ } }
const size = (el: Element, w: number, h: number): void => { cb?.([{ target: el, borderBoxSize: [{ inlineSize: w, blockSize: h }] }]); };

afterEach(() => { document.body.replaceChildren(); });

describe('binding', () => {
  it('writes the path of a bound button and clips only leaf controls', () => {
    vi.stubGlobal('ResizeObserver', FakeRO);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ borderTopLeftRadius: '12px', borderTopRightRadius: '12px', borderBottomRightRadius: '12px', borderBottomLeftRadius: '12px', getPropertyValue: () => '0.6' }) as unknown as CSSStyleDeclaration);
    squircle.start();
    const btn = document.createElement('button'); btn.className = 'ui-btn';
    const card = document.createElement('div'); card.setAttribute('data-sq', '');
    const asked = document.createElement('div'); asked.setAttribute('data-sq', ''); asked.setAttribute('data-sq-mode', 'clip');
    document.body.append(btn, card, asked);
    squircle.bind(btn); squircle.bind(card); squircle.bind(asked);
    expect(btn.dataset['sqMode']).toBe('clip');
    expect(card.dataset['sqMode']).toBe('frame');
    expect(asked.dataset['sqMode']).toBe('frame');   /* clip is for leaf controls only, whoever asks */
    size(btn, 100, 40);
    expect(btn.hasAttribute('data-sq-on')).toBe(true);
    expect(btn.style.getPropertyValue('--sq-clip')).toMatch(/^path\("M/);
    expect(btn.style.getPropertyValue('--sq-edge')).toMatch(/^path\(evenodd/);
    const first = btn.style.getPropertyValue('--sq-clip');
    size(btn, 100, 40);
    expect(btn.style.getPropertyValue('--sq-clip')).toBe(first);
    size(btn, 120, 40);
    expect(btn.style.getPropertyValue('--sq-clip')).not.toBe(first);
    expect(squircle.stats().bound).toBe(3);
    expect(squircle.stats().cached).toBeGreaterThan(1);
  });
  it('leaves a capsule to the browser', () => {
    const pill = document.createElement('button'); pill.className = 'ui-btn';
    document.body.append(pill);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ borderTopLeftRadius: '999px', borderTopRightRadius: '999px', borderBottomRightRadius: '999px', borderBottomLeftRadius: '999px', getPropertyValue: () => '0.6' }) as unknown as CSSStyleDeclaration);
    squircle.bind(pill);
    size(pill, 80, 24);
    expect(pill.hasAttribute('data-sq-on')).toBe(false);
  });
  it('lets go of an element that is unbound', () => {
    const el = document.createElement('div'); el.setAttribute('data-sq', '');
    document.body.append(el);
    squircle.bind(el);
    squircle.unbind(el);
    expect(el.hasAttribute('data-sq-mode')).toBe(false);
    expect(squircle.stats().bound).toBeLessThan(3);
  });
});
