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
     - nothing is cut or masked (the owner, 22 November 2026: "styled on top of one another, but still fully visible. i
       don't want this cutting/masking thing"): each orb is drawn whole, with no disc or ring under it, and the next lies
       over it; only "+N" has a disc, which is its own body.
   The stack is one image to assistive technology: role img, named by the members ("atlas, nina and kai"), the same words
   on hover; `focusable` gives it a tab stop when some names are folded into "+N" (where it is not inside a control).
   "+N" is drawn, not written (`data-more`, shown by CSS): it is part of the picture, whose words are the members' names.
   As a text node it was a word of its own inside the row that holds the stack, outside the row's name ("+3" before
   "paper past"), which breaks label-in-name (WCAG 2.5.3) for the group's row.
   A cluster (`shape: 'cluster'`) is the same stack set around a circle instead of along a line, a group's avatar where there
   is room for one mark and no name (the owner, 23 November 2026, of the collapsed sidebar: "the groups at the bottom are
   indistinguishible from bots themselves. should probably make them more group-like, with the other bots appearing there
   too in another more circly configuration of them hovering each other"). The same rules hold: one step between
   neighbours (a third of an orb), one orb size, the first member underneath at the top and each next one clockwise and on
   top, "+N" the last place, nothing cut or masked. `clusterLayout` is the arithmetic. */
import { attrs } from '../core/dom';
import { orbHtml } from './orb';
import type { BotLike } from './bot-state';

type U<T> = T | undefined;
export interface StackOpts {
  /** the members in the order the stack draws them: the first underneath, the last on top */
  members: readonly BotLike[];
  /** the orb size in px: one per place */
  size: number;
  /** how many places the stack has, "+N" included: with more members than that, the last place is "+N" (default 3; a cluster's 4) */
  max?: U<number>;
  /** the accessible name and the tooltip; the members' names ("atlas, nina and kai") by default */
  label?: U<string>;
  /** a tab stop when names are folded into "+N", so the tooltip with every name is reachable by keyboard (not inside a
      button or a row, which carry the name themselves) */
  focusable?: U<boolean>;
  /** draw the orbs still (a row's lead at 16px is still anyway: R-orb-4) */
  still?: U<boolean>;
  /** `line` (the default) overlaps the members along a row; `cluster` sets them around a circle, a group's avatar */
  shape?: U<'line' | 'cluster'>;
  /** members the stack cannot draw (no longer bots of the user): they count in "+N", so a group never reads as fewer than it has */
  extra?: U<number>;
  /** the stack's own tooltip (the label); `false` inside a control whose tooltip already names the members (the rail's group row) */
  tip?: U<boolean>;
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

/** a place of a cluster: its top left corner in the cluster's box, and its step outwards when the cluster breathes out */
export interface ClusterPlace { x: number; y: number; dx: number; dy: number }
/** where each place of a cluster of `n` lies, for orbs of `size` px: around a circle, the first at the top (two lie on a diagonal
    and four on a square, so the cluster stays as tall as it is wide), each next one clockwise. The circle is as large as makes
    neighbours overlap by the stack's step (their centres two thirds of an orb apart) and never wider than two orbs: five and six
    overlap a little more to fit. Each place is its top left corner in whole pixels (a still orb drawn between pixels blurs), in a
    box as large as the cluster, so the box's centre is the cluster's; `dx`, `dy` is the whole pixel step away from the centre a
    place takes when the cluster breathes out (a hovered row). Pure: the same numbers for the same `n` and `size`. */
export function clusterLayout(n: number, size: number): { w: number; h: number; at: ClusterPlace[] } {
  const k = Math.max(1, Math.floor(n));
  if (k === 1) return { w: size, h: size, at: [{ x: 0, y: 0, dx: 0, dy: 0 }] };
  const r = Math.min(size / (3 * Math.sin(Math.PI / k)), size / 2);
  const start = k === 2 || k === 4 ? -135 : -90;
  const c = Array.from({ length: k }, (_, i) => { const a = ((start + (360 / k) * i) * Math.PI) / 180; return { cos: Math.cos(a), sin: Math.sin(a) }; });
  const x0 = Math.min(...c.map((p) => r * p.cos)), y0 = Math.min(...c.map((p) => r * p.sin));
  const whole = (v: number): number => Math.round(v) + 0;   /* + 0: never -0 */
  const at = c.map((p) => ({ x: whole(r * p.cos - x0), y: whole(r * p.sin - y0), dx: whole(1.4 * p.cos), dy: whole(1.4 * p.sin) }));
  return { w: Math.max(...at.map((p) => p.x)) + size, h: Math.max(...at.map((p) => p.y)) + size, at };
}

export function stack(o: StackOpts): string {
  const members = o.members.filter(Boolean), extra = Math.max(0, Math.floor(o.extra ?? 0)), cluster = o.shape === 'cluster';
  if (!members.length && !extra) return '<span class="ui-stack" data-count="0" hidden></span>';
  const max = Math.max(1, Math.floor(o.max ?? (cluster ? 4 : 3)));
  const split = stackSplit(members.length + extra, max), shown = Math.min(split.shown, members.length), more = members.length + extra - shown;
  const label = o.label ?? namesList(members.map((b) => b.name ?? b.id ?? ''));
  const box = cluster ? clusterLayout(shown + (more ? 1 : 0), o.size) : null;
  const place = (i: number): string | null => { const p = box?.at[i]; return p ? '--x:' + p.x + 'px;--y:' + p.y + 'px;--dx:' + p.dx + 'px;--dy:' + p.dy + 'px' : null; };
  return '<span' + attrs({ class: 'ui-stack' + (cluster ? ' ui-stack--cluster' : '') + (o.class ? ' ' + o.class : ''), style: '--s:' + o.size + 'px;--places:' + max + (box ? ';--w:' + box.w + 'px;--h:' + box.h + 'px' : ''), role: 'img', 'aria-label': label, 'data-tip': o.tip === false ? null : label, tabindex: more && o.focusable ? '0' : null, 'data-count': String(members.length + extra) }) + '>' +
    members.slice(0, shown).map((b, i) => '<span' + attrs({ class: 'ui-stack__one', style: place(i) }) + '>' + orbHtml(b, { size: o.size, still: o.still ?? undefined }) + '</span>').join('') +
    (more ? '<span class="ui-stack__more"' + attrs({ style: place(shown), 'data-more': '+' + more, 'aria-hidden': 'true' }) + '></span>' : '') + '</span>';
}
