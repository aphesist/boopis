/* The dock's engine: the slab's geometry and springs, magnification, and the morph (FLIP with springs that keep their
   velocity when interrupted). Content that has no counterpart fades (exits in 120 ms, entrances in 220 ms); nothing is
   clipped at rest. Motion (owner decision, v10): the slab and its content change in the same frame and nothing leaves
   the slab while it travels; under reduced motion every size change is instant (entrances fade in 140ms), nothing
   slides, nothing overshoots.

   Where the motion runs (ADR-0025): what travels as a spring and has a known end (the keyed elements of a morph, the page
   dots, a page sliding in and out) is a Web Animation of `transform` / `translate` sampled from the spring's closed form
   (core/spring.ts), so the compositor thread plays it and a busy main thread cannot drop a frame of it. Only what must
   follow live input stays in this file's per-frame loop: the slab's outline (a path whose corners depend on its size),
   the magnification under the pointer, and a page dragged by touch. That loop writes transforms and one path, and reads
   nothing from layout. */
import { emit } from '../../core/bus';
import { $$ } from '../../core/dom';
import { ui } from '../../components';
import {
  EASE, GROW, GROW_ADD, K_DOT, K_FLIP, K_SINK, K_SLAB, K_SLIDE, MAG, MAG_ADD, S, SIG, X, atRest, clamp, flags, geomR, motion, rendered, shownPages, snapS, spring, stepS
} from './ctx';
import type { Spring } from './ctx';
import { setOrbLife } from './orbs';
import { holdOutsideDock, releaseOutsideDock } from '../../components/orb-runtime';
import { springAt, springElapsed, springKeyframes } from '../../core/spring';
import type { Channel, SpringParams } from '../../core/spring';
import { fillCards, relocateLive, renderView, viewKey } from './views';
import { syncRoving } from './roving';
import { PAGE_NAME } from './ctx';

/* ───────── springs and the dock's moving parts ───────── */
/** a spring played as a Web Animation: what it started from (so its state at any time is known without reading the page) */
export interface Flip { el: HTMLElement; an: Animation; delay: number; p: SpringParams; ch: readonly Channel[]; target?: number }
export interface FlipState { x: number; y: number; s: number; vx: number; vy: number; vs: number }
interface MagItem { el: HTMLElement; c: number; w: number; hgt: number; max: number; m: number; g: number; off: number }
export const E = {
  slabW: spring(0, K_SLAB, 1, 0.05), slabH: spring(0, K_SLAB, 1, 0.05), sinkS: spring(0, K_SINK, 1, 0.05), dotS: spring(0, K_DOT, 1, 0.05),
  baseW: 0, baseH: 0, magE: 0, magLift: 0, magItems: [] as MagItem[], magPX: null as number | null, magOn: false, lastItem: null as HTMLElement | null,
  anims: new Map<string, Flip>(), slides: new Map<string, Spring>(), slideAn: new Map<string, Flip>(), raf: 0, lastT: 0,
  pending: [] as Array<{ el: HTMLElement; i: number; t0: number; needH: number; needW: number }>,
  drag: { x: 0, on: false, timer: 0, lock: 0, pid: null as number | null, sx: 0, sy: 0, axis: null as 'x' | 'y' | null, hist: [] as Array<[number, number]> },
  cameFrom: null as Element | null
};
type Leaving = HTMLElement & { _leave?: Animation | null };
/** the views fading out as the slab moves (counted here, so the frame never queries the DOM for them) */
const leaving = new Set<HTMLElement>();
type Sec = HTMLElement & { _fade?: Animation | null };

export const hideTip = (): void => { try { ui.tooltip.hide(); } catch { /* none */ } };

/* ───────── geometry ───────── */
function geom(w: number, h: number): { R: number; Fw: number } {
  const R = Math.min(geomR.R_TOP, h / 2, w / 2);
  const F = clamp(Math.min(geomR.FLARE, h - R), 0, geomR.FLARE);
  return { R, Fw: F };
}
/* the slab as one path: concave flare out of the edge, side, rounded top, side, flare back into the edge. In svg
   space the slab body spans x ∈ [F, F + w]. The library draws the same continuous corner every other surface takes
   (squircle-path.ts); the minimised pill is a pill in a pill: R = h / 2 with round ends. */
