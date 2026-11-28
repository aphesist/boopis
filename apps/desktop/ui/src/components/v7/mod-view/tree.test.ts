import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES, LIMITS, h, handlerId, textOf, validateTree } from './tree';
import type { ModElement } from './tree';

const text = (n: number): string => 'x'.repeat(n);
const deep = (n: number): ModElement => { let t: ModElement = h.Text(null, 'leaf'); for (let i = 1; i < n; i++) t = h.Box(null, t); return t; };

describe('the limits of a tree (docs/MODS.md section 2)', () => {
  it('knows the nine elements and the documented numbers', () => {
    expect(ELEMENT_TYPES).toEqual(['Box', 'Text', 'Button', 'Input', 'Select', 'Markdown', 'Code', 'Link', 'Svg']);
    expect([LIMITS.chars, LIMITS.elements, LIMITS.depth]).toEqual([100000, 20000, 32]);
  });
  it('accepts a tree that is exactly at a limit and refuses one past it: depth 32 and 33', () => {
    expect(validateTree(deep(32)).ok).toBe(true);
    const r = validateTree(deep(33));
    expect(r).toEqual({ ok: false, reason: 'deeper than 32' });
  });
  it('counts elements: 20,000 pass, 20,001 do not', () => {
    const many = (n: number): ModElement => h.Box(null, ...Array.from({ length: n - 1 }, () => h.Text(null)));
    expect(validateTree(many(20000)).ok).toBe(true);
    expect(validateTree(many(20001))).toEqual({ ok: false, reason: 'more than 20000 elements' });
  });
  it('counts the characters drawn, in text children and in text props: 100,000 pass, one more does not', () => {
    expect(validateTree(h.Text(null, text(100000))).ok).toBe(true);
    expect(validateTree(h.Text(null, text(100001)))).toEqual({ ok: false, reason: 'more than 100000 characters' });
    expect(validateTree(h.Markdown({ text: text(100001) }))).toEqual({ ok: false, reason: 'more than 100000 characters' });
    expect(validateTree(h.Box(null, h.Text(null, text(60000)), h.Code({ source: text(40001) })))).toEqual({ ok: false, reason: 'more than 100000 characters' });
  });
  it('caps an Svg at 131,072 characters and a Link href at 2,048', () => {
    expect(validateTree(h.Svg({ svg: text(131073) })).ok).toBe(false);
    expect(validateTree(h.Link({ href: 'https://x.test/' + text(2040) })).ok).toBe(false);
    expect(validateTree(h.Link({ href: 'https://x.test/' + text(100) })).ok).toBe(true);
  });
  it('refuses the whole tree for an element it does not know, however deep', () => {
    const r = validateTree(h.Box(null, h.Box(null, { type: 'Client', props: {}, children: [] })));
    expect(r).toEqual({ ok: false, reason: 'unknown element Client' });
    expect(validateTree({ props: {} }).ok).toBe(false);
  });
  it('draws nothing for null, true and false children, and counts numbers as text', () => {
    expect(validateTree(h.Box(null, null, false, true, 12))).toEqual({ ok: true, count: 1, chars: 2 });
  });
  it('does not overflow the stack on a hostile tree (the walk is iterative)', () => {
    expect(validateTree(deep(200000)).ok).toBe(false);
  });
});

describe('handlers are ids', () => {
  it('reads {"$handler": id} from the wire, and a bare id', () => {
    expect(handlerId({ $handler: '0.h3' })).toBe('0.h3');
    expect(handlerId('0.h4')).toBe('0.h4');
    expect(handlerId(undefined)).toBeNull();
    expect(handlerId({ $handler: 4 })).toBeNull();
    expect(handlerId(() => 1)).toBeNull();
    expect(handlerId('')).toBeNull();
  });
  it('takes the text of children for a label', () => {
    expect(textOf(['Re', h.Text(null, '-run'), 1, null])).toBe('Re-run1');
    expect(textOf(undefined)).toBe('');
  });
});
