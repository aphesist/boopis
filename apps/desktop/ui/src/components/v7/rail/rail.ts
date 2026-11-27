/* Rail: its view (typed props to markup) and its contract. Its look is rail.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { orbHtml } from '../../orb';
import { inkOrb } from '../avatar/avatar';
import { iconButton } from '../icon-button/icon-button';
import { segmented } from '../segmented/segmented';
import type { SegItem } from '../segmented/segmented';
import { attrs, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Rail (40): the bots' tiles; A 54 on 88, B 44 on 64 (automatic under 1200 px); current, needs you, working ── */
export interface RailBot extends BotLike { current?: boolean; needs?: boolean; working?: boolean; /** the boopis bot, in ink */ ink?: boolean; /** the app's handles on the tile */ attrs?: Attrs }
export interface RailGroup { name: string; members: readonly BotLike[]; /** members that are no longer bots, counted in "+N" (owner decision, 23 November) */ extra?: number; current?: boolean; attrs?: Attrs }
export interface RailOpts {
  size?: U<'a' | 'b'>; bots: readonly RailBot[]; groups?: U<readonly RailGroup[]>; /** the app's handles on the foot's three buttons */ foot?: U<{ newBot?: Attrs; store?: Attrs; settings?: Attrs }>; attrs?: U<Attrs>;
  /** the tab switch, upright, under the sidebar toggle (owner, 25 November: option B): the open sidebar's own Segmented stood on its end */ tabs?: U<{ value: string; items: readonly SegItem[]; attrs?: Attrs }>;
  /** what the foot's "+" makes ("New bot"; "New session" on the Sessions tab, whose rail shows no bots) */ newLabel?: U<string>;
}
export function rail(o: RailOpts): string {
  const b = o.size === 'b', orb = b ? 28 : 36;
  const tile = (x: RailBot): string => '<button class="k7-reset k7-tile"' + attrs({ type: 'button', 'aria-label': (x.name ?? '') + (x.needs ? ', needs you' : x.working ? ', working' : ''), 'aria-current': x.current ? 'page' : null, 'data-tip': x.name, 'data-tip-pos': 'right', 'data-needs': x.needs ? '' : null, ...(x.attrs ?? {}) }) + '>' +
    ((h: string) => (x.ink ? inkOrb(h) : h))(orbHtml(x, { size: orb, rest: true, surface: '--bg-1', state: x.state && x.state !== 'idle' ? undefined : x.needs ? 'needs' : x.working ? 'working' : undefined })) + (x.needs ? '<span class="k7-flag" aria-hidden="true"></span>' : '') + '</button>';
  /* a group is the v6 cluster (owner decision, 23 November; a keep-list item in v7), its orbs at 0.42 of the tile's orb as the approved
     boards draw it (ds-v7 screens.js: 15 on the standard rail, 12 on the compact one). DECIDED (owner, 25 November 2026): the cluster is
     at most three orbs in their triangle, as drawn; the members past three are a "+N" chip clear of the orbs, on the cluster's right,
     on its middle (a row's items share its centre), a filled pill (the line stack's counter: --bg-3, --text-dim, a hairline) no taller than half a cluster orb, so it scales
     with the rail's size (rail.css .k7-rail__more) */
  const groups = (o.groups ?? []).map((g) => {
    const shown = g.members.slice(0, 3), more = g.members.length - shown.length + Math.max(0, Math.floor(g.extra ?? 0));
    return '<button class="k7-reset k7-tile" type="button"' + attrs({ 'aria-label': g.name + ': ' + g.members.map((m) => m.name).join(', '), 'aria-current': g.current ? 'page' : null, 'data-tip': g.name, 'data-tip-pos': 'right', ...(g.attrs ?? {}) }) + '>' +
      '<span class="k7-rail__cluster" style="--s:' + Math.round(orb * 0.42) + 'px">' + railCluster(shown, Math.round(orb * 0.42)) +
      (more ? '<span class="k7-rail__more"' + partAttrs('RailMore', { 'aria-hidden': 'true', 'data-more': '+' + more }) + '></span>' : '')   /* drawn, not written (as the line stack's): the tile's name says every member */ + '</span></button>';
  }).join('');
  const tabs = o.tabs ? segmented({ label: 'View', variant: 'tabs', upright: true, value: o.tabs.value, items: o.tabs.items, attrs: { 'data-rail-tabs': '', ...(o.tabs.attrs ?? {}) } }) : '';
  return '<nav class="k7-rail"' + kitAttrs('Rail', { 'data-size': b ? 'b' : 'a', 'data-tabs': o.tabs ? '' : null, 'aria-label': o.newLabel === 'New session' ? 'Sessions' : 'Bots', ...(o.attrs ?? {}) }) + '>' + tabs + o.bots.map(tile).join('') +
    (groups ? '<hr class="k7-rail__rule">' + groups : '') + '<span class="k7-grow"></span><div class="k7-rail__foot">' +
    iconButton({ icon: 'plus', label: o.newLabel ?? 'New bot', variant: 'tinted', attrs: { 'data-tip-pos': 'right', ...(o.foot?.newBot ?? {}) } }) + iconButton({ icon: 'store', label: 'Store', variant: 'tinted', attrs: { 'data-tip-pos': 'right', ...(o.foot?.store ?? {}) } }) + iconButton({ icon: 'gear', label: 'Settings', variant: 'tinted', attrs: { 'data-tip-pos': 'right', ...(o.foot?.settings ?? {}) } }) + '</div></nav>';
}
/** a room's cluster as the boards place it (kit.js cluster): each member's orb at rest on a circle of 0.62 of an orb around the middle
    of a box 2.5 orbs wide, the first at the top, then clockwise. A room with one member left has nothing to circle: the box is that
    one orb's (`data-one`), so the orb, and the orb with its "+N", stay on the tile's middle (no board draws a room of one) */
