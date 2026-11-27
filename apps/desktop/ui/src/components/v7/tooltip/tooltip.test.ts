// @vitest-environment jsdom
/* Tooltip: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './tooltip';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.tooltip>[0] = { label: 'Copy', keys: 'mod+C' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Tooltip', () => {
  it('draws the component its contract names (data-kit="Tooltip")', () => {
    const el = put(kit.tooltip(EX));
    expect(el.matches('[data-kit~="Tooltip"]') || !!el.querySelector('[data-kit~="Tooltip"]')).toBe(true);
    expect(contract.name).toBe('Tooltip');
  });
  it('is a tooltip that says the name, then the keys', () => {
    const t = put(kit.tooltip({ label: 'Copy', keys: 'mod+C' }));
    expect(t.getAttribute('role')).toBe('tooltip');
    expect(t.firstElementChild?.textContent).toBe('Copy');
    expect(t.querySelector('[data-kit~="Kbd"]')).not.toBeNull();
  });
});
