/* The room's log as the product lays it out (group-room.ts): entries one under another, 32 px apart at the product's
   size, inside one scroller. A reply lands where the presence entry was, an entry slides in above who is still at work,
   a huddle grows and folds: each is an item whose height animates on the product's own durations, and the items under
   it move with it. What the camera follows is a pin: "this entry's top sits here", blended from one pin to the next on
   the camera spring, so the entry the shot is about stays put while the log grows around it (the presence never moves;
   the huddle's head line updates in place).

   The scroller's top edge is the product's scroll edge (R-scroll-9: what scrolls past it fades out over 16 px, here x3):
   it sits under the film line, in screen space, so the log scrolls under the line and never behind it. */
import type { Film } from '../../engine/film';
import type { Camera } from '../../motion/camera';
import type { Ease } from '../../motion/ease';
import { camSpring, CAM } from './util';

export interface Item {
  id: string;
  /** my placed element (absolute in the scroller, its top set by the layout), or null for a block act 1 placed */
  el: HTMLElement | null;
  /** its height (world px, tweened) */
  h: { v: number; __name: string };
  /** 0..1: how much of its slot (height and the gap above it) is open */
  slot: { v: number; __name: string };
  /** the log y it took when it was built (its element's own top) */
  y0: number;
}
interface Pin { at: number; dur: number; ref: string; edge: 'top' | 'bottom'; Y: number; p: { v: number; __name: string } }

export class Thread {
  readonly items: Item[] = [];
  private readonly pins: Pin[] = [];
  /** the band edge in screen px (y); what scrolls above it is masked; -1e4 = no band */
  readonly band = { e: -1e4, __name: 'a2-band' };
  /** the band edge may follow a world y instead (k: 0 the screen edge, 1 the world one) */
  readonly bandMix = { k: 0, wy: 0, __name: 'a2-band-mix' };
  /** the world transform of the room (B08 maps it into the window): world = (tx, ty) + s * local */
  map = { s: 1, tx: 0, ty: 0 };
  private S = 0;

  constructor(private film: Film, private cam: Camera, readonly scroller: HTMLElement, readonly top0: number, readonly gap: number, readonly fade: number, readonly from: number) {
    film.onRender((t) => this.draw(t), -6);
  }

  add(id: string, el: HTMLElement | null, h: number, o: { open?: boolean; before?: string } = {}): Item {
    const it: Item = { id, el, h: { v: h, __name: 'a2-h-' + id }, slot: { v: o.open === false ? 0 : 1, __name: 'a2-slot-' + id }, y0: el ? el.offsetTop : 0 };
    const i = o.before ? this.items.findIndex((x) => x.id === o.before) : -1;
    if (i >= 0) this.items.splice(i, 0, it); else this.items.push(it);
    return it;
  }
  item(id: string): Item { const it = this.items.find((x) => x.id === id); if (!it) throw new Error('a2 thread: no item ' + id); return it; }

  /** the item's height animates to `to` */
  height(id: string, to: number, at: number, dur: number, ease: Ease): void {
    const it = this.item(id);
    const from = this.valueAt(at, () => it.h.v);
    this.film.tl.fromTo(it.h, { v: from }, { v: to, duration: dur, ease, immediateRender: false, data: { role: 'ui' } }, at);
  }
  /** the item's slot opens (an entry slides in) or closes */
  open(id: string, at: number, dur: number, ease: Ease, to = 1): void {
    const it = this.item(id);
    const from = this.valueAt(at, () => it.slot.v);
    this.film.tl.fromTo(it.slot, { v: from }, { v: to, duration: dur, ease, immediateRender: false, data: { role: 'ui' } }, at);
  }

  /** from `at`, over `dur`, the log moves so the item's top (or bottom) sits at world y `Y` (or, with `screen`, at that
      screen y as the camera frames it when the move lands; define the camera's moves first) */
  pin(ref: string, at: number, o: { dur?: number; ease?: Ease; world?: number; screen?: number; edge?: 'top' | 'bottom' } = {}): void {
    const dur = o.dur ?? CAM, edge = o.edge ?? 'top';
    let Y = o.world ?? 0;
    if (o.screen != null) {
      const st = this.cam.stateAt(at + dur);
      const H = this.film.height;
      Y = st.y + (o.screen - H / 2) / st.zoom;
      /* through the room's own map at that time (B08) */
      const m = this.valueAt(at + dur, () => ({ ...this.map }));
      Y = (Y - m.ty) / m.s;
    }
    const p = { v: 0, __name: 'a2-pin-' + this.pins.length };
    if (dur > 0) this.film.tl.fromTo(p, { v: 0 }, { v: 1, duration: dur, ease: o.ease ?? camSpring, immediateRender: false, data: { role: 'camera' } }, at);
    else p.v = 1;
    this.pins.push({ at, dur, ref, edge, Y, p });
    this.pins.sort((a, b) => a.at - b.at);
  }

