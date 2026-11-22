/* An orb that answers carries its reply into the thread: the orb in the presence entry flies, on a slight arc, to the
   orb of the entry (or the compact message) its reply makes, and becomes it. One opaque orb the whole way: the source
   stops drawing on the frame the carrier starts, the destination starts drawing on the frame it lands (same size, same
   face, same place). With the camera, the path is steady on screen whatever the camera does meanwhile. */
import type { ActCtx } from '../context';
import { FilmOrb, type OrbPose } from '../../engine/orb';
import { carryOrb } from '../../motion/carry';
import { eyes } from '../../motion/orb-moves';
import { h } from '../../../look/src/stage';
import { travel, vis, ui, type Ease } from './util';

export interface Flight {
  look: { shape: string; color: string };
  size: number;
  /** the orb it leaves (drawn until `at`), and the one it becomes (drawn from `at + dur`) */
  src: FilmOrb; srcEl: Element;
  dst: FilmOrb; dstEl: Element;
  from: [number, number]; to: [number, number];
  at: number; dur: number; arc?: number; ease?: Ease;
}

export function fly(ctx: ActCtx, f: Flight, valueAt: <T>(t: number, read: () => T) => T): FilmOrb {
  const film = ctx.film;
  /* the carrier starts with the source's face and gaze, and ends with the destination's */
  const p0 = valueAt(f.at, () => ({ ...f.src.pose }));
  const p1 = valueAt(f.at + f.dur + 0.02, () => ({ ...f.dst.pose }));
  const face = (p: OrbPose): string => (p.eyesMix >= 1 && p.eyesTo ? p.eyesTo : p.eyes);
  const c = new FilmOrb(f.look, f.size, { eyes: face(p0), yaw: p0.yaw, pitch: p0.pitch });
  const holder = h('span', 'a2-carrier', '', { position: 'absolute', width: f.size + 'px', height: f.size + 'px', 'line-height': '0', 'z-index': '4' });
  holder.appendChild(c.el);
  ctx.world.appendChild(holder);
  film.onRender(() => c.render());
  carryOrb(film, holder, c, { from: { x: f.from[0], y: f.from[1], size: f.size }, to: { x: f.to[0], y: f.to[1], size: f.size }, at: f.at, dur: f.dur, ease: f.ease ?? travel, arc: f.arc ?? 0.16, camera: ctx.cam });
  /* on the way it looks where it is going, and arrives with the destination's face */
  const dx = f.to[0] - f.from[0], dy = f.to[1] - f.from[1];
  const yaw = Math.max(-26, Math.min(26, dx * 0.08)), pitch = Math.max(-18, Math.min(18, -dy * 0.06));
  film.tl.fromTo(c.pose, { yaw: p0.yaw, pitch: p0.pitch }, { yaw, pitch, duration: f.dur * 0.45, ease: ui, immediateRender: false, data: { role: 'orb' } }, f.at);
  film.tl.fromTo(c.pose, { yaw, pitch }, { yaw: p1.yaw, pitch: p1.pitch, duration: f.dur * 0.55, ease: ui, immediateRender: false, data: { role: 'orb' } }, f.at + f.dur * 0.45);
  if (face(p0) !== face(p1)) eyes(film, c, f.at + f.dur * 0.2, face(p1), { dur: Math.min(0.38, f.dur * 0.7) });
  vis(film, holder, (t) => t >= f.at - 1e-9 && t < f.at + f.dur);
  vis(film, f.srcEl as HTMLElement, (t) => t < f.at);
  vis(film, f.dstEl as HTMLElement, (t) => t >= f.at + f.dur - 1e-9);
  return c;
}
