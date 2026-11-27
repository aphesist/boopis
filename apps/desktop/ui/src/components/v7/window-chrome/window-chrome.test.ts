// @vitest-environment jsdom
/* WindowChrome: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from thread.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './window-chrome';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.windowChrome>[0] = { title: 'kai' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: WindowChrome', () => {
  it('draws the component its contract names (data-kit="WindowChrome")', () => {
    const el = put(kit.windowChrome(EX));
    expect(el.matches('[data-kit~="WindowChrome"]') || !!el.querySelector('[data-kit~="WindowChrome"]')).toBe(true);
    expect(contract.name).toBe('WindowChrome');
  });
  it('a toolbar named Window: the toggle, the title pill, the search hint, the details and the window\'s buttons', () => {
    const c = put(kit.windowChrome({ title: 'kai' }));
    expect([c.getAttribute('role'), c.getAttribute('aria-label')]).toEqual(['toolbar', 'Window']);
    expect(c.querySelector('[data-kit-part~="TitlePill"]')?.textContent).toContain('kai');
    expect(c.querySelector('.k7-search-hint')).not.toBeNull();
    expect(c.querySelectorAll('.k7-chrome__wc [data-kit~="IconButton"]').length).toBe(3);
    expect(put(kit.windowChrome({ title: 'kai', windowControls: false })).querySelector('.k7-chrome__wc')).toBeNull();
  });
  it('the title pill says a session\'s branch after its name', () => {
    document.body.innerHTML = kit.html.titlePill({ title: 'Fix the dock', icon: 'session', sub: 'w32/dock-paint' });
    expect(document.querySelector('.k7-title__sub')?.textContent).toBe('w32/dock-paint');
    document.body.innerHTML = kit.html.titlePill({ title: 'kai' });
    expect(document.querySelector('.k7-title__sub')).toBeNull();
  });
});
