// @vitest-environment jsdom
/* MenuRow: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './menu-row';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.menuRow>[0] = { label: 'Copy' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: MenuRow', () => {
  it('draws the component its contract names (data-kit="MenuRow")', () => {
    const el = put(kit.menuRow(EX));
    expect(el.matches('[data-kit~="MenuRow"]') || !!el.querySelector('[data-kit~="MenuRow"]')).toBe(true);
    expect(contract.name).toBe('MenuRow');
  });
  it('a menu item the menu moves the focus to; a quick menu\'s row is a checkbox item', () => {
    const r = put(kit.menuRow({ label: 'Copy', keys: 'mod+C' }));
    expect([r.getAttribute('role'), r.tabIndex, r.dataset['value']]).toEqual(['menuitem', -1, 'Copy']);
    const q = put(kit.menuRow({ label: 'Show cost', checked: true }));
    expect([q.getAttribute('role'), q.getAttribute('aria-checked')]).toEqual(['menuitemcheckbox', 'true']);
  });
});
