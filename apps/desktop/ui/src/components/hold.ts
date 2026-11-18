/* Hold to approve (promoted from the v6 cards' holdController). OWNER DECISION: it takes 1 second, everywhere (the
   --dur-hold token, 1000ms). Pointer: press and hold. Keyboard: hold Space, or press Enter twice (the first press
   arms it; a screen reader's single activation works the same way). The fill gathers as an ordered dot field (Bayer
   4x4 on a 3px grid) whose leading edge thins out; behind the edge the dots fuse into the solid bone fill. Released
   early, it drains back. data-fill="solid" drops the dots. Fires 'ui:commit' (cancelable: preventDefault keeps the
   button armed for the host). States on data-state: idle, holding, done. */
import { $, fire, reduced, tokenMs } from '../core/dom';
import { on } from '../core/bus';
import { announce } from './announce';
import { html } from './html';
import type { HoldOpts } from './html';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const HOLD_FALLBACK_MS = 1000;

export interface HoldController {
  btn: HTMLButtonElement;
  refresh(): void;
  /** show a given progress without holding (a card restored mid-hold) */
  show(v: number): void;
  reset(): void;
  readonly progress: number;
}
const CONTROLLERS = new WeakMap<HTMLElement, HoldController>();
const HOLDS = new Set<HoldController>();
export const holdOf = (btn: Element | null | undefined): HoldController | undefined => (btn instanceof HTMLElement ? CONTROLLERS.get(btn) : undefined);
const refreshHolds = (): void => { for (const c of HOLDS) { if (c.btn.isConnected) c.refresh(); else HOLDS.delete(c); } };
on('hx:theme', refreshHolds);

/** the easing of the fill: x in 0..1 */
export const holdEase = (x: number): number => 1 - Math.pow(1 - x, 1.2);

