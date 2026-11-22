/* The wordmark, driven by the film's clock: the logo's own geometry (vendor/boopis-logo.js: its letters as Libre
   Franklin paths, its idle eyes, its blink capsule), laid out exactly where the end card's <boopis-logo> sits, and moved
   from the timeline instead of the element's own frame loop (which cannot be seeked).

     nina's eyes become the two ovals   her eye outlines (orb2's, from the film orb's pose) morph into the logo's idle
                                        eyes on the logo's own morph curve (0.38 s), dark eye ink to light ink, one
                                        opaque shape each at every frame
     her body shrinks behind them       her outline, opaque, scaling down toward the point between the eyes
     the letters play in                letters="play": each letter is a piece with its pivot on the baseline, driven by
                                        the element's own springs and gravity (HOP_MAX, PLAY_G, the 48 ms stagger, squash
                                        and stretch that keeps the area, the tittle's own bounce), integrated once at
                                        build time at 600 Hz, so a frame is a table lookup. They grow out from behind the
                                        eyes (their parent), never from nothing.
     live eyes                          a glance (the pair travels along the line, TRAVEL) and a blink (the orb's
                                        envelope into the logo's wide capsule), with still letters (look.md 6) */
import type { Film } from '../../engine/film';
import type { Pt } from '../../engine/orb';
import { mixColour, ptsToD } from '../../engine/orb';
import { interpolate } from 'flubber';
import { depart } from '../../motion/ease';
import { springEase, springDuration } from '../../motion/spring';
import { clamp01, lerp, logoMorph } from './util';

interface Glyph { x: number; x1: number; x2: number; top: number; d: string; dot?: { cx: number; cy: number; d: string } | null }
interface LogoApi { layoutOf(word: string, weight: number, mark: boolean): { left: Glyph[]; right: Glyph[]; gap: number; eyeW: number; vb: number[] }; draw(o: object): { eyes: string[]; shiftL: number; shiftR: number } }
const LOGO = (): LogoApi => (window as unknown as { BoopisLogo: LogoApi }).BoopisLogo;

/* the playful letters' constants (vendor/boopis-logo.js) */
const HOP_MAX = 92, PLAY_G = 3300, STAGGER = 0.048;
const ROT_SPRING: [number, number] = [22, 0.3], Q_SPRING: [number, number] = [26, 0.4], DOT_SPRING: [number, number] = [17, 0.28];
const TRAVEL_X = 26, TRAVEL_Y = 60;
/** the line under the word the letters spring up through, in font units below the baseline (under the p's tail) */
const UNDER = 230;
function spring(o: { x: number; v: number }, goal: number, w: number, z: number, dt: number): void {
  const k = w * w, c = 2 * z * w, h = dt / 2;
  for (let i = 0; i < 2; i++) { o.v += ((goal - o.x) * k - o.v * c) * h; o.x += o.v * h; }
}
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const NS = 'http://www.w3.org/2000/svg';

export interface LogoBox { x: number; y: number; s: number }
export interface Wordmark {
  svg: SVGSVGElement;
  /** font units to frame px */
  toPx(u: number, v: number): [number, number];
  toUnits(x: number, y: number): [number, number];
  eyes: [SVGPathElement, SVGPathElement];
  eyeG: SVGGElement;
  /** the idle eyes' outlines (font units) */
  idle: [string, string];
  wide: [string, string];
  pieces: { g: SVGGElement; glyph: Glyph; dotG?: SVGGElement }[];
  body: SVGPathElement;
}

