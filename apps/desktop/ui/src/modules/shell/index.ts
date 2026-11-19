/* boopis shell: the frame. Chrome, the left sidebar (open | rail | closed), the tabs, the right panel container,
   the dock slot, the command palette, the account menu, Settings, tooltips and the keyboard. It mounts each registered
   module into its slot (a module that throws leaves a plain notice in its slot, never fabricated content).
   Layout contract: see layout.ts. Keymap: keymap.ts. */
import { emit, on } from '../../core/bus';
import { $, $$, isMac } from '../../core/dom';
import { ariaKeys } from '../../core/keys';
import { logger } from '../../core/log';
import { callProvided, registered, SLOTS } from '../../core/registry';
import type { SlotName } from '../../core/registry';
import { followScheme, followWindowWidth, prefs, saveState, setMounting, setState, setStateHooks, state, toggle, urlQuery } from '../../core/state';
import { TABS } from '../../core/settings';
import type { Tab } from '../../core/types';
import { ui } from '../../components';
import { data } from '../../data';
import { themeApi } from '../../styles/theme';
import { openKeys, openMenu, openSettings, SETTINGS_SECTIONS, wireDialogs } from './dialogs';
import { collectEls, els, sh } from './ctx';
import { reportAttention, seedAttention, setTitleOverride, updateAttentionDots, updateTitle } from './attention';
import { newThing, syncFullscreenIcon, toast, toggleDockExpand, toggleFullscreen, toggleLightDark, togglePanel } from './actions';
import { go, pushHistory } from './history';
import { classifyKey, keysTableHTML } from './keymap';
import { computeNow, layoutNow, markResized, queueLayout, setDockHeight, setInset } from './layout';
import { closePalette, movePal, openPalette, paletteActive, renderPalette, resetActive, runPal, setActive } from './palette';
import { cycleRegion, focusRegion, leaderActive, leaderKey, nextAttention, regionOf, rememberFocus, startLeader } from './regions';
import { getLayout } from '../../core/state';
/* drawn corners (DESIGN-SYSTEM.md section 8): the shell's surfaces; sheets and menus float, so they are surfaces */
ui.squircle.auto('.hx-me, .hx-pal-row');
ui.squircle.auto('.hx-dialog__card, .hx-palette__box, .hx-goto, .hxt-preset', { mode: 'surface' });

const log = logger('shell');

/* ───────── state applied to the DOM (before `hx:state` goes out) ───────── */
function setActive_(node: HTMLElement, on0: boolean): void {
  node.classList.toggle('is-active', on0);
  node.inert = !on0;
  if (on0) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', 'true');
}
function applyState(): void {
  const app = sh.app, el = els();
  if (!app) return;
  app.dataset['tab'] = state.tab;
  app.dataset['left'] = state.left;
  app.dataset['right'] = state.right;
  app.dataset['dock'] = state.dock;
  // tabs: the pill and the rail are ui.segmented; select() is quiet (no ui:change)
  for (const sg of [sh.seg.tabs, sh.seg.rail]) if (sg) sg.select(state.tab);
  for (const v of $$('.hx-view', app)) setActive_(v, v.dataset['view'] === state.tab);
  for (const l of $$('.hx-list', app)) setActive_(l, l.dataset['list'] === state.tab);
  const newLabel = state.tab === 'bots' ? 'New bot' : 'New session';
  $('.hx-new__label', el.btnNew).textContent = newLabel;
  const railNew = $('.hx-rail__new', app); railNew.dataset['tip'] = newLabel; railNew.setAttribute('aria-label', newLabel);
  // sidebar toggle
  const open = state.left === 'open';
  el.btnLeft.dataset['tip'] = open ? 'Hide sidebar' : 'Show sidebar';
  el.btnLeft.setAttribute('aria-label', el.btnLeft.dataset['tip']);
  el.btnLeft.setAttribute('aria-expanded', String(open));
  $('.hx-rail', app).setAttribute('aria-hidden', String(state.left !== 'rail'));
  $('.hx-rail', app).inert = state.left !== 'rail';
  for (const n of $$('.hx-seg, .hx-new, .hx-foot__gear', app)) n.inert = state.left === 'rail';
  el.side.inert = state.left === 'closed';
  // right
  el.rightShell.dataset['right'] = state.right;
  el.rightSlot.dataset['right'] = state.right;
  const ropen = state.right === 'open';
  el.btnRight.dataset['tip'] = ropen ? 'Hide session details' : 'Show session details';
  el.btnRight.setAttribute('aria-label', el.btnRight.dataset['tip']);
  el.btnRight.setAttribute('aria-expanded', String(ropen));
  el.btnRight.disabled = state.tab !== 'session';
  // settings controls (the account menu reads state when it opens)
  const sDock = document.getElementById('hx-set-dock') as HTMLInputElement | null; if (sDock) sDock.checked = state.dock === 'on';
  app.dataset['orbGrow'] = state.orbGrow ? 'on' : 'off';
  const sGrow = document.getElementById('hx-set-orb-grow') as HTMLInputElement | null; if (sGrow) sGrow.checked = state.orbGrow;
  if (sh.seg.collapse) sh.seg.collapse.select(prefs.collapse);
  updateTitle();
  updateAttentionDots();
}

