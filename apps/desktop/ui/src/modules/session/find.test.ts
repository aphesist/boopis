// @vitest-environment jsdom
/* Find in a conversation (6e): every place the words are, in reading order, case ignored, never in a control or what is hidden. */
import { describe, expect, it } from 'vitest';
import { findRanges } from './find';

describe('findRanges', () => {
  it('finds each match in the thread\'s words, and none in buttons or hidden text', () => {
    const col = document.createElement('div');
    col.innerHTML = '<p>Cents and more cents</p><p>CENTS</p><button>cents</button><span aria-hidden="true">cents</span>';
    document.body.append(col);
    const r = findRanges(col, 'cents');
    expect(r.length).toBe(3);
    expect(r.map((x) => x.toString())).toEqual(['Cents', 'cents', 'CENTS']);
    expect(findRanges(col, '')).toEqual([]);
  });
});
