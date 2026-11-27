/* Menu: its view (typed props to markup) and its contract. Its look is menu.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { scrollClass } from '../../scroll';
import { menuRow } from '../menu-row/menu-row';
import type { MenuRowOpts } from '../menu-row/menu-row';
import { optionRow } from '../option-row/option-row';
import type { OptionRowOpts } from '../option-row/option-row';
import { attrs, cls, esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Menu (5): menu, quick menu (checks), palette (/ @ $), snooze, split-button menu, option menu (four rows), and a list whose rows
   say what they are beside their name (boards S31 and S32: 360 wide, the name whole and the description cut where the row ends) ── */
export const MENU_VARIANTS = ['menu', 'quick', 'palette', 'snooze', 'split', 'options', 'list'] as const;
export type MenuVariant = typeof MENU_VARIANTS[number];
export type MenuEntry = MenuRowOpts | OptionRowOpts | '-' | { heading: string };
export interface MenuOpts { label: string; entries: readonly MenuEntry[]; variant?: U<MenuVariant>; query?: U<string>; attrs?: U<Attrs>;
  /** what follows the rows, as kit markup (6e, derived: a council's combiner and "Ask the council" under S19's rows) */ foot?: U<string> }
const entryHTML = (e: MenuEntry): string => e === '-' ? '<div class="k7-menu__sep" role="separator"></div>'
  : 'heading' in e ? '<div class="k7-menu__head" role="presentation">' + esc(e.heading) + '</div>'
  : 'meaning' in e ? optionRow(e) : menuRow(e);
export function menu(o: MenuOpts): string {
  const v = o.variant ?? 'menu';
  const head = v === 'palette' ? '<div class="k7-menu__query"><span class="k7-mono k7-menu__sigil">' + esc(o.query ?? '/') + '</span></div>' : '';
  /* with a foot (its own controls, not menu items) the rows alone are the menu, and the whole a group of the menu and its foot (6f) */
  const role = o.foot ? { role: 'group', 'aria-label': o.label } : { role: 'menu', 'aria-label': o.label };
  return '<div class="k7-menu"' + kitAttrs('Menu', { ...role, 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' + head +
    '<div class="' + cls('k7-menu__list', scrollClass({ inset: 'both' })) + '"' + attrs(o.foot ? { role: 'menu', 'aria-label': o.label } : {}) + '>' + o.entries.map(entryHTML).join('') + '</div>' + (o.foot ? '<div class="k7-menu__foot">' + o.foot + '</div>' : '') + '</div>';
}

/** what Menu promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<MenuOpts>({
  name: 'Menu',
  folder: 'menu',
  layer: 'block',
  summary: 'A floating list of MenuRows and OptionRows: a menu, a quick menu (checks), a palette, snooze, a split button\'s menu, options, or a list whose rows say what they are beside their name.',
  exports: ['menu'],
  props: {
    label: 'its accessible name',
    entries: 'its rows, \'-\' for a separator, { heading } for a heading',
    variant: 'menu (the default), quick, palette, snooze, split, options or list',
    query: 'palette: the sigil it was opened with (/ @ $)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    foot: 'what follows the rows, as kit markup (its own controls, not menu items)'
  },
  events: ['ui:select'],
  states: ['data-variant', 'data-floating (opened against an anchor)'],
  parts: ['k7-menu__list', 'k7-menu__head', 'k7-menu__sep', 'k7-menu__foot'],
  tokens: [
    '--bg-3', '--ctl', '--dur-pop', '--ease-sharp', '--float-line', '--focus-w', '--fs-s', '--fs-xs', '--gap-hair', '--hair',
    '--hl', '--lh-s', '--lh-xs', '--line-strong', '--menu-list-w', '--menu-w', '--options-w', '--pad-field', '--pad-field-y',
    '--pad-menu', '--pad-palette', '--pad-row-x', '--pad-row-y', '--palette-w', '--pop-w', '--r-card', '--r-floor', '--r-menu',
    '--shadow-pop', '--sp-1', '--sp-2', '--sp-3', '--text', '--text-dim', '--text-quiet'
  ],
  a11y: 'role="menu" (a group of the menu and its foot when it has one). The arrows, Home and End move between rows, a letter jumps to the next row it starts; Esc or a press outside closes it and the focus returns to its anchor (kit.openMenu).',
  boards: []
});