/** the wordmark's parts in a frame-sized svg, at the logo box (its top-left in frame px and px per font unit) */
export function wordmark(layer: HTMLElement, box: LogoBox, W: number, H: number, ink = 'var(--text-strong)'): Wordmark {
  const L = LOGO();
  const Ly = L.layoutOf('boopis', 600, false), dr = L.draw({}), wide = L.draw({ state: 'wide' });
  const [vx = 0, vy = 0] = Ly.vb;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'a4-wordmark');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
  svg.setAttribute('overflow', 'visible');
  svg.setAttribute('aria-hidden', 'true');
  (svg as unknown as HTMLElement).style.cssText = 'position:absolute;left:0;top:0;overflow:visible;visibility:hidden;color:' + ink;
  /* the line the letters spring up through: they wait under it, out of sight (a mask, never a fade) */
  svg.innerHTML = '<defs><clipPath id="a4-under" clipPathUnits="userSpaceOnUse"><rect x="-4000" y="-4000" width="9000" height="' + (4000 + UNDER) + '"/></clipPath></defs>';
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', 'translate(' + box.x + ' ' + box.y + ') scale(' + box.s + ') translate(' + -vx + ' ' + -vy + ')');
  svg.appendChild(g);
  const body = document.createElementNS(NS, 'path');
  g.appendChild(body);
  const pieces: Wordmark['pieces'] = [];
  const letters = document.createElementNS(NS, 'g');
  letters.setAttribute('clip-path', 'url(#a4-under)');
  g.appendChild(letters);
  for (const [list, sh] of [[Ly.left, dr.shiftL], [Ly.right, dr.shiftR]] as const) {
    for (const gl of list) {
      const pg = document.createElementNS(NS, 'g');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', gl.d); p.setAttribute('fill', 'currentColor');
      pg.appendChild(p);
      let dotG: SVGGElement | undefined;
      if (gl.dot) {
        dotG = document.createElementNS(NS, 'g');
        const dp = document.createElementNS(NS, 'path');
        dp.setAttribute('d', gl.dot.d); dp.setAttribute('fill', 'currentColor');
        dotG.appendChild(dp); pg.appendChild(dotG);
      }
      pg.setAttribute('transform', 'translate(' + (gl.x + sh) + ' 0)');
      letters.appendChild(pg);
      pieces.push({ g: pg, glyph: { ...gl, x: gl.x + sh }, dotG });
    }
  }
  const eyeG = document.createElementNS(NS, 'g');
  g.appendChild(eyeG);
  const eyes = [0, 1].map((i) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', dr.eyes[i]!); e.setAttribute('fill', 'currentColor'); eyeG.appendChild(e); return e; }) as [SVGPathElement, SVGPathElement];
  layer.appendChild(svg);
  return {
    svg, eyes, eyeG, pieces, body,
    idle: [dr.eyes[0]!, dr.eyes[1]!], wide: [wide.eyes[0]!, wide.eyes[1]!],
    toPx: (u, v) => [box.x + (u - vx) * box.s, box.y + (v - vy) * box.s],
    toUnits: (x, y) => [(x - box.x) / box.s + vx, (y - box.y) / box.s + vy]
  };
}

export interface Source {
  /** nina in frame px at the hand-off: her centre, size, and the outlines her pose draws (around the centre) */
  x: number; y: number; size: number;
  body: Pt[]; eyes: Pt[][]; color: string; eyeInk: string;
  /** told every frame how much of her body is left (1 to 0) and where its centre is on the frame: her contact shadow
      goes with it */
  onBody?: (s: number, x: number, y: number) => void;
}

/** B18's signature: from the hand-off at `at`, nina's body shrinks behind her eyes while they morph into the logo's
    ovals, and the letters play in around them. Returns when the word has settled. */
export function eyesToWordmark(film: Film, wm: Wordmark, src: Source, o: { at: number; morph: number; shrink: number; letters: number; until: number }): number {
  const toU = (p: Pt): Pt => wm.toUnits(src.x + p[0], src.y + p[1]);
  const eyesU = src.eyes.map((e) => e.map(toU));
  const bodyU = src.body.map(toU);
  const res = 2 * (wm.toUnits(1, 0)[0] - wm.toUnits(0, 0)[0]);   /* ~2 px between matched points, in font units */
  const morphs = [0, 1].map((i) => interpolate(eyesU[i]!.map((p) => [p[0], p[1]] as [number, number]), wm.idle[i]!, { maxSegmentLength: Math.max(4, res), string: true }));
  const startD = eyesU.map((e) => ptsToD(e));
  const cen = (pts: Pt[]): Pt => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
  const P0 = ((a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])(cen(eyesU[0]!), cen(eyesU[1]!));
  const P1: Pt = [0, -265];      /* between the logo's idle eyes (each -540..10 in font units) */
  const bodyD = ptsToD(bodyU.map((p) => [p[0] - P0[0], p[1] - P0[1]] as Pt));
  wm.body.setAttribute('d', bodyD);
  wm.body.setAttribute('fill', src.color);
  const m = { k: 0, __name: 'eyes-to-ovals' }, b = { k: 0, __name: 'body-away' };
  film.tl.fromTo(m, { k: 0 }, { k: 1, duration: o.morph, ease: logoMorph, data: { role: 'morph' } }, o.at);
  /* the body leaves for good: quart-in, so it holds a moment, then goes behind the eyes */
  film.tl.fromTo(b, { k: 0 }, { k: 1, duration: o.shrink, ease: depart, data: { role: 'morph' } }, o.at);
  film.onRender((t) => {
    const before = t < o.at;
    const k = before ? 0 : m.k;
    for (let i = 0; i < 2; i++) wm.eyes[i]!.setAttribute('d', k <= 0 ? startD[i]! : k >= 1 ? wm.idle[i]! : morphs[i]!(k));
    const ink = mixColour(src.eyeInk, 'var(--text-strong)', clamp01(k * 1.25));
    for (const e of wm.eyes) e.setAttribute('fill', ink);
    const s = 1 - b.k;
    const P: Pt = [lerp(P0[0], P1[0], k), lerp(P0[1], P1[1], k)];
    wm.body.style.display = s <= 0.002 ? 'none' : '';
    wm.body.setAttribute('transform', 'translate(' + P[0].toFixed(2) + ' ' + P[1].toFixed(2) + ') scale(' + s.toFixed(5) + ')');
    if (src.onBody && !before) { const [px, py] = wm.toPx(P[0], P[1]); src.onBody(s, px, py); }
  });
  return playIn(film, wm, o.letters, o.until);
}

