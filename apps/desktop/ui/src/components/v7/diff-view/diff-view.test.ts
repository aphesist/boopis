// @vitest-environment jsdom
/* DiffView: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './diff-view';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.diffView>[0] = { path: 'src/a.ts', lines: [{ n: 1, sign: '+', text: 'const a = 1;' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: DiffView', () => {
  it('draws the component its contract names (data-kit="DiffView")', () => {
    const el = put(kit.diffView(EX));
    expect(el.matches('[data-kit~="DiffView"]') || !!el.querySelector('[data-kit~="DiffView"]')).toBe(true);
    expect(contract.name).toBe('DiffView');
  });
  it('a row per line with its sign; a folding head says whether it is open', () => {
    const d = put(kit.diffView({ path: 'src/a.ts', lines: [{ n: 1, sign: '-', text: 'a' }, { n: 1, sign: '+', text: 'b' }] }));
    expect([...d.querySelectorAll<HTMLElement>('[data-kit-part~="DiffRow"]')].map((r) => r.dataset['sign'])).toEqual(['del', 'add']);
    const f = put(kit.diffView({ path: 'src/a.ts', lines: [], fold: true }));
    expect(f.querySelector('.k7-diff__head')?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('scene: DiffView', () => {
  it('its folding head opens it and says so', () => {
    const f = put(kit.diffView({ path: 'src/a.ts', lines: [{ n: 1, sign: '+', text: 'b' }], fold: true }));
    let open: boolean | null = null; f.addEventListener('ui:toggle', (e) => { open = (e as CustomEvent<{ open: boolean }>).detail.open; });
    (f.querySelector('.k7-diff__head') as HTMLElement).click();
    expect([open, f.hasAttribute('data-open')]).toEqual([true, true]);
  });
});
