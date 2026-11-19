// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { patchHTML } from './reconcile';

const row = (ids: string[], extra = ''): string => `<div class="dk-row">${ids.map((id) => `<button class="dk-bot" data-act="session" data-id="${id}" tabindex="-1"><span class="dk-orb" data-slot="orb:${id}"></span></button>`).join('')}<button class="dk-add" data-act="new-bot"${extra}><span data-k="add">+</span></button></div>`;
const host = (html: string): HTMLElement => { const h = document.createElement('div'); h.innerHTML = html; return h; };
const bots = (h: HTMLElement): HTMLElement[] => Array.from(h.querySelectorAll<HTMLElement>('.dk-bot'));

describe('a view is patched in place, never rebuilt', () => {
  it('a bot added joins the row and every other button stays the same element', () => {
    const h = host(row(['a', 'b', 'c']));
    const before = bots(h);
    patchHTML(h, row(['a', 'b', 'c', 'd']));
    const after = bots(h);
    expect(after.map((b) => b.dataset['id'])).toEqual(['a', 'b', 'c', 'd']);
    expect(after.slice(0, 3)).toEqual(before);
    expect(h.querySelector('.dk-add')?.previousElementSibling).toBe(after[3]);
  });
  it('a bot removed leaves the others untouched', () => {
    const h = host(row(['a', 'b', 'c']));
    const [a, , c] = bots(h);
    patchHTML(h, row(['a', 'c']));
    expect(bots(h)).toEqual([a, c]);
  });
  it('a bot moved keeps its element and takes its new place', () => {
    const h = host(row(['a', 'b', 'c']));
    const [a, b, c] = bots(h);
    patchHTML(h, row(['c', 'a', 'b']));
    expect(bots(h)).toEqual([c, a, b]);
  });
  it('the live thing inside a slot is not touched, and the slot of a bot that stays keeps it', () => {
    const h = host(row(['a', 'b']));
    const orb = document.createElement('orb-avatar'); h.querySelector('[data-slot="orb:a"]')?.append(orb);
    patchHTML(h, row(['a', 'b', 'c']));
    expect(h.querySelector('[data-slot="orb:a"]')?.firstElementChild).toBe(orb);
  });
  it('focus stays on the button that was focused', () => {
    const h = host(row(['a', 'b'])); document.body.append(h);
    const b = bots(h)[1] as HTMLElement; b.focus();
    patchHTML(h, row(['a', 'b', 'c']));
    expect(document.activeElement).toBe(b);
    h.remove();
  });
  it('attributes follow the markup, and an attribute a script added stays unless the markup took it away', () => {
    const h = host(row(['a']));
    const a = bots(h)[0] as HTMLElement;
    a.setAttribute('data-sq-on', ''); a.style.transform = 'scale(1.2)'; a.setAttribute('data-hx-focus', 'dock');
    patchHTML(h, row(['a']).replace('tabindex="-1"', 'tabindex="0" data-tip-state="busy"'));
    expect(a.getAttribute('tabindex')).toBe('0');
    expect(a.getAttribute('data-tip-state')).toBe('busy');
    expect(a.hasAttribute('data-sq-on')).toBe(true);
    expect(a.style.transform).toBe('scale(1.2)');
    expect(a.getAttribute('data-hx-focus')).toBe('dock');
    patchHTML(h, row(['a']).replace('tabindex="-1"', 'tabindex="0"'));
    expect(a.hasAttribute('data-tip-state')).toBe(false);          // the markup rendered it before and no longer does
    expect(a.getAttribute('data-hx-focus')).toBe('dock');
  });
  it('text and unkeyed elements are updated where they are', () => {
    const h = host('<ul><li><b>1m</b> left</li><li>two</li></ul>');
    const [li0, li1] = Array.from(h.querySelectorAll('li'));
    const b = h.querySelector('b');
    patchHTML(h, '<ul><li><b>2m</b> left</li><li>three</li></ul>');
    expect(Array.from(h.querySelectorAll('li'))).toEqual([li0, li1]);
    expect(h.querySelector('b')).toBe(b);
    expect(h.textContent).toBe('2m leftthree');
  });
  it('an element of another kind in the same place is replaced', () => {
    const h = host('<div><span class="x">a</span></div>');
    patchHTML(h, '<div><p class="x">a</p></div>');
    expect(h.querySelector('span')).toBeNull();
    expect(h.querySelector('p')?.textContent).toBe('a');
  });
  it('the result is exactly the new markup', () => {
    const h = host(row(['a', 'b', 'c']));
    patchHTML(h, row(['b', 'x']));
    const fresh = host(row(['b', 'x']));
    expect(h.innerHTML).toBe(fresh.innerHTML);
  });
});
