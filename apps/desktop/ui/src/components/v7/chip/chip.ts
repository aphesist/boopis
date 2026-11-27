/* Chip: its view (typed props to markup) and its contract. Its look is chip.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { attrs, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Chip (28): answer (in an AskCard), filter, mode ── */
export const CHIP_VARIANTS = ['answer', 'filter', 'mode'] as const;
export type ChipVariant = typeof CHIP_VARIANTS[number];
export interface ChipOpts { label: string; variant?: U<ChipVariant>; chosen?: U<boolean>; icon?: U<string>; leadHTML?: U<string>; hold?: U<boolean>; value?: U<string>; attrs?: U<Attrs> }
export function chip(o: ChipOpts): string {
  const v = o.variant ?? 'filter';
  return '<button class="k7-reset k7-chip"' + kitAttrs('Chip') + attrs({ type: 'button', 'data-variant': v, 'aria-pressed': v === 'answer' ? null : String(!!o.chosen), 'data-chosen': o.chosen ? '' : null, 'data-value': o.value, 'data-hold': o.hold ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    (o.hold ? '<span class="k7-btn__sweep" aria-hidden="true"></span>' : '') + (o.leadHTML ?? glyph(o.icon)) + '<span class="k7-chip__label">' + esc(o.label) + '</span></button>';
}

/** what Chip promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<ChipOpts>({
  name: 'Chip',
  folder: 'chip',
  layer: 'control',
  summary: 'A 28 pill: an answer in an AskCard, a filter, or a mode. A filter or mode chip toggles; an answer chip only reports, and its card decides.',
  exports: ['chip'],
  props: {
    label: 'its words',
    variant: 'answer, filter (the default) or mode',
    chosen: 'on (a filter or mode), the chosen answer',
    icon: 'a glyph of the kit\'s icon set, before the words',
    leadHTML: 'trusted kit markup that leads it in place of a glyph (an orb, a model\'s mark)',
    hold: 'an answer that needs a 1 s hold (Hold to allow once)',
    value: 'what it is called to the app (data-value)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:change', 'ui:commit'],
  states: ['data-variant', 'aria-pressed', 'data-chosen', 'data-hold'],
  parts: ['k7-chip__label'],
  tokens: [
    '--ctl-s', '--current', '--dur-1', '--dur-out', '--dur-press', '--ease-out', '--ease-sharp', '--fill-2', '--fs-s', '--fs-xs',
    '--gap-s', '--hl', '--hover', '--lh-s', '--lh-xs', '--line', '--pad-chip', '--pad-chip-mode', '--r-pill', '--selected',
    '--selected-hover', '--text', '--text-dim', '--text-on-light', '--track-s'
  ],
  a11y: 'A native <button>; a filter or mode chip is a toggle (aria-pressed), an answer chip a plain button.',
  boards: [
    '11-botchat', '12-room', '17-working', 'S20-running', 'S23-finished', 'K03-asks', 'K04-card', 'K05-many', '14-settings'
  ]
});
