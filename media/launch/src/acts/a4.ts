/* Act 4: B14 to B19, 32.000 to 46.933 s (bars 16.1 to 23.1). Same thread from your other apps, nothing ships until you
   hold, hold to approve, the tagline, the wordmark, the end card: variant (b), the owner's (SC/decisions.md 2: no
   address anywhere). Incoming seam S3 at 32.000 s (the desk, from A3). The end card's builder (B19) also closes the
   15 s cut and the 6 s bumper. */
import type { Act } from './act';
import { hold } from './placeholder';

export const act: Act = {
  id: 'A4',
  beats: { B14: hold('B14'), B15: hold('B15'), B16: hold('B16'), B17: hold('B17'), B18: hold('B18'), B19: hold('B19', 'b19b') },
  async seamIn(ctx) {
    if (ctx.has('B14')) await ctx.take('desk', async () => { const kf = await ctx.keyFrame('b13'); return { terminal: kf, window: kf }; });
  }
};
