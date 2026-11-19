/* hypotaxis dock. One black slab flush to the window's bottom edge (OWNER DECISION: pitch black #000 in every theme,
   not themeable). Built on the shared library: orbs, bot states, icons, buttons, ladder, capacity, measure, page dots,
   switches, empty states, tooltips, announcements, and the canonical cards for approvals and the open question
   (ui.card, dock ground). The dock keeps only what is its own: the slab, the views and their travel, magnification,
   paging, the arrange view.
   Registers as the `dock` module. Listens: hx:layout, hx:state, hx:attention, hx:theme, hx:nav, and the provider's
   bots, waits, run, schedules and context streams. Emits: hx:bot-select, hx:new-bot, hx:open-panel, hx:attention,
   hx:dock. Every decision, message, stop and setting is a provider command. */
import { on } from '../../core/bus';
import { KEYS, readJSON } from '../../core/settings';
import { register, setDockApi } from '../../core/registry';
import { state as appState } from '../../core/state';
import { $$, clamp, isMac } from '../../core/dom';
import { ui } from '../../components';
import { data } from '../../data';
import {
  K_DOT, K_SINK, K_SLAB, PAGE_IDS, S, X, botById, flags, motion, readRadius, rendered, snapS, spring
} from './ctx';
import type { DockBot } from './ctx';
import { E, cancelFlips, cxNow, emitDock, focusDock, kick, morph, paint, renderDots, resetMag, retarget, shellVar, showView, stopSlide } from './engine';
import { lookRow, setOrbLife } from './orbs';
import { makeOrb, paintSession, refreshBot, relocateLive, renderAll, renderMins, renderView, viewKey, costHTML, fmtDur, meterHTML } from './views';
import { closeCard, goPage, onCardAction, onCardState, onWaitAdded, onWaitResolved, openCard, setMode, setOn, toggleSetting } from './controller';
import { cancelOutside, fitRow, onClick, onDocDown, onDocUp, onFocusIn, onFocusOut, onKey, onLayout, onPointerDown, onPointerMove, onTouchMove, onTouchUp, onWheel, onDoubleGuard } from './input';
import type { RunSnapshot } from '../../data';
/* drawn corners (DESIGN-SYSTEM.md section 8): the dock's own surfaces; the tiles float, so they are surfaces */
ui.squircle.auto('.dk-add, .dk-run-open, .dk-sched-row, .dk-sched-what');
ui.squircle.auto('.dk-tile', { mode: 'surface' });

const VIEW_CLASS: Record<string, string> = {
  'bots:min': 'dk-v-min', 'bots:norm': 'dk-v-bots-norm', 'bots:exp': 'dk-v-bots-exp', 'bots:card': 'dk-v-bots-card',
  'run:min': 'dk-v-min', 'run:norm': 'dk-v-run-norm', 'run:exp': 'dk-v-run-exp',
  'wait:min': 'dk-v-min', 'wait:norm': 'dk-v-wait-norm', 'wait:exp': 'dk-v-wait-exp',
  'sched:min': 'dk-v-min', 'sched:norm': 'dk-v-sched-norm', 'sched:exp': 'dk-v-sched-exp',
  'ctx:min': 'dk-v-min', 'ctx:norm': 'dk-v-ctx-norm', 'ctx:exp': 'dk-v-ctx-exp',
  'edit:edit': 'dk-v-edit'
};

/* ───────── data from the provider ───────── */
interface SavedDock { pages?: Array<{ id: string; on: boolean }>; minimal?: boolean }
function initData(): void {
  const d = data();
  const snap = d.bots.snapshot();
  S.bots = snap.bots.map((b): DockBot => ({ ...b, paused: false }));
  S.threads = Object.fromEntries(Object.entries(snap.threads).map(([k, v]) => [k, [...v]]));
  S.waits = [...d.waits.snapshot()];
  S.run = d.run.current.get();
  S.sched = d.schedules.list.get().filter((s) => botById(s.bot)).map((s) => ({ ...s }));
  const c = d.details.context.get();
  S.ctx = { used: c.used, total: c.total, parts: c.parts };
  const saved = readJSON<SavedDock>(KEYS.dock);
  if (saved && Array.isArray(saved.pages)) {
    const known = saved.pages.filter((p) => (PAGE_IDS as readonly string[]).includes(p.id));
    for (const id of PAGE_IDS) if (!known.find((p) => p.id === id)) known.push({ id, on: false });
    if (known.some((p) => p.on)) S.pages = known;
  }
  if (saved && saved.minimal) S.restore = 'minimal';
  const shown = S.pages.filter((p) => p.on).map((p) => p.id);
  if (!shown.includes(S.page)) S.page = shown[0] ?? 'bots';
}

