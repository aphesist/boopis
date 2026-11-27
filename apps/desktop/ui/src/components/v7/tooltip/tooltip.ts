/* Tooltip: its view (typed props to markup) and its contract. Its look is tooltip.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { kbd } from '../kbd/kbd';
import { esc, kitAttrs } from '../util';
import type { U } from '../util';
import { defineContract } from '../contract';

/* ── Tooltip (29): the name, then the keys. A [data-tip] control shows it on hover and focus (tooltip.ts places it); this
   is the surface as the lab and documentation draw it in place ── */
export interface TooltipOpts { label: string; keys?: U<string> }
export function tooltip(o: TooltipOpts): string {
  return '<span class="k7-tip" role="tooltip"' + kitAttrs('Tooltip') + '><span>' + esc(o.label) + '</span>' + (o.keys ? kbd({ keys: o.keys }) : '') + '</span>';
}

/** what Tooltip promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<TooltipOpts>({
  name: 'Tooltip',
  folder: 'tooltip',
  layer: 'control',
  summary: 'The name, then the keys. A control with data-tip shows it on hover and focus; this draws the surface in place, for the lab and the docs.',
  exports: ['tooltip'],
  props: {
    label: 'the name',
    keys: 'the keys after it'
  },
  events: [],
  states: [],
  parts: [],
  tokens: [
    '--bg-3', '--dur-pop', '--ease-sharp', '--float-line', '--fs-xs', '--gap-s', '--hl', '--hover', '--kbd-h', '--lh-xs',
    '--pad-kbd', '--pad-tip-x', '--pad-tip-y', '--r-tip', '--r-xs', '--sans', '--shadow-pop', '--text', '--text-dim', '--track'
  ],
  a11y: 'role="tooltip". In the app the runtime ties it to the control it names; the control\'s own name already holds the words.',
  boards: []
});