function slabPath(w: number, h: number, g: { R: number; Fw: number }): string {
  const pill = S.mode === 'minimal' || S.mode === 'off';
  return ui.shape.slab(w, h, pill ? Math.min(h / 2, w / 2) : g.R, g.Fw, pill ? { round: true } : undefined);
}
/* centring: the dock rides the shell's animated --hx-center-x (left: var(...)), so it moves on the very curve the
   composer uses; without it, hx:layout.centerX is set as --dk-cx and a CSS transition runs */
export const cxNow = (): number => X.root.getBoundingClientRect().left;
/* Whether the shell publishes the centre line. `--hx-center-x` is a registered property with an initial value, so once the
   shell is there the answer never goes back to no: it is read (a forced style recalculation of the whole page, after the
   shell has just rewritten every layout property) until it is yes, and not again. */
let shellVarSeen = false;
export const shellVar = (): boolean => (shellVarSeen ||= !!getComputedStyle(X.root).getPropertyValue('--hx-center-x').trim());
export function anchor(): { x: number; y: number } { const r = X.stageEl.getBoundingClientRect(); return { x: r.left, y: r.top }; }
function relRect(el: Element, a: { x: number; y: number }): { l: number; b: number; w: number; h: number } { const r = el.getBoundingClientRect(); return { l: r.left - a.x, b: a.y - r.bottom, w: r.width, h: r.height }; }

export function kick(): void { if (!E.raf && flags.mounted) { E.lastT = performance.now(); E.raf = requestAnimationFrame(frame); } }
function frame(now: number): void {
  E.raf = 0;
  holdOutsideDock();
  const dt = Math.min(0.05, Math.max(0, (now - E.lastT) / 1000)) * motion.timeScale;
  E.lastT = now;
  const magBusy = stepMag(dt);
  E.slabW.t = E.baseW + E.magE;
  E.slabH.t = (S.mode === 'off' ? 0 : E.baseH) + E.magLift;
  const springs = [E.slabW, E.slabH, E.sinkS, E.dotS, ...E.slides.values()];
  if (motion.reduce) for (const s of springs) snapS(s);      /* reduced motion: a size changes at once; nothing slides */
  else {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) for (const s of springs) stepS(s, h);
  }
  let busy = magBusy;
  for (const s of springs) { if (atRest(s)) snapS(s); else busy = true; }
  if (flushEnter(now)) busy = true;
  for (const [p, s] of E.slides) if (atRest(s) && s.t === 0) { const pe = X.pageEls[p]; if (pe) pe.style.translate = ''; E.slides.delete(p); }
  paint();
  if (busy) E.raf = requestAnimationFrame(frame);
  else settled();
}

/* ───────── springs as Web Animations ───────── */
const FLIP_P: SpringParams = { k: K_FLIP };
const DOT_P: SpringParams = { k: K_DOT };
const SLIDE_P: SpringParams = { k: K_SLIDE };
const px = (n: number): string => n.toFixed(2);
const tf = ([x = 0, y = 0, s = 0]: number[]): Keyframe => ({ transform: `translate(${px(x)}px,${px(y)}px) scale(${(s + 1).toFixed(4)})` });
/** play a sampled spring on `el`. `fill: backwards` holds the first pose through a delay (a stagger). */
function playSpring(el: HTMLElement, p: SpringParams, ch: readonly Channel[], make: (v: number[]) => Keyframe, delay: number): Animation | null {
  const play = springKeyframes(p, ch, make);
  if (play.duration <= 0) return null;
  const an = el.animate(play.keyframes, { duration: play.duration, delay, easing: 'linear', fill: 'backwards' });
  if (motion.timeScale !== 1) an.playbackRate = motion.timeScale;
  return an;
}
/** the state of a running spring now, from its closed form: no layout read, no style read */
export function flipState(f: Flip): FlipState {
  if (f.an.playState === 'finished' || f.an.playState === 'idle') return { x: 0, y: 0, s: 0, vx: 0, vy: 0, vs: 0 };
  const t = springElapsed(f.an, f.delay) / 1000, at = (c: Channel | undefined): { x: number; v: number } => (c ? springAt(f.p, c.x0, c.v0 ?? 0, t) : { x: 0, v: 0 });
  const a = at(f.ch[0]), b = at(f.ch[1]), c = at(f.ch[2]);
  return { x: a.x, y: b.x, s: c.x, vx: a.v, vy: b.v, vs: c.v };
}
/** the velocities of every running keyed animation, taken before they are cancelled for the next measurement */
function carryOf(): Map<string, FlipState> { const m = new Map<string, FlipState>(); for (const [k, f] of E.anims) m.set(k, flipState(f)); return m; }
function endFlip(k: string, f: Flip): void { if (E.anims.get(k) === f) E.anims.delete(k); try { f.an.cancel(); } catch { /* gone */ } }
export function cancelFlips(): void { for (const [k, f] of [...E.anims]) endFlip(k, f); }
function startFlip(k: string, el: HTMLElement, p: SpringParams, ch: readonly Channel[], delay: number): void {
  const an = playSpring(el, p, ch, tf, delay);
  if (!an) return;
  const f: Flip = { el, an, delay, p, ch };
  E.anims.set(k, f);
  const done = (): void => { if (E.anims.get(k) === f) { E.anims.delete(k); kick(); } };
  an.onfinish = done; an.oncancel = done;
}
/** a page sliding along the slab: from `x0` (with velocity `v0`) to `target`, as a `translate` animation. The page's own
    `translate` is the one thing that moves, so it composes with the centring `transform` it already has. */
