/* The scroll area: every scroller in the app is one, so every scrollbar is the design system's (components.css, "scroll area").
   A module puts `scrollClass(o)` (or the template) on its scroller and declares no overflow or scrollbar of its own; the guard
   (`kit.guard.test.ts`) fails on a module stylesheet that does. */
import { attrs, cx, esc } from '../core/dom';
import type { Attrs } from '../core/dom';

type U<T> = T | undefined;

/** which way it scrolls: y (a list, a dialog's body: rows ellipsise, so never sideways), x (a strip), both (a code block) */
export const SCROLL_AXES = ['y', 'x', 'both'] as const;
export type ScrollAxis = (typeof SCROLL_AXES)[number];
export interface ScrollOpts {
  axis?: U<ScrollAxis>;
  /** no bar at all: a strip that shows there is more with a faded edge instead (the mod pane tabs) */
  bare?: U<boolean>;
}
export interface ScrollHtmlOpts extends ScrollOpts {
  body?: U<string>; class?: U<string>; tag?: U<string>;
  /** a scroller that holds only text needs a tab stop and a name so the keyboard can scroll it */
  label?: U<string>; attrs?: U<Attrs>;
}
/** the variants the UI lab draws */
export const scrollVariants = { axis: SCROLL_AXES, bare: [false, true] } as const;

export const scrollClass = (o: ScrollOpts = {}): string => cx('ui-scroll', o.axis && o.axis !== 'y' && 'ui-scroll--' + o.axis, o.bare && 'ui-scroll--bare');

export function scroll(o: ScrollHtmlOpts = {}): string {
  const tag = o.tag ?? 'div';
  return '<' + tag + ' class="' + cx(scrollClass(o), o.class) + '"' +
    attrs({ tabindex: o.label ? '0' : null, role: o.label ? 'region' : null, 'aria-label': o.label, ...o.attrs }) + '>' + (o.body ?? '') + '</' + esc(tag) + '>';
}
