/* squircle: Apple's continuous corners, the same in every engine (owner decision, DESIGN-SYSTEM.md section 8).
   WebKit (Tauri's webview on Linux and macOS) has no `corner-shape`, so the corner is a path (squircle-path.ts).

   How a bound element draws it, by mode:
     clip      a LEAF control (button, icon button, send, the segmented thumb, a file chip): `clip-path: path()` on the
               element, and `::after` draws its 1px line (`--sq-line`) and its focus ring on a band of the same path.
     frame     every other bound surface: NOTHING is clipped (orbs, flags, popovers and shadows reach past the edge);
               `::before` paints the fill (`--sq-bg`) clipped to the path and `::after` the line and the focus ring.
     surface   a floating frame that keeps its elevation shadow (menus, popovers, tooltips, toasts, sheets).
     slab / concave   the dock's still slab and a flare: clipped, they hold no content.
   Owner rule: never `clip-path` a container whose content can overflow. Only `LEAF` clips, whoever asks.

   Cost. One shared ResizeObserver (border box): the browser runs its callback once per frame after layout, so a path
   is written in the same frame as its size (a card animating its height, the dock morphing, never show a stale clip),
   and every read happens before every write. Paths are cached by geometry, corner commands by radius (squircle-path.ts).
   Budget: 2 ms a frame for 200 bound elements (`stats()`; measured by the smoke suite).

   Crisp lines at any device pixel ratio: a native border snaps to device pixels, a clip path does not, so the path's
   straight edges are snapped inward to device pixels (from the element's place on screen) and the line is a whole number
   of device pixels thick. Positions change without a resize (a sidebar opening), so `resnap` re-reads them after
   transitions, animations, scrolling and layout.

   Nesting (DESIGN-SYSTEM.md §8.2): a drawn container (frame or surface) exposes the radius it draws as --r-outer when
   the radius it declares there is not that one (it declared none, so it would hand its children an ancestor's), so
   what sits in its corners derives --r-in, --r-corner and --corner-inset from the curve it actually sees. A capsule
   exposes half its height: a round piece inside a pill stays a pill. Read with the radii, written with the path. */
import { on } from '../core/bus';
import { concavePath, DEFAULT_SMOOTHING, slabPath, squirclePath } from './squircle-path';
import type { Radii } from './squircle-path';

export type SquircleMode = 'clip' | 'frame' | 'surface' | 'slab' | 'concave';
export interface BindOpts { mode?: SquircleMode | undefined }

interface State {
  mode: SquircleMode; w: number; h: number; x: number; y: number;
  r: readonly [number, number, number, number] | null; /** the radii as a cache key, read with them */ rk: string; key: string; ringKey: string; on: boolean; focusable: boolean; at: string | null;
  /** the --r-outer it declares or inherits (px, NaN for none), read with the radii; and the one this module exposed */
  declared: number; exposed: number;
}
interface Built { key: string; clip: string; edge?: string; outer?: string; inner?: (t: number) => string; ring?: string; t2?: number }
interface Snap { ox: number; oy: number; w: number; h: number; t: number; t2: number; D: number }
export interface SquircleStats { bound: number; cached: number; smoothing: number; frames: number; lastMs: number; maxMs: number; totalMs: number; snaps: number; snapMs: number }

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';
const SURFACE = '.ui-listbox, .ui-pop, .ui-tip, .ui-toast';
/** the leaf controls: nothing inside them reaches past their edge */
const LEAF = '.ui-btn, .ui-ib, .ui-seg__thumb, .ui-file';
/** the library's surfaces and the config diff's well (cards parts.ts diffWell); modules add theirs with `auto()` or `data-sq` */
const SELECTOR = '[data-sq], .ui-btn, .ui-ib, .ui-seg, .ui-seg__thumb, .ui-tab, .ui-row, .ui-option, .ui-request, .ui-file, ' +
  '.ui-slab, .ui-concave, ' + SURFACE + ', .cd-well';
