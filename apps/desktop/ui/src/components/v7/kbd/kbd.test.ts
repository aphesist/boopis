// @vitest-environment jsdom
/* Kbd: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './kbd';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.kbd>[0] = { keys: 'mod+K' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Kbd', () => {
  it('draws the component its contract names (data-kit="Kbd")', () => {
    const el = put(kit.kbd(EX));
    expect(el.matches('[data-kit~="Kbd"]') || !!el.querySelector('[data-kit~="Kbd"]')).toBe(true);
    expect(contract.name).toBe('Kbd');
  });
  it('each key is a kbd, the chips apart in the markup so they read as words', () => {
    const k = put(kit.kbd({ keys: 'shift+Enter' }));
    expect([...k.querySelectorAll('kbd')].map((x) => x.textContent)).toEqual(kit.keyNames('shift+Enter'));
    expect(k.textContent).toContain(' ');
  });
  it('a binding says its alternatives and its steps in words between the chips', () => {
    const el = document.createElement('div'); el.innerHTML = kit.html.kbdSpec('mod+G L | g');
    put(el);
    const words = [...el.querySelectorAll('.k7-keyspec__word')].map((w) => w.textContent);
    expect(words).toEqual(['then', 'or']);
    expect(el.querySelectorAll('[data-kit~="Kbd"]').length).toBe(4);
  });
});
