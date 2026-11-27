/* Queue: its view (typed props to markup) and its contract. Its look is queue.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { button } from '../button/button';
import { iconButton } from '../icon-button/icon-button';
import { esc, glyph, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Queue (11): messages waiting to be sent, above the composer; list (the engine's numbered queue), held (one row) ── */
export interface QueueOpts {
  variant?: U<'list' | 'held'>; items?: U<readonly string[]>; held?: U<string>; editing?: U<number>; attrs?: U<Attrs>;
  /** held: the message can be taken back into the composer: the list rows' own Edit, named by this (what it brings back) */ edit?: U<string>;
  /** held: what Send now does, said in its tip before it is pressed ("Send now stops those turns.") */ sendTip?: U<string>;
}
export function queue(o: QueueOpts): string {
  const v = o.variant ?? 'list';
  /* held (board K02, kit.css `.queue-held`): the clock, the one line, Send now; the buttons carry `data-queue` ("now", "edit") */
  const rows = v === 'held'
    ? '<div class="k7-queue__row"' + partAttrs('QueueRow', { role: 'listitem' }) + '>' + glyph('clock') + '<span class="k7-queue__text k7-ell">' + esc(o.held ?? '1 message waits until the discussion ends') + '</span>' +
      (o.edit ? iconButton({ icon: 'pen', label: o.edit, tip: 'Edit', variant: 'ghost', attrs: { 'data-queue': 'edit' } }) : '') + button({ label: 'Send now', variant: 'tint', size: 28, ...(o.sendTip ? { tip: o.sendTip } : {}), attrs: { 'data-queue': 'now' } }) + '</div>'
    : (o.items ?? []).map((t, i) => '<div class="k7-queue__row"' + partAttrs('QueueRow', { role: 'listitem', 'data-editing': o.editing === i ? '' : null }) + '><span class="k7-queue__n k7-mono">' + (i + 1) + '</span>' +
      (o.editing === i ? '<span class="k7-queue__edit" contenteditable="plaintext-only" role="textbox" aria-label="Edit the queued message">' + esc(t) + '</span>' : '<span class="k7-queue__text k7-ell">' + esc(t) + '</span>') +
      iconButton({ icon: 'pen', label: 'Edit', variant: 'ghost' }) + iconButton({ icon: 'close', label: 'Cancel', variant: 'ghost' }) + button({ label: 'Send now', variant: 'tint', size: 28 }) + '</div>').join('');
  return '<div class="k7-queue"' + kitAttrs('Queue', { role: 'list', 'aria-label': v === 'held' ? 'Held message' : 'Queued messages', 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + rows + '</div>';
}

/** what Queue promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<QueueOpts>({
  name: 'Queue',
  folder: 'queue',
  layer: 'compose',
  summary: 'Messages waiting to be sent, above the composer: the engine\'s numbered list, or one held message with Send now.',
  exports: ['queue'],
  props: {
    variant: 'list (the default) or held',
    items: 'list: the messages waiting',
    held: 'held: the message held',
    editing: 'list: the row being edited',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    edit: 'held: the name of Edit, which takes the message back into the composer',
    sendTip: 'held: what Send now does, said in its tip'
  },
  events: [],
  states: ['data-variant', 'data-editing'],
  parts: ['QueueRow'],
  tokens: [
    '--bg-3', '--ctl', '--dur-1', '--ease-out', '--focus', '--focus-off', '--focus-w', '--fs-2xs', '--fs-s', '--gap-hair', '--hl',
    '--hover', '--lh-s', '--line', '--line-field', '--pad-queue', '--r-block', '--r-xs', '--sp-1', '--sp-2', '--sp-3', '--text',
    '--text-dim'
  ],
  a11y: 'A list above the composer; its controls are IconButtons and Buttons, each named.',
  boards: []
});
