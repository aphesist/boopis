/* SectionHead: its view (typed props to markup) and its contract. Its look is section-head.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── SectionHead (18): with count, with disclosure; collapsed ── */
export interface SectionHeadOpts { title: string; count?: U<string>; disclosure?: U<boolean>; collapsed?: U<boolean>; value?: U<string>; attrs?: U<Attrs> }
export function sectionHead(o: SectionHeadOpts): string {
  /* a folding head (the inbox's Settled): the chevron at its end, pointing right while it is folded, down when open */
  const inner = '<span class="k7-shead__title">' + esc(o.title) + '</span>' + (o.count ? '<span class="k7-shead__count k7-mono">' + esc(o.count) + '</span>' : '') +
    (o.value ? '<span class="k7-shead__value">' + esc(o.value) + '</span>' : '') + (o.disclosure ? '<span class="k7-grow"></span>' + glyph('chevron', 'k7-shead__chev') : '');
  return o.disclosure
    ? '<h3 class="k7-shead"' + kitAttrs('SectionHead', { 'data-collapsed': o.collapsed ? '' : null, ...(o.attrs ?? {}) }) + '><button class="k7-reset k7-shead__btn" type="button" aria-expanded="' + String(!o.collapsed) + '">' + inner + '</button></h3>'
    : '<h3 class="k7-shead"' + kitAttrs('SectionHead', o.attrs ?? null) + '>' + inner + '</h3>';
}

/** what SectionHead promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SectionHeadOpts>({
  name: 'SectionHead',
  folder: 'section-head',
  layer: 'row',
  summary: 'A section\'s heading: its title, with a count, a value, or a fold.',
  exports: ['sectionHead'],
  props: {
    title: 'its words',
    count: 'a count after it, in mono',
    disclosure: 'it folds what follows: a chevron at its end',
    collapsed: 'folded',
    value: 'a value at its end',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-collapsed', 'aria-expanded'],
  parts: ['k7-shead__title', 'k7-shead__count'],
  tokens: [
    '--dur-1', '--ease-sharp', '--fs-2xs', '--fs-xs', '--gap-row', '--gap-s', '--lh-m', '--r-xs', '--sp-1', '--sp-3', '--text-dim',
    '--text-quiet'
  ],
  a11y: 'An <h3>; a folding head holds a <button> with aria-expanded.',
  boards: [
    '11-botchat', 'K02-12-sidebar', '17-working', 'S17-newsession', 'S20-running', 'S23-finished', 'S33-changed', 'S36-engine',
    'S37-nomodel', 'S38-gate', 'S40-details', 'S41-noproject', '14-settings', 'S39-settings-sessions'
  ]
});
