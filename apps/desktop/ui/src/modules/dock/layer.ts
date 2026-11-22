/* The dock's orb layer. Every bot's live orb is connected once, in one `.dk-orbs` layer inside the Bots page, and stays
   there for as long as the bot exists. A view only holds an empty slot (`data-slot="orb:<id>"`, sized by `--o`); the orb
   follows the slot it should sit in by transform, never by being moved into it.

   Why: an <orb-avatar> draws on an OffscreenCanvas a worker owns, and WebKitGTK drops the picture of a canvas that was
   taken out of the page and put back until the worker's next commit (4 of 40 shots blank in a real WebKitGTK under
   Xvfb). Forcing a redraw on reconnect does not help, and WebKitGTK has no `moveBefore`. A node that is never
   disconnected is never blank (the sidebar's rows keep their orbs the same way: modules/bots/list.ts).

   Each orb is two elements, so no two motions write the same property:
     .dk-op        (a 0x0 point at the orb's centre)  `translate` and `scale`: where the slot is at rest, plus the row's
                   magnification and the roster's scroll. Written by script, from what the engine already knows, with no
                   layout read in a frame.
     .ui-orb       (the live orb)  `transform` and `opacity`: the slot's own FLIP and entrance, played again as Web
                   Animations with the very same keyframes (engine.ts), so the orb travels with its slot on the compositor.
   The layer sits in the Bots page's section, so a page sliding or fading takes its orbs along, and the stage's sink and
   clip apply to them as they do to the views. */
import { $$ } from '../../core/dom';
import { X, motion, rendered } from './ctx';

export interface Pose {
  id: string;
  /** the point the orb is centred on */
  pos: HTMLElement;
  /** the live orb (`X.orbs`) */
  orb: HTMLElement;
  /** the slot the orb sits in now; null when no visible view has one for it */
  slot: HTMLElement | null;
  /** the slot's centre from the layer's origin, with no magnification and the roster at its scroll `s0` */
  bx: number; by: number;
  o: number;
  /** the magnification applied: a shift from the base, and a scale */
  mx: number; my: number; ms: number;
  /** the roster that scrolls this orb's row, the scroll the base was measured at, and the scroll since */
  scroller: HTMLElement | null; s0: number; sy: number;
  /** the roster's visible box in the layer's coordinates */
  clip: [number, number, number, number] | null;
  /** scrolled out of the roster by more than the orb's own pause margin: it stops drawing, like an orb out of the window */
  culled: boolean;
  fade: Animation | null;
  /** what the element's style holds now */
  wrote: { t: string; s: string; c: string };
}
const poses = new Map<string, Pose>();
let layer: HTMLElement | null = null;
let dirty = false;

/** how far past the roster an orb still counts as in view (orb2 pauses its orbs 120px out of the window the same way) */
const MARGIN = 120;
const FADE_MS = 100;

export function initLayer(el: HTMLElement): void {
  layer = el;
  X.root.addEventListener('scroll', onScroll, true);
  X.root.addEventListener('pointerover', (e) => hot(e.target, true));
  X.root.addEventListener('pointerout', (e) => hot(e.target, false));
  X.root.addEventListener('focusin', (e) => hot(e.target, true, true));
  X.root.addEventListener('focusout', (e) => hot(e.target, false));
}

/** the orb joins the layer, once, when the bot is made */
export function adoptOrb(id: string, orb: HTMLElement): void {
  if (!layer || poses.has(id)) return;
  const pos = document.createElement('span');
  pos.className = 'dk-op';
  pos.setAttribute('data-away', '');
  pos.append(orb);
  layer.append(pos);
  poses.set(id, { id, pos, orb, slot: null, bx: 0, by: 0, o: 0, mx: 0, my: 0, ms: 1, scroller: null, s0: 0, sy: 0, clip: null, culled: false, fade: null, wrote: { t: '', s: '', c: '' } });
}
/** the bot is gone: its orb leaves with it (the only time an orb leaves the layer) */
export function dropOrb(id: string): void {
  const p = poses.get(id); if (!p) return;
  p.fade?.cancel();
  p.pos.remove();
  poses.delete(id);
}