function onRun(next: RunSnapshot): void {
  const prev = S.run; S.run = next;
  if (!prev) return;
  if (next.stopped && !prev.stopped) {
    morph(() => { renderView('run:norm'); renderView('run:exp'); renderView('run:min'); }, { ghost: true });
    return;
  }
  for (const el of $$('[data-run-time]', X.root)) el.textContent = fmtDur(next.elapsed);
  for (const el of $$('[data-run-cost]', X.root)) el.innerHTML = costHTML();
  for (const el of $$('[data-run-meter]', X.root)) el.innerHTML = meterHTML();
  if (next.governed !== prev.governed) { const hint = X.root.querySelector('label[for="dk-sw-governed"] small'); if (hint) hint.textContent = next.governed ? 'The ladder picks the model' : `Stays on ${next.model}`; }
}
function onSchedules(): void {
  S.sched = data().schedules.list.get().filter((s) => botById(s.bot)).map((s) => ({ ...s }));
  morph(() => { renderView('sched:exp'); renderView('sched:norm'); renderView('sched:min'); }, { ghost: true, focus: X.root.contains(document.activeElement) ? `[data-act="sched-pause"][data-id="${(document.activeElement as HTMLElement).dataset['id'] ?? ''}"]` : null });
}

function wireData(): void {
  const d = data();
  d.bots.subscribe((ev) => {
    if (ev.type === 'bot-created') {
      /* bots are one stream: a bot made in the Bots tab joins the dock, last, without a reload */
      if (botById(ev.bot.id)) return;
      const b: DockBot = { ...ev.bot, paused: false };
      S.bots.push(b);
      S.threads[b.id] ??= [];
      X.orbs.set(b.id, makeOrb(b));
      morph(() => renderAll(), { render: [] });
      fitRow();
    } else if (ev.type === 'bot-archived') {
      const i = S.bots.findIndex((x) => x.id === ev.id); if (i < 0) return;
      if (S.card === ev.id) closeCard(false);
      S.bots.splice(i, 1);
      S.sched = S.sched.filter((x) => x.bot !== ev.id);
      X.orbs.get(ev.id)?.remove(); X.orbs.delete(ev.id);
      S.rowIdx = Math.min(S.rowIdx, S.bots.length);
      morph(() => renderAll(), { render: [] });
      fitRow();
    } else if (ev.type === 'bot') {
      const b = botById(ev.bot.id); if (!b) return;
      b.state = ev.bot.state; b.attention = ev.bot.attention; b.activity = ev.bot.activity; b.role = ev.bot.role;
      refreshBot(b);
      paintSession(b, false);
    } else if (ev.type === 'message') {
      if (ev.streaming) return;   /* a reply shows once it is whole */
      const b = botById(ev.botId); if (!b) return;
      (S.threads[ev.botId] ??= []).push(ev.message);
      paintSession(b, true);
    } else if (ev.type === 'message-end') {
      const b = botById(ev.botId); if (!b) return;
      const th = (S.threads[ev.botId] ??= []);
      const m = ev.text;
      const known = th.find((x) => x.id === ev.messageId);
      if (!known) th.push({ kind: 'text', id: ev.messageId, who: ev.botId, t: new Date().toTimeString().slice(0, 5), text: m });
      paintSession(b, true);
    } else if (ev.type === 'message-resolved') {
      const th = S.threads[ev.botId]; const i = th ? th.findIndex((x) => x.id === ev.messageId) : -1;
      const cur = th && th[i];
      if (th && cur && cur.kind === 'approval') th[i] = { ...cur, resolved: ev.resolved, resolvedAt: ev.resolvedAt };
    }
  });
  d.waits.subscribe((ev) => { if (ev.type === 'resolved') onWaitResolved(ev.id, ev.outcome); else onWaitAdded(ev.wait); });
  d.run.current.subscribe(onRun);
  d.schedules.list.subscribe(onSchedules);
  d.details.context.subscribe((c) => { S.ctx = { used: c.used, total: c.total, parts: c.parts }; renderView('ctx:norm'); renderView('ctx:exp'); renderView('ctx:min'); retarget(false); });
}

