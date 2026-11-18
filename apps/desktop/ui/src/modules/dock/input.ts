/* The dock's input: clicks (one click opens a bot's session, a double-click opens the full chat), keys (KEYMAP section 8),
   touch and trackpad paging, hover (magnification and looking), a press outside returning the dock to rest, and
   fitting the column. */
import { $$, isMac } from '../../core/dom';
import { getLayout, setState } from '../../core/state';
import { emit } from '../../core/bus';
import { ui } from '../../components';
import { S, X, clamp, flags, geomR, motion, shownPages, spring, K_SLIDE } from './ctx';
import { E, cxNow, hideTip, kick, resetMag, retarget, shellVar, returnFocus, markFocus } from './engine';
import { listenOrb, lookRow, pokeBot, setOrbLife } from './orbs';
import {
  closeCard, curFocusTarget, dragTile, down, focusBot, goPage, movePage, openBotInTab, openCard, schedAction, setMode, stepPage, stopRun, togglePage, up
} from './controller';

/* ───────── clicks ───────── */
/* a double-click opens the full chat. The first click already opened the session, so the second lands on whatever the
   dock (or the page) shows there now: for half a second, a press near the first click is the double-click's and
   nothing else sees it (it can never deny a card or close the session by accident). */
let dbl: { id: string; x: number; y: number; until: number; done: boolean } | null = null;
const armDouble = (id: string, e: MouseEvent): void => { dbl = e.detail >= 1 ? { id, x: e.clientX, y: e.clientY, until: performance.now() + 450, done: false } : null; };
export function onDoubleGuard(e: MouseEvent): void {
  if (!dbl) return;
  if (performance.now() > dbl.until) { dbl = null; return; }
  if (Math.hypot(e.clientX - dbl.x, e.clientY - dbl.y) > 10) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  if (e.type === 'click' && !dbl.done) { dbl.done = true; openBotInTab(dbl.id); }
}
export function onClick(e: MouseEvent): void {
  const tgt = e.target as Element;
  const po = tgt.closest<HTMLElement>('.dk-mini-orb');
  if (po && X.root.contains(po) && !tgt.closest('button')) { const o = po.querySelector<HTMLElement & { poke?: (f: number) => void }>('orb-avatar'); if (o && o.poke) o.poke(motion.reduce ? 0.35 : 1); return; }
  const head = tgt.closest('.dk-card-head .dk-orb');
  if (head && X.root.contains(head) && S.card) { pokeBot(S.card, 0.5); closeCard(false); return; }   /* the same orb again */
  const pg = tgt.closest<HTMLElement>('.ui-pages__dot');
  if (pg && X.root.contains(pg)) { goPage(pg.dataset['value'] ?? ''); return; }
  const t = tgt.closest<HTMLElement>('[data-act]');
  if (!t || !X.root.contains(t) || t.closest('.is-leaving')) return;
  if (t.getAttribute('aria-disabled') === 'true') return;
  const act = t.dataset['act'], id = t.dataset['id'] ?? '', kbd = e.detail === 0;
  switch (act) {
    case 'session':
      /* the poke is the click's feedback; its job is the session (owner, v10) */
      if (!kbd) armDouble(id, e);
      openCard(id, kbd);
      setTimeout(() => pokeBot(id, 0.6), motion.reduce ? 0 : 120);
      break;
    case 'close-card': closeCard(true); break;
    case 'new-bot':
      emit('hx:new-bot', { source: 'dock' });
      setState({ tab: 'bots' });
      break;
    case 'open-chat': openBotInTab(id); break;
    case 'restore': setMode('normal', { focus: kbd ? curFocusTarget() : null }); break;
    case 'down': down(kbd); break;
    case 'minimise': setMode('minimal', { focus: kbd ? '.dk-pillbtn' : null }); break;
    case 'customise': setMode('edit', { focus: '[data-act="done"]' }); break;
    case 'done': setMode('normal', { focus: kbd ? '[data-act="customise"]' : null }); break;
    case 'expand': setMode('expanded', { focus: kbd ? 'default' : null }); break;
    case 'dot': goPage(id); break;
    case 'stop': stopRun(); break;
    case 'sched-run': case 'sched-pause': schedAction(act, id); break;
    case 'open-context': emit('hx:open-panel', { panel: 'context', source: 'dock' }); break;
    case 'page-left': movePage(id, -1); break;
    case 'page-right': movePage(id, 1); break;
    case 'page-toggle': togglePage(id); break;
    case 'dock-off': setState({ dock: 'off' }); break;
    default: break;
  }
}

