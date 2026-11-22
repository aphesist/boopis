/* The 2.5D camera: zoom, pan and roll over layers at depths, with parallax. The camera's state is the world point at
   the frame's centre (x, y), a zoom and a roll in degrees. A layer at depth d moves by d times the camera's travel and
   scales by zoom^d: the stage plane is d = 1, the ground behind it 0.2 to 0.4 (it drifts slower), the foreground
   1.2 to 1.4 (cursor, flags, floating chips). Zoom is tweened in log space, so a push from 1 to 4 feels even all the
   way (a linear zoom races at the start and crawls at the end).

     const cam = camera(film, stage)
     cam.to({ zoom: 1.35, x: 1100 }, { at: g.beat(4), dur: g.f(36), ease: travel })
     cam.drift({ zoom: 1.02 }, { at: 0, dur: 2 })      // a hold that keeps breathing: scale +1.5 to 3% a second

   Rules (craft bible 4, U5): the camera never overshoots (its spring is critically damped), never zooms in and out
   back to back, and follows the focus with a 4 to 6 frame lag. Depth of field is `cam.focus(depth, blurPerUnit)`. */
import type { Film } from '../engine/film';
import type { Stage } from '../engine/stage';
import { travel, type Ease } from './ease';

export interface CameraState { x: number; y: number; zoom: number; roll: number }
interface CamProxy { x: number; y: number; lz: number; roll: number; __name: string }
export interface CameraMove { at: number; dur: number; ease?: Ease; blur?: boolean }

export interface Camera {
  readonly state: CamProxy;
  /** move to a state (any subset) */
  to(target: Partial<CameraState>, m: CameraMove): Camera;
  /** a slow move that needs no motion blur (holds keep drifting) */
  drift(target: Partial<CameraState>, m: Omit<CameraMove, 'blur'>): Camera;
  /** depth of field: layers `blurPerDepth` px blurred per unit of depth away from `depth` (0 turns it off) */
  focus(depth: number, blurPerDepth: number): Camera;
  /** the screen position of a world point on a layer at depth d, at the current state */
  project(x: number, y: number, depth?: number): [number, number];
  /** the transform a layer at depth d gets now */
  transformFor(depth: number): string;
}

export function camera(film: Film, stage: Stage, init: Partial<CameraState> = {}): Camera {
  const W = stage.width, H = stage.height;
  const rest = { x: W / 2, y: H / 2 };
  const s: CamProxy = { x: init.x ?? rest.x, y: init.y ?? rest.y, lz: Math.log(init.zoom ?? 1), roll: init.roll ?? 0, __name: 'camera' };
  let focusDepth = 1, blurPer = 0;

  const transformFor = (d: number): string => {
    const z = Math.exp(s.lz * d);
    const ox = rest.x + (s.x - rest.x) * d, oy = rest.y + (s.y - rest.y) * d;
    return 'translate(' + (W / 2).toFixed(3) + 'px,' + (H / 2).toFixed(3) + 'px) rotate(' + s.roll.toFixed(4) + 'deg) scale(' + z.toFixed(6) + ') translate(' + (-ox).toFixed(3) + 'px,' + (-oy).toFixed(3) + 'px)';
  };
  const apply = (): void => {
    for (const l of stage.layers.values()) {
      l.el.style.transform = transformFor(l.depth);
      const b = blurPer ? Math.abs(l.depth - focusDepth) * blurPer : 0;
      l.el.style.filter = b > 0.05 ? 'blur(' + b.toFixed(2) + 'px)' : '';
    }
    stage.ground.style.transform = transformFor(Number(stage.ground.dataset['depth'] ?? 0.25));
  };
  film.onRender(apply);

  const tweenTo = (target: Partial<CameraState>, m: CameraMove, blur: boolean): void => {
    const v: Record<string, number> = {};
    if (target.x != null) v['x'] = target.x;
    if (target.y != null) v['y'] = target.y;
    if (target.zoom != null) v['lz'] = Math.log(target.zoom);
    if (target.roll != null) v['roll'] = target.roll;
    film.tl.to(s, { ...v, duration: m.dur, ease: m.ease ?? travel, immediateRender: false, data: { blur: blur && m.blur !== false, role: 'camera' } }, m.at);
  };
  const cam: Camera = {
    state: s,
    to(target, m) { tweenTo(target, m, true); return cam; },
    drift(target, m) { tweenTo(target, { ...m, ease: m.ease ?? travel }, false); return cam; },
    focus(depth, per) { focusDepth = depth; blurPer = per; return cam; },
    project(x, y, d = 1) {
      const z = Math.exp(s.lz * d), r = (s.roll * Math.PI) / 180;
      const ox = rest.x + (s.x - rest.x) * d, oy = rest.y + (s.y - rest.y) * d;
      const dx = (x - ox) * z, dy = (y - oy) * z;
      return [W / 2 + dx * Math.cos(r) - dy * Math.sin(r), H / 2 + dx * Math.sin(r) + dy * Math.cos(r)];
    },
    transformFor
  };
  return cam;
}
