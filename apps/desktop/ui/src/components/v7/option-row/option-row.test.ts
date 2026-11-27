// @vitest-environment jsdom
/* OptionRow: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './option-row';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.optionRow>[0] = { label: 'Ask first', meaning: 'Asks before it changes a file' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: OptionRow', () => {
  it('draws the component its contract names (data-kit="OptionRow")', () => {
    const el = put(kit.optionRow(EX));
    expect(el.matches('[data-kit~="OptionRow"]') || !!el.querySelector('[data-kit~="OptionRow"]')).toBe(true);
    expect(contract.name).toBe('OptionRow');
  });
  it('a radio item whose second line is never cut; one that cannot be chosen says so', () => {
    const r = put(kit.optionRow({ ...EX, chosen: true }));
    expect([r.getAttribute('role'), r.getAttribute('aria-checked')]).toEqual(['menuitemradio', 'true']);
    expect(r.querySelector('.k7-orow__meaning')?.hasAttribute('data-wrap-ok')).toBe(true);
    expect(put(kit.optionRow({ ...EX, disabled: true })).getAttribute('aria-disabled')).toBe('true');
  });
});