export function slideTo(page: string, el: HTMLElement, x0: number, v0: number, target: number, o: { hold?: boolean } = {}): void {
  stopSlide(page); E.slides.delete(page);
  const ch = [{ x0: x0 - target, v0, eps: 0.1 }];
  const play = springKeyframes(SLIDE_P, ch, ([x]) => ({ translate: `${px(target + (x as number))}px 0` }));
  if (play.duration <= 0) { el.style.translate = target ? `${px(target)}px 0` : ''; return; }
  const an = el.animate(play.keyframes, { duration: play.duration, easing: 'linear', fill: o.hold ? 'both' : 'backwards' });
  if (motion.timeScale !== 1) an.playbackRate = motion.timeScale;
  const f: Flip = { el, an, delay: 0, p: SLIDE_P, ch, target };
  E.slideAn.set(page, f);
  /* a page that slid away holds its last position until it is put away (its fade has hidden it long before) */
  const done = (): void => { if (E.slideAn.get(page) === f) { E.slideAn.delete(page); if (o.hold) { try { an.cancel(); } catch { /* gone */ } } kick(); } };
  an.onfinish = done; an.oncancel = done;
}
export function stopSlide(page: string): void { const f = E.slideAn.get(page); if (f) { E.slideAn.delete(page); try { f.an.cancel(); } catch { /* gone */ } } }
/** where the page's slide is now (a drag's own spring, or a running animation), and how fast it moves */
export function slideNow(page: string): { x: number; v: number } | null {
  const js = E.slides.get(page); if (js) return { x: js.x, v: js.v };
  const f = E.slideAn.get(page); if (!f) return null;
  const st = flipState(f);
  return { x: (f.target ?? 0) + st.x, v: st.vx };
}
export const sliding = (page: string): boolean => E.slides.has(page) || E.slideAn.has(page);
export function paint(): void {
  const w = Math.max(0, E.slabW.x), h = Math.max(0, E.slabH.x);
  if (h < 0.5 || w < 1) { X.pathEl.setAttribute('d', ''); }
  else {
    const g = geom(w, h);
    X.shapeEl.setAttribute('width', (w + 2 * g.Fw).toFixed(2));
    X.shapeEl.setAttribute('height', h.toFixed(2));
    X.shapeEl.style.transform = `translate3d(${(-w / 2 - g.Fw).toFixed(2)}px,0,0)`;
    X.pathEl.setAttribute('d', slabPath(w, h, g));
  }
  const sink = Math.abs(E.sinkS.x) > 0.01 ? E.sinkS.x : 0;
  X.stageEl.style.transform = sink ? `translate3d(0,${sink.toFixed(2)}px,0)` : '';
  X.footEl.style.width = `${w.toFixed(2)}px`;
  for (const [p, s] of E.slides) { const pe = X.pageEls[p]; if (pe) pe.style.translate = `${s.x.toFixed(2)}px 0`; }
  /* while anything travels, the content is held inside the slab (16px of headroom for the orbs' paint), so the black
     shape and what it carries never part; at rest nothing is clipped */
  const moving = !motion.reduce && h > 0.5 && (E.anims.size > 0 || E.slides.size > 0 || E.slideAn.size > 0 || E.pending.length > 0 || !atRest(E.slabW) || !atRest(E.slabH) || leaving.size > 0);
  const clip = moving ? `polygon(${(-w / 2).toFixed(1)}px ${(-(h + sink + 16)).toFixed(1)}px, ${(w / 2).toFixed(1)}px ${(-(h + sink + 16)).toFixed(1)}px, ${(w / 2).toFixed(1)}px 4px, ${(-w / 2).toFixed(1)}px 4px)` : '';
  if (X.stageEl.style.clipPath !== clip) X.stageEl.style.clipPath = clip;
  paintMag();
}
function settled(): void {
  releaseOutsideDock();
  tidy();
  if (S.mode === 'off' && !X.root.classList.contains('is-gone')) {
    X.root.classList.add('is-gone');
    X.root.inert = true;
    X.root.setAttribute('aria-hidden', 'true');
  }
}

