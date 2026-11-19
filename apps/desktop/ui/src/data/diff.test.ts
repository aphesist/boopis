import { describe, expect, it } from 'vitest';
import { lineDiff, valueDiff } from './diff';

describe('a diff to read before saving', () => {
  it('says nothing when nothing changed', () => { expect(lineDiff('a\nb\n', 'a\nb\n')).toBe(''); expect(valueDiff('x', 'x')).toBe(''); });
  it('shows an added line with its neighbours', () => { expect(lineDiff('a\nb\nc', 'a\nb\nnew\nc')).toBe('  a\n  b\n+ new\n  c'); });
  it('shows a changed line as removed then added', () => { expect(lineDiff('one\ntwo\nthree', 'one\n2\nthree')).toBe('  one\n- two\n+ 2\n  three'); });
  it('a trailing newline is not a line, and the empty text has none', () => {
    expect(lineDiff('a\n', 'a\nb\n')).toBe('  a\n+ b');
    expect(lineDiff('', 'first')).toBe('+ first');
    expect(lineDiff('gone', '')).toBe('- gone');
  });
  it('cuts the kept lines far from a change to an ellipsis', () => {
    const a = Array.from({ length: 12 }, (_, i) => 'l' + i).join('\n');
    const b = a.replace('l6', 'six');
    expect(lineDiff(a, b, { context: 1 })).toBe('  …\n  l5\n- l6\n+ six\n  l7\n  …');
  });
  it('a huge text is shown as replaced, not as a quadratic table', () => {
    const big = Array.from({ length: 2500 }, (_, i) => 'x' + i).join('\n');
    const out = lineDiff(big, big + '\nmore');
    expect(out.startsWith('- x0\n- x1')).toBe(true);
    expect(out.endsWith('+ more')).toBe(true);
  });
  it('a single value is its old line then its new one', () => {
    expect(valueDiff('reviewer', 'security reviewer')).toBe('- reviewer\n+ security reviewer');
    expect(valueDiff('', 'new role')).toBe('+ new role');
  });
});
