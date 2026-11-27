/* Well: its view (typed props to markup) and its contract. Its look is well.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { scrollClass } from '../../scroll';
import { attrs, cls, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Well (16): mono text on the deepest surface; code (in a Block or a bubble), terminal (path and branch in its head) ── */
export interface WellOpts { kind?: U<'code' | 'terminal' | 'thread'>; text: string; path?: U<string>; branch?: U<string>; label?: U<string>; attrs?: U<Attrs>;
  /** `thread` (6e, derived): a compact thread in the Well, as kit markup (a handed-off task's transcript); `text` is then unused */ html?: U<string> }
export function well(o: WellOpts): string {
  const k = o.kind ?? 'code';
  if (k === 'thread') return '<div class="k7-well"' + kitAttrs('Well', { 'data-kind': k, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '><div class="' + cls('k7-well__thread', scrollClass({ axis: 'y' })) + '" tabindex="0" role="region"' + attrs({ 'aria-label': o.label ?? 'Transcript' }) + '>' + (o.html ?? '') + '</div></div>';
  const head = k === 'terminal' ? '<div class="k7-well__head">' + glyph('terminal') + '<span class="k7-mono k7-ell">' + esc(o.path ?? '') + '</span>' + (o.branch ? '<span class="k7-mono k7-dim">' + esc(o.branch) + '</span>' : '') + '</div>' : '';
  const lines = k === 'terminal'
    ? o.text.split('\n').map((l) => (l.startsWith('$ ') ? '<span class="k7-well__prompt">$</span> ' + esc(l.slice(2)) : esc(l))).join('\n')
    : esc(o.text);
  return '<div class="k7-well"' + kitAttrs('Well', { 'data-kind': k, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + head +
    '<pre class="' + cls('k7-well__pre', scrollClass({ axis: 'x' })) + '" tabindex="0" role="region"' + attrs({ 'aria-label': o.label ?? (k === 'terminal' ? 'Terminal' : 'Code') }) + '>' + lines + '</pre></div>';
}

/** what Well promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<WellOpts>({
  name: 'Well',
  folder: 'well',
  layer: 'block',
  summary: 'Mono text on the deepest surface: code, a terminal (its path and branch in a head), or a compact thread.',
  exports: ['well'],
  props: {
    kind: 'code (the default), terminal or thread',
    text: 'its text',
    path: 'terminal: the folder in its head',
    branch: 'terminal: the branch in its head',
    label: 'its region\'s accessible name',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    html: 'thread: the compact thread, as kit markup'
  },
  events: [],
  states: ['data-kind'],
  parts: ['k7-well__head', 'k7-well__pre'],
  tokens: [
    '--bg-0', '--focus', '--focus-off', '--focus-w', '--fs-xs', '--gap-row', '--hair', '--hl', '--lh-s', '--lh-xs', '--mono',
    '--ok-text', '--pad-block', '--r-block', '--r-field', '--sp-2', '--sp-3', '--text', '--text-dim', '--well-thread-h'
  ],
  a11y: 'A focusable region (it scrolls sideways), named "Code", "Terminal" or by `label`.',
  boards: []
});
