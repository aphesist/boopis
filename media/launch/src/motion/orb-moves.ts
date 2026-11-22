/* What a film orb does, as tweens of its pose (engine/orb.ts). The orb's own timings where the product has them:
   a blink is orb2's 0.155 s on its own curve, eye morphs are orb2's own face morph (0.38 s in the app), glances use
   the character spring (craft bible: the mark and the bots' faces are the only things that may overshoot).

     blink(film, orb, at)                         one blink (orb2's curve and length)
     glance(film, orb, at, yaw, pitch)            the eyes look somewhere (degrees), on the character spring
     eyes(film, orb, at, 'arc')                   the eyes morph to another shape (orb2's face morph)
     shape(film, orb, at, 'squircle')             the body morphs to another silhouette
     colour(film, orb, at, '#f5a337')             the fill changes colour (opaque, never a fade)
     life(film, orb, t0, t1, seed)                a seeded idle life between t0 and t1: glances and blinks, like
                                                  orb2's calm idle director, but a pure function of time
     orbMark(film, orb, { mark, toMark, toOrb })  the orb's body splits into the boopis mark's two eyes (and back) */
import type { Film } from '../engine/film';
import { FilmOrb, defaultPose, mixColour, ptsToD, type OrbPose, type Pt } from '../engine/orb';
import type { MarkGeometry } from '../engine/logo';
import { rng } from '../engine/rng';
import { travel, type Ease } from './ease';
import { springEase, springDuration } from './spring';
import { interpolate } from 'flubber';

export const BLINK = 0.155;
const ORB_MORPH = 0.38;

/* orb2's blink: closed = pow(sin(pi p), 0.82) over 0.155 s, as two halves so each tween ends exactly where it says */
const blinkClose = Object.assign((q: number): number => (q <= 0 ? 0 : q >= 1 ? 1 : Math.pow(Math.sin((Math.PI * q) / 2), 0.82)), { easeName: 'orb-blink-close' });
const blinkOpen = Object.assign((q: number): number => (q <= 0 ? 0 : q >= 1 ? 1 : 1 - Math.pow(Math.cos((Math.PI * q) / 2), 0.82)), { easeName: 'orb-blink-open' });
export function blink(film: Film, orb: FilmOrb, at: number): void {
  film.tl.fromTo(orb.pose, { blink: 0 }, { blink: 1, duration: BLINK / 2, ease: blinkClose, immediateRender: false, data: { role: 'orb' } }, at);
  film.tl.fromTo(orb.pose, { blink: 1 }, { blink: 0, duration: BLINK / 2, ease: blinkOpen, immediateRender: false, data: { role: 'orb' } }, at + BLINK / 2);
}

export function glance(film: Film, orb: FilmOrb, at: number, yaw: number, pitch: number, o: { dur?: number; ease?: Ease } = {}): void {
  const ease = o.ease ?? springEase('character');
  film.tl.to(orb.pose, { yaw, pitch, duration: o.dur ?? springDuration('character'), ease, immediateRender: false, data: { role: 'orb' } }, at);
}

/** morph the eyes from the shape they have at `at` to `to` */
export function eyes(film: Film, orb: FilmOrb, at: number, to: string, o: { dur?: number; ease?: Ease } = {}): void {
  /* the shape they have then: what the latest earlier eye morph left */
  const from = eyeState(orb, at);
  film.tl.set(orb.pose, { eyes: from, eyesTo: to, eyesMix: 0 }, at);
  film.tl.to(orb.pose, { eyesMix: 1, duration: o.dur ?? ORB_MORPH, ease: o.ease ?? travel, immediateRender: false, data: { role: 'orb' } }, at);
  recordEyes(orb, at, to);
}
const eyeLog = new WeakMap<FilmOrb, [number, string][]>();
function eyeState(orb: FilmOrb, at: number): string {
  const log = eyeLog.get(orb) ?? [];
  let s = orb.pose.eyesMix >= 1 && orb.pose.eyesTo ? orb.pose.eyesTo : orb.pose.eyes;
  for (const [t, e] of log) if (t <= at) s = e;
  return s;
}
function recordEyes(orb: FilmOrb, at: number, to: string): void {
  const log = eyeLog.get(orb) ?? [];
  log.push([at, to]); log.sort((a, b) => a[0] - b[0]);
  eyeLog.set(orb, log);
}

export function shape(film: Film, orb: FilmOrb, at: number, to: string, o: { dur?: number; ease?: Ease } = {}): void {
  film.tl.set(orb.pose, { shapeTo: to, shapeMix: 0 }, at);
  film.tl.to(orb.pose, { shapeMix: 1, duration: o.dur ?? ORB_MORPH * 1.15, ease: o.ease ?? travel, immediateRender: false, data: { role: 'orb' } }, at);
}

export function colour(film: Film, orb: FilmOrb, at: number, to: string, o: { dur?: number; ease?: Ease } = {}): void {
  film.tl.set(orb.pose, { colorTo: to, colorMix: 0 }, at);
  film.tl.to(orb.pose, { colorMix: 1, duration: o.dur ?? ORB_MORPH, ease: o.ease ?? travel, immediateRender: false, data: { role: 'orb' } }, at);
}

