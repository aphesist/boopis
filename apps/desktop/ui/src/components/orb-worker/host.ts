/* The page's side of the orb worker (ADR-0025). `setupOrbs()` decides once, before any orb exists: where the engine has
   workers, OffscreenCanvas and `transferControlToOffscreen` (WebKitGTK 2.46 and later, Chromium), and the worker proves it
   can run orb2 and get a 2D context, `<orb-avatar>` is defined here as a thin element that owns the DOM (attributes,
   size, visibility, colours, events) while the worker owns the canvas and the drawing. Anywhere else the vendored
   element is defined as it always was and orb-runtime patches it on the main thread.

   The element keeps orb2's public surface (attributes, `poke`, `blink`, `lookAt`, `emote`...), so no module changes. The
   vendored build is also loaded on the page, with its `define` captured, only to give `window.OrbAvatar` its static
   data (shape and eye lists, reaction names); no real orb is ever constructed here. */
import { on } from '../../core/bus';
import { onReducedChange, reduced } from '../../core/dom';
import { logger } from '../../core/log';
import { installOrbRuntime, setHoldBridge } from '../orb-runtime';
import { ORB_CALLS } from './protocol';
import type { FromWorker, RectLike, StyleSnap, ToWorker } from './protocol';

const log = logger('orbs');
export type OrbMode = 'worker' | 'main';
export const orbState: { mode: OrbMode; why: string | null; level: number } = { mode: 'main', why: null, level: 0 };

const supported = (): boolean =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';

/** `?orbs=main` forces the main-thread orbs (the perf harness compares the two in one build) */
const forced = (): OrbMode | null => { try { const v = new URLSearchParams(location.search).get('orbs'); return v === 'main' || v === 'worker' ? v : null; } catch { return null; } };

const LE = 3.2 / 2.08;     /* orb2's canvas-to-box ratio (`le` in the build) */
/* orb2's shadow template, as the build writes it: guarded by orb-worker.test.ts, which reads it from the vendored file */
export const SHADOW_CSS = `:host{display:inline-block;position:relative;width:64px;aspect-ratio:1;flex:none;vertical-align:middle;line-height:0;-webkit-tap-highlight-color:transparent}canvas{position:absolute;left:50%;top:50%;width:${(100 * LE).toFixed(2)}%;height:${(100 * LE).toFixed(2)}%;transform:translate(-50%,-50%);pointer-events:none}i,slot{display:none}`;
export const SHADOW_HTML = `<style>${SHADOW_CSS}</style><canvas part="canvas"></canvas><i></i><slot name="shape"></slot><slot></slot>`;

/* ───────── the channel ───────── */
let worker: Worker | null = null;
let queue: ToWorker[] = [], transfer: Transferable[] = [], flushing = false;
function post(m: ToWorker, t?: Transferable): void {
  if (!worker) return;
  queue.push(m); if (t) transfer.push(t);
  if (!flushing) { flushing = true; queueMicrotask(flush); }
}
function flush(): void { flushing = false; if (!worker || !queue.length) return; const q = queue, t = transfer; queue = []; transfer = []; worker.postMessage(q, t); }

const prefersDark = (): boolean => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; } };
const env = (): { dpr: number; reduced: boolean; dark: boolean } => ({ dpr: window.devicePixelRatio || 1, reduced: reduced(), dark: prefersDark() });

/* ───────── the element ───────── */
interface Proxy extends HTMLElement { _id: number; _made: boolean; _vis: boolean; _w: number; _targeted: boolean; resolveStyle(): StyleSnap }
const proxies = new Map<number, Proxy>();
let nextId = 1;
const COLOUR_ATTRS = new Set(['color', 'eye-color']);
const STYLE_ATTRS = new Set(['color', 'eye-color', 'particle-color', 'spark-color']);

let io: IntersectionObserver | null = null, ro: ResizeObserver | null = null;
const byEl = new WeakMap<Element, Proxy>();
function observers(): { io: IntersectionObserver; ro: ResizeObserver } {
  io ??= new IntersectionObserver((es) => { for (const e of es) { const p = byEl.get(e.target); if (p && p._made && e.isIntersecting !== p._vis) { p._vis = e.isIntersecting; post({ t: 'vis', id: p._id, v: p._vis }); } } }, { rootMargin: '120px' });
  ro ??= new ResizeObserver((es) => { for (const e of es) { const p = byEl.get(e.target); if (p && p._made) { p._w = e.contentRect.width; post({ t: 'size', id: p._id, w: p._w }); } } });
  return { io, ro };
}
const rectOf = (el: Element): RectLike => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