export const orbPose = (id: string): Pose | undefined => poses.get(id);
/** whether the orb is drawn on a visible slot and in view of its scroller (an orb that is not stills itself: orbs.ts) */
export const orbShows = (id: string): boolean => { const p = poses.get(id); return !!p && !!p.slot && !p.culled; };
/** the live orbs of every element under `el` that is (or holds) a slot: what an entrance fades in with its slot */
export function orbsIn(el: HTMLElement): HTMLElement[] {
  const slots = el.hasAttribute('data-slot') ? [el] : $$('[data-slot^="orb:"]', el);
  const out: HTMLElement[] = [];
  for (const s of slots) { const p = poses.get((s.getAttribute('data-slot') ?? '').slice(4)); if (p && p.slot === s) out.push(p.orb); }
  return out;
}

/* ───────── following the slots ───────── */
/** write the pose (only what changed: a frame of magnification rewrites every orb, and most do not move) */
const apply = (p: Pose): void => {
  const x = p.bx + p.mx, y = p.by + p.my + p.sy;
  const t = `${x.toFixed(2)}px ${y.toFixed(2)}px`, sc = p.ms === 1 ? '' : p.ms.toFixed(4);
  const cl = p.clip ? `rect(${(p.clip[1] - y).toFixed(1)}px, ${(p.clip[2] - x).toFixed(1)}px, ${(p.clip[3] - y).toFixed(1)}px, ${(p.clip[0] - x).toFixed(1)}px)` : '';
  const w = p.wrote;
  if (w.t !== t) { w.t = t; p.pos.style.translate = t; }
  if (w.s !== sc) { w.s = sc; p.pos.style.scale = sc; }
  if (w.c !== cl) { w.c = cl; p.pos.style.clip = cl; }
};
const KIND: Record<string, string> = { 'bots:min': 'min', 'bots:norm': 'norm', 'bots:exp': 'exp', 'bots:card': 'card' };

/** Put every orb where its slot is. Reads every rect first (the slots are at rest: no FLIP and no magnification is in them
    except what is taken out here), then writes. With `busy` (a FLIP of an orb is running, so a slot's rect is not its place)
    it only notes that the layer is out of date, and the engine places it when the motion has settled. */
export function placeOrbs(busy = false): void {
  if (!layer) return;
  if (busy) { dirty = true; return; }
  dirty = false;
  const rendering = rendered(layer);
  if (!rendering) return;        /* the Bots page is not showing (another page, or the dock is off): its orbs stay as they were, and go with the page */
  const ids = new Map<string, HTMLElement>();
  for (const s of X.root.querySelectorAll<HTMLElement>('[data-slot^="orb:"]')) {
    const id = (s.getAttribute('data-slot') ?? '').slice(4);
    if (ids.has(id) || !poses.has(id) || s.closest('.is-leaving') || !rendered(s)) continue;
    ids.set(id, s);
  }
  const lr = layer.getBoundingClientRect();
  interface Got { p: Pose; slot: HTMLElement; cx: number; cy: number; o: number; kind: string; scroller: HTMLElement | null; sbox: [number, number, number, number] | null }
  const got: Got[] = [];
  const rosters = new Map<HTMLElement, [number, number, number, number]>();
  for (const [id, slot] of ids) {
    const p = poses.get(id) as Pose;
    const r = slot.getBoundingClientRect();
    const view = slot.closest<HTMLElement>('.dk-view');
    const kind = slot.closest('.dk-strip') ? 'strip' : KIND[view?.dataset['view'] ?? ''] ?? 'norm';
    const scroller = kind === 'exp' ? slot.closest<HTMLElement>('.dk-roster') : null;
    let sbox: [number, number, number, number] | null = null;
    if (scroller) {
      sbox = rosters.get(scroller) ?? null;
      if (!sbox) { const b = scroller.getBoundingClientRect(); sbox = [b.left - lr.left, b.top - lr.top, b.right - lr.left, b.bottom - lr.top]; rosters.set(scroller, sbox); }
    }
    got.push({ p, slot, cx: r.left + r.width / 2 - lr.left - p.mx, cy: r.top + r.height / 2 - lr.top - p.my, o: slot.offsetWidth, kind, scroller, sbox });
  }
  const scrolls = new Map<HTMLElement, number>();
  for (const g of got) if (g.scroller && !scrolls.has(g.scroller)) scrolls.set(g.scroller, g.scroller.scrollTop);
  for (const g of got) {
    const p = g.p;
    if (p.fade) { p.fade.cancel(); p.fade = null; }
    p.pos.removeAttribute('data-away');
    p.slot = g.slot;
    p.bx = g.cx; p.by = g.cy; p.sy = 0;
    p.scroller = g.scroller; p.s0 = g.scroller ? scrolls.get(g.scroller) ?? 0 : 0;
    p.clip = g.sbox;
    if (g.o > 0 && g.o !== p.o) { p.o = g.o; p.orb.style.setProperty('--o', String(g.o)); }
    if (p.orb.getAttribute('data-in') !== g.kind) p.orb.setAttribute('data-in', g.kind);
    p.culled = false;
    apply(p);
    if (g.scroller) cull(p);
  }
  woke.clear();
  /* an orb with no slot in the view now showing: it leaves with the view it was in (that fades in 100 ms) */
  for (const p of poses.values()) {
    if (ids.has(p.id) || p.pos.hasAttribute('data-away')) continue;
    p.slot = null; p.culled = false;
    if (p.fade) continue;
    if (motion.reduce) { p.pos.setAttribute('data-away', ''); continue; }
    const an = p.pos.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'cubic-bezier(0,0,.2,1)', fill: 'forwards' });
    an.playbackRate = motion.timeScale;
    p.fade = an;
    an.onfinish = () => { if (p.fade !== an) return; p.fade = null; p.pos.setAttribute('data-away', ''); try { an.cancel(); } catch { /* gone */ } };
  }
}
/** the layer's orbs are out of date and no motion is in the way: place them */
export function placeIfDirty(busy: boolean): void { if (dirty && !busy) placeOrbs(); }

