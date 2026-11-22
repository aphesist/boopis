/* Act 3: B09 to B13, 20.000 to 32.000 s (bars 10.2.5 to 16.1). The cheaper one tries first, a failed test buys the next
   rung, will do, the whole team from a terminal, the run live in the open room. Incoming seam S2 at 20.000 s (the
   composer, from A2); outgoing seam S3 at 32.000 s: the desk in B13's key-frame composition, camera at rest. */
import type { Act } from './act';
import { hold } from './placeholder';

export const act: Act = {
  id: 'A3',
  beats: { B09: hold('B09'), B10: hold('B10'), B11: hold('B11'), B12: hold('B12'), B13: hold('B13') },
  async seamIn(ctx) {
    /* S2: the composer A2 carried in (alone: B09's key frame's composer) */
    if (ctx.has('B09')) await ctx.take('composer', async () => { const kf = await ctx.keyFrame('b09'); return { el: kf.querySelector<HTMLElement>('.ui-composer') ?? kf, session: kf }; });
  },
  async seamOut(ctx) {
    /* S3: hand the desk to A4 (placeholder: B13's key frame) */
    if (ctx.has('B13') && !ctx.carry.desk) { const kf = await ctx.keyFrame('b13'); ctx.carry.desk = { terminal: kf, window: kf }; }
  }
};
