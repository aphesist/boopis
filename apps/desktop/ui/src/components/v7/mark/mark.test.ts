// @vitest-environment jsdom
/* Mark: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './mark';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.mark>[0] = { text: 'auto margins' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Mark', () => {
  it('draws the component its contract names (data-kit="Mark")', () => {
    const el = put(kit.mark(EX));
    expect(el.matches('[data-kit~="Mark"]') || !!el.querySelector('[data-kit~="Mark"]')).toBe(true);
    expect(contract.name).toBe('Mark');
  });
  it('a feedforward is a button that opens a menu; a waiting blank is a textbox that says it waits for you', () => {
    const f = put(kit.mark(EX));
    expect([f.getAttribute('role'), f.getAttribute('aria-haspopup'), f.dataset['markKind']]).toEqual(['button', 'menu', 'feedforward']);
    const b = put(kit.mark({ text: 'the deadline', kind: 'blank', blank: 'waiting', countdown: '0:30' }));
    expect(b.querySelector('[role="textbox"]')?.getAttribute('aria-label')).toBe('the deadline');
    expect(b.textContent).toContain('waiting for you');
  });
});

describe('scene: Mark', () => {
  it('an info label opens its explanation on a press and says it is open', () => {
    const i = put(kit.mark({ text: 'Smart', kind: 'info', explain: 'Picks a model for each turn' }));
    i.click();
    expect(i.getAttribute('data-mark')).toBe('open');
    expect(document.querySelector('.k7-pop')?.textContent).toBe('Picks a model for each turn');
    kit.closeMenu();
  });
  it('a new mark loses its flag once it has drawn in (reduced motion: at once)', () => {
    const m = put(kit.mark({ text: 'page', isNew: true }));
    if (m.hasAttribute('data-mark-new')) m.dispatchEvent(new Event('animationend'));
    expect(m.hasAttribute('data-mark-new')).toBe(false);
  });
});
