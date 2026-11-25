/* The v7 dock (DESIGN-SYSTEM.md v7 21.4; tokens.v7.json dock.geometry): one component, three geometries.
     row      its content, at most 640 x 72; corner 30, flares 30, padding 30 (nothing in a corner zone); orbs 40 (hover 52, neighbours 46), gap 14
     compact  its content, at most 380 x 48; corner 24, flares 24, padding 24; orbs 24, gap 8 (Settings > General, "Compact dock when idle")
     open     640 x 432, fixed for every stack and card; content on an 8 inset (30 - 8 = 22, the Block), the row below as the switcher
   The slab is black in both themes and flush; its inside is the dark theme. D01 B: the bots that matter now, then "N more" (to the
   Bots tab); D03 C: the amber ask pill at the row's end, which opens the stack; a hover names the bot and its state in that slot.
   Every dock is drawn by this function: the lab's same-component check reads data-dk, data-geom and data-pad. */
import type { BotLike } from '../bot-state';
import { orbHtml } from '../orb';
import { slabPath } from '../squircle-path';
import { chip, iconButton } from './controls';
import { askCard } from './thread';
import type { AskCardOpts } from './thread';
import { bubble } from './blocks';
import { composer } from './thread';
import { inkOrb, statusWord } from './inline';
import { botFill } from './theme';
import { attrs, esc, kitAttrs, partAttrs } from './util';
import type { Attrs, U } from './util';

export const DOCK_GEOMETRY = {
  row: { w: 640, h: 72, R: 30, F: 30, pad: 30, orb: 40, grow: [52, 46] as const, gap: 14 },
  compact: { w: 380, h: 48, R: 24, F: 24, pad: 24, orb: 24, grow: null, gap: 8 },
  open: { w: 640, h: 432, R: 30, F: 30, pad: 8, orb: 40, grow: [52, 46] as const, gap: 14 }
} as const;
export type DockKind = keyof typeof DOCK_GEOMETRY;
export interface DockBot extends BotLike { color?: string; working?: boolean; needs?: boolean; resting?: boolean; /** the boopis bot, in ink (light on the dock) */ ink?: boolean }
export interface DockOpts {
  kind?: U<DockKind>; bots: readonly DockBot[]; hover?: U<string>; focus?: U<string>; current?: U<string>; more?: U<number>;
  /** open: the stack of asks (D03 C) or a bot's card (`state` its state in words; `composerHTML` the place of the composer when the app
      draws its own there) */ open?: U<{ kind: 'stack'; asks: readonly AskCardOpts[] } | { kind: 'card'; bot: DockBot; state?: string; log: readonly { kind: 'user' | 'agent'; text: string }[]; ask?: AskCardOpts; composerHTML?: string }>;
  /** the size the orbs are drawn at and scaled from (the app's live dock: the hover size, so a grown orb stays crisp) */ render?: U<number>;
  attrs?: U<Attrs>;
}
const stateOf = (b: DockBot): [string, 'owe' | 'neutral'] => (b.needs ? ['needs you', 'owe'] : b.working ? ['working', 'neutral'] : b.resting ? ['resting', 'neutral'] : ['idle', 'neutral']);

/** one orb of the row at size `s` (the app's live dock draws its orbs at `render` px and scales them, so a grown orb stays crisp) */
export function dockOrb(b: DockBot, s: number, o: { focus?: boolean; current?: boolean; awake?: boolean; tabbable?: boolean; render?: number; attrs?: Attrs } = {}): string {
  return '<button class="k7-reset k7-dock__orb"' + attrs({
    type: 'button', 'data-bot': b.id, 'aria-label': (b.name ?? '') + ', ' + stateOf(b)[0], 'aria-current': o.current ? 'true' : null,
    'data-focus': o.focus ? '' : null, 'data-awake': o.awake ? '' : null, tabindex: o.tabbable ? '0' : '-1', style: '--s:' + s + 'px', ...(o.attrs ?? {})
  }) + '>' + ((h: string) => (b.ink ? inkOrb(h) : h))(orbHtml(b, { size: s, ...(o.render ? { render: o.render } : {}), rest: true, surface: '--dock-bg', state: b.needs ? 'needs' : b.working ? 'working' : b.resting ? 'sleeping' : undefined })) + (b.needs ? '<span class="k7-flag" aria-hidden="true"></span>' : '') + '</button>';
}
/** the row's end slot under a hover or focus: the bot's name and its state in words (a tooltip would cover the composer's line) */
export const dockCap = (name: string, state: string, tone: 'owe' | 'neutral' = 'neutral'): string =>
  '<span class="k7-dock__cap"><b>' + esc(name) + '</b>' + statusWord({ text: state, tone }) + '</span>';
/** D03 C: the amber ask pill at the row's end ("nina needs you", "3 need you"); it opens the stack */
export const dockAsk = (text: string): string =>
  '<button class="k7-reset k7-dock__ask" type="button" aria-haspopup="dialog"><span class="k7-dot" aria-hidden="true"></span>' + esc(text) + '</button>';
/** D01 B: "N more", to the Bots tab */
export const dockMore = (n: number): string => chip({ label: n + ' more', attrs: { 'aria-label': n + ' more bots, in the Bots tab' } });

