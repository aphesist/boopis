/* Act 4's shared helpers: the act's own clock-driven pieces that the motion library does not have (a screen-space
   layer for what must not move with the camera, visibility windows that leave other acts' time alone, the lamp, the
   product's own curves by name, and the oversized cursor in screen space so it can follow a target through a camera
   move). Everything is a pure function of time: tweens on proxies with named eases, and renderers. */
import type { Film } from '../../engine/film';
import type { Stage } from '../../engine/stage';
import type { ActCtx } from '../context';
import type { Camera, CameraState } from '../../motion/camera';
import { cubicBezier, type Ease } from '../../motion/ease';
import { springEase, springDuration, type SpringDef } from '../../motion/spring';
import { track } from '../../motion/track';

/* ───────── curves ───────── */

/** the dock's morph springs: critically damped at omega ~22 (apps/desktop/ui/src/modules/dock/ctx.ts K_SLAB = K_FLIP = 480) */
export const DOCK: SpringDef = { stiffness: 480, damping: 2 * Math.sqrt(480) };
export const dockEase: Ease = springEase(DOCK);
export const dockDur = springDuration(DOCK);
/** the product's --ease, as cubic-bezier(.2,.8,.2,1) (the kit's own name for it is `ui`) */
export const uiEase: Ease = cubicBezier(0.2, 0.8, 0.2, 1, 'ui');
/** the hold's own fill curve (components/hold.ts holdEase): x in 0..1 of the 1000 ms */
export const holdEase: Ease = Object.assign((x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 1.2)), { easeName: 'hold' });
/** the logo's own face morph curve (vendor/boopis-logo.js easeMorph): a quintic and a cushion */
const smooth5 = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
export const logoMorph: Ease = Object.assign((x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : 0.45 * smooth5(x) + 0.55 * (1 - Math.pow(1 - x, 3.4))), { easeName: 'logo-morph' });

/** a proxy whose `k` goes 0 to 1 on an ease over [at, at + dur]: the timeline knows it, a renderer reads it */
export function prog(film: Film, at: number, dur: number, ease: Ease, name = 'a4', data: Record<string, unknown> = {}): { k: number } {
  const p = { k: 0, __name: name };
  film.tl.fromTo(p, { k: 0 }, { k: 1, duration: dur, ease, data: { role: name, ...data } }, at);
  return p;
}
export const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ───────── visibility ───────── */

/** el is drawn only in [t0, t1) of this act's time: before `from` (the act's first frame) it is left alone, so an
    element another act also shows keeps its own windows there. `cut` adds hard cuts at the ends (a real picture change) */
export function onlyIn(film: Film, el: HTMLElement | SVGElement, t0: number, t1: number, o: { from?: number; cut?: boolean } = {}): void {
  const from = o.from ?? -Infinity;
  film.onRender((t) => {
    if (t < from - 1e-9) return;
    const on = t >= t0 - 1e-9 && t < t1 - 1e-9;
    const v = on ? 'visible' : 'hidden';
    if (el.style.visibility !== v) el.style.visibility = v;
  }, -10);
  if (o.cut) { if (Number.isFinite(t0)) film.cut(t0); if (Number.isFinite(t1)) film.cut(t1); }
}

/* ───────── the screen layer: fixed to the frame, under the grain ───────── */

export interface ScreenLayer { el: HTMLElement; drift: { s: number; x: number; y: number } }
const screens = new WeakMap<Stage, ScreenLayer>();
/** a box fixed to the frame (the camera does not move it), with its own slow drift (scale about the frame's centre) */
export function screenLayer(film: Film, stage: Stage): ScreenLayer {
  let s = screens.get(stage);
  if (!s) {
    const el = document.createElement('div');
    el.className = 'a4-screen';
    el.style.cssText = 'position:absolute;left:0;top:0;width:' + stage.width + 'px;height:' + stage.height + 'px;transform-origin:50% 50%';
    stage.screen.prepend(el);
    const drift = { s: 1, x: 0, y: 0, __name: 'a4-screen-drift' };
    film.onRender(() => { el.style.transform = 'translate(' + drift.x.toFixed(3) + 'px,' + drift.y.toFixed(3) + 'px) scale(' + drift.s.toFixed(6) + ')'; }, 9);
    s = { el, drift };
    screens.set(stage, s);
  }
  return s;
}

/* ───────── the lamp ───────── */

/** a state of the light pool, in the frame's terms: centre and size as fractions of the frame, and its tint (a token or
    a color-mix of tokens: look.md section 1) */
export interface Lamp { x: number; y: number; w: number; h: number; tint: string; at: number; dur: number; ease: Ease }
/** drive the look's ground (lookGround's .ground, which sits at -40% inset in the ground layer) from `from` on: each lamp
    is reached from the one before on its ease. The pool is placed for the camera as it will be when the lamp lands, so it
    rides the ground's parallax while the camera travels. */
