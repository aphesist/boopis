/* TimeSeparator: its view (typed props to markup) and its contract. Its look is time-separator.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { esc, kitAttrs } from '../util';
import type { U } from '../util';
import { defineContract } from '../contract';

/* ── TimeSeparator (38): only after a gap; "NEW" in the accent ── */
export interface TimeSeparatorOpts { text: string; unread?: U<boolean> }
export function timeSeparator(o: TimeSeparatorOpts): string {
  return '<div class="k7-time"' + kitAttrs('TimeSeparator', { role: 'separator', 'aria-label': o.text, 'data-unread': o.unread ? '' : null }) + '><span>' + esc(o.text) + '</span></div>';
}

/** what TimeSeparator promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<TimeSeparatorOpts>({
  name: 'TimeSeparator',
  folder: 'time-separator',
  layer: 'row',
  summary: 'A time between messages, only after a gap; "NEW" in the accent where the unread start.',
  exports: ['timeSeparator'],
  props: {
    text: 'the time, in words',
    unread: 'the unread start here'
  },
  events: [],
  states: ['data-unread'],
  parts: [],
  tokens: ['--accent-text', '--fs-2xs', '--fs-xs', '--gap-row', '--gap-s', '--hl', '--lh-m', '--sp-3', '--text-dim'],
  a11y: 'role="separator" named by its words.',
  boards: ['11-botchat', '12-room', '17-working', 'S20-running', 'S23-finished', '14-settings', 'S39-settings-sessions']
});
