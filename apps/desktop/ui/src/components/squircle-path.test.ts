import { describe, expect, it } from 'vitest';
import golden from './squircle-golden.json';
import { clearSegCache, concavePath, cornerParams, cornerTo, segCacheSize, slabPath, squirclePath } from './squircle-path';
import type { Radii } from './squircle-path';

/* squircle-golden.json is the output of the approved v6 reference (design/v6/components/components.js, HX.ui.squircle):
   the port must draw the same corner, character for character. */
describe('squircle paths against the v6 reference', () => {
  it.each(golden.path.map((g) => [JSON.stringify([g.w, g.h, g.r, ('opt' in g ? g.opt : null)]), g] as const))('path %s', (_n, g) => {
    expect(squirclePath(g.w, g.h, g.r as Radii, 'opt' in g ? (g.opt as { smoothing?: number; x?: number; y?: number }) : undefined)).toBe(g.d);
  });
  it.each(golden.corner.map((g) => [JSON.stringify(g.args) + ('opt' in g ? JSON.stringify(g.opt) : ''), g] as const))('cornerTo %s', (_n, g) => {
    const [ax, ay, cx, cy, bx, by] = g.args as [number, number, number, number, number, number];
    expect(cornerTo(ax, ay, cx, cy, bx, by, 'opt' in g ? (g.opt as { round: boolean }) : undefined)).toBe(g.d);
  });
  it.each(golden.slab.map((g) => [JSON.stringify(g.args) + JSON.stringify(g.opt), g] as const))('slab %s', (_n, g) => {
    const [w, h, R, F] = g.args as [number, number, number, number];
    expect(slabPath(w, h, R, F, g.opt ?? undefined)).toBe(g.d);
  });
});

describe('the corner', () => {
  it('runs (1 + smoothing) times the radius along each edge and keeps a 36 degree arc at 0.6', () => {
    const q = cornerParams(20, 0.6, 1000);
    expect(q?.p).toBeCloseTo(32, 6);
    expect(Math.asin((q?.arc ?? 0) / (20 * Math.SQRT2)) * 2 * 180 / Math.PI).toBeCloseTo(36, 6);
  });
  it('shrinks the smoothing before it passes the middle of a short edge', () => {
    const q = cornerParams(20, 0.6, 24);
    expect(q?.p).toBe(24);
    expect(cornerParams(0, 0.6, 24)).toBeNull();
  });
  it('is a plain rectangle with no radius and a plain arc at smoothing 0', () => {
    expect(squirclePath(10, 5, 0)).toBe('M10 0L10 5L0 5L0 0Z');
    expect(squirclePath(100, 40, 12, { smoothing: 0 })).toContain('a12 12 0 0 1');
  });
  it('closes, stays inside its box and starts on the top edge, for any size', () => {
    for (const [w, h, r] of [[100, 40, 12], [31, 17, 30], [392, 300, 30], [8, 200, 12]] as const) {
      const d = squirclePath(w, h, r);
      expect(d.endsWith('Z')).toBe(true);
      expect(d.startsWith('M')).toBe(true);
      const abs = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      for (const [x, y] of abs) { expect(x).toBeGreaterThanOrEqual(-0.01); expect(x).toBeLessThanOrEqual(w + 0.01); expect(y).toBeGreaterThanOrEqual(-0.01); expect(y).toBeLessThanOrEqual(h + 0.01); }
    }
  });
  it('draws a concave flare', () => {
    expect(concavePath(30, 'tr').startsWith('M30 0L0 0')).toBe(true);
    expect(concavePath(30, 'tl').startsWith('M0 0L30 0')).toBe(true);
  });
});

describe('the corner cache', () => {
  it('keeps a corner by radius, smoothing and direction, so a resize rebuilds only the straight edges', () => {
    clearSegCache();
    squirclePath(100, 40, 12);
    const n = segCacheSize();
    expect(n).toBeGreaterThan(0);
    squirclePath(300, 90, 12);   /* another size, the same radius: no new corner */
    expect(segCacheSize()).toBe(n);
    squirclePath(300, 90, 20);
    expect(segCacheSize()).toBeGreaterThan(n);
  });
  it('is bounded', () => {
    clearSegCache();
    for (let i = 1; i <= 4100; i++) squirclePath(10000, 10000, i / 7);
    expect(segCacheSize()).toBeLessThanOrEqual(4001);
  });
});