function buildElementClass(observed: string[]): CustomElementConstructor {
  class OrbProxy extends HTMLElement {
    static get observedAttributes(): string[] { return observed; }
    _id = nextId++; _made = false; _vis = true; _w = 0; _targeted = false;
    private _canvas: HTMLCanvasElement; private _probe: HTMLElement;
    constructor() {
      super();
      const sh = this.attachShadow({ mode: 'open' });
      sh.innerHTML = SHADOW_HTML;
      this._canvas = sh.querySelector('canvas') as HTMLCanvasElement;
      this._probe = sh.querySelector('i') as HTMLElement;
    }
    /** colours as the page resolves them: the probe turns `var(--x)` and named colours into rgb(), as orb2's own does */
    resolveStyle(): StyleSnap {
      const cs = getComputedStyle(this);
      return { color: cs.color, particle: cs.getPropertyValue('--orb-particle-color').trim(), spark: cs.getPropertyValue('--orb-spark-color').trim() };
    }
    private resolve(v: string): string { const p = this._probe; p.style.color = ''; p.style.color = v; return getComputedStyle(p).color || v; }
    private attrsNow(): Record<string, string> {
      const a: Record<string, string> = {};
      for (const n of observed) { const v = this.getAttribute(n); if (v !== null) a[n] = COLOUR_ATTRS.has(n) ? this.resolve(v) : v; }
      return a;
    }
    connectedCallback(): void {
      const dock = !!this.closest('#hx-dock');
      byEl.set(this, this as unknown as Proxy); proxies.set(this._id, this as unknown as Proxy);
      if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
      if (!this._made) {
        this._made = true;
        const off = this._canvas.transferControlToOffscreen();
        post({ t: 'make', id: this._id, canvas: off, attrs: this.attrsNow(), style: this.resolveStyle(), dock }, off);
      } else post({ t: 'conn', id: this._id, on: true, dock });
      const o = observers(); o.io.observe(this); o.ro.observe(this);
    }
    disconnectedCallback(): void {
      if (!this._made) return;
      post({ t: 'conn', id: this._id, on: false, dock: false });
      io?.unobserve(this); ro?.unobserve(this);
    }
    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
      if (name === 'size') this.style.width = value == null ? '' : /^\d+(\.\d+)?$/.test(value) ? value + 'px' : value;
      if (!this._made) return;
      post({ t: 'attr', id: this._id, name, value: value !== null && COLOUR_ATTRS.has(name) ? this.resolve(value) : value, style: STYLE_ATTRS.has(name) ? this.resolveStyle() : this.lastStyle() });
    }
    private _style: StyleSnap | null = null;
    private lastStyle(): StyleSnap { return (this._style ??= this.resolveStyle()); }
    /** re-resolve every colour (the theme changed) */
    recolour(): void {
      if (!this._made) return;
      this._style = this.resolveStyle();
      for (const n of STYLE_ATTRS) { const v = this.getAttribute(n); if (v !== null) post({ t: 'attr', id: this._id, name: n, value: COLOUR_ATTRS.has(n) ? this.resolve(v) : v, style: this._style }); }
    }
    call(m: string, a: unknown[], withRect = false): this {
      if (this._made) post({ t: 'call', id: this._id, m, a, rect: withRect ? rectOf(this) : null });
      return this;
    }
    get reaction(): string { return this.getAttribute('reaction') ?? 'idle'; }
    set reaction(v: string) { this.setAttribute('reaction', v); }
    get shape(): string { return this.getAttribute('shape') ?? 'circle'; }
    set shape(v: string) { this.setAttribute('shape', v); }
    get eyeShape(): string { return this.getAttribute('eye-shape') ?? 'pill'; }
    set eyeShape(v: string) { this.setAttribute('eye-shape', v); }
    get mode(): string { return this.getAttribute('mode') ?? 'drift'; }
    set mode(v: string) { this.setAttribute('mode', v); }
    get asleep(): boolean { return false; }
    react(v: string): this { this.reaction = v; return this; }
    setShape(v: string): this { this.shape = v; return this; }
    lookAt(x?: number, y?: number): this { this._targeted = x != null && y != null; return this.call('lookAt', x == null || y == null ? [] : [x, y], this._targeted); }
    /** the build draws on a canvas the worker owns, so there is no SVG to take here */
    toSVG(): string { return ''; }
    /* the page's view of the internals the harness and orb-runtime read on the main-thread element */
    get _visible(): boolean { return this._vis; }
    get _cw(): number { return this._canvas.width; }
  }
  for (const m of ORB_CALLS) {
    if (m in OrbProxy.prototype) continue;
    Object.defineProperty(OrbProxy.prototype, m, { configurable: true, writable: true, value: function (this: { call(m: string, a: unknown[]): unknown }, ...a: unknown[]) { return this.call(m, a); } });
  }
  return OrbProxy as unknown as CustomElementConstructor;
}