/* ───────── build ───────── */
function build(slotEl: HTMLElement): void {
  const root = document.createElement('div');
  X.root = root;
  root.className = 'dk';
  root.dataset['ground'] = 'dock';          /* the library's dock ground re-derives every role for black */
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Dock');
  const views = (p: string): string => Object.keys(VIEW_CLASS).filter((k) => k.startsWith(p + ':')).map((k) =>
    `<div class="dk-view ${VIEW_CLASS[k]}" data-view="${k}"${k === 'bots:card' ? ' role="group" aria-labelledby="dk-card-name"' : ''} hidden></div>`).join('');
  root.innerHTML = `<svg class="dk-shape" aria-hidden="true" focusable="false"><path/></svg>
    <div class="dk-stage">
      ${PAGE_IDS.map((p) => `<section class="dk-page" id="dk-p-${p}" data-page="${p}" role="tabpanel" aria-labelledby="dk-tab-${p}" hidden>${views(p)}</section>`).join('')}
      <section class="dk-page" id="dk-p-edit" data-page="edit" role="group" aria-labelledby="dk-edit-h" hidden>${views('edit')}</section>
      <div class="dk-foot">
        ${ui.html.iconButton({ icon: 'sliders', label: 'Arrange dock pages', tip: 'Arrange pages', size: 's', tipPos: 'top', class: 'dk-foot-btn', attrs: { 'data-act': 'customise' } })}
        <div class="dk-dots"></div>
        ${ui.html.iconButton({ icon: 'chevron-down', label: 'Minimise the dock', tip: 'Minimise', size: 's', tipPos: 'top', class: 'dk-foot-btn dk-down', attrs: { 'data-act': 'down' } })}
      </div>
      <span class="ui-sr" id="dk-bot-hint">Click or Enter opens its session here. Click it again, or Esc, to close. Double-click or ${isMac ? 'Command' : 'Control'}+Enter opens the full chat in the Bots tab.</span>
    </div>`;
  slotEl.appendChild(root);
  X.shapeEl = root.querySelector('.dk-shape') as SVGSVGElement;
  X.pathEl = X.shapeEl.querySelector('path') as SVGPathElement;
  X.stageEl = root.querySelector('.dk-stage') as HTMLElement;
  X.footEl = root.querySelector('.dk-foot') as HTMLElement;
  X.dotsEl = root.querySelector('.dk-dots') as HTMLElement;
  X.downBtn = root.querySelector('.dk-down') as HTMLElement;
  for (const p of [...PAGE_IDS, 'edit']) X.pageEls[p] = root.querySelector(`#dk-p-${p}`) as HTMLElement;
  for (const b of S.bots) X.orbs.set(b.id, makeOrb(b));
}

function readGrow(): void {
  const on = appState.orbGrow !== false;
  if (on === S.grow && X.root.hasAttribute('data-grow') === on) return;
  S.grow = on;
  X.root.toggleAttribute('data-grow', on);
  kick();
  if (flags.mounted) emitDock();   /* the hover headroom comes and goes with the setting */
}
function onTheme(): void {
  /* a theme change: re-read the radius, let every orb re-resolve its colours, re-measure (fonts may change) */
  readRadius();
  for (const o of $$('orb-avatar', X.root)) { const e = o.getAttribute('eye-color'); if (e) o.setAttribute('eye-color', e); const c = o.getAttribute('color'); if (c) o.setAttribute('color', c); }
  fitRow(); retarget(false); paint();
}