const PATH_CACHE_MAX = 800;
const RADIUS_TOKENS = ['--r-xs', '--r-s', '--r-m', '--r-l', '--r-floor', '--corner-smoothing'] as const;

const state = new WeakMap<Element, State>();
const bound = new Set<Element>();
const cache = new Map<string, Built>();
const extra: Array<[string, SquircleMode | undefined]> = [];
const stats = { frames: 0, lastMs: 0, maxMs: 0, totalMs: 0, snaps: 0, snapMs: 0 };
let smoothing = DEFAULT_SMOOTHING;
let started = false;
let ro: ResizeObserver | null = null;

const px = (v: string): number => parseFloat(v) || 0;
const CONTAINER: ReadonlySet<SquircleMode> = new Set(['frame', 'surface']);
/** a corner-radius transition still running on el (the computed radius is then a frame on the way, not the declared one) */
function radiusAnimating(el: Element): Animation[] {
  if (typeof el.getAnimations !== 'function') return [];
  return el.getAnimations().filter((a) => 'transitionProperty' in a && /radius/.test((a as CSSTransition).transitionProperty));
}
function readRadii(el: Element, s: State): void {
  const cs = getComputedStyle(el);
  /* the radius mid-transition is not the one declared: do not draw or expose it (it would stick in --r-outer). Read again
     once the transition has finished, and keep what was read before until then */
  const running = radiusAnimating(el);
  if (running.length) {
    Promise.allSettled(running.map((a) => a.finished)).then(() => { if (el.isConnected && state.get(el) === s) { readRadii(el, s); s.key = ''; apply(el as HTMLElement, s); } });
    if (s.r) return;
  }
  s.r = [px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius)];
  s.rk = s.r.join(',');
  if (CONTAINER.has(s.mode)) { const d = cs.getPropertyValue('--r-outer').trim(); s.declared = /^-?[\d.]+px$/.test(d) ? parseFloat(d) : NaN; }
}
/** the drawn radius a container hands its children (written only when it changes and differs from what it declares) */
function expose(el: HTMLElement, s: State, w: number, h: number): void {
  if (!CONTAINER.has(s.mode) || !s.r) return;
  const r = Math.min(Math.max(...s.r), Math.min(w, h) / 2);
  const want = r > 0 && !(Math.abs(s.declared - r) < 0.5) ? Math.round(r * 100) / 100 : NaN;
  if (want === s.exposed || (Number.isNaN(want) && Number.isNaN(s.exposed))) return;
  if (Number.isNaN(want)) el.style.removeProperty('--r-outer'); else el.style.setProperty('--r-outer', want + 'px');
  s.exposed = want;
}
const dpr = (): number => window.devicePixelRatio || 1;

function snapOf(s: State): Snap {
  if (s.mode === 'slab' || s.mode === 'concave') return { ox: 0, oy: 0, w: Math.round(s.w * 2) / 2, h: Math.round(s.h * 2) / 2, t: 1, t2: 2, D: 1 };
  /* inward: a box paints its background only inside its own snapped rect, so a path edge outside that rect loses part
     of its line. Browsers snap that rect to device pixels, to whole CSS pixels and then scale, or not at all (a transformed box,
     such as the composer centred with translate); each edge goes to the innermost of the three, then inward to the next device pixel. The shape is at most about a device pixel inside. */
  const D = dpr(), e = 0.02;
  const lo = (a: number): number => Math.ceil(Math.max(Math.round(a) * D, Math.round(a * D), a * D) - e);
  const hi = (b: number): number => Math.floor(Math.min(Math.round(b) * D, Math.round(b * D), b * D) + e);
  const L = lo(s.x), T = lo(s.y), w = (hi(s.x + s.w) - L) / D, h = (hi(s.y + s.h) - T) / D;
  return { ox: Math.round((L / D - s.x) * 1000) / 1000, oy: Math.round((T / D - s.y) * 1000) / 1000, w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000, D, t: 1 / Math.max(1, D)   /* the line is one device pixel (v7's --hl; the approved boards' kit.js paint): 0.5 px on a 2x screen, never the whole CSS px */, t2: Math.max(1, Math.floor(2 * D + 1e-6)) / D };
}

