/* Mask and clip reveals (craft bible T4, T7): the next thing is revealed behind an edge that moves, never faded in.

     wipe(film, el, { at, dur, from: 'left' })          clip-path inset opens from an edge (out: true closes toward one)
     iris(film, el, { at, dur, x, y })                  a circle opens from a point until it clears the farthest corner
     lids(film, stage, { at })                          the blink as a transition: two opaque lids close over the frame
                                                        (8 f, snap), hold 2 f, open on the new scene (10 f, arrive)
     focus(film, el, { at, dur, to: 18 })               T7: the outgoing frame loses focus (blur) and darkens 10%; it
                                                        stays opaque, the incoming element arrives sharp in front */
import type { Film } from '../engine/film';
import type { Stage } from '../engine/stage';
import { arrive, snap, travel, type Ease } from './ease';

type Edge = 'left' | 'right' | 'top' | 'bottom';
const INSET: Record<Edge, (p: number) => string> = {
  left: (p) => 'inset(0% ' + p + '% 0% 0%)',
  right: (p) => 'inset(0% 0% 0% ' + p + '%)',
  top: (p) => 'inset(0% 0% ' + p + '% 0%)',
  bottom: (p) => 'inset(' + p + '% 0% 0% 0%)'
};

/** open (or with out: true, close) an element by its clip, from an edge */
export function wipe(film: Film, el: HTMLElement, o: { at: number; dur: number; from?: Edge; ease?: Ease; out?: boolean }): void {
  const f = INSET[o.from ?? 'left'];
  const a = o.out ? 0 : 100, b = o.out ? 100 : 0;
  film.tl.fromTo(el, { clipPath: f(a) }, { clipPath: f(b), duration: o.dur, ease: o.ease ?? travel, data: { role: 'reveal' } }, o.at);
}

/** a circle opening from (x, y) in the element's px until it clears the farthest corner (x 1.05) */
export function iris(film: Film, el: HTMLElement, o: { at: number; dur: number; x: number; y: number; w: number; h: number; ease?: Ease; out?: boolean }): void {
  const r = 1.05 * Math.max(Math.hypot(o.x, o.y), Math.hypot(o.w - o.x, o.y), Math.hypot(o.x, o.h - o.y), Math.hypot(o.w - o.x, o.h - o.y));
  const c = (rad: number): string => 'circle(' + rad.toFixed(2) + 'px at ' + o.x + 'px ' + o.y + 'px)';
  film.tl.fromTo(el, { clipPath: c(o.out ? r : 0) }, { clipPath: c(o.out ? 0 : r), duration: o.dur, ease: o.ease ?? snap, data: { role: 'reveal' } }, o.at);
}

/** the blink transition: lids close (8 f, snap), hold closed (2 f, on the beat), open (10 f, arrive); returns the
    time the frame is fully covered (swap the scene under it then) */
export function lids(film: Film, stage: Stage, o: { at: number; close?: number; hold?: number; open?: number; color?: string }): number {
  const f = film.fps, close = (o.close ?? 8) / f, hold = (o.hold ?? 2) / f, open = (o.open ?? 10) / f;
  const mk = (top: boolean): HTMLElement => {
    const d = document.createElement('div');
    d.className = 'film-lid';
    d.style.cssText = 'position:absolute;left:-2%;width:104%;height:52%;background:' + (o.color ?? 'var(--film-ground, var(--bg-0))') + ';' + (top ? 'top:0;border-radius:0 0 50% 50% / 0 0 18% 18%' : 'bottom:0;border-radius:50% 50% 0 0 / 18% 18% 0 0');
    stage.screen.appendChild(d);
    return d;
  };
  const top = mk(true), bottom = mk(false);
  film.tl.fromTo(top, { yPercent: -101 }, { yPercent: 0, duration: close, ease: snap, data: { role: 'lids' } }, o.at);
  film.tl.fromTo(bottom, { yPercent: 101 }, { yPercent: 0, duration: close, ease: snap, data: { role: 'lids' } }, o.at);
  film.tl.to([top], { yPercent: -101, duration: open, ease: arrive, immediateRender: false, data: { role: 'lids' } }, o.at + close + hold);
  film.tl.to([bottom], { yPercent: 101, duration: open, ease: arrive, immediateRender: false, data: { role: 'lids' } }, o.at + close + hold);
  return o.at + close;
}

/** T7 focus pull: the element blurs to `to` px and darkens 10% (it stays fully opaque) */
export function focus(film: Film, el: HTMLElement, o: { at: number; dur: number; to?: number; back?: boolean; ease?: Ease }): void {
  const a = o.back ? (o.to ?? 18) : 0, b = o.back ? 0 : (o.to ?? 18);
  film.tl.fromTo(el, { filter: 'blur(' + a + 'px) brightness(' + (o.back ? 0.9 : 1) + ')' }, { filter: 'blur(' + b + 'px) brightness(' + (o.back ? 1 : 0.9) + ')', duration: o.dur, ease: o.ease ?? travel, data: { role: 'reveal' } }, o.at);
}