/* ───────── setup ───────── */
type OrbStatics = { observedAttributes?: string[]; quality?: unknown; qualityLevel?: number } & Record<string, unknown>;

/** load the vendored build on this thread as it always was */
async function loadMain(): Promise<void> {
  await import('../../../vendor/orb-avatar.min.js');
  installOrbRuntime();
}

/** load it only for its static data, capturing the element it would define */
async function loadStatics(): Promise<OrbStatics | null> {
  const real = customElements.define.bind(customElements);
  let captured: OrbStatics | null = null;
  customElements.define = ((name: string, ctor: CustomElementConstructor, opts?: ElementDefinitionOptions): void => { if (name === 'orb-avatar') captured = ctor as unknown as OrbStatics; else real(name, ctor, opts); }) as typeof customElements.define;
  try { await import('../../../vendor/orb-avatar.min.js'); } finally { customElements.define = real; }
  return captured;
}

function startWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('the orb worker did not answer in 4 s')); }, 4000);
    w.onerror = (e): void => { clearTimeout(timer); w.terminate(); reject(new Error('the orb worker failed to load: ' + (e.message || 'unknown'))); };
    w.onmessage = (e: MessageEvent<FromWorker>): void => {
      if (e.data.t !== 'ready') return;
      clearTimeout(timer);
      if (e.data.ok) resolve(w); else { w.terminate(); reject(new Error(e.data.why)); }
    };
    w.postMessage([{ t: 'init', ...env() } satisfies ToWorker]);
  });
}

export async function setupOrbs(): Promise<OrbMode> {
  const want = forced();
  if (want !== 'main' && supported()) {
    try {
      const w = await startWorker();
      const statics = await loadStatics();
      if (!statics) throw new Error('the vendored build defined no <orb-avatar>');
      worker = w;
      w.onmessage = (e: MessageEvent<FromWorker>): void => { if (e.data.t === 'quality') orbState.level = e.data.level; };
      w.onerror = (e): void => { log.error('the orb worker failed', e.message); };
      const observed = Array.isArray(statics.observedAttributes) ? statics.observedAttributes : [];
      customElements.define('orb-avatar', buildElementClass(observed));
      /* the build's own quality ladder runs in the worker; the page's `OrbAvatar.quality` and `.qualityLevel` talk to it */
      Object.defineProperty(statics, 'quality', { configurable: true, set(q: 'auto' | 0 | 1 | 2) { post({ t: 'quality', q }); } });
      Object.defineProperty(statics, 'qualityLevel', { configurable: true, get: () => orbState.level });
      setHoldBridge({ hold: () => post({ t: 'hold' }), release: () => post({ t: 'release' }) });
      onReducedChange(() => post({ t: 'env', ...env() }));
      addEventListener('resize', () => post({ t: 'env', ...env() }), { passive: true });
      on('hx:theme', () => { for (const p of proxies.values()) (p as unknown as { recolour(): void }).recolour(); });
      orbState.mode = 'worker';
      log.info('orbs draw in a worker');
      return 'worker';
    } catch (err) {
      orbState.why = String((err as Error)?.message ?? err);
      if (want === 'worker') log.error('the orb worker was asked for and cannot run', orbState.why);
      else log.info('orbs draw on the main thread: ' + orbState.why);
      worker?.terminate(); worker = null;
    }
  } else orbState.why = want === 'main' ? 'forced by ?orbs=main' : 'this engine has no OffscreenCanvas in workers';
  await loadMain();
  return 'main';
}