/* ───────── magnification (macOS-style) ───────── */
export function cacheMag(): void {
  const keep = new Map(E.magItems.map((it) => [it.el, it.m])), keepG = new Map(E.magItems.map((it) => [it.el, it.g]));
  for (const it of E.magItems) it.el.style.transform = '';
  E.magItems = [];
  const cv = X.curView;
  if (cv && cv.dataset['view'] === 'bots:norm' && S.mode === 'normal') {
    const vw = cv.offsetWidth;
    for (const el of $$('.dk-bot, .dk-add', cv)) {
      E.magItems.push({ el, c: -vw / 2 + el.offsetLeft + el.offsetWidth / 2, w: el.offsetWidth, hgt: el.offsetHeight, max: el.classList.contains('dk-add') ? MAG_ADD : MAG, m: keep.get(el) ?? 1, g: keepG.get(el) ?? 1, off: 0 });
    }
  }
}
function stepMag(dt: number): boolean {
  if (!E.magItems.length) { E.magE = 0; E.magLift = 0; return false; }
  const growOn = S.grow && S.mode === 'normal' && S.page === 'bots' && !E.drag.on;
  /* magnification (the row's sizes follow the pointer) is motion: only with motion allowed */
  const active = growOn && !motion.reduce && E.magOn && E.magPX != null;
  const k = motion.reduce ? 1 : dt > 0 ? 1 - Math.exp(-dt * 20) : 1;
  const kg = motion.reduce ? 1 : dt > 0 ? 1 - Math.exp(-dt * 32) : 1;          /* ~100ms, no overshoot */
  const act = document.activeElement;
  const focused = growOn && act && X.curView && X.curView.contains(act) && act.matches(':focus-visible') ? act : null;
  const hovered = growOn && motion.reduce && E.magOn ? E.lastItem : null;
  let busy = false, Esum = 0, lift = 0;
  for (const it of E.magItems) {
    const tgt = active ? 1 + (it.max - 1) * Math.exp(-Math.pow(((E.magPX as number) - it.c) / SIG, 2)) : 1;
    it.m += (tgt - it.m) * k;
    if (Math.abs(tgt - it.m) < 0.0015) it.m = tgt; else busy = true;
    const gt = it.el === focused || it.el === hovered ? (it.max === MAG_ADD ? GROW_ADD : GROW) : 1;
    it.g += (gt - it.g) * kg;
    if (Math.abs(gt - it.g) < 0.0015) it.g = gt; else busy = true;
    Esum += (it.m - 1) * it.w;
    lift = Math.max(lift, (it.m - 1) * it.hgt);
  }
  E.magE = Esum; E.magLift = lift * 0.5;
  return busy;
}
function paintMag(): void {
  let acc = 0;
  for (const it of E.magItems) {
    const e = (it.m - 1) * it.w, off = acc + e / 2 - E.magE / 2;
    acc += e; it.off = off;
    const sc = Math.max(it.m, it.g);         /* a lone grow scales in place and never moves a neighbour */
    it.el.style.transform = (sc === 1 && Math.abs(off) < 0.01) ? '' : `translate3d(${off.toFixed(2)}px,0,0) scale(${sc.toFixed(4)})`;
  }
}
export function resetMag(): void {
  E.magOn = false; E.magPX = null; X.root.removeAttribute('data-mag');
  for (const it of E.magItems) { it.m = 1; it.g = 1; it.off = 0; it.el.style.transform = ''; }
  E.magE = 0; E.magLift = 0;
}

