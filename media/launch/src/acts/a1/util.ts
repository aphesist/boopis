/* Act 1's own helpers (the shared motion library is frozen for the act animators): beat time in a cut-down, visibility
   that hands over cleanly at the seam, structure-keeping word units for the art director's film lines, the selection
   sweep, zoom-aware moves for kit components, the shared ground's light pool, and the key frame's own cursor. */
import type { Film } from '../../engine/film';
import type { Stage } from '../../engine/stage';
import type { ActCtx } from '../context';
import { beat } from '../../motion/beats';
import { boxOf, type Box } from '../../motion/carry';
import { arrive, depart, travel, ui, type Ease } from '../../motion/ease';
import { springDuration, springEase } from '../../motion/spring';
import { track } from '../../motion/track';

/** S1, the act's outgoing seam (SEAMS.md): every renderer here writes its own state before it and hands over after it */
export const SEAM = 9.6;

/* ───────── time: a beat's builder writes master times; a cut-down plays the beat in its own window ───────── */
export interface Tm {
  /** a master (script) time inside the beat, on this edit's clock */
  t(x: number): number;
  /** a master duration on this edit's clock */
  d(x: number): number;
  /** the beat's window on this edit's clock */
  start: number; end: number;
  /** this edit's speed against the master (1 in the master) */
  k: number;
}
export function tmap(ctx: ActCtx, id: string): Tm {
  const m = beat(id), w = ctx.win(id);
  const k = w.dur / m.dur;
  const snap = (x: number): number => Math.round(x * 60) / 60;
  return { t: (x) => (k === 1 ? x + (w.start - m.start) : snap(w.start + (x - m.start) * k)), d: (x) => x * k, start: w.start, end: w.end, k };
}

/* ───────── visibility ─────────
   `on(t)` decides while the act owns the element (t < until); from `until` on the element is left at `after` by a
   renderer that runs before every other act's (priority -11), so a later act can still hide or show it. Never an
   opacity: a hard switch, used only where the two sides of the switch draw the same pixels (a swap) or nothing. */
export function vis(film: Film, el: HTMLElement | SVGElement, on: (t: number) => boolean, o: { until?: number; after?: boolean } = {}): void {
  const until = o.until ?? SEAM, after = o.after ?? false;
  const set = (v: boolean): void => { const want = v ? '' : 'hidden'; if (el.style.visibility !== want) el.style.visibility = want; };
  film.onRender((t) => { if (t >= until - 1e-9) set(after); }, -11);
  film.onRender((t) => { if (t < until - 1e-9) set(on(t)); }, -9);
}
export const between = (a: number, b: number) => (t: number): boolean => t >= a - 1e-9 && t < b - 1e-9;

/* ───────── motion blur ─────────
   The renderer takes every sub-frame only where the page asks, or where the shutter's two ends differ over a good share
   of the frame; small fast things (an orb's eyes, the cursor, a chip) differ over a tiny share and would get the two
   ends only: a double image. A beat asks for full sampling over its whole window. */
export function sampleAll(film: Film, t0: number, t1: number, n = 10): void { film.motion(t0, t1, n); }

/* ───────── measuring ───────── */
export const centre = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
/** an element's own CSS px to world px (the product's components sit inside a CSS zoom) */
export function zoomOf(el: HTMLElement, stage: Stage): number {
  const w = el.offsetWidth;
  return w ? boxOf(el, stage).w / w : 1;
}

/* ───────── film lines ─────────
   The art director's film line keeps its inner structure (the lab marks, the selection with its caret): each word, or
   each inline element, becomes one unit (an inline-block span) that K1 moves, without retyping the line. */