function rowHTML(o: DockOpts, kind: DockKind): string {
  const g = DOCK_GEOMETRY[kind === 'open' ? 'row' : kind];
  const hi = o.bots.findIndex((b) => b.id === o.hover);
  const orb = (b: DockBot, i: number): string => {
    const s = g.grow && hi >= 0 ? (i === hi ? g.grow[0] : Math.abs(i - hi) === 1 ? g.grow[1] : g.orb) : g.orb;
    return dockOrb(b, s, { focus: o.focus === b.id, current: o.current === b.id, awake: o.hover === b.id, tabbable: o.focus === b.id || (!o.focus && i === 0), ...(o.render ? { render: o.render } : {}) });
  };
  const needs = o.bots.filter((b) => b.needs);
  const hovered = o.bots.find((b) => b.id === o.hover);
  const end = hovered
    ? dockCap(hovered.name ?? '', stateOf(hovered)[0], stateOf(hovered)[1])
    : needs.length && kind !== 'open' ? dockAsk(needs.length === 1 ? (needs[0]?.name ?? '') + ' needs you' : needs.length + ' need you') : '';
  return '<div class="k7-dock__row"' + partAttrs('DockRow', { role: 'toolbar', 'aria-label': 'Your bots', 'aria-orientation': 'horizontal' }) + '>' + o.bots.map(orb).join('') +
    (o.more ? dockMore(o.more) : '') + end + '</div>';
}

/** the open dock's panel (above the row): the stack of asks (D03 C) or a bot's card */
export function dockPanel(open: NonNullable<DockOpts['open']>): string {
  if (open.kind === 'stack') {
    return '<div class="k7-dock__panel"><div class="k7-dock__head"><span class="k7-dock__title">Waiting on you</span><span class="k7-dock__count k7-mono">' + open.asks.length + '</span><span class="k7-grow"></span>' + iconButton({ icon: 'close', label: 'Close', variant: 'ghost', keys: 'esc' }) + '</div>' +
      open.asks.map((a) => askCard(a)).join('') + '</div>';
  }
  const b = open.bot, fill = b.color ? botFill(b.color) : undefined;
  return '<div class="k7-dock__panel"><div class="k7-dock__head">' + orbHtml(b, { size: 28, state: b.needs ? 'needs' : undefined }) + '<span class="k7-dock__name">' + esc(b.name ?? '') + '</span>' + statusWord({ text: open.state ?? stateOf(b)[0], tone: stateOf(b)[1] }) + '<span class="k7-grow"></span>' +
    iconButton({ icon: 'bots', label: 'Open in Bots', variant: 'ghost', keys: 'mod+Enter' }) + iconButton({ icon: 'close', label: 'Close', variant: 'ghost', keys: 'esc' }) + '</div>' +
    '<div class="k7-dock__log k7-thread">' + open.log.map((m) => bubble({ kind: m.kind, text: m.text, ...(m.kind === 'user' && fill ? { fill } : {}) })).join('') + '</div>' +
    (open.ask ? askCard(open.ask) : '') + (open.composerHTML ?? composer({ kind: 'dock', placeholder: 'Message ' + (b.name ?? 'the bot'), ...(fill ? { fill } : {}) })) + '</div>';
}

export function dock(o: DockOpts): string {
  const kind = o.kind ?? 'row', g = DOCK_GEOMETRY[kind];
  /* a row's width fits its content, so its slab's path is drawn for the box as laid out (paintDock, wired on every dock); the open
     geometry is one fixed size, so its path is in the markup */
  const panel = kind === 'open' && o.open ? dockPanel(o.open) : '';
  const fixed = kind === 'open';
  return '<div class="k7-dock"' + kitAttrs('Dock', {
    'data-dk': kind, 'data-geom': (fixed ? g.w : 'fit') + ',' + g.h + ',' + g.R + ',' + g.F, 'data-pad': g.pad,
    style: '--dk-h:' + g.h + 'px;--dk-r:' + g.R + 'px;--dk-f:' + g.F + 'px;--dk-pad:' + g.pad + 'px;--dk-gap:' + g.gap + 'px;--dk-max:' + g.w + 'px', 'data-theme': 'dark', ...(o.attrs ?? {})
  }) + '>' + '<svg class="k7-dock__slab" aria-hidden="true"' + (fixed ? attrs({ viewBox: '0 0 ' + (g.w + 2 * g.F) + ' ' + g.h, width: g.w + 2 * g.F, height: g.h }) : '') + '><path' + (fixed ? ' d="' + slabPath(g.w, g.h, g.R, g.F) + '"' : '') + '/></svg>' +
    panel + rowHTML(o, kind) + '</div>';
}

/** draw a row or compact dock's slab for its laid-out width (the width fits the content, 21.4): one path per size, written once */
export function paintDock(d: HTMLElement): void {
  const kind = d.getAttribute('data-dk') as DockKind | null;
  if (!kind || kind === 'open') return;
  const g = DOCK_GEOMETRY[kind];
  const draw = (): void => {
    const w = d.offsetWidth, h = g.h;
    if (!w || d.dataset['dkW'] === String(w)) return;
    d.dataset['dkW'] = String(w);
    const svg = d.querySelector('.k7-dock__slab'), path = svg?.querySelector('path');
    if (!svg || !path) return;
    svg.setAttribute('viewBox', '0 0 ' + (w + 2 * g.F) + ' ' + h); svg.setAttribute('width', String(w + 2 * g.F)); svg.setAttribute('height', String(h));
    path.setAttribute('d', slabPath(w, h, g.R, g.F));
  };
  draw();
  if (typeof ResizeObserver === 'function') new ResizeObserver(draw).observe(d);
}
