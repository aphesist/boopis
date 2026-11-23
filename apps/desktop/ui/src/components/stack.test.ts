// @vitest-environment jsdom
/* The stack's cluster (the collapsed sidebar's group avatar): where each member lies for two to six members, the same every time,
   and the markup the kit draws from it. The line stack is checked where it is drawn (modules/bots/groups.test.ts, one-look.test.ts). */
import { describe, expect, it } from 'vitest';
import { clusterLayout, html, stackSplit } from '@boopis/ui';

const S = 16;
/** the distance between two places' centres */
const apart = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('clusterLayout', () => {
  it('places two to six members around a circle, the first at the top, the same numbers every time', () => {
    expect(clusterLayout(2, S)).toEqual({ w: 24, h: 24, at: [{ x: 0, y: 0, dx: -1, dy: -1 }, { x: 8, y: 8, dx: 1, dy: 1 }] });
    expect(clusterLayout(3, S)).toEqual({ w: 27, h: 25, at: [{ x: 5, y: 0, dx: 0, dy: -1 }, { x: 11, y: 9, dx: 1, dy: 1 }, { x: 0, y: 9, dx: -1, dy: 1 }] });
    expect(clusterLayout(4, S)).toEqual({ w: 27, h: 27, at: [{ x: 0, y: 0, dx: -1, dy: -1 }, { x: 11, y: 0, dx: 1, dy: -1 }, { x: 11, y: 11, dx: 1, dy: 1 }, { x: 0, y: 11, dx: -1, dy: 1 }] });
    expect(clusterLayout(5, S)).toEqual({ w: 31, h: 30, at: [{ x: 8, y: 0, dx: 0, dy: -1 }, { x: 15, y: 6, dx: 1, dy: 0 }, { x: 12, y: 14, dx: 1, dy: 1 }, { x: 3, y: 14, dx: -1, dy: 1 }, { x: 0, y: 6, dx: -1, dy: 0 }] });
    expect(clusterLayout(6, S)).toEqual({ w: 30, h: 32, at: [{ x: 7, y: 0, dx: 0, dy: -1 }, { x: 14, y: 4, dx: 1, dy: -1 }, { x: 14, y: 12, dx: 1, dy: 1 }, { x: 7, y: 16, dx: 0, dy: 1 }, { x: 0, y: 12, dx: -1, dy: 1 }, { x: 0, y: 4, dx: -1, dy: -1 }] });
    for (let n = 1; n <= 6; n++) expect(clusterLayout(n, S)).toEqual(clusterLayout(n, S));
  });
  it('draws one member alone, whole, at the corner of its own box', () => {
    expect(clusterLayout(1, S)).toEqual({ w: 16, h: 16, at: [{ x: 0, y: 0, dx: 0, dy: 0 }] });
    expect(clusterLayout(0, S)).toEqual(clusterLayout(1, S));
  });
  it('overlaps neighbours by the stack\'s step, a third of an orb, as far as two orbs\' width allows', () => {
    for (const n of [2, 3, 4]) {
      const { at } = clusterLayout(n, S);
      for (let i = 0; i < n; i++) {
        const d = apart(at[i]!, at[(i + 1) % n]!);
        if (n > 2 || i === 0) expect(Math.abs(d - (2 * S) / 3)).toBeLessThanOrEqual(1);   /* whole pixels move a centre by half a pixel at most */
      }
    }
    for (const n of [5, 6]) {
      const { at } = clusterLayout(n, S);
      for (let i = 0; i < n; i++) { const d = apart(at[i]!, at[(i + 1) % n]!); expect(d).toBeGreaterThan(S / 2 - 1); expect(d).toBeLessThan((2 * S) / 3); }
    }
  });
  it('never grows wider or taller than two orbs, and its box starts at its first pixel', () => {
    for (let n = 1; n <= 6; n++) {
      const { w, h, at } = clusterLayout(n, S);
      expect(w).toBeLessThanOrEqual(2 * S); expect(h).toBeLessThanOrEqual(2 * S);
      expect(Math.min(...at.map((p) => p.x))).toBe(0); expect(Math.min(...at.map((p) => p.y))).toBe(0);
      expect(Math.max(...at.map((p) => p.x)) + S).toBe(w); expect(Math.max(...at.map((p) => p.y)) + S).toBe(h);
      for (const p of at) { expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true); expect(Object.is(p.x, -0) || Object.is(p.y, -0) || Object.is(p.dx, -0) || Object.is(p.dy, -0)).toBe(false); }
    }
  });
  it('scales with the orb', () => {
    const big = clusterLayout(4, 32);
    expect(big.w).toBe(53); expect(big.at[2]).toEqual({ x: 21, y: 21, dx: 1, dy: 1 });
  });
});

