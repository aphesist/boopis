/* Notch: its view (typed props to markup) and its contract. Its look is notch.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { slabPath } from '../../squircle-path';
import { composer } from '../composer/composer';
import { kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Notch (42): the notch's own surface. The notch spec is not in this repository (an owner question); what the kit can draw from
   section 8.2: the slab's black shape (--r-slab 30, flush to the top), its composer on a 12 inset, radius 18 = 30 - 12 ── */
export interface NotchOpts { width?: U<number>; placeholder?: U<string>; attrs?: U<Attrs> }
export function notch(o: NotchOpts = {}): string {
  const w = o.width ?? 420, h = 60, F = 30;
  const path = slabPath(w, h, 30, F);
  return '<div class="k7-notch"' + kitAttrs('Notch', { style: '--w:' + w + 'px', ...(o.attrs ?? {}) }) + '>' +
    '<svg class="k7-notch__slab" viewBox="0 0 ' + (w + 2 * F) + ' ' + h + '" width="' + (w + 2 * F) + '" height="' + h + '" aria-hidden="true"><path d="' + path + '" transform="matrix(1 0 0 -1 0 ' + h + ')"/></svg>' +
    '<div class="k7-notch__in" data-theme="dark">' + composer({ kind: 'notch', ...(o.placeholder ? { placeholder: o.placeholder } : {}) }) + '</div></div>';
}

/** what Notch promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<NotchOpts>({
  name: 'Notch',
  folder: 'notch',
  layer: 'surface',
  summary: 'The notch\'s own surface: the slab\'s black shape flush to the top, its composer on a 12 inset.',
  exports: ['notch'],
  props: {
    width: 'its width in px (420 unless said)',
    placeholder: 'its composer\'s placeholder',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-theme="dark" (its inside)'],
  parts: ['k7-notch__slab', 'k7-notch__in'],
  tokens: ['--dock-bg', '--notch-h', '--pad-dock', '--r-slab', '--text'],
  a11y: 'The slab is decoration; the composer inside is the kit\'s Composer.',
  boards: []
});
