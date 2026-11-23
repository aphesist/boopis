/* The room "release" as act 2 takes it at S1 (SEAMS.md): the plate, the head, the thread (your request and the presence
   entry "kai thinking"), the composer, and the key frame's cursor. Act 2 wraps them, without moving anything on screen,
   in two boxes of its own: the room (which B08 maps into the window) and, inside it, the scroller (the product's own
   scroll column: the head and the log scroll, the composer stays). New entries are drawn with the art director's own
   parts (look/src/scenes/parts.ts), at the room's scale, and swapped to film orbs. */
import type { ActCtx } from '../context';
import { swapOrbs, type SwappedOrb } from '../../engine/look';
import { FilmOrb } from '../../engine/orb';
import { filmUI, h } from '../../../look/src/stage';
import { S1 as S1_, a2css, actEnd, box, styleFrom, visFrom } from './util';
import type { Box } from '../../motion/carry';

export interface Layout {
  v: boolean;
  /** the room's UI scale, its column's left and width (the product's px), the log's gap and the scroll edge's fade */
  X: number; L: number; W: number; gap: number; fade: number;
}
export const LAYOUT = (v: boolean): Layout => (v
  ? { v, X: 2.6, L: 60, W: 370, gap: 32 * 2.6, fade: 16 * 2.6 }
  : { v, X: 3, L: 130, W: 556, gap: 32 * 3, fade: 16 * 3 });

export interface Room {
  lay: Layout;
  scope: HTMLElement;
  wrap: HTMLElement;
  scroller: HTMLElement;
  plate: HTMLElement | null;
  head: HTMLElement;
  thread: HTMLElement;
  presence: HTMLElement;
  composer: HTMLElement;
  comp: HTMLElement;
  cursor: HTMLElement | null;
  /** kai's orb in the presence entry: act 1's film orb when it shares it, else act 2's own over it */
  kai: FilmOrb;
  /** the presence entry's world top at S1 (where kai's reply lands) */
  top0: number;
  /** world boxes at S1: the composer, its input and send button, the cursor */
  at: { comp: Box; input: Box; send: Box; cursor: Box | null };
  /** the incoming seam on this edit's clock */
  s1: number;
  orbs: Map<string, SwappedOrb>;
}

const place = (el: HTMLElement): HTMLElement => (el.closest<HTMLElement>('.ui-place') ?? el);

