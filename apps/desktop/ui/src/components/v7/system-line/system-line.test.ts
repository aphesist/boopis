// @vitest-environment jsdom
/* SystemLine: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './system-line';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.systemLine>[0] = { text: 'Model changed to Opus' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: SystemLine', () => {
  it('draws the component its contract names (data-kit="SystemLine")', () => {
    const el = put(kit.systemLine(EX));
    expect(el.matches('[data-kit~="SystemLine"]') || !!el.querySelector('[data-kit~="SystemLine"]')).toBe(true);
    expect(contract.name).toBe('SystemLine');
  });
  it('a note centred in the thread; a steer carries its message under the line', () => {
    const s = put(kit.systemLine({ text: 'Model changed to Opus', meta: '+$0.04' }));
    expect([s.getAttribute('role'), s.dataset['variant']]).toEqual(['note', 'info']);
    expect(s.querySelector('.k7-sys__meta')?.textContent).toBe('+$0.04');
    const w = put(kit.systemLine({ variant: 'steer', text: 'You steered', message: 'Use the new API' }));
    expect(w.querySelector('.k7-sys__msg')?.textContent).toBe('Use the new API');
  });
});

describe('story: SystemLine, 6e', () => {
  it('a SystemLine says a StatusWord before its words', () => {
    const l = put(kit.systemLine({ text: 'Not switched', word: { text: 'capped', tone: 'owe' } }));
    expect(l.querySelector('[data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('owe');
  });
});
