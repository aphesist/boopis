/* Act 1: B01 to B04, 0.000 to 9.600 s (bars 1.1 to 5.3). The hook, the plans you already pay for, the cast, the room.
   Outgoing seam S1 at 9.600 s: the room "release" in B04's key-frame composition, camera at rest (SEAMS.md).

   Each beat is a placeholder (its key frame held) until it is animated: replace `hold('B0n')` with the beat's builder,
   writing at `ctx.win('B0n')` times. */
import type { Act } from './act';
import { hold } from './placeholder';

export const act: Act = {
  id: 'A1',
  beats: { B01: hold('B01'), B02: hold('B02'), B03: hold('B03'), B04: hold('B04') },
  async seamOut(ctx) {
    /* S1: hand the room to A2 (placeholder: B04's key frame as the room group) */
    if (ctx.has('B04') && !ctx.carry.room) ctx.carry.room = { group: await ctx.keyFrame('b04') };
  }
};