function mount(slotEl: HTMLElement): void {
  if (flags.mounted) return;
  initData();
  readRadius();
  build(slotEl);
  E.slabW = spring(0, K_SLAB, 1, 0.05); E.slabH = spring(0, K_SLAB, 1, 0.05);
  E.sinkS = spring(0, K_SINK, 1, 0.05);
  E.dotS = spring(0, K_DOT, 1, 0.05);
  flags.useVar = shellVar();
  X.root.classList.toggle('is-self-centred', !flags.useVar);
  const startOff = appState.dock === 'off';
  S.mode = startOff ? 'off' : (S.restore === 'minimal' ? 'minimal' : 'normal');
  X.root.dataset['mode'] = S.mode;
  readGrow();
  renderAll();
  renderDots();
  fitRow();
  X.curView = showView(viewKey());
  flags.mounted = true;
  relocateLive();
  setOrbLife();
  retarget(true);
  if (startOff) { snapS(E.sinkS); }
  paint();

  for (const ty of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) document.addEventListener(ty, onDoubleGuard as EventListener, true);
  X.root.addEventListener('click', onClick);
  X.root.addEventListener('keydown', onKey);
  X.root.addEventListener('wheel', onWheel, { passive: false });
  X.root.addEventListener('pointerdown', onPointerDown);
  X.root.addEventListener('hx:card-action', onCardAction as EventListener);
  X.root.addEventListener('hx:card-state', onCardState as EventListener);
  X.root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'dk-sw-governed') toggleSetting('governed', t.checked);
    if (t.id === 'dk-sw-network') toggleSetting('network', t.checked);
  });
  X.root.addEventListener('focusin', onFocusIn);
  X.root.addEventListener('focusout', onFocusOut);
  X.root.addEventListener('pointermove', onTouchMove);
  X.root.addEventListener('pointerup', onTouchUp);
  X.root.addEventListener('pointercancel', onTouchUp);
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('pointerup', onDocUp, true);
  document.addEventListener('pointercancel', cancelOutside, true);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { fitRow(); retarget(false); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (ev) => {
    if (ev.matches) { cancelFlips(); for (const p of [...E.slideAn.keys()]) { stopSlide(p); const pe = X.pageEls[p]; if (pe) pe.style.translate = ''; } resetMag(); lookRow(null); retarget(true); }
  });
  on('hx:layout', onLayout);
  on('hx:state', (d) => {
    if (d.changed.includes('orbGrow')) readGrow();
    if (d.changed.includes('dock')) {
      if (d.state.dock === 'off' && S.mode !== 'off') setOn(false);
      else if (d.state.dock !== 'off' && S.mode === 'off') setOn(true);
    }
  });
  on('hx:attention', (d) => {
    if (!d.source || d.source === 'dock') return;
    S.ext[d.source] = +d.count || 0;
    morph(() => renderMins());
  });
  on('hx:theme', onTheme);
  on('hx:nav', (d) => {
    if (d.region !== 'dock' || !X.curView) return;
    const all = $$('.dk-bot, button:not([disabled])', X.curView).filter(rendered);
    const el = d.action === 'last' ? all[all.length - 1] : all[0];
    if (el) el.focus({ preventScroll: true });
  });
  wireData();
  emitDock();
}

register('dock', { mount });

/** what the shell and the tests may call (the mock-up's `window.hxDock`) */
setDockApi({
  setMode: (m) => setMode(m),
  setOn,
  goPage: (id) => goPage(id),
  focus: focusDock,
  /* KEYMAP section 3: the n-th bot (1-based) as the dock shows them */
  botAt: (n) => { const b = S.bots[(+n || 0) - 1]; return b ? b.id : null; },
  openSession: (id) => openCard(id, false),
  closeSession: () => closeCard(false),
  get state() { return { mode: S.mode, page: S.page, card: S.card, pages: S.pages.map((p) => ({ ...p })), waits: S.waits.length, hover: !!S.hover, focusIn: !!S.focusIn }; },
  timeScale(f) { motion.timeScale = clamp(+f || 1, 0.02, 4); },
  hover(x) { E.magOn = x != null; E.magPX = x == null ? null : x - cxNow(); S.hover = x != null; kick(); }
});

