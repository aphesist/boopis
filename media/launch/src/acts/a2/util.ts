/* Act 2's own helpers (the shared motion library is frozen for the act animators): beat time in a cut-down, state that
   hands over cleanly at the incoming seam (S1), measuring through the product's CSS zoom, the product's own durations
   and curves, and small units that come and go together with movement. */
import type { Film } from '../../engine/film';
import type { Stage } from '../../engine/stage';
import type { ActCtx } from '../context';
import { beat } from '../../motion/beats';
import { boxOf, type Box } from '../../motion/carry';
import { arrive, cubicBezier, depart, travel, ui, uiSpring, type Ease } from '../../motion/ease';
import { springDuration, springEase } from '../../motion/spring';

/** S1, the act's incoming seam: before it every element act 1 hands over is act 1's */
export const S1 = 9.6;
/** S2, the act's outgoing seam */
export const S2 = 20;

/* ───────── the product's motion (DESIGN-SYSTEM 11): durations and curves, shown faithfully ───────── */
export const DUR = { press: 0.09, d1: 0.15, out: 0.12, d2: 0.2, slide: 0.24, d3: 0.3 } as const;
export { ui, uiSpring };
/* ───────── the film's motion (craft bible 3) ───────── */
export const CAM = springDuration('camera');
export const camSpring = springEase('camera');
export const SETTLE = springDuration('settle');
export const settle = springEase('settle');
export const CHAR = springDuration('character');
export const character = springEase('character');
export { arrive, depart, travel };
/** a hold's drift: sine in-out, so a held frame keeps moving at a near-even slow speed from end to end (travel would
    bunch the motion in the middle and sit still at both ends) */
export const drift = cubicBezier(0.37, 0, 0.63, 1, 'drift');
/** the camera following the thread: the same sine in-out, so a follow that moves reading content keeps its peak speed
    near 1.6 times its average (a spring or quint would peak at 3 to 5 times, the critique's A2-13) */
export const follow = cubicBezier(0.37, 0, 0.63, 1, 'follow');
export type { Ease };

/** the last frame act 2 draws in this edit: S2 in the master (act 3 takes over); in a cut-down that ends the act on B07,
    the edit's end (the next beat pushes into the folded stack B07 leaves) */
export function actEnd(ctx: ActCtx): number {
  return ctx.has('B08') ? ctx.win('B08').end : ctx.edit.duration;
}

/* ───────── time: a beat's builder writes master times; a cut-down plays the beat in its own window ───────── */
export interface Tm {
  /** a master (script) time inside the beat, on this edit's clock */
  t(x: number): number;
  /** a master duration on this edit's clock (never longer than the master's) */
  d(x: number): number;
  start: number; end: number; k: number;
}
export function tmap(ctx: ActCtx, id: string): Tm {
  const m = beat(id), w = ctx.win(id);
  const k = Math.min(1, w.dur / m.dur);
  const snap = (x: number): number => Math.round(x * 60) / 60;
  return { t: (x) => (k === 1 ? snap(x + (w.start - m.start)) : snap(w.start + (x - m.start) * k)), d: (x) => x * k, start: w.start, end: w.end, k };
}

/* ───────── state that crosses the incoming seam ─────────
   Act 1 owns its elements before S1. Every renderer here writes a value only from `from` on; before it, the value it
   found at build time goes back (priority -12, so act 1's own renderers, at -11 and later, still decide there). */
export function own(film: Film, from: number, write: (t: number) => void, restore: () => void, priority = -10): void {
  film.onRender((t) => { if (t < from - 1e-9) restore(); }, -12);
  film.onRender((t) => { if (t >= from - 1e-9) write(t); }, priority);
}
/** visibility from `from` on (on(t)); before it, what act 1 left */
export function visFrom(film: Film, el: HTMLElement | SVGElement, from: number, on: (t: number) => boolean): void {
  const was = el.style.visibility;
  const set = (v: string): void => { if (el.style.visibility !== v) el.style.visibility = v; };
  own(film, from, (t) => set(on(t) ? 'visible' : 'hidden'), () => set(was));
}
/** a style property from `from` on; before it, what act 1 left */
export function styleFrom(film: Film, el: HTMLElement | SVGElement, prop: string, from: number, value: (t: number) => string, priority = -10): void {
  const was = el.style.getPropertyValue(prop);
  const set = (v: string): void => { if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v); };
  own(film, from, (t) => set(value(t)), () => set(was), priority);
}
/** an attribute from `from` on (null removes it); before it, what act 1 left */
export function attrFrom(film: Film, el: Element, name: string, from: number, value: (t: number) => string | null, priority = 1): void {
  const was = el.getAttribute(name);
  const set = (v: string | null): void => { if (el.getAttribute(name) === v) return; if (v == null) el.removeAttribute(name); else el.setAttribute(name, v); };
  film.onRender((t) => { if (t < from - 1e-9) set(was); }, -12);
  film.onRender((t) => { if (t >= from - 1e-9) set(value(t)); }, priority);
}
/** my own element: drawn only while every on(t) given for it holds (a hard switch, used only where both sides draw the
    same pixels or nothing) */
