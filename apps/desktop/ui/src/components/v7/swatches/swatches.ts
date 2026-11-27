/* Swatches: its view (typed props to markup) and its contract. Its look is swatches.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { esc, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Swatches (6d, derived from P1's accent candidates): colours as a row of circles, each named; `choose` makes it one choice (a radio
   group, the chosen circle ringed in the focus colour), else it only shows them ── */
export interface SwatchItem {
  label: string; hex: string; value?: U<string>;
  /** what the circle shows in place of the colour (a bot's shape: its still orb at 28 in the bot's colour, the look editor 2a), as trusted kit markup */
  face?: U<string>;
}
export interface SwatchesOpts { label: string; items: readonly SwatchItem[]; choose?: U<boolean>; value?: U<string>; attrs?: U<Attrs> }
export function swatches(o: SwatchesOpts): string {
  const pick = !!o.choose;
  return '<div class="k7-swatches"' + kitAttrs('Swatches', { role: pick ? 'radiogroup' : 'list', 'aria-label': o.label, ...(o.attrs ?? {}) }) + '>' + o.items.map((it, i) => {
    const v = it.value ?? it.hex, on = pick && o.value === v;
    const dot = it.face != null ? '<i class="k7-swatches__face" aria-hidden="true">' + it.face + '</i>' : '<i class="k7-swatches__dot" aria-hidden="true" style="background:' + esc(it.hex) + '"></i>';
    return pick
      ? '<button class="k7-reset k7-swatches__item"' + partAttrs('Swatch', { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on || (o.value == null && i === 0) ? '0' : '-1', 'data-value': v, 'aria-label': it.label, 'data-tip': it.label }) + '>' + dot + '</button>'
      : '<span class="k7-swatches__item"' + partAttrs('Swatch', { role: 'listitem', 'aria-label': it.label + ' ' + it.hex, 'data-tip': it.label }) + '>' + dot + '</span>';
  }).join('') + '</div>';
}

/** what Swatches promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SwatchesOpts>({
  name: 'Swatches',
  folder: 'swatches',
  layer: 'control',
  summary: 'Colours as a row of named circles. With `choose` it is one choice (the chosen circle ringed in the focus colour); without, it only shows them.',
  exports: ['swatches'],
  props: {
    label: 'the group\'s accessible name',
    items: 'the colours: a label, a hex, the value it stands for, and a face shown in place of the colour (a bot\'s shape)',
    choose: 'a choice: a radio group',
    value: 'the chosen colour\'s value',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:change'],
  states: ['aria-checked', 'tabindex'],
  parts: ['Swatch', 'k7-swatches__face'],
  tokens: [
    '--ctl-s', '--focus', '--focus-off', '--focus-w', '--gap-hair', '--hair', '--hl', '--icon-off', '--r-pill', '--selected-off',
    '--sp-2'
  ],
  a11y: 'A radiogroup of named radios when it chooses (one tab stop; the arrows, Home and End move and choose, a press chooses; ui:change {value}, cancelable), else a list whose items say their name and hex.',
  boards: []
});
