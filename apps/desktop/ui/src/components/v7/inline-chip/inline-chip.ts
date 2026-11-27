/* InlineChip: its view (typed props to markup) and its contract. Its look is inline-chip.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { orbHtml } from '../../orb';
import { botColours, kitStack } from '../avatar/avatar';
import { attrs, cls, esc, glyph, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── InlineChip (30): mention, you, reference, code, cite, model, countdown ── */
export const INLINE_KINDS = ['mention', 'you', 'reference', 'code', 'cite', 'model', 'countdown'] as const;
export type InlineKind = typeof INLINE_KINDS[number];
export interface InlineChipOpts {
  kind: InlineKind; text?: U<string>; bot?: U<BotLike>; colour?: U<string>; model?: U<ModelRef>; attrs?: U<Attrs>;
  /** a mention of the whole room (`@all`): its members' orbs lead, stacked */ members?: U<readonly BotLike[]>;
  /** a mention of a bot that is not here: muted, and it opens nothing */ out?: U<boolean>;
  /** the chip is a control (a message's mention opens the bot; a reference its file): a button, named by `label` */ action?: U<boolean>; label?: U<string>;
  /** a chip set into a composer's text: one unit (not editable inside), its text exactly `words` (what is sent), its name drawn */ words?: U<string>;
  /** a source: where its words lead */ href?: U<string>;
}
/** a bot as a still mark shows it: its look, at rest whatever it is doing (the boards' small orbs keep the plain face) */
const atRest = <T extends BotLike>(b: T): T => ({ ...b, state: 'idle', attention: null });
export function inlineChip(o: InlineChipOpts): string {
  const a = (extra: Attrs = {}): string => kitAttrs('InlineChip', { 'data-kind': o.kind, ...(o.words != null ? { contenteditable: 'false', 'data-words': o.words } : {}), ...extra, ...(o.attrs ?? {}) });
  /* in a composer the chip's own text is the words as typed (read out, selected and sent); what shows is drawn from data-name */
  const said = (shown: string): string => (o.words != null ? '<span class="k7-sr">' + esc(o.words) + '</span><span aria-hidden="true"' + attrs({ 'data-name': shown }) + '></span>' : esc(shown));
  switch (o.kind) {
    case 'mention': {
      /* a bot's name in the bot's colour (Grok 9.3: the room's named uses join the card ring); its colour is data (R-colour-8) */
      const name = o.bot?.name ?? o.text ?? '', tag = o.action && o.words == null ? 'button' : 'span';
      const lead = o.members?.length ? kitStack(o.members, 16, { surface: '--bg-3' }) : o.bot ? orbHtml(atRest(o.bot), { size: 16, still: true, mode: 'fixed', surface: '--bg-3' }) : '';
      const shown = o.words != null ? '<span class="k7-sr">' + esc(o.words) + '</span><span class="k7-mention__name" aria-hidden="true"' + attrs({ 'data-name': o.members?.length ? (o.text ?? name) : name }) + '></span>' : '<span class="k7-mention__name">' + esc(o.members?.length ? (o.text ?? name) : name) + '</span>';
      return '<' + tag + ' class="' + cls(tag === 'button' && 'k7-reset', 'k7-chip-in k7-mention') + '"' + a({ type: tag === 'button' ? 'button' : null, 'aria-label': o.label, 'data-out': o.out ? '' : null, 'data-all': o.members?.length ? '' : null, 'data-bot-colour': o.colour && !o.out ? '' : null, style: o.colour && !o.out ? botColours(o.colour) : null }) + '>' + lead + shown + '</' + tag + '>';
    }
    case 'you': return '<span class="k7-chip-in k7-cap k7-you"' + a() + '>' + glyph('user', 'k7-you__ic') + said(o.text ?? 'you') + '</span>';
    case 'reference': {
      const tag = o.action && o.words == null ? 'button' : 'span';
      return '<' + tag + ' class="' + cls(tag === 'button' && 'k7-reset', 'k7-chip-in k7-cap k7-ref') + '"' + a({ type: tag === 'button' ? 'button' : null, 'aria-label': o.label }) + '>' + said(o.text ?? '') + '</' + tag + '>';
    }
    case 'cite': return '<a class="k7-chip-in k7-cite"' + a({ href: o.href, target: o.href ? '_blank' : null, rel: o.href ? 'noopener noreferrer' : null }) + '><i class="k7-cite__ic" aria-hidden="true"></i>' + esc(o.text ?? '') + '</a>';
    case 'code': return '<code class="k7-chip-in k7-code"' + a() + '>' + esc(o.text ?? '') + '</code>';
    case 'model': return '<span class="k7-chip-in k7-model"' + a() + '>' + markHTML(o.model ?? null, { size: 14, label: false }) + said(o.text ?? (typeof o.model === 'string' ? o.model : '')) + '</span>';   /* in a composer its own text is the words typed ("@Claude Sonnet"), as every chip's */
    case 'countdown': return '<span class="k7-chip-in k7-cap k7-count"' + partAttrs('Countdown', { 'data-kit': 'InlineChip', 'data-kind': 'countdown', role: 'timer', 'aria-live': 'off', ...(o.attrs ?? {}) }) + '>' + esc(o.text ?? '') + '</span>';
  }
}

/** what InlineChip promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<InlineChipOpts>({
  name: 'InlineChip',
  folder: 'inline-chip',
  layer: 'inline',
  summary: 'A chip that sits in running text and never makes the line taller: a mention, you, a reference, inline code, a citation, a model, a countdown.',
  exports: ['inlineChip'],
  props: {
    kind: 'mention, you, reference, code, cite, model or countdown',
    text: 'its words',
    bot: 'a mention: the bot (its orb leads, its name in its colour)',
    colour: 'a mention: the bot\'s colour',
    model: 'a model chip: the model whose mark leads',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    members: 'a mention of the whole room (@all): its members stacked',
    out: 'a mention of a bot that is not here: muted, and it opens nothing',
    action: 'the chip is a control (a mention opens the bot, a reference its file)',
    label: 'a control chip\'s accessible name',
    words: 'set into a composer\'s text: one unit, its text exactly these words (what is sent)',
    href: 'a citation: where it leads'
  },
  events: [],
  states: ['data-kind', 'data-out', 'data-all', 'data-bot-colour', 'contenteditable="false" (in a composer)'],
  parts: ['Countdown', 'k7-mention__name'],
  tokens: [
    '--badge-h', '--bg-4', '--chip', '--fill-2', '--fs-2xs', '--fs-s', '--fs-xs', '--gap-hair', '--gap-s', '--gap-xs', '--hl',
    '--line-strong', '--mono', '--owe', '--owe-soft', '--owe-text', '--pad-code-x', '--pad-code-y', '--pad-inline', '--pad-kbd',
    '--r-pill', '--r-xs', '--sp-1', '--text', '--text-dim'
  ],
  a11y: 'Inline text, or a <button> when it acts. In a composer its own text is the words typed, so it is read, selected and sent as words; the drawn name is hidden from readers.',
  boards: []
});
