// @vitest-environment jsdom
/* HoverBar: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from thread.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './hover-bar';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const ACTS = [{ value: 'copy', icon: 'copy', label: 'Copy kai’s message', tip: 'Copy', keys: 'C' }, { value: 'more', icon: 'more', label: 'More for kai’s message', tip: 'More', menu: true }];
const EX: Parameters<typeof kit.html.hoverBar>[0] = { label: 'Actions on kai\'s message', actions: [{ value: 'copy', icon: 'copy', label: 'Copy' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: HoverBar', () => {
  it('draws the component its contract names (data-kit="HoverBar")', () => {
    const el = put(kit.hoverBar(EX));
    expect(el.matches('[data-kit~="HoverBar"]') || !!el.querySelector('[data-kit~="HoverBar"]')).toBe(true);
    expect(contract.name).toBe('HoverBar');
  });
  it('its group is named for the message', () => {
    expect(put(kit.hoverBar(EX)).getAttribute('aria-label')).toBe('Actions on kai\'s message');
  });
  it('is a named group of ghost IconButtons, each named, with its tip and its key; "more" says it opens a menu', () => {
    const bar = put(kit.hoverBar({ label: 'Actions on kai’s message', actions: ACTS }));
    expect([bar.getAttribute('role'), bar.getAttribute('aria-label')]).toEqual(['group', 'Actions on kai’s message']);
    const [copy, more] = [...bar.querySelectorAll<HTMLButtonElement>('button')] as [HTMLButtonElement, HTMLButtonElement];
    expect([copy.getAttribute('aria-label'), copy.getAttribute('data-tip'), copy.getAttribute('data-kbd'), copy.getAttribute('data-variant')]).toEqual(['Copy kai’s message', 'Copy', 'C', 'ghost']);
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
  });
});

describe('scene: HoverBar', () => {
  it('a press says which action, and on what (a menu opens against the button)', () => {
    const bar = put(kit.hoverBar({ label: 'Actions', actions: ACTS }));
    const got: Array<[string, Element]> = [];
    bar.addEventListener('ui:act', (e) => { const d = (e as CustomEvent<{ value: string; el: Element }>).detail; got.push([d.value, d.el]); });
    bar.querySelector<HTMLElement>('[data-act="more"]')?.click();
    expect(got).toEqual([['more', bar.querySelector('[data-act="more"]')]]);
  });
  it('stands beside a bubble, and moves to a later one, leaving the first as it was', () => {
    const thread = document.createElement('div');
    const a = kit.bubble({ kind: 'agent', text: 'one' }), b = kit.bubble({ kind: 'agent', text: 'two' });
    thread.append(a, b); document.body.append(thread);
    const bar = kit.hoverBar({ label: 'Actions', actions: ACTS });
    kit.hoverBeside(bar, a);
    expect([...thread.children].map((x) => x.className.split(' ')[0])).toEqual(['k7-hoverrow', 'k7-bubble']);
    expect([...(thread.firstElementChild as Element).children]).toEqual([a, bar]);
    kit.hoverBeside(bar, b);
    expect([...thread.children]).toEqual([a, bar.parentElement]);
    expect([...(bar.parentElement as Element).children]).toEqual([b, bar]);
    kit.hoverBeside(bar, b);   /* already there: nothing moves */
    expect(thread.querySelectorAll('.k7-hoverrow')).toHaveLength(1);
  });
});