/** letters="play", the arrival: the logo's own wave (its happy state: every letter hops, 48 ms apart along the word),
    each letter springing up from under the line it lands on, stretched in flight, squashed on landing, the tittle
    lagging the stem and bouncing on its own. The element's springs and squash; its gravity is quadrupled here, because
    a letter springs from under the line rather than from it. */
function playIn(film: Film, wm: Wordmark, t0: number, until: number): number {
  const DT = 1 / 600, G = PLAY_G * 4, APEX = 60;
  const start = t0, n = Math.ceil((until - start) / DT) + 2;
  interface Sim { h: Float32Array; q: Float32Array; r: Float32Array; dh: Float32Array; dq: Float32Array }
  let settled = t0;
  const lean = [-2.5, 2, -1.5, 3];
  const sims: Sim[] = wm.pieces.map((pc, i) => {
    const bb = (pc.g.firstElementChild as SVGPathElement).getBBox();
    const dotTop = pc.dotG ? (pc.dotG.firstElementChild as SVGPathElement).getBBox().y : 0;
    const h0 = Math.min(bb.y, dotTop) - UNDER - 40;   /* the whole glyph under the line, the tittle too */
    const tl = t0 + i * STAGGER;
    const v0 = Math.sqrt(2 * G * (APEX - h0));
    const S: Sim = { h: new Float32Array(n), q: new Float32Array(n), r: new Float32Array(n), dh: new Float32Array(n), dq: new Float32Array(n) };
    const q = { x: 0, v: 0 }, rot = { x: 0, v: 0 }, rel = { x: 0, v: 0 }, dq = { x: 0, v: 0 };
    let h = h0, vh = 0, qEv = 0, flying = false, landed = false, dh = 0, dvh = 0;
    for (let k = 0; k < n; k++) {
      const t = start + k * DT;
      const vy0 = vh;
      if (!flying && !landed && t >= tl) { flying = true; vh = v0; qEv = 0.09; }
      if (flying) {
        vh -= G * DT; h += vh * DT;
        if (h <= 0 && vh < 0) { h = 0; vh = 0; flying = false; landed = true; qEv = 0; q.v -= 2.6; rot.v += lean[i % 4]! * 14; if (pc.dotG) { dvh = Math.sqrt(2 * PLAY_G * 70); dh = 0.01; dq.v = 2.2; } }
      }
      spring(rot, 0, ROT_SPRING[0], ROT_SPRING[1], DT);
      spring(q, clamp(qEv, -0.15, 0.15), Q_SPRING[0], Q_SPRING[1], DT);
      if (pc.dotG) {
        const acc = flying || landed ? (vh - vy0) / DT : 0;
        if (dh > 0 || dvh > 0) { dvh -= PLAY_G * DT; dh += dvh * DT; if (dh <= 0 && dvh < 0) { if (dvh < -140) { dvh = -dvh * 0.38; dh = 0.01; dq.v -= 1.6; } else { dh = 0; dvh = 0; dq.v -= 1.2; } } }
        dh = Math.min(dh, HOP_MAX + 10);
        rel.v += -acc * 0.12 * DT; spring(rel, 0, DOT_SPRING[0], DOT_SPRING[1], DT); spring(dq, 0, Q_SPRING[0], Q_SPRING[1], DT);
      }
      S.h[k] = h; S.q[k] = clamp(q.x, -0.14, 0.14); S.r[k] = clamp(rot.x, -7, 7);
      S.dh[k] = dh + clamp(rel.x, -60, 60); S.dq[k] = clamp(dq.x, -0.3, 0.3);
      if (landed && Math.abs(q.x) + Math.abs(rot.x) / 4 + Math.abs(rel.x) / 40 + dh / 40 > 0.004) settled = Math.max(settled, t);
    }
    return S;
  });
  film.motion(start, Math.min(until, settled + 0.05));
  film.onRender((t) => {
    wm.pieces.forEach((pc, i) => {
      const S = sims[i]!, gl = pc.glyph, cx = (gl.x1 + gl.x2) / 2;
      const f = clamp((t - start) / DT, 0, n - 1), k0 = Math.floor(f), k1 = Math.min(n - 1, k0 + 1), a = f - k0;
      const at = (arr: Float32Array): number => arr[k0]! + (arr[k1]! - arr[k0]!) * a;
      const sy = 1 + at(S.q), sx = 1 / sy;
      pc.g.setAttribute('transform', 'translate(' + (gl.x + cx).toFixed(2) + ' ' + (-at(S.h)).toFixed(2) + ') rotate(' + at(S.r).toFixed(3) + ') scale(' + sx.toFixed(4) + ' ' + sy.toFixed(4) + ') translate(' + (-cx).toFixed(2) + ' 0)');
      if (pc.dotG && gl.dot) {
        const dy = at(S.dh), ds = 1 + at(S.dq);
        pc.dotG.setAttribute('transform', 'translate(' + gl.dot.cx + ' ' + (gl.dot.cy - dy).toFixed(2) + ') scale(' + (1 / ds).toFixed(4) + ' ' + ds.toFixed(4) + ') translate(' + -gl.dot.cx + ' ' + -gl.dot.cy + ')');
      }
    });
  });
  return settled;
}

