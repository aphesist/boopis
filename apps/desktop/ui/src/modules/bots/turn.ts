/* A turn of the Bots chat and of a room on the v7 kit (DESIGN-SYSTEM.md v7 12.2 Bubble, 19; screens 11 and 12): a sender's run of
   messages, each one the kit's Bubble. Yours on the right (in a bot's own chat in that bot's derived fill, 18.1; ink in a room),
   a bot's on the left; no avatar per message in a 1:1; in a room the member's name (12, its colour) above its first bubble and
   its 20 px orb in the 30 px gutter at that bubble's foot. A turn is one stop for the keyboard (`data-hx-turn`, KEYMAP 5), and
   its hover actions are what exists (copy, reply, open the chat; 19: boopis has no reactions or threads). */
import { el, frag } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';

export interface TurnOpts { kind: 'user' | 'bot'; label: string }
/** the turn's wrapper: its bubbles go in `turnBody` */
export function turnEntry(o: TurnOpts): HTMLElement {
  const t = el('div', { class: 'bt-turn', 'data-kind': o.kind, role: 'article', 'aria-label': o.label, 'data-hx-turn': '', tabindex: '-1' });
  t.append(el('div', { class: 'bt-turn__body k7-thread' }));
  return t;
}
export const turnBody = (t: HTMLElement): HTMLElement => (t.querySelector<HTMLElement>(':scope > .bt-turn__body') ?? t.querySelector<HTMLElement>('.ui-entry__body') ?? t);

export interface BubbleWrap {
  kind: 'user' | 'agent'; fill?: { fill: string; text: string } | null; toYou?: boolean;
  /** a room: the member's name and orb, on the first bubble of its run */ byline?: { bot: BotLike; colour: string } | null;
}
/** a message's content (markdown, the request's words) in the kit's Bubble; returns what goes in the turn */
export function bubbleOf(node: HTMLElement, o: BubbleWrap): HTMLElement {
  const html = kit.html.bubble({ kind: o.kind, text: '', ...(o.fill ? { fill: o.fill } : {}), ...(o.toYou ? { toYou: true } : {}), ...(o.byline ? { byline: o.byline } : {}) });
  const outer = frag(html);
  const bubble = outer.matches('[data-kit~="Bubble"]') ? outer : outer.querySelector<HTMLElement>('[data-kit~="Bubble"]');
  bubble?.replaceChildren(node);
  if (!o.byline && o.kind === 'agent') outer.classList.add('bt-bubble');
  return outer;
}

export interface ActsOpts { name: string; copy: () => string; reply?: () => void; open?: () => void }
/** the turn's hover actions (screen 11: beside the last bubble): the kit's ghost IconButtons */
export function turnActs(t: HTMLElement, o: ActsOpts): void {
  if (t.querySelector(':scope > .bt-turn__acts')) return;
  const acts = el('div', { class: 'bt-turn__acts' });
  const copy = kit.iconButton({ icon: 'copy', label: 'Copy ' + o.name + '’s message', tip: 'Copy', variant: 'ghost', keys: 'C' });
  copy.addEventListener('click', () => { void ui.copyText(o.copy()); });
  acts.append(copy);
  if (o.reply) { const r = o.reply; const b = kit.iconButton({ icon: 'at', label: 'Reply to ' + o.name, tip: 'Reply', variant: 'ghost' }); b.addEventListener('click', () => { r(); }); acts.append(b); }
  if (o.open) { const op = o.open; const b = kit.iconButton({ icon: 'bots', label: 'Open ' + o.name + '’s chat', tip: 'Open chat', variant: 'ghost' }); b.addEventListener('click', () => { op(); }); acts.append(b); }
  t.append(acts);
}
/** the hover actions sit beside the turn's last bubble, on its middle (board 11: `.row` of the bubble and its `.hoverbar`): the
    bubble and the actions share a row; when a later bubble arrives, the row is undone and made again around that one */
export function placeActs(t: HTMLElement): void {
  const acts = t.querySelector<HTMLElement>('.bt-turn__acts'); if (!acts) return;
  const body = turnBody(t);
  const old = acts.parentElement?.classList.contains('bt-turn__row') ? acts.parentElement : null;
  const bubbles = [...body.querySelectorAll<HTMLElement>(':scope > .k7-bubble, :scope > .bt-turn__row > .k7-bubble')];
  const last = bubbles[bubbles.length - 1];
  if (!last) { t.append(acts); return; }
  if (old && old.contains(last)) return;
  if (old) { const b = old.querySelector<HTMLElement>('.k7-bubble'); if (b) old.replaceWith(b); else old.remove(); }
  const row = el('div', { class: 'bt-turn__row' });
  last.replaceWith(row);
  row.append(last, acts);
}
