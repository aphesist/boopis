/* A just-enough DOM for orb2 inside a worker. The owner's vendored build (vendor/orb-avatar.min.js) is a custom element: it
   builds a shadow root with a canvas, observes its own size and visibility, and reads colours from computed style. None
   of that exists in a worker, so the page does those parts (it resolves colours and watches size and visibility) and the
   worker gets them as messages; this file gives the build the objects it asks for, and nothing more. The vendored file is
   loaded as it is. If a future build asks for something this does not have, the worker reports not ready and the page
   keeps drawing on the main thread.

   What orb2 uses, found by reading the build: `window`, `customElements.define/get`, `HTMLElement` (attributes, style,
   attachShadow, isConnected, dispatchEvent, getBoundingClientRect), the shadow's `innerHTML`, `querySelector('canvas'|'i')`,
   `querySelectorAll('slot')`, `matchMedia` (reduced motion, colour scheme), `getComputedStyle` (the colour probe and the
   host), `IntersectionObserver`, `ResizeObserver`, `document.documentElement`, `devicePixelRatio`, `requestAnimationFrame`. */
import type { RectLike, StyleSnap } from './protocol';

type G = Record<string, unknown>;
const g = globalThis as unknown as G;

class Style {
  color = ''; width = '';
  private props = new Map<string, string>();
  setProperty(n: string, v: string): void { this.props.set(n, v); }
  getPropertyValue(n: string): string { return this.props.get(n) ?? ''; }
}
export class Probe { style = new Style(); }
class Slot { addEventListener(): void { /* no light DOM in the worker */ } assignedElements(): unknown[] { return []; } }

let nextCanvas: OffscreenCanvas | null = null;
/** the canvas the next constructed orb will find in its shadow root.
    Its 2D context is asked for with `willReadFrequently`, which keeps the drawing on the CPU in the worker. The GPU-backed
    2D context of an OffscreenCanvas in a worker crashes WebKitGTK 2.52.6's web process (double free, reproduced with 25
    canvases on its GL renderer, and not with this option); orbs are small, so raster on a worker thread costs little, and
    the page never waits for it. orb2 asks `getContext("2d")` with no options, so the option is added here. */
export const provideCanvas = (c: OffscreenCanvas): void => {
  const get = c.getContext.bind(c) as (t: string, o?: unknown) => unknown;
  (c as unknown as { getContext: (t: string, o?: unknown) => unknown }).getContext = (t: string, o?: unknown): unknown => get(t, t === '2d' ? { ...(o as object | undefined), willReadFrequently: true } : o);
  nextCanvas = c;
};

class Shadow {
  private _html = '';
  canvas: OffscreenCanvas | null = nextCanvas;
  probe = new Probe();
  slots = [new Slot(), new Slot()];
  set innerHTML(h: string) { this._html = h; }
  get innerHTML(): string { return this._html; }
  querySelector(sel: string): unknown { return sel === 'canvas' ? this.canvas : sel === 'i' ? this.probe : null; }
  querySelectorAll(sel: string): unknown[] { return sel === 'slot' ? this.slots : []; }
}

