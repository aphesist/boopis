// @vitest-environment jsdom
/* Menu: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts and thread.test.ts keep their words. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '../index';
import { contract } from './menu';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.menu>[0] = { label: 'Actions', entries: [{ label: 'Copy' }, { label: 'Fork' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Menu', () => {
  it('draws the component its contract names (data-kit="Menu")', () => {
    const el = put(kit.menu(EX));
    expect(el.matches('[data-kit~="Menu"]') || !!el.querySelector('[data-kit~="Menu"]')).toBe(true);
    expect(contract.name).toBe('Menu');
  });
  it('is a menu named by its label, with headings and separators between its rows', () => {
    const m = put(kit.menu({ label: 'Add', entries: [{ heading: 'Files' }, { label: 'Attach a file' }, '-', { label: 'Commands' }] }));
    expect([m.getAttribute('role'), m.getAttribute('aria-label')]).toEqual(['menu', 'Add']);
    expect(m.querySelector('[role="separator"]')).not.toBeNull();
    expect(m.querySelector('.k7-menu__head')?.textContent).toBe('Files');
  });
});

describe('story: Menu, 6e', () => {
  it('a Menu carries a foot under its rows', () => {
    const m = put(kit.menu({ label: 'x', entries: [{ label: 'a' }], foot: kit.html.button({ label: 'Go' }) }));
    expect(m.querySelector('.k7-menu__foot [data-kit~="Button"]')).not.toBeNull();
  });
});

describe('scene: Menu', () => {
  it('the arrows move between rows, and a letter jumps to the next row it starts', () => {
    const m = put(kit.menu({ label: 'Actions', entries: [{ label: 'Copy' }, { label: 'Fork' }, { label: 'Find' }] }));
    const rows = [...m.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
    rows[0]?.focus();
    m.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[1]);
    m.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[2]);
  });
});

describe('scene: Menu, a row cut by the menu\'s width', () => {
  it('says its description whole in its tooltip; a row that fits, or has a tooltip of its own, is left alone', () => {
    /* jsdom lays nothing out: the second row's description is the one that does not fit */
    const sw = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth'), cw = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get(this: Element) { return (this.textContent ?? '').length * 7; } });
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get() { return 180; } });
    try {
      const anchor = put(kit.button({ label: 'Model' }));
      const m = kit.openMenu(anchor, { label: 'Who answers next', variant: 'list', entries: [
        { label: 'Claude Sonnet 5.5', desc: 'Tier 2 of 3' },
        { label: 'Automatic (Smart)', desc: 'Picks a tier for each message: the cheapest by default, a stronger one for design' },
        { label: 'High', desc: 'This version of the engine cannot change the effort while a session runs.', disabled: true, attrs: { 'data-tip': 'Not now' } }
      ] });
      const rows = [...(m as HTMLElement).querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
      expect((m as HTMLElement).dataset['variant']).toBe('list');
      expect(rows.map((r) => r.dataset['tip'] ?? null)).toEqual([null, 'Picks a tier for each message: the cheapest by default, a stronger one for design', 'Not now']);
    } finally {
      kit.closeMenu();
      if (sw) Object.defineProperty(Element.prototype, 'scrollWidth', sw);
      if (cw) Object.defineProperty(Element.prototype, 'clientWidth', cw);
    }
  });
});

describe('scene: Menu, the keys of a list (2a)', () => {
  it('a word typed quickly jumps to the row it starts, one letter again goes on to the next, PageDown and PageUp move a page', () => {
    const names = ['opus 5.5', 'sonnet 5.5', 'haiku 4.5', 'qwen2', 'qwen3-coder', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
    const m = kit.menu({ label: 'Model', variant: 'list', entries: names.map((n) => ({ label: n, value: n, role: 'menuitemradio', checked: n === 'sonnet 5.5' })) });
    document.body.replaceChildren(m);
    const rows = [...m.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
    const key = (k: string): void => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
    vi.useFakeTimers();
    rows[1]!.focus();
    key('q'); key('w'); key('e'); key('n'); key('3');
    expect((document.activeElement as HTMLElement).dataset['value']).toBe('qwen3-coder');
    vi.advanceTimersByTime(800);
    rows[0]!.focus();
    key('a'); expect((document.activeElement as HTMLElement).dataset['value']).toBe('a1');
    key('a'); expect((document.activeElement as HTMLElement).dataset['value']).toBe('a2');
    vi.advanceTimersByTime(800); vi.useRealTimers();
    rows[0]!.focus(); key('PageDown');
    expect(document.activeElement).toBe(rows[8]);
    key('PageDown'); expect(document.activeElement).toBe(rows[11]);
    key('PageUp'); expect(document.activeElement).toBe(rows[3]);
    key('Home'); expect(document.activeElement).toBe(rows[0]);
    key('End'); expect(document.activeElement).toBe(rows[11]);
  });
});
