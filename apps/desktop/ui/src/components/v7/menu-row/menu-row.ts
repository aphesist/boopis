/* MenuRow: its view (typed props to markup) and its contract. Its look is menu-row.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { kbd } from '../kbd/kbd';
import { esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── MenuRow (19): glyph + name, name + description, with kbd, danger; a check in a quick menu ── */
export interface MenuRowOpts {
  label: string; desc?: U<string>; icon?: U<string>; leadHTML?: U<string>; keys?: U<string>; danger?: U<boolean>;
  /** a quick menu's row: a check when on */ checked?: U<boolean>; disabled?: U<boolean>; value?: U<string>; role?: U<string>; attrs?: U<Attrs>;
}
export function menuRow(o: MenuRowOpts): string {
  const role = o.role ?? (o.checked == null ? 'menuitem' : 'menuitemcheckbox');
  return '<button class="k7-reset k7-mrow"' + kitAttrs('MenuRow', {
    type: 'button', role, tabindex: '-1', 'aria-checked': o.checked == null ? null : String(o.checked), 'aria-disabled': o.disabled ? 'true' : null,
    'data-danger': o.danger ? '' : null, 'data-value': o.value ?? o.label, ...(o.attrs ?? {})
  }) + '>' +
    /* a choice with its own lead (a colour, 7a's Accent): the lead first, its check at the row's end; else the check leads */
    (o.checked != null && o.leadHTML ? o.leadHTML : o.checked != null ? '<span class="k7-mrow__check" aria-hidden="true">' + (o.checked ? glyph('check') : '') + '</span>' : (o.leadHTML ?? glyph(o.icon))) +
    '<span class="k7-mrow__name">' + esc(o.label) + '</span>' + (o.desc ? '<span class="k7-mrow__desc">' + esc(o.desc) + '</span>' : '<span class="k7-grow"></span>') +
    (o.keys ? kbd({ keys: o.keys }) : '') + (o.checked != null && o.leadHTML ? '<span class="k7-mrow__check" aria-hidden="true">' + (o.checked ? glyph('check') : '') + '</span>' : '') + '</button>';
}

/** what MenuRow promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<MenuRowOpts>({
  name: 'MenuRow',
  folder: 'menu-row',
  layer: 'row',
  summary: 'A row of a Menu: a glyph and a name, a name and a description, the keys, danger, or a check in a quick menu. One line; the name never wraps, the description is cut.',
  exports: ['menuRow'],
  props: {
    label: 'its name',
    desc: 'a description after the name, cut where the row ends',
    icon: 'a glyph of the kit\'s icon set, before the name',
    leadHTML: 'trusted kit markup that leads it in place of a glyph (an orb, a model\'s mark)',
    keys: 'the keys that choose it, at its end',
    danger: 'a destructive choice, in red',
    checked: 'a quick menu\'s row: on or off, a check when on',
    disabled: 'it cannot be chosen now',
    value: 'what it is called to the app (data-value; the label unless said)',
    role: 'its role, when not menuitem or menuitemcheckbox',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['aria-checked', 'aria-disabled', 'data-danger'],
  parts: ['k7-mrow__check', 'k7-mrow__name', 'k7-mrow__desc'],
  tokens: [
    '--accent-text', '--dur-1', '--dur-out', '--ease-out', '--focus-w', '--fs-m', '--fs-s', '--gap-hair', '--hover', '--icon',
    '--icon-s', '--lh-m', '--lh-s', '--pad-menu', '--pad-row-x', '--pad-row-y', '--r-floor', '--r-menu', '--r-nav', '--red-text',
    '--row-h', '--sp-1', '--sp-2', '--text', '--text-dim', '--text-faint'
  ],
  a11y: 'role="menuitem" (or menuitemcheckbox), tabindex -1: the Menu moves the focus between rows.',
  boards: []
});