function build(s: State, g: Snap): Built {
  const w = g.w, h = g.h, R = s.r ?? [0, 0, 0, 0] as const;
  /* the key is built every frame for every element whose size changed: plain numbers, no formatting. A concave flare's
     side (data-at) is in it: once drawn, both flares read radius 0, so a left and a right flare of one size would share a
     path, and the right one would curve the left way (Typewriter's 36px flares on WebKitGTK) */
  const key = s.mode + '|' + w + '|' + h + '|' + s.rk + (s.focusable ? '|1|' : '|0|') + smoothing + '|' + g.ox + '|' + g.oy + '|' + g.D + (s.mode === 'concave' ? '|' + s.at : '');
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > PATH_CACHE_MAX) cache.clear();
  let v: Built;
  if (s.mode === 'slab') v = { key, clip: 'path("' + slabPath(w, h, R[0], R[0], { x: 0, smoothing }) + '")' };
  else if (s.mode === 'concave') v = { key, clip: 'path("' + concavePath(Math.min(w, h), s.at === 'tl' ? 'tl' : 'tr') + '")' };
  else {
    const outer = squirclePath(w, h, R, { x: g.ox, y: g.oy, smoothing });
    const inner = (t: number): string => squirclePath(Math.max(0, w - 2 * t), Math.max(0, h - 2 * t), R.map((r) => Math.max(0, r - t)) as unknown as Radii, { x: g.ox + t, y: g.oy + t, smoothing });
    v = { key, clip: 'path("' + outer + '")', edge: 'path(evenodd, "' + outer + inner(g.t) + '")', outer, inner, t2: g.t2 };
  }
  cache.set(key, v);
  return v;
}

/** the focus ring's band is built when the element takes focus (or resizes while focused), not for every button */
function ring(el: HTMLElement, s: State, v: Built): void {
  if (s.ringKey === v.key || !v.outer || !v.inner) return;
  v.ring ??= 'path(evenodd, "' + v.outer + v.inner(v.t2 ?? 2) + '")';
  el.style.setProperty('--sq-ring', v.ring);
  s.ringKey = v.key;
}

function apply(el: HTMLElement, s: State): void {
  const g = snapOf(s), w = g.w, h = g.h;
  if (!(w >= 1 && h >= 1) || !s.r) return;
  expose(el, s, s.w, s.h);
  const half = Math.min(w, h) / 2;
  const allZero = s.r.every((r) => r === 0);
  /* a corner as round as half the element (a capsule, a circle) needs no path: the browser draws it */
  const native = s.mode !== 'slab' && s.mode !== 'concave' && s.r.every((r) => r >= half - 0.5 || r === 0) && !allZero;
  if (native || (allZero && s.mode !== 'concave')) {
    /* the path goes with the attribute: a stale --sq-clip would still be read as the element's outline (the lab's contain check, a preset change to a capsule) */
    if (s.on) { el.removeAttribute('data-sq-on'); for (const k of ['--sq-clip', '--sq-edge', '--sq-ring']) el.style.removeProperty(k); s.on = false; s.key = ''; }
    return;
  }
  const v = build(s, g);
  if (v.key === s.key) { if (s.focusable && el === document.activeElement) ring(el, s, v); return; }
  el.style.setProperty('--sq-clip', v.clip);
  if (v.edge) el.style.setProperty('--sq-edge', v.edge);
  s.key = v.key; s.ringKey = '';
  if (s.focusable && el === document.activeElement) ring(el, s, v);
  if (!s.on) { el.setAttribute('data-sq-on', ''); s.on = true; }
}

