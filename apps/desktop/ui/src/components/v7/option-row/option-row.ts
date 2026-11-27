/* OptionRow: its view (typed props to markup) and its contract. Its look is option-row.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { kbd } from '../kbd/kbd';
import { esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── OptionRow (20): a two-line radio row (a permission step, an import pick, who answers next): the name, and what it means on a second
   line that is never cut (board S19) ── */
export interface OptionRowOpts {
  label: string; meaning: string; chosen?: U<boolean>; value?: U<string>; ticks?: U<{ of: number; on: number }>;
  /** what leads the name on its line (a model's mark, a glyph), and the keys that choose it, at the line's end */
  leadHTML?: U<string>; icon?: U<string>; keys?: U<string>;
  /** a choice that cannot be made now: it stays in its place, and its second line says why (`meaning` carries the reason) */
  disabled?: U<boolean>; attrs?: U<Attrs>;
  /** one of several that can all be chosen: a check box in place of the ring (6d, derived: a form's "choose any") */ check?: U<boolean>;
}
export function optionRow(o: OptionRowOpts): string {
  return '<button class="k7-reset k7-orow"' + kitAttrs('OptionRow', { type: 'button', role: 'menuitemradio', tabindex: '-1', 'aria-checked': String(!!o.chosen), 'aria-disabled': o.disabled ? 'true' : null, 'data-value': o.value ?? o.label, ...(o.attrs ?? {}) }) + '>' +
    (o.check ? '<span class="k7-orow__ring" data-check aria-hidden="true">' + glyph('check') + '</span>' : '<span class="k7-orow__ring" aria-hidden="true"></span>') + '<span class="k7-orow__text"><span class="k7-orow__name">' + (o.leadHTML ?? (o.icon ? glyph(o.icon) : '')) + '<span class="k7-orow__label">' + esc(o.label) + '</span>' +
    (o.ticks ? '<span class="k7-ticks" aria-hidden="true">' + Array.from({ length: o.ticks.of }, (_, i) => '<i' + (i < (o.ticks?.on ?? 0) ? ' data-on' : '') + '></i>').join('') + '</span>' : '') +
    (o.keys ? '<span class="k7-grow"></span>' + kbd({ keys: o.keys }) : '') + '</span><span class="k7-orow__meaning" data-wrap-ok>' + esc(o.meaning) + '</span></span></button>';
}

/** what OptionRow promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<OptionRowOpts>({
  name: 'OptionRow',
  folder: 'option-row',
  layer: 'row',
  summary: 'A two-line choice: the name, and what it means on a second line that is never cut (a permission step, an import pick, who answers next).',
  exports: ['optionRow'],
  props: {
    label: 'its name',
    meaning: 'what choosing it means, or why it cannot be chosen',
    chosen: 'it is the choice',
    value: 'what it is called to the app (data-value; the label unless said)',
    ticks: 'steps after the name (how careful)',
    leadHTML: 'trusted kit markup that leads it in place of a glyph (an orb, a model\'s mark)',
    icon: 'a glyph of the kit\'s icon set, before the name',
    keys: 'the keys that choose it, at the line\'s end',
    disabled: 'it cannot be chosen now: it stays in place and its second line says why',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    check: 'one of several that can all be chosen: a check box in place of the ring'
  },
  events: [],
  states: ['aria-checked', 'aria-disabled'],
  parts: ['k7-orow__ring', 'k7-orow__name', 'k7-orow__meaning'],
  tokens: [
    '--accent', '--current', '--dur-1', '--dur-out', '--ease-out', '--focus-w', '--fs-m', '--fs-s', '--fs-xs', '--gap-hair',
    '--gap-row', '--hover', '--icon-s', '--lh-m', '--lh-s', '--mark-off', '--on-accent', '--pad-menu', '--r-menu', '--r-pill',
    '--r-tip', '--sp-2', '--sp-3', '--text', '--text-dim', '--text-faint'
  ],
  a11y: 'role="menuitemradio" with aria-checked; its name holds both lines.',
  boards: []
});
