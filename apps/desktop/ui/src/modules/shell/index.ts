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
import { followScheme, followWindowWidth, prefs, setMounting, setState, setStateHooks, state, toggle, urlQuery } from '../../core/state';
import { loadLook, TABS } from '../../core/settings';
import type { Tab } from '../../core/types';
import { kit, ui } from '@boopis/ui';
import { applyChromePrefs, drawChrome, drawSideFoot, drawSideHead, selectTab, syncV7Theme } from './chrome';
import { mountSettings } from '../settings';
import { applyLook } from '../../styles/v7-look';
import { data } from '../../data';
import { themeApi } from '../../styles/theme';
import { openKeys, openMenu, openSettings, openStore, wireDialogs } from './dialogs';
import { collectEls, els, sh } from './ctx';
import { reportAttention, seedAttention, setTitleOverride, updateAttentionDots, updateTitle } from './attention';
import { newThing, openNewMenu, toast, toggleDockExpand, toggleLightDark, togglePanel } from './actions';
import { wireWindowControls } from './window';
import { wireUiSize } from './ui-size';
import { go, pushHistory } from './history';
import { classifyKey } from './keymap';
import { computeNow, layoutNow, markResized, queueLayout, setDockHeight, setInset } from './layout';
import { closePalette, openPalette, renderPalette, resetActive, runPal } from './palette';
import { cycleRegion, focusRegion, leaderActive, leaderKey, nextAttention, regionOf, rememberFocus, startLeader } from './regions';
import { getLayout } from '../../core/state';
/* drawn corners (DESIGN-SYSTEM.md section 8): the shell's surfaces; sheets and menus float, so they are surfaces */
ui.squircle.auto('.hx-goto', { mode: 'surface' });

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
  // tabs: the kit's Segmented; selecting it from the state is quiet (no ui:change)
  if (sh.seg.tabs) selectTab(sh.seg.tabs, state.tab);
  for (const v of $$('.hx-view', app)) setActive_(v, v.dataset['view'] === state.tab);
  for (const l of $$('.hx-list', app)) setActive_(l, l.dataset['list'] === state.tab);
  const newLabel = state.tab === 'bots' ? 'New bot or group' : 'New session';
  el.btnNew.dataset['tip'] = newLabel; el.btnNew.setAttribute('aria-label', newLabel);
  if (state.tab === 'bots') el.btnNew.setAttribute('aria-haspopup', 'menu'); else el.btnNew.removeAttribute('aria-haspopup');
  // sidebar toggle
  const open = state.left === 'open';
  el.btnLeft.dataset['tip'] = open ? 'Hide sidebar' : 'Show sidebar';
  el.btnLeft.setAttribute('aria-label', el.btnLeft.dataset['tip']);
  el.btnLeft.setAttribute('aria-expanded', String(open));
  const rail = $('.hx-rail', app);
  rail.setAttribute('aria-hidden', String(state.left !== 'rail'));
  rail.inert = state.left !== 'rail';
  $('.hx-side__inner', app).inert = state.left !== 'open';
  el.side.inert = state.left === 'closed';
  // right: the session's details panel, or the open bot's details (the title pill opens the same)
  el.rightShell.dataset['right'] = state.right;
  el.rightSlot.dataset['right'] = state.right;
  const ropen = state.right === 'open';
  el.btnRight.dataset['tip'] = state.tab === 'bots' ? (ropen ? 'Hide details' : 'Show details') : ropen ? 'Hide session details' : 'Show session details';
  el.btnRight.setAttribute('aria-label', el.btnRight.dataset['tip']);
  el.btnRight.setAttribute('aria-expanded', String(ropen));
  /* the dock's growth and centring (Settings › General and Appearance follow `hx:state` themselves) */
  app.dataset['orbGrow'] = state.orbGrow ? 'on' : 'off';
  app.dataset['dockCentre'] = state.dockCentred ? 'on' : 'off';
  updateTitle();
  updateAttentionDots();
}