export function wordUnits(line: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const n of [...line.childNodes]) {
    if (n.nodeType === Node.TEXT_NODE) {
      const parts = (n.textContent ?? '').split(/(\s+)/);
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); continue; }
        const s = document.createElement('span');
        s.className = 'a1-w'; s.textContent = p;
        frag.appendChild(s); out.push(s);
      }
      n.replaceWith(frag);
    } else if (n instanceof HTMLElement && n.tagName !== 'BR') {
      const s = document.createElement('span');
      s.className = 'a1-w';
      n.replaceWith(s); s.appendChild(n); out.push(s);
    }
  }
  return out;
}
/** K1 (craft bible 4): each unit y +32 to 0, blur 8 to 0, opacity 0 to 1 over 20 f on arrive, 4 f apart; returns the
    time the last unit lands. Words are small units, so the opacity is allowed with the movement. */
export function k1(film: Film, units: HTMLElement[], at: number, o: { dur?: number; stagger?: number } = {}): number {
  const dur = o.dur ?? 20 / 60, st = o.stagger ?? 4 / 60;
  units.forEach((u, i) => film.tl.fromTo(u, { y: 32, filter: 'blur(8px)', opacity: 0 }, { y: 0, filter: 'blur(0px)', opacity: 1, duration: dur, ease: arrive, immediateRender: true, data: { role: 'type' } }, at + i * st));
  return at + (units.length - 1) * st + dur;
}
/** when the last word lands: the start for a K1 entrance of n units that lands at `land` */
export const k1Start = (land: number, n: number, dur = 20 / 60, st = 4 / 60): number => Math.round((land - dur - (n - 1) * st) * 60) / 60;
/** K1 exit: the whole line up 16 px with blur, 12 f on depart, never word by word: every word on the same frames, so the
    line leaves as one (the words are the targets, each a small unit; the line's own box spans the frame's width) */
export function k1Exit(film: Film, units: HTMLElement[], at: number, dur = 12 / 60): void {
  film.tl.fromTo(units, { y: 0, filter: 'blur(0px)', opacity: 1 }, { y: -16, filter: 'blur(6px)', opacity: 0, duration: dur, ease: depart, immediateRender: false, data: { role: 'type' } }, at);
}

/* the selection (look.md 3): the product's own text selection sweeps in behind the accent word (10 f on arrive, K7),
   and the brass caret lands at its end. The art director's .sel draws both as pseudo-elements; these variables drive
   them. */
const SEL_CSS = `
.a1-sel::before { transform: scaleX(var(--a1-sel, 1)); transform-origin: 0 50%; }
.a1-sel[data-caret]::after { opacity: var(--a1-caret, 1); transform: scaleY(var(--a1-caret, 1)); transform-origin: 50% 100%; }
.a1-w { display: inline-block; }
`;
let cssIn = false;
export function a1css(extra = ''): void {
  if (!cssIn) { const s = document.createElement('style'); s.dataset['a1'] = ''; s.textContent = SEL_CSS; document.head.appendChild(s); cssIn = true; }
  if (extra) { const s = document.createElement('style'); s.textContent = extra; document.head.appendChild(s); }
}
export function selSweep(film: Film, sel: HTMLElement, at: number): number {
  a1css();
  sel.classList.add('a1-sel');
  sel.style.setProperty('--a1-sel', '0'); sel.style.setProperty('--a1-caret', '0');
  film.tl.fromTo(sel, { '--a1-sel': 0 }, { '--a1-sel': 1, duration: 10 / 60, ease: arrive, immediateRender: false, data: { role: 'type' } }, at);
  film.tl.fromTo(sel, { '--a1-caret': 0 }, { '--a1-caret': 1, duration: 6 / 60, ease: arrive, immediateRender: false, data: { role: 'type' } }, at + 7 / 60);
  return at + 13 / 60;
}

/* ───────── springs as tween parts ───────── */
export const SETTLE = springDuration('settle');
export const CHAR = springDuration('character');
export const CAM = springDuration('camera');
export const settle = springEase('settle');
export const camSpring = springEase('camera');
export const character = springEase('character');

/* ───────── the light pool ─────────
   A key frame states its lamp on its own 1920x1080 box (--pool-x/y/w/h in % of the frame, --pool the centre tone). The
   film's ground (engine/look.ts) is one box at inset -40% behind the camera; these convert a frame's pool to a box at
   any inset, so the same ellipse lands on the same pixels. */
