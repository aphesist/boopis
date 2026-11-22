/* The art director's cursor (bone, ink edge, a soft shadow: look/src/scenes/parts.ts) as a key frame draws it, moved by
   offsets from where it rests (U1: slight arcs on `travel`; a press dips it to 0.85 for 4 f and lets go on the settle
   spring; the target reacts on the frame it bottoms out). From `from` on act 2 draws it; before, its act does. */
import type { Film } from '../../engine/film';
import { track } from '../../motion/track';
import { SETTLE, settle, travel, ui, type Ease } from './util';

export interface KfCursor {
  move(dx: number, dy: number, at: number, dur: number, o?: { arc?: number; ease?: Ease }): KfCursor;
  press(at: number): number;
  /** where it is (offset from rest) after its last move */
  readonly last: { x: number; y: number };
}

export function kfCursor(film: Film, el: HTMLElement, from: number, start = { x: 0, y: 0 }): KfCursor {
  const s = { x: start.x, y: start.y, p: 1, __name: 'a2-cursor' };
  let last = { ...start };
  film.onRender((t) => {
    if (t < from - 1e-9) return;
    el.style.transformOrigin = '8% 6%';
    el.style.transform = 'translate(' + s.x.toFixed(2) + 'px,' + s.y.toFixed(2) + 'px) scale(' + s.p.toFixed(4) + ')';
  }, 1);
  const st0 = { ...start };
  track(film, el, { t0: -Infinity, draw: () => { s.x = st0.x; s.y = st0.y; } }, -5);
  const c: KfCursor = {
    get last() { return last; },
    move(dx, dy, at, dur, o = {}) {
      const a = { ...last }, b = { x: dx, y: dy };
      const ddx = b.x - a.x, ddy = b.y - a.y, dist = Math.hypot(ddx, ddy), bend = (o.arc ?? 0.14) * dist;
      const nx = dist ? -ddy / dist : 0, ny = dist ? ddx / dist : 0;
      const p = { k: 0, __name: 'a2-cursor-move' };
      film.tl.fromTo(p, { k: 0 }, { k: 1, duration: dur, ease: o.ease ?? travel, immediateRender: false, data: { role: 'cursor' } }, at);
      track(film, el, { t0: at, draw: () => { const k = p.k, w = Math.sin(Math.PI * k) * bend; s.x = a.x + ddx * k + nx * w; s.y = a.y + ddy * k + ny * w; } }, -5);
      last = b;
      return c;
    },
    press(at) {
      const down = 4 / 60;
      film.tl.fromTo(s, { p: 1 }, { p: 0.85, duration: down, ease: ui, immediateRender: false, data: { role: 'cursor' } }, at);
      film.tl.fromTo(s, { p: 0.85 }, { p: 1, duration: SETTLE, ease: settle, immediateRender: false, data: { role: 'cursor' } }, at + down);
      return at + down;
    }
  };
  return c;
}
