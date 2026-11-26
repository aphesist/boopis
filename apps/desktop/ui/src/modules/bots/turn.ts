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
  /** a room: a member's later bubble sits in the same gutter, without the name and the orb */ gutter?: boolean;
}
/** a message's content (markdown, the request's words) in the kit's Bubble; returns what goes in the turn */
export function bubbleOf(node: HTMLElement, o: BubbleWrap): HTMLElement {
  const html = kit.html.bubble({ kind: o.kind, text: '', ...(o.fill ? { fill: o.fill } : {}), ...(o.toYou ? { toYou: true } : {}), ...(o.byline ? { byline: o.byline } : o.gutter ? { gutter: true } : {}) });
  const outer = frag(html);
  const bubble = outer.matches('[data-kit~="Bubble"]') ? outer : outer.querySelector<HTMLElement>('[data-kit~="Bubble"]');
  bubble?.replaceChildren(node);
  return outer;
}

export interface ActsOpts { name: string; copy: () => string; reply?: () => void; open?: () => void; /** the "more" button's menu (board 11 draws it after copy): what else the turn offers */ more?: (anchor: HTMLElement) => void }
/** the turn's hover actions (board 11: beside the last bubble): the kit's HoverBar; a room's turn adds reply ("@") and open the member's chat */
export function turnActs(t: HTMLElement, o: ActsOpts): void {
  if (t.querySelector('.k7-hoverbar')) return;
  const bar = kit.hoverBar({ label: 'Actions on ' + o.name + '’s message', actions: [
    { value: 'copy', icon: 'copy', label: 'Copy ' + o.name + '’s message', tip: 'Copy', keys: 'C' },
    ...(o.reply ? [{ value: 'reply', icon: 'at', label: 'Reply to ' + o.name, tip: 'Reply' }] : []),
    ...(o.open ? [{ value: 'open', icon: 'bots', label: 'Open ' + o.name + '’s chat', tip: 'Open chat' }] : []),
    ...(o.more ? [{ value: 'more', icon: 'more', label: 'More for ' + o.name + '’s message', tip: 'More', menu: true }] : [])
  ] });
  bar.addEventListener('ui:act', (e) => {
    const d = (e as CustomEvent<{ value: string; el: HTMLElement }>).detail;
    if (d.value === 'copy') void ui.copyText(o.copy()); else if (d.value === 'reply') o.reply?.(); else if (d.value === 'open') o.open?.(); else if (d.value === 'more') o.more?.(d.el);
  });
  t.append(bar);
}
/** the hover actions sit beside the turn's last bubble, on its middle (the kit's `hoverBeside`): when a later bubble arrives, the bar
    moves to that one */
export function placeActs(t: HTMLElement): void {
  const bar = t.querySelector<HTMLElement>('.k7-hoverbar'); if (!bar) return;
  const bubbles = [...turnBody(t).querySelectorAll<HTMLElement>('.k7-bubble')];   /* a room's bubbles sit in the kit's gutter: the row is made there */
  const last = bubbles[bubbles.length - 1];
  if (last) kit.hoverBeside(bar, last);
}