/* ───────── the keyboard ───────── */
const typingIn = (n: Element | null): boolean => !!n && (n.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]') || !!n.closest('[contenteditable="true"]'));
const layerOpen = (): boolean => !els().palette.hidden || els().settings.open || !!(document.getElementById('hx-keys-sheet') as HTMLDialogElement | null)?.open || !!ui.popover.current;

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  if (leaderActive() && leaderKey(e)) return;
  const c = classifyKey(e, { isMac, typing: typingIn(document.activeElement), layerOpen: layerOpen() });
  if (!c) return;
  const cmd = c.command;
  if (c.preventDefault) e.preventDefault();
  const el = els();
  switch (cmd.type) {
    case 'escape': {
      if (!el.palette.hidden) { e.preventDefault(); closePalette(); return; }
      if (layerOpen()) return; // native dialogs close themselves
      const L = getLayout();
      if (state.right === 'open' && L && L.rightMode === 'overlay') { e.preventDefault(); setState({ right: 'closed' }); return; }
      if (state.left === 'open' && L && L.leftMode === 'overlay') { e.preventDefault(); setState({ left: prefs.collapse }); return; }
      const r = regionOf(document.activeElement);
      if (r === 'composer' || r === 'panel') { e.preventDefault(); focusRegion('messages', { fresh: true }); }
      return;
    }
    case 'region': cycleRegion(cmd.dir); return;
    case 'attention': nextAttention(cmd.dir); return;
    case 'palette-toggle': if (el.palette.hidden) openPalette({}); else closePalette(); return;
    case 'palette-items': openPalette({ scope: 'items' }); return;
    case 'find': if (callProvided('find', { tab: state.tab, from: 'keyboard' })) e.preventDefault(); return;
    case 'new': closePalette(true); newThing(); return;
    case 'sidebar-toggle': toggle('left'); return;
    case 'sidebar-hide-toggle': setState({ left: state.left === 'closed' ? 'open' : 'closed' }); return;
    case 'details': togglePanel(); return;
    case 'dock-toggle': toggle('dock'); return;
    case 'dock-expand': toggleDockExpand(); return;
    case 'stop': if (callProvided('stop', { tab: state.tab, from: 'keyboard' })) e.preventDefault(); return;
    case 'back': go(-1); return;
    case 'forward': go(1); return;
    case 'settings': openSettings(cmd.section); return;
    case 'light-dark': toggleLightDark(); return;
    case 'keys': openKeys(); return;
    case 'leader': startLeader(cmd.withMod); return;
    case 'tab': closePalette(true); setState({ tab: cmd.tab }); return;
    case 'composer': focusRegion('composer'); return;
    default: return;
  }
}

/* ───────── modules ───────── */
function slotFor(name: SlotName): HTMLElement | null {
  switch (name) {
    case 'session-list': return document.getElementById('hx-list-session');
    case 'bots-list': return document.getElementById('hx-list-bots');
    case 'session': return document.getElementById('hx-view-session');
    case 'bots': return document.getElementById('hx-view-bots');
    case 'session-right': return document.getElementById('hx-right');
    case 'dock': return document.getElementById('hx-dock');
    default: return null;
  }
}
function mountModule(name: SlotName): void {
  const mod = registered(name), slot = slotFor(name);
  if (!mod || !slot) { if (slot) notice(slot, name); return; }
  try { mod.mount(slot); slot.dataset['module'] = name; }
  catch (err) { log.error('module "' + name + '" failed to mount', err); notice(slot, name); }
}
/** a module that failed shows what happened, never invented content */
function notice(slot: HTMLElement, name: string): void {
  slot.innerHTML = '<div class="hx-stub"><div class="hx-stub-empty">' + ui.html.empty({ title: 'This part did not load', text: 'The ' + name + ' module failed to start. Reload the window; the error is in the log.' }) + '</div></div>';
  slot.dataset['module'] = name + ' (failed)';
}

