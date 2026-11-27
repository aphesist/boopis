// @vitest-environment jsdom
/* Dock: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './dock';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.dock>[0] = { bots: [{ id: 'kai', name: 'kai' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Dock', () => {
  it('draws the component its contract names (data-kit="Dock")', () => {
    const el = put(kit.dock(EX));
    expect(el.matches('[data-kit~="Dock"]') || !!el.querySelector('[data-kit~="Dock"]')).toBe(true);
    expect(contract.name).toBe('Dock');
  });
  it('says its geometry as data and names each orb with its state', () => {
    const d = put(kit.dock({ bots: [{ id: 'kai', name: 'kai' }, { id: 'nina', name: 'nina', needs: true }] }));
    expect(d.dataset['dk']).toBe('row');
    expect([...d.querySelectorAll('.k7-dock__orb')].map((o) => o.getAttribute('aria-label'))).toEqual(['kai, idle', 'nina, needs you']);
    expect(put(kit.dock({ kind: 'compact', bots: [] })).dataset['dk']).toBe('compact');
  });
});