/* ───────── the keyboard ───────── */
const typingIn = (n: Element | null): boolean => !!n && (n.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]') || !!n.closest('[contenteditable="true"]'));
const layerOpen = (): boolean => !els().palette.hidden || els().settings.open || !!(document.getElementById('hx-store') as HTMLDialogElement | null)?.open || !!(document.getElementById('hx-keys-sheet') as HTMLDialogElement | null)?.open || !!ui.popover.current;

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
    case 'store': openStore(); return;
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
  // the floating chrome, the sidebar's head and foot: the v7 kit (chrome.ts)
  drawChrome(app);
  drawSideHead(app);
  drawSideFoot(app);
  /* the command palette: the kit's CommandPalette in the shell's scrim (#hx-palette); its rows are drawn as it opens and as the query changes */
  $('#hx-palette', app).replaceChildren(kit.commandPalette({ id: 'hx-palette', label: 'Search and commands', placeholder: 'Search sessions, bots and commands', groups: [] }));
  sh.el = collectEls();
  const el = els();

  // icons: one set, from the library
  $$('[data-icon]', app).forEach((n) => { n.outerHTML = ui.icon(n.dataset['icon'] ?? ''); });

  /* Settings: the kit's large dialog in the shell's <dialog> (modules/settings) */
  mountSettings($<HTMLDialogElement>('#hx-settings', app));

  // keyboard chips in static markup
  $$('kbd[data-kbd]', app).forEach((k) => { k.outerHTML = ui.html.keys(k.dataset['kbd'], k.hasAttribute('data-fit') ? { fit: true } : undefined); });
  el.btnNew.setAttribute('aria-keyshortcuts', ariaKeys('mod+shift+O'));
  // shortcuts for assistive tech
  for (const n of $$('[data-kbd]', app)) n.setAttribute('aria-keyshortcuts', ariaKeys(n.dataset['kbd'] ?? ''));

  // attention seeded from the provider; modules refine it with hx:attention
  seedAttention();

  // test hooks: ?preset=graphite or ?theme=light pick a preset at load
  const qp = urlQuery.get('preset') || (urlQuery.get('theme') === 'light' ? 'bone' : null);
  if (qp && themeApi.presets[qp]) { themeApi.preset(qp); state.theme = themeApi.scheme(); }
  syncV7Theme();
  /* the v7 look and the chrome's choices (Settings › Appearance and General) */
  applyLook(loadLook(), (scheme) => { if (state.theme !== scheme) setState({ theme: scheme }); });
  applyChromePrefs(app);

  applyState();
  computeNow();
  pushHistory({ tab: state.tab, sel: null });
  wire();

  sh.booted = true;
  setMounting(true);
  for (const name of SLOTS) mountModule(name);
  setMounting(false);

  emit('hx:state', { state, changed: ['tab', 'left', 'right', 'dock', 'theme', 'orbGrow', 'dockCentred', 'dockCompact'], initial: true });
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
  /* search in the chrome: by delegation, since Settings › General can redraw it as a hint, a button or a pill */
  $('#hx-chrome', app).addEventListener('click', (e) => { if ((e.target as Element).closest('#hx-btn-search')) openPalette({}); });
  el.btnRight.addEventListener('click', () => togglePanel());
  el.btnTitle.addEventListener('click', () => togglePanel());
  wireWindowControls();
  wireUiSize();

  // tabs (both the pill and the rail): the library moves the thumb and the focus, the shell owns the state
  sh.seg.tabs?.addEventListener('ui:change', (e) => { e.preventDefault(); setState({ tab: (e as CustomEvent<{ value: string }>).detail.value }); });
  el.btnNew.addEventListener('click', () => openNewMenu(el.btnNew));
  el.btnStore.addEventListener('click', () => openStore());

  // account (the library toggles the menu when its anchor is pressed again)
  el.btnAccount.addEventListener('click', openMenu);
  el.btnSettings.addEventListener('click', () => openSettings());

  // settings, shortcuts sheet
  wireDialogs();
  on('hx:theme', (d) => {
    /* a v6 preset (Settings > Appearance, the lab's presets) picks the v7 root's theme by its scheme; the root's own event is not followed again */
    if (!String(d?.preset ?? '').startsWith('v7-')) syncV7Theme();
    followScheme(d && d.scheme === 'light' ? 'light' : 'dark');
    queueLayout(false);   // corners and density change sizes
  });
  on('hx:chrome', () => { applyChromePrefs(app); queueLayout(true); });

  // palette
  el.palInput.addEventListener('input', () => { resetActive(); renderPalette(); });
  /* the kit's palette moves the row the keys are on and says which was chosen (ui:select {value}: the row's place in the results) */
  el.palette.addEventListener('ui:select', (e) => { runPal(+(e as CustomEvent<{ value: string }>).detail.value); });
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
    markResized();
    queueLayout(false);
    if (!wasW) return;   /* the first call is the observer starting at boot, not a resize: transitions stay on (boot has its own guard) */
    app.classList.add('is-resizing');
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
  on('hx:title', (d) => {
    if (!d) return;
    /* a room's title pill wears its members' stack (screen 12); a bot's its orb (updateTitle) */
    const bots = data().bots.snapshot().bots, members = d.members?.map((id) => bots.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b);
    setTitleOverride((TABS as readonly string[]).includes(d.tab ?? '') ? (d.tab as Tab) : state.tab, d.title || d.text || null, members?.length ? { members } : d.sub != null ? { sub: d.sub || null } : null);
    updateTitle();
  });
  on('hx:open-settings', (d) => { if (d) openSettings(d.section, d.find, d.focus); });
  on('hx:open-store', (d) => { openStore(d?.screen); });
  /* a part of the session's panel was asked for: the panel opens, and the window is laid out again (the diff is wider than the details) */
  on('hx:open-panel', (d) => { if (d && d.from !== 'shell' && state.right !== 'open') setState({ right: 'open' }); else queueLayout(true); });
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
