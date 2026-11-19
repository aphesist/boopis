/* The dock's behaviour: modes (off, minimal, normal, expanded, edit), pages, a bot's session, a decided wait, the run and
   its schedules, and arranging the pages.
   Owner decisions (v10): one click (or Enter) on an orb opens the bot's session in the dock (its last messages, its
   open card, a composer); the same orb again, Esc or the close button returns to the row; another orb switches; a
   double-click (or mod+Enter) opens the full chat in the Bots tab. Pages: a quiet nub of page dots in the slab's foot. */
import { emit } from '../../core/bus';
import { $$ } from '../../core/dom';
import { setState } from '../../core/state';
import { writeJSON, KEYS } from '../../core/settings';
import { ui } from '../../components';
import { data } from '../../data';
import type { Wait } from '../../data';
import { PAGE_NAME, S, X, botById, flags, motion, shownPages, EASE, clamp } from './ctx';
import { cancelOut, flipDots, hideTip, markFocus, morph, renderDots, resetMag, retarget, showView, slideNow, slideTo, stopSlide, syncFoot, emitDock, updateDots } from './engine';
import type { MorphOpts } from './engine';
import { lookRow, setOrbLife } from './orbs';
import { fillCards, refreshBot, renderMins, renderView, viewKey, relocateLive } from './views';
import { rove, syncRoving } from './roving';

const announce = (m: string): void => { try { ui.announce(m); } catch { /* the library is required at mount */ } };

export const savePrefs = (): void => { writeJSON(KEYS.dock, { pages: S.pages, minimal: S.mode === 'minimal' || (S.mode === 'off' && S.restore === 'minimal') }); };