const visRules = new WeakMap<Element, Array<(t: number) => boolean>>();
export function vis(film: Film, el: HTMLElement | SVGElement, on: (t: number) => boolean, priority = -10): void {
  let rules = visRules.get(el);
  if (rules) { rules.push(on); return; }
  const list: Array<(t: number) => boolean> = [on];
  rules = list;
  visRules.set(el, list);
  film.onRender((t) => { const v = list.every((f) => f(t)) ? '' : 'hidden'; if (el.style.visibility !== v) el.style.visibility = v; }, priority);
}
export const within = (a: number, b = Infinity) => (t: number): boolean => t >= a - 1e-9 && t < b - 1e-9;

/* ───────── measuring (at build time, before the camera moves any layer) ───────── */
export const box = (el: Element, stage: Stage): Box => boxOf(el, stage);
/** a rectangle in an element's own CSS px (inside a CSS zoom) from a world box */
export function local(el: HTMLElement, world: Box, stage: Stage): Box {
  const r = boxOf(el, stage), z = el.offsetWidth ? r.w / el.offsetWidth : 1;
  return { x: (world.x - r.x) / z, y: (world.y - r.y) / z, w: world.w / z, h: world.h / z };
}
/** the scale from an element's CSS px to world px */
export function zoomOf(el: HTMLElement, stage: Stage): number {
  const w = el.offsetWidth;
  return w ? boxOf(el, stage).w / w : 1;
}
export const mid = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

/* ───────── small units ───────── */
/** a small element (a word, a line, an orb, a chip) arrives: up `y` px and in, together (the product's 6 px rise) */
export function riseIn(film: Film, el: HTMLElement | SVGElement, at: number, o: { dur?: number; y?: number; ease?: Ease; scale?: number } = {}): void {
  const y = o.y ?? 6;
  film.tl.fromTo(el, { opacity: 0, y, scale: o.scale ?? 1 }, { opacity: 1, y: 0, scale: 1, duration: o.dur ?? DUR.d2, ease: o.ease ?? ui, immediateRender: true, data: { role: 'ui' } }, at);
}
/** a small element leaves: down `y` px and out (the product's exit, --dur-out) */
export function leaveOut(film: Film, el: HTMLElement | SVGElement, at: number, o: { dur?: number; y?: number; ease?: Ease; scale?: number } = {}): void {
  film.tl.fromTo(el, { opacity: 1, y: 0, scale: 1 }, { opacity: 0, y: o.y ?? 4, scale: o.scale ?? 1, duration: o.dur ?? DUR.out, ease: o.ease ?? ui, immediateRender: false, data: { role: 'ui' } }, at);
}

/** a small element leaves as the product's presence does: a shrink and out (--dur-out) */
export function shrinkOut(film: Film, el: HTMLElement | SVGElement, at: number, o: { dur?: number; scale?: number } = {}): void {
  film.tl.fromTo(el, { opacity: 1, scale: 1, transformOrigin: '0% 50%' }, { opacity: 0, scale: o.scale ?? 0.9, duration: o.dur ?? DUR.out, ease: ui, immediateRender: false, data: { role: 'ui' } }, at);
}

/** CSS for the act's own pieces (tokens only) */
let cssIn = false;
export function a2css(): void {
  if (cssIn) return;
  cssIn = true;
  const s = document.createElement('style');
  s.dataset['act'] = 'a2';
  s.textContent = `
.a2-scroller { position: absolute; left: 0; top: 0; width: 2400px; height: 9000px; pointer-events: none; }
.a2-room { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.a2-phbar { position: absolute; display: block; pointer-events: none; }
.film-line .sel[data-a2-sweep]::before { clip-path: inset(0 calc((1 - var(--a2-k, 1)) * 100%) 0 0); }
.film-line .sel[data-a2-sweep]::after { transform: translateX(calc((var(--a2-k, 1) - 1) * var(--a2-w, 0px))); opacity: calc(var(--a2-k, 1) * 20); }
.a2-type { position: absolute; white-space: pre; }
.a2-spine.bt-hmsg::after { transform-origin: 50% 0; transform: scaleY(var(--a2-sp, 1)); }
.a2-card { position: absolute; border-radius: 0; }
`;
  document.head.appendChild(s);
}

/* ───────── tokens, resolved where a value has to be computed (a shadow that grows with a fold) ───────── */
/** a custom property's value as the page resolves it on `el` (the light theme's own) */
export function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
/** a shadow list with every colour's alpha times k (the token's own shape and colours, its strength scaled) */
export function scaleShadow(shadow: string, k: number): string {
  return shadow.replace(/rgba?\(([^)]+)\)/g, (_, a: string) => {
    const p = a.split(',').map((x) => x.trim());
    const al = p.length > 3 ? parseFloat(p[3]!) : 1;
    return 'rgba(' + p[0] + ', ' + p[1] + ', ' + p[2] + ', ' + (al * k).toFixed(4) + ')';
  });
}
