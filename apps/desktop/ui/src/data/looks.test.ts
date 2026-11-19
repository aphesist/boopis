import { describe, expect, it } from 'vitest';
import { EYES, lookFor, SHAPES, SWATCHES } from './looks';

describe('the look a name gives a bot', () => {
  it('is always the same for the same name, and always from the pickers’ palettes', () => {
    for (const n of ['atlas', 'Nina', 'a very long name indeed', '']) {
      const l = lookFor(n);
      expect(lookFor(n)).toEqual(l);
      expect(SWATCHES.map((s) => s[0])).toContain(l.color);
      expect(SHAPES).toContain(l.shape);
      expect(EYES).toContain(l.eyes);
    }
  });
  it('spreads names over the palette rather than giving every bot one face', () => {
    const faces = new Set(['atlas', 'nina', 'kai', 'iris', 'hex', 'sol', 'noct', 'terra', 'nimbus', 'vox', 'moss'].map((n) => JSON.stringify(lookFor(n))));
    expect(faces.size).toBeGreaterThan(8);
  });
});