/* ───────── modes ───────── */
export function setMode(mode: string, opts: MorphOpts = {}): void {
  if (!flags.mounted) return;
  if (mode === 'off') return setOn(false);
  if (S.mode === 'off') { S.restore = mode === 'minimal' ? 'minimal' : 'normal'; return setOn(true); }
  if (mode === S.mode && !opts.card && !opts.force) return;
  const from = S.mode;
  morph(() => {
    if (opts.card) {
      if (S.mode !== 'expanded' || !S.card || S.page !== 'bots') S.cardFrom = S.mode === 'expanded' && S.page === 'bots' ? 'expanded' : 'normal';
      S.card = opts.card;
      if (S.page !== 'bots') { if (!shownPages().includes('bots')) { const bp = S.pages.find((x) => x.id === 'bots'); if (bp) bp.on = true; renderDots(); } S.page = 'bots'; }
    } else if (mode !== 'expanded' || from === 'expanded') S.card = null;
    S.mode = mode as typeof S.mode;
  }, { ...opts, ...(opts.card ? { render: ['bots:card'] } : {}), stagger: opts.stagger != null ? opts.stagger : (mode === 'expanded' && S.page === 'bots' && !opts.card) || from === 'expanded' && S.page === 'bots' ? 9 : 0 });
  if (mode === 'minimal' || mode === 'normal') savePrefs();
  if (mode === 'minimal') announce('Dock minimised');
}
export function setOn(on: boolean): void {
  const my = ++flags.offSeq;
  if (!on) {
    if (S.mode === 'off') return;
    S.restore = S.mode === 'minimal' ? 'minimal' : 'normal';
    const sink = (): void => {
      if (my !== flags.offSeq) return;
      hideTip(); resetMag();
      S.mode = 'off'; X.root.dataset['mode'] = 'off';
      setOrbLife(); retarget(false); emitDock(); savePrefs();
    };
    if (S.mode !== 'minimal') { morph(() => { S.mode = 'minimal'; S.card = null; }); setTimeout(sink, motion.reduce ? 0 : 190 / motion.timeScale); }
    else sink();
  } else {
    if (S.mode !== 'off') return;
    X.root.classList.remove('is-gone'); X.root.inert = false; X.root.removeAttribute('aria-hidden');
    S.mode = 'minimal'; X.root.dataset['mode'] = 'minimal';
    retarget(false); emitDock();
    if (S.restore !== 'minimal') setTimeout(() => { if (my === flags.offSeq && S.mode === 'minimal') setMode(S.restore === 'minimal' ? 'minimal' : 'normal'); }, motion.reduce ? 0 : 200 / motion.timeScale);
  }
}
/** one click (or Enter) opens the bot's session; the same orb again closes it; another orb switches */
export function openCard(id: string, kbd: boolean, focusSel?: string | null): void {
  if (!botById(id) || S.mode === 'off' || S.mode === 'edit') return;
  if (S.mode === 'expanded' && S.card === id && S.page === 'bots') return closeCard(kbd);
  S.rowIdx = Math.max(0, S.bots.findIndex((b) => b.id === id));
  setMode('expanded', { card: id, focus: focusSel || 'composer' });
  const b = botById(id); if (b) announce(`Session with ${b.name}`);
}
export function closeCard(kbd: boolean): void {
  const id = S.card;
  const back = S.cardFrom === 'expanded' ? 'expanded' : 'normal';
  morph(() => { S.card = null; S.mode = back; }, { focus: kbd ? `[data-id="${id}"]` : null, stagger: 0 });
}
export function goPage(id: string, opts: { dir?: number; focusDot?: boolean; focusFirst?: boolean } = {}): void {
  if (!flags.mounted || S.mode === 'edit' || S.mode === 'off' || id === S.page || !shownPages().includes(id)) return;
  const order = shownPages();
  const dir = opts.dir || (order.indexOf(id) > order.indexOf(S.page) ? 1 : -1);
  const from = S.page, outSec = X.pageEls[from] as HTMLElement & { _fade?: Animation | null }, inSec = X.pageEls[id] as HTMLElement;
  const back = slideNow(id);
  hideTip(); resetMag();
  if (S.mode === 'expanded' && S.card) { S.card = null; S.mode = 'normal'; X.root.dataset['mode'] = 'normal'; }
  lookRow(null);
  const wOut = outSec.offsetWidth;
  S.page = id;
  cancelOut(inSec);
  const nv = showView(viewKey());
  fillCards(nv);
  syncRoving();
  X.curView = nv;
  relocateLive();
  setOrbLife();
  const wIn = inSec.offsetWidth;
  outSec.hidden = false;
  outSec.classList.add('is-out');
  outSec.inert = true;
  if (outSec._fade) outSec._fade.cancel();
  if (motion.reduce) {
    outSec.hidden = true; outSec.classList.remove('is-out'); outSec.inert = false;
    inSec.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'linear' });
  } else {
    const dist = Math.min(40, (wOut + wIn) / 16 + 16);     /* a short travel inside the slab, never a lurch */
    /* both pages slide as springs on the compositor (engine.slideTo): the one leaving from where it is, the one arriving from
       where it was (a swipe still settling hands its position and velocity over) */
    const so = slideNow(from) ?? { x: 0, v: 0 };
    slideTo(from, outSec, so.x, so.v, -dir * dist, { hold: true });
    slideTo(id, inSec, back ? back.x : dir * dist, back ? back.v : 0, 0);
    const fo = outSec.animate([{ opacity: outSec.style.opacity || '1' }, { opacity: 0 }], { duration: 140, easing: 'linear', fill: 'forwards' });
    fo.playbackRate = motion.timeScale;
    outSec._fade = fo;
    fo.onfinish = () => {
      outSec._fade = null;
      try { fo.cancel(); } catch { /* gone */ }
      if (S.page !== from) { outSec.hidden = true; outSec.classList.remove('is-out'); outSec.inert = false; stopSlide(from); outSec.style.translate = ''; }
    };
    const fi = inSec.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 50, easing: EASE, fill: 'backwards' });
    fi.playbackRate = motion.timeScale;
  }
  flipDots(updateDots);
  retarget(false);
  if (opts.focusDot) { X.dotsEl.querySelector<HTMLElement>(`#dk-tab-${id}`)?.focus({ preventScroll: true }); }
  else if (opts.focusFirst && X.curView) { X.curView.querySelector<HTMLElement>('button:not([disabled]):not([tabindex="-1"])')?.focus({ preventScroll: true }); }
  markFocus();
  emitDock();
}
export function stepPage(delta: number, opts: { focusDot?: boolean; focusFirst?: boolean } = {}): void {
  const order = shownPages();
  const i = order.indexOf(S.page);
  const j = clamp(i + delta, 0, order.length - 1);
  const target = order[j];
  if (j !== i && target) goPage(target, { ...opts, dir: Math.sign(delta) });
}
export function up(kbd?: boolean): void {
  if (S.mode === 'minimal') setMode('normal', { focus: kbd ? `#dk-tab-${S.page}` : null });
  else if (S.mode === 'normal') setMode('expanded', { focus: kbd ? 'default' : null });
}
export function down(kbd?: boolean): void {
  if (S.mode === 'expanded') { if (S.card) closeCard(!!kbd); else setMode('normal', { focus: kbd ? 'default' : null }); }
  else if (S.mode === 'normal') setMode('minimal', { focus: kbd ? '.dk-pillbtn' : null });
  else if (S.mode === 'edit') setMode('normal');
}
export const curFocusTarget = (): string => `#dk-tab-${S.page}`;