export function lamps(ctx: ActCtx, from: number, list: Lamp[]): void {
  const g = ctx.stage.ground.firstElementChild as HTMLElement | null;
  if (!g || !list.length) return;
  const W = ctx.stage.width, H = ctx.stage.height;
  const toGround = (l: Lamp, st: CameraState): [number, number, number, number] => {
    const z = Math.pow(st.zoom, 0.25);
    const ox = W / 2 + (st.x - W / 2) * 0.25, oy = H / 2 + (st.y - H / 2) * 0.25;
    const gx = ox + (l.x * W - W / 2) / z, gy = oy + (l.y * H - H / 2) / z;
    /* the .ground box spans -0.4 .. 1.4 of the layer: percentages of 1.8 x the frame */
    return [((gx + 0.4 * W) / (1.8 * W)) * 100, ((gy + 0.4 * H) / (1.8 * H)) * 100, (l.w / 1.8 / z) * 100, (l.h / 1.8 / z) * 100];
  };
  const keys = list.map((l) => ({ l, g: toGround(l, ctx.cam.stateAt(l.at + l.dur)), p: prog(ctx.film, l.at, l.dur, l.ease, 'lamp', { blur: false }) }));
  ctx.film.onRender((t) => {
    if (t < from - 1e-9) return;
    let i = 0;
    for (let j = 0; j < keys.length; j++) if (keys[j]!.l.at <= t + 1e-9) i = j;
    const cur = keys[i]!, prev = keys[Math.max(0, i - 1)]!;
    const k = i === 0 ? 1 : cur.p.k;
    const v = cur.g.map((c, n) => lerp(prev.g[n]!, c, k));
    g.style.setProperty('--pool-x', v[0]!.toFixed(3) + '%');
    g.style.setProperty('--pool-y', v[1]!.toFixed(3) + '%');
    g.style.setProperty('--pool-w', v[2]!.toFixed(3) + '%');
    g.style.setProperty('--pool-h', v[3]!.toFixed(3) + '%');
    const tint = k >= 1 || i === 0 ? cur.l.tint : 'color-mix(in oklab, ' + prev.l.tint + ' ' + ((1 - k) * 100).toFixed(2) + '%, ' + cur.l.tint + ')';
    g.style.setProperty('--pool-tint', tint);
  }, 1);
}
export const TINT = {
  cool: 'color-mix(in oklab, var(--text) 9%, var(--bg-2))',
  red: 'color-mix(in oklab, var(--red) 13%, var(--bg-3))',
  redClose: 'color-mix(in oklab, var(--red) 10%, var(--bg-3))',
  orbs: 'var(--bg-4)',
  ui: 'var(--bg-3)'
};

/* ───────── the cursor, in screen space ───────── */

/** where the cursor points: a world point (it follows the camera) or a point of the frame */
export type Aim = { world: [number, number] } | { screen: [number, number] };
export interface ScreenCursor {
  el: HTMLElement;
  /** travel to an aim on a slight arc; a world aim is followed through any camera move (craft bible U5) */
  move(to: Aim, o: { at: number; dur: number; ease?: Ease; arc?: number }): ScreenCursor;
  /** the cursor dips to 0.85 for 4 frames and comes back on the settle spring (or holds down until `release`) */
  press(at: number, release?: number): number;
}
/** the art director's cursor (the look's bone arrow, look/src/scenes/parts.ts) in the screen layer: its tip is the
    point; its size follows the camera's zoom as zoom^0.585 (48 px at rest, 1.9x at the hold's close-up: board B16) */
export function screenCursor(film: Film, layer: HTMLElement, src: HTMLElement, cam: Camera, start: [number, number]): ScreenCursor {
  const el = src;
  el.remove();
  el.style.cssText = 'position:absolute;left:0;top:0;width:48px;height:59px;transform-origin:0 0;z-index:30;filter:drop-shadow(0 4px 12px rgba(0,0,0,.25))';
  layer.appendChild(el);
  const s = { x: start[0], y: start[1], press: 1, __name: 'a4-cursor' };
  let last: Aim = { screen: start };
  const live = (): CameraState => ({ x: cam.state.x, y: cam.state.y, zoom: Math.exp(cam.state.lz), roll: cam.state.roll });
  const at = (a: Aim, st: CameraState): [number, number] => ('screen' in a ? a.screen : cam.project(a.world[0], a.world[1], 1, st));
  track(film, el, { t0: -Infinity, draw: () => { s.x = start[0]; s.y = start[1]; } }, 5);
  film.onRender(() => {
    const z = Math.exp(cam.state.lz), k = Math.pow(z, 0.585) * s.press;
    /* the arrow's tip is at (2/26, 2/32) of its box */
    el.style.transform = 'translate(' + (s.x - 48 * k * (2 / 26)).toFixed(2) + 'px,' + (s.y - 59 * k * (2 / 32)).toFixed(2) + 'px) scale(' + k.toFixed(4) + ')';
  }, 11);
  const c: ScreenCursor = {
    el,
    move(to, m) {
      /* where it starts on the frame: its last aim as the camera stands when this move begins */
      const a = at(last, cam.stateAt(m.at));
      const p = { k: 0, __name: 'a4-cursor-move' };
      film.tl.fromTo(p, { k: 0 }, { k: 1, duration: m.dur, ease: m.ease ?? cubicBezier(0.83, 0, 0.17, 1, 'travel'), data: { role: 'cursor' } }, m.at);
      track(film, el, {
        t0: m.at,
        draw: () => {
          const b = at(to, live());
          const dx = b[0] - a[0], dy = b[1] - a[1], dist = Math.hypot(dx, dy);
          const arc = (m.arc ?? 0.12) * dist, nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
          const bend = Math.sin(Math.PI * p.k) * arc;
          s.x = a[0] + dx * p.k + nx * bend; s.y = a[1] + dy * p.k + ny * bend;
        }
      }, 5);
      last = to;
      return c;
    },
    press(at, release) {
      const down = 4 / film.fps;
      film.tl.fromTo(s, { press: 1 }, { press: 0.85, duration: down, ease: uiEase, immediateRender: false, data: { role: 'cursor' } }, at);
      film.tl.to(s, { press: 1, duration: springDuration('settle'), ease: springEase('settle'), immediateRender: false, data: { role: 'cursor' } }, release ?? at + down);
      return at + down;
    }
  };
  return c;
}
