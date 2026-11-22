/* Several moves of one element over the film: one renderer per element, and at time t the latest move that has started
   draws it (before the first one starts, the first one draws its start). Carries, morphs and the cursor share it, so a
   later move never fights an earlier one for the same element. */
import type { Film } from '../engine/film';

export interface Segment { t0: number; draw(t: number): void }
const tracks = new WeakMap<object, Segment[]>();

export function track(film: Film, key: object, seg: Segment, priority = 0): void {
  let list = tracks.get(key);
  if (!list) {
    const l: Segment[] = [];
    list = l;
    tracks.set(key, l);
    film.onRender((t) => {
      let cur = l[0];
      for (const s of l) if (s.t0 <= t + 1e-9) cur = s;
      cur?.draw(t);
    }, priority);
  }
  list.push(seg);
  list.sort((a, b) => a.t0 - b.t0);
}
