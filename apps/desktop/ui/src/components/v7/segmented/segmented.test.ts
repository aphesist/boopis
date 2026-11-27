// @vitest-environment jsdom
/* Segmented: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './segmented';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.segmented>[0] = { label: 'Scope', value: 'a', items: [{ value: 'a', label: 'This bot' }, { value: 'b', label: 'Every bot' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Segmented', () => {
  it('draws the component its contract names (data-kit="Segmented")', () => {
    const el = put(kit.segmented(EX));
    expect(el.matches('[data-kit~="Segmented"]') || !!el.querySelector('[data-kit~="Segmented"]')).toBe(true);
    expect(contract.name).toBe('Segmented');
  });
  it('a radio group with the chosen item checked and the only tab stop; tabs are a tablist', () => {
    const s = put(kit.segmented(EX));
    expect(s.getAttribute('role')).toBe('radiogroup');
    const items = [...s.querySelectorAll<HTMLElement>('[data-kit-part~="SegmentedItem"]')];
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(items.map((i) => i.tabIndex)).toEqual([0, -1]);
    expect(put(kit.segmented({ ...EX, variant: 'tabs' })).getAttribute('role')).toBe('tablist');
  });
});

describe('scene: Segmented', () => {
  it('a press chooses, moves the thumb and says the value; the arrows move and choose', () => {
    const s = put(kit.segmented(EX));
    const seen: unknown[] = []; s.addEventListener('ui:change', (e) => { seen.push((e as CustomEvent<{ value: string }>).detail.value); });
    const [a, b] = [...s.querySelectorAll<HTMLButtonElement>('[data-kit-part~="SegmentedItem"]')];
    b?.click();
    expect(seen).toEqual(['b']);
    expect(s.style.getPropertyValue('--i')).toBe('1');
    b?.focus();
    b?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(seen).toEqual(['b', 'a']);
    expect(a?.getAttribute('aria-checked')).toBe('true');
  });
});
