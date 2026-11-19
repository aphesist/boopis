// @vitest-environment jsdom
/* The lab's forced states: a rule that styles :hover, :focus-visible or :active is copied with an attribute in place of the
   pseudo-class, also when it sits behind a pointer media query (the kit's hover rules are in @media (hover: hover) and
   (pointer: fine)). */
import { afterEach, describe, expect, it } from 'vitest';
import { force, installForcing, pointerFree } from './force';

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });
const forced = (): string => document.getElementById('lab-forced')?.textContent ?? '';

describe('forced states', () => {
  it('drop a pointer condition and keep any other', () => {
    expect(pointerFree('(hover: hover) and (pointer: fine)')).toBe('');
    expect(pointerFree('(hover:hover)')).toBe('');
    expect(pointerFree('(max-width: 600px) and (hover: hover)')).toBe('(max-width: 600px)');
    expect(pointerFree('(prefers-reduced-motion: reduce)')).toBe('(prefers-reduced-motion: reduce)');
  });
  it('copy hover rules out of a pointer media query, and focus and active rules where they are', () => {
    const st = document.createElement('style');
    st.textContent = '@media (hover: hover) and (pointer: fine) { .b:hover { color: red } } .b:focus-visible { outline: 1px solid } .b:active { color: blue } .c { color: green }';
    document.head.append(st);
    installForcing();
    const css = forced();
    expect(css).toContain('.b[data-lab-hover]');
    expect(css).not.toContain('@media (hover');
    expect(css).toContain('.b[data-lab-focus]');
    expect(css).toContain('.b[data-lab-active]');
    expect(css).not.toContain('.c');
  });
  it('set the attribute on what a selector matches, or on every interactive element', () => {
    document.body.innerHTML = '<div id="r"><button class="b">a</button><span>t</span><button>b</button></div>';
    const r = document.getElementById('r') as HTMLElement;
    expect(force(r, '.b', 'hover')).toBe(1);
    expect(force(r, null, 'focus')).toBe(2);
    expect(r.querySelectorAll('[data-lab-focus]').length).toBe(2);
  });
});