/* ───────── cards: ui.card on the dock ground ─────────
   The compact approval and the open question are the canonical cards. A decision is the provider's: the dock asks it
   to resolve the wait (after the receipt has shown), and every place that shows the wait hears the answer. */
export function onCardAction(e: CustomEvent<{ action: string; card: HTMLElement }>): void {
  const d = e.detail, el = d.card;
  if (!el || !el.dataset['wait'] || !X.root.contains(el)) return;
  if (d.action === 'open') {                     /* a mini row opens the compact card in the expanded dock */
    e.preventDefault();
    if (S.page !== 'wait') goPage('wait');
    setMode('expanded', { focus: 'default' });
  }
}
export function onCardState(e: CustomEvent<{ state: string; data: { answer?: string }; card: HTMLElement }>): void {
  const d = e.detail, el = d.card;
  if (!el || !el.dataset['wait'] || !X.root.contains(el)) return;
  const out = d.state === 'approved' ? 'approved' : d.state === 'denied' ? 'denied' : d.state === 'answered' ? (d.data.answer || 'answered') : null;
  const id = el.dataset['wait'] ?? '';
  if (out) setTimeout(() => data().waits.resolve(id, out), motion.reduce ? 200 : 900);   /* let the receipt show first */
}
/** a wait arrived after the dock was built (a live approval or blank): put it on the Needs you page */
export function onWaitAdded(w: Wait): void {
  if (S.waits.some((x) => x.id === w.id)) return;
  morph(() => {
    S.waits = [...S.waits, w];
    for (const k of ['wait:norm', 'wait:exp', 'wait:min', 'edit:edit']) renderView(k);
    renderMins();
  });
  emit('hx:attention', { source: 'dock', count: S.waits.length });
  ui.announce('Needs you: ' + w.title);
}
/** the provider decided a wait (here, in the Bots tab, or in the Session tab): take it off the dock */
export function onWaitResolved(id: string, outcome: string): void {
  const w = S.waits.find((x) => x.id === id); if (!w) return;
  if (w.kind === 'form') {
    /* answered here or elsewhere: every card of the form takes the receipt, and it stays a moment before it leaves the queue */
    const state = outcome === 'cancelled' ? 'cancelled' : outcome === 'expired' ? 'expired' : 'done';
    for (const [k, el] of X.cardEls) if (k.startsWith(id + ':')) (el as HTMLElement & { update(p: Record<string, unknown>): unknown }).update({ state });
    setTimeout(() => { removeWait(id, outcome); }, motion.reduce ? 200 : 900);
    return;
  }
  removeWait(id, outcome);
}
function removeWait(id: string, outcome: string): void {
  const w = S.waits.find((x) => x.id === id); if (!w) return;
  const b = w.kind === 'approval' ? botById(w.bot) : undefined;
  const renders = ['wait:norm', 'wait:exp', 'wait:min', 'edit:edit'];
  if (S.card) renders.push('bots:card');
  morph(() => {
    S.waits = S.waits.filter((x) => x !== w);
    for (const k of [...X.cardEls.keys()]) if (k.startsWith(id + ':')) { X.cardEls.get(k)?.remove(); X.cardEls.delete(k); }
    if (b) { b.attention = null; if (outcome === 'approved') b.state = 'working'; else if (outcome === 'denied') b.state = 'idle'; }
    for (const k of renders) renderView(k);
    renderMins();
    if (b) refreshBot(b);
  });
  emit('hx:attention', { source: 'dock', count: S.waits.length });
}

