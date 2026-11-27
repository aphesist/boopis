// @vitest-environment jsdom
/* FileCard: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './file-card';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.fileCard>[0] = { name: 'notes.md', meta: '2 KB' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: FileCard', () => {
  it('draws the component its contract names (data-kit="FileCard")', () => {
    const el = put(kit.fileCard(EX));
    expect(el.matches('[data-kit~="FileCard"]') || !!el.querySelector('[data-kit~="FileCard"]')).toBe(true);
    expect(contract.name).toBe('FileCard');
  });
  it('the name and one mono line; one that opens is a control', () => {
    const f = put(kit.fileCard({ ...EX, opens: true }));
    expect(f.textContent).toContain('notes.md');
    expect(f.hasAttribute('data-action')).toBe(true);
  });
});

describe('scene: FileCard', () => {
  it('one that opens is pressed with Enter', () => {
    const f = put(kit.fileCard({ ...EX, opens: true }));
    let n = 0; f.addEventListener('click', () => { n++; });
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(n).toBe(1);
  });
});
