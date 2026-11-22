/* The orbs' acting in act 1, built from the library's moves (glance, blink, eyes: orb2's own faces and timings) and the
   character spring: talking, listening, waking, a hop, a landing. Every number is a pose tween, so a frame is a pure
   function of time. */
import type { Film } from '../../engine/film';
import type { FilmOrb, OrbPose } from '../../engine/orb';
import { eyes } from '../../motion/orb-moves';
import { travel, ui } from '../../motion/ease';
import { CHAR, SETTLE, character, settle } from './util';

const f = (n: number): number => n / 60;
type PoseNum = 'yaw' | 'pitch' | 'roll' | 'blink' | 'scale' | 'squash' | 'dx' | 'dy';

/** one pose number to a value on the character spring (the faces' only overshoot) */
export function spring(film: Film, orb: FilmOrb, at: number, v: Partial<Record<PoseNum, number>>): void {
  film.tl.to(orb.pose, { ...v, duration: CHAR, ease: character, immediateRender: false, data: { role: 'orb' } }, at);
}
/** a quick move that is not a character's settle (a press, an anticipation), on the product's own ease */
export function quick(film: Film, orb: FilmOrb, at: number, frames: number, v: Partial<Record<PoseNum, number>>): void {
  film.tl.to(orb.pose, { ...v, duration: f(frames), ease: ui, immediateRender: false, data: { role: 'orb' } }, at);
}
/** a glance that must be at rest by a given time: on travel instead of the spring */
export function glanceBy(film: Film, orb: FilmOrb, at: number, frames: number, yaw: number, pitch: number): void {
  film.tl.to(orb.pose, { yaw, pitch, duration: f(frames), ease: travel, immediateRender: false, data: { role: 'orb' } }, at);
}

/** orb2's speaking face, played: the eyes go to bars and flicker to round and back while the body leans toward the one
    it talks to (dir +1 right, -1 left) with a small dip before the first word and a pulse on the syllables */
export function speak(film: Film, orb: FilmOrb, at: number, dur: number, dir: number, end = 'pill'): void {
  quick(film, orb, at - f(5), 5, { squash: 0.08 });
  film.tl.to(orb.pose, { squash: -0.06, duration: f(8), ease: travel, immediateRender: false, data: { role: 'orb' } }, at);
  spring(film, orb, at + f(8), { squash: 0 });
  spring(film, orb, at, { dx: dir * orb.size * 0.07, roll: dir * 10 });
  eyes(film, orb, at, 'bars', { dur: 0.1 });
  eyes(film, orb, at + 0.17, 'circle', { dur: 0.07 });
  film.tl.to(orb.pose, { scale: 1.045, duration: f(4), ease: ui, yoyo: true, repeat: 1, immediateRender: false, data: { role: 'orb' } }, at + 0.17);
  eyes(film, orb, at + 0.25, 'bars', { dur: 0.07 });
  film.tl.to(orb.pose, { scale: 1.04, duration: f(4), ease: ui, yoyo: true, repeat: 1, immediateRender: false, data: { role: 'orb' } }, at + dur - 0.2);
  eyes(film, orb, at + dur - 0.12, end, { dur: 0.16 });
  spring(film, orb, at + dur - 0.06, { dx: 0, roll: 0 });
}

/** asleep to awake: the closed eyes open (orb2's face morph), a stretch up and a settle on the character spring */
export function wake(film: Film, orb: FilmOrb, at: number, yaw: number, pitch: number): void {
  eyes(film, orb, at, 'pill', { dur: 0.16 });
  quick(film, orb, at, 6, { squash: -0.08 });
  spring(film, orb, at + f(6), { squash: 0 });
  spring(film, orb, at + f(2), { yaw, pitch, roll: 0 });
}

/** a small hop: up and back down on the character spring, with a squash on the take-off */
export function hop(film: Film, orb: FilmOrb, at: number, h: number): void {
  quick(film, orb, at - f(4), 4, { squash: 0.06 });
  quick(film, orb, at, 6, { dy: -h, squash: -0.05 });
  spring(film, orb, at + f(6), { dy: 0, squash: 0 });
}

/** a bounce in place (dy only, so it never fights a squash or a lean): up, and down on the character spring */
export function bounce(film: Film, orb: FilmOrb, at: number, h: number): void {
  quick(film, orb, at, 6, { dy: -h });
  spring(film, orb, at + f(6), { dy: 0 });
}

/** a landing: the body squashes on contact and settles on the character spring */
export function land(film: Film, orb: FilmOrb, at: number, amount = 0.1): void {
  film.tl.fromTo(orb.pose, { squash: 0 }, { squash: amount, duration: f(4), ease: ui, immediateRender: false, data: { role: 'orb' } }, at);
  spring(film, orb, at + f(4), { squash: 0 });
}
/** a neighbour nudged by a landing: a few px aside and back on the settle spring (look.md 8) */
export function nudge(film: Film, orb: FilmOrb, at: number, px: number): void {
  film.tl.to(orb.pose, { dx: px, duration: f(4), ease: ui, immediateRender: false, data: { role: 'orb' } }, at);
  film.tl.to(orb.pose, { dx: 0, duration: SETTLE, ease: settle, immediateRender: false, data: { role: 'orb' } }, at + f(4));
}

/** set a pose's starting numbers before any tween reads them */
export function poseNow(orb: FilmOrb, p: Partial<OrbPose>): void { Object.assign(orb.pose, p); }
