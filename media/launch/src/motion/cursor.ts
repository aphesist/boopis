/* The cursor (craft bible U1): oversized (48 px tall at 1080p), a soft shadow, moving on `travel` along a slight arc
   (never a straight line), arriving 4 to 6 frames before it acts. A press: it dips to 0.85 for 4 frames and comes back
   on the settle spring; the target responds on the frame the cursor bottoms out (`press()` returns that time).

     const c = cursor(film, stage.layer('front', 1.25), { x: 1500, y: 900 })
     c.move(1210, 640, { at, dur: g.f(28) })
     const hit = c.press(at + g.f(32))       // react to the click at `hit`

   The cursor is never popped in: it enters from outside the frame (`from` off-screen) or is already on screen.

   Its tweens ask the renderer for sub-frames: a 48 px arrow is a tiny share of the frame, so without the ask the
   renderer's slow-motion shortcut (the shutter's two ends averaged) would draw two cursors instead of a streak. */
import type { Film } from '../engine/film';
import { travel, ui, type Ease } from './ease';
import { springDuration, springEase } from './spring';
import { track } from './track';

/** sub-frames (at --samples 8) for a move: on `travel` the peak speed is about 5 times the mean, so a 700 px move in
    1 s crosses about 29 px under a 180 degree shutter; 16 keeps the streak's steps under 2 px */
export const CURSOR_MOVE_SAMPLES = 16;
/** for a press: the dip to 0.85 is slow and short, 12 is plenty */
export const CURSOR_PRESS_SAMPLES = 12;

const ARROW = '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><path d="M8 4 L8 38 L17 29.5 L23.5 44 L29.5 41.4 L23.2 27.2 L35 27.2 Z" fill="#fff" stroke="#111" stroke-width="2.4" stroke-linejoin="round"/></svg>';

export interface Cursor {
  el: HTMLElement;
  move(x: number, y: number, o: { at: number; dur: number; ease?: Ease; arc?: number }): Cursor;
  /** returns the time the cursor bottoms out (the target reacts on that frame) */
  press(at: number): number;
}

export function cursor(film: Film, layer: HTMLElement, start: { x: number; y: number }, o: { size?: number } = {}): Cursor {
  const el = document.createElement('div');
  el.className = 'film-cursor';
  el.innerHTML = ARROW;
  const size = o.size ?? 48;
  el.style.width = el.style.height = size + 'px';
  el.querySelector('svg')!.setAttribute('width', String(size));
  el.querySelector('svg')!.setAttribute('height', String(size));
  layer.appendChild(el);
  const s = { x: start.x, y: start.y, press: 1, __name: 'cursor' };
  let last = { x: start.x, y: start.y };
  const tip = (8 / 48) * size, tipY = (4 / 48) * size;
  track(film, el, { t0: -Infinity, draw: () => { s.x = start.x; s.y = start.y; } }, -5);
  film.onRender(() => {
    el.style.transform = 'translate(' + (s.x - tip).toFixed(3) + 'px,' + (s.y - tipY).toFixed(3) + 'px) scale(' + s.press.toFixed(4) + ')';
  });
  const c: Cursor = {
    el,
    move(x, y, m) {
      const from = last, to = { x, y };
      const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
      const arc = (m.arc ?? 0.12) * dist, nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
      const p = { k: 0, __name: 'cursor-move' };
      film.tl.fromTo(p, { k: 0 }, { k: 1, duration: m.dur, ease: m.ease ?? travel, data: { role: 'cursor', samples: CURSOR_MOVE_SAMPLES } }, m.at);
      track(film, el, {
        t0: m.at,
        draw: () => {
          const t = p.k, bend = Math.sin(Math.PI * t) * arc;
          s.x = from.x + dx * t + nx * bend; s.y = from.y + dy * t + ny * bend;
        }
      }, -5);
      last = to;
      return c;
    },
    press(at) {
      const down = 4 / film.fps;
      film.tl.fromTo(s, { press: 1 }, { press: 0.85, duration: down, ease: ui, immediateRender: false, data: { role: 'cursor', samples: CURSOR_PRESS_SAMPLES } }, at);
      film.tl.to(s, { press: 1, duration: springDuration('settle'), ease: springEase('settle'), immediateRender: false, data: { role: 'cursor', samples: CURSOR_PRESS_SAMPLES } }, at + down);
      return at + down;
    }
  };
  return c;
}
