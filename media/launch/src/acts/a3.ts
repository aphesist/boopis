/* Act 3: B09 to B13, 20.000 to 32.000 s (bars 10.2.5 to 16.1). The cheaper one tries first, a failed test buys the next
   rung, the breath, the whole team from a terminal, the run live in the open room. Incoming seam S2 at 20.000 s (the
   composer, from A2); outgoing seam S3 at 32.000 s: the desk in B13's key-frame composition, camera at rest.

   The act is one stage (a3/build.ts: the boopis window at the session's 2.6x, B13's terminal, B11's nameless app, each
   a plate the act's rig moves, a3/rig.ts), built once and animated beat by beat:
     B09, B10   a3/session.ts   your session, governed: typing, the request card, the answer on Sol, the panel, the line;
                                npm test fails quietly, the rollback, the climb to Astra, npm test passes
     B11        a3/desk.ts      the breath: one slow move from the session to the whole window (Bots clicked on the way)
                                and past its edges to the desk: the terminal behind, the app in front
     B12        a3/desk.ts      the camera eases onto the terminal; the command types; Enter on the drop
     B13        a3/desk.ts      the window comes forward into the open room beside the terminal; each block prints and
                                lands in the room on the same frame; the huddle gathers; done; at rest on SEAMS S3 */
import type { Act } from './act';
import type { ActCtx } from './context';
import { build3, type Stage3 } from './a3/build';
import { b09, b10, prepSession, type Prep } from './a3/session';
import { b11, b12, b13, prepDesk, type DeskPrep } from './a3/desk';

interface Built { S: Stage3; P: Prep; D: DeskPrep }
const built = new WeakMap<ActCtx, Promise<Built>>();
function stage(ctx: ActCtx): Promise<Built> {
  let p = built.get(ctx);
  if (!p) {
    p = (async () => { const S = await build3(ctx); const P = prepSession(ctx, S); const D = prepDesk(ctx, S); return { S, P, D }; })();
    built.set(ctx, p);
  }
  return p;
}

export const act: Act = {
  id: 'A3',
  beats: {
    B09: async (ctx) => { const { S, P } = await stage(ctx); b09(ctx, S, P); },
    B10: async (ctx) => { const { S, P } = await stage(ctx); b10(ctx, S, P); },
    B11: async (ctx) => { const { S, P, D } = await stage(ctx); b11(ctx, S, P, D); },
    B12: async (ctx) => { const { S, D } = await stage(ctx); b12(ctx, S, D); },
    B13: async (ctx) => { const { S, D } = await stage(ctx); b13(ctx, S, D); }
  },
  async seamIn(ctx) {
    /* S2: the composer A2 carried in. Alone (?scene=a3) the act's own composer is the carry; in the film, if A2 hands over
       elements of its own (identical by contract: B09's key frame at rest), they give way to the act's on the seam frame
       (a hard set with no film.cut: the same pixels on both sides of it) */
    if (!ctx.has('B09')) return;
    const had = ctx.carry.composer;
    const { S } = await stage(ctx);
    const mine = { el: S.composer, session: S.plate };
    if (had && had.el !== mine.el) {
      for (const el of [had.el, had.session]) if (el && !S.gw.el.contains(el)) ctx.film.tl.set(el, { immediateRender: false, visibility: 'hidden' }, S.t0);
    }
    ctx.carry.composer = mine;
  },
  async seamOut(ctx) {
    /* S3: the desk for A4: the terminal at SEAMS desk.terminal, the open room's plate at desk.window (both world rects at
       32.000, the camera at rest), the nameless app and the window's dock waiting off-frame */
    if (!ctx.has('B13')) return;
    const { S } = await stage(ctx);
    ctx.carry.desk = { terminal: S.term, window: S.plate, app: S.app, dock: S.dock };
  }
};