/* ───────── boot ───────── */
export function boot(): void {
  if (sh.booted) return;
  const app = $('#hx-app');
  sh.app = app;
  // the search field, twice from the library: the title bar's button that opens the palette, and the palette's own field
  $('#hx-btn-search', app).outerHTML = ui.html.search({ as: 'button', size: 's', id: 'hx-btn-search', class: 'hx-cmd', label: 'Search and commands', keys: 'mod+K',
    textHTML: '<span class="hx-cmd__project" id="hx-where-project"></span> <span class="hx-cmd__title" id="hx-where-title"></span>', attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } });
  $('#hx-palette-input', app).outerHTML = ui.html.search({ size: 'l', id: 'hx-palette-input', label: 'Search sessions, bots and commands', placeholder: 'Search sessions, bots and commands', keys: 'esc',
    attrs: { role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'hx-palette-list', 'aria-autocomplete': 'list' } });
  sh.el = collectEls();
  const el = els();

  // icons: one set, from the library
  $$('[data-icon]', app).forEach((n) => { n.outerHTML = ui.icon(n.dataset['icon'] ?? ''); });

  // the tabs: a pill in the sidebar and the same choice, vertical, in the rail
  const opt = (v: 'session' | 'bots', extra: Record<string, unknown>) => ({ value: v, dot: false, tip: v === 'session' ? 'Sessions' : 'Bots', keys: v === 'session' ? 'alt+1' : 'alt+2', ...extra });
  sh.seg.tabs = ui.segmented({ label: 'View', fill: true, value: state.tab, class: 'hx-seg', controls: { session: 'hx-list-session', bots: 'hx-list-bots' },
    options: [opt('session', { label: 'Session' }), opt('bots', { label: 'Bots' })] });
  sh.seg.rail = ui.segmented({ label: 'View', vertical: true, value: state.tab, class: 'hx-rail__seg', controls: { session: 'hx-list-session', bots: 'hx-list-bots' },
    options: [opt('session', { icon: 'session', ariaLabel: 'Session' }), opt('bots', { icon: 'bots', ariaLabel: 'Bots' })] });
  sh.seg.tabs.id = 'hx-seg';
  for (const b of $$('[role="tab"]', sh.seg.tabs)) b.id = 'hx-tab-' + b.dataset['value'];
  for (const b of $$('[role="tab"]', sh.seg.rail)) b.dataset['tipPos'] = 'right';
  $('#hx-seg').replaceWith(sh.seg.tabs);
  $('#hx-rail-seg').replaceWith(sh.seg.rail);
  sh.seg.collapse = ui.segmented({ mode: 'radio', size: 's', label: 'When the sidebar collapses', value: prefs.collapse, options: [{ value: 'rail', label: 'Rail' }, { value: 'closed', label: 'Hide' }] });
  sh.seg.collapse.setAttribute('aria-labelledby', 'hx-set-collapse-l'); sh.seg.collapse.removeAttribute('aria-label');
  $('#hx-set-collapse').replaceWith(sh.seg.collapse);
  // Settings' sections: the library's tab bar, concentric with the dialog's corner band
  $('#hx-dtabs').outerHTML = ui.html.tabs({ label: 'Settings sections', class: 'hx-dtabs', value: 'general',
    tabs: SETTINGS_SECTIONS.map(([value, label]) => ({ value, label, id: 'hx-dtab-' + value, controls: 'hx-dpanel-' + value })) });
  ui.hydrate($('#hx-settings'));

  // user
  const U = data().user.get();
  // the initial is drawn by CSS (::after), so it is not text the button's accessible name has to repeat
  $$('.hx-avatar', app).forEach((a) => { a.dataset['initial'] = (U.initials || U.name || '?').slice(0, 1); });
  $('#hx-account-name').textContent = U.name;
  el.btnAccount.setAttribute('aria-label', 'Account, ' + U.name);
  el.btnAccount.dataset['tip'] = U.name;

  // keyboard chips in static markup
  $$('kbd[data-kbd]', app).forEach((k) => { k.outerHTML = ui.html.keys(k.dataset['kbd']); });
  el.btnNew.setAttribute('aria-keyshortcuts', ariaKeys('mod+shift+O'));
  el.btnSearch.setAttribute('aria-keyshortcuts', ariaKeys('mod+K'));
  $('#hx-keys').innerHTML = keysTableHTML('');
  // shortcuts for assistive tech
  for (const n of $$('[data-kbd]', app)) n.setAttribute('aria-keyshortcuts', ariaKeys(n.dataset['kbd'] ?? ''));

  // attention seeded from the provider; modules refine it with hx:attention
  seedAttention();

  // test hooks: ?preset=graphite or ?theme=light pick a preset at load
  const qp = urlQuery.get('preset') || (urlQuery.get('theme') === 'light' ? 'bone' : null);
  if (qp && themeApi.presets[qp]) { themeApi.preset(qp); state.theme = themeApi.scheme(); }

  applyState();
  computeNow();
  pushHistory({ tab: state.tab, sel: null });
  syncFullscreenIcon();

  wire();

  sh.booted = true;
  setMounting(true);
  for (const name of SLOTS) mountModule(name);
  setMounting(false);

  emit('hx:state', { state, changed: ['tab', 'left', 'right', 'dock', 'theme', 'orbGrow'], initial: true });
  emit('hx:tab', { tab: state.tab, initial: true });
  layoutNow(false);
  requestAnimationFrame(() => requestAnimationFrame(() => { app.classList.remove('is-booting'); emit('hx:ready', { state }); }));
  if (document.fonts && document.fonts.ready) void document.fonts.ready.then(() => queueLayout(false));
}

