/* Badge: its view (typed props to markup) and its contract. Its look is badge.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Badge (33): a count or a short status at the end of a row; neutral, amber ── */
export interface BadgeOpts { text: string; tone?: U<'neutral' | 'owe'>; label?: U<string>; attrs?: U<Attrs> }
export function badge(o: BadgeOpts): string {
  return '<span class="k7-cap k7-badge"' + kitAttrs('Badge', { 'data-tone': o.tone ?? 'neutral', 'aria-label': o.label, ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span>';
}

/** what Badge promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<BadgeOpts>({
  name: 'Badge',
  folder: 'badge',
  layer: 'inline',
  summary: 'A count or a short status at the end of a row: an 18 pill, neutral or amber.',
  exports: ['badge'],
  props: {
    text: 'its words or count',
    tone: 'neutral (the default) or owe',
    label: 'its accessible name, where the count alone would not say enough',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-tone'],
  parts: [],
  tokens: ['--badge-h', '--fill-2', '--fs-2xs', '--owe-soft', '--owe-text', '--pad-inline', '--r-pill', '--text-dim'],
  a11y: 'Plain words; `label` names a bare count ("3 waiting").',
  boards: [
    'S17-newsession', 'S20-running', 'S23-finished', 'S33-changed', 'S36-engine', 'S37-nomodel', 'S38-gate', 'S40-details',
    'S39-settings-sessions'
  ]
});
