/* What act 1's four beats share: the art director's key frames (b01 to b04, built once, in order, so each later one
   sits above the earlier), their orbs as film orbs by name, the film's ground, and every measurement taken before any
   tween moves anything (a fromTo renders its start at build, and getBoundingClientRect sees transforms). */
import type { ActCtx } from '../context';
import { swapOrbs, type SwappedOrb } from '../../engine/look';
import { boxOf, type Box } from '../../motion/carry';
import { poolOf, type Pool } from './util';

export type KfId = 'b01' | 'b02' | 'b03' | 'b04';
const IDS: [string, KfId][] = [['B01', 'b01'], ['B02', 'b02'], ['B03', 'b03'], ['B04', 'b04']];

export interface Measures {
  /** B02: the column of sign-in buttons, each button, its logo and label */
  col?: Box; btn: Box[]; logo: Box[];
  /** B03: the cards at rest, the orb wrap, the text block and the plan line's mark in each */
  card: Box[]; orb: Box[]; text: Box[]; mark: Box[];
  /** B04: the stack's slots, the plate */
  slot: Box[]; plate?: Box;
}
export interface A1State {
  kf: Partial<Record<KfId, HTMLElement>>;
  orbs: Partial<Record<KfId, Map<string, SwappedOrb>>>;
  pool: Partial<Record<KfId, Pool>>;
  ground: HTMLElement | null;
  m: Measures;
  /** the B01 to B02 dive: the origin of the buttons' fan in B02 (the column's centre), and when the dive starts */
  origin?: [number, number];
  diveStart?: number;
  /** when B02's key frame has nothing left on screen (its last lab mark has landed in a card) */
  kf2End?: number;
  /** B03 to B04: when the first orb leaves its card, and when each lands in the room's stack (by bot name) */
  flightStart?: number;
  landAt: Record<string, number>;
  /** when the last camera move written so far ends; where the long zoom across B02 and B03 starts */
  camFree?: number;
  camZoomFrom?: number;
}

const states = new WeakMap<ActCtx, A1State>();

export async function a1state(ctx: ActCtx): Promise<A1State> {
  const have = states.get(ctx);
  if (have) return have;
  const s: A1State = { kf: {}, orbs: {}, pool: {}, ground: ctx.stage.ground.querySelector<HTMLElement>('.ground'), m: { btn: [], logo: [], card: [], orb: [], text: [], mark: [], slot: [] }, landAt: {} };
  states.set(ctx, s);
  for (const [beatId, id] of IDS) {
    if (!ctx.has(beatId)) continue;
    const kf = await ctx.keyFrame(id, { swapOrbs: false });
    s.kf[id] = kf;
    s.orbs[id] = swapOrbs(ctx.film, kf);
    s.pool[id] = poolOf(kf);
  }
  const st = ctx.stage, m = s.m;
  if (s.kf.b02) {
    const kf = s.kf.b02;
    const col = kf.querySelector<HTMLElement>('.ui-place');
    if (col) m.col = boxOf(col, st);
    for (const b of kf.querySelectorAll<HTMLElement>('.ui-sso')) {
      m.btn.push(boxOf(b, st));
      m.logo.push(boxOf(b.querySelector('.ui-sso__logo')!, st));
    }
  }
  if (s.kf.b03) {
    for (const c of s.kf.b03.querySelectorAll<HTMLElement>('.castcard')) {
      m.card.push(boxOf(c, st));
      m.orb.push(boxOf(c.querySelector('.orb')!, st));
      m.text.push(boxOf(c.querySelector('.nm')!.parentElement!, st));
      m.mark.push(boxOf(c.querySelector('.pl > span')!, st));
    }
  }
  if (s.kf.b04) {
    for (const o of s.kf.b04.querySelectorAll<HTMLElement>('.room-head .ui-stack__one')) m.slot.push(boxOf(o, st));
    const p = s.kf.b04.querySelector<HTMLElement>('.plate--room');
    if (p) m.plate = boxOf(p, st);
  }
  return s;
}
