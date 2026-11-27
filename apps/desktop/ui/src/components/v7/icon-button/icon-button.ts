/* IconButton: its view (typed props to markup) and its contract. Its look is icon-button.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { attrs, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── IconButton (22): floating 36, tinted 28, ghost (window controls) ── */
export const ICON_BUTTON_VARIANTS = ['floating', 'tinted', 'ghost', 'inverted'] as const;
export type IconButtonVariant = typeof ICON_BUTTON_VARIANTS[number];
export interface IconButtonOpts { icon: string; label: string; /** the chrome's 18 px glyph (kit.css `.i.l`) */ large?: U<boolean>; variant?: U<IconButtonVariant>; pressed?: U<boolean>; expanded?: U<boolean>; haspopup?: U<string>; disabled?: U<boolean>; keys?: U<string>; tip?: U<string | false>; attrs?: U<Attrs> }
export function iconButton(o: IconButtonOpts): string {
  return '<button class="k7-reset k7-ib"' + kitAttrs('IconButton') + attrs({
    type: 'button', 'data-variant': o.variant ?? 'floating', 'aria-label': o.label, 'aria-pressed': o.pressed == null ? null : String(o.pressed),
    'aria-expanded': o.expanded == null ? null : String(o.expanded), 'aria-haspopup': o.haspopup, disabled: !!o.disabled,
    'data-tip': o.tip === false ? null : o.tip ?? o.label, 'data-kbd': o.keys, 'aria-keyshortcuts': o.keys, ...(o.attrs ?? {})
  }) + '>' + glyph(o.icon, o.large ? 'k7-ic--l' : undefined) + '</button>';
}

/** what IconButton promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<IconButtonOpts>({
  name: 'IconButton',
  folder: 'icon-button',
  layer: 'control',
  summary: 'A glyph in a circle: floating 36 (the chrome), tinted 28 (inside a surface), ghost (window controls) and inverted (the composer\'s primary).',
  exports: ['iconButton'],
  props: {
    icon: 'the glyph it shows',
    label: 'its accessible name, and its tooltip unless `tip` says otherwise',
    large: 'the chrome\'s 18 px glyph',
    variant: 'floating (the default), tinted, ghost or inverted',
    pressed: 'a toggle: on or off (aria-pressed)',
    expanded: 'it opens something that is open now (aria-expanded)',
    haspopup: 'what it opens: menu, dialog (aria-haspopup)',
    disabled: 'it cannot be pressed now',
    keys: 'the keys that do the same, shown in its tooltip (and aria-keyshortcuts)',
    tip: 'its tooltip\'s words; false for none',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-variant', 'aria-pressed', 'aria-expanded', 'disabled'],
  parts: [],
  tokens: [
    '--accent-text', '--bg-3', '--bg-4', '--ctl', '--ctl-s', '--dur-1', '--dur-out', '--dur-press', '--ease-out', '--ease-sharp',
    '--fill-2', '--hl', '--hover', '--icon', '--icon-off', '--icon-quiet', '--line', '--r-pill', '--selected', '--selected-hover',
    '--shadow-inline', '--text-on-light'
  ],
  a11y: 'A native <button> named by `label`, never by its glyph alone; its tooltip says the name and the keys on hover and focus.',
  boards: []
});
