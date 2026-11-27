/* FindBar: its view (typed props to markup) and its contract. Its look is find-bar.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { iconButton } from '../icon-button/icon-button';
import { attrs, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── FindBar (6e, derived: find in a conversation): a small floating bar at the conversation's top right: the kit's search Field, how
   many matched ("3 of 12", or "No matches" in quiet words), previous and next, and esc that closes it. What it finds and marks is the
   app's (`ui:find` {query, dir} on the bar; `ui:find-close`) ── */
export interface FindBarOpts { id: string; label?: U<string>; value?: U<string>; /** "3 of 12"; '' says nothing; "No matches" is quiet */ count?: U<string>; attrs?: U<Attrs> }
export function findBar(o: FindBarOpts): string {
  const none = o.count === 'No matches';
  return '<div class="k7-find"' + kitAttrs('FindBar', { role: 'search', 'aria-label': o.label ?? 'Find in this conversation', 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' +
    '<span class="k7-field__box k7-find__box" data-kind="search">' + glyph('search', 'k7-field__glyph') + '<input class="k7-field__input" type="search" id="' + esc(o.id) + '"' + attrs({ value: o.value, placeholder: 'Find', 'aria-label': o.label ?? 'Find in this conversation', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': o.id + '-count' }) + '></span>' +
    '<span class="k7-find__count k7-mono" id="' + esc(o.id) + '-count" role="status" aria-live="polite"' + attrs({ 'data-none': none ? '' : null }) + '>' + esc(o.count ?? '') + '</span>' +
    iconButton({ icon: 'chevron-up', label: 'Previous match', tip: 'Previous', variant: 'ghost', keys: 'shift+Enter', attrs: { 'data-find': 'prev' } }) +
    iconButton({ icon: 'chevron-down', label: 'Next match', tip: 'Next', variant: 'ghost', keys: 'Enter', attrs: { 'data-find': 'next' } }) +
    iconButton({ icon: 'close', label: 'Close find', tip: 'Close', variant: 'ghost', keys: 'esc', attrs: { 'data-find': 'close' } }) + '</div>';
}

/** what FindBar promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<FindBarOpts>({
  name: 'FindBar',
  folder: 'find-bar',
  layer: 'thread',
  summary: 'Find in a conversation: a small floating bar with the search field, how many matched, previous, next and close.',
  exports: ['findBar'],
  props: {
    id: 'the field\'s id',
    label: 'its accessible name',
    value: 'what is being found',
    count: '"3 of 12"; "No matches" is quiet; empty says nothing',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-none'],
  parts: ['k7-find__count'],
  tokens: [
    '--bg-3', '--ctl-s', '--find-hit', '--find-hit-now', '--find-w', '--float-line', '--fs-xs', '--gap-hair', '--hl', '--lh-xs',
    '--pad-queue', '--r-pill', '--sans', '--shadow-pop', '--sp-1', '--sp-3', '--text', '--text-dim'
  ],
  a11y: 'role="search"; the count is a polite status, and Enter, shift Enter and esc are said in the buttons\' tips.',
  boards: []
});