/* ───────── the morph engine ───────── */
interface KeyRect { el: HTMLElement; x: number; y: number; w: number; h: number }
function snapKeys(a: { x: number; y: number }, clear: boolean): Map<string, KeyRect> {
  const m = new Map<string, KeyRect>();
  const els = $$('[data-k]', X.root).filter((el) => !el.closest('.is-leaving') && rendered(el));
  if (clear) { cancelFlips(); for (const el of els) el.style.transform = ''; }
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    m.set(el.dataset['k'] ?? '', { el, x: r.left + r.width / 2 - a.x, y: r.top + r.height / 2 - a.y, w: r.width, h: r.height });
  }
  return m;
}
export function showView(key: string): HTMLElement | null {
  const p = key.split(':')[0] ?? '';
  for (const [id, sec] of Object.entries(X.pageEls)) {
    if (id === p) { cancelOut(sec as Sec); sec.hidden = false; }
    else if (!sec.classList.contains('is-out')) sec.hidden = true;
  }
  let target: HTMLElement | null = null;
  for (const v of X.pageEls[p]?.querySelectorAll<HTMLElement>(':scope > .dk-view') ?? []) {
    if (v.dataset['view'] === key && !v.classList.contains('is-ghost')) { cancelLeave(v); v.hidden = false; target = v; }
    else if (!v.classList.contains('is-leaving')) v.hidden = true;
  }
  return target;
}
type Rect = { l: number; b: number; w: number; h: number };
function leave(view: Leaving, rect: Rect | null, last: Map<string, KeyRect>): void {
  if (!view || !rect || motion.reduce) { if (view && view.classList.contains('is-ghost')) { leaving.delete(view); view.remove(); } return; }
  const sec = view.parentElement as HTMLElement;
  view.hidden = false;
  view.classList.add('is-leaving'); leaving.add(view);
  Object.assign(view.style, { left: `calc(50% + ${rect.l.toFixed(1)}px)`, bottom: `${rect.b.toFixed(1)}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  for (const el of view.querySelectorAll<HTMLElement>('[data-k]')) if (last.has(el.dataset['k'] ?? '')) el.classList.add('is-handed');
  if (sec !== X.pageEls[X.curView ? (X.curView.dataset['view'] ?? '').split(':')[0] ?? '' : S.page]) { sec.hidden = false; sec.classList.add('is-out'); }
  const an = view.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: 'cubic-bezier(0,0,.2,1)', fill: 'forwards' });
  an.playbackRate = motion.timeScale;
  view._leave = an;
  an.onfinish = () => finishLeave(view);
}
function finishLeave(view: Leaving): void {
  leaving.delete(view);
  if (view._leave) { try { view._leave.cancel(); } catch { /* gone */ } view._leave = null; }
  if (view.classList.contains('is-ghost')) view.remove();
  else {
    view.classList.remove('is-leaving');
    view.style.left = view.style.bottom = view.style.width = view.style.height = '';
    for (const el of view.querySelectorAll('.is-handed')) el.classList.remove('is-handed');
    if (view !== X.curView) view.hidden = true;
  }
  const sec = view.parentElement as Sec | null;
  if (sec && sec.classList.contains('is-out') && !sec.querySelector('.is-leaving') && !sliding(sec.dataset['page'] ?? '') && !sec._fade) {
    sec.classList.remove('is-out');
    if (!X.curView || X.curView.parentElement !== sec) sec.hidden = true;
  }
}
function cancelLeave(view: HTMLElement): void { if (view.classList.contains('is-leaving')) finishLeave(view); }
export function cancelOut(sec: Sec): void {
  if (sec._fade) { try { sec._fade.cancel(); } catch { /* gone */ } sec._fade = null; }
  sec.classList.remove('is-out');
  sec.inert = false;
  sec.style.opacity = '';
  E.slides.delete(sec.dataset['page'] ?? '');
  stopSlide(sec.dataset['page'] ?? '');
  sec.style.translate = '';
}
/* once motion settles, any section that is neither current nor leaving is put away */
function tidy(): void {
  const curSec = X.curView && X.curView.parentElement;
  for (const [id, sec] of Object.entries(X.pageEls) as Array<[string, Sec]>) {
    if (sec === curSec || sec.querySelector('.is-leaving') || (sec._fade && sec._fade.playState === 'running')) continue;
    if (!sec.hidden || sec.classList.contains('is-out')) {
      sec.hidden = true; sec.classList.remove('is-out'); sec.inert = false; sec.style.translate = ''; E.slides.delete(id); stopSlide(id);
    }
  }
}
function ghostOf(view: HTMLElement, a: { x: number; y: number }): { g: HTMLElement; rect: Rect } {
  const g = view.cloneNode(true) as HTMLElement;
  for (const o of g.querySelectorAll('orb-avatar, hx-card')) o.remove();
  g.removeAttribute('id'); g.removeAttribute('aria-labelledby');
  for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
  g.classList.add('is-ghost', 'is-leaving'); leaving.add(g);
  g.setAttribute('aria-hidden', 'true');
  g.inert = true;
  const rect = relRect(view, a);
  view.parentElement?.insertBefore(g, view);
  return { g, rect };
}
interface FlipOpts { stagger?: number }
function playFlip(first: Map<string, KeyRect>, last: Map<string, KeyRect>, opts: FlipOpts, carry: Map<string, FlipState>): void {
  let i = 0;
  for (const [k, L] of last) {
    const F = first.get(k);
    const prev = carry.get(k);
    if (!F || motion.reduce) continue;
    const dx = F.x - L.x, dy = F.y - L.y, s = L.w > 0 ? F.w / L.w : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(s - 1) < 0.01) continue;
    const delay = opts.stagger ? Math.min(i * opts.stagger, 140) : 0;
    startFlip(k, L.el, FLIP_P, [{ x0: dx, v0: prev?.vx ?? 0, eps: 0.05 }, { x0: dy, v0: prev?.vy ?? 0, eps: 0.05 }, { x0: s - 1, v0: prev?.vs ?? 0, eps: 0.0008 }], delay);
    i++;
  }
}
/* entrances wait until the growing slab has reached them, so nothing ever shows outside the slab */
function enter(list: HTMLElement[], a: { x: number; y: number }): void {
  const now = performance.now();
  list.forEach((el, i) => {
    if (motion.reduce) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'linear', fill: 'backwards' }); return; }
    const r = el.getBoundingClientRect();
    const old = E.pending.findIndex((q) => q.el === el); if (old >= 0) E.pending.splice(old, 1);
    el.style.opacity = '0';
    E.pending.push({ el, i, t0: now, needH: a.y - r.top - 2, needW: 2 * Math.max(Math.abs(r.left - a.x), Math.abs(r.right - a.x)) - 4 });
  });
  kick();
}
function flushEnter(now: number): boolean {
  for (let j = E.pending.length - 1; j >= 0; j--) {
    const q = E.pending[j] as (typeof E.pending)[number];
    const okH = E.slabH.x >= q.needH || atRest(E.slabH);
    const okW = E.slabW.x >= q.needW || atRest(E.slabW);
    if (!(okH && okW) && now - q.t0 < 700 / motion.timeScale) continue;
    E.pending.splice(j, 1);
    if (!q.el.isConnected) continue;
    const an = q.el.animate([{ opacity: 0, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], { duration: 200, delay: Math.min(q.i * 12, 72), easing: EASE, fill: 'backwards' });
    an.playbackRate = motion.timeScale;
    q.el.style.opacity = '';
  }
  return E.pending.length > 0;
}
export interface MorphOpts extends FlipOpts {
  ghost?: boolean; render?: readonly string[]; focus?: string | HTMLElement | null; outside?: boolean; card?: string; force?: boolean;
}
/** morph: measure → apply → measure → spring the difference */
export function morph(apply: () => void, opts: MorphOpts = {}): void {
  const a = anchor();
  const hadFocus = X.root.contains(document.activeElement);
  const typing = [...X.composerEls.values()].find((c) => c.contains(document.activeElement));
  const first = snapKeys(a, false);
  const carry = carryOf();
  const oldView = X.curView;
  const oldRect = oldView && rendered(oldView) ? relRect(oldView, a) : null;
  const ghost = opts.ghost && oldView && oldRect && !motion.reduce ? ghostOf(oldView, a) : null;
  hideTip();
  resetMag();
  apply();
  X.root.dataset['mode'] = S.mode;
  updateDots();
  const nv = showView(viewKey());
  if (opts.render) for (const k of opts.render) renderView(k);
  fillCards(nv);
  syncRoving();
  X.curView = nv;
  relocateLive();
  setOrbLife();
  const last = snapKeys(a, true);
  if (ghost) leave(ghost.g, ghost.rect, last);
  if (oldView && oldView !== nv) leave(oldView, oldRect, last);
  playFlip(first, last, opts, carry);
  const list: HTMLElement[] = [];
  if (nv && (nv !== oldView || opts.ghost)) list.push(...nv.querySelectorAll<HTMLElement>('[data-e]'));
  for (const [k, L] of last) if (!first.has(k) && !list.includes(L.el) && !L.el.closest('[data-e]')) list.push(L.el);
  retarget(false);
  enter(list, a);
  if (opts.outside) { /* focus stays where the outside click put it */ }
  else if (typing && typing.isConnected && rendered(typing) && !opts.focus) typing.focus();
  else fixFocus(opts, hadFocus);
  markFocus();
  emitDock();
}
function fixFocus(opts: MorphOpts, hadFocus: boolean): void {
  const act = document.activeElement;
  if (opts.focus === 'composer') { const c = X.composerEls.get(S.card ?? ''); if (c && rendered(c)) { c.focus(); return; } }
  if (opts.focus) {
    const el = opts.focus === 'default' ? defaultTarget() : typeof opts.focus === 'string' ? (X.curView && X.curView.querySelector<HTMLElement>(opts.focus)) || X.root.querySelector<HTMLElement>(opts.focus) : opts.focus;
    if (el && rendered(el)) { el.focus({ preventScroll: true }); return; }
  }
  if (hadFocus && (!act || !X.root.contains(act) || !rendered(act) || act.closest('.is-leaving'))) {
    /* the focused thing went away (an answered card, say): the view's first control, else the page's tab */
    const el = (X.curView && X.curView.querySelector<HTMLElement>('button:not([disabled]):not([tabindex="-1"])')) || X.root.querySelector<HTMLElement>(`#dk-tab-${S.page}`);
    if (el) el.focus({ preventScroll: true });
  }
}
/* the view the slab wraps is watched: when its own size changes (a font loads, a card grows, the window grows under a frame
   that mounted small) the slab and the room the shell keeps for it follow in the same frame */
let watched: HTMLElement | null = null, sent = '';
const viewRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
  const v = X.curView;
  if (flags.mounted && v && (v.offsetHeight !== E.baseH || v.offsetWidth !== E.baseW)) retarget(false);
}) : null;
export function retarget(snap: boolean): void {
  const v = X.curView;
  if (v !== watched && viewRO) { if (watched) viewRO.unobserve(watched); if (v) viewRO.observe(v); watched = v; }
  E.baseW = v ? v.offsetWidth : 0;
  E.baseH = v ? v.offsetHeight : 0;
  E.sinkS.t = S.mode === 'off' ? E.baseH + 14 : 0;
  cacheMag();
  syncFoot();
  E.slabW.t = E.baseW + E.magE;
  E.slabH.t = (S.mode === 'off' ? 0 : E.baseH) + E.magLift;
  markFocus();
  if (snap || motion.reduce) { snapS(E.slabW); snapS(E.slabH); snapS(E.sinkS); snapS(E.dotS); }
  paint();               /* the slab answers in the same frame as its content (no frame with one and not the other) */
  kick();
  emitDock();
}
/** how far the row can lift the slab while the bots grow under the pointer: the most any orb grows beyond the row, so the
    slab at its tallest still ends below the composer and the composer never moves under the pointer */
