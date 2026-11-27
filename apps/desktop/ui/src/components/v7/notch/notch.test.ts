// @vitest-environment jsdom
/* Notch: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './notch';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.notch>[0] = {};
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Notch', () => {
  it('draws the component its contract names (data-kit="Notch")', () => {
    const el = put(kit.notch(EX));
    expect(el.matches('[data-kit~="Notch"]') || !!el.querySelector('[data-kit~="Notch"]')).toBe(true);
    expect(contract.name).toBe('Notch');
  });
  it('the slab, and inside it the notch\'s own composer in the dark theme', () => {
    const n = put(kit.notch({ width: 400 }));
    expect(n.style.getPropertyValue('--w')).toBe('400px');
    expect(n.querySelector('.k7-notch__in')?.getAttribute('data-theme')).toBe('dark');
    expect(n.querySelector('[data-kit~="Composer"]')?.getAttribute('data-kind')).toBe('notch');
  });
});