/** a seeded idle life: glances every 1.8 to 2.6 s (orb2's calm director), a blink every 2.1 to 5.7 s, sometimes two */
export function life(film: Film, orb: FilmOrb, t0: number, t1: number, seed = 1, o: { yaw?: number; pitch?: number } = {}): void {
  const r = rng(seed);
  const Y = o.yaw ?? 16, P = o.pitch ?? 9;
  for (let t = t0 + 0.4 + r() * 0.8; t < t1 - 0.5; t += 1.8 + r() * 0.8) glance(film, orb, t, (r() * 2 - 1) * Y, (r() * 2 - 1) * P);
  for (let t = t0 + 0.6 + r() * 1.5; t < t1 - BLINK; t += 2.1 + r() * 3.6) {
    blink(film, orb, t);
    if (r() < 0.24 && t + 0.21 + BLINK < t1) blink(film, orb, t + 0.21);
  }
}

/* ───────── the orb becomes the mark ─────────
   The body (orb2's real outline in the pose given) splits into the mark's two eyes (the logo's real outlines) while
   its fill turns from the bot's colour to the mark's ink; the orb's own eyes shrink into their centres and are gone
   by 60% of the move (small elements, scaled, never faded). Back: the two eyes join into the body and the orb's eyes
   grow out of it from 40%. Between the two moves the mark holds. One opaque shape at every frame: nothing fades. */
export interface OrbMarkOpts {
  /** the mark's geometry centred on the orb (markGeometry(width)) */
  mark: MarkGeometry;
  markColor: string;
  toMark: { at: number; dur: number; ease?: Ease };
  toOrb?: { at: number; dur: number; ease?: Ease };
  /** the orb's pose at both ends of the morph (default: its default pose looking ahead) */
  pose?: Partial<OrbPose>;
}

export function orbMark(film: Film, orb: FilmOrb, o: OrbMarkOpts): void {
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'film-orb__morph');
  g.style.display = 'none';
  const pieces = [0, 1].map(() => { const p = document.createElementNS(NS, 'path'); g.appendChild(p); return p; });
  const eyeG = document.createElementNS(NS, 'g');
  g.appendChild(eyeG);
  orb.el.appendChild(g);

  const pose = defaultPose({ ...o.pose });
  const geo = orb.geometry(pose);
  const body: [number, number][] = geo.body.map((p) => [p[0], p[1]]);
  const eyes = geo.eyes.map((e) => ({ ...e, c: centroid(e.pts) }));
  const marks = o.mark.eyes.map((e) => e.map((p) => [p[0], p[1]] as [number, number]));
  const res = Math.max(1.5, orb.size / 160);
  /* each of the mark's eyes grows out of the WHOLE body: the two pieces start as the same outline exactly on top of
     each other and part like a dividing drop (their union is one smooth shape that stretches, then pinches). Pieces
     that tile the body instead (a cut down the middle) show a seam and a notch where they part. */
  const halves = [body, body];
  const split = halves.map((h, i) => interpolate(h, marks[i]!, { maxSegmentLength: res, string: true }));
  const join = o.toOrb ? halves.map((h, i) => interpolate(marks[i]!, h, { maxSegmentLength: res, string: true })) : null;
  const markD = marks.map((m) => ptsToD(m as Pt[]));
  const halfD = halves.map((h) => ptsToD(h as Pt[]));
  const eyePaths = eyes.map(() => { const p = document.createElementNS(NS, 'path'); eyeG.appendChild(p); return p; });

  const a = { k: 0, __name: 'orb-mark' }, b = { k: 0, __name: 'mark-orb' };
  film.tl.fromTo(a, { k: 0 }, { k: 1, duration: o.toMark.dur, ease: o.toMark.ease ?? travel, data: { role: 'morph' } }, o.toMark.at);
  if (o.toOrb) film.tl.fromTo(b, { k: 0 }, { k: 1, duration: o.toOrb.dur, ease: o.toOrb.ease ?? travel, data: { role: 'morph' } }, o.toOrb.at);
  const startA = o.toMark.at, endB = o.toOrb ? o.toOrb.at + o.toOrb.dur : Infinity;

  const drawEyes = (s: number): void => {
    eyes.forEach((e, i) => {
      const p = eyePaths[i]!;
      if (s <= 0.002) { p.setAttribute('d', ''); return; }
      p.setAttribute('d', ptsToD(e.pts.map(([x, y]) => [e.c[0] + (x - e.c[0]) * s, e.c[1] + (y - e.c[1]) * s] as Pt)));
      p.setAttribute('fill', e.fill);
    });
  };
  /* decide what shows (priority -10: before the orb draws) */
  film.onRender((t) => {
    const inMorph = t >= startA && t < endB;
    orb.hidden = inMorph;
    g.style.display = inMorph ? '' : 'none';
    if (!inMorph) return;
    g.setAttribute('transform', orb.transform(pose));
    const backward = o.toOrb && t >= o.toOrb.at;
    const k = backward ? b.k : a.k;
    const fill = backward ? mixColour(o.markColor, geo.color, k) : mixColour(geo.color, o.markColor, k);
    pieces.forEach((p, i) => {
      const d = backward ? (k >= 1 ? halfD[i]! : join![i]!(k)) : k <= 0 ? halfD[i]! : k >= 1 ? markD[i]! : split[i]!(k);
      p.setAttribute('d', d);
      p.setAttribute('fill', fill);
    });
    /* the orb's eyes: gone by 60% going, back from 40% returning */
    const s = backward ? clamp01((k - 0.4) / 0.6) : 1 - clamp01(k / 0.6);
    drawEyes(easeIO(s));
  }, -10);
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const easeIO = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!;
    const c = x0 * y1 - x1 * y0; a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-9) { const n = pts.length || 1; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
  return [cx / (3 * a), cy / (3 * a)];
}

/** attach a film orb to the film: it draws on every seek */
export function attach(film: Film, orb: FilmOrb): FilmOrb { film.onRender(() => orb.render()); return orb; }