/* ───────── keys (KEYMAP section 8) ───────── */
export function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.defaultPrevented) return;
  /* the shell's mod+G "go to" is waiting for its second key (1-9, D, Esc...): that key is the shell's, not the dock's */
  const goto = document.getElementById('hx-goto'); if (goto && !goto.hidden) return;
  /* Esc anywhere in a session (its composer included) closes it and gives the orb back its focus */
  if (e.key === 'Escape' && S.card && S.mode === 'expanded' && t.closest && t.closest('.dk-v-bots-card')) {
    e.preventDefault(); e.stopPropagation(); closeCard(true); return;
  }
  if (t.closest('input, textarea, select, [contenteditable]')) return;
  const plain = !mod && !e.altKey && !e.shiftKey;
  /* mod+Enter on an orb (row, roster or switcher): the full chat in the Bots tab, as a double-click */
  const orbBtn = t.closest ? t.closest<HTMLElement>('[data-act="session"][data-id]') : null;
  if (orbBtn && mod && e.key === 'Enter' && !e.altKey && !e.shiftKey) { e.preventDefault(); openBotInTab(orbBtn.dataset['id'] ?? ''); return; }
  /* [ ] and PageUp / PageDown change the dock page (mod+[ ] stay the shell's back / forward) */
  if (plain && (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.key === 'PageUp' || e.key === 'PageDown')) {
    e.preventDefault();
    const d = e.code === 'BracketLeft' || e.key === 'PageUp' ? -1 : 1;
    const o = shownPages(), i = o.indexOf(S.page);
    if (i + d < 0 || i + d >= o.length) nudge(d); else stepPage(d, { focusFirst: true });
    return;
  }
  /* 1–9: bot n */
  if (plain && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); focusBot(+e.code.slice(5)); return; }
  const inRow = t.closest ? t.closest('.dk-row') : null;
  const inTabs = t.closest ? t.closest('.dk-dots') : null;
  if (t.closest && t.closest('hx-card')) return;   /* a card owns its keys (KEYMAP section 6) */
  const tile = t.closest ? t.closest<HTMLElement>('.dk-tile') : null;
  if (tile && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); movePage(tile.dataset['tile'] ?? '', e.key === 'ArrowLeft' ? -1 : 1); return; }
  if (inRow && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const items = $$('.dk-bot, .dk-add', inRow as HTMLElement);
    let i = items.indexOf(t.closest('.dk-bot, .dk-add') as HTMLElement);
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    i = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : clamp(i + step, 0, items.length - 1);
    items.forEach((el, k) => { el.tabIndex = k === i ? 0 : -1; });
    S.rowIdx = i;
    items[i]?.focus();
    markFocus();
    return;
  }
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowRight':
      /* arrows rove between bots (above); inside the page tablist they move between pages, as tabs do */
      if (!inTabs) return;
      e.preventDefault(); stepPage(e.key === 'ArrowLeft' ? -1 : 1, { focusDot: true }); break;
    case 'Home': case 'End':
      if (!inTabs) return;
      e.preventDefault(); { const o = shownPages(); const target = e.key === 'Home' ? o[0] : o[o.length - 1]; if (target) goPage(target, { focusDot: true }); } break;
    case 'ArrowUp': e.preventDefault(); up(true); break;
    case 'ArrowDown': e.preventDefault(); down(true); break;
    case 'Escape':
      /* close the card, then collapse an expanded dock, then give focus back */
      e.preventDefault(); e.stopPropagation();
      if (S.mode === 'expanded' && S.card) closeCard(true);
      else if (S.mode === 'expanded' || S.mode === 'edit') setMode('normal', { focus: 'default' });
      else returnFocus();
      break;
    default: break;
  }
}

/* ───────── paging by touch and trackpad ───────── */
const canDrag = (): boolean => S.mode === 'normal' || S.mode === 'minimal' || (S.mode === 'expanded' && !S.card);
/* the page follows the finger inside the slab's open lanes: ~34px toward a neighbour, ~18px (stiffer) past the first or
   last page, so content never leaves the slab; it fades a little as the swipe nears its commit point */
