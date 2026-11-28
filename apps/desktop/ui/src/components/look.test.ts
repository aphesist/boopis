import { describe, expect, it } from 'vitest';
import { lookAttrs, lookFor, lookOf, rollLook, sameLook, SHAPES, SWATCHES } from './look';

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

describe('lookOf: the one look of a bot', () => {
  it('is the saved shape and colour when the record has them (the owner\'s kai and nina)', () => {
    expect(lookOf({ name: 'kai', shape: 'circle', color: '#4fc9a8' })).toEqual({ shape: 'circle', color: '#4fc9a8' });
    expect(lookOf({ name: 'nina', shape: 'triangle', color: '#F23B5A' })).toEqual({ shape: 'triangle', color: '#f23b5a' });
  });
  it('is the look the name gives when there is no record (a profile made outside boopis)', () => {
    expect(lookOf({ name: 'kai' })).toEqual(lookFor('kai'));
    expect(lookOf({ id: 'vox' })).toEqual(lookFor('vox'));
  });
  it('takes each valid part of a record written by hand, and the name\'s for the rest', () => {
    expect(lookOf({ name: 'moss', shape: 'squircle' })).toEqual({ shape: 'squircle', color: lookFor('moss').color });
    expect(lookOf({ name: 'moss', shape: 'blob', color: '#2fd26a' })).toEqual({ shape: lookFor('moss').shape, color: '#2fd26a' });
    expect(lookOf({ name: 'moss', shape: 'squircle', color: 'green' })).toEqual({ shape: 'squircle', color: lookFor('moss').color });
  });
  it('draws an orb with it, with the light eyes of a dark body and never an eye shape', () => {
    expect(lookAttrs({ shape: 'circle', color: '#1c1c24' })['eye-color']).toBe('var(--ink-on-dock)');
    expect(lookAttrs({ shape: 'circle', color: '#4fc9a8' })['eye-color']).toBeNull();
    expect(Object.keys(lookAttrs(lookOf({ name: 'hex', shape: 'hexagon', color: '#a6a6ab' })))).not.toContain('eye-shape');
    expect(sameLook({ name: 'kai' }, lookFor('kai'))).toBe(true);
  });
  it('draws Bone and Ink as their theme does, the other swatches as they are', () => {
    expect(lookAttrs({ shape: 'circle', color: '#efece6' })).toEqual({ shape: 'circle', color: 'var(--look-bone, #efece6)', 'eye-color': 'var(--look-bone-eye, var(--bg-2))' });
    expect(lookAttrs({ shape: 'circle', color: '#EFECE6' }, '--bg-3')['eye-color']).toBe('var(--look-bone-eye, var(--bg-3))');
    expect(lookAttrs({ shape: 'drop', color: '#1c1c24' })).toEqual({ shape: 'drop', color: 'var(--look-ink, #1c1c24)', 'eye-color': 'var(--ink-on-dock)' });
    for (const [hex] of SWATCHES.filter(([c]) => c !== '#efece6' && c !== '#1c1c24')) expect(lookAttrs({ shape: 'circle', color: hex }).color).toBe(hex);
  });
});