/* ───────── the run and its schedules ───────── */
export function stopRun(): void {
  if (!S.run || S.run.stopped) return;
  data().run.stop();   /* the provider answers on its run stream: onRun morphs */
  announce('Run stopped');
}
export function toggleSetting(key: 'governed' | 'network', on: boolean): void { data().run.setSetting(key, on); }
export function schedAction(act: string, id: string): void {
  const s = S.sched.find((x) => x.id === id); if (!s) return;
  if (act === 'sched-run') { data().schedules.runNow(id); announce(`${botById(s.bot)?.name ?? ''} started ${s.what}`); return; }
  data().schedules.setPaused(id, !s.paused);   /* the provider answers on its list: onSchedules morphs */
}

/* ───────── arrange ───────── */
export function movePage(id: string, delta: number): void {
  const i = S.pages.findIndex((p) => p.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= S.pages.length) return;
  const cv = X.curView as HTMLElement;
  const ul = cv.querySelector('.dk-tiles') as HTMLElement;
  const before = new Map($$('.dk-tile', ul).map((t) => [t.dataset['tile'] ?? '', t.getBoundingClientRect().left] as const));
  const [p] = S.pages.splice(i, 1); if (p) S.pages.splice(j, 0, p);
  renderView('edit:edit');
  tileFlip(before);
  const btn = cv.querySelector<HTMLElement>(`[data-act="${delta < 0 ? 'page-left' : 'page-right'}"][data-id="${id}"]`) ?? cv.querySelector<HTMLElement>(`[data-tile="${id}"] .dk-tile-show`);
  btn?.focus({ preventScroll: true });
  renderDots(); syncFoot();
  savePrefs();
  announce(`${PAGE_NAME[id] ?? id} moved to position ${j + 1}`);
}
function tileFlip(before: Map<string, number>, skip?: HTMLElement): void {
  if (motion.reduce) return;
  for (const t of $$('.dk-tile', X.curView as HTMLElement)) {
    if (t === skip) continue;
    const x0 = before.get(t.dataset['tile'] ?? ''); if (x0 == null) continue;
    const dx = x0 - t.getBoundingClientRect().left; if (Math.abs(dx) < 1) continue;
    t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 240 / motion.timeScale, easing: EASE });
  }
}
export function togglePage(id: string): void {
  const p = S.pages.find((x) => x.id === id); if (!p) return;
  if (p.on && shownPages().length === 1) return;
  morph(() => {
    p.on = !p.on;
    if (!p.on && S.page === id) S.page = shownPages()[0] ?? 'bots';
    renderView('edit:edit');
    renderDots();
  }, { focus: `[data-act="page-toggle"][data-id="${id}"]` });
  savePrefs();
}
export function dragTile(e: PointerEvent, tile: HTMLElement): void {
  const ul = tile.parentElement as HTMLElement, id = tile.dataset['tile'] ?? '', x0 = e.clientX;
  let base = x0, moved = false;
  try { tile.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  const onMove = (ev: PointerEvent): void => {
    if (!moved && Math.abs(ev.clientX - x0) < 4) return;
    moved = true;
    tile.classList.add('is-drag');
    tile.style.transform = `translateX(${ev.clientX - base}px)`;
    const tiles = $$('.dk-tile', ul), idx = tiles.indexOf(tile);
    const r = tile.getBoundingClientRect(), mid = r.left + r.width / 2;
    let to = idx;
    tiles.forEach((t, k) => {
      if (t === tile) return;
      const q = t.getBoundingClientRect(), c = q.left + q.width / 2;
      if (k > idx && mid > c) to = Math.max(to, k);
      if (k < idx && mid < c) to = Math.min(to, k);
    });
    if (to === idx) return;
    const before = new Map(tiles.map((t) => [t.dataset['tile'] ?? '', t.getBoundingClientRect().left] as const));
    tile.style.transform = '';
    const rest0 = tile.getBoundingClientRect().left;
    const dest = tiles[to] as HTMLElement;
    if (to > idx) dest.after(tile); else dest.before(tile);
    const [p] = S.pages.splice(S.pages.findIndex((x) => x.id === id), 1); if (p) S.pages.splice(to, 0, p);
    base += tile.getBoundingClientRect().left - rest0;
    tile.style.transform = `translateX(${ev.clientX - base}px)`;
    tileFlip(before, tile);
  };
  const onUp = (): void => {
    tile.removeEventListener('pointermove', onMove);
    tile.removeEventListener('pointerup', onUp);
    tile.removeEventListener('pointercancel', onUp);
    tile.classList.remove('is-drag');
    if (!moved) {
      const pg = S.pages.find((x) => x.id === id);
      if (pg && pg.on) morph(() => { S.page = id; S.mode = 'normal'; });
      return;
    }
    const cur = tile.style.transform;
    tile.style.transform = '';
    if (!motion.reduce && cur) tile.animate([{ transform: cur }, { transform: 'none' }], { duration: 200 / motion.timeScale, easing: EASE });
    $$('.dk-tile', ul).forEach((t, k) => {
      const l = t.querySelector<HTMLButtonElement>('[data-act="page-left"]'), rr = t.querySelector<HTMLButtonElement>('[data-act="page-right"]');
      if (l) l.disabled = k === 0;
      if (rr) rr.disabled = k === S.pages.length - 1;
    });
    renderDots(); syncFoot(); savePrefs();
    announce(`${PAGE_NAME[id] ?? id} moved to position ${S.pages.findIndex((x) => x.id === id) + 1}`);
  };
  tile.addEventListener('pointermove', onMove);
  tile.addEventListener('pointerup', onUp);
  tile.addEventListener('pointercancel', onUp);
}

/* ───────── hooks the shell calls ───────── */
export function openBotInTab(id: string): void {
  emit('hx:bot-select', { id, from: 'dock', source: 'dock' });
  setState({ tab: 'bots' });
  if (S.card) closeCard(false);              /* the full chat has it now; the dock goes back to the row */
}
export function focusBot(n: number): void {
  const b = S.bots[n - 1]; if (!b || S.mode === 'off') return;
  const go = (): void => {
    const cv = X.curView;
    const btn = cv && cv.querySelector<HTMLElement>(`.dk-bot[data-id="${b.id}"]`);
    if (!btn || !cv) return;
    const items = $$('.dk-bot, .dk-add', cv);
    items.forEach((el) => { el.tabIndex = el === btn ? 0 : -1; });
    S.rowIdx = items.indexOf(btn);
    btn.focus({ preventScroll: true });
    markFocus();
  };
  if (S.mode === 'expanded' && S.page === 'bots' && !S.card && X.curView) {     /* in the grid: its bot n */
    const items = $$('.dk-roster .ui-row', X.curView), j = S.bots.indexOf(b);
    const to = items[j];
    if (to) { S.rowIdx = rove(items, j, j); markFocus(); return; }
  }
  if (S.page !== 'bots') goPage('bots');
  if (S.mode !== 'normal') setMode('normal');
  go();
}
