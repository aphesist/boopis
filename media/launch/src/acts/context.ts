/* The context every act builds with: one film, one stage, one camera, one edit, and the elements that carry across act
   boundaries. The film scene creates it once and hands it to A1, A2, A3 and A4 in turn; an act rendered alone, or a
   cut-down, gets one of its own.

     ctx.win('B05')                 the beat's window in this edit ({ start, end, dur }); in the master, script time
     ctx.has('B05')                 does this edit play the beat?
     ctx.world, ctx.front           the stage layer (depth 1) and the foreground (1.25, cursors and flags)
     ctx.cam                        the one camera (motion/camera.ts); at every act seam it is at rest (SEAMS.md)
     ctx.carry                      the elements that cross a seam (handles below); the outgoing act sets them, the
                                    incoming act takes them with ctx.take(), building its own when run alone
     ctx.showDuring(el, t0, t1)     el is drawn only in [t0, t1) (a hard cut at both ends; never an opacity)
     await ctx.keyFrame('b07')      the art director's key frame for a beat, built once per film */
import type { Film, Variant } from '../engine/film';
import type { Stage } from '../engine/stage';
import { keyFrame, swapOrbs, type SwappedOrb } from '../engine/look';
import { camera, type Camera } from '../motion/camera';
import { grid, type Grid } from '../motion/time';
import type { Edit, Window } from './edit';

/** what crosses each act boundary (SEAMS.md is the contract; seams.ts holds its numbers) */
export interface Carries {
  /** S1, A1 to A2 at 9.600 s (B04 to B05): the room "release" as one group in the stage layer: head, thread (your
      request, the presence entry "kai thinking"), composer */
  room?: { group: HTMLElement; head?: HTMLElement; thread?: HTMLElement; presence?: HTMLElement; composer?: HTMLElement };
  /** S2, A2 to A3 at 20.000 s (B08 to B09): your session's composer (Governed chip on, empty), carried across the tab
      change and pushed into */
  composer?: { el: HTMLElement; session?: HTMLElement };
  /** S3, A3 to A4 at 32.000 s (B13 to B14): the desk, three plates in the world: the terminal, the window with the open
      room, the nameless app, and the dock at the window's foot */
  desk?: { terminal: HTMLElement; window: HTMLElement; app?: HTMLElement; dock?: HTMLElement };
  /** film orbs by bot name, shared by every act (kai, nina, moss, vox) */
  orbs?: Map<string, SwappedOrb>;
}

export interface ActCtx {
  film: Film; stage: Stage; edit: Edit; variant: Variant;
  cam: Camera; g: Grid;
  world: HTMLElement; front: HTMLElement;
  carry: Carries;
  win(beat: string): Window;
  has(beat: string): boolean;
  take<K extends keyof Carries>(key: K, make: () => Carries[K] | Promise<Carries[K]>): Promise<NonNullable<Carries[K]>>;
  showDuring(el: HTMLElement, t0: number, t1: number): void;
  keyFrame(id: string, o?: { x?: number; y?: number; swapOrbs?: boolean }): Promise<HTMLElement>;
}

export function createCtx(film: Film, stage: Stage, edit: Edit): ActCtx {
  const world = stage.layer('stage', 1), front = stage.layer('front', 1.25);
  const cam = camera(film, stage);
  const frames = new Map<string, HTMLElement>();
  const ctx: ActCtx = {
    film, stage, edit, variant: film.variant, cam, g: grid(film), world, front, carry: {},
    win(id) {
      const w = edit.windows.find((x) => x.beat === id.toUpperCase());
      if (!w) throw new Error('edit ' + edit.id + ' does not play ' + id);
      return w.win;
    },
    has: (id) => edit.windows.some((x) => x.beat === id.toUpperCase()),
    async take(key, make) {
      if (ctx.carry[key] == null) ctx.carry[key] = await make();
      return ctx.carry[key] as NonNullable<Carries[typeof key]>;
    },
    showDuring(el, t0, t1) {
      el.style.visibility = 'hidden';
      film.onRender((t) => { const on = t >= t0 - 1e-9 && t < t1 - 1e-9; if ((el.style.visibility !== 'hidden') !== on) el.style.visibility = on ? '' : 'hidden'; }, -10);
      film.cut(t0); film.cut(t1);
    },
    async keyFrame(id, o = {}) {
      const key = id.toLowerCase() + '@' + (o.x ?? 0) + ',' + (o.y ?? 0);
      let kf = frames.get(key);
      if (!kf) {
        kf = await keyFrame(film, stage, id, { x: o.x ?? 0, y: o.y ?? 0, layer: world });
        kf.style.visibility = 'hidden';   /* drawn only where a builder shows it (showDuring) or moves it */
        if (o.swapOrbs !== false) swapOrbs(film, kf);
        frames.set(key, kf);
      }
      return kf;
    }
  };
  return ctx;
}
