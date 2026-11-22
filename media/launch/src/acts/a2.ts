/* Act 2: B05 to B08, 9.600 to 20.000 s (bars 5.3 to 10.2.5). They hand work on, they work it out, the fold, to your own
   session. Incoming seam S1 at 9.600 s (the room, from A1); outgoing seam S2 at 20.000 s: your session's composer in
   B09's key-frame composition, camera at rest (SEAMS.md). */
import type { Act } from './act';
import { hold } from './placeholder';

export const act: Act = {
  id: 'A2',
  beats: { B05: hold('B05'), B06: hold('B06'), B07: hold('B07'), B08: hold('B08') },
  async seamIn(ctx) {
    /* S1: the room A1 left (alone, A2 builds it as B04's key frame composes it); the placeholder does not move it */
    if (ctx.has('B05')) await ctx.take('room', async () => ({ group: await ctx.keyFrame('b04') }));
  }
};
