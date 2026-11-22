/* An act: a run of the script's beats, one builder per beat, plus the seams it owns. The film scene runs the four acts
   in order on one context; an act scene runs one alone (its own clock offset to the act's start); a cut-down runs the
   builders of the beats its edit plays. */
import type { ActCtx } from './context';
import type { BeatBuilder } from './placeholder';
import { beat } from '../motion/beats';

export interface Act {
  id: 'A1' | 'A2' | 'A3' | 'A4';
  /** one builder per beat this act owns, by beat id (B01 ...) */
  beats: Record<string, BeatBuilder>;
  /** what the act leaves for the next one at its outgoing seam (SEAMS.md): it sets ctx.carry; runs after its beats */
  seamOut?: (ctx: ActCtx) => void | Promise<void>;
  /** what it takes from the previous act at its incoming seam (and builds itself when run alone): runs before */
  seamIn?: (ctx: ActCtx) => void | Promise<void>;
}

/** the act's span in the master (its first beat's start to its last beat's end) */
export function span(act: Act): { from: number; to: number } {
  const ids = Object.keys(act.beats);
  return { from: beat(ids[0]!).start, to: beat(ids[ids.length - 1]!).end };
}

/** build an act's beats that the context's edit plays, in edit order */
export async function runAct(ctx: ActCtx, act: Act): Promise<void> {
  if (act.seamIn) await act.seamIn(ctx);
  for (const w of ctx.edit.windows) {
    const b = act.beats[w.beat];
    if (b) await b(ctx);
  }
  if (act.seamOut) await act.seamOut(ctx);
}
