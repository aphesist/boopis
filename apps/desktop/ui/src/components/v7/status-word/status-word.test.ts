// @vitest-environment jsdom
/* StatusWord: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './status-word';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.statusWord>[0] = { text: 'needs you', tone: 'owe' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: StatusWord', () => {
  it('draws the component its contract names (data-kit="StatusWord")', () => {
    const el = put(kit.statusWord(EX));
    expect(el.matches('[data-kit~="StatusWord"]') || !!el.querySelector('[data-kit~="StatusWord"]')).toBe(true);
    expect(contract.name).toBe('StatusWord');
  });
  it('its tone is data, and a pulse is a live dot hidden from readers', () => {
    const w = put(kit.statusWord({ text: 'working', pulse: true }));
    expect(w.dataset['tone']).toBe('neutral');
    const dot = w.querySelector('.k7-dot');
    expect([dot?.getAttribute('aria-hidden'), dot?.hasAttribute('data-pulse')]).toEqual(['true', true]);
    expect(put(kit.statusWord(EX)).dataset['tone']).toBe('owe');
  });
});
