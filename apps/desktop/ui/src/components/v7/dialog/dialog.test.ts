// @vitest-environment jsdom
/* Dialog: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './dialog';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.dialog>[0] = { title: 'Commit', body: '<p>Message</p>' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Dialog', () => {
  it('draws the component its contract names (data-kit="Dialog")', () => {
    const el = put(kit.dialog(EX));
    expect(el.matches('[data-kit~="Dialog"]') || !!el.querySelector('[data-kit~="Dialog"]')).toBe(true);
    expect(contract.name).toBe('Dialog');
  });
  it('a modal dialog named by its title, in its scrim, with a close that says esc', () => {
    const s = put(kit.dialog({ ...EX, actions: [{ label: 'Commit', variant: 'primary' }] }));
    const d = s.querySelector('[data-kit~="Dialog"]') as HTMLElement;
    expect([d.getAttribute('role'), d.getAttribute('aria-modal')]).toEqual(['dialog', 'true']);
    expect(d.querySelector('#' + d.getAttribute('aria-labelledby'))?.textContent).toBe('Commit');
    expect(d.querySelector('[data-dialog-close]')?.getAttribute('data-kbd')).toBe('esc');
  });
});

describe('story: Dialog, 6e', () => {
  it('a Dialog\'s action that cannot be taken is aria-disabled and says why in its tip', () => {
    const d = put(kit.dialog({ title: 'Rewind', body: '', actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Rewind', variant: 'primary', disabled: true, tip: 'A shared checkout' }] }));
    const b = [...d.querySelectorAll<HTMLButtonElement>('.k7-dialog__foot .k7-btn')].find((x) => x.textContent === 'Rewind') as HTMLButtonElement;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(b.dataset['tip']).toBe('A shared checkout');
  });
});
