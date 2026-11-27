// @vitest-environment jsdom
/* Chip: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './chip';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.chip>[0] = { label: 'Tests' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Chip', () => {
  it('draws the component its contract names (data-kit="Chip")', () => {
    const el = put(kit.chip(EX));
    expect(el.matches('[data-kit~="Chip"]') || !!el.querySelector('[data-kit~="Chip"]')).toBe(true);
    expect(contract.name).toBe('Chip');
  });
  it('a filter says whether it is chosen; an answer chip is a plain button', () => {
    const f = put(kit.chip({ label: 'Failing', chosen: true }));
    expect(f.getAttribute('aria-pressed')).toBe('true');
    expect(f.hasAttribute('data-chosen')).toBe(true);
    const a = put(kit.chip({ label: 'Deny', variant: 'answer' }));
    expect(a.hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('scene: Chip', () => {
  it('a press toggles a filter and says so; cancelled, it stays as it was', () => {
    const c = put(kit.chip({ label: 'Failing' }));
    const seen: unknown[] = []; c.addEventListener('ui:change', (e) => { seen.push((e as CustomEvent<{ value: boolean }>).detail.value); });
    c.click();
    expect(seen).toEqual([true]);
    expect(c.getAttribute('aria-pressed')).toBe('true');
    c.addEventListener('ui:change', (e) => { e.preventDefault(); });
    c.click();
    expect(c.getAttribute('aria-pressed')).toBe('true');
  });
  it('an answer chip only reports: a press changes nothing on it', () => {
    const c = put(kit.chip({ label: 'Deny', variant: 'answer' }));
    let n = 0; c.addEventListener('ui:change', () => { n++; });
    c.click();
    expect(n).toBe(0);
  });
});
