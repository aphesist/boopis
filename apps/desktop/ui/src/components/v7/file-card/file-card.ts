/* FileCard: its view (typed props to markup) and its contract. Its look is file-card.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── FileCard: one file a bot wrote or handed over (boards 11 and 17, botscreens.js `.file`): a 32 x 40 file tile, the name, one mono line ── */
export interface FileCardOpts { name: string; meta?: U<string>; /** it opens the file: a control (Enter and Space press it) */ opens?: U<boolean>; attrs?: U<Attrs> }
export function fileCard(o: FileCardOpts): string {
  return '<div class="k7-file"' + kitAttrs('FileCard', { 'data-sq': '', 'data-sq-mode': 'frame', ...(o.opens ? { role: 'button', tabindex: '0', 'data-action': '', 'aria-label': o.name + (o.meta ? ' ' + o.meta : '') + ', opens the file' } : {}), ...(o.attrs ?? {}) }) + '><span class="k7-file__ic" aria-hidden="true">' + glyph('file') + '</span>' +
    '<span class="k7-file__text"><span class="k7-file__name k7-ell">' + esc(o.name) + '</span>' + (o.meta ? ' <span class="k7-file__meta k7-mono k7-ell">' + esc(o.meta) + '</span>' : '') + '</span></div>';   /* a word break between the name and what it holds, for the card's name (a flex column: it takes no room) */
}

/** what FileCard promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<FileCardOpts>({
  name: 'FileCard',
  folder: 'file-card',
  layer: 'thread',
  summary: 'One file a bot wrote or handed over: a file tile, the name, one mono line.',
  exports: ['fileCard'],
  props: {
    name: 'the file\'s name',
    meta: 'one mono line (its size, its type)',
    opens: 'it opens the file: a control',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-action'],
  parts: ['k7-file__tile'],
  tokens: [
    '--bg-3', '--bg-4', '--file-w', '--fill-2', '--fs-m', '--fs-xs', '--gap-row', '--hl', '--icon-quiet', '--lh-m', '--lh-xs',
    '--line', '--pill-h', '--r-bubble', '--r-tip', '--sp-3', '--sp-6', '--text', '--text-dim'
  ],
  a11y: 'When it opens the file it is role="button", one tab stop pressed with Enter or Space.',
  boards: []
});
