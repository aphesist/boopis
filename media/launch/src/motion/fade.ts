/* The one opacity helper (craft bible rule 1): opacity alone may only bring a SMALL element (under 10% of the frame) in
   or out, and only together with movement. `fadeSmall` measures the element at build time and throws when it is too
   big, so a full-layer cross-fade cannot be built with the library. The checker re-checks every opacity tween on the
   rendered page (qa --page, "fades"). */
import type { Film } from '../engine/film';
import type { Stage } from '../engine/stage';
import { arrive, depart, type Ease } from './ease';

export function fadeSmall(film: Film, stage: Stage, el: HTMLElement, o: { at: number; dur: number; out?: boolean; y?: number; x?: number; scale?: number; ease?: Ease }): void {
  const f = stage.root.getBoundingClientRect(), r = el.getBoundingClientRect(), k = f.width / stage.width;
  const area = (r.width / k) * (r.height / k) / (stage.width * stage.height);
  if (area > 0.1) throw new Error('fadeSmall: ' + (el.className || el.tagName) + ' covers ' + Math.round(area * 100) + '% of the frame; opacity may only move elements under 10% (morph, mask or move it instead)');
  if (!o.y && !o.x && !o.scale) throw new Error('fadeSmall: an opacity change must come with movement (y, x or scale)');
  const a = { opacity: 0, y: o.y ?? 0, x: o.x ?? 0, scale: o.scale ?? 1 }, b = { opacity: 1, y: 0, x: 0, scale: 1 };
  const [from, to] = o.out ? [b, a] : [a, b];
  film.tl.fromTo(el, from, { ...to, duration: o.dur, ease: o.ease ?? (o.out ? depart : arrive), data: { role: 'fade' } }, o.at);
}
