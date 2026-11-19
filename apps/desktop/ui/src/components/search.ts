/* The search field: a search glyph, the query (or, on the button, where you are), and the keys that open or close it. One component
   for the title bar's command centre (DESIGN-SYSTEM.md §14.1, a button that opens the palette) and the palette's own field (§14.20).
     size 's'  the boxed 26px field on the title bar: the inset frame colour, a hairline, --r-s; hover a stronger line, open a brass one.
     size 'm'  a search in a form: a field's box (--ctl, --bg-0, --line-field, --r-s) with the glyph at its start (the shortcut sheet).
     size 'l'  the 48px field flush at the top of a surface (the palette): no box of its own, a hairline below.
   DESIGN-SYSTEM.md §14.31, R-search-1 to 4.
   Key chips: the keys sit in the field's corner, so they are concentric with it (--r-in, §8.2): 4px inside a 12px corner is 8px, a
   capsule on an 18px chip, as a key in a tooltip (§14.23). In the flush field they take the surface's own --r-in. */
import { attrs, cx } from '../core/dom';
import type { Attrs } from '../core/dom';
import { ariaKeys } from '../core/keys';
import { icon } from './icons';
import { keys } from './kbd';

type U<T> = T | undefined;

export const SEARCH_SIZES = ['s', 'm', 'l'] as const;
export type SearchSize = (typeof SEARCH_SIZES)[number];
export interface SearchOpts {
  size?: U<SearchSize>;
  /** 'input' is a text field (the palette); 'button' opens the search and shows where you are (the title bar) */
  as?: U<'input' | 'button'>;
  id?: U<string>;
  /** the accessible name; the button's visible text must be part of it (WCAG 2.5.3) */
  label: string;
  placeholder?: U<string>; value?: U<string>;
  /** the button's visible text, as markup (the project and the title, each in its own span) */
  textHTML?: U<string>;
  /** the keys shown at the end ('mod+K', 'esc'); always aria-hidden, the control carries aria-keyshortcuts */
  keys?: U<string>;
  class?: U<string>;
  /** extra attributes on the input or the button (a combobox's aria-controls, a trigger's aria-haspopup) */
  attrs?: U<Attrs>;
}
/** the variants the UI lab draws */
export const searchVariants = { size: SEARCH_SIZES, as: ['input', 'button'] } as const;

const chips = (k: U<string>): string => keys(k, { fit: true, class: 'ui-search__keys' });

export function search(o: SearchOpts): string {
  const size = o.size ?? (o.as === 'button' ? 's' : 'l');
  const cls = cx('ui-search', 'ui-search--' + size, o.class);
  const glyph = icon('search', { class: 'ui-search__icon' });
  if (o.as === 'button') {
    return '<button type="button" class="' + cls + '"' + attrs({ id: o.id, 'aria-label': o.label, 'aria-keyshortcuts': o.keys && ariaKeys(o.keys), ...o.attrs }) + '>' +
      /* a space between the text and the keys, so the visible text reads as the name does ("… title ctrl K", WCAG 2.5.3) */
      glyph + '<span class="ui-search__text">' + (o.textHTML ?? '') + '</span>' + (o.keys ? ' ' + chips(o.keys) : '') + '</button>';
  }
  return '<div class="' + cls + '">' + glyph +
    '<input type="text" class="ui-search__input"' + attrs({ id: o.id, 'aria-label': o.label, placeholder: o.placeholder, value: o.value, autocomplete: 'off', spellcheck: 'false', ...o.attrs }) + '>' +
    chips(o.keys) + '</div>';
}
