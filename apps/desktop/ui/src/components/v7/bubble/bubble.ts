/* Bubble: its view (typed props to markup) and its contract. Its look is bubble.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { orbHtml } from '../../orb';
import { botColours } from '../avatar/avatar';
import { esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Bubble (14): user, agent, bot (derived fill in its own chat), with byline in a room, with the you wash ── */
export const BUBBLE_KINDS = ['user', 'agent', 'bot'] as const;
export interface BubbleOpts {
  kind?: U<typeof BUBBLE_KINDS[number]>; text?: U<string>; html?: U<string>;
  /** a bot's own chat: your bubble in the bot's derived fill (18.1), from theme.ts botFill */ fill?: U<{ fill: string; text: string }>;
  /** in a room: the bot's name (12, its colour) above its first bubble and its 20 px orb in the 30 px gutter at the foot */ byline?: U<{ bot: BotLike; colour: string }>;
  /** a session's agent: the model's brand tile in the gutter of the last bubble of a run (S09) */ brand?: U<ModelRef>;
  /** a session's agent bubble that is not the last of its run: in the gutter, without the tile */ gutter?: U<boolean>;
  toYou?: U<boolean>; attrs?: U<Attrs>;
}
export function bubble(o: BubbleOpts): string {
  const k = o.kind ?? 'agent';
  const body = '<div class="k7-bubble"' + kitAttrs('Bubble', {
    'data-kind': k === 'bot' ? 'agent' : k, 'data-to-you': o.toYou ? '' : null, 'data-bot-colour': o.fill ? '' : null,
    style: o.fill ? '--bubble-user:' + o.fill.fill + ';--bubble-user-text:' + o.fill.text : null, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {})
  }) + '>' + (o.html != null ? (/^\s*<(p|div|pre|ul|ol|blockquote)\b/.test(o.html) ? o.html : '<p>' + o.html + '</p>') : o.text != null ? '<p>' + esc(o.text) + '</p>' : '') + '</div>';
  if (o.byline) {
    return '<div class="k7-gutter" data-kit-part="Gutter"><div class="k7-byline" data-bot-colour style="' + botColours(o.byline.colour) + '">' + esc(o.byline.bot.name ?? '') + '</div>' + body +
      '<span class="k7-gutter__orb">' + orbHtml({ ...o.byline.bot, state: 'idle', attention: null }, { size: 20, still: true, mode: 'fixed', surface: '--bg-2' }) + '</span></div>';
  }
  if (o.gutter && !o.brand) return '<div class="k7-gutter" data-kit-part="Gutter">' + body + '</div>';
  if (o.brand) return '<div class="k7-gutter" data-kit-part="Gutter">' + body + '<span class="k7-gutter__orb" data-brand><span class="k7-avatar k7-brand" data-kit="Avatar" data-variant="brand" aria-hidden="true">' + markHTML(o.brand, { size: 14, label: false }) + '</span></span></div>';
  return body;
}

/** what Bubble promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<BubbleOpts>({
  name: 'Bubble',
  folder: 'bubble',
  layer: 'thread',
  summary: 'A message: yours, an agent\'s, or a bot\'s in its own chat (your bubble in the bot\'s fill). In a room it carries a byline and the bot\'s orb in the gutter; a session\'s agent carries the model\'s tile.',
  exports: ['bubble'],
  props: {
    kind: 'user, agent (the default) or bot',
    text: 'its words',
    html: 'its words as trusted markup (rendered markdown)',
    fill: 'a bot\'s own chat: your bubble in the bot\'s derived fill',
    byline: 'in a room: the bot\'s name over it and its orb in the gutter',
    brand: 'a session\'s agent: the model\'s tile in the gutter',
    gutter: 'a session\'s agent bubble that is not the last of its run',
    toYou: 'it is addressed to you: the you wash',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-kind', 'data-to-you', 'data-bot-colour'],
  parts: ['Gutter', 'k7-byline'],
  tokens: [
    '--bubble-agent', '--bubble-max', '--bubble-ring', '--bubble-user', '--bubble-user-text', '--fs-l', '--fs-xs', '--gap-hair',
    '--gap-row', '--gap-s', '--gap-xs', '--gutter', '--hl', '--lh-l', '--lh-m', '--name-top', '--owe-soft', '--pad-bubble-x',
    '--pad-bubble-y', '--r-bubble', '--sp-2', '--sp-3', '--sp-4', '--spec', '--text', '--text-dim', '--track'
  ],
  a11y: 'Plain text in the thread; the gutter\'s orb and tile are hidden from readers (the byline names who spoke).',
  boards: []
});
