// @vitest-environment jsdom
/* Well: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './well';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.well>[0] = { text: 'pnpm test' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Well', () => {
  it('draws the component its contract names (data-kit="Well")', () => {
    const el = put(kit.well(EX));
    expect(el.matches('[data-kit~="Well"]') || !!el.querySelector('[data-kit~="Well"]')).toBe(true);
    expect(contract.name).toBe('Well');
  });
  it('a focusable region of mono text; a terminal says its folder and its prompt', () => {
    const w = put(kit.well(EX));
    const pre = w.querySelector('pre') as HTMLElement;
    expect([pre.getAttribute('role'), pre.tabIndex, pre.getAttribute('aria-label')]).toEqual(['region', 0, 'Code']);
    const t = put(kit.well({ kind: 'terminal', text: '$ pnpm test', path: '~/work/app' }));
    expect(t.querySelector('.k7-well__prompt')?.textContent).toBe('$');
    expect(t.querySelector('.k7-well__head')?.textContent).toContain('~/work/app');
  });
});

describe('story: Well, 6e', () => {
  it('a Well holds a compact thread as markup', () => {
    const w = put(kit.well({ kind: 'thread', text: '', html: '<p data-role="user">hi</p>' }));
    expect(w.querySelector('.k7-well__thread [data-role="user"]')?.textContent).toBe('hi');
    expect(w.querySelector('pre')).toBeNull();
  });
});
