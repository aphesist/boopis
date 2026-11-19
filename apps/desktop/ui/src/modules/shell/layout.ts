/* Layout: on every change the shell emits `hx:layout` with VIEWPORT coordinates { centerX, colLeft, colWidth, ... }
   and mirrors them as animated CSS custom properties on #hx-app (--hx-center-x, --hx-col-left, --hx-col-w,
   --hx-view-left, --hx-view-right, --hx-side-w, --hx-right-vw, --hx-dock-space), so anything that reads the CSS
   properties travels on the shell's own curve for free. OWNER RULE: the dock is always centred with the chatbox. */
import { emit } from '../../core/bus';
import { $$ } from '../../core/dom';
import { setLayout, state } from '../../core/state';
import type { Layout, Tab } from '../../core/types';
import { els, sh } from './ctx';

let probes: Record<string, number> = {};
const insets: Record<Tab, { left: number; right: number }> = { session: { left: 0, right: 0 }, bots: { left: 0, right: 0 } };
let layoutQueued = 0, layoutAnimate = false, layoutResized = false;
/** the next layout answers a resize of the window */
export function markResized(): void { layoutResized = true; }
let dockHeight: number | null = null;   // the dock's current height from hx:dock (rest or expanded); null until it reports

export function setInset(tab: Tab, left: number, right: number): void { insets[tab] = { left, right }; }
export function setDockHeight(h: number): boolean { if (Math.abs((dockHeight || 0) - h) > 0.5) { dockHeight = h; return true; } return false; }

function measureProbes(): void {
  probes = {};
  for (const i of $$('.hx-probe [data-probe]')) probes[i.dataset['probe'] ?? ''] = i.getBoundingClientRect().width;
}
function durMs(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim();
  const n = parseFloat(v); return /ms$/.test(v) ? n : n * 1000 || 320;
}
/** the numbers behind the layout (pure given its inputs; unit-tested) */
export interface LayoutIn { W: number; left: string; right: string; tab: Tab; dock: string; sb: number; rail: number; rw: number; rr: number; col: number; dockRest: number; dockHeight: number | null; inset: { left: number; right: number } }
export interface Solved { sideW: number; leftPush: number; leftMode: 'push' | 'overlay'; rightVW: number; rightPush: number; rightMode: 'push' | 'overlay'; centerX: number; colWidth: number; colLeft: number; marginW: number; dockSpace: number; bp: string; viewLeft: number; viewRight: number }
export function solveLayout(i: LayoutIn): Solved {
  const { W } = i;
  const phone = W < 640, narrow = W < 900, wide = W >= 1200;
  let sideW = 0, leftPush = 0, leftMode: 'push' | 'overlay' = 'push';
  if (i.left === 'open') {
    sideW = phone ? Math.min(W - 48, i.sb) : i.sb;
    if (narrow) { leftMode = 'overlay'; leftPush = phone ? 0 : i.rail; } else leftPush = i.sb;
  } else if (i.left === 'rail') {
    sideW = phone ? 0 : i.rail; leftPush = sideW;
  }
  let rightVW = i.rr, rightPush = i.rr, rightMode: 'push' | 'overlay' = 'push';
  if (i.tab === 'bots') { rightVW = 0; rightPush = 0; }   // session details belong to the session tab
  else if (i.right === 'open') {
    rightVW = phone ? W : Math.min(i.rw, W - 40);
    if (wide) rightPush = rightVW; else rightMode = 'overlay';
  }
  const viewLeft = leftPush, viewRight = W - rightPush;
  const cL = viewLeft + (i.inset.left || 0), cR = viewRight - (i.inset.right || 0);
  const centerX = (cL + cR) / 2;
  const pad = phone ? 16 : 32;
  const colWidth = Math.max(0, Math.min(i.col, cR - cL - pad * 2));
  const colLeft = centerX - colWidth / 2;
  const marginW = colWidth >= 560 ? 112 : 0;       // the call-number margin folds away on narrow columns
  const dockSpace = i.dock === 'on' ? (typeof i.dockHeight === 'number' && i.dockHeight > 0 ? i.dockHeight : i.dockRest) : 0;
  return { sideW, leftPush, leftMode, rightVW, rightPush, rightMode, centerX, colWidth, colLeft, marginW, dockSpace, bp: phone ? 'phone' : narrow ? 'narrow' : wide ? 'wide' : 'mid', viewLeft, viewRight };
}

