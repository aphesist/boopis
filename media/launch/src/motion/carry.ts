/* Shared-element carry (craft bible T1 hand-off, T8 container resize, FLIP): ONE element travels from its place in
   scene A to its place in scene B, interpolating position, size, corner radius and fill on `travel`. Nothing fades:
   the carrier is opaque the whole way, so the scene change has an object the eye follows across the boundary.

   Boxes are world px (the stage plane, d = 1): measure them during the build with `boxOf()` (before the first seek the
   camera has not moved any layer). The carrier lives in a world layer, so a camera move during the carry adds to its
   travel naturally.

     const from = boxOf(chipEl, stage), to = boxOf(slotEl, stage)
     carry(film, carrier, { from, to, at: g.land(g.beat(8), 30), dur: g.f(30), radius: [24, 999], fill: ['var(--bg-3)', 'var(--selected)'] })
     carryOrb(film, holder, orb, { from: { x, y, size: 280 }, to: { x, y, size: 56 }, at, dur })

   Content swap inside a morphing container: A's content leaves 0.5x earlier than B's arrives (T1), so the container is
   never empty and never shows both contents at once; use type.ts / reveal.ts on the contents, not on the carrier. */
import type { Film } from '../engine/film';
import type { Stage } from '../engine/stage';
import type { FilmOrb } from '../engine/orb';
import { travel, type Ease } from './ease';
import { track } from './track';
import type { Camera } from './camera';

export interface Box { x: number; y: number; w: number; h: number }

export interface CarryOpts {
  from: Box; to: Box; at: number; dur: number; ease?: Ease;
  /** corner radius in px at each end (a pill: half its height) */
  radius?: [number, number];
  /** fill at each end: an opaque colour (a token works) */
  fill?: [string, string];
  /** an arc for the path, as a fraction of the distance (0 = straight; 0.1 = a slight curve, the natural default) */
  arc?: number;
}

/** an element's box in world px, measured through the stage's preview scale (call during the build) */
export function boxOf(el: Element, stage: Stage): Box {
  const f = stage.root.getBoundingClientRect(), r = el.getBoundingClientRect();
  const k = f.width / stage.width;
  return { x: (r.left - f.left) / k, y: (r.top - f.top) / k, w: r.width / k, h: r.height / k };
}
export const centre = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

/** carry a box element (absolutely placed, top-left anchored) from one box to another */
export function carry(film: Film, el: HTMLElement, o: CarryOpts): void {
  const ease = o.ease ?? travel;
  const s = el.style;
  s.position = 'absolute'; s.translate = ''; s.transformOrigin = '0 0';
  const p = { k: 0, __name: 'carry' };
  const [ax, ay] = centre(o.from), [bx, by] = centre(o.to);
  const dx = bx - ax, dy = by - ay, dist = Math.hypot(dx, dy), arc = (o.arc ?? 0.08) * dist;
  const nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  film.tl.fromTo(p, { k: 0 }, { k: 1, duration: o.dur, ease, data: { role: 'carry' } }, o.at);
  if (o.fill) film.tl.fromTo(el, { backgroundColor: o.fill[0] }, { backgroundColor: o.fill[1], duration: o.dur, ease, data: { role: 'carry' } }, o.at);
  track(film, el, { t0: o.at, draw: () => {
    const t = p.k;
    const w = lerp(o.from.w, o.to.w, t), h = lerp(o.from.h, o.to.h, t);
    const bend = Math.sin(Math.PI * t) * arc;
    const cx = lerp(ax, bx, t) + nx * bend, cy = lerp(ay, by, t) + ny * bend;
    s.left = (cx - w / 2).toFixed(3) + 'px'; s.top = (cy - h / 2).toFixed(3) + 'px';
    s.width = w.toFixed(3) + 'px'; s.height = h.toFixed(3) + 'px';
    if (o.radius) s.borderRadius = Math.min(lerp(o.radius[0], o.radius[1], t), w / 2, h / 2).toFixed(3) + 'px';
  } });
}

export interface OrbStop { x: number; y: number; size: number }
export interface CarryOrbOpts {
  from: OrbStop; to: OrbStop; at: number; dur: number; ease?: Ease; arc?: number; sizeEase?: Ease;
  /** the film's camera: the carry then travels in SCREEN space (a straight, monotonic path on screen whatever the
      camera does meanwhile), and is world-locked before and after. Define the camera's moves first. */
  camera?: Camera;
}
/** carry a film orb (its holder element) from one place and size to another; the orb's vectors are redrawn at every
    size (a CSS scale of the svg, which Chrome rasterises at the final size). With `camera`, across a camera move the
    eye sees one steady path: without it, a carry during a whip reverses on screen as the camera passes it. */
export function carryOrb(film: Film, holder: HTMLElement, orb: FilmOrb, o: CarryOrbOpts): void {
  const ease = o.ease ?? travel;
  const s = holder.style;
  s.position = 'absolute'; s.width = orb.size + 'px'; s.height = orb.size + 'px'; s.translate = ''; s.transformOrigin = '50% 50%';
  const p = { k: 0, z: 0, __name: 'carry-orb' };
  film.tl.fromTo(p, { k: 0 }, { k: 1, duration: o.dur, ease, data: { role: 'carry' } }, o.at);
  film.tl.fromTo(p, { z: 0 }, { z: 1, duration: o.dur, ease: o.sizeEase ?? ease, data: { role: 'carry' } }, o.at);
  const cam = o.camera;
  /* the path's ends, in screen space when there is a camera */
  const s0 = cam?.stateAt(o.at), s1 = cam?.stateAt(o.at + o.dur);
  const A = cam && s0 ? cam.project(o.from.x, o.from.y, 1, s0) : [o.from.x, o.from.y];
  const B = cam && s1 ? cam.project(o.to.x, o.to.y, 1, s1) : [o.to.x, o.to.y];
  const sizeA = o.from.size * (s0?.zoom ?? 1), sizeB = o.to.size * (s1?.zoom ?? 1);
  const dx = B[0]! - A[0]!, dy = B[1]! - A[1]!, dist = Math.hypot(dx, dy), arc = (o.arc ?? 0.1) * dist;
  const nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
  const put = (x: number, y: number, size: number): void => {
    s.left = (x - orb.size / 2).toFixed(3) + 'px'; s.top = (y - orb.size / 2).toFixed(3) + 'px';
    s.transform = 'scale(' + (size / orb.size).toFixed(5) + ')';
  };
  const place = (t: number): void => {
    if (cam && t < o.at) { put(o.from.x, o.from.y, o.from.size); return; }
    if (cam && t >= o.at + o.dur) { put(o.to.x, o.to.y, o.to.size); return; }
    const k = p.k, z = p.z, bend = Math.sin(Math.PI * k) * arc;
    const x = A[0]! + dx * k + nx * bend, y = A[1]! + dy * k + ny * bend;
    /* size in log space: a shrink from 300 to 100 px reads even */
    const size = Math.exp(Math.log(sizeA) + (Math.log(sizeB) - Math.log(sizeA)) * z);
    if (!cam) { put(x, y, size); return; }
    const st = { x: cam.state.x, y: cam.state.y, zoom: Math.exp(cam.state.lz), roll: cam.state.roll };
    const [wx, wy] = cam.unproject(x, y, 1, st);
    put(wx, wy, size / st.zoom);
  };
  track(film, holder, { t0: o.at, draw: place });
}
