/* Act 3's rig. The act's world is three plates on a desk (the boopis window, a terminal, the nameless app) that the
   camera visits at very different scales: the session at 2.6x (B09, B10), the whole desk (B11), the terminal (B12),
   the terminal beside the open room (B13). The shared camera (ctx.cam) is at rest at both of the act's seams, and the
   two seam states sit at world (0, 0) at different scales, so the act moves its plates instead: each plate is a group
   with its own camera-like state (the world point at the frame's centre and a log zoom), keyed over time as a pure
   function of t and drawn by one renderer. Seen through the shared camera at rest, a group's state IS what the
   viewer's camera does to that plate; plates keyed together read as one camera, plates keyed apart read as depth.

   A track is a list of keys; between two keys the value follows an ease (a film curve, a spring, or a smooth spline
   through three keys for the one slow move), so every frame is computed from t alone and the build can ask where a
   plate will be at any time (to aim a cursor, to swap two plates' order while they do not overlap).

   The ground (the lamp) follows the act's camera at the look's ground depth through its own track, and the lamp's
   light (pool, position, size) is keyed too; both are written only inside the act's span. */
import type { Film } from '../../engine/film';
import type { Stage } from '../../engine/stage';
import type { Ease } from '../../motion/ease';

export type Rect = [number, number, number, number];

export interface View { [k: string]: number; cx: number; cy: number; lz: number }
type Vals = Record<string, number>;

interface Seg { t0: number; t1: number; to: Vals; ease: Ease | null; spline?: { mid: number; vals: Vals } }

/** a keyed value over time: holds before its first key and after its last; `at(t)` is pure */
export class Track<V extends Vals> {
  private segs: Seg[] = [];
  constructor(readonly start: V) {}
  /** from the value at t0 to `to`, landing at t1 */
  to(t0: number, t1: number, to: Partial<V>, ease: Ease): this {
    this.segs.push({ t0, t1, to: { ...this.valueAt(t0), ...to }, ease });
    this.segs.sort((a, b) => a.t0 - b.t0);
    return this;
  }
  /** one smooth move through a middle key (velocity continuous there, zero at both ends): a cubic Hermite spline */
  through(t0: number, tm: number, t1: number, mid: Partial<V>, to: Partial<V>): this {
    const a = this.valueAt(t0);
    this.segs.push({ t0, t1, to: { ...a, ...to }, ease: null, spline: { mid: tm, vals: { ...a, ...mid } } });
    this.segs.sort((x, y) => x.t0 - y.t0);
    return this;
  }
  /** set a value instantly (a hard change: use only when it cannot be seen) */
  set(t: number, to: Partial<V>): this { return this.to(t, t, to, ((p: number) => (p >= 1 ? 1 : 0)) as Ease); }
  valueAt(t: number): V {
    let v: Vals = { ...this.start };
    for (const s of this.segs) {
      if (t < s.t0) break;
      const from = v;
      if (t >= s.t1) { v = { ...from, ...s.to }; continue; }
      const out: Vals = { ...from };
      if (s.spline) {
        for (const k of Object.keys(s.to)) out[k] = hermite3(t, s.t0, s.spline.mid, s.t1, from[k] ?? 0, s.spline.vals[k] ?? 0, s.to[k] ?? 0);
      } else {
        const p = s.ease!((t - s.t0) / (s.t1 - s.t0));
        for (const k of Object.keys(s.to)) out[k] = (from[k] ?? 0) + ((s.to[k] ?? 0) - (from[k] ?? 0)) * p;
      }
      return out as V;
    }
    return v as V;
  }
  /** the spans where the value changes (for the renderer's motion blur) */
  spans(): [number, number][] { return this.segs.filter((s) => s.t1 > s.t0).map((s) => [s.t0, s.t1]); }
}

/* a cubic Hermite through (t0, a), (tm, m), (t1, b): zero slope at the ends, the middle slope chosen so the curve stays
   monotonic (harmonic mean of the two chords, Fritsch-Carlson), so a pull back never overshoots its middle key */
