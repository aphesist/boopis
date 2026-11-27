/* Mark: its view (typed props to markup) and its contract. Its look is mark.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { inlineChip } from '../inline-chip/inline-chip';
import { attrs, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Mark (31): feedforward, blank (opened, filled, waiting, lapsed), info label (17.1) ── */
export const MARK_STATES = ['shown', 'hover', 'open', 'chosen', 'waiting', 'guess'] as const;
export type MarkState = typeof MARK_STATES[number];
export const MARK_KINDS = ['feedforward', 'blank', 'info'] as const;
export type MarkKind = typeof MARK_KINDS[number];
export interface MarkOpts {
  text: string; kind?: U<MarkKind>; state?: U<MarkState>; isNew?: U<boolean>;
  /** a blank: waiting (the dashed gap of at least 7 characters with the countdown and "waiting for you"), filled (the person's words, solid
      accent), lapsed (the bot's guess with "(my guess)") */
  blank?: U<'waiting' | 'opened' | 'filled' | 'lapsed'>; countdown?: U<string>;
  /** an info label's explanation, opened in a popover */ explain?: U<string>; attrs?: U<Attrs>;
}
export function mark(o: MarkOpts): string {
  const kind = o.kind ?? 'feedforward';
  if (kind === 'info') {
    return '<button class="k7-reset k7-mark k7-info"' + kitAttrs('Mark', { type: 'button', 'data-mark-kind': 'info', 'data-mark': o.state, 'data-explain': o.explain, 'aria-haspopup': 'dialog', ...(o.attrs ?? {}) }) + '>' + esc(o.text) +
      '<span class="k7-mark__i" aria-hidden="true">' + glyph('info') + '</span></button>';
  }
  if (kind === 'blank') {
    const b = o.blank ?? 'waiting';
    if (b === 'filled') return '<span class="k7-mark"' + kitAttrs('Mark', { 'data-mark-kind': 'blank', 'data-mark': 'chosen', 'data-blank': b, ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span>';
    if (b === 'lapsed') return '<span class="k7-blank"><span class="k7-mark k7-guess"' + kitAttrs('Mark', { 'data-mark-kind': 'blank', 'data-mark': 'guess', 'data-blank': b, ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span> <span class="k7-blank__word">(my guess)</span></span>';
    const waiting = b === 'waiting';
    return '<span class="k7-blank"' + attrs({ 'data-blank': b }) + '><span class="k7-mark k7-gap" tabindex="0" role="textbox"' + kitAttrs('Mark', { 'data-mark-kind': 'blank', 'data-mark': waiting ? 'waiting' : 'open', 'aria-label': o.text, ...(o.attrs ?? {}) }) + '>' +
      '\u200b' + (waiting && o.countdown ? inlineChip({ kind: 'countdown', text: o.countdown }) : '') + '</span>' + (waiting ? '<span class="k7-blank__word" data-tone="owe">waiting for you</span>' : '') + '</span>';
  }
  return '<span class="k7-mark"' + kitAttrs('Mark', { 'data-mark-kind': 'feedforward', 'data-mark': o.state, 'data-mark-new': o.isNew ? '' : null, tabindex: '0', role: 'button', 'aria-haspopup': 'menu', ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span>';
}
/* ── MarkStack (6e, derived from 6d's askers): several models as their marks overlapped a third, at most three, then the rail's "+N"
   chip clear of them (owner, 25 November); its name says them all, or, with no name, the words beside it do (a turn's foot: "council
   of 3") and it is hidden from readers (6f) ── */
export function markStack(models: readonly ModelRef[], size = 12, label?: string): string {
  const shown = models.slice(0, 3), more = models.length - shown.length;
  return '<span class="k7-marks"' + kitAttrs('MarkStack', { role: label ? 'img' : null, 'aria-label': label ?? null, 'aria-hidden': label ? null : 'true', style: '--s:' + size + 'px' }) + '>' + shown.map((m) => '<span class="k7-marks__one">' + markHTML(m, { size, label: false }) + '</span>').join('') +
    (more ? '<span class="k7-ask__more" aria-hidden="true" data-more="+' + more + '"></span>' : '') + '</span>';
}

/** what Mark promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<MarkOpts>({
  name: 'Mark',
  folder: 'mark',
  layer: 'inline',
  summary: 'One dashed underline that says a word is read as something: a feedforward (the app\'s guess, then the person\'s choice), a blank to fill, or an info label that explains itself.',
  exports: ['mark'],
  props: {
    text: 'the words it marks',
    kind: 'feedforward (the default), blank or info',
    state: 'shown, hover, open, chosen, waiting or guess',
    isNew: 'new: it draws in once',
    blank: 'a blank: waiting, opened, filled or lapsed',
    countdown: 'a waiting blank: the countdown before it lapses',
    explain: 'an info label\'s explanation, opened in a popover',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-mark', 'data-mark-kind', 'data-mark-new', 'data-blank', 'aria-expanded (an info label\'s popover)'],
  parts: ['MarkStack', 'k7-gap', 'k7-info'],
  tokens: ['--fs-xs', '--gap-hair', '--gap-s', '--mark-gap-ch', '--owe-text', '--r-pill', '--r-xs', '--text-dim'],
  a11y: 'A feedforward is role="button" with aria-haspopup="menu"; a blank is a focusable textbox named by its words; an info label is a <button> that opens its explanation (Enter, Space, or 300 ms of hover), and Esc returns the focus.',
  boards: ['11-botchat', '12-room', 'K02-12-held', '17-working', 'S20-running', 'S23-finished']
});
