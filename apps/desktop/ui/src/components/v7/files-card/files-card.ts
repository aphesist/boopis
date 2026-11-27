/* FilesCard: its view (typed props to markup) and its contract. Its look is files-card.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { button } from '../button/button';
import { statusWord } from '../status-word/status-word';
import type { StatusTone } from '../status-word/status-word';
import { blockAttrs, attrs, esc, glyph, idFrom, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { well } from '../well/well';
import { defineContract } from '../contract';

/* ── FilesCard (10): a turn's changed files (board S23, kit.css `.files-card`): "2 changed files" with the turn's +/−, an action at the
   head's end (Open diff), then a row per file: its glyph, its path in mono, its own +/− at the end. A long list folds (`fold`) ── */
export interface FileRow { path: string; add?: number; del?: number; /** what happens to it, in words, in place of its +/− (a rewind's dry run: "put back", 6e) */ word?: string }
export interface FilesCardOpts {
  files: readonly FileRow[]; /** a long list folds under its head: open or closed */ fold?: U<boolean>; open?: U<boolean>; /** the head's action ("Open diff"); its button carries `data-files` */ action?: U<string>; actionAttrs?: U<Attrs>; attrs?: U<Attrs>;
  /** board S38 (sessiontab2.js `s18` c): the same card says how a check on the change went (the gate): in its head the check's glyph and
      name and the verdict as a StatusWord in its tone, at the end the one way on ("Fix and retry"); under it what the check printed, in
      a Well in the verdict's colour, and one note. The files the check ran on follow where there are any */
  check?: U<{ icon?: U<string>; title: string; word: string; tone?: U<StatusTone>; output?: U<string>; note?: U<string>; /** the check runs again: its word shimmers (6e, a failed turn retrying) */ live?: U<boolean> }>;
  /** the head's words in place of "N changed files" (a rewind's sheet: "4 files"); the turn's +/− then are not said */ title?: U<string>;
}
export function filesCard(o: FilesCardOpts): string {
  if (o.check) {
    const c = o.check;
    return '<div class="k7-files k7-block"' + blockAttrs('FilesCard', { 'data-check': c.tone ?? 'neutral', 'data-open': '', ...(o.attrs ?? {}) }) + '>' +
      '<div class="k7-files__head k7-text">' + glyph(c.icon ?? 'terminal') + '<span class="k7-files__name">' + esc(c.title) + '</span>' + (c.live ? statusWord({ text: c.word, tone: c.tone }).replace(/>([^<]*)<\/span>$/, '><span class="k7-shimmer" data-live>$1</span></span>') : statusWord({ text: c.word, tone: c.tone })) +
      '<span class="k7-grow"></span>' + (o.action ? button({ label: o.action, variant: 'tint', size: 28, attrs: { 'data-files': '', ...(o.actionAttrs ?? {}) } }) : '') + '</div>' +
      (c.output ? well({ text: c.output, label: c.title + ' output' }) : '') +
      (o.files.length ? '<ul class="k7-files__list">' + o.files.map((f) => '<li class="k7-files__row k7-text"' + partAttrs('FileRow') + '>' + glyph('file') + '<span class="k7-ell k7-mono">' + esc(f.path) + '</span></li>').join('') + '</ul>' : '') +
      (c.note ? '<p class="k7-files__note k7-text">' + esc(c.note) + '</p>' : '') + '</div>';
  }
  const add = o.files.reduce((n, f) => n + (f.add ?? 0), 0), del = o.files.reduce((n, f) => n + (f.del ?? 0), 0);
  const id = idFrom('k7-fc', o.files.map((f) => f.path).join());
  const counts = (a: number, d: number): string => '<span class="k7-files__counts k7-mono"><span data-tone="add">+' + a + '</span><span data-tone="del">−' + d + '</span></span>';
  const title = o.title != null ? '<span class="k7-files__title">' + esc(o.title) + '</span>' : '<span class="k7-files__title">' + esc(o.files.length + (o.files.length === 1 ? ' changed file' : ' changed files')) + '</span>' + counts(add, del);
  const open = o.fold ? !!o.open : true;
  return '<div class="k7-files k7-block"' + blockAttrs('FilesCard', { 'data-disclose': o.fold ? '' : null, 'data-open': open ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    '<div class="k7-files__head k7-text">' + (o.fold ? '<button class="k7-reset k7-files__fold" type="button"' + attrs({ 'aria-expanded': String(open), 'aria-controls': id }) + '>' + title + glyph('chevron-down', 'k7-chev') + '</button>' : title) +
    '<span class="k7-grow"></span>' + (o.action ? button({ label: o.action, variant: 'tint', size: 28, attrs: { 'data-files': '', ...(o.actionAttrs ?? {}) } }) : '') + '</div>' +
    '<ul class="k7-files__list" id="' + id + '">' + o.files.map((f) => '<li class="k7-files__row k7-text"' + partAttrs('FileRow') + '>' + glyph('file') + '<span class="k7-ell k7-mono">' + esc(f.path) + '</span>' + (f.word != null ? '<span class="k7-files__word">' + esc(f.word) + '</span>' : counts(f.add ?? 0, f.del ?? 0)) + '</li>').join('') + '</ul></div>';
}

/** what FilesCard promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<FilesCardOpts>({
  name: 'FilesCard',
  folder: 'files-card',
  layer: 'thread',
  summary: 'A turn\'s changed files: "2 changed files" with the turn\'s +/−, an action at the head\'s end, a row per file; a long list folds. It can also say how a check on the change went.',
  exports: ['filesCard'],
  props: {
    files: 'its files: a path, lines added and removed, or what happens to it in words',
    fold: 'a long list folds under its head',
    open: 'folded: open',
    action: 'the head\'s action ("Open diff")',
    actionAttrs: 'the app\'s handles on the action',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    check: 'a check on the change: its name, verdict, tone, what it printed, a note',
    title: 'the head\'s words in place of "N changed files"'
  },
  events: ['ui:toggle'],
  states: ['data-open', 'data-check', 'aria-expanded'],
  parts: ['FileRow'],
  tokens: [
    '--add', '--ctl-s', '--del', '--fs-s', '--fs-xs', '--gap-s', '--lh-s', '--lh-xs', '--line-h', '--r-field', '--r-xs',
    '--red-text', '--sp-1', '--sp-2', '--text', '--text-dim', '--track-s'
  ],
  a11y: 'A Block; a folding head is a <button> with aria-expanded and aria-controls, and the head\'s action is a Button.',
  boards: []
});
