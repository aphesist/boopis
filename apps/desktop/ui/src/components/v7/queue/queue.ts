/* Queue: its view (typed props to markup) and its contract. Its look is queue.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { button } from '../button/button';
import { iconButton } from '../icon-button/icon-button';
import { esc, glyph, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Queue (11): messages waiting to be sent, above the composer; list (the engine's numbered queue), held (one row); mod (2b, the lead's
   decision for conflict 32: a mod's band shares this slot): a row per mod, its glyph and name, what it draws, and its fold ── */
/** a mod's row in the band: its name, what it draws (a ModView, as kit markup), and whether it is open */
export interface QueueMod { name: string; html: string; open?: U<boolean>; label?: U<string> }
export interface QueueOpts {
  variant?: U<'list' | 'held' | 'mod'>; /** mod: a row per mod */ mods?: U<readonly QueueMod[]>; items?: U<readonly string[]>; held?: U<string>; editing?: U<number>; attrs?: U<Attrs>;
  /** held: the message can be taken back into the composer: the list rows' own Edit, named by this (what it brings back) */ edit?: U<string>;
  /** held: what Send now does, said in its tip before it is pressed ("Send now stops those turns.") */ sendTip?: U<string>;
}
export function queue(o: QueueOpts): string {
  const v = o.variant ?? 'list';
  /* held (board K02, kit.css `.queue-held`): the clock, the one line, Send now; the buttons carry `data-queue` ("now", "edit") */
  const rows = v === 'mod'
    ? (o.mods ?? []).map((m) => '<div class="k7-queue__row"' + partAttrs('QueueRow', { role: 'listitem', 'data-row': m.name, 'data-open': m.open ? '' : null, 'aria-label': m.label ?? m.name + ' mod' }) + '>' +
      '<span class="k7-queue__who" data-tip="' + esc(m.name) + ' mod">' + glyph('mod') + '<span class="k7-ell">' + esc(m.name) + '</span></span><div class="k7-queue__body">' + m.html + '</div>' +
      iconButton({ icon: 'chevron', label: (m.open ? 'Collapse ' : 'Expand ') + m.name, variant: 'ghost', expanded: !!m.open, tip: false, attrs: { 'data-queue': 'fold' } }) + '</div>').join('')
    : v === 'held'
    ? '<div class="k7-queue__row"' + partAttrs('QueueRow', { role: 'listitem' }) + '>' + glyph('clock') + '<span class="k7-queue__text k7-ell">' + esc(o.held ?? '1 message waits until the discussion ends') + '</span>' +
      (o.edit ? iconButton({ icon: 'pen', label: o.edit, tip: 'Edit', variant: 'ghost', attrs: { 'data-queue': 'edit' } }) : '') + button({ label: 'Send now', variant: 'tint', size: 28, ...(o.sendTip ? { tip: o.sendTip } : {}), attrs: { 'data-queue': 'now' } }) + '</div>'
    : (o.items ?? []).map((t, i) => '<div class="k7-queue__row"' + partAttrs('QueueRow', { role: 'listitem', 'data-editing': o.editing === i ? '' : null }) + '><span class="k7-queue__n k7-mono">' + (i + 1) + '</span>' +
      (o.editing === i ? '<span class="k7-queue__edit" contenteditable="plaintext-only" role="textbox" aria-label="Edit the queued message">' + esc(t) + '</span>' : '<span class="k7-queue__text k7-ell">' + esc(t) + '</span>') +
      iconButton({ icon: 'pen', label: 'Edit', variant: 'ghost' }) + iconButton({ icon: 'close', label: 'Cancel', variant: 'ghost' }) + button({ label: 'Send now', variant: 'tint', size: 28 }) + '</div>').join('');
  return '<div class="k7-queue"' + kitAttrs('Queue', { role: 'list', 'aria-label': v === 'held' ? 'Held message' : v === 'mod' ? 'Mods' : 'Queued messages', 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + rows + '</div>';
}

/** what Queue promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<QueueOpts>({
  name: 'Queue',
  folder: 'queue',
  layer: 'compose',
  summary: 'What waits above the composer: the engine\'s numbered list of messages, one held message with Send now, or a mod\'s band (a row per mod, what it draws, its fold).',
  exports: ['queue'],
  props: {
    variant: 'list (the default), held or mod',
    mods: 'mod: a row per mod, its name, what it draws as kit markup, and whether it is open',
    items: 'list: the messages waiting',
    held: 'held: the message held',
    editing: 'list: the row being edited',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    edit: 'held: the name of Edit, which takes the message back into the composer',
    sendTip: 'held: what Send now does, said in its tip'
  },
  events: ['ui:fold'],
  states: ['data-variant', 'data-editing', 'data-open', 'aria-expanded'],
  parts: ['QueueRow'],
  tokens: [
    '--bg-3', '--ctl', '--ctl-s', '--dur-1', '--ease-out', '--focus', '--focus-off', '--focus-w', '--fs-2xs', '--fs-s', '--fs-xs',
    '--gap-hair', '--gap-s', '--hl', '--hover', '--icon-quiet', '--lh-s', '--line', '--line-field', '--pad-queue', '--r-block', '--r-xs',
    '--sp-1', '--sp-2', '--sp-3', '--text', '--text-dim'
  ],
  a11y: 'A list above the composer; its controls are IconButtons and Buttons, each named.',
  boards: ['K02-12-held']
});
