// @vitest-environment jsdom
/* InlineChip: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from thread.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './inline-chip';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.inlineChip>[0] = { kind: 'code', text: 'pnpm test' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: InlineChip', () => {
  it('draws the component its contract names (data-kit="InlineChip")', () => {
    const el = put(kit.inlineChip(EX));
    expect(el.matches('[data-kit~="InlineChip"]') || !!el.querySelector('[data-kit~="InlineChip"]')).toBe(true);
    expect(contract.name).toBe('InlineChip');
  });
  it('inline code is a code element; a mention that acts is a button named by its label', () => {
    expect(put(kit.inlineChip(EX)).tagName).toBe('CODE');
    const m = put(kit.inlineChip({ kind: 'mention', bot: { id: 'kai', name: 'kai' }, action: true, label: 'Open kai' }));
    expect([m.tagName, m.getAttribute('aria-label')]).toEqual(['BUTTON', 'Open kai']);
  });
  it('set into a composer it is one unit whose own text is the words typed', () => {
    const c = put(kit.inlineChip({ kind: 'mention', bot: { id: 'kai', name: 'kai' }, words: '@kai' }));
    expect(c.getAttribute('contenteditable')).toBe('false');
    expect(c.textContent).toBe('@kai');
  });
  it('@all is marked as the whole room\'s mention; a member\'s is not', () => {
    document.body.innerHTML = kit.html.inlineChip({ kind: 'mention', text: '@all', members: [{ name: 'kai' }, { name: 'nina' }] }) + kit.html.inlineChip({ kind: 'mention', bot: { name: 'kai' } });
    const [all, one] = [...document.querySelectorAll('.k7-mention')];
    expect(all?.hasAttribute('data-all')).toBe(true);
    expect(one?.hasAttribute('data-all')).toBe(false);
  });
});