export class ShimElement {
  static observedAttributes: string[] = [];
  isConnected = false;
  style = new Style();
  dock = false;
  hostStyle: StyleSnap = { color: '', particle: '', spark: '' };
  rect: RectLike = { left: 0, top: 0, width: 0, height: 0 };
  private attrs = new Map<string, string>();
  attributeChangedCallback?(name: string, old: string | null, value: string | null): void;
  attachShadow(): Shadow { return new Shadow(); }
  getAttribute(n: string): string | null { return this.attrs.get(n) ?? null; }
  hasAttribute(n: string): boolean { return this.attrs.has(n); }
  setAttribute(n: string, v: string): void { const old = this.getAttribute(n); this.attrs.set(n, String(v)); this.changed(n, old, String(v)); }
  removeAttribute(n: string): void { const old = this.getAttribute(n); if (!this.attrs.delete(n)) return; this.changed(n, old, null); }
  private changed(n: string, old: string | null, v: string | null): void {
    if ((this.constructor as typeof ShimElement).observedAttributes.includes(n)) this.attributeChangedCallback?.(n, old, v);
  }
  dispatchEvent(): boolean { return true; }
  addEventListener(): void { /* the page listens for events, not the worker */ }
  removeEventListener(): void { /* see above */ }
  /** the one ancestor query orb-runtime makes: is this orb in the dock's group */
  closest(sel: string): ShimElement | null { return sel === '#hx-dock' && this.dock ? this : null; }
  getBoundingClientRect(): RectLike & { right: number; bottom: number; x: number; y: number } {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
}

/* media queries the build asks about: set from the page */
const media = { reduced: false, dark: true };
interface MQ { matches: boolean; media: string; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }
const mqs: Array<{ q: MQ; kind: 'reduced' | 'dark'; fns: Array<() => void> }> = [];
function matchMedia(query: string): MQ {
  const kind = /reduced-motion/.test(query) ? 'reduced' : /color-scheme/.test(query) ? 'dark' : null;
  const rec = { kind: (kind ?? 'dark') as 'reduced' | 'dark', fns: [] as Array<() => void>, q: null as unknown as MQ };
  const mq: MQ = {
    media: query,
    get matches(): boolean { return kind === 'reduced' ? media.reduced : kind === 'dark' ? (/dark/.test(query) ? media.dark : !media.dark) : false; },
    addEventListener(_t, f): void { rec.fns.push(f); }, removeEventListener(_t, f): void { rec.fns = rec.fns.filter((x) => x !== f); }
  };
  rec.q = mq; mqs.push(rec);
  return mq;
}
/** the page's preferences changed: tell whoever listens, as a media query would */
export function setMedia(next: { reduced: boolean; dark: boolean }): void {
  const reducedChanged = next.reduced !== media.reduced, darkChanged = next.dark !== media.dark;
  media.reduced = next.reduced; media.dark = next.dark;
  for (const m of mqs) if ((m.kind === 'reduced' && reducedChanged) || (m.kind === 'dark' && darkChanged)) for (const f of [...m.fns]) f();
}

const registry = new Map<string, CustomElementConstructor>();
class NoObserver { observe(): void { /* the page observes */ } unobserve(): void { /* see above */ } disconnect(): void { /* see above */ } }
const docEl = { addEventListener(): void { /* no pointer in the worker */ } };

/** what a `getComputedStyle` gets for the orb's probe and for the orb itself */
function getComputedStyle(el: unknown): { color: string; getPropertyValue(n: string): string } {
  if (el instanceof Probe) return { color: el.style.color, getPropertyValue: () => '' };
  const h = (el as ShimElement).hostStyle;
  return { color: h.color, getPropertyValue: (n: string) => (n === '--orb-particle-color' ? h.particle : n === '--orb-spark-color' ? h.spark : '') };
}

/** the animation clock: the worker's own `requestAnimationFrame` when it has one, else a steady 60 Hz timer (a worker
    without it is an engine we cannot time to the display from here) */
function ensureRaf(): void {
  if (typeof g['requestAnimationFrame'] === 'function') return;
  g['requestAnimationFrame'] = (cb: (t: number) => void): number => setTimeout(() => cb(performance.now()), 1000 / 60) as unknown as number;
  g['cancelAnimationFrame'] = (id: number): void => clearTimeout(id);
}

export function installShim(env: { dpr: number; reduced: boolean; dark: boolean }): void {
  media.reduced = env.reduced; media.dark = env.dark;
  g['window'] = globalThis;
  g['devicePixelRatio'] = env.dpr;
  g['HTMLElement'] = ShimElement;
  g['customElements'] = { define: (n: string, c: CustomElementConstructor): void => { registry.set(n, c); }, get: (n: string): CustomElementConstructor | undefined => registry.get(n) };
  g['matchMedia'] = matchMedia;
  g['getComputedStyle'] = getComputedStyle;
  g['IntersectionObserver'] = NoObserver;
  g['ResizeObserver'] = NoObserver;
  g['document'] = { documentElement: docEl, querySelector: () => null, createElement: () => ({}) };
  if (typeof g['CustomEvent'] === 'undefined') g['CustomEvent'] = class { type: string; detail: unknown; constructor(t: string, i?: { detail?: unknown }) { this.type = t; this.detail = i?.detail; } };
  if (typeof g['addEventListener'] !== 'function') g['addEventListener'] = (): void => { /* a worker scope has its own; a test's does not */ };
  ensureRaf();
}
export const orbClass = (): CustomElementConstructor | undefined => registry.get('orb-avatar');
export function setDpr(dpr: number): void { g['devicePixelRatio'] = dpr; }