function headroom(): number {
  if (!(S.grow && S.mode === 'normal' && S.page === 'bots') || motion.reduce) return 0;
  let lift = 0;
  for (const it of E.magItems) lift = Math.max(lift, (it.max - 1) * it.hgt * 0.5);
  return lift;
}
/** the height the shell keeps free above the window edge (`--hx-dock-space`): the slab measured from the view it wraps (the
    foot is inside it) plus the hover headroom. Sent whenever it changes: after a morph, a resize, a font load, the view's own
    size changing, or the grow setting changing. */
export function emitDock(): void {
  const h = S.mode === 'off' ? 0 : Math.ceil(E.baseH + headroom()), key = S.mode + '|' + S.page + '|' + Math.round(E.baseW) + '|' + h;
  if (key === sent) return;
  sent = key;
  emit('hx:dock', { mode: S.mode, page: S.page, width: Math.round(E.baseW), height: h, rest: Math.round(S.mode === 'off' ? 0 : E.baseH) });
}

/* ───────── page dots and the foot ───────── */
export function renderDots(): void {
  X.dotsEl.innerHTML = ui.html.pages({ interactive: true, current: S.page, label: 'Dock pages',
    pages: shownPages().map((p) => ({ id: p, label: PAGE_NAME[p] ?? p, attention: p === 'wait' && S.waits.length > 0 })) });
  for (const d of $$('.ui-pages__dot', X.dotsEl)) {
    const id = d.dataset['value'] ?? '';
    d.id = 'dk-tab-' + id;
    d.setAttribute('aria-controls', 'dk-p-' + id);
    d.setAttribute('data-tip-pos', 'top');
    const i = d.querySelector('i'); if (i) i.dataset['k'] = 'dot:' + id;
  }
  for (const p of ['bots', 'run', 'wait', 'sched', 'ctx']) X.pageEls[p]?.setAttribute('aria-labelledby', `dk-tab-${p}`);
}
export function updateDots(): void {
  for (const d of $$('.ui-pages__dot', X.dotsEl)) {
    const id = d.dataset['value'] ?? '', cur = id === S.page, att = id === 'wait' && S.waits.length > 0;
    d.setAttribute('aria-selected', String(cur));
    d.tabIndex = cur ? 0 : -1;
    if (att) d.setAttribute('data-attention', ''); else d.removeAttribute('data-attention');
    d.setAttribute('aria-label', (PAGE_NAME[id] ?? id) + (att ? ', needs you' : ''));
  }
}
export function flipDots(fn: () => void): void {
  const sel = '.dk-dots .ui-pages__dot > i[data-k]';
  const first = new Map($$(sel, X.root).map((el) => [el.dataset['k'] ?? '', el.getBoundingClientRect()] as const));
  const carry = carryOf();
  fn();
  if (motion.reduce) return;
  const dots = $$(sel, X.root);
  for (const el of dots) { const key = el.dataset['k'] ?? '', old = E.anims.get(key); if (old) endFlip(key, old); }     /* writes, then reads */
  const last = dots.map((el) => el.getBoundingClientRect());
  dots.forEach((el, i) => {
    const key = el.dataset['k'] ?? '', F = first.get(key), L = last[i] as DOMRect;
    if (!F || Math.abs(F.left - L.left) < 0.5) return;
    startFlip(key, el, DOT_P, [{ x0: F.left - L.left, v0: carry.get(key)?.vx ?? 0, eps: 0.05 }], 0);
  });
  kick();
}
/* the foot shows in the normal and expanded dock only; the pill offers restore and nothing else (owner, v10). Its
   right button is Minimise in the normal dock and Collapse in an expanded one. */
