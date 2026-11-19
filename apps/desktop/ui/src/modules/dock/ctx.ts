/* The dock's shared state. One black slab flush to the window's bottom edge; its outline is one SVG path rebuilt
   every frame from the sprung width and height, so the concave flares follow every morph. Content lives in "views"
   (min, norm, exp, card, edit) anchored to the slab's bottom centre; an element that exists in two views carries the
   same data-k key in both, and on any state change the dock measures every keyed element before and after and
   springs it from where it was to where it belongs (FLIP with springs that keep their velocity when interrupted).
   Live <orb-avatar> elements are re-parented into the visible slot, never re-created. */
import { clamp, onReducedChange, reduced as rm } from '../../core/dom';
import type { Bot, RunSnapshot, Schedule, ThreadMessage, Wait } from '../../data';
import type { DockMode } from '../../core/bus';
import type { ComposerEl } from '../../components';
import type { CardLike } from '../../components';
import { pagesFor, presenceOf } from './presence';
import type { Presence } from './presence';

/* springs: near-critical damping (no visible overshoot); interrupted springs keep their velocity */
export interface Spring { x: number; v: number; t: number; k: number; c: number; eps: number }
export const spring = (x: number, k: number, z = 1, eps = 0.05): Spring => ({ x, v: 0, t: x, k, c: 2 * z * Math.sqrt(k), eps });
export const stepS = (s: Spring, h: number): void => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * h; s.x += s.v * h; };
export const atRest = (s: Spring): boolean => Math.abs(s.x - s.t) < s.eps && Math.abs(s.v) < s.eps * 4;
export const snapS = (s: Spring, t?: number): void => { if (t !== undefined) s.t = t; s.x = s.t; s.v = 0; };
export { clamp };

/* morph springs: critically damped (no overshoot); ω ≈ 22 settles in ≈ 300ms, the shell's --dur-3.
   Travel along the centre line is never a JS spring: it rides --hx-center-x or a CSS transition. */
export const K_SLAB = 480, K_FLIP = 480, K_SINK = 400, K_SLIDE = 440, K_DOT = 520;
/** a hovered row looks toward the pointer through a clamp (about 20 degrees): no face turns away to its rim */
export const LOOK_X = 72, LOOK_Y = 40;
export const LOG_N = 4;   /* messages a dock session shows */
export const MAG = 1.42, MAG_ADD = 1.22, SIG = 58;
/** "Grow bots on hover" (owner setting, default on): the hovered or focused orb grows. With motion the row magnifies
    (neighbours shift smoothly, the slab follows on its spring); a focused orb, and under reduced motion a hovered
    one, grows alone (neighbours stay put, the slab keeps its width), at once under reduced motion and over about
    100ms otherwise, never with a bounce. Off: nothing grows; the switcher keeps its ring. */
export const GROW = 1.22, GROW_ADD = 1.1;
export const EASE = 'cubic-bezier(.2,.8,.2,1)';
export const PREF_KEY = 'hx.dock.v6';

export type PageId = 'bots' | 'run' | 'wait' | 'sched' | 'ctx';
export const PAGE_NAME: Record<string, string> = { bots: 'Bots', run: 'Run', wait: 'Needs you', sched: 'Scheduled', ctx: 'Context', edit: 'Arrange' };
export const PAGE_IDS: readonly PageId[] = ['bots', 'run', 'wait', 'sched', 'ctx'];
export const DEFAULT_PAGES: ReadonlyArray<{ id: PageId; on: boolean }> = [{ id: 'bots', on: true }, { id: 'run', on: true }, { id: 'wait', on: true }, { id: 'sched', on: true }, { id: 'ctx', on: false }];

export interface DockBot extends Bot { paused: boolean }
export interface DockState {
  mode: DockMode;
  page: string;
  card: string | null; cardFrom: 'normal' | 'expanded';
  pages: Array<{ id: string; on: boolean }>;
  /** a session has been started in this window (the run had a title once); it stays, so the latest run is what the session part shows */
  session: boolean;
  bots: DockBot[]; waits: Wait[]; sched: Schedule[]; run: RunSnapshot | null; ctx: { used: number; total: number; parts: ReadonlyArray<readonly [string, number]> };
  ext: Record<string, number>; colWidth: number | null; rowIdx: number; restore: 'normal' | 'minimal'; hover: boolean; hoverT: number; grow: boolean; focusIn?: boolean;
  threads: Record<string, ThreadMessage[]>;
}
export const S: DockState = {
  mode: 'normal', page: 'bots', card: null, cardFrom: 'normal', pages: DEFAULT_PAGES.map((p) => ({ ...p })),
  session: false, bots: [], waits: [], sched: [], run: null, ctx: { used: 0, total: 1, parts: [] },
  ext: {}, colWidth: null, rowIdx: 0, restore: 'normal', hover: false, hoverT: 0, grow: true, threads: {}
};

/** reduced motion: a size changes at once, nothing slides, entrances fade (reduce, never freeze) */
export const motion = { reduce: rm(), timeScale: 1 };
onReducedChange((v) => { motion.reduce = v; });

/* the dock's elements; detached placeholders until build() runs, so no module needs a null check */
const ph = (): HTMLElement => document.createElement('div');
export interface Els {
  root: HTMLElement; shapeEl: SVGSVGElement; pathEl: SVGPathElement; stageEl: HTMLElement; footEl: HTMLElement; dotsEl: HTMLElement; downBtn: HTMLElement;
  pageEls: Record<string, HTMLElement>;
  orbs: Map<string, HTMLElement>;
  curView: HTMLElement | null;
  composerEls: Map<string, ComposerEl>;
  cardEls: Map<string, CardLike>;
}
export const X: Els = {
  root: ph(), shapeEl: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
  stageEl: ph(), footEl: ph(), dotsEl: ph(), downBtn: ph(), pageEls: {}, orbs: new Map(), curView: null, composerEls: new Map(), cardEls: new Map()
};
/** `setting`: the user's "Show the dock". `afterOut`: what to clear once the dock has sunk out of sight (what it was showing stays until then) */
export const flags = { mounted: false, layoutSeen: false, offSeq: 0, useVar: false, setting: true, afterOut: null as (() => void) | null };
/** which parts of the dock exist now (presence.ts) */
export const presence = (): Presence => presenceOf({ bots: S.bots.length, session: S.session, setting: flags.setting });
export const botById = (id: string | null | undefined): DockBot | undefined => S.bots.find((b) => b.id === id);
/** the pages the dock shows: the arranged ones whose part exists (presence.ts) */
export const shownPages = (): string[] => pagesFor(S.pages, presence());
export const rendered = (el: Element): boolean => el.getClientRects().length > 0;
export const attCount = (): number => {
  let ext = 0;
  for (const [src, n] of Object.entries(S.ext)) if (src !== 'dock') ext += +n || 0;
  return Math.max(S.waits.length, ext);
};
export const ctxPct = (): number => Math.round(S.ctx.used / (S.ctx.total || 1) * 100);
export const clock = (): string => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

/* the slab (LAYOUT.md section 1): top corners and concave flares share --r-l (the theme customizer's corner setting changes it) */
export const geomR = { R_TOP: 14, FLARE: 14 };
export function readRadius(): void {
  const r = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-l'));
  if (r > 0) { geomR.R_TOP = r; geomR.FLARE = r; }
}
