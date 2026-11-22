import { describe, expect, it } from 'vitest';
import { rollLook, SHAPES, SWATCHES } from './look';

const colours = SWATCHES.map(([c]) => c);
/** a seeded generator (mulberry32): the same seed, the same rolls */
const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('rollLook', () => {
  it('answers a shape and a colour (never eyes) from the allowed sets', () => {
    const r = seeded(1);
    for (let i = 0; i < 100; i++) {
      const l = rollLook({ random: r });
      expect(SHAPES).toContain(l.shape); expect(colours).toContain(l.color); expect(Object.keys(l).sort()).toEqual(['color', 'shape']);
    }
  });
  it('keeps to the shapes offered', () => {
    const r = seeded(2);
    for (let i = 0; i < 50; i++) expect(['star', 'drop']).toContain(rollLook({ shapes: ['star', 'drop'], random: r }).shape);
  });
  it('changes shape or colour from the look in the field', () => {
    const r = seeded(3);
    let cur = { shape: 'circle', color: colours[0] as string };
    for (let i = 0; i < 50; i++) {
      const l = rollLook({ avoid: cur, random: r });
      expect(l.shape !== cur.shape || l.color !== cur.color).toBe(true);
      cur = l;
    }
  });
  it('avoids a look an existing bot has while another is free, and answers one when all are taken', () => {
    const taken = SHAPES.flatMap((shape) => colours.map((color) => ({ shape, color }))).slice(1);
    const free = { shape: SHAPES[0] as string, color: colours[0] as string };
    for (const v of [0, 0.5, 0.999]) expect(rollLook({ taken, random: () => v })).toMatchObject(free);
    const all = [...taken, free];
    expect(SHAPES).toContain(rollLook({ taken: all, random: () => 0 }).shape);
  });
  it('is deterministic with a seeded random', () => {
    const a = Array.from({ length: 10 }, ((r) => () => rollLook({ random: r }))(seeded(7)));
    const b = Array.from({ length: 10 }, ((r) => () => rollLook({ random: r }))(seeded(7)));
    expect(a).toEqual(b);
  });
});
