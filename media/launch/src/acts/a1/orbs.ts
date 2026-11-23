/* The orbs' acting in act 1. Gaze, blinks and speech belong to each orb's character layer (motion/character.ts: a
   gaze queue whose looks take over from one another, an idle that never freezes, orb2's own speaking face); what is
   left to the act is the body: squash and stretch, a lean, a hop, a landing, each written as one chain of fromTo steps
   per pose field (util.chain), so no two tweens ever fight over a field. */
import type { Film } from '../../engine/film';
import type { FilmOrb, OrbPose } from '../../engine/orb';
import { arrive, ui } from '../../motion/ease';
import { CHAR, chain } from './util';

const f = (n: number): number => n / 60;

/** a perk: a small dip, a stretch up, a settle on the character spring (anticipation and follow-through) */
export function perk(film: Film, orb: FilmOrb, at: number, amt: number): number {
  return chain(film, orb, 'squash', at, 0, [[5, amt * 0.7, ui], [7, -amt], ['char', 0]]);
}

/** a lean toward the one it talks to (dir +1 right, -1 left) for a span, with a dip before the first word; the body
    leans and tips, holds, and comes back on the character spring */
export function lean(film: Film, orb: FilmOrb, t0: number, t1: number, dir: number): number {
  const L = dir * orb.size * 0.06, R = dir * 7, inF = 14, hold = Math.max(1, Math.round((t1 - t0) * 60) - inF);
  chain(film, orb, 'squash', t0 - f(5), 0, [[5, 0.06, ui], [8, -0.04], ['char', 0]]);
  chain(film, orb, 'roll', t0, 0, [[inF, R, arrive], [hold, R], ['char', 0]]);
  return chain(film, orb, 'dx', t0, 0, [[inF, L, arrive], [hold, L], ['char', 0]]);
}

/** a bounce in place: up, and down on the character spring */
export function bounce(film: Film, orb: FilmOrb, at: number, h: number): number {
  return chain(film, orb, 'dy', at, 0, [[6, -h, ui], ['char', 0]]);
}

/** a hop: a crouch, up with a stretch, down on the character spring */
export function hop(film: Film, orb: FilmOrb, at: number, h: number): number {
  chain(film, orb, 'squash', at - f(4), 0, [[4, 0.06, ui], [6, -0.05, ui], ['char', 0]]);
  return chain(film, orb, 'dy', at - f(4), 0, [[4, h * 0.12, ui], [6, -h, ui], ['char', 0]]);
}

/** a landing: the body squashes on contact and settles on the character spring */
export function land(film: Film, orb: FilmOrb, at: number, amt = 0.1): number {
  return chain(film, orb, 'squash', at, 0, [[4, amt, ui], ['char', 0]]);
}

/** a neighbour nudged by a landing: a few px aside and back on the settle spring (look.md 8) */
export function nudge(film: Film, orb: FilmOrb, at: number, px: number): number {
  return chain(film, orb, 'dx', at, 0, [[4, px, ui], ['settle', 0]]);
}

/** set a pose's starting numbers before any tween reads them */
export function poseNow(orb: FilmOrb, p: Partial<OrbPose>): void { Object.assign(orb.pose, p); }

export { CHAR };