function onEntries(entries: ResizeObserverEntry[]): void {
  const t0 = performance.now();
  /* every read first (sizes from the entries, places, radii of new elements), then every write: no style thrash */
  const todo: Array<[HTMLElement, State]> = [];
  for (const e of entries) {
    const el = e.target as HTMLElement, s = state.get(el);
    if (!s) continue;
    const b = e.borderBoxSize?.[0];
    s.w = b ? b.inlineSize : el.offsetWidth; s.h = b ? b.blockSize : el.offsetHeight;
    const rc = el.getBoundingClientRect(); s.x = rc.left; s.y = rc.top;
    if (!s.r) readRadii(el, s);
    todo.push([el, s]);
  }
  for (const [el, s] of todo) apply(el, s);
  const ms = performance.now() - t0;
  stats.frames++; stats.totalMs += ms; stats.lastMs = ms; if (ms > stats.maxMs) stats.maxMs = ms;
}

function readSmoothing(): void {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--corner-smoothing'));
  smoothing = v >= 0 && v <= 1 ? v : DEFAULT_SMOOTHING;
}

/** bind one element (idempotent); the mode follows what the element is unless one is given */
export function bind(el: Element, o?: BindOpts): Element {
  if (!ro || state.has(el)) return el;
  let mode: SquircleMode = o?.mode ?? (el.getAttribute('data-sq-mode') as SquircleMode | null) ??
    (el.matches(SURFACE) ? 'surface' : el.matches('.ui-slab') ? 'slab' : el.matches('.ui-concave') ? 'concave' : el.matches(LEAF) ? 'clip' : 'frame');
  if (mode === 'clip' && !el.matches(LEAF)) mode = 'frame';   /* clip is for leaf controls only, whoever asks */
  const s: State = { mode, w: 0, h: 0, x: 0, y: 0, r: null, rk: '', key: '', ringKey: '', on: false, focusable: (mode === 'clip' || mode === 'frame') && el.matches(FOCUSABLE), at: el.getAttribute('data-at'), declared: NaN, exposed: NaN };
  state.set(el, s); bound.add(el);
  el.setAttribute('data-sq-mode', mode);
  ro.observe(el, { box: 'border-box' });
  return el;
}
export function unbind(el: Element): void {
  const s = state.get(el);
  if (!s) return;
  ro?.unobserve(el); state.delete(el); bound.delete(el);
  el.removeAttribute('data-sq-on'); el.removeAttribute('data-sq-mode');
  for (const k of ['--sq-clip', '--sq-edge', '--sq-ring']) (el as HTMLElement).style.removeProperty(k);
  if (!Number.isNaN(s.exposed)) (el as HTMLElement).style.removeProperty('--r-outer');
}

function scan(root: Element): void {
  for (const [sel, mode] of extra) { if (root.matches(sel)) bind(root, { mode }); for (const el of root.querySelectorAll(sel)) bind(el, { mode }); }
  if (root.matches(SELECTOR)) bind(root);
  for (const el of root.querySelectorAll(SELECTOR)) bind(el);
}

/** positions only: every bound element's place on screen, read first, then the paths whose snap changed */
let snapRaf = 0, snapTimer = 0;
function resnap(): void {
  snapRaf = 0;
  const t0 = performance.now(), todo: Array<[HTMLElement, State]> = [];
  for (const el of bound) {
    const s = state.get(el);
    if (!s || !s.on || s.mode === 'slab' || s.mode === 'concave' || !el.isConnected) continue;
    const rc = el.getBoundingClientRect();
    if (Math.abs(rc.left - s.x) > 0.004 || Math.abs(rc.top - s.y) > 0.004) { s.x = rc.left; s.y = rc.top; todo.push([el as HTMLElement, s]); }
  }
  for (const [el, s] of todo) apply(el, s);
  stats.snaps++; stats.snapMs = performance.now() - t0;
}
/** now (next frame) and again once motion has settled */
export function resnapSoon(): void {
  if (!snapRaf) snapRaf = requestAnimationFrame(resnap);
  clearTimeout(snapTimer);
  snapTimer = window.setTimeout(() => { if (!snapRaf) snapRaf = requestAnimationFrame(resnap); }, 420);
}

