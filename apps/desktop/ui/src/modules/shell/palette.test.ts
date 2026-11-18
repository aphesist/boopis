import { describe, expect, it } from 'vitest';
import { score } from './palette';

describe('palette scoring', () => {
  const item = { label: 'Hide sidebar', meta: 'layout', keys: 'sidebar left' };
  it('an empty query matches everything', () => { expect(score(item, '')).toBe(1); });
  it('every word must match somewhere, or the item is out', () => {
    expect(score(item, 'hide sidebar')).toBeGreaterThan(0);
    expect(score(item, 'hide zebra')).toBe(0);
  });
  it('a match at the start of the label beats one in the middle, and the label beats the keywords', () => {
    expect(score(item, 'hide')).toBeGreaterThan(score(item, 'sidebar'));
    expect(score(item, 'sidebar')).toBeGreaterThan(score(item, 'left'));
  });
  it('is case-insensitive through the caller (queries are lower-cased before scoring)', () => {
    expect(score({ label: 'Settings' }, 'set')).toBeGreaterThan(0);
  });
});
