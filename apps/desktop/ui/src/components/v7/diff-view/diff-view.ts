/* DiffView: its view (typed props to markup) and its contract. Its look is diff-view.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { orbHtml } from '../../orb';
import { attrs, esc, glyph, idFrom, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── DiffView (15): stacked, split; with an inline comment. One grid: a 36 line-number gutter, a 16 sign column, the code ── */
export interface DiffLine { n?: number | null; sign?: '+' | '-' | ' '; text: string }
export interface DiffComment { at: number; who: string; text: string; bot?: BotLike }
export interface DiffViewOpts {
  path: string; lines: readonly DiffLine[]; variant?: U<'stacked' | 'split'>; comment?: U<DiffComment>; focusComment?: U<boolean>; attrs?: U<Attrs>;
  /** a file of the tools' Diff (board S24, sessiontab.js `diffView`): its head folds it (a chevron leads the path, turned down while it is
      open); `add` and `del` are the file's own counts where the lines shown are not the whole of it */
  fold?: U<boolean>; open?: U<boolean>; add?: U<number>; del?: U<number>;
  /** `group`: the body is a named group, not a landmark (a diff inside a form, which can stand twice on a page: the thread and the dock) */ body?: U<'region' | 'group'>;
}
export function diffView(o: DiffViewOpts): string {
  const v = o.variant ?? 'stacked';
  const add = o.add ?? o.lines.filter((l) => l.sign === '+').length, del = o.del ?? o.lines.filter((l) => l.sign === '-').length;
  const row = (l: DiffLine): string => '<div class="k7-diff__row"' + partAttrs('DiffRow', { 'data-sign': l.sign === '+' ? 'add' : l.sign === '-' ? 'del' : null }) + '><span class="k7-diff__n">' + (l.n ?? '') + '</span><span class="k7-diff__g">' + esc(l.sign && l.sign !== ' ' ? (l.sign === '-' ? '−' : '+') : '') + '</span><span class="k7-diff__code"' + partAttrs('DiffCode') + '>' + esc(l.text) + '</span></div>';
  const comment = (c: DiffComment): string => '<div class="k7-diff__comment"' + partAttrs('DiffComment', { 'data-sq': '', 'data-sq-mode': 'frame' }) + '><div class="k7-diff__who">' + (c.bot ? orbHtml(c.bot, { size: 16, still: true }) : glyph('user')) + esc(c.who) + '</div>' +
    '<div class="k7-diff__text"' + attrs({ contenteditable: o.focusComment ? 'plaintext-only' : null, role: o.focusComment ? 'textbox' : null, 'aria-label': o.focusComment ? 'Comment' : null, tabindex: o.focusComment ? '0' : null }) + '>' + esc(c.text) + '</div></div>';
  const col = (lines: readonly DiffLine[]): string => lines.map((l, i) => row(l) + (o.comment && o.comment.at === i ? comment(o.comment) : '')).join('');
  const body = v === 'split'
    ? '<div class="k7-diff__split"><div class="k7-diff__col ui-scroll ui-scroll--x" tabindex="0" role="region" aria-label="Before">' + col(o.lines.filter((l) => l.sign !== '+')) + '</div><div class="k7-diff__col ui-scroll ui-scroll--x" tabindex="0" role="region" aria-label="After">' + col(o.lines.filter((l) => l.sign !== '-')) + '</div></div>'
    : col(o.lines);
  const id = idFrom('k7-dv', o.path);
  const head = '<span class="k7-ell k7-mono">' + esc(o.path) + '</span><span class="k7-files__counts k7-mono"><span data-tone="add">+' + add + '</span><span data-tone="del">−' + del + '</span></span>';
  return '<div class="k7-diff"' + kitAttrs('DiffView', { 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'frame', 'data-disclose': o.fold ? '' : null, 'data-open': o.fold && o.open ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    (o.fold ? '<button class="k7-reset k7-diff__head" type="button"' + attrs({ 'aria-expanded': String(!!o.open), 'aria-controls': id }) + '>' + glyph('chevron', 'k7-diff__chev') + head + '</button>' : '<div class="k7-diff__head">' + glyph('file') + head + '</div>') +
    (v === 'split' ? '<div class="k7-diff__body"' + attrs({ id: o.fold ? id : null }) + '>' : '<div class="k7-diff__body ui-scroll ui-scroll--x" tabindex="0"' + attrs({ role: o.body ?? 'region', 'aria-label': o.path, id: o.fold ? id : null }) + '>') + body + '</div></div>';
}

/** what DiffView promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<DiffViewOpts>({
  name: 'DiffView',
  folder: 'diff-view',
  layer: 'thread',
  summary: 'A file\'s change: stacked or split, with an inline comment. One grid: a 36 line-number gutter, a 16 sign column, the code. It can fold under its head (the tools\' Diff).',
  exports: ['diffView'],
  props: {
    path: 'the file\'s path',
    lines: 'its lines: a number, a sign (+, -, or space), the text',
    variant: 'stacked (the default) or split',
    comment: 'a comment on a line',
    focusComment: 'the comment is the one in focus',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    fold: 'it folds under its head',
    open: 'folded: open',
    add: 'lines added (the head\'s count)',
    del: 'lines removed (the head\'s count)',
    body: 'region (the default) or group: inside a form, a named group, not a landmark'
  },
  events: ['ui:toggle'],
  states: ['data-variant', 'data-open', 'aria-expanded'],
  parts: ['DiffRow', 'DiffCode', 'DiffComment'],
  tokens: [
    '--add', '--bg-2', '--bg-3', '--ctl-card', '--del', '--diff-g', '--diff-n', '--dur-1', '--ease-sharp', '--focus-w', '--fs-s',
    '--fs-xs', '--gap-row', '--gap-s', '--hair', '--hl', '--lh-m', '--lh-s', '--lh-xs', '--line', '--mono', '--pill-h',
    '--r-bubble', '--r-field', '--sans', '--sp-1', '--sp-2', '--sp-3', '--text', '--text-dim'
  ],
  a11y: 'The body is a focusable region (it scrolls sideways), or a named group inside a form; a folding head is a <button> with aria-expanded.',
  boards: []
});