function computeLayout(): Layout {
  measureProbes();
  const app = sh.app, el = els();
  const W = app.clientWidth, H = app.clientHeight;
  const r = app.getBoundingClientRect();
  const s = solveLayout({ W, left: state.left, right: state.right, tab: state.tab, dock: state.dock, sb: probes['sb'] || 288, rail: probes['rail'] || 56, rw: probes['right'] || 340, rr: probes['rrail'] || 28, col: probes['col'] || 720, dockRest: probes['dock'] || 72, dockHeight, inset: insets[state.tab] ?? { left: 0, right: 0 } });
  const set = (k: string, v: number): void => { app.style.setProperty(k, Math.round(v * 100) / 100 + 'px'); };
  set('--hx-side-w', s.sideW);
  set('--hx-view-left', s.viewLeft);
  set('--hx-view-right', s.rightPush);
  set('--hx-center-x', s.centerX);
  set('--hx-col-left', s.colLeft);
  set('--hx-col-w', s.colWidth);
  set('--hx-right-vw', s.rightVW);
  set('--hx-dock-space', s.dockSpace);
  set('--hx-margin-w', s.marginW);
  app.dataset['margin'] = s.marginW ? 'on' : 'off';
  app.dataset['leftMode'] = s.leftMode;
  app.dataset['rightMode'] = s.rightMode;
  app.dataset['bp'] = s.bp;
  app.dataset['lcorner'] = s.viewLeft > 0 ? 'on' : 'off';
  app.dataset['rcorner'] = state.tab === 'session' && state.right === 'open' && s.rightMode === 'push' ? 'on' : 'off';

  // scrim for overlay drawers on narrow windows
  const narrow = W < 900;
  const scrimOn = narrow && ((state.left === 'open' && s.leftMode === 'overlay') || (state.right === 'open' && s.rightMode === 'overlay'));
  el.scrim.hidden = !scrimOn && !el.scrim.classList.contains('is-on');
  requestAnimationFrame(() => el.scrim.classList.toggle('is-on', scrimOn));
  if (!scrimOn) setTimeout(() => { if (!el.scrim.classList.contains('is-on')) el.scrim.hidden = true; }, 260);

  const L: Layout = {
    centerX: r.left + s.centerX, colLeft: r.left + s.colLeft, colWidth: s.colWidth,
    viewportW: window.innerWidth, viewportH: window.innerHeight,
    appLeft: r.left, appTop: r.top, appW: W, appH: H,
    viewLeft: r.left + s.viewLeft, viewRight: r.left + s.viewRight,
    leftW: s.sideW, rightW: s.rightVW, leftMode: s.leftMode, rightMode: s.rightMode,
    chromeH: probes['chrome'] || 40, dockSpace: s.dockSpace, marginW: s.marginW, composerW: s.colWidth, dock: state.dock,
    tab: state.tab, left: state.left, right: state.right,
    duration: durMs(), easing: 'var(--spring)', animate: layoutAnimate && !app.classList.contains('is-booting'), resized: layoutResized
  };
  setLayout(L);
  return L;
}
export function computeNow(): Layout { return computeLayout(); }
export function queueLayout(animate: boolean): void {
  layoutAnimate = layoutAnimate || !!animate;
  if (layoutQueued) return;
  layoutQueued = requestAnimationFrame(() => {
    layoutQueued = 0;
    if (!sh.app) return;
    const L = computeLayout();
    layoutAnimate = false; layoutResized = false;
    emit('hx:layout', L);
  });
}
export function layoutNow(animate: boolean): void {
  layoutAnimate = !!animate;
  const L = computeLayout();
  layoutAnimate = false;
  emit('hx:layout', L);
}