/* ───────── the roster scrolls ───────── */
/** an orb scrolled out of the roster by more than the margin is paused, and wakes when it comes back */
function cull(p: Pose): void {
  if (!p.clip) return;
  const [, y0, , y1] = p.clip, y = p.by + p.my + p.sy, h = p.o / 2;
  const out = y + h < y0 - MARGIN || y - h > y1 + MARGIN;
  if (out !== p.culled) { p.culled = out; woke.add(p.id); }
}
const woke = new Set<string>();
let onLife: ((id: string) => void) | null = null;
/** orbs.ts says how to still or wake one orb */
export function onCull(fn: (id: string) => void): void { onLife = fn; }
function onScroll(e: Event): void {
  const t = e.target;
  if (!(t instanceof HTMLElement) || !t.classList.contains('dk-roster')) return;
  const now = t.scrollTop;
  for (const p of poses.values()) {
    if (p.scroller !== t || !p.slot) continue;
    p.sy = p.s0 - now;
    apply(p);
    cull(p);
  }
  if (woke.size) { for (const id of woke) onLife?.(id); woke.clear(); }
}

/* ───────── magnification ───────── */
/** the row scales the item an orb sits in about its bottom centre; the orb follows: the same pose, as a shift and a scale about its own centre */
export function magOrb(id: string | null, off: number, sc: number, hgt: number): void {
  const p = id ? poses.get(id) : undefined; if (!p) return;
  p.mx = off; p.my = (1 - sc) * hgt / 2; p.ms = sc;
  apply(p);
}
export function magClear(id: string | null): void {
  const p = id ? poses.get(id) : undefined; if (!p || (!p.mx && !p.my && p.ms === 1)) return;
  p.mx = 0; p.my = 0; p.ms = 1;
  apply(p);
}
/** the orb the item holds (the bot row's buttons hold one slot) */
export const slotBot = (el: Element): string | null => { const s = el.querySelector('[data-slot^="orb:"]'); return s ? (s.getAttribute('data-slot') ?? '').slice(4) : null; };

/* ───────── the switcher grows an orb under the pointer or the keys, as it did when the orb was inside the button ───────── */
function hot(t: EventTarget | null, on: boolean, keys = false): void {
  const b = t instanceof Element ? t.closest<HTMLElement>('.dk-strip-bot') : null; if (!b) return;
  const id = b.dataset['id']; if (!id || b.getAttribute('aria-current') === 'true') return;
  const p = poses.get(id); if (!p) return;
  const want = on && (!keys || b.matches(':focus-visible'));
  if (p.orb.hasAttribute('data-hot') !== want) p.orb.toggleAttribute('data-hot', want);
}