export function wireHold(btn: HTMLButtonElement, o: HoldOpts = {}): HoldController {
  const existing = CONTROLLERS.get(btn);
  if (existing) return existing;
  const fx = $<HTMLCanvasElement>('canvas', btn), solid = $('.ui-hold__solid', btn);
  const labels = btn.querySelectorAll<HTMLElement>('.ui-hold__label'), onLabel = $('.ui-hold__label--on', btn);
  const ctx = fx.getContext('2d');
  const DUR = +(o.ms ?? btn.dataset['ms'] ?? 0) || tokenMs('--dur-hold', HOLD_FALLBACK_MS);
  const dots = (o.fill ?? btn.dataset['fill']) !== 'solid';
  const LABEL = labels[0]?.textContent ?? '';
  const say = o.announce ?? announce;
  let p = 0, mode: 'idle' | 'hold' | 'drain' | 'done' = 'idle', raf = 0, t0 = 0, p0 = 0, W = 0, H = 0, dpr = 1, color = '', hintT = 0, startedAt = 0, armedT = 0, armed = false;
  const setClip = (c: string): void => { solid.style.clipPath = c; onLabel.style.clipPath = c; };

  function size(): void {
    const r = btn.getBoundingClientRect();
    W = r.width; H = r.height; dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
    color = getComputedStyle(solid).backgroundColor;
  }
  function draw(): void {
    /* at rest nothing is filled, whatever the button's size (a hidden button measures 0 wide) */
    if (p <= 0) { setClip('inset(0 100% 0 0)'); if (W && H && ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fx.width, fx.height); } return; }
    if (!W) size();
    if (!W) { setClip('inset(0 ' + ((1 - holdEase(p)) * 100).toFixed(2) + '% 0 0)'); return; }
    const e = holdEase(p), fr = dots ? Math.min(28, W * 0.22) : 0, P = e * (W + fr), sw = Math.max(0, Math.min(W, P - fr));
    setClip('inset(0 ' + (W - sw).toFixed(2) + 'px 0 0)');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!dots || p <= 0 || p >= 1) return;
    ctx.fillStyle = color;
    const cell = 3, rows = Math.ceil(H / cell), c0 = Math.max(0, Math.floor(sw / cell)), c1 = Math.min(Math.ceil(W / cell), Math.ceil(P / cell)), round = dpr >= 2;
    for (let col = c0; col <= c1; col++) {
      const x = col * cell, v = (P - (x + 1)) / fr;
      if (v <= 0) continue;
      for (let row = 0; row < rows; row++) {
        if (v > ((BAYER[((row & 3) << 2) | (col & 3)] ?? 0) + 0.5) / 16) { const y = row * cell; if (round) { ctx.beginPath(); ctx.arc(x + 1, y + 1, 1, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(x, y, 2, 2); }
      }
    }
  }
  function frame(now: number): void {
    raf = 0;
    if (mode === 'hold') { p = Math.min(1, p0 + (now - t0) / DUR); if (p >= 1) { finish(); return; } }
    else if (mode === 'drain') { p = Math.max(0, p0 - (now - t0) / (reduced() ? 1 : 280)); if (p <= 0) { mode = 'idle'; btn.dataset['state'] = 'idle'; } }
    draw();
    if (mode === 'hold' || mode === 'drain') raf = requestAnimationFrame(frame);
  }
  const disabled = (): boolean => btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  function start(): void {
    if (mode === 'done' || mode === 'hold' || disabled()) return;
    size(); mode = 'hold'; t0 = startedAt = performance.now(); p0 = p;
    setLabel(LABEL); btn.dataset['state'] = 'holding';
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function release(kbd: boolean): void {
    if (mode !== 'hold') return;
    const quick = performance.now() - startedAt < 240;
    mode = 'drain'; t0 = performance.now(); p0 = p;
    if (quick && !kbd) hint('Keep holding');
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function finish(): void {
    mode = 'done'; p = 1; draw();
    setClip('inset(0 0 0 0)');
    setLabel(o.doneLabel ?? 'Approved'); btn.dataset['state'] = 'done'; btn.removeAttribute('data-armed');
    setTimeout(() => { if (!fire(btn, 'ui:commit', {}, true)) ctl.reset(); }, reduced() ? 60 : 240);
  }
  function setLabel(t: string): void { for (const l of labels) l.textContent = t; }
  function hint(t: string): void {
    clearTimeout(hintT); setLabel(t); say('Keep holding to approve');
    hintT = window.setTimeout(() => { if (mode !== 'done') setLabel(LABEL); }, 1400);
  }
  function confirmPress(): void {
    if (mode === 'done' || disabled()) return;
    clearTimeout(hintT);
    if (armed) { armed = false; clearTimeout(armedT); btn.removeAttribute('data-armed'); size(); finish(); return; }
    armed = true; btn.setAttribute('data-armed', '');
    setLabel('Press again to approve');
    say('Press again to approve, or hold the space bar');
    armedT = window.setTimeout(() => { armed = false; btn.removeAttribute('data-armed'); if (mode !== 'done') setLabel(LABEL); }, 4000);
  }
  const isSpace = (e: KeyboardEvent): boolean => e.key === ' ' || e.code === 'Space';
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (document.activeElement !== btn) btn.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    try { btn.setPointerCapture(e.pointerId); } catch { /* best effort */ }
    start();
  });
  btn.addEventListener('pointerup', () => release(false));
  btn.addEventListener('pointercancel', () => release(false));
  btn.addEventListener('lostpointercapture', () => release(false));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => {
    if (isSpace(e)) { e.preventDefault(); if (!e.repeat) start(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) confirmPress(); }
  });
  btn.addEventListener('keyup', (e) => { if (isSpace(e)) { e.preventDefault(); release(true); } });
  btn.addEventListener('blur', () => release(false));
  btn.addEventListener('click', (e) => { if (e.detail === 0) confirmPress(); });
  const ctl: HoldController = {
    btn,
    refresh() { size(); draw(); },
    show(v) { size(); p = Math.max(0, Math.min(0.99, v)); mode = 'idle'; btn.dataset['state'] = p > 0 ? 'holding' : 'idle'; draw(); },
    reset() { if (raf) cancelAnimationFrame(raf); raf = 0; mode = 'idle'; p = 0; btn.dataset['state'] = 'idle'; setLabel(LABEL); draw(); },
    get progress() { return p; }
  };
  CONTROLLERS.set(btn, ctl); HOLDS.add(ctl);
  return ctl;
}

/** an element version: the button and its hint, wired */
export function holdElement(o: HoldOpts = {}): HTMLElement {
  const wrap = document.createElement('span');
  wrap.style.display = 'contents';
  wrap.innerHTML = html.hold(o);
  wireHold($<HTMLButtonElement>('button', wrap), o);
  return wrap;
}
