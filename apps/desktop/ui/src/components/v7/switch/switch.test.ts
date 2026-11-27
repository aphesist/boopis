// @vitest-environment jsdom
/* Switch: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './switch';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.switch>[0] = { label: 'Sounds' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Switch', () => {
  it('draws the component its contract names (data-kit="Switch")', () => {
    const el = put(kit.switch(EX));
    expect(el.matches('[data-kit~="Switch"]') || !!el.querySelector('[data-kit~="Switch"]')).toBe(true);
    expect(contract.name).toBe('Switch');
  });
  it('is a switch that says whether it is on', () => {
    const s = put(kit.switch({ label: 'Sounds', checked: true }));
    expect(s.getAttribute('role')).toBe('switch');
    expect(s.getAttribute('aria-checked')).toBe('true');
    expect(s.getAttribute('aria-label')).toBe('Sounds');
  });
});

describe('scene: Switch', () => {
  it('a press applies at once and says the new value; cancelled or disabled, it stays', () => {
    const s = put(kit.switch({ label: 'Sounds' })) as HTMLButtonElement;
    const seen: unknown[] = []; s.addEventListener('ui:change', (e) => { seen.push((e as CustomEvent<{ value: boolean }>).detail.value); });
    s.click();
    expect([seen, s.getAttribute('aria-checked')]).toEqual([[true], 'true']);
    const off = put(kit.switch({ label: 'Sounds', disabled: true })) as HTMLButtonElement;
    off.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(off.getAttribute('aria-checked')).toBe('false');
  });
});
