import { describe, expect, it } from 'vitest';
import { letters, monogram } from './letters';

describe('tile letters', () => {
  it('takes two words\' first letters, skipping small words', () => {
    expect(monogram('Release notes')).toBe('RN');
    expect(monogram('The Linear app')).toBe('LA');
    expect(monogram('', 'store:pdf-files')).toBe('PF');
    expect(monogram('')).toBe('?');
  });
  it('gives a one-word name its next capital, digit or consonant (board 15)', () => {
    expect(letters('Context7')).toBe('C7');
    expect(letters('GitHub')).toBe('GH');
    expect(letters('Linear')).toBe('LN');
  });
});
