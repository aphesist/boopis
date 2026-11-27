/* EmptyState: its view (typed props to markup) and its contract. Its look is empty-state.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { button } from '../button/button';
import { esc, kitAttrs } from '../util';
import type { U } from '../util';
import { defineContract } from '../contract';

/* ── EmptyState: one line (at most 80 characters) and at most one action, where the content would be. In a list (`place: 'list'`,
   board S41's "No sessions yet") the line starts where the list's rows and heads start their words ── */
export interface EmptyStateOpts { text: string; action?: U<string>; place?: U<'list'> }
export function emptyState(o: EmptyStateOpts): string {
  return '<div class="k7-empty"' + kitAttrs('EmptyState', { 'data-place': o.place ?? null }) + '><p class="k7-empty__text">' + esc(o.text) + '</p>' + (o.action ? button({ label: o.action, variant: 'secondary', size: 32 }) : '') + '</div>';
}

/** what EmptyState promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<EmptyStateOpts>({
  name: 'EmptyState',
  folder: 'empty-state',
  layer: 'row',
  summary: 'One line, at most 80 characters, and at most one action, where the content would be.',
  exports: ['emptyState'],
  props: {
    text: 'its line',
    action: 'its one action\'s words',
    place: 'list: the line starts where a list\'s rows start their words'
  },
  events: [],
  states: ['data-place'],
  parts: ['k7-empty__text'],
  tokens: [
    '--dur-2', '--ease-sharp', '--fs-s', '--gap-row', '--lh-s', '--pad-empty-list', '--sp-1', '--sp-3', '--sp-4', '--sp-5',
    '--text-dim', '--track-s'
  ],
  a11y: 'A paragraph and, when there is one, a Button.',
  boards: []
});
