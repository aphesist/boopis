/* v7 theming (DESIGN-SYSTEM.md v7 section 18): the accent's derived tokens hold their contrast floors, and a bot's own
   fill (18.1) gives the six mock bots the values the design lists. */
import { describe, expect, it } from 'vitest';
import { ratio } from '../../styles/colour';
import { botFill, deriveAccent } from './theme';

describe('a custom accent', () => {
  for (const hex of ['#5b5bd6', '#ffd60a', '#1e2a78', '#0e9f5a', '#c8770c', '#ffffff', '#000000']) {
    it(hex + ' derives text, focus and the colour on it at 4.5:1', () => {
      const d = deriveAccent(hex, 'dark'), l = deriveAccent(hex, 'light');
      expect(ratio(d['--accent-text'], '#1f1f1f')).toBeGreaterThanOrEqual(4.5);
      expect(ratio(d['--accent-text'], '#0e0e0e')).toBeGreaterThanOrEqual(4.5);
      expect(ratio(l['--accent-text'], '#f5f5f5')).toBeGreaterThanOrEqual(4.5);
      expect(d['--focus']).toBe(d['--accent-text']);
      expect(ratio(d['--on-accent'], d['--accent'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(d['--accent-mark'], '#121212')).toBeGreaterThanOrEqual(3);
      expect(ratio(l['--accent-mark'], '#fcfcfc')).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("a bot's fill in its own chat (18.1)", () => {
  /* the looks of the approved renders (ds-v7 kit.js LOOKS) and the fills 18.1 lists */
  const CASES: [string, string, string, string][] = [
    ['kai', '#4fc9a8', '#4fc9a8', '#121212'], ['nina', '#f23b5a', '#e1274d', '#ffffff'], ['moss', '#2fd26a', '#2fd26a', '#121212'],
    ['iris', '#3b82f6', '#2b72e5', '#ffffff'], ['hex', '#a6a6ab', '#a6a6ab', '#121212'], ['nimbus', '#9b5cf6', '#9252ec', '#ffffff']
  ];
  for (const [name, orb, fill, text] of CASES) it(name, () => {
    const f = botFill(orb);
    expect(f.text).toBe(text);
    expect(ratio(f.fill, fill)).toBeLessThan(1.06);
    expect(ratio(f.text, f.fill)).toBeGreaterThanOrEqual(4.5);
  });
});