/** the radii tokens as the engine resolved them: a change (preset, corners, density, a custom theme) redraws every path */
let tokenSig = '';
const sigOf = (): string => { const cs = getComputedStyle(document.documentElement); return RADIUS_TOKENS.map((k) => cs.getPropertyValue(k)).join('|'); };
let refreshRaf = 0;
/** re-read every radius and the smoothing and redraw; `force` skips the check that a token changed */
export function refresh(force = true): void {
  cancelAnimationFrame(refreshRaf);
  refreshRaf = requestAnimationFrame(() => {
    refreshRaf = 0;
    const sig = sigOf();
    if (!force && sig === tokenSig) return;
    tokenSig = sig;
    readSmoothing();
    const t0 = performance.now();
    /* what this module exposed comes off first, so the declared radius is read fresh (one style pass, on a theme change) */
    for (const el of bound) { const s = state.get(el); if (s && !Number.isNaN(s.exposed)) { (el as HTMLElement).style.removeProperty('--r-outer'); s.exposed = NaN; } }
    for (const el of bound) { const s = state.get(el); if (!s) continue; if (!el.isConnected) { unbind(el); continue; } readRadii(el, s); s.key = ''; }
    for (const el of bound) { const s = state.get(el); if (s) apply(el as HTMLElement, s); }
    stats.lastMs = performance.now() - t0;
  });
}

/** bind every match now and as they appear; `data-sq` and the library's own surfaces are bound already */
export function auto(selector: string, o?: BindOpts): void {
  if (!selector) return;
  extra.push([selector, o?.mode]);
  if (started) scan(document.documentElement);
}

/** start observing the document (once, from main); a page without ResizeObserver keeps the browser's own corners */
export function startSquircle(): void {
  if (started || typeof ResizeObserver !== 'function') return;
  started = true;
  ro = new ResizeObserver(onEntries);
  readSmoothing(); tokenSig = sigOf();
  scan(document.documentElement);
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const nd of m.addedNodes) if (nd.nodeType === 1) scan(nd as Element);
      for (const nd of m.removedNodes) {
        if (nd.nodeType !== 1 || (nd as Element).isConnected) continue;
        const e = nd as Element;
        unbind(e);
        for (const x of e.querySelectorAll('[data-sq-mode]')) unbind(x);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  on('hx:theme', () => { refresh(true); });
  for (const ty of ['hx:layout', 'hx:dock', 'hx:state', 'hx:tab'] as const) on(ty, resnapSoon);
  for (const ty of ['transitionend', 'animationend', 'scrollend']) document.addEventListener(ty, resnapSoon, true);
  window.addEventListener('resize', resnapSoon);
  let scrollT = 0;
  document.addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = window.setTimeout(resnapSoon, 120); }, { capture: true, passive: true });
  document.fonts?.addEventListener?.('loadingdone', resnapSoon);
  /* the corner setting, the preset and the density change the radii (theme.ts sets these on <html>) */
  new MutationObserver(() => { refresh(false); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-hx-corners', 'data-hx-preset', 'data-hx-density', 'style'] });
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null, s = el ? state.get(el) : undefined;
    if (el && s?.on && s.focusable) ring(el, s, cache.get(s.key) ?? build(s, snapOf(s)));
  }, true);
}

export const squircle = {
  path: squirclePath, slab: slabPath, bind, unbind, auto, refresh, resnap: resnapSoon, start: startSquircle,
  stats: (): SquircleStats => ({ bound: bound.size, cached: cache.size, smoothing, ...stats }),
  get smoothing(): number { return smoothing; }
};
export type Squircle = typeof squircle;