const team = ['kai', 'nina', 'moss', 'iris', 'hex', 'nimbus'].map((id) => ({ id, name: id, state: 'idle' }));
function cluster(n: number, opts: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html.stack({ members: team.slice(0, n), size: S, shape: 'cluster', still: true, ...opts });
  return host.firstElementChild as HTMLElement;
}
const places = (el: HTMLElement): string[] => [...el.children].map((c) => (c.classList.contains('ui-stack__more') ? c.getAttribute('data-more') ?? '' : c.querySelector('orb-avatar')?.getAttribute('label') ?? '') + ' ' + (c as HTMLElement).style.getPropertyValue('--x') + ',' + (c as HTMLElement).style.getPropertyValue('--y'));

describe('a stack drawn as a cluster', () => {
  it('draws two, three and four members whole, each at its place, the first underneath', () => {
    expect(places(cluster(2))).toEqual(['kai 0px,0px', 'nina 8px,8px']);
    expect(places(cluster(3))).toEqual(['kai 5px,0px', 'nina 11px,9px', 'moss 0px,9px']);
    expect(places(cluster(4))).toEqual(['kai 0px,0px', 'nina 11px,0px', 'moss 11px,11px', 'iris 0px,11px']);
    const c = cluster(3);
    expect(c.classList.contains('ui-stack--cluster')).toBe(true);
    expect(c.style.getPropertyValue('--w')).toBe('27px'); expect(c.style.getPropertyValue('--h')).toBe('25px');
  });
  it('draws five and six members in four places, the last of them "+N", as the row\'s stack does', () => {
    expect(places(cluster(5))).toEqual(['kai 0px,0px', 'nina 11px,0px', 'moss 11px,11px', '+2 0px,11px']);
    expect(places(cluster(6))).toEqual(['kai 0px,0px', 'nina 11px,0px', 'moss 11px,11px', '+3 0px,11px']);
    expect(stackSplit(6, 4)).toEqual({ shown: 3, more: 3 });
    expect(cluster(6).getAttribute('data-count')).toBe('6');
  });
  it('draws six members in six places when asked for six', () => {
    expect(places(cluster(6, { max: 6 })).map((p) => p.split(' ')[0])).toEqual(['kai', 'nina', 'moss', 'iris', 'hex', 'nimbus']);
  });
  it('counts members it cannot draw in "+N", and is still drawn when it can draw none of them', () => {
    expect(places(cluster(1, { extra: 2 }))).toEqual(['kai 0px,0px', '+2 8px,8px']);
    const none = cluster(0, { extra: 3 });
    expect(none.hidden).toBe(false);
    expect(places(none)).toEqual(['+3 0px,0px']);
    expect(cluster(0).hidden).toBe(true);
  });
  it('draws its orbs still, at 16px', () => {
    for (const o of cluster(4).querySelectorAll('orb-avatar')) { expect(o.hasAttribute('static')).toBe(true); expect(o.getAttribute('size')).toBe('16'); }
  });
  it('is one image named by the members; it has no tooltip of its own inside a row that names them', () => {
    const c = cluster(3, { label: 'kai, nina and moss' });
    expect(c.getAttribute('role')).toBe('img'); expect(c.getAttribute('aria-label')).toBe('kai, nina and moss'); expect(c.getAttribute('data-tip')).toBe('kai, nina and moss');
    expect(cluster(3, { tip: false }).hasAttribute('data-tip')).toBe(false);
  });
  it('leaves the line stack as it was', () => {
    const host = document.createElement('div');
    host.innerHTML = html.stack({ members: team, size: S, max: 4, still: true });
    const line = host.firstElementChild as HTMLElement;
    expect(line.classList.contains('ui-stack--cluster')).toBe(false);
    expect(line.getAttribute('style')).toBe('--s:16px;--places:4');
    expect([...line.children].map((c) => c.getAttribute('style'))).toEqual([null, null, null, null]);
    expect(line.querySelector('.ui-stack__more')?.getAttribute('data-more')).toBe('+3');
  });
});
