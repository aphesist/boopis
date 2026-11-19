/* place: where a floating surface goes against its anchor, computed once for every overlay (tooltips, menus,
   popovers, the card layer's blank, the listbox). DESIGN-SYSTEM.md §14.18, §14.19, §14.23; rules R-float-1, R-tip-2.
   - Outside the anchor, `--float-gap` (8) from it on every side and at least `--float-margin` (8) from the window's edge
     (R-float-1; the rail's tooltip used to sit 10 away, F45).
   - A preferred side per control: `data-tip-pos` on the control or on a container of it ("top", "bottom", "left",
     "right", each with an optional "-start" or "-end": aligned to the control's edge instead of centred on it). A
     tooltip is centred on its control (R-float-3); a composer's controls ask for "top", so the tip rises above the
     composer, centred, and the window's margin is the only thing that moves it sideways.
   - Flip to the opposite side when the preferred one does not fit, and shift along the edge to stay in the window
     (8px from its edges).
   - Never over an input's text (R-tip-2, F40): a container names what must stay visible in `data-overlay-avoid` (a selector, matched
     inside it); a surface that would cover one moves past it on the same side. A rect that holds the anchor itself is
     not avoided (a menu opened on a word in the text).
   `placeRect` is the pure maths (unit tested); `placeAt` reads every rect, then writes once: left, top and
   data-place. */

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';
export interface Box { left: number; top: number; right: number; bottom: number }
export interface PlaceInput {
  anchor: Box;
  /** the surface's size */
  w: number; h: number;
  /** the window */
  view: { w: number; h: number };
  side: Side;
  align?: Align | undefined;
  /** start/end: how far the surface reaches past the anchor's edge (a menu's 8px, so its text lines up) */
  overhang?: number | undefined;
  gap?: number | undefined;
  margin?: number | undefined;
  avoid?: readonly Box[] | undefined;
}
export interface Placement { x: number; y: number; side: Side; align: Align }

