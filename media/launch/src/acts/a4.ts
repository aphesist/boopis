/* Act 4: B14 to B19, 32.000 to 46.933 s (bars 16.1 to 23.1). Same thread from your other apps, nothing ships until you
   hold, hold to approve, the tagline, the wordmark, the end card: variant (b), the owner's (SC/decisions.md 2: no
   address anywhere). Incoming seam S3 at 32.000 s (the desk, from A3). The end card's builder (B19) and the wordmark's
   (B18) also close the 15 s cut and the 6 s bumper.

   The beats are in a4/: desk.ts (B14 to B16: the dock session, the other app, the hold), close.ts (B17 to B19: the
   tagline, the eyes becoming the wordmark, the end card), logo.ts (the wordmark on the film's clock), type.ts (film
   lines in K1), util.ts (the lamp, the frame's own layer, the cursor, the product's curves). */
import type { Act } from './act';
import type { ActCtx } from './context';
import { b14, b15, b16 } from './a4/desk';
import { b17, b18, b19 } from './a4/close';
import { lamps, TINT, type Lamp } from './a4/util';
import { travel } from '../motion/ease';

/** the lamp through the act (look.md sections 1 and 2): the desk's cool light down to the dock and the app, red where
    something is owed (B15, B16), the card stock's own light after the receipt, the orbs' light under nina, then the end
    card's even field. Placed after every beat has written its camera, because each lamp is aimed for the camera there. */
function lampsOf(ctx: ActCtx): void {
  const V = ctx.variant === 'vertical', g = ctx.g;
  const has = (b: string): boolean => ctx.has(b);
  const at = (b: string, n: number): number => ctx.win(b).start + g.beats(n);
  const L: Lamp[] = [];
  if (has('B14')) {
    L.push({ x: 0.5, y: 0.5, w: 0.9, h: 0.96, tint: TINT.cool, at: at('B14', 0), dur: 0.001, ease: travel });
    L.push({ x: V ? 0.5 : 0.42, y: V ? 0.62 : 0.7, w: 0.9, h: 0.96, tint: TINT.cool, at: at('B14', 0.5), dur: g.beats(1.5), ease: travel });
  }
  if (has('B15')) L.push({ x: V ? 0.5 : 0.34, y: V ? 0.6 : 0.72, w: 0.7, h: 0.8, tint: TINT.red, at: at('B15', 2), dur: g.beats(1.5), ease: travel });
  if (has('B16')) {
    L.push({ x: 0.5, y: 0.5, w: 0.7, h: 0.7, tint: TINT.redClose, at: at('B16', 0), dur: g.beats(1), ease: travel });
    L.push({ x: V ? 0.5 : 0.4, y: V ? 0.55 : 0.6, w: 0.8, h: 0.9, tint: TINT.ui, at: at('B16', 3), dur: 0.001, ease: travel });
  }
  if (has('B17')) L.push({ x: 0.5, y: V ? 0.64 : 0.72, w: 0.7, h: 0.8, tint: TINT.orbs, at: at('B17', 0), dur: g.beats(1.5), ease: travel });
  if (has('B18')) {
    if (!has('B17')) L.push({ x: 0.5, y: V ? 0.6 : 0.62, w: 0.8, h: 0.9, tint: TINT.orbs, at: at('B18', 0), dur: 0.001, ease: travel });
    L.push({ x: 0.5, y: V ? 0.46 : 0.48, w: 1.2, h: 1.3, tint: TINT.orbs, at: at('B18', 0.5), dur: g.beats(2), ease: travel });
  }
  if (has('B19')) L.push({ x: 0.5, y: 0.46, w: 1.3, h: 1.4, tint: TINT.ui, at: at('B19', 0), dur: g.beats(2), ease: travel });
  if (L.length) lamps(ctx, L[0]!.at, L);
}

export const act: Act = {
  id: 'A4',
  beats: { B14: b14, B15: b15, B16: b16, B17: b17, B18: b18, B19: b19 },
  async seamIn(ctx) {
    /* S3 (SEAMS.md): the desk A3 lands at 32.000 s; alone, the act builds the same state from B13's key frame */
    if (ctx.has('B14')) await ctx.take('desk', async () => { const kf = await ctx.keyFrame('b13'); return { terminal: kf, window: kf }; });
  },
  seamOut(ctx) { lampsOf(ctx); }
};