function wire(): void {
  const app = sh.app, el = els();
  setStateHooks({
    apply: () => applyState(),
    after: (changed, patch) => {
      if (changed.includes('tab') && !patch._fromHistory) pushHistory({ tab: state.tab, sel: sh.selection[state.tab] });
      if (changed.some((k) => k === 'left' || k === 'right' || k === 'dock' || k === 'tab')) queueLayout(true);
    }
  });
  // chrome
  el.btnLeft.addEventListener('click', () => toggle('left'));
  el.btnBack.addEventListener('click', () => go(-1));
  el.btnFwd.addEventListener('click', () => go(1));
  el.btnSearch.addEventListener('click', () => openPalette({}));
  el.btnRight.addEventListener('click', () => toggle('right'));
  el.btnMin.addEventListener('click', () => toast('Minimize works in the desktop app'));
  el.btnClose.addEventListener('click', () => toast('Close works in the desktop app'));
  el.btnMax.addEventListener('click', () => { void toggleFullscreen(); });
  document.addEventListener('fullscreenchange', syncFullscreenIcon);

  // tabs (both the pill and the rail): the library moves the thumb and the focus, the shell owns the state
  for (const sg of [sh.seg.tabs, sh.seg.rail]) sg?.addEventListener('ui:change', (e) => setState({ tab: (e as CustomEvent<{ value: string }>).detail.value }));
  el.btnNew.addEventListener('click', () => newThing());
  $('.hx-rail__new', app).addEventListener('click', () => newThing());

  // account (the library toggles the menu when its anchor is pressed again)
  el.btnAccount.addEventListener('click', openMenu);
  el.btnSettings.addEventListener('click', () => openSettings());

  // settings, shortcuts sheet
  wireDialogs();
  on('hx:theme', (d) => {
    followScheme(d && d.scheme === 'light' ? 'light' : 'dark');
    queueLayout(false);   // corners and density change sizes
  });
  sh.seg.collapse?.addEventListener('ui:change', (e) => {
    prefs.collapse = (e as CustomEvent<{ value: string }>).detail.value === 'closed' ? 'closed' : 'rail'; saveState();
    if (state.left !== 'open') setState({ left: prefs.collapse });
  });

  // palette
  el.palInput.addEventListener('input', () => { resetActive(); renderPalette(); });
  el.palInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPal(paletteActive()); }
    else if (e.key === 'Tab') { e.preventDefault(); movePal(e.shiftKey ? -1 : 1); }
  });
  el.palList.addEventListener('pointermove', (e) => {
    const r = (e.target as Element).closest<HTMLElement>('.hx-pal-row'); if (!r || +(r.dataset['i'] ?? -1) === paletteActive()) return;
    setActive(+(r.dataset['i'] ?? 0));
    for (const x of $$('.hx-pal-row', el.palList)) x.setAttribute('aria-selected', String(x === r));
    el.palInput.setAttribute('aria-activedescendant', r.id);
  });
  el.palList.addEventListener('click', (e) => { const r = (e.target as Element).closest<HTMLElement>('.hx-pal-row'); if (r) runPal(+(r.dataset['i'] ?? 0)); });
  el.palette.addEventListener('pointerdown', (e) => { if (e.target === el.palette) { e.preventDefault(); closePalette(); } });

  // scrim closes overlay drawers
  el.scrim.addEventListener('click', () => {
    const L = getLayout();
    if (state.right === 'open' && L && L.rightMode === 'overlay') setState({ right: 'closed' });
    if (state.left === 'open' && L && L.leftMode === 'overlay') setState({ left: prefs.collapse });
  });

  app.addEventListener('focusin', (e) => { rememberFocus(e.target as Element); });
  document.addEventListener('focusout', (e) => { const t = e.target as Element; if (t && t.hasAttribute && t.hasAttribute('data-hx-region-focus')) { t.removeAttribute('data-hx-region-focus'); t.removeAttribute('tabindex'); } });

  // keyboard, resize
  window.addEventListener('keydown', onKey);
  let lastW = 0, lastH = 0, resizeTimer = 0;
  new ResizeObserver(() => {
    if (app.clientWidth === lastW && app.clientHeight === lastH) return;
    const W = app.clientWidth, wasW = lastW;
    lastW = W; lastH = app.clientHeight;
    followWindowWidth(W, wasW);
    app.classList.add('is-resizing');
    markResized();
    queueLayout(false);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => app.classList.remove('is-resizing'), 160);
  }).observe(app);
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if ((TABS as readonly string[]).includes(t)) setState({ tab: t }); });

  // module events the shell listens to
  on('hx:bot-select', (d) => {
    if (!d || !d.id) return;
    sh.selection.bots = d.id;
    if (d.from !== 'history') { if (state.tab !== 'bots') setState({ tab: 'bots' }); pushHistory({ tab: 'bots', sel: d.id }); }
    updateTitle();
  });
  on('hx:session-select', (d) => {
    if (!d || !d.id) return;
    sh.selection.session = d.id;
    if (d.from !== 'history') { if (state.tab !== 'session') setState({ tab: 'session' }); pushHistory({ tab: 'session', sel: d.id }); }
    updateTitle();
  });
  on('hx:title', (d) => { if (!d) return; setTitleOverride((TABS as readonly string[]).includes(d.tab ?? '') ? (d.tab as Tab) : state.tab, d.title || d.text || null); updateTitle(); });
  on('hx:open-panel', (d) => { if (d && d.from !== 'shell' && state.right !== 'open') setState({ right: 'open' }); });
  on('hx:attention', (d) => { if (d) reportAttention(d.source || 'unknown', d.count, d.tab, d.ids); });
  on('hx:view-inset', (d) => {
    if (!d) return;
    const t: Tab = (TABS as readonly string[]).includes(d.tab ?? '') ? (d.tab as Tab) : state.tab;
    setInset(t, +(d.left ?? 0) || 0, +(d.right ?? 0) || 0);
    if (t === state.tab) queueLayout(true);
  });
  on('hx:toast', (d) => { if (d) toast(d.text || d.message || ''); });
  // the dock reports {mode, page, width, height}; its height is the room the composer keeps above it, so an expanded dock lifts the composer instead of growing over it
  on('hx:dock', (d) => {
    if (!d) return;
    if (d.mode === 'off') { if (state.dock !== 'off') setState({ dock: 'off' }); return; }
    if (typeof d.height === 'number' && setDockHeight(d.height)) queueLayout(true);
  });
  // the title follows the sessions and the bots
  data().sessions.list.subscribe(() => updateTitle());
  data().bots.subscribe((ev) => { if (ev.type === 'bot' || ev.type === 'bot-created' || ev.type === 'bot-archived') updateTitle(); });
  // keep the CSS width of the sidebar list etc. honest while the window resizes
  const style = document.createElement('style');
  style.textContent = '.hx.is-resizing, .hx.is-resizing * { transition: none !important; }';
  document.head.appendChild(style);
}