function hermite3(t: number, t0: number, tm: number, t1: number, a: number, m: number, b: number): number {
  const d0 = (m - a) / (tm - t0), d1 = (b - m) / (t1 - tm);
  const sm = d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1);
  const seg = (x: number, x0: number, x1: number, y0: number, y1: number, s0: number, s1: number): number => {
    const h = x1 - x0, u = (x - x0) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * s0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * s1;
  };
  return t < tm ? seg(t, t0, tm, a, m, 0, sm) : seg(t, tm, t1, m, b, sm, 0);
}

export const W = (film: Film): number => film.width;
export const H = (film: Film): number => film.height;

/** the view that puts the local rect `L` on the screen rect `S` (S keeps L's aspect: only its width is read) */
export function viewFor(film: Film, L: Rect, S: [number, number, number]): View {
  const z = S[2] / L[2];
  return { cx: L[0] - (S[0] - W(film) / 2) / z, cy: L[1] - (S[1] - H(film) / 2) / z, lz: Math.log(z) };
}
export const REST = (film: Film): View => ({ cx: W(film) / 2, cy: H(film) / 2, lz: 0 });

/** a plate: an element in the stage layer whose transform is its view (and a shared drift) */
export class Group {
  readonly view: Track<View & Vals>;
  /** focus and haze: blur in px and brightness (one layer from focus, the look's depth of field) */
  readonly lens = new Track<{ blur: number; dim: number }>({ blur: 0, dim: 1 });
  constructor(readonly film: Film, readonly el: HTMLElement, start?: View) {
    this.view = new Track({ ...(start ?? REST(film)) });
    el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0'; el.style.transformOrigin = '0 0';
  }
  /** the screen point of a local point at time t (the drift included) */
  project(t: number, x: number, y: number, drift: Track<{ z: number; dx: number; dy: number }>): [number, number] {
    const v = this.view.valueAt(t), d = drift.valueAt(t), z = Math.exp(v.lz) * d.z;
    return [W(this.film) / 2 + d.dx + (x - v.cx) * z, H(this.film) / 2 + d.dy + (y - v.cy) * z];
  }
  /** the on-screen scale at time t */
  scale(t: number, drift: Track<{ z: number; dx: number; dy: number }>): number { return Math.exp(this.view.valueAt(t).lz) * drift.valueAt(t).z; }
  screenRect(t: number, L: Rect, drift: Track<{ z: number; dx: number; dy: number }>): Rect {
    const [x, y] = this.project(t, L[0], L[1], drift), s = this.scale(t, drift);
    return [x, y, L[2] * s, L[3] * s];
  }
}

export interface Rig {
  groups: Group[];
  /** the act camera's slow drift, shared by every plate (zoom about the frame's centre and a pan) */
  drift: Track<{ z: number; dx: number; dy: number }>;
  /** the lamp: the ground's own response to the act camera (scale about the centre and a pan) and its light */
  ground: Track<{ s: number; dx: number; dy: number }>;
  /** the lamp in fractions of the frame (centre x, y; size w, h) and its tint: `inherit` is the share of the light the
      ground had on the act's first frame, `cool` the share of the escalation's cool light; the rest is --bg-3 */
  light: Track<{ x: number; y: number; w: number; h: number; inherit: number; cool: number }>;
  group(el: HTMLElement, start?: View): Group;
}

/** lookGround's .ground spans -0.4 .. 1.4 of the frame: its percentages are of 1.8 frames (as A1's and A4's lamps) */
const toBox = (f: number): number => ((f + 0.4) / 1.8) * 100, toBoxSize = (f: number): number => (f / 1.8) * 100;
const fromBox = (p: number): number => (p / 100) * 1.8 - 0.4, fromBoxSize = (p: number): number => (p / 100) * 1.8;

/** the rig: groups drawn by one renderer; the lamp written only inside the act's span [t0, t1), starting from the light
    the ground holds on the act's first frame (the acts before may have moved it with timeline tweens) */