const follow = (x: number, lim: number): number => Math.sign(x) * lim * (1 - 1 / (Math.abs(x) * 0.6 / lim + 1));
function dragTo(x: number): void {
  const o = shownPages(), i = o.indexOf(S.page);
  const free = (x > 0 && i > 0) || (x < 0 && i < o.length - 1);
  const eff = follow(x, free ? 34 : 18);
  const pe = X.pageEls[S.page] as HTMLElement;
  pe.style.opacity = free ? String(1 - Math.min(0.35, Math.abs(x) / 200)) : '';
  let s = E.slides.get(S.page);
  if (!s) { s = spring(0, K_SLIDE, 1, 0.1); E.slides.set(S.page, s); }
  s.x = eff; s.t = eff; s.v = 0;
  if (!E.drag.on) { E.drag.on = true; hideTip(); resetMag(); }
  kick();
}
function dragRelease(vel: number): void {
  if (!E.drag.on) return;
  const o = shownPages(), i = o.indexOf(S.page), dir = E.drag.x < 0 ? 1 : -1, j = i + dir;
  const commit = (Math.abs(E.drag.x) > 64 || Math.abs(vel) > 0.45) && j >= 0 && j < o.length;
  E.drag.on = false;
  const next = o[j];
  if (commit && next) { E.drag.lock = performance.now() + 420; goPage(next, { dir }); }
  else {
    const s = E.slides.get(S.page); if (s) s.t = 0;
    const sec = X.pageEls[S.page] as HTMLElement, op = sec.style.opacity;
    sec.style.opacity = '';
    if (op && !motion.reduce) sec.animate([{ opacity: op }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  E.drag.x = 0;
  kick();
}
/** an arrow at the first or last page answers with a short rubber-band nudge */
function nudge(dir: number): void {
  if (motion.reduce) return;
  let s = E.slides.get(S.page);
  if (!s) { s = spring(0, K_SLIDE, 1, 0.1); E.slides.set(S.page, s); }
  s.v = -dir * 520; s.t = 0; kick();
}
function onTouchDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' || !canDrag() || (e.target as Element).closest('[data-ui="hold"], hx-card, .dk-tile')) return;
  E.drag.pid = e.pointerId; E.drag.sx = e.clientX; E.drag.sy = e.clientY; E.drag.axis = null; E.drag.hist = [[performance.now(), 0]];
}
export function onTouchMove(e: PointerEvent): void {
  if (e.pointerId !== E.drag.pid) return;
  const dx = e.clientX - E.drag.sx, dy = e.clientY - E.drag.sy;
  if (!E.drag.axis && Math.hypot(dx, dy) > 8) {
    E.drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (E.drag.axis === 'x') { try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* synthetic */ } }
  }
  if (E.drag.axis === 'x') { E.drag.x = dx; E.drag.hist.push([performance.now(), dx]); if (E.drag.hist.length > 6) E.drag.hist.shift(); dragTo(dx); }
}
export function onTouchUp(e: PointerEvent): void {
  if (e.pointerId !== E.drag.pid) return;
  const dy = e.clientY - E.drag.sy;
  if (E.drag.axis === 'x') {
    const a = E.drag.hist[0], b = E.drag.hist[E.drag.hist.length - 1];
    dragRelease(b && a && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0);
  } else if (E.drag.axis === 'y' && Math.abs(dy) > 30) { if (dy < 0) up(); else down(); }
  E.drag.pid = null; E.drag.axis = null;
}
let wheelY = 0, wheelT = 0, wheelLock = 0;
export function onWheel(e: WheelEvent): void {
  if (S.mode === 'off') return;
  if ((e.target as Element).closest && (e.target as Element).closest('.dk-sess-log, .ui-composer__input')) return;   /* they scroll themselves */
  const now = performance.now();
  if (now - wheelT > 220) { E.drag.x = 0; wheelY = 0; }
  wheelT = now;
  const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
  if (ax > ay || e.shiftKey) {
    /* a horizontal trackpad swipe drags the page; release (no wheel for 140ms) commits or springs back */
    e.preventDefault();
    if (now < E.drag.lock || !canDrag()) return;
    E.drag.x -= e.shiftKey && !ax ? e.deltaY : e.deltaX;
    dragTo(E.drag.x);
    clearTimeout(E.drag.timer);
    E.drag.timer = window.setTimeout(() => dragRelease(0), 140);
  } else if (ay) {
    if (now - S.hoverT < 300) return;      /* scrolling that drifts onto the dock passes by */
    e.preventDefault();
    if (now < wheelLock) return;
    wheelY += e.deltaY;
    if (wheelY < -60) { up(); wheelLock = now + 480; wheelY = 0; }
    else if (wheelY > 60) { down(); wheelLock = now + 480; wheelY = 0; }
  }
}

/* ───────── hover and focus ───────── */
export function onPointerMove(e: PointerEvent): void {
  const t = e.target instanceof Element ? e.target : null;
  const inDock = !!(t && X.root.contains(t) && !X.root.classList.contains('is-gone'));
  if (inDock !== S.hover) { S.hover = inDock; if (inDock) S.hoverT = performance.now(); setOrbLife(); }
  const inRow = inDock && !!(t as Element).closest('.dk-v-bots-norm') && S.mode === 'normal';
  E.magOn = inRow;
  E.magPX = inRow ? e.clientX - cxNow() : null;
  if (inRow) lookRow(e.clientX, e.clientY); else lookRow(null);
  const item = inRow ? (t as Element).closest<HTMLElement>('.dk-bot, .dk-add') : null;
  if (item !== E.lastItem) {
    if (E.lastItem && E.lastItem.classList.contains('dk-bot')) listenOrb(E.lastItem.dataset['id'] ?? '', false);
    E.lastItem = item;
    const id = item && item.classList.contains('dk-bot') ? item.dataset['id'] ?? '' : '';
    const o = id ? X.orbs.get(id)?.querySelector<HTMLElement & { blink?: () => void }>('orb-avatar') : null;
    if (o) { listenOrb(id, true); if (o.blink) o.blink(); }
    kick();
  }
  if (inRow || E.magE > 0 || E.magItems.some((x) => x.m !== 1)) kick();
}
export function onFocusIn(e: FocusEvent): void {
  const el = e.target as HTMLElement;
  if (!S.focusIn) { S.focusIn = true; E.cameFrom = e.relatedTarget && !X.root.contains(e.relatedTarget as Node) ? (e.relatedTarget as Element) : E.cameFrom; }
  if (el.classList && el.classList.contains('dk-bot')) listenOrb(el.dataset['id'] ?? '', true);
  kick();                                    /* a focused orb grows (when grow is on) */
}
export function onFocusOut(e: FocusEvent): void {
  const el = e.target as HTMLElement;
  if (el.classList && el.classList.contains('dk-bot') && el !== E.lastItem) listenOrb(el.dataset['id'] ?? '', false);
  if (!e.relatedTarget || !X.root.contains(e.relatedTarget as Node)) S.focusIn = false;
  kick();
}

/* a click outside the dock returns it to rest (owner, v12): a session, the grid, an expanded page, the arrange view all
   go back to the normal row. The pill stays a pill and an off dock stays off (both are choices). The click is never
   intercepted: the dock acts after it has reached its target (so nothing moves under the pointer mid-click) and
   leaves focus where the click put it. A press that starts inside and ends outside (a drag) is inside; so is a press
   in a layer the dock opened (a library menu or popover anchored in the dock) or a tooltip. A session's typed text
   stays in its composer for the next time. */
let outsidePress = false;
function insideDock(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (X.root.contains(t) || t.closest('.ui-tip')) return true;
  const layer = ui.popover.current;
  return !!(layer && layer.contains(t) && X.root.querySelector('[aria-expanded="true"]'));
}
export function onDocDown(e: Event): void { outsidePress = !!flags.mounted && (S.mode === 'expanded' || S.mode === 'edit') && !insideDock(e.target); }
export function onDocUp(): void {
  if (!outsidePress) return;
  outsidePress = false;
  setTimeout(() => { if (S.mode === 'expanded' || S.mode === 'edit') setMode('normal', { outside: true }); }, 0);
}
export function cancelOutside(): void { outsidePress = false; }
export function onPointerDown(e: PointerEvent): void {
  onTouchDown(e);
  const tile = (e.target as Element).closest<HTMLElement>('.dk-tile');
  if (tile && !(e.target as Element).closest('button') && e.button === 0) dragTile(e, tile);
}

/* ───────── fitting the column ───────── */
/** the bot row keeps 40px orbs at a 54px pitch (LAYOUT.md section 6) while the column allows it, then shrinks */
export function fitRow(): void {
  const vw = innerWidth;
  const avail = Math.min(S.colWidth || vw, vw) - 24;
  const n = S.bots.length, pad = vw <= 520 ? 10 : 16;
  const gapOf = (o: number): number => Math.max(6, Math.round(o * 14 / 40));
  let o = 40;
  while (o > 18 && 2 * pad + n * o + n * gapOf(o) + 28 > avail) o--;
  X.root.style.setProperty('--dock-orb', String(o));
  X.root.style.setProperty('--dock-gap', gapOf(o) + 'px');
  X.root.style.setProperty('--dock-maxw', Math.max(300, avail) + 'px');
  /* the room around the centre line: a view never grows past the ground on either side (flares included), so on a
     phone, where the centre line sits left of the window's middle (the details strip), nothing runs off the edge */
  const L = getLayout(), cx = L ? L.centerX : cxNow();
  const left = L ? L.viewLeft : 0, right = L ? L.viewRight : vw;
  const room = Math.floor(2 * (Math.min(cx - left, right - cx) - geomR.FLARE - 2));
  if (room > 0) X.root.style.setProperty('--dock-room', room + 'px');
}
export function onLayout(d: { centerX?: number; colWidth?: number; animate?: boolean }): void {
  flags.useVar = shellVar();
  X.root.classList.toggle('is-self-centred', !flags.useVar);
  if (!flags.useVar && typeof d.centerX === 'number') {
    const snap = !flags.layoutSeen || d.animate === false;
    if (snap) X.root.classList.add('is-snap');
    X.root.style.setProperty('--dk-cx', d.centerX + 'px');
    if (snap) { void X.root.offsetWidth; X.root.classList.remove('is-snap'); }
  }
  flags.layoutSeen = true;
  if (d.colWidth) S.colWidth = d.colWidth;
  fitRow();
  retarget(false);
}
export function onResize(): void { fitRow(); retarget(true); }
