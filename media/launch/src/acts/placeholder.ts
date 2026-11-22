/* The placeholder a beat has until its animator builds it: the art director's key frame, held for the beat's window
   and swapped on its first and last frame. It gives a rough end-to-end cut (the animatic) on day one, through the
   same structure the animated acts use: an act replaces a beat's placeholder with its own builder, one beat at a time. */
import type { ActCtx } from './context';

export type BeatBuilder = (ctx: ActCtx) => void | Promise<void>;

/** hold a beat's key frame for its window (the key frame named `kf`, default the beat's own: b19 plays b19b, the
    owner's end card) */
export const hold = (beat: string, kf?: string): BeatBuilder => async (ctx) => {
  if (!ctx.has(beat)) return;
  const w = ctx.win(beat);
  const el = await ctx.keyFrame(kf ?? beat.toLowerCase());
  ctx.showDuring(el, w.start, w.end);
  ctx.film.mark(beat + ' (placeholder)', w.start);
};