export function rig(film: Film, stage: Stage, span: [number, number]): Rig {
  const groups: Group[] = [];
  const drift = new Track({ z: 1, dx: 0, dy: 0 });
  const ground = new Track({ s: 1, dx: 0, dy: 0 });
  const g = (): HTMLElement | null => stage.ground.querySelector<HTMLElement>('.ground');
  /* the light on the act's first frame: seek the timeline built so far there (as camera.stateAt does) and read it */
  const el0 = g();
  let inherited = { x: 0.5, y: 0.644, w: 1.116, h: 1.296, tint: 'var(--bg-4)' };   /* the look's default pool (film.css :root) */
  if (el0) {
    const prev = film.tl.time();
    film.tl.time(span[0], true);
    const v = (k: string): number => parseFloat(el0.style.getPropertyValue(k));
    if (Number.isFinite(v('--pool-x'))) inherited = { x: fromBox(v('--pool-x')), y: fromBox(v('--pool-y')), w: fromBoxSize(v('--pool-w')), h: fromBoxSize(v('--pool-h')), tint: el0.style.getPropertyValue('--pool-tint').trim() || 'var(--bg-4)' };
    film.tl.time(prev, true);
  }
  const light = new Track({ x: inherited.x, y: inherited.y, w: inherited.w, h: inherited.h, inherit: 1, cool: 0 });
  const r: Rig = {
    groups, drift, ground, light,
    group(el, start) { const gr = new Group(film, el, start); groups.push(gr); return gr; }
  };
  const CX = W(film) / 2, CY = H(film) / 2;
  film.onRender((t) => {
    const d = drift.valueAt(t);
    for (const gr of groups) {
      const v = gr.view.valueAt(t), z = Math.exp(v.lz) * d.z;
      const x = CX + d.dx - v.cx * z, y = CY + d.dy - v.cy * z;
      const tf = 'translate(' + x.toFixed(3) + 'px,' + y.toFixed(3) + 'px) scale(' + z.toFixed(6) + ')';
      if (gr.el.style.transform !== tf) gr.el.style.transform = tf;
      const l = gr.lens.valueAt(t);
      const f = (l.blur > 0.05 ? 'blur(' + l.blur.toFixed(2) + 'px) ' : '') + (Math.abs(l.dim - 1) > 0.002 ? 'brightness(' + l.dim.toFixed(3) + ')' : '');
      if (gr.el.style.filter !== f) gr.el.style.filter = f;
    }
  }, 1);
  /* the lamp: inside the act's span the act sets its light and moves the ground with the act's camera (on top of the
     shared camera's own transform, which is at rest here); outside it the act writes nothing */
  const COOL = 'color-mix(in oklab, var(--text) 9%, var(--bg-2))';
  film.onRender((t) => {
    if (t < span[0] - 1e-9 || t >= span[1] - 1e-9) return;
    const gs = ground.valueAt(t);
    const base = stage.ground.style.transform || '';
    stage.ground.style.transform = base + ' translate(' + (CX + gs.dx).toFixed(3) + 'px,' + (CY + gs.dy).toFixed(3) + 'px) scale(' + gs.s.toFixed(5) + ') translate(' + (-CX).toFixed(3) + 'px,' + (-CY).toFixed(3) + 'px)';
    const el = g(); if (!el) return;
    const l = light.valueAt(t);
    el.style.setProperty('--pool-x', toBox(l.x).toFixed(3) + '%');
    el.style.setProperty('--pool-y', toBox(l.y).toFixed(3) + '%');
    el.style.setProperty('--pool-w', toBoxSize(l.w).toFixed(3) + '%');
    el.style.setProperty('--pool-h', toBoxSize(l.h).toFixed(3) + '%');
    /* the card stock's tone (or what the ground had), cooled toward the text's ink for the escalation (look.md 1.5) */
    const rest = Math.max(1e-6, 1 - l.cool), a = Math.min(1, l.inherit / rest);
    const card = a >= 0.999 ? inherited.tint : a <= 0.001 ? 'var(--bg-3)' : 'color-mix(in oklab, ' + inherited.tint + ' ' + (a * 100).toFixed(1) + '%, var(--bg-3))';
    el.style.setProperty('--pool-tint', l.cool >= 0.999 ? COOL : l.cool <= 0.001 ? card : 'color-mix(in oklab, ' + COOL + ' ' + (l.cool * 100).toFixed(1) + '%, ' + card + ')');
  }, 2);
  return r;
}

/** declare a track's moving spans to the renderer (motion blur), as one call after the act is built */
export function declareMotion(film: Film, ...spans: [number, number][][]): void {
  for (const list of spans) for (const [a, b] of list) film.motion(a, b);
}
