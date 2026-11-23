/* One character layer per orb: what makes kai, nina, moss and vox read as characters and not stickers.

   An act's own pose tweens (orb-moves.ts: squash, hops, eye morphs, shape and colour) stay what they are. A character
   writes the orb's `life` every frame (engine/orb.ts, OrbLife), as a pure function of time, and the orb draws the pose
   plus its life:

     gaze     a queue of looks. Each look is a spring toward its target that starts from wherever the gaze is at that
              moment, with the speed it has then: a look that comes while another is still travelling takes over from
              it smoothly (no restart, no jump, no velocity step), and no two tweens ever fight over one property.
     idle     always on, so a hold never freezes (A4-09): a slow float of a few px and a 1% breath, out of phase per
              seed; micro-glances of a few degrees every 1.6 to 3 s on top of the gaze; seeded blinks every 2.1 to 5.7 s,
              sometimes two (orb2's calm idle director, but seeded and seekable).
     speech   orb2's speaking face (engine/orb.ts, speakingFace: bars with moving heights, circles on its slow cycle,
              every state 0.7 s or more and morphed, never swapped, A1-19) with orb2's sway and 1.6% pulse, eased in
              and out over 9 frames.
     hold     the idle (float, breath, micro-glances, idle blinks) fades out over 8 frames for a span where a frame
              must be exact (a dive into an eye) and back in after; looks, blinks and speech asked for still play.

   const kai = character(film, orb, { seed: 7 });   // before the beats that move it
   kai.look(at, yaw, pitch);                        // degrees, absolute; the character spring, or { spring } / { dur }
   kai.speak(t0, t1);
   kai.blink(at);
   kai.hold(t0, t1);

   With a character on an orb, orb-moves' glance(), blink() and life() feed it (a glance is a look), so a beat written
   with them gets the queue unchanged. Without one they are the tweens they always were. Times are the film's (the same
   positions the timeline takes). */
import type { Film } from '../engine/film';
import type { FilmOrb } from '../engine/orb';
import { rng } from '../engine/rng';
import { SPRINGS, springDuration, type SpringDef, type SpringName } from './spring';

const FRAME = 1 / 60;
const BLINK = 0.155;                 /* orb2's blink (orb-moves.ts BLINK) */
const HOLD_FADE = 8 * FRAME;
const SPEAK_EASE = 9 * FRAME;

/* ───────── springs from any state ───────── */

/** a damped spring (mass from def, default 1) released at displacement u0 with velocity v0, toward 0: [u, v] at t */
function free(def: SpringDef, u0: number, v0: number, t: number): [number, number] {
  const m = def.mass ?? 1, w0 = Math.sqrt(def.stiffness / m), z = def.damping / (2 * Math.sqrt(def.stiffness * m));
  if (z < 1 - 1e-9) {
    const a = z * w0, wd = w0 * Math.sqrt(1 - z * z), e = Math.exp(-a * t), C = Math.cos(wd * t), S = Math.sin(wd * t);
    const A = u0, B = (v0 + a * u0) / wd;
    return [e * (A * C + B * S), e * ((wd * B - a * A) * C - (a * B + wd * A) * S)];
  }
  if (z <= 1 + 1e-9) {
    const e = Math.exp(-w0 * t), B = v0 + w0 * u0;
    return [e * (u0 + B * t), e * (B - w0 * (u0 + B * t))];
  }
  const q = Math.sqrt(z * z - 1), r1 = -w0 * (z - q), r2 = -w0 * (z + q);
  const C1 = (v0 - r2 * u0) / (r1 - r2), C2 = u0 - C1;
  return [C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t), r1 * C1 * Math.exp(r1 * t) + r2 * C2 * Math.exp(r2 * t)];
}

/** the same spring made to land exactly at rest at T: the remaining distance and speed at T are taken away by a cubic
    that is zero with zero slope at the start (so the start, its position and its speed, is the spring's own) */
export function springFrom(def: SpringDef, u0: number, v0: number, T: number, t: number): [number, number] {
  if (t <= 0) return [u0, v0];
  if (t >= T) return [0, 0];
  const [uT, vT] = free(def, u0, v0, T), [u, v] = free(def, u0, v0, t);
  const s = t / T, s2 = s * s, s3 = s2 * s;
  return [u - uT * (3 * s2 - 2 * s3) - vT * T * (s3 - s2), v - (uT * (6 * s - 6 * s2)) / T - vT * (3 * s2 - 2 * s)];
}

/* ───────── a gaze queue ───────── */

interface Look { at: number; yaw: number; pitch: number; def: SpringDef; T: number; y0: number; p0: number; vy: number; vp: number }