  /** the value a function of the tweened state takes at time t (seeks the timeline and puts it back) */
  valueAt<T>(t: number, read: () => T): T {
    const prev = this.film.tl.time();
    this.film.tl.time(t, true);
    const v = read();
    this.film.tl.time(prev, true);
    return v;
  }

  /** the log y of every item now */
  private layout(): Map<string, number> {
    const out = new Map<string, number>();
    let y = this.top0;
    for (const it of this.items) {
      out.set(it.id, y);
      y += (it.h.v + this.gap) * it.slot.v;
    }
    return out;
  }
  private sOf(pin: Pin, ys: Map<string, number>): number {
    const it = this.item(pin.ref);
    const y = (ys.get(pin.ref) ?? 0) + (pin.edge === 'bottom' ? it.h.v : 0);
    return y - pin.Y;
  }
  /** the scroll now (log px the content has moved up) */
  scroll(ys = this.layout()): number {
    if (!this.pins.length) return 0;
    let i = -1;
    for (let k = 0; k < this.pins.length; k++) if (this.pins[k]!.at <= this.film.tl.time() + 1e-9) i = k;
    if (i < 0) return this.sOf(this.pins[0]!, ys);
    const value = (k: number): number => {
      const pin = this.pins[k]!;
      const s = this.sOf(pin, ys);
      if (k === 0 || pin.p.v >= 1) return s;
      const before = value(k - 1);
      return before + (s - before) * pin.p.v;
    };
    return value(i);
  }
  /** an item's top in world px now (through the room's map) */
  worldTop(id: string): number {
    const ys = this.layout();
    const local = (ys.get(id) ?? 0) - this.scroll(ys);
    return this.map.ty + this.map.s * local;
  }
  /** a point given in an item's own world px (as it was built, before any scroll) as a world point now */
  point(id: string, x: number, y: number): [number, number] {
    const it = this.item(id);
    const ys = this.layout();
    const ly = (ys.get(id) ?? 0) - this.scroll(ys) + (y - it.y0);
    return [this.map.tx + this.map.s * x, this.map.ty + this.map.s * ly];
  }
  pointAt(id: string, x: number, y: number, t: number): [number, number] { return this.valueAt(t, () => this.point(id, x, y)); }
  /** an item's top in world px at time t */
  worldTopAt(id: string, t: number): number { return this.valueAt(t, () => this.worldTop(id)); }
  /** the scroll at time t */
  scrollAt(t: number): number { return this.valueAt(t, () => this.scroll()); }

  private draw(t: number): void {
    const sc = this.scroller.style;
    if (t < this.from - 1e-9) {
      if (sc.transform) sc.transform = '';
      if (sc.maskImage) { sc.maskImage = ''; sc.webkitMaskImage = ''; }
      return;
    }
    const ys = this.layout();
    const S = this.scroll(ys);
    this.S = S;
    for (const it of this.items) {
      if (!it.el) continue;
      const y = ys.get(it.id) ?? 0;
      const v = (y - it.y0).toFixed(2) + 'px';
      if (it.el.style.translate !== '0px ' + v) it.el.style.translate = '0px ' + v;
    }
    sc.transform = 'translate(0px,' + (-S).toFixed(2) + 'px)';
    /* the band: the screen edge as a line in the scroller's own px */
    const e = this.band.e;
    if (e < -1000) { if (sc.maskImage) { sc.maskImage = ''; sc.webkitMaskImage = ''; } return; }
    const s = this.cam.state, z = Math.exp(s.lz), H = this.film.height;
    const worldEdge = s.y + (e - H / 2) / z + (this.bandMix.wy - (s.y + (e - H / 2) / z)) * this.bandMix.k;
    const L = (worldEdge - this.map.ty) / this.map.s + S - this.scroller.offsetTop;
    const F = this.fade;
    const m = 'linear-gradient(to bottom, transparent ' + L.toFixed(1) + 'px, #000 ' + (L + F).toFixed(1) + 'px)';
    sc.maskImage = m; sc.webkitMaskImage = m;
    sc.maskRepeat = 'no-repeat'; sc.maskSize = '100% 100%';
  }
  get scrollNow(): number { return this.S; }
}
