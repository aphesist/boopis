/* SystemLine: its view (typed props to markup) and its contract. Its look is system-line.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { orbHtml } from '../../orb';
import { kitStack } from '../avatar/avatar';
import { button } from '../button/button';
import { statusWord } from '../status-word/status-word';
import { esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── SystemLine (13): a centred line about the thread itself: info (with what it cost at its end, S33), steer, hand-off, error with action ── */
export const SYSTEM_LINE_VARIANTS = ['info', 'steer', 'handoff', 'error'] as const;
export interface SystemLineOpts { variant?: U<typeof SYSTEM_LINE_VARIANTS[number]>; text: string; /** a StatusWord before the words (6e, derived: an escalation the cap stopped, "capped" in amber) */ word?: U<{ text: string; tone?: U<import('../status-word/status-word').StatusTone> }>; /** what follows the words in mono, at the line's end (board S33: a changed setting's extra cost, "+$0.04") */ meta?: U<string>; icon?: U<string>; from?: U<BotLike>; /** a hand-off's receiver; several are the kit's stack at 16 (6f: a room's lead gives a message to more than one member) */ to?: U<BotLike | readonly BotLike[]>; message?: U<string>; action?: U<string>; attrs?: U<Attrs> }
const isMany = (t: BotLike | readonly BotLike[]): t is readonly BotLike[] => Array.isArray(t);
export function systemLine(o: SystemLineOpts): string {
  const v = o.variant ?? 'info';
  const lead = v === 'handoff' ? (o.from ? orbHtml(o.from, { size: 16, still: true }) : '') + glyph('chevron', 'k7-sys__chev') + (!o.to ? '' : isMany(o.to) ? kitStack(o.to, 16, { max: 3 }) : orbHtml(o.to, { size: 16, still: true })) : glyph(o.icon);
  const pill = '<div class="k7-sys"' + kitAttrs('SystemLine', { role: 'note', 'data-variant': v, 'data-act': o.action ? '' : null, ...(o.attrs ?? {}) }) + '>' + lead +
    (o.word ? statusWord({ text: o.word.text, tone: o.word.tone }) : '') + '<span class="k7-sys__text">' + esc(o.text) + '</span>' + (o.meta ? '<span class="k7-sys__meta k7-mono">' + esc(o.meta) + '</span>' : '') + (o.action ? button({ label: o.action, variant: 'tint', size: 28, attrs: { 'data-line': '' } }) : '') + '</div>';   /* kit.css `.sysline.act .btn`: the tint button (S36) */
  return v === 'steer' && o.message ? '<div class="k7-sys-wrap">' + pill + '<div class="k7-sys__msg">' + esc(o.message) + '</div></div>' : pill;
}

/** what SystemLine promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SystemLineOpts>({
  name: 'SystemLine',
  folder: 'system-line',
  layer: 'thread',
  summary: 'A centred line about the thread itself: info (with what it cost), a steer, a hand-off between bots, or an error with its action.',
  exports: ['systemLine'],
  props: {
    variant: 'info (the default), steer, handoff or error',
    text: 'its words',
    word: 'a StatusWord before the words',
    meta: 'what follows in mono at its end ("+$0.04")',
    icon: 'a glyph of the kit\'s icon set, before the words',
    from: 'handoff: who gave it',
    to: 'handoff: who took it (several are a stack)',
    message: 'steer: the message that steered, under the line',
    action: 'error: the action\'s words',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-variant', 'data-act'],
  parts: ['k7-sys__text', 'k7-sys__meta'],
  tokens: [
    '--bubble-max', '--bubble-user', '--bubble-user-text', '--fill-2', '--focus-w', '--fs-s', '--fs-xs', '--gap-s', '--icon-quiet',
    '--lh-m', '--lh-s', '--lh-xs', '--line-h', '--line-h-act', '--pad-line', '--pad-line-act', '--pad-tip-y', '--r-bubble',
    '--r-pill', '--red-text', '--sp-1', '--sp-3', '--text-dim'
  ],
  a11y: 'role="note"; its action is a Button.',
  boards: []
});