export interface Pool { x: number; y: number; w: number; h: number; tint: string }
export function poolOf(kf: HTMLElement): Pool {
  const n = (k: string, d: number): number => { const v = parseFloat(kf.style.getPropertyValue(k)); return Number.isFinite(v) ? v : d; };
  const raw = kf.style.getPropertyValue('--pool').trim() || 'var(--bg-4)';
  return { x: n('--pool-x', 50), y: n('--pool-y', 58), w: n('--pool-w', 62), h: n('--pool-h', 72), tint: resolveColour(raw) };
}
export function poolVars(p: Pool, inset: number): Record<string, string> {
  const span = 1 + 2 * inset, pc = (v: number): string => (v / span).toFixed(4) + '%';
  return { '--pool-x': (((inset * 100 + p.x) / span)).toFixed(4) + '%', '--pool-y': (((inset * 100 + p.y) / span)).toFixed(4) + '%', '--pool-w': pc(p.w), '--pool-h': pc(p.h), '--pool-tint': p.tint };
}
export function setVars(el: HTMLElement, v: Record<string, string>): void { for (const [k, x] of Object.entries(v)) el.style.setProperty(k, x); }
/** a token or any CSS colour as rgb(), so GSAP can interpolate it */
export function resolveColour(c: string): string {
  const s = document.createElement('span');
  s.style.color = c; s.style.display = 'none';
  document.body.appendChild(s);
  const v = getComputedStyle(s).color;
  s.remove();
  return v || 'rgb(46, 43, 39)';
}
/** tween the ground's pool from one key frame's lamp to another's */
export function poolTo(film: Film, ground: HTMLElement, from: Pool, to: Pool, at: number, dur: number, ease: Ease = travel): void {
  film.tl.fromTo(ground, poolVars(from, 0.4), { ...poolVars(to, 0.4), duration: dur, ease, immediateRender: false, data: { role: 'ground', blur: false } }, at);
}

/* ───────── the key frame's own cursor ─────────
   The art director's cursor (bone, ink edge, a soft shadow) stays where the key frame draws it at rest; these moves
   are offsets from that rest, on slight arcs (U1), and a press dips it to 0.85 for 4 f and lets go on the settle
   spring. Offset 0 is the key frame. */
export interface KfCursor { from(x: number, y: number): KfCursor; move(x: number, y: number, at: number, dur: number, arc?: number): KfCursor; press(at: number): number }
export function kfCursor(film: Film, el: HTMLElement, rest: { x: number; y: number }): KfCursor {
  const s = { x: 0, y: 0, p: 1, __name: 'a1-cursor' };
  let last = { x: 0, y: 0 };
  el.style.transformOrigin = '8% 6%';
  /* the individual translate and scale properties, not transform: from the seam on they rest at zero and one, so the
     next act can move the same cursor with its own transform */
  film.onRender(() => { el.style.translate = s.x.toFixed(2) + 'px ' + s.y.toFixed(2) + 'px'; el.style.scale = s.p.toFixed(4); });
  const c: KfCursor = {
    from(x, y) {
      last = { x: x - rest.x, y: y - rest.y };
      const l = { ...last };
      track(film, el, { t0: -Infinity, draw: () => { s.x = l.x; s.y = l.y; } }, -5);
      return c;
    },
    move(x, y, at, dur, arc = 0.14) {
      const a = { ...last }, b = { x: x - rest.x, y: y - rest.y };
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), bend = arc * dist;
      const nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
      const p = { k: 0, __name: 'a1-cursor-move' };
      film.tl.fromTo(p, { k: 0 }, { k: 1, duration: dur, ease: travel, data: { role: 'cursor' } }, at);
      track(film, el, { t0: at, draw: () => { const k = p.k, w = Math.sin(Math.PI * k) * bend; s.x = a.x + dx * k + nx * w; s.y = a.y + dy * k + ny * w; } }, -5);
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
