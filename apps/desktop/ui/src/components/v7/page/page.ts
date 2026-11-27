/* Page: its view (typed props to markup) and its contract. Its look is page.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { emptyState } from '../empty-state/empty-state';
import { sectionHead } from '../section-head/section-head';
import { segmented } from '../segmented/segmented';
import type { SegItem } from '../segmented/segmented';
import { esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Page (2): the ground and its 640 column, or a settings page (its head: the title and a Segmented scope) ── */
export interface PageOpts { variant?: U<'column' | 'settings'>; title?: U<string>; scope?: U<{ items: readonly SegItem[]; value: string; /** the Segmented's own attributes (its name) */ attrs?: Attrs }>; body?: U<string>; empty?: U<{ text: string; action?: string }>; attrs?: U<Attrs> }
export function page(o: PageOpts): string {
  const v = o.variant ?? 'column';
  const body = o.empty ? emptyState(o.empty) : (o.body ?? '');
  if (v === 'settings') {
    return '<section class="k7-page"' + kitAttrs('Page', { 'data-variant': 'settings', 'aria-label': o.title, ...(o.attrs ?? {}) }) + '><header class="k7-page__head"><h2 class="k7-page__title">' + esc(o.title ?? '') + '</h2>' +
      (o.scope ? segmented({ label: 'Scope', items: o.scope.items, value: o.scope.value, variant: 'head', ...(o.scope.attrs ? { attrs: o.scope.attrs } : {}) }) : '') + '</header><div class="k7-page__body">' + body + '</div></section>';
  }
  return '<main class="k7-page"' + kitAttrs('Page', { 'data-variant': 'column', ...(o.attrs ?? {}) }) + '><div class="k7-page__column k7-thread" data-kit-part="Thread">' + body + '</div></main>';
}
/** a settings section: its heading (4 in from its card) and its card */
export const section = (title: string, cardHTML: string, count?: string): string => '<div class="k7-section">' + sectionHead({ title, ...(count ? { count } : {}) }) + cardHTML + '</div>';

/** what Page promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<PageOpts>({
  name: 'Page',
  folder: 'page',
  layer: 'surface',
  summary: 'The ground and its 640 column, or a settings page with its head (the title and a Segmented scope). `section` is a settings section: its head and its card.',
  exports: ['page'],
  props: {
    variant: 'column (the default) or settings',
    title: 'settings: the page\'s title',
    scope: 'settings: the Segmented scope in its head',
    body: 'what it holds, as markup',
    empty: 'nothing yet: an EmptyState in its place',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-variant'],
  parts: ['Thread', 'k7-page__head', 'k7-section'],
  tokens: [
    '--bg-2', '--col-w', '--fs-s', '--fs-xl', '--gap-hair', '--lh-s', '--lh-xl', '--pad-set-gap', '--pad-set-page', '--sp-1',
    '--sp-2', '--sp-4', '--sp-5', '--text', '--text-dim'
  ],
  a11y: 'The column is <main>; a settings page a <section> named by its title (an <h2>).',
  boards: ['14-settings', 'S39-settings-sessions']
});