/** live eyes at rest: a glance (u: -1..1 along the line and up) on the character spring, and back */
export function eyeGlance(film: Film, wm: Wordmark, at: number, ux: number, uy: number, back: number): void {
  const p = eyeState(film, wm);
  const d = springDuration('character');
  film.tl.to(p, { gx: ux, gy: uy, duration: d, ease: springEase('character'), immediateRender: false, data: { role: 'logo' } }, at);
  film.tl.to(p, { gx: 0, gy: 0, duration: d, ease: springEase('character'), immediateRender: false, data: { role: 'logo' } }, back);
}
/** one blink: the orb's envelope (0.155 s) into the logo's wide capsule */
export function eyeBlink(film: Film, wm: Wordmark, at: number): void {
  const p = eyeState(film, wm);
  const close = Object.assign((q: number): number => (q <= 0 ? 0 : q >= 1 ? 1 : Math.pow(Math.sin((Math.PI * q) / 2), 0.82)), { easeName: 'orb-blink-close' });
  const open = Object.assign((q: number): number => (q <= 0 ? 0 : q >= 1 ? 1 : 1 - Math.pow(Math.cos((Math.PI * q) / 2), 0.82)), { easeName: 'orb-blink-open' });
  film.tl.fromTo(p, { bl: 0 }, { bl: 1, duration: 0.0775, ease: close, immediateRender: false, data: { role: 'logo' } }, at);
  film.tl.fromTo(p, { bl: 1 }, { bl: 0, duration: 0.0775, ease: open, immediateRender: false, data: { role: 'logo' } }, at + 0.0775);
}
const states = new WeakMap<Wordmark, { gx: number; gy: number; bl: number }>();
function eyeState(film: Film, wm: Wordmark): { gx: number; gy: number; bl: number } {
  let p = states.get(wm);
  if (!p) {
    const st = { gx: 0, gy: 0, bl: 0, __name: 'logo-eyes' };
    p = st;
    states.set(wm, st);
    const blinks = [0, 1].map((i) => interpolate(wm.idle[i]!, wm.wide[i]!, { maxSegmentLength: 6, string: true }));
    film.onRender(() => {
      wm.eyeG.setAttribute('transform', 'translate(' + (st.gx * TRAVEL_X).toFixed(2) + ' ' + (-st.gy * TRAVEL_Y * 0.5).toFixed(2) + ')');
      if (st.bl > 0.0005) for (let i = 0; i < 2; i++) wm.eyes[i]!.setAttribute('d', blinks[i]!(st.bl));
    }, 2);
  }
  return p;
}