export async function takeRoom(ctx: ActCtx): Promise<Room> {
  a2css();
  /* the incoming seam on this edit's clock (S1 in the master; a cut-down's own start of B05) */
  const S1 = ctx.has('B05') ? ctx.win('B05').start : S1_;
  const film = ctx.film, stage = ctx.stage, lay = LAYOUT(ctx.variant === 'vertical');
  let mine: Map<string, SwappedOrb> | null = null;
  const carried = await ctx.take('room', async () => {
    const kf = await ctx.keyFrame('b04', { swapOrbs: false });
    mine = swapOrbs(film, kf);
    return { group: kf };
  });
  const g = carried.group;
  const scopeOf = (e: HTMLElement | undefined): HTMLElement | null => e?.closest<HTMLElement>('.film-keyframe') ?? null;
  const kfBox = scopeOf(carried.composer) ?? scopeOf(carried.head) ?? (g.classList.contains('film-keyframe') ? g : scopeOf(g)) ?? g;
  const q = <T extends HTMLElement>(s: string): T | null => kfBox.querySelector<T>(s);
  const head = place(carried.head ?? q('.room-head')!);
  const thread = place(carried.thread ?? q('.room-log')!);
  const presence = carried.presence ?? thread.querySelector<HTMLElement>('.ui-presence')!;
  const composer = place(carried.composer ?? q('.ui-composer')!);
  const comp = composer.querySelector<HTMLElement>('.ui-composer') ?? composer;
  const plate = g.classList.contains('plate') ? g : q('.plate--room');
  const cursor = q('.cursor');
  const scope = composer.parentElement!;

  /* measure at S1, as act 1 lands it (a fromTo renders its start at build: seek the timeline there, then put it back) */
  const prev = film.tl.time();
  film.tl.time(S1, true);
  const top0 = box(presence, stage).y;
  const input = comp.querySelector<HTMLElement>('.ui-composer__input')!, send = comp.querySelector<HTMLElement>('.ui-send')!;
  const at = { comp: box(comp, stage), input: box(input, stage), send: box(send, stage), cursor: cursor ? box(cursor, stage) : null };
  film.tl.time(prev, true);

  /* the room and the scroller: boxes at (0, 0) of act 1's own parent, so nothing moves when they take their children */
  const wrap = h('div', 'a2-room');
  const scroller = h('div', 'a2-scroller');
  const first = [plate, head, thread, composer].filter((e): e is HTMLElement => !!e && e.parentElement === scope)[0] ?? composer;
  scope.insertBefore(wrap, first);
  if (plate && plate.parentElement === scope) wrap.appendChild(plate);
  wrap.appendChild(scroller);
  for (const e of [head, thread]) if (e.parentElement === scope || e.parentElement === wrap) scroller.appendChild(e);
  wrap.appendChild(composer);

  /* 16:9: the plate bleeds past the frame on three sides; act 2's camera looks above and below it, so it grows (off
     screen) while its light keeps its place in the world (the gradient pinned to the plate's own box at S1) */
  if (plate && !lay.v) {
    const pr = { top: plate.offsetTop, h: plate.offsetHeight, w: plate.offsetWidth };
    const grow = 1600;
    styleFrom(film, plate, 'top', S1, () => (pr.top - grow) + 'px');
    styleFrom(film, plate, 'height', S1, () => (pr.h + grow * 2) + 'px');
    styleFrom(film, plate, 'background-size', S1, () => pr.w + 'px ' + pr.h + 'px');
    styleFrom(film, plate, 'background-position', S1, () => '0px ' + grow + 'px');
    styleFrom(film, plate, 'background-repeat', S1, () => 'no-repeat');
    styleFrom(film, plate, 'background-color', S1, () => 'var(--bg-2)');
  }
  /* the room is act 2's from S1: drawn, and never clipped by the key frame's box (the camera moves past it) */
  const end = actEnd(ctx);
  visFrom(film, kfBox, S1, (t) => t <= end + 1e-9);
  for (const e of [scope, wrap, head, thread, presence, composer]) if (e !== kfBox) visFrom(film, e, S1, (t) => t <= end + 1e-9);
  if (kfBox.classList.contains('stage')) styleFrom(film, kfBox, 'overflow', S1, () => 'visible');

  /* kai's orb in the presence entry: act 1's film orb when shared, else ours drawn over it from S1 */
  const holderIn = (m: Map<string, SwappedOrb> | null | undefined): SwappedOrb | undefined => m ? [...m.values()].find((o) => presence.contains(o.holder) && o.name.startsWith('kai')) : undefined;
  const shared = holderIn(ctx.carry.orbs) ?? holderIn(mine);
  let kai: FilmOrb;
  if (shared) kai = shared.orb;
  else {
    const holder = presence.querySelector<HTMLElement>('.film-orb-holder')!;
    const theirs = holder.querySelector<SVGSVGElement>('svg.film-orb')!;
    const size = Number(theirs.getAttribute('width') || 60);
    kai = new FilmOrb({ shape: 'circle', color: '#4fc9a8' }, size, { eyes: 'squint', yaw: 8, pitch: 5 });
    kai.el.style.position = 'absolute'; kai.el.style.left = '0'; kai.el.style.top = '0';
    holder.appendChild(kai.el);
    film.onRender(() => kai.render());
    visFrom(film, theirs, S1, () => false);
    film.onRender((t) => { const v = t >= S1 - 1e-9 ? '' : 'hidden'; if (kai.el.style.visibility !== v) kai.el.style.visibility = v; }, -10);
  }
  return { lay, scope, wrap, scroller, plate, head, thread, presence, composer, comp, cursor, kai, top0, at, s1: S1, orbs: (mine as Map<string, SwappedOrb> | null) ?? new Map() };
}

/** a new entry in the log, drawn with the art director's parts at the room's scale, placed at log y `y` */
export function entry(ctx: ActCtx, room: Room, content: string | Node, y: number): { el: HTMLElement; orbs: Map<string, SwappedOrb>; h: number } {
  const { lay } = room;
  const log = h('div', 'room-log');
  if (lay.v) log.dataset['margin'] = 'off';
  if (typeof content === 'string') log.insertAdjacentHTML('beforeend', content); else log.append(content);
  const f = filmUI(log, { x: lay.L, y, scale: lay.X, width: lay.W });
  room.scroller.appendChild(f.outer);
  const orbs = swapOrbs(ctx.film, f.outer);
  const hgt = box(f.outer, ctx.stage).h;
  return { el: f.outer, orbs, h: hgt };
}