/** looks in time order, each taking over from the state the previous one is in when it starts */
export class GazeQueue {
  private looks: Look[] = [];
  private solved = true;
  constructor(readonly yaw0: number, readonly pitch0: number) {}

  add(at: number, yaw: number, pitch: number, o: { spring?: SpringDef | SpringName; dur?: number } = {}): void {
    const def: SpringDef = typeof o.spring === 'object' ? o.spring : SPRINGS[o.spring ?? 'character'];
    const T = Math.max(o.dur ?? 0, springDuration(def));
    this.looks.push({ at, yaw, pitch, def, T, y0: 0, p0: 0, vy: 0, vp: 0 });
    this.solved = false;
  }

  get count(): number { return this.looks.length; }

  private solve(): void {
    const L = this.looks;
    L.sort((a, b) => a.at - b.at);   /* stable: of two looks at one time, the one asked for last wins */
    for (let i = 0; i < L.length; i++) {
      const s = i === 0 ? [this.yaw0, this.pitch0, 0, 0] : this.state(L[i - 1]!, L[i]!.at);
      L[i]!.y0 = s[0]!; L[i]!.p0 = s[1]!; L[i]!.vy = s[2]!; L[i]!.vp = s[3]!;
    }
    this.solved = true;
  }

  private state(l: Look, t: number): [number, number, number, number] {
    const [uy, vy] = springFrom(l.def, l.y0 - l.yaw, l.vy, l.T, t - l.at);
    const [up, vp] = springFrom(l.def, l.p0 - l.pitch, l.vp, l.T, t - l.at);
    return [l.yaw + uy, l.pitch + up, vy, vp];
  }

  /** [yaw, pitch, yaw speed, pitch speed] at t (degrees, degrees a second) */
  at(t: number): [number, number, number, number] {
    if (!this.solved) this.solve();
    const L = this.looks;
    let lo = 0, hi = L.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid]!.at <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k < 0 ? [this.yaw0, this.pitch0, 0, 0] : this.state(L[k]!, t);
  }
}

/* ───────── the character ───────── */

export interface CharacterOptions {
  /** the seed of its idle (phases, micro-glances, blinks): give each orb its own */
  seed?: number;
  /** the idle float's height, px (default 1.2% of the orb's size); 0 for none */
  float?: number;
  /** the breath's scale amplitude (default 0.01); 0 for none */
  breath?: number;
  /** the micro-glances' range in degrees (default ±5 yaw, ±3 pitch); false for none */
  glances?: { yaw: number; pitch: number } | false;
  /** seeded idle blinks (default true) */
  blinks?: boolean;
  /** when the idle runs (film time; default the whole film); it eases in and out over 0.3 s at the ends */
  from?: number;
  to?: number;
  /** the renderer's priority: before the act's orb renders (default -4) */
  priority?: number;
}

export interface Character {
  readonly orb: FilmOrb;
  readonly gazeQueue: GazeQueue;
  /** look at (yaw, pitch), degrees, absolute: a spring from wherever the gaze is at `at` */
  look(at: number, yaw: number, pitch: number, o?: { spring?: SpringDef | SpringName; dur?: number }): Character;
  /** orb2's speaking face from t0 to t1 (eased in and out over 9 frames inside the span) */
  speak(t0: number, t1: number): Character;
  /** one blink (orb2's curve and length) */
  blink(at: number): Character;
  /** no idle for a span (it fades out over 8 frames before t0 and back in after t1) */
  hold(t0: number, t1: number): Character;
  /** the gaze the queue gives at t (without the idle's micro-glances) */
  gaze(t: number): { yaw: number; pitch: number };
}

const registry = new WeakMap<FilmOrb, Character>();
/** the character on an orb, if it has one (orb-moves' glance, blink and life use it) */
export function characterOf(orb: FilmOrb): Character | undefined { return registry.get(orb); }

const smooth = (x: number): number => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };

/** give an orb a character: an idle that never freezes, a gaze queue, speech, blinks */
export function character(film: Film, orb: FilmOrb, o: CharacterOptions = {}): Character {
  const had = registry.get(orb);
  if (had) return had;
  const r = rng(o.seed ?? 1);
  const from = o.from ?? 0, to = o.to ?? Infinity;
  const floatPx = o.float ?? orb.size * 0.012, breath = o.breath ?? 0.01;
  const phF = r() * Math.PI * 2, phB = r() * Math.PI * 2, perF = 2.3 + r() * 0.6, perB = 3.0 + r() * 0.6;
  const queue = new GazeQueue(orb.pose.yaw, orb.pose.pitch);
  const micro = new GazeQueue(0, 0);
  const blinks: number[] = [], idleBlinks: number[] = [];
  const speeches: [number, number][] = [], holds: [number, number][] = [], lookTimes: number[] = [];

  /* the idle's micro-glances and blinks, seeded from the film's 0 (so an act alone and the whole film draw the same
     idle), up to the end of what is rendered */
  const end = Math.min(to, film.offset + film.duration);
  if (o.glances !== false) {
    const G = o.glances ?? { yaw: 5, pitch: 3 };
    for (let t = from + 0.5 + r() * 1.2; t < end; t += 1.6 + r() * 1.4) micro.add(t, (r() * 2 - 1) * G.yaw, (r() * 2 - 1) * G.pitch);
  }
  if (o.blinks !== false) {
    for (let t = from + 0.7 + r() * 1.6; t < end - BLINK; t += 2.1 + r() * 3.6) {
      idleBlinks.push(t);
      if (r() < 0.24) idleBlinks.push(t + 0.21);
    }
  }

  /** the idle's weight at t: the span's ends and the holds, every change eased */
  const idleWeight = (t: number): number => {
    let w = smooth((t - from) / 0.3) * (Number.isFinite(to) ? smooth((to - t) / 0.3) : 1);
    for (const [h0, h1] of holds) w *= 1 - smooth((t - (h0 - HOLD_FADE)) / HOLD_FADE) * (1 - smooth((t - h1) / HOLD_FADE));
    return w;
  };
  /** the micro-glances step back while a look the act asked for lands (a continuous dip, never a switch) */
  const lookDip = (t: number): number => {
    let w = 1;
    for (const l of lookTimes) {
      const tau = t - l;
      if (tau < -0.15 || tau > 0.9) continue;
      const bump = tau < 0 ? smooth((tau + 0.15) / 0.15) : 1 - smooth((tau - 0.4) / 0.5);
      w = Math.min(w, 1 - 0.65 * bump);
    }
    return w;
  };
  const blinkAt = (t: number, list: number[], weight = 1): number => {
    let z = 0;
    for (const b of list) { const tau = t - b; if (tau > 0 && tau < BLINK) z = Math.max(z, weight * Math.pow(Math.sin((Math.PI * tau) / BLINK), 0.82)); }
    return z;
  };
  const speechAt = (t: number): [number, number] => {
    let k = 0, clock = 0;
    for (const [s0, s1] of speeches) {
      if (t <= s0 || t >= s1) continue;
      const e = Math.min(SPEAK_EASE, (s1 - s0) / 2);
      const w = smooth((t - s0) / e) * smooth((s1 - t) / e);
      if (w >= k) { k = w; clock = t - s0; }
    }
    return [k, clock];
  };

  film.onRender((t) => {
    const L = orb.life;
    const w = idleWeight(t);
    const [gy, gp] = queue.at(t);
    const [sk, sclock] = speechAt(t);
    const [my, mp] = micro.at(t);
    const mw = w * lookDip(t) * (1 - 0.7 * sk);
    L.yaw = gy - queue.yaw0 + my * mw + sk * (5 * Math.sin(1.15 * sclock) + 2 * Math.cos(2.3 * sclock) - 2);
    L.pitch = gp - queue.pitch0 + mp * mw + sk * 2.5 * Math.sin(1.5 * sclock);
    L.roll = sk * 2.2 * Math.sin(1.15 * sclock);
    L.dx = 0;
    L.dy = w * floatPx * Math.sin((2 * Math.PI * t) / perF + phF);
    L.squash = 0;
    L.scale = (1 + w * breath * Math.sin((2 * Math.PI * t) / perB + phB)) * (1 + sk * 0.016 * Math.sin(9.5 * sclock));
    L.blink = Math.max(blinkAt(t, blinks), blinkAt(t, idleBlinks, w));
    L.speak = sk;
    L.speakT = sclock;
  }, o.priority ?? -4);

  const c: Character = {
    orb,
    gazeQueue: queue,
    look(at, yaw, pitch, lo) { queue.add(at, yaw, pitch, lo); lookTimes.push(at); return c; },
    speak(t0, t1) { if (t1 > t0) speeches.push([t0, t1]); return c; },
    blink(at) {
      blinks.push(at);
      /* an idle blink close to one asked for would read as a stutter: drop it */
      for (let i = idleBlinks.length - 1; i >= 0; i--) if (Math.abs(idleBlinks[i]! - at) < 0.5) idleBlinks.splice(i, 1);
      return c;
    },
    hold(t0, t1) { if (t1 >= t0) holds.push([t0, t1]); return c; },
    gaze(t) { const [yaw, pitch] = queue.at(t); return { yaw, pitch }; }
  };
  registry.set(orb, c);
  return c;
}
