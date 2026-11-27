// @vitest-environment jsdom
/* Badge: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './badge';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.badge>[0] = { text: '3' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Badge', () => {
  it('draws the component its contract names (data-kit="Badge")', () => {
    const el = put(kit.badge(EX));
    expect(el.matches('[data-kit~="Badge"]') || !!el.querySelector('[data-kit~="Badge"]')).toBe(true);
    expect(contract.name).toBe('Badge');
  });
  it('a count with its tone, named where the count alone says too little', () => {
    const b = put(kit.badge({ text: '3', tone: 'owe', label: '3 waiting' }));
    expect([b.textContent, b.dataset['tone'], b.getAttribute('aria-label')]).toEqual(['3', 'owe', '3 waiting']);
  });
});