/** R-float-1's tokens as numbers: read once from tokens.css (they follow no theme or density), 8 until then */
export const FLOAT = { gap: 8, margin: 8 };
let floatRead = false;
function readFloat(): void {
  if (floatRead || typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(document.documentElement), g = parseFloat(cs.getPropertyValue('--float-gap')), m = parseFloat(cs.getPropertyValue('--float-margin'));
  if (g >= 0) FLOAT.gap = g;
  if (m >= 0) FLOAT.margin = m;
  floatRead = g >= 0 && m >= 0;
}
const OPP: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const vertical = (s: Side): boolean => s === 'top' || s === 'bottom';
const overlaps = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const holds = (a: Box, b: Box): boolean => a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** "top-start" → side top, align start; anything unknown → null */
export function parsePos(v: string | null | undefined): { side: Side; align: Align } | null {
  const m = /^(top|bottom|left|right)(?:-(start|end|center))?$/.exec(v ?? '');
  return m ? { side: m[1] as Side, align: (m[2] as Align | undefined) ?? 'center' } : null;
}

export function placeRect(i: PlaceInput): Placement {
  const a = i.anchor, w = i.w, h = i.h, m = i.margin ?? FLOAT.margin, align = i.align ?? 'center', over = i.overhang ?? 0;
  const avoid = (i.avoid ?? []).filter((b) => !holds(b, a));
  /* the cross axis: aligned to the anchor, then shifted into the window */
  const cross = (s: Side): number => {
    if (vertical(s)) {
      const x = align === 'start' ? a.left - over : align === 'end' ? a.right - w + over : (a.left + a.right) / 2 - w / 2;
      return clamp(x, m, i.view.w - w - m);
    }
    const y = align === 'start' ? a.top - over : align === 'end' ? a.bottom - h + over : (a.top + a.bottom) / 2 - h / 2;
    return clamp(y, m, i.view.h - h - m);
  };
  /* the main axis: outside the anchor, then past anything to avoid that it would cover */
  const along = (s: Side, c: number): number => {
    const g = i.gap ?? FLOAT.gap;
    let p = s === 'top' ? a.top - g - h : s === 'bottom' ? a.bottom + g : s === 'left' ? a.left - g - w : a.right + g;
    for (let n = 0; n < 8; n++) {
      const r: Box = vertical(s) ? { left: c, right: c + w, top: p, bottom: p + h } : { left: p, right: p + w, top: c, bottom: c + h };
      const hit = avoid.find((b) => overlaps(r, b));
      if (!hit) break;
      p = s === 'top' ? hit.top - g - h : s === 'bottom' ? hit.bottom + g : s === 'left' ? hit.left - g - w : hit.right + g;
    }
    return p;
  };
  const fits = (s: Side, p: number): boolean => (vertical(s) ? p >= m && p + h <= i.view.h - m : p >= m && p + w <= i.view.w - m);
  const room = (s: Side, p: number): number => (vertical(s) ? Math.min(p - m, i.view.h - m - (p + h)) : Math.min(p - m, i.view.w - m - (p + w)));
  let best: { s: Side; p: number; c: number } | null = null;
  for (const s of [i.side, OPP[i.side]]) {
    const c = cross(s), p = along(s, c);
    if (fits(s, p)) { best = { s, p, c }; break; }
    if (!best || room(s, p) > room(best.s, best.p)) best = { s, p, c };
  }
  const b = best as { s: Side; p: number; c: number };
  const lim = vertical(b.s) ? i.view.h - h - m : i.view.w - w - m;
  const p = clamp(b.p, m, Math.max(m, lim));
  return vertical(b.s) ? { x: b.c, y: p, side: b.s, align } : { x: p, y: b.c, side: b.s, align };
}

/** the rects an overlay against `anchor` must leave visible (the nearest `data-overlay-avoid` container's matches) */
export function avoidRects(anchor: Element): Box[] {
  const host = anchor.closest('[data-overlay-avoid]');
  const sel = host?.getAttribute('data-overlay-avoid');
  if (!host || !sel) return [];
  const out: Box[] = [];
  for (const el of host.querySelectorAll(sel)) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) out.push(r); }
  return out;
}

export interface PlaceAtOpts { side: Side; align?: Align | undefined; overhang?: number | undefined; gap?: number | undefined }
/** place `node` (already in the document, positioned fixed or absolute to the window) against `anchor` */
export function placeAt(node: HTMLElement, anchor: Element, o: PlaceAtOpts): Placement {
  readFloat();
  /* measured from the window's corner: a fixed surface with auto width shrinks to the room right of its `left`, so the width
     read at the last placement is not the one it keeps at the new one (the clamp below keeps the whole width in the window) */
  node.style.left = '0px'; node.style.top = '0px';
  const r = anchor.getBoundingClientRect(), avoid = avoidRects(anchor);
  let w = node.offsetWidth, h = node.offsetHeight;
  /* taller than the room on either side of the anchor: it takes the roomier side and its list scrolls inside that room (R-float-4, R-select-2) */
  const roomBelow = innerHeight - FLOAT.margin - (r.bottom + FLOAT.gap), roomAbove = r.top - FLOAT.gap - FLOAT.margin;
  if ((o.side === 'top' || o.side === 'bottom') && h > Math.max(roomBelow, roomAbove)) {
    const side: Side = roomAbove > roomBelow ? 'top' : 'bottom';
    node.style.setProperty('--float-room', Math.max(roomAbove, roomBelow) + 'px');
    w = node.offsetWidth; h = node.offsetHeight; o = { ...o, side };
  } else node.style.removeProperty('--float-room');
  const p = placeRect({ anchor: r, w, h, view: { w: innerWidth, h: innerHeight }, side: o.side, align: o.align, overhang: o.overhang, gap: o.gap, avoid });
  node.style.left = p.x + 'px'; node.style.top = p.y + 'px';
  node.dataset['place'] = p.side === 'top' ? 'above' : p.side === 'bottom' ? 'below' : p.side;
  return p;
}
