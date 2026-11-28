/* Tooltip: its view (typed props to markup) and its contract. Its look is tooltip.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { kbd } from '../kbd/kbd';
import { attrs, esc, kitAttrs } from '../util';
import type { U } from '../util';
import { defineContract } from '../contract';

/* ── Tooltip (29): the name, then a state, then the keys. A [data-tip] control shows it on hover and focus (components/tooltip.ts
   draws this view and places it, 2b: the one tooltip); in place it is the surface as the lab and documentation draw it ── */
export interface TooltipOpts {
  label: string; keys?: U<string>;
  /** what the control is now, in mono after the name (2b: the v6 tip's state, e.g. a bot's "needs you"); `attention` in red */ state?: U<{ text: string; tone?: U<string | null> }>;
  /** floating: the one tooltip of the app (hidden from assistive tech: the control's own name holds the words) */ floating?: U<boolean>;
}
export const tooltipInner = (o: TooltipOpts): string => '<span>' + esc(o.label) + '</span>' + (o.state ? '<span class="k7-tip__state k7-mono"' + attrs({ 'data-tone': o.state.tone }) + '>' + esc(o.state.text) + '</span>' : '') + (o.keys ? kbd({ keys: o.keys }) : '');
export function tooltip(o: TooltipOpts): string {
  return '<span class="k7-tip"' + kitAttrs('Tooltip', o.floating ? { 'aria-hidden': 'true', 'data-floating': '' } : { role: 'tooltip' }) + '>' + tooltipInner(o) + '</span>';
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
    keys: 'the keys after it',
    state: 'what the control is now, after the name (attention in red)',
    floating: 'the app\'s one tooltip, placed by the runtime and hidden from assistive tech'
  },
  events: [],
  states: ['data-floating', 'data-tone'],
  parts: ['k7-tip__state'],
  tokens: [
    '--bg-3', '--dur-pop', '--ease-sharp', '--float-line', '--fs-2xs', '--fs-xs', '--gap-s', '--hl', '--lh-xs', '--pad-tip-x',
    '--pad-tip-y', '--r-tip', '--red-text', '--shadow-pop', '--text', '--text-dim', '--track'
  ],
  a11y: 'role="tooltip". In the app the runtime ties it to the control it names; the control\'s own name already holds the words.',
  boards: []
});