function railCluster(members: readonly BotLike[], size: number): string {
  if (!members.length) return '';
  const one = members.length === 1, r = one ? 0 : size * 0.62, c = one ? size / 2 : size * 1.25;
  return '<span class="k7-rail__tri"' + attrs({ 'data-one': one ? '' : null }) + '>' + members.map((m, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / members.length;
    return '<span style="--x:' + (c + r * Math.cos(a) - size / 2) + 'px;--y:' + (c + r * Math.sin(a) - size / 2) + 'px">' + orbHtml({ ...m, state: 'idle', attention: null }, { size, rest: true }) + '</span>';
  }).join('') + '</span>';
}

/** what Rail promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<RailOpts>({
  name: 'Rail',
  folder: 'rail',
  layer: 'surface',
  summary: 'The bots\' tiles down the window\'s edge: A (54 on 88) or B (44 on 64, under 1200 px); current, needs you, working; rooms as clusters; the tab switch upright at its top.',
  exports: ['rail'],
  props: {
    size: 'a (the default) or b',
    bots: 'its bots (current, needs, working, ink, handles)',
    groups: 'its rooms: a name, members, extra members counted in "+N"',
    foot: 'the app\'s handles on the foot\'s buttons',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    tabs: 'the tab switch, upright, under the sidebar toggle',
    newLabel: 'what the foot\'s "+" makes ("New bot", "New session")'
  },
  events: [],
  states: ['data-size', 'data-tabs', 'aria-current (the open tile)'],
  parts: ['RailMore', 'k7-tile', 'k7-rail__cluster', 'k7-rail__foot'],
  tokens: [
    '--bg-1', '--bg-3', '--bg-4', '--ctl-card', '--current', '--dot', '--dur-1', '--dur-out', '--ease-out', '--flag-ring',
    '--fs-2xs', '--fs-m', '--gap-hair', '--gap-s', '--gap-xs', '--hair', '--hl', '--hover', '--lh-m', '--line-strong', '--mono',
    '--owe', '--pad-chip', '--pad-chrome', '--r-pill', '--r-tile', '--rail-b-w', '--row-h-2', '--sb-rail-w', '--sp-2', '--sp-3',
    '--sp-5', '--text-dim', '--tile-b'
  ],
  a11y: 'A <nav> named Bots or Sessions; each tile is a <button> named with its state ("kai, needs you"), the open one aria-current="page".',
  boards: [
    '11-botchat', 'K02-12-sidebar', '17-working', 'S17-newsession', 'S20-running', 'S23-finished', 'S33-changed', 'S36-engine',
    'S37-nomodel', 'S38-gate', 'S40-details', 'S41-noproject'
  ]
});