export function syncFoot(): void {
  const on = S.mode === 'normal' || S.mode === 'expanded';
  X.footEl.classList.toggle('is-off', !on);
  X.footEl.inert = !on;
  X.dotsEl.style.visibility = shownPages().length > 1 ? '' : 'hidden';
  const exp = S.mode === 'expanded';
  const label = exp ? 'Collapse the dock' : 'Minimise the dock';
  if (X.downBtn.getAttribute('aria-label') !== label) { X.downBtn.setAttribute('aria-label', label); X.downBtn.dataset['tip'] = exp ? 'Collapse' : 'Minimise'; }
}

/* ───────── focus ───────── */
/** the element the shell's region focus lands on: the roving bot on the bots page, else the page's first control */
export function defaultTarget(): HTMLElement | null {
  const v = X.curView;
  if (!v) return null;
  if (v.dataset['view'] === 'bots:card') { const c = X.composerEls.get(S.card ?? ''); if (c && c.input) return c.input; }
  return v.querySelector<HTMLElement>('.dk-bot[tabindex="0"], .dk-add[tabindex="0"]') ?? v.querySelector<HTMLElement>('.dk-roster .ui-row[tabindex="0"]') ?? v.querySelector<HTMLElement>('.dk-roster .ui-row, button:not([disabled]):not([tabindex="-1"])');
}
export function markFocus(): void {
  const d = defaultTarget();
  for (const el of $$('[data-hx-focus="dock"]', X.root)) if (el !== d) el.removeAttribute('data-hx-focus');
  if (d) d.setAttribute('data-hx-focus', 'dock');
}
export function returnFocus(): void {
  const cf = E.cameFrom;
  const to = (cf && cf.isConnected && !X.root.contains(cf) ? cf : null) ?? [...document.querySelectorAll<HTMLElement>('[data-hx-focus="composer"]')].find((n) => !X.root.contains(n) && rendered(n));
  if (to && typeof (to as HTMLElement).focus === 'function') (to as HTMLElement).focus({ preventScroll: true });
  else if (document.activeElement && X.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}
export function focusDock(): void { const b = defaultTarget(); if (b) b.focus({ preventScroll: true }); }

export { K_SLIDE };
