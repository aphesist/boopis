/* The orb worker: one worker owns every orb's canvas and runs orb2 (vendor/orb-avatar.min.js, loaded as it is) against the
   shim in shim.ts. The page sends state; this draws. orb-runtime's frame policy (alternate frames for ambient orbs, a
   redraw in the same task when a canvas is resized) is installed on the worker's copy of the build, so the orbs look and
   move exactly as they do on the main thread. */
import vendorUrl from '../../../vendor/orb-avatar.min.js?url';
import { installShim, orbClass, provideCanvas, setDpr, setMedia, ShimElement } from './shim';
import { holdOutsideDock, installOrbRuntime, releaseOutsideDock } from '../orb-runtime';
import { definePose } from '../orb-pose';
import type { FromWorker, RectLike, StyleSnap, ToWorker } from './protocol';

interface OrbInst extends ShimElement {
  connectedCallback(): void; disconnectedCallback(): void; _resized(w: number): void;
  _visible: boolean; _sig: unknown; _cw: number;
}
type Ctx = { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker | ToWorker[]>) => void) | null };
const ctx = self as unknown as Ctx;
const send = (m: FromWorker): void => ctx.postMessage(m);
const orbs = new Map<number, OrbInst>();
let env = { dpr: 1, reduced: false, dark: true };
let booted: Promise<void> | null = null;
let lastLevel = -1;

async function boot(): Promise<void> {
  installShim(env);
  await import(/* @vite-ignore */ vendorUrl);
  const C = orbClass();
  if (!C) throw new Error('orb3 did not define <orb-avatar> in the worker');
  definePose((globalThis as unknown as { OrbAvatar?: Parameters<typeof definePose>[0] }).OrbAvatar);
  if (!installOrbRuntime()) throw new Error('orb2 has no _fit/_update to patch');
  /* a 2D context on an OffscreenCanvas is the whole point: without one the page keeps the main-thread orbs */
  if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(2, 2).getContext('2d', { willReadFrequently: true })) throw new Error('no 2D OffscreenCanvas in this worker');
  setInterval(() => {
    const level = (self as unknown as { OrbAvatar?: { qualityLevel?: number } }).OrbAvatar?.qualityLevel;
    if (typeof level === 'number' && level !== lastLevel) { lastLevel = level; send({ t: 'quality', level }); }
  }, 250);
}

function style(el: OrbInst, s: StyleSnap): void { el.hostStyle = s; }
function make(m: Extract<ToWorker, { t: 'make' }>): void {
  const C = orbClass() as unknown as new () => OrbInst;
  provideCanvas(m.canvas);
  const el = new C();
  orbs.set(m.id, el);
  el.dock = m.dock; style(el, m.style);
  for (const [k, v] of Object.entries(m.attrs)) el.setAttribute(k, v);
  el.isConnected = true;
  el.connectedCallback();
}
function handle(m: ToWorker): void {
  switch (m.t) {
    case 'init': break;
    case 'make': make(m); break;
    case 'attr': {
      const el = orbs.get(m.id); if (!el) break;
      style(el, m.style);
      if (m.value === null) el.removeAttribute(m.name); else el.setAttribute(m.name, m.value);
      break;
    }
    case 'conn': {
      const el = orbs.get(m.id); if (!el) break;
      el.dock = m.dock;
      if (m.on && !el.isConnected) { el.isConnected = true; el.connectedCallback(); }
      else if (!m.on && el.isConnected) { el.isConnected = false; el.disconnectedCallback(); }
      break;
    }
    case 'vis': { const el = orbs.get(m.id); if (el) { el._visible = m.v; if (m.v) el._sig = null; } break; }
    case 'size': { const el = orbs.get(m.id); if (el) el._resized(m.w); break; }
    case 'call': {
      const el = orbs.get(m.id); if (!el) break;
      if (m.rect) el.rect = m.rect as RectLike;
      const fn = (el as unknown as Record<string, unknown>)[m.m];
      if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown).apply(el, m.a);
      break;
    }
    case 'drop': { const el = orbs.get(m.id); if (el && el.isConnected) { el.isConnected = false; el.disconnectedCallback(); } orbs.delete(m.id); break; }
    case 'hold': holdOutsideDock(); break;
    case 'release': releaseOutsideDock(); break;
    case 'env': env = { dpr: m.dpr, reduced: m.reduced, dark: m.dark }; setDpr(m.dpr); setMedia({ reduced: m.reduced, dark: m.dark }); break;
    case 'quality': (self as unknown as { OrbAvatar?: { quality: unknown } }).OrbAvatar!.quality = m.q; break;
  }
}

ctx.onmessage = (e): void => {
  const batch = Array.isArray(e.data) ? e.data : [e.data];
  const first = batch[0];
  if (first && first.t === 'init') {
    env = { dpr: first.dpr, reduced: first.reduced, dark: first.dark };
    booted = boot().then(() => send({ t: 'ready', ok: true }), (err: unknown) => send({ t: 'ready', ok: false, why: String((err as Error)?.message ?? err) }));
    return;
  }
  void (booted ?? Promise.resolve()).then(() => { for (const m of batch) handle(m); });
};
