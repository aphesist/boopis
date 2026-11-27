/* StatusWord: its view (typed props to markup) and its contract. Its look is status-word.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { attrs, esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── StatusWord (32): neutral, amber (needs you), red (failed), ok; with a dot, with a pulse ── */
export const STATUS_TONES = ['neutral', 'owe', 'red', 'ok'] as const;
export type StatusTone = typeof STATUS_TONES[number];
export interface StatusWordOpts { text: string; tone?: U<StatusTone>; dot?: U<boolean>; pulse?: U<boolean>; attrs?: U<Attrs> }
export function statusWord(o: StatusWordOpts): string {
  return '<span class="k7-word"' + kitAttrs('StatusWord', { 'data-tone': o.tone ?? 'neutral', ...(o.attrs ?? {}) }) + '>' +
    (o.dot || o.pulse ? '<span class="k7-dot"' + attrs({ 'data-pulse': o.pulse ? '' : null, 'data-live': o.pulse ? '' : null, 'aria-hidden': 'true' }) + '></span>' : '') + esc(o.text) + '</span>';
}

/** what StatusWord promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<StatusWordOpts>({
  name: 'StatusWord',
  folder: 'status-word',
  layer: 'inline',
  summary: 'A state in one word: neutral, amber (needs you), red (failed) or ok, with a dot or a pulse.',
  exports: ['statusWord'],
  props: {
    text: 'the word',
    tone: 'neutral (the default), owe, red or ok',
    dot: 'an 8 dot before it',
    pulse: 'the dot breathes (something is live)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-tone', 'data-pulse'],
  parts: ['k7-dot'],
  tokens: [
    '--dot', '--dur-breathe', '--ease-io', '--fs-xs', '--gap-s', '--lh-xs', '--ok', '--ok-text', '--owe', '--owe-text', '--r-pill',
    '--red', '--red-text', '--text-dim'
  ],
  a11y: 'Plain words; the dot is hidden from readers, so the word carries the meaning, never the colour alone.',
  boards: ['11-botchat', '12-room', '17-working', 'S20-running', 'S38-gate', 'K02-hover', 'K03-asks', 'K04-card', '14-settings']
});
