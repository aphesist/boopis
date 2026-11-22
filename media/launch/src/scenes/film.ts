/* The film on one stage and one timeline, and the views of it an animator works in.

     ?scene=film        the master, 46.933 s: A1, A2, A3, A4 in order on one context, so a carry crosses acts with no cut
     ?scene=a1 ... a4   one act alone: the same builders at the script's absolute times, the clip offset to the act's
                        start (frame 0 of a2 is 9.600 s); its incoming seam state is built by the act itself
     ?scene=cut15       the 15 s cut; ?scene=bumper6 the 6 s bumper (cutdowns.md, end card b): the beats' builders
                        re-timed by the edit (src/acts/edit.ts)
   Every view works in 16:9 and in 9:16 (&variant=vertical): the builders read ctx.variant. */
import { lookGround } from '../engine/look';
import { createCtx } from '../acts/context';
import { ACTS, actById } from '../acts';
import { runAct, span } from '../acts/act';
import { EDITS, MASTER } from '../acts/edit';
import type { Scene } from './types';

export function editScene(editId: string): Scene {
  const edit = EDITS[editId]!;
  return {
    config: { name: editId === 'master' ? 'film' : editId, duration: edit.duration, fps: 60, bpm: 112.5 },
    async build(film, stage) {
      lookGround(film, stage);
      const ctx = createCtx(film, stage, edit);
      for (const act of ACTS) await runAct(ctx, act);
    }
  };
}

export function actScene(actId: string): Scene {
  const act = actById(actId), { from, to } = span(act);
  return {
    config: { name: act.id.toLowerCase(), duration: to - from, offset: from, fps: 60, bpm: 112.5 },
    async build(film, stage) {
      lookGround(film, stage);
      const ctx = createCtx(film, stage, MASTER);
      await runAct(ctx, act);
    }
  };
}
