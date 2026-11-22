/* A stack: several bots as overlapped orbs (a group's members, the teammates who asked together). One treatment wherever
   a group shows its members (the owner, 22 November 2026: "the overlapping there on the group chat actually looks cool,
   we'd just need to make it more consistent"):
     - one overlap step, a third of an orb (--stack-step), whatever the size;
     - one orb size per place (the caller's `size`);
     - one order: the members as given, the first underneath and each next one on top;
     - one slot in a row: a row's lead is as wide as the place's whole stack (`--places`), so the titles of a list of
       groups line up whatever each has (a "+N" too wide for a disc widens its own row only);
     - "+N" is the last member: a disc the size of an orb (a capsule only when N needs more room), overlapped by the same
       step, never colliding with the orb before it;
     - each member sits on a disc of the ground under the stack with a 2px ring of it, so the overlap reads on every
       ground: `--stack-ground` names that surface (the conversation's ground by default), and a translucent fill over it
       (a row's hover or current, which rows pass through `--sq-bg`) is layered on the disc and the ring.
   The stack is one image to assistive technology: role img, named by the members ("atlas, nina and kai"), the same words
   on hover; `focusable` gives it a tab stop when some names are folded into "+N" (where it is not inside a control).
   "+N" is drawn, not written (`data-more`, shown by CSS): it is part of the picture, whose words are the members' names.
   As a text node it was a word of its own inside the row that holds the stack, outside the row's name ("+3" before
   "paper past"), which breaks label-in-name (WCAG 2.5.3) for the group's row. */
import { attrs } from '../core/dom';
import { orbHtml } from './orb';
import type { BotLike } from './bot-state';

type U<T> = T | undefined;
export interface StackOpts {
  /** the members in the order the stack draws them: the first underneath, the last on top */
  members: readonly BotLike[];
  /** the orb size in px: one per place */
  size: number;
  /** how many places the stack has, "+N" included: with more members than that, the last place is "+N" (default 3) */
  max?: U<number>;
  /** the accessible name and the tooltip; the members' names ("atlas, nina and kai") by default */
  label?: U<string>;
  /** a tab stop when names are folded into "+N", so the tooltip with every name is reachable by keyboard (not inside a
      button or a row, which carry the name themselves) */
  focusable?: U<boolean>;
  /** draw the orbs still (a row's lead at 16px is still anyway: R-orb-4) */
  still?: U<boolean>;
  class?: U<string>;
}

/** "atlas", "atlas and nina", "atlas, nina and kai" */
export const namesList = (names: readonly string[]): string => (names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

/** how many orbs a stack of `n` members draws in `max` places, and how many fold into "+N" */
export function stackSplit(n: number, max = 3): { shown: number; more: number } {
  const lim = Math.max(1, Math.floor(max));
  const shown = n > lim ? Math.max(1, lim - 1) : n;
  return { shown, more: n - shown };
}

export function stack(o: StackOpts): string {
  const members = o.members.filter(Boolean);
  if (!members.length) return '<span class="ui-stack" data-count="0" hidden></span>';
  const { shown, more } = stackSplit(members.length, o.max ?? 3);
  const label = o.label ?? namesList(members.map((b) => b.name ?? b.id ?? ''));
  return '<span' + attrs({ class: 'ui-stack' + (o.class ? ' ' + o.class : ''), style: '--s:' + o.size + 'px;--places:' + Math.max(1, Math.floor(o.max ?? 3)), role: 'img', 'aria-label': label, 'data-tip': label, tabindex: more && o.focusable ? '0' : null, 'data-count': String(members.length) }) + '>' +
    members.slice(0, shown).map((b) => '<span class="ui-stack__one">' + orbHtml(b, { size: o.size, still: o.still ?? undefined }) + '</span>').join('') +
    (more ? '<span class="ui-stack__more"' + attrs({ 'data-more': '+' + more, 'aria-hidden': 'true' }) + '></span>' : '') + '</span>';
}
