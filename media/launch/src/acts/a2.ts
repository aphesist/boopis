/* Act 2: B05 to B08, 9.600 to 20.000 s (bars 5.3 to 10.2.5). They hand work on, they work it out, the fold, to your own
   session. Incoming seam S1 at 9.600 s (the room, from A1); outgoing seam S2 at 20.000 s: your session's composer in
   B09's key-frame composition, camera at rest (SEAMS.md).

   The act is one room seen through one camera: the product's own log grows (kai's reply takes the presence entry's
   place, nina's lands above who is still at work, the two gather into the huddle, kai's joins it, the huddle folds when
   you write), the camera follows the entry each beat is about, the film lines sit in the room's ground and edit
   themselves, and the room pulls back into the window, where the tabs pill switches to your session and the composer,
   carried across, morphs into the session's. Every orb that answers carries its reply into the thread. */
import type { Act } from './act';
import { a2state } from './a2/state';
import { b05, b06, b07, b08 } from './a2/beats';

export const act: Act = {
  id: 'A2',
  beats: { B05: b05, B06: b06, B07: b07, B08: b08 },
  async seamIn(ctx) {
    /* S1: the room A1 left (alone, A2 builds it as B04's key frame composes it) */
    if (ctx.has('B05')) await a2state(ctx);
  },
  async seamOut(ctx) {
    /* S2: the session composer and its plate, carried into A3 */
    const s = await a2state(ctx);
    if (ctx.has('B08') && s.out) ctx.carry.composer = s.out;
  }
};
