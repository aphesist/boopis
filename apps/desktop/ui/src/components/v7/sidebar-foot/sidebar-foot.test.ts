// @vitest-environment jsdom
/* SidebarFoot: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './sidebar-foot';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.sidebarFoot>[0] = { name: 'Ada' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: SidebarFoot', () => {
  it('draws the component its contract names (data-kit="SidebarFoot")', () => {
    const el = put(kit.sidebarFoot(EX));
    expect(el.matches('[data-kit~="SidebarFoot"]') || !!el.querySelector('[data-kit~="SidebarFoot"]')).toBe(true);
    expect(contract.name).toBe('SidebarFoot');
  });
  it('you, Store and Settings, each named; the Sessions side leaves you out', () => {
    const f = put(kit.sidebarFoot(EX));
    expect(f.querySelector('.k7-sfoot__me')?.getAttribute('aria-label')).toBe('Account, Ada');
    expect([...f.querySelectorAll('[data-kit~="IconButton"]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Store', 'Settings']);
    expect(put(kit.sidebarFoot({ name: 'Ada', account: false })).querySelector('.k7-sfoot__me')).toBeNull();
  });
});
