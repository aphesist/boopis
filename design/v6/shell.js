/* hypotaxis v6 · shell runtime (owner: wireframe agent)
   Defines window.HX first (state, event bus, register/mount, setState), then wires the frame:
   chrome, left sidebar (open | rail | closed), tabs, right panel container, dock slot, command
   palette, account menu, settings, tooltips, keyboard shortcuts, and stubs for missing modules.

   Layout contract: on every change the shell emits 'hx:layout' with VIEWPORT coordinates
   { centerX, colLeft, colWidth, viewportW, viewportH, viewLeft, viewRight, leftW, rightW,
     leftMode, rightMode, chromeH, dockSpace, marginW, dock, duration, easing, animate }
   and mirrors them as animated CSS custom properties on #hx-app (local coordinates, same as the
   viewport unless the app is inset): --hx-center-x, --hx-col-left, --hx-col-w, --hx-view-left,
   --hx-view-right, --hx-side-w, --hx-right-vw, --hx-dock-space. Anything that reads the CSS
   properties travels on the shell's own curve for free. */
(function () {
  'use strict';

  /* ───────────── runtime ───────────── */
  /* a host skeleton (the artifact viewer's) may bring an <html> without a language: screen readers need one */
  if (!document.documentElement.lang) document.documentElement.lang = 'en';
  const STORE = 'hx.v6.shell';
  const TABS = ['session', 'bots'];
  const LEFT = ['open', 'rail', 'closed'];
  const RIGHT = ['closed', 'open'];
  const DOCK = ['on', 'off'];
  const THEMES = ['dark', 'light'];
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

  const bus = new EventTarget();
  const registry = new Map();      // name -> module
  const mounted = new Map();       // name -> { slot, stub: bool, ac }
  const wrappers = new WeakMap();  // fn -> Map(type -> listener)
  let booted = false;
  let mounting = false;   // while modules mount, the initial tab stays the shell's decision

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; }
  }
  function save() {
    try {
      /* the sidebar is stored only once the person has set it (leftBy: 'user'); while it follows the window it is not */
      localStorage.setItem(STORE, JSON.stringify({ tab: state.tab, left: leftAuto ? undefined : state.left, leftBy: leftAuto ? undefined : 'user', right: state.right, dock: state.dock, theme: state.theme, collapse: prefs.collapse, orbGrow: state.orbGrow }));
    } catch (e) { /* storage blocked: the shell still works */ }
  }
  const saved = load();
  const query = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); } })();
  const pick = (k, allowed, fallback) => {
    const q = query.get(k);
    if (allowed.includes(q)) return q;
    if (allowed.includes(saved[k])) return saved[k];
    return fallback;
  };
  const hashTab = TABS.includes((location.hash || '').slice(1)) ? location.hash.slice(1) : null;
  /* The sidebar follows the window until the person sets it: closed on a phone, a rail when narrow, open from 900px.
     A frame can boot small and grow (the claude.ai artifact viewer mounts its iframe small), so the width at boot
     decides nothing for good: the shell re-reads the width on every resize while the sidebar is automatic (leftAuto).
     What is stored never breaks the layout: a stored choice is only honoured when the person made it (older stores
     without leftBy are ignored), and a stored open sidebar or details panel never boots as an overlay over the work. */
  const autoLeft = (w) => (w < 640 ? 'closed' : w < 900 ? 'rail' : 'open');
  const bootW = window.innerWidth || 1920;
  const qLeft = LEFT.includes(query.get('left')) ? query.get('left') : null;
  const userLeft = saved.leftBy === 'user' && LEFT.includes(saved.left) && !(saved.left === 'open' && bootW < 900) ? saved.left : null;
  let leftAuto = !qLeft && !userLeft;
  const state = {
    tab: hashTab || pick('tab', TABS, 'session'),
    left: qLeft || userLeft || autoLeft(bootW),
    right: bootW < 1200 && !query.get('right') ? 'closed' : pick('right', RIGHT, 'closed'),
    dock: pick('dock', DOCK, 'on'),
    theme: (window.HX_THEME && window.HX_THEME.scheme()) || 'dark',   // follows the theme (theme.js); 'dark' or 'light'
    orbGrow: saved.orbGrow !== false   // owner's setting: dock bots grow under the pointer (Settings > Appearance); default on
  };
  const prefs = { collapse: ['rail', 'closed'].includes(saved.collapse) ? saved.collapse : 'rail' };

  /* A handler gets (detail, event). The detail also carries a non-enumerable .detail pointing at
     itself, so handlers written as (e) => e.detail.x work too. */
  function wrapDetail(detail, type) {
    if (detail === null || typeof detail !== 'object') return detail;
    const d = Array.isArray(detail) ? detail.slice() : Object.assign({}, detail);
    try {
      Object.defineProperty(d, 'detail', { value: detail, enumerable: false });
      Object.defineProperty(d, 'type', { value: type, enumerable: false });
    } catch (e) { /* frozen */ }
    return d;
  }

  const HX = window.HX = {
    version: 'v6',
    state,
    prefs,
    layout: null,
    cards: (window.HX && window.HX.cards) || null,
    get data() { return window.HX_DATA || {}; },
    set data(v) { window.HX_DATA = v; },
    isMac,

    on(type, fn) {
      if (typeof fn !== 'function') return () => {};
      let m = wrappers.get(fn);
      if (!m) { m = new Map(); wrappers.set(fn, m); }
      if (m.has(type)) return () => HX.off(type, fn);
      const listener = (e) => {
        try { fn(wrapDetail(e.detail, type), e); } catch (err) { console.error('[hx] handler for ' + type + ' failed', err); }
      };
      m.set(type, listener);
      bus.addEventListener(type, listener);
      return () => HX.off(type, fn);
    },
    off(type, fn) {
      const m = wrappers.get(fn);
      const l = m && m.get(type);
      if (l) { bus.removeEventListener(type, l); m.delete(type); }
    },
    emit(type, detail) {
      bus.dispatchEvent(new CustomEvent(type, { detail }));
      try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch (e) { /* ignore */ }
    },
    register(name, mod) {
      if (typeof mod === 'function') mod = { mount: mod };
      if (!name || !mod) return;
      registry.set(name, mod);
      if (booted) { mountModule(name); queueLayout(false); }
    },
    setState(patch) { return setState(patch || {}); },
    toggle(key) {
      if (key === 'left') return setState({ left: state.left === 'open' ? prefs.collapse : 'open' });
      if (key === 'right') return setState({ right: state.right === 'open' ? 'closed' : 'open' });
      if (key === 'dock') return setState({ dock: state.dock === 'on' ? 'off' : 'on' });
      if (key === 'tab') return setState({ tab: state.tab === 'session' ? 'bots' : 'session' });
    },
    openPalette(opts) { openPalette(opts || {}); },
    toast(msg) { toast(msg); },
    keys(spec) { return kbdLabel(spec); },
    relayout() { queueLayout(false); }
  };

  /* ───────────── elements ───────────── */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  let app, el = {};

  /* ───────────── state ───────────── */
  function setState(patch) {
    if (mounting && patch && patch.tab) { patch = Object.assign({}, patch); delete patch.tab; }
    const auto = !!(patch && patch._auto);
    if (auto) { patch = Object.assign({}, patch); delete patch._auto; }
    const next = {};
    if (patch.tab && TABS.includes(patch.tab)) next.tab = patch.tab;
    if (patch.left && LEFT.includes(patch.left)) next.left = patch.left;
    if (patch.right && RIGHT.includes(patch.right)) next.right = patch.right;
    if (patch.dock && DOCK.includes(patch.dock)) next.dock = patch.dock;
    if (typeof patch.orbGrow === 'boolean') next.orbGrow = patch.orbGrow;
    if (patch.theme && window.HX_THEME) {
      // 'light' and 'dark' pick the Bone and Card catalog presets; a preset id picks that preset
      const id = patch.theme === 'light' ? 'bone' : patch.theme === 'dark' ? 'catalog' : patch.theme;
      if (window.HX_THEME.presets[id]) window.HX_THEME.preset(id);
      patch = Object.assign({}, patch); delete patch.theme;   // state.theme follows hx:theme
    }
    // modules may keep extra keys on the shared state
    for (const k of Object.keys(patch)) if (!(k in defaults())) next[k] = patch[k];
    if ('left' in next && !auto) leftAuto = false;   /* the person set it: it stays, and it is stored */
    const changed = Object.keys(next).filter(k => state[k] !== next[k]);
    if (!changed.length) { if ('left' in next && !auto) save(); return state; }
    Object.assign(state, next);
    applyState(changed);
    save();
    HX.emit('hx:state', { state, changed });
    if (changed.includes('tab')) {
      HX.emit('hx:tab', { tab: state.tab });
      if (!patch._fromHistory) pushHistory({ tab: state.tab, sel: selection[state.tab] });
    }
    if (changed.some(k => ['left', 'right', 'dock', 'tab'].includes(k))) queueLayout(true);
    return state;
  }
  const seg = { tabs: null, rail: null, collapse: null };
  const TABNAME = { session: 'Session', bots: 'Bots' };
  function defaults() { return { tab: 1, left: 1, right: 1, dock: 1, theme: 1, orbGrow: 1 }; }

  function applyState(changed) {
    if (!app) return;
    const all = !changed;
    app.dataset.tab = state.tab;
    app.dataset.left = state.left;
    app.dataset.right = state.right;
    app.dataset.dock = state.dock;
    // tabs: the pill and the rail are HX.ui.segmented; select() is quiet (no ui:change)
    for (const sg of [seg.tabs, seg.rail]) if (sg) sg.select(state.tab);
    for (const v of $$('.hx-view', app)) setActive(v, v.dataset.view === state.tab);
    for (const l of $$('.hx-list', app)) setActive(l, l.dataset.list === state.tab);
    const newLabel = state.tab === 'bots' ? 'New bot' : 'New session';
    $('.hx-new__label', el.btnNew).textContent = newLabel;
    const railNew = $('.hx-rail__new', app); railNew.dataset.tip = newLabel; railNew.setAttribute('aria-label', newLabel);
    // sidebar toggle
    const open = state.left === 'open';
    el.btnLeft.dataset.tip = open ? 'Hide sidebar' : 'Show sidebar';
    el.btnLeft.setAttribute('aria-label', el.btnLeft.dataset.tip);
    el.btnLeft.setAttribute('aria-expanded', String(open));
    $('.hx-rail', app).setAttribute('aria-hidden', String(state.left !== 'rail'));
    $('.hx-rail', app).inert = state.left !== 'rail';
    for (const n of $$('.hx-seg, .hx-new, .hx-foot__gear', app)) n.inert = state.left === 'rail';
    el.side.inert = state.left === 'closed';
    // right
    el.rightShell.dataset.right = state.right;
    el.rightSlot.dataset.right = state.right;
    const ropen = state.right === 'open';
    el.btnRight.dataset.tip = ropen ? 'Hide session details' : 'Show session details';
    el.btnRight.setAttribute('aria-label', el.btnRight.dataset.tip);
    el.btnRight.setAttribute('aria-expanded', String(ropen));
    el.btnRight.disabled = state.tab !== 'session';
    // settings controls (the account menu reads state when it opens)
    const sDock = $('#hx-set-dock'); if (sDock) sDock.checked = state.dock === 'on';
    app.dataset.orbGrow = state.orbGrow ? 'on' : 'off';
    const sGrow = $('#hx-set-orb-grow'); if (sGrow) sGrow.checked = state.orbGrow;
    if (seg.collapse) seg.collapse.select(prefs.collapse);
    updateTitle();
    updateAttentionDots();
  }
  function setActive(node, on) {
    node.classList.toggle('is-active', on);
    node.inert = !on;
    if (on) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', 'true');
  }

  /* ───────────── layout ───────────── */
  let probes = {};
  let insets = { session: { left: 0, right: 0 }, bots: { left: 0, right: 0 } };
  let layoutQueued = 0, layoutAnimate = false, resizeTimer = 0;
  let dockHeight = null;   // the dock's current height from hx:dock (rest or expanded); null until it reports

  function measureProbes() {
    probes = {};
    for (const i of $$('.hx-probe [data-probe]')) probes[i.dataset.probe] = i.getBoundingClientRect().width;
  }
  function durMs() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim();
    const n = parseFloat(v); return /ms$/.test(v) ? n : n * 1000 || 320;
  }
  function computeLayout() {
    measureProbes();
    const W = app.clientWidth, H = app.clientHeight;
    const r = app.getBoundingClientRect();
    const phone = W < 640, narrow = W < 900, wide = W >= 1200;
    const sb = probes.sb || 288, rail = probes.rail || 56, rw = probes.right || 340, rr = probes.rrail || 28;

    let sideW = 0, leftPush = 0, leftMode = 'push';
    if (state.left === 'open') {
      sideW = phone ? Math.min(W - 48, sb) : sb;
      if (narrow) { leftMode = 'overlay'; leftPush = phone ? 0 : rail; } else leftPush = sb;
    } else if (state.left === 'rail') {
      sideW = phone ? 0 : rail; leftPush = sideW;
    }
    let rightVW = rr, rightPush = rr, rightMode = 'push';
    if (state.tab === 'bots') { rightVW = 0; rightPush = 0; }   // session details belong to the session tab
    else if (state.right === 'open') {
      rightVW = phone ? W : Math.min(rw, W - 40);
      if (wide) rightPush = rightVW; else rightMode = 'overlay';
    }
    const ins = insets[state.tab] || { left: 0, right: 0 };
    const viewLeft = leftPush, viewRight = W - rightPush;
    const cL = viewLeft + (ins.left || 0), cR = viewRight - (ins.right || 0);
    const centerX = (cL + cR) / 2;
    const pad = phone ? 16 : 32;
    const colWidth = Math.max(0, Math.min(probes.col || 720, cR - cL - pad * 2));
    const colLeft = centerX - colWidth / 2;
    const marginW = colWidth >= 560 ? 112 : 0;       // the call-number margin folds away on narrow columns
    const dockSpace = state.dock === 'on' ? (typeof dockHeight === 'number' && dockHeight > 0 ? dockHeight : (probes.dock || 72)) : 0;

    const set = (k, v) => app.style.setProperty(k, Math.round(v * 100) / 100 + 'px');
    set('--hx-side-w', sideW);
    set('--hx-view-left', viewLeft);
    set('--hx-view-right', rightPush);
    set('--hx-center-x', centerX);
    set('--hx-col-left', colLeft);
    set('--hx-col-w', colWidth);
    set('--hx-right-vw', rightVW);
    set('--hx-dock-space', dockSpace);
    set('--hx-margin-w', marginW);
    app.dataset.margin = marginW ? 'on' : 'off';
    app.dataset.leftMode = leftMode;
    app.dataset.rightMode = rightMode;
    app.dataset.bp = phone ? 'phone' : narrow ? 'narrow' : wide ? 'wide' : 'mid';
    app.dataset.lcorner = viewLeft > 0 ? 'on' : 'off';
    app.dataset.rcorner = state.tab === 'session' && state.right === 'open' && rightMode === 'push' ? 'on' : 'off';

    // scrim for overlay drawers on narrow windows
    const scrimOn = narrow && ((state.left === 'open' && leftMode === 'overlay') || (state.right === 'open' && rightMode === 'overlay'));
    el.scrim.hidden = !scrimOn && !el.scrim.classList.contains('is-on');
    requestAnimationFrame(() => el.scrim.classList.toggle('is-on', scrimOn));
    if (!scrimOn) setTimeout(() => { if (!el.scrim.classList.contains('is-on')) el.scrim.hidden = true; }, 260);

    const L = {
      centerX: r.left + centerX, colLeft: r.left + colLeft, colWidth,
      viewportW: window.innerWidth, viewportH: window.innerHeight,
      appLeft: r.left, appTop: r.top, appW: W, appH: H,
      viewLeft: r.left + viewLeft, viewRight: r.left + viewRight,
      leftW: sideW, rightW: rightVW, leftMode, rightMode,
      chromeH: probes.chrome || 40, dockSpace, marginW, composerW: colWidth, dock: state.dock,
      tab: state.tab, left: state.left, right: state.right,
      duration: durMs(), easing: 'var(--spring)', animate: layoutAnimate && !app.classList.contains('is-booting')
    };
    HX.layout = L;
    return L;
  }
  function queueLayout(animate) {
    layoutAnimate = layoutAnimate || !!animate;
    if (layoutQueued) return;
    layoutQueued = requestAnimationFrame(() => {
      layoutQueued = 0;
      if (!app) return;
      const L = computeLayout();
      layoutAnimate = false;
      HX.emit('hx:layout', L);
    });
  }
  function layoutNow(animate) {
    layoutAnimate = !!animate;
    const L = computeLayout();
    layoutAnimate = false;
    HX.emit('hx:layout', L);
  }

  /* ───────────── keyboard labels ───────────── */
  const KEYNAMES = isMac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
    : { mod: 'ctrl', shift: 'shift', alt: 'alt', ctrl: 'ctrl' };
  function kbdParts(spec) {
    return String(spec).split('+').map(p => KEYNAMES[p.toLowerCase()] || (p.length === 1 ? p.toUpperCase() : p.toLowerCase()));
  }
  function kbdLabel(spec) { return kbdParts(spec).join(isMac ? '' : ' '); }
  const kbdHTML = (spec) => HX.ui.html.keys(spec);   // .ui-keys / .ui-kbd, aria-hidden (the control carries aria-keyshortcuts)
  const ariaKeys = (spec) => String(spec).split('+').map(k => ({ mod: isMac ? 'Meta' : 'Control', shift: 'Shift', alt: 'Alt', esc: 'Escape', enter: 'Enter' }[k.toLowerCase()] || k)).join('+');
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ───────────── keymap (KEYMAP.md is the spec; this table feeds the sheet, Settings and the palette) ─────────────
     Spec syntax: alternatives ' | ', a sequence ' ' (press one after the other), a combination '+',
     'hold:X' (press and hold). 'mod' is ⌘ on macOS and Ctrl elsewhere; 'alt' is ⌥ Option on macOS. */
  const KEYGROUPS = [
    ['General', [
      ['Search and commands', 'mod+K'],
      ['Go to a session or bot', 'mod+P'],
      ['Find in this conversation', 'mod+F'],
      ['New session or bot', 'mod+shift+O'],
      ['Stop the running turn', 'mod+.'],
      ['Back, forward', 'mod+[ | mod+]'],
      ['Settings', 'mod+,'],
      ['Appearance and theme', 'mod+shift+,'],
      ['Light or dark theme', 'mod+shift+L'],
      ['Keyboard shortcuts', 'mod+/ | ?'],
      ['Close the top layer, or leave the composer', 'esc']
    ]],
    ['Layout', [
      ['Session tab, Bots tab', 'alt+1 | alt+2'],
      ['Sidebar: open or collapse', 'mod+B'],
      ['Sidebar: hide or show', 'mod+shift+B'],
      ['Details panel (bot settings on Bots)', 'mod+I'],
      ['Dock on or off', 'mod+J'],
      ['Expand or collapse the dock', 'mod+shift+J']
    ]],
    ['Move around', [
      ['Next or previous region', 'F6 | shift+F6'],
      ['Next or previous thing that needs you', 'F8 | shift+F8'],
      ['Sidebar list', 'mod+G L'],
      ['Conversation', 'mod+G M'],
      ['Composer', 'mod+G I | / | i'],
      ['Details panel', 'mod+G P'],
      ['Dock', 'mod+G D'],
      ['Session or Bots tab', 'mod+G S | mod+G B'],
      ['Bot n in the dock', 'mod+G 1-9'],
      ['Go to without the modifier (outside text fields)', 'g']
    ]],
    ['Lists', [
      ['Previous or next row', 'up | down | k | j'],
      ['First or last row', 'home | end'],
      ['Open', 'enter'],
      ['Previous or next project', 'shift+up | shift+down']
    ]],
    ['Conversation', [
      ['Previous or next turn', 'up | down | k | j'],
      ['First or latest turn', 'home | end | g g | shift+G'],
      ['Open or close the steps', 'enter | o'],
      ['Copy the turn', 'c'],
      ['Edit your message', 'e'],
      ['Open the diff', 'd'],
      ['Answer the blank', 'b']
    ]],
    ['Cards', [
      ['Approve', 'hold:space | enter enter'],
      ['Deny', 'x'],
      ['Pick a blank option', '1-9'],
      ['Back to the turn', 'esc']
    ]],
    ['Composer', [
      ['Send', 'enter'],
      ['New line', 'shift+enter'],
      ['Send now', 'mod+enter'],
      ['Edit your last message (empty composer)', 'up'],
      ['Review the assumptions', 'tab'],
      ['Governed or ungoverned', 'alt+G'],
      ['Smart on or off', 'alt+S'],
      ['Choose the model', 'alt+M'],
      ['Attach files', 'alt+A'],
      ['Talk: a tap toggles listening, a hold talks while held', 'alt+V'],
      ['Stop listening (while listening)', 'esc']
    ]],
    ['Dock', [
      ['Previous or next bot', 'left | right'],
      ['Open the bot', 'enter'],
      ['Open its card', 'space'],
      ['Previous or next page', '[ | ]'],
      ['Bot n', '1-9'],
      ['Close, collapse, leave', 'esc']
    ]],
    ['Palette', [
      ['Move', 'up | down'],
      ['Run', 'enter'],
      ['Commands only', '>'],
      ['Bots only', '@'],
      ['Close', 'esc']
    ]]
  ];
  const KEYLABEL = { up: '↑', down: '↓', left: '←', right: '→', enter: 'enter', esc: 'esc', space: 'space', tab: 'tab', home: 'home', end: 'end', pageup: 'pgup', pagedown: 'pgdn' };
  function comboHTML(c) {
    return c.split('+').map(k => {
      const low = k.toLowerCase();
      const label = KEYNAMES[low] || KEYLABEL[low] || (/^f\d+$/.test(low) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k);
      return '<kbd class="ui-kbd">' + esc(label) + '</kbd>';
    }).join('');
  }
  function specHTML(spec) {
    return spec.split(' | ').map(alt => '<span class="ui-keys">' + alt.split(' ').map(step =>
      step.startsWith('hold:') ? '<span class="hx-kword">hold</span>' + comboHTML(step.slice(5)) : comboHTML(step)).join('<span class="hx-kthen" aria-hidden="true"></span>') + '</span>').join('<span class="hx-kword">or</span>');
  }
  function keysTableHTML(filter) {
    const f = (filter || '').trim().toLowerCase();
    let html = '';
    for (const [group, rows] of KEYGROUPS) {
      const list = rows.filter(([label, spec]) => !f || (group + ' ' + label + ' ' + spec).toLowerCase().includes(f));
      if (!list.length) continue;
      html += '<section class="hx-keygroup"><h3>' + esc(group) + '</h3><dl>' + list.map(([label, spec]) => '<div><dt>' + esc(label) + '</dt><dd>' + specHTML(spec) + '</dd></div>').join('') + '</dl></section>';
    }
    return html || '<p class="hx-keys-empty">No shortcut matches <b>' + esc(filter) + '</b>.</p>';
  }

  /* ───────────── regions (F6, go to) ───────────── */
  const REGION_ORDER = ['bar', 'list', 'messages', 'composer', 'panel', 'dock'];
  const REGION_NAME = { bar: 'Title bar', list: 'Sidebar list', messages: 'Conversation', composer: 'Composer', panel: 'Details panel', dock: 'Dock' };
  const lastInRegion = {};
  const visible = (n) => !!n && n.isConnected && n.getClientRects().length > 0 && !n.closest('[inert]') && !n.closest('[hidden]');
  const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const activeView = () => $('#hx-view-' + state.tab);
  function composerIn(view) {
    if (!view) return null;
    return [...view.querySelectorAll('[data-hx-focus="composer"], textarea, [contenteditable="true"], [role="textbox"]')].find(visible) || null;
  }
  function panelRoot() {
    if (state.tab === 'session') return state.right === 'open' ? el.rightSlot : null;
    const v = activeView();
    return v ? [...v.querySelectorAll('[data-hx-panel], .bt-sheet')].find(visible) || null : null;
  }
  function regionRoot(r) {
    switch (r) {
      case 'bar': return $('.hx-bar', app);
      case 'list': return state.left === 'closed' || (state.left === 'rail' && !$('.hx-list.is-active[data-rail="ok"]', app)) || (HX.layout || {}).bp === 'phone' && state.left !== 'open' ? null : $('.hx-list.is-active', app);
      case 'messages': return activeView();
      case 'composer': return composerIn(activeView());
      case 'panel': return panelRoot();
      case 'dock': return state.dock === 'on' ? $('#hx-dock', app) : null;
    }
    return null;
  }
  function regionOf(node) {
    if (!node || !app.contains(node)) return null;
    if (node.closest('.hx-bar')) return 'bar';
    if (node.closest('.hx-side')) return 'list';
    if (node.closest('#hx-dock')) return 'dock';
    if (node.closest('#hx-right-shell, [data-hx-panel], .bt-sheet')) return 'panel';
    const v = node.closest('.hx-view');
    if (v) { const c = composerIn(v); if (c && (c === node || c.contains(node) || node.closest('[data-hx-composer], .ssc, .bt-composer'))) return 'composer'; return 'messages'; }
    return null;
  }
  function defaultTarget(r, root) {
    if (r === 'bar') return el.btnSearch;
    if (r === 'composer') return root;
    const pref = root.querySelector('[data-hx-focus="' + r + '"]');
    if (visible(pref)) return pref;
    if (r === 'list' || r === 'dock') {
      const cur = [...root.querySelectorAll('[aria-current="true"], [aria-selected="true"]')].find(visible);
      if (cur) return cur;
    }
    if (r === 'messages') {
      const turns = [...root.querySelectorAll('[data-hx-turn]')].filter(visible);
      if (turns.length) return turns[turns.length - 1];
    }
    if (r !== 'messages') { const first = [...root.querySelectorAll(FOCUSABLE)].find(visible); if (first) return first; }
    return root;   // the region itself, made focusable
  }
  const srLive = () => $('#hx-sr', app);
  function focusRegion(r, opts) {
    if (r === 'list' && !regionRoot('list')) setState({ left: 'open' });
    if (r === 'panel' && !regionRoot('panel')) { if (state.tab === 'session') setState({ right: 'open' }); else HX.emit('hx:bot-settings', { open: true, from: 'keyboard' }); }
    if (r === 'dock' && state.dock !== 'on') setState({ dock: 'on' });
    const go2 = () => {
      const root = regionRoot(r);
      if (!root) { toast(REGION_NAME[r] + ' is not available here'); return; }
      const remembered = lastInRegion[r];
      let t = (!opts || !opts.fresh) && remembered && root.contains(remembered) && visible(remembered) ? remembered : defaultTarget(r, root);
      if (!t.matches(FOCUSABLE) && !t.hasAttribute('tabindex')) { t.setAttribute('tabindex', '-1'); t.setAttribute('data-hx-region-focus', ''); }
      t.focus({ preventScroll: false });
      if (t.scrollIntoView && r === 'messages' && t !== root) t.scrollIntoView({ block: 'nearest' });
      const sr = srLive(); if (sr) sr.textContent = REGION_NAME[r];
      HX.emit('hx:region', { region: r });
    };
    // panels and sidebars that just opened need a frame to render
    if (regionRoot(r)) go2(); else setTimeout(go2, 60);
  }
  function cycleRegion(dir) {
    const avail = REGION_ORDER.filter(r => regionRoot(r));
    if (!avail.length) return;
    const cur = regionOf(document.activeElement);
    let i = avail.indexOf(cur);
    i = i < 0 ? (dir > 0 ? 0 : avail.length - 1) : (i + dir + avail.length) % avail.length;
    focusRegion(avail[i]);
  }

  /* ───────────── things that need you (F8) ───────────── */
  const ATTN = '[data-hx-attention], button.ss-blank, button.cd-blank:has(.cd-stamp), button.cd-hold[data-hold]';
  function attentionTargets() {
    const order = [state.tab, state.tab === 'session' ? 'bots' : 'session'];
    const out = [];
    for (const t of order) {
      const v = $('#hx-view-' + t);
      if (!v) continue;
      for (const n of v.querySelectorAll(ATTN)) if (!out.includes(n) && n.getClientRects().length + (t === state.tab ? 0 : 1) > 0) out.push({ n, tab: t });
    }
    return out;
  }
  function nextAttention(dir) {
    const list = attentionTargets();
    if (!list.length) { toast('Nothing needs you right now'); return; }
    const cur = list.findIndex(x => x.n === document.activeElement || x.n.contains(document.activeElement));
    const i = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
    const { n, tab } = list[i];
    const show = () => {
      if (!n.matches(FOCUSABLE)) n.setAttribute('tabindex', '-1');
      n.scrollIntoView({ block: 'center', behavior: 'smooth' });
      n.focus({ preventScroll: true });
      const sr = srLive(); if (sr) sr.textContent = (i + 1) + ' of ' + list.length + ' that need you';
    };
    if (tab !== state.tab) { setState({ tab }); setTimeout(show, 80); } else show();
  }

  /* ───────────── go to (mod+G, or g outside text fields) ───────────── */
  let leader = null;
  const GOTO = { l: 'list', m: 'messages', i: 'composer', p: 'panel', d: 'dock' };
  function startLeader(withMod) {
    clearTimeout(leader && leader.t);
    const hint = $('#hx-goto', app);
    hint.hidden = false;
    hint.innerHTML = '<span class="hx-goto__title">Go to</span>' + [['L', 'list'], ['M', 'conversation'], ['I', 'composer'], ['P', 'panel'], ['D', 'dock'], ['S', 'Session'], ['B', 'Bots'], ['1-9', 'bot in the dock']].concat(withMod ? [] : [['G', 'first turn']])
      .map(([k, l]) => '<span class="hx-goto__opt"><kbd class="ui-kbd">' + k + '</kbd>' + esc(l) + '</span>').join('');
    leader = { t: setTimeout(endLeader, 1600), withMod };
  }
  function endLeader() { if (!leader) return; clearTimeout(leader.t); leader = null; const h = $('#hx-goto', app); if (h) h.hidden = true; }
  function leaderKey(e) {
    const code = e.code || '', k = (e.key || '').toLowerCase();
    const withMod = leader.withMod;
    endLeader();
    if (e.key === 'Escape') { e.preventDefault(); return true; }
    if (/^Digit[1-9]$/.test(code)) { e.preventDefault(); openDockBot(+code.slice(5)); return true; }
    const letter = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : k;
    if (GOTO[letter]) { e.preventDefault(); focusRegion(GOTO[letter]); return true; }
    if (letter === 's' || letter === 'b') { e.preventDefault(); setState({ tab: letter === 's' ? 'session' : 'bots' }); return true; }
    if (letter === 'g' && !withMod) { e.preventDefault(); HX.emit('hx:nav', { action: 'first', region: regionOf(document.activeElement) || 'messages' }); return true; }
    return false;
  }
  function openDockBot(n) {
    const order = (window.hxDock && typeof window.hxDock.botAt === 'function') ? null : (HX.data.bots || []);
    const id = order ? (order[n - 1] || {}).id : window.hxDock.botAt(n);
    if (!id) { toast('No bot ' + n + ' in the dock'); return; }
    setState({ tab: 'bots' }); selection.bots = id;
    HX.emit('hx:bot-select', { id, from: 'keyboard' }); updateTitle();
  }

  /* ───────────── shortcuts sheet ───────────── */
  function openKeys() {
    closePalette(true); closeMenu(false);
    const d = $('#hx-keys-sheet', app);
    const input = $('#hx-keys-filter', d);
    input.value = '';
    $('#hx-keys-body', d).innerHTML = keysTableHTML('');
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
    input.focus();
  }


  /* ───────────── history (back / forward) ───────────── */
  const selection = { session: null, bots: null };
  const hist = { stack: [], i: -1 };
  function pushHistory(entry) {
    const cur = hist.stack[hist.i];
    if (cur && cur.tab === entry.tab && cur.sel === entry.sel) return;
    hist.stack = hist.stack.slice(0, hist.i + 1);
    hist.stack.push(entry);
    if (hist.stack.length > 60) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    updateNav();
  }
  function go(delta) {
    const j = hist.i + delta;
    if (j < 0 || j >= hist.stack.length) return;
    hist.i = j;
    const e = hist.stack[j];
    setState({ tab: e.tab, _fromHistory: true });
    if (e.sel) {
      selection[e.tab] = e.sel;
      HX.emit(e.tab === 'bots' ? 'hx:bot-select' : 'hx:session-select', { id: e.sel, from: 'history' });
    }
    updateNav(); updateTitle();
  }
  function updateNav() {
    if (!el.btnBack) return;
    el.btnBack.disabled = hist.i <= 0;
    el.btnFwd.disabled = hist.i >= hist.stack.length - 1;
  }

  /* ───────────── title ───────────── */
  let titleOverride = { session: null, bots: null };
  /* the command centre shows where you are: project / session, or bots / bot */
  function updateTitle() {
    if (!el.whereTitle) return;
    const D = HX.data;
    let project = '', t = titleOverride[state.tab];
    if (state.tab === 'session') {
      const ss = D.sessions || [];
      const s = ss.find(x => x.id === selection.session) || ss.find(x => x.running) || ss[0];
      project = s ? s.project : '';
      t = t || (s ? s.title : 'New session');
    } else {
      const b = (D.bots || []).find(x => x.id === selection.bots);
      project = 'Bots';
      t = t || (b ? b.name : 'All bots');
    }
    el.whereProject.textContent = project;
    el.whereTitle.textContent = t;
    el.btnSearch.setAttribute('aria-label', 'Search and commands. Current: ' + (project ? project + ', ' : '') + t);
  }

  /* ───────────── attention ───────────── */
  const attention = new Map(); // source -> { count, tab }
  function tabForSource(src, tab) {
    if (TABS.includes(tab)) return tab;
    const bots = (HX.data.bots || []).map(b => b.id);
    if (bots.includes(src) || /^bot/.test(String(src))) return 'bots';
    return 'session';
  }
  /* One count per tab, from the module that owns the items: 'session' for the session tab, 'bots' for the bots tab.
     'cards' and 'dock' report the same items again (a card lives inside a session or a bot thread, the dock mirrors
     both), so they never add to a tab. Values seeded from data.js stand in only until the owner reports. Other
     sources add their unique ids when they send them, or their count. */
  const OWNER = { session: 'session', bots: 'bots' };
  const MIRRORS = new Set(['cards', 'dock']);
  function attentionFor(tab) {
    if (attention.has(OWNER[tab])) {
      const own = attention.get(OWNER[tab]);
      const ids = new Set(own.ids || []);
      let n = own.ids ? ids.size : own.count;
      for (const [src, v] of attention) {
        if (src === OWNER[tab] || MIRRORS.has(src) || src.startsWith('seed:') || v.tab !== tab) continue;
        if (v.ids) { for (const id of v.ids) if (!ids.has(id)) { ids.add(id); n++; } } else n += v.count;
      }
      return n;
    }
    let n = 0;
    for (const [src, v] of attention) if (v.tab === tab && !MIRRORS.has(src)) n += v.count;
    return n;
  }
  HX.attention = (tab) => (tab ? attentionFor(tab) : attentionFor('session') + attentionFor('bots'));
  function updateAttentionDots() {
    const per = { session: attentionFor('session'), bots: attentionFor('bots') };
    for (const sg of [seg.tabs, seg.rail]) if (sg) for (const b of $$('[role="tab"]', sg)) {
      const t = b.dataset.value, n = per[t] || 0;
      const dot = $('.ui-dot', b); if (dot) dot.toggleAttribute('data-show', n > 0);
      b.setAttribute('aria-label', n > 0 && t !== state.tab ? TABNAME[t] + ', needs you' : TABNAME[t]);
    }
  }

  /* ───────────── tooltips, toast, account menu: HX.ui (one implementation for every module) ─────────────
     Tooltips are delegated by the library on [data-tip] (+ data-kbd, data-tip-pos); the shell only hides them. */
  const hideTip = () => HX.ui.tooltip.hide();
  function toast(msg, o) { HX.ui.toast(msg, o); }
  HX.toast = toast;

  function openMenu() {
    hideTip();
    const U = HX.data.user || { name: 'you' };
    const m = HX.ui.menu.open(el.btnAccount, [
      { title: U.name },
      { label: 'Settings', value: 'settings', keys: 'mod+,', role: 'menuitem' },
      { label: 'Keyboard shortcuts', value: 'shortcuts', keys: 'mod+/', role: 'menuitem' },
      '-',
      { label: 'Show the dock', value: 'dock', role: 'menuitemcheckbox', checked: state.dock === 'on', keys: 'mod+J' },
      { label: 'Show session details', value: 'right', role: 'menuitemcheckbox', checked: state.right === 'open', keys: 'mod+I', disabled: state.tab !== 'session' }
    ], { place: 'above', label: 'Account', onSelect: menuAction });
    // an account menu starts at its first item (the library starts a choice menu at the checked one)
    const first = m && m.querySelector('.ui-menu__item:not(:disabled)'); if (first) first.focus({ preventScroll: true });
  }
  const closeMenu = (returnFocus) => HX.ui.menu.close(returnFocus);
  function menuAction(act) {
    // the menu returns focus to the account button as it closes, so a dialog opens on the next tick and keeps it
    if (act === 'settings') setTimeout(() => openSettings(), 0);
    else if (act === 'shortcuts') setTimeout(openKeys, 0);
    else if (act === 'dock') HX.toggle('dock');
    else if (act === 'right') HX.toggle('right');
  }

  /* ───────────── settings ───────────── */
  /* Settings: General, Appearance (the theme customizer) and Keyboard. On Appearance the dialog steps aside to the
     right edge and drops its scrim, so every change shows on the whole app as it is made. */
  let themeMounted = false;
  function showSettingsSection(section) {
    const d = el.settings;
    section = ['general', 'appearance', 'keys'].includes(section) ? section : 'general';
    for (const t of $$('.hx-dtab', d)) {
      const on = t.dataset.section === section;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    }
    for (const p of $$('.hx-dpanel', d)) p.hidden = p.id !== 'hx-dpanel-' + section;
    if (section === 'appearance' && !themeMounted && window.HX_THEME) { window.HX_THEME.mount($('#hx-dpanel-appearance')); themeMounted = true; mountOrbGrow(); }
    d.classList.toggle('is-side', section === 'appearance');
    $('.hx-dialog__body', d).scrollTop = 0;
  }
  function mountOrbGrow() {
    const panel = $('#hx-dpanel-appearance'); if (!panel || $('#hx-set-orb-grow', panel)) return;
    const sec = document.createElement('section');
    sec.className = 'hx-set'; sec.setAttribute('aria-labelledby', 'hx-set-bots-h');
    sec.innerHTML = '<h3 class="ui-set__head" id="hx-set-bots-h">Bots</h3>' + HX.ui.html.setRow({ for: 'hx-set-orb-grow', label: 'Grow bots on hover', hint: 'Bots in the dock grow under the pointer.',
      control: HX.ui.html.switch({ id: 'hx-set-orb-grow', checked: state.orbGrow }) });
    const colours = $('[aria-labelledby="hxt-h-colours"]', panel);
    panel.insertBefore(sec, colours || null);
    HX.ui.hydrate(sec);
    $('#hx-set-orb-grow', sec).addEventListener('ui:change', (e) => setState({ orbGrow: !!e.detail.value }));
  }
  function toggleOrbGrow() {
    setState({ orbGrow: !state.orbGrow });
    toast(state.orbGrow ? 'Bots grow on hover' : 'Bots keep their size on hover');
  }
  function openSettings(section) {
    closePalette(); closeMenu(false);
    const d = el.settings;
    showSettingsSection(section);
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
    const card = $('.hx-dialog__card', d); card.tabIndex = -1; card.focus({ preventScroll: true });
  }

  /* ───────────── command palette ───────────── */
  let pal = { items: [], active: 0, scope: null, ret: null };
  // the library's orb: 16px is a still thumbnail, its state reaction and dark-body eyes come with it
  const botIcon = (b) => HX.ui.html.orb(b, { size: 16 });
  const ICON = (name) => HX.ui.icon(name);
  const GROUPS = { sessions: 'Sessions', bots: 'Bots', commands: 'Commands' };
  function paletteItems() {
    const D = HX.data, out = [];
    for (const s of D.sessions || []) {
      out.push({ group: 'sessions', label: s.title, meta: s.project, trail: s.when, icon: ICON('session'), keys: s.project + ' session',
        run: () => { setState({ tab: 'session' }); selection.session = s.id; HX.emit('hx:session-select', { id: s.id, from: 'palette' }); pushHistory({ tab: 'session', sel: s.id }); updateTitle(); } });
    }
    for (const b of D.bots || []) {
      out.push({ group: 'bots', label: b.name, meta: b.role, icon: botIcon(b), keys: 'bot ' + (b.attention || ''), trail: b.attention ? 'needs you' : '', attn: !!b.attention,
        run: () => { setState({ tab: 'bots' }); selection.bots = b.id; HX.emit('hx:bot-select', { id: b.id, from: 'palette' }); pushHistory({ tab: 'bots', sel: b.id }); updateTitle(); } });
    }
    const cmd = (label, kbd, run, icon, keys) => out.push({ group: 'commands', label, kbd, run, icon: icon || '', keys: keys || '' });
    cmd('New session', state.tab === 'session' ? 'mod+shift+O' : '', () => newThing('session'), ICON('plus'));
    cmd('New bot', state.tab === 'bots' ? 'mod+shift+O' : '', () => newThing('bots'), ICON('plus'));
    cmd(state.tab === 'session' ? 'Go to bots' : 'Go to sessions', state.tab === 'session' ? 'alt+2' : 'alt+1', () => HX.toggle('tab'), ICON(state.tab === 'session' ? 'bots' : 'session'), 'tab switch');
    cmd(state.left === 'open' ? 'Hide sidebar' : 'Show sidebar', 'mod+B', () => HX.toggle('left'), ICON('sidebar-left'), 'sidebar left');
    if (state.left !== 'rail') cmd('Collapse the sidebar to a rail', '', () => setState({ left: 'rail' }), ICON('sidebar-left'), 'sidebar left rail');
    if (state.left !== 'closed') cmd('Hide the sidebar completely', 'mod+shift+B', () => setState({ left: 'closed' }), ICON('sidebar-left'), 'sidebar left close');
    cmd(state.tab === 'bots' ? 'Show or hide bot settings' : state.right === 'open' ? 'Hide session details' : 'Show session details', 'mod+I', togglePanel, ICON('sidebar-right'), 'right panel sidebar context details inspector');
    if ((providers.stop || []).length) cmd('Stop the running turn', 'mod+.', () => callProvided('stop', { tab: state.tab, from: 'palette' }), ICON('stop'), 'cancel interrupt halt');
    if ((providers.find || []).length) cmd('Find in this conversation', 'mod+F', () => callProvided('find', { tab: state.tab, from: 'palette' }), ICON('search'), 'search text');
    cmd('Next thing that needs you', 'F8', () => nextAttention(1), ICON('forward'), 'attention blank approval waiting');
    for (const [r, key] of [['list', 'L'], ['messages', 'M'], ['composer', 'I'], ['panel', 'P'], ['dock', 'D']]) cmd('Focus the ' + REGION_NAME[r].toLowerCase(), 'mod+G ' + key, () => focusRegion(r), ICON('forward'), 'focus region go to keyboard');
    for (const [p, words] of [['Context', 'tokens window'], ['Connectors', 'mcp tools'], ['Output', 'terminal logs'], ['Environment', 'sandbox runtime'], ['Tasks', 'todo'], ['Changes', 'diff files'], ['Governance', 'models cost ladder']]) {
      cmd('Open ' + p.toLowerCase(), '', () => openPanel(p.toLowerCase()), ICON('sidebar-right'), 'panel right details ' + words);
    }
    cmd(state.dock === 'on' ? 'Hide the dock' : 'Show the dock', 'mod+J', () => HX.toggle('dock'), ICON('dock'), 'dock bottom');
    cmd('Expand or collapse the dock', 'mod+shift+J', toggleDockExpand, ICON('dock'), 'dock bottom widgets');
    if (window.hxDock && typeof window.hxDock.setMode === 'function') cmd('Minimise the dock', '', () => { if (state.dock !== 'on') setState({ dock: 'on' }); window.hxDock.setMode('minimal'); }, ICON('dock'), 'dock small minimal');
    cmd('Toggle grow bots on hover', '', toggleOrbGrow, ICON('bots'), 'dock orb magnify size hover grow ' + (state.orbGrow ? 'on' : 'off'));
    cmd('Settings', 'mod+,', () => openSettings(), ICON('gear'), 'preferences');
    cmd('Keyboard shortcuts', 'mod+/', openKeys, ICON('gear'), 'keys help keymap');
    cmd('Appearance and theme', 'mod+shift+,', () => openSettings('appearance'), ICON('sliders'), 'theme colours fonts logo');
    cmd('Light or dark theme', 'mod+shift+L', toggleLightDark, ICON('sliders'), 'theme appearance');
    if (window.HX_THEME) {
      const cur = window.HX_THEME.get().preset;
      for (const [id, p] of Object.entries(window.HX_THEME.presets)) if (id !== cur) cmd('Use the ' + p.name + ' theme', '', () => setState({ theme: id }), ICON('sliders'), 'theme preset appearance ' + p.note);
    }
    return out;
  }
  function score(item, q) {
    if (!q) return 1;
    const hay = (item.label + ' ' + (item.meta || '') + ' ' + (item.keys || '')).toLowerCase();
    let s = 0;
    for (const w of q.split(/\s+/).filter(Boolean)) {
      const i = hay.indexOf(w);
      if (i < 0) return 0;
      s += (i === 0 ? 4 : hay[i - 1] === ' ' ? 2 : 1) + (item.label.toLowerCase().includes(w) ? 2 : 0);
    }
    return s;
  }
  function highlight(label, q) {
    const w = (q || '').split(/\s+/).filter(Boolean)[0];
    if (!w) return esc(label);
    const i = label.toLowerCase().indexOf(w);
    if (i < 0) return esc(label);
    return esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + w.length)) + '</mark>' + esc(label.slice(i + w.length));
  }
  function renderPalette() {
    const q = el.palInput.value.trim().toLowerCase();
    let raw = el.palInput.value.trim(), scope = pal.scope;
    if (raw.startsWith('>')) { scope = 'commands'; raw = raw.slice(1).trim(); }
    else if (raw.startsWith('@')) { scope = 'bots'; raw = raw.slice(1).trim(); }
    const q2 = raw.toLowerCase();
    let items = paletteItems().filter(it => !scope || it.group === scope || (scope === 'items' && it.group !== 'commands'));
    items = items.map(it => Object.assign(it, { s: score(it, q2) })).filter(it => it.s > 0);
    if (q2) {
      const order = { sessions: 0, bots: 1, commands: 2 };
      items.sort((a, b) => (b.s - a.s) || (order[a.group] - order[b.group]));
      // keep groups together, ordered by their best hit
      const best = {};
      items.forEach((it, i) => { if (!(it.group in best)) best[it.group] = i; });
      items.sort((a, b) => (best[a.group] - best[b.group]) || (b.s - a.s));
    }
    pal.items = items;
    pal.active = Math.min(pal.active, Math.max(0, items.length - 1));
    if (!items.length) {
      el.palList.innerHTML = '<div class="hx-pal-empty">Nothing matches <b>' + esc(el.palInput.value.trim()) + '</b>.<br>Try a session title, a bot\u2019s name or a command.</div>';
      el.palInput.removeAttribute('aria-activedescendant');
      return;
    }
    let html = '', g = null;
    items.forEach((it, i) => {
      if (it.group !== g) { g = it.group; html += '<div class="ui-group__head hx-pal-group" role="presentation">' + GROUPS[g] + '</div>'; }
      html += '<div class="ui-row hx-pal-row" role="option" id="hx-pal-' + i + '" data-i="' + i + '" data-kind="' + (it.group === 'commands' ? 'command' : 'item') + '" aria-selected="' + (i === pal.active) + '">' +
        '<span class="hx-pal-row__icon">' + (it.icon || '') + '</span>' +
        '<span class="hx-pal-row__label">' + highlight(it.label, q2) + '</span>' +
        (it.meta ? '<span class="hx-pal-row__meta">' + esc(it.meta) + '</span>' : '') +
        (it.trail ? '<span class="hx-pal-row__trail' + (it.attn ? ' is-attn' : '') + '">' + esc(it.trail) + '</span>' : '') +
        (it.kbd ? kbdHTML(it.kbd) : '') + '</div>';
    });
    el.palList.innerHTML = html;
    el.palInput.setAttribute('aria-activedescendant', 'hx-pal-' + pal.active);
  }
  function movePal(d) {
    if (!pal.items.length) return;
    pal.active = (pal.active + d + pal.items.length) % pal.items.length;
    for (const r of $$('.hx-pal-row', el.palList)) r.setAttribute('aria-selected', String(+r.dataset.i === pal.active));
    const row = $('#hx-pal-' + pal.active); if (row) row.scrollIntoView({ block: 'nearest' });
    el.palInput.setAttribute('aria-activedescendant', 'hx-pal-' + pal.active);
  }
  function runPal(i) {
    const it = pal.items[i]; if (!it) return;
    closePalette(true);
    it.run();
  }
  function openPalette(opts) {
    closeMenu(false); hideTip();
    const ks = $('#hx-keys-sheet', app); if (ks && ks.open) ks.close();
    if (el.settings.open) return;
    pal.scope = opts.scope || null;
    pal.ret = document.activeElement;
    pal.active = 0;
    el.palInput.value = opts.query || '';
    el.palInput.placeholder = pal.scope === 'items' ? 'Go to a session or bot' : pal.scope === 'sessions' ? 'Switch session' : pal.scope === 'bots' ? 'Switch bot' : 'Search, or type > for commands and @ for bots';
    el.palette.hidden = false;
    renderPalette();
    el.palInput.focus();
    el.btnSearch.setAttribute('aria-expanded', 'true');
  }
  function closePalette(keepFocus) {
    if (el.palette.hidden) return;
    el.palette.hidden = true;
    el.btnSearch.setAttribute('aria-expanded', 'false');
    if (!keepFocus && pal.ret && pal.ret.focus) pal.ret.focus();
  }

  /* ───────────── actions ───────────── */
  function newThing(tab) {
    tab = tab || state.tab;
    if (tab !== state.tab) setState({ tab });
    HX.emit('hx:new', { tab });
    HX.emit(tab === 'bots' ? 'hx:new-bot' : 'hx:new-session', { from: 'shell' });
  }
  function openPanel(panel) {
    setState({ right: 'open' });
    HX.emit('hx:open-panel', { panel, from: 'shell' });
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) { toast('Full screen is not available in this view'); }
  }
  function syncFullscreenIcon() {
    const fs = !!document.fullscreenElement;
    el.btnMax.innerHTML = HX.ui.icon(fs ? 'restore' : 'maximize');
    el.btnMax.dataset.tip = fs ? 'Exit full screen' : 'Full screen';
    el.btnMax.setAttribute('aria-label', el.btnMax.dataset.tip);
  }

  /* ───────────── keyboard ───────────── */
  /* Actions a module provides (find, stop, bot settings): the shell calls them for the global keys, so a key is
     only taken from the browser when someone answers it. HX.provide(name, fn): fn(detail) returns true if handled. */
  const providers = {};
  HX.provide = (name, fn) => { (providers[name] = providers[name] || []).push(fn); return () => { providers[name] = providers[name].filter(f => f !== fn); }; };
  function callProvided(name, detail) {
    for (const fn of providers[name] || []) { try { if (fn(detail) === true) return true; } catch (err) { console.error('[hx] provider ' + name, err); } }
    return false;
  }
  function togglePanel() {
    if (state.tab === 'session') return HX.toggle('right');
    if (callProvided('bot-settings', { toggle: true, from: 'keyboard' })) return;
    if (HX.bots && typeof HX.bots.toggleSettings === 'function') return HX.bots.toggleSettings();
    const sheet = panelRoot();
    if (sheet) { const x = sheet.querySelector('[aria-label^="Close"], [data-close]'); if (x) x.click(); }
    else if (HX.bots && typeof HX.bots.settings === 'function') HX.bots.settings(selection.bots || null);
  }
  const dockMode = () => { const r = $('#hx-dock [data-mode]', app); return r ? r.dataset.mode : null; };
  function toggleDockExpand() {
    if (state.dock !== 'on') setState({ dock: 'on' });
    if (window.hxDock && typeof window.hxDock.setMode === 'function') window.hxDock.setMode(dockMode() === 'expanded' ? 'normal' : 'expanded');
    else HX.emit('hx:dock-expand', { toggle: true, from: 'keyboard' });
  }
  const THEME_DARK = 'hx.v6.lastDark';
  function toggleLightDark() {
    const T = window.HX_THEME; if (!T) return;
    if (T.scheme() === 'light') {
      let back = null; try { back = localStorage.getItem(THEME_DARK); } catch (e) { /* storage blocked */ }
      if (back) { try { T.importJSON(back); } catch (e) { T.preset('catalog'); } } else T.preset('catalog');
    } else {
      try { localStorage.setItem(THEME_DARK, T.exportJSON()); } catch (e) { /* storage blocked */ }
      T.preset('bone');
    }
    toast(T.scheme() === 'light' ? 'Light theme' : 'Dark theme');
  }
  const typingIn = (n) => !!n && (n.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]') || !!n.closest('[contenteditable="true"]'));
  const layerOpen = () => !el.palette.hidden || el.settings.open || ($('#hx-keys-sheet', app) || {}).open || !!HX.ui.popover.current;

  function onKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const other = isMac ? e.ctrlKey : e.metaKey;
    const code = e.code || '', k = (e.key || '').toLowerCase();
    const typing = typingIn(document.activeElement);
    if (leader && leaderKey(e)) return;

    if (e.key === 'Escape') {
      if (!el.palette.hidden) { e.preventDefault(); closePalette(); return; }
      if (layerOpen()) return; // native dialogs close themselves
      const L = HX.layout || {};
      if (state.right === 'open' && L.rightMode === 'overlay') { e.preventDefault(); setState({ right: 'closed' }); return; }
      if (state.left === 'open' && L.leftMode === 'overlay') { e.preventDefault(); setState({ left: prefs.collapse }); return; }
      const r = regionOf(document.activeElement);
      if (r === 'composer' || r === 'panel') { e.preventDefault(); focusRegion('messages', { fresh: true }); }
      return;
    }
    if (e.key === 'F6' && !mod && !e.altKey) { e.preventDefault(); cycleRegion(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'F8' && !mod && !e.altKey) { e.preventDefault(); nextAttention(e.shiftKey ? -1 : 1); return; }

    if (mod && !other && !e.altKey) {
      const sh = e.shiftKey;
      const take = (fn) => { e.preventDefault(); fn(); };
      switch (code) {
        case 'KeyK': if (!sh) return take(() => (el.palette.hidden ? openPalette({}) : closePalette())); break;
        case 'KeyP': if (!sh) return take(() => openPalette({ scope: 'items' })); break;
        case 'KeyF': if (!sh && callProvided('find', { tab: state.tab, from: 'keyboard' })) e.preventDefault(); return;
        case 'KeyO': if (sh) return take(() => { closePalette(true); newThing(); }); break;
        case 'KeyB': return take(() => (sh ? setState({ left: state.left === 'closed' ? 'open' : 'closed' }) : HX.toggle('left')));
        case 'KeyI': if (!sh) return take(togglePanel); break;
        case 'KeyJ': return take(() => (sh ? toggleDockExpand() : HX.toggle('dock')));
        case 'Period': if (!sh && callProvided('stop', { tab: state.tab, from: 'keyboard' })) e.preventDefault(); return;
        case 'BracketLeft': if (!sh) return take(() => go(-1)); break;
        case 'BracketRight': if (!sh) return take(() => go(1)); break;
        case 'Comma': return take(() => openSettings(sh ? 'appearance' : 'general'));
        case 'KeyL': if (sh) return take(toggleLightDark); break;
        case 'Slash': return take(openKeys);
        case 'KeyG': if (!sh) return take(() => startLeader(true)); break;
      }
    }
    if (e.altKey && !mod && !other && !e.shiftKey && (code === 'Digit1' || code === 'Digit2')) {
      e.preventDefault(); closePalette(true); setState({ tab: code === 'Digit1' ? 'session' : 'bots' }); return;
    }
    // the navigation layer: single keys, only when not typing and no layer is open
    if (!typing && !mod && !other && !e.altKey && !layerOpen()) {
      if (e.key === '?') { e.preventDefault(); openKeys(); return; }
      if (k === 'g' && !e.shiftKey) { e.preventDefault(); startLeader(false); return; }
      if (e.key === '/' || (k === 'i' && !e.shiftKey)) { e.preventDefault(); focusRegion('composer'); return; }
    }
  }

  /* ───────────── stubs (a module that never registered) ───────────── */
  const STUBS = {
    'session-list'(root, ac) {
      const D = HX.data, H = HX.ui.html, by = {};
      for (const s of D.sessions || []) (by[s.project] = by[s.project] || []).push(s);
      const cur = selection.session || ((D.sessions || []).find(s => s.running) || {}).id;
      const blank = (D.conversation || []).some(m => m.blank);
      root.innerHTML = '<nav class="hx-stub-list" aria-label="Sessions">' + (Object.keys(by).length
        ? Object.entries(by).map(([p, list]) => H.group({ label: p, rows: list.map(s => H.row({ title: s.title, end: esc(s.when), value: s.id, current: s.id === cur,
            lead: H.leadFor({ attention: s.running && blank, running: s.running && !blank, current: s.id === cur }) })).join('') })).join('')
        : H.empty({ title: 'No sessions yet', text: 'Sessions you start appear here.' })) + '</nav>';
      HX.ui.hydrate(root);
      root.addEventListener('ui:select', (e) => {
        for (const x of root.querySelectorAll('.ui-row[aria-current]')) x.removeAttribute('aria-current');
        const id = e.detail.value;
        selection.session = id; HX.emit('hx:session-select', { id, from: 'list' }); pushHistory({ tab: 'session', sel: id }); updateTitle();
      }, { signal: ac.signal });
    },
    'bots-list'(root, ac) {
      const D = HX.data, H = HX.ui.html;
      root.innerHTML = '<nav class="hx-stub-list" aria-label="Bots"><ul class="ui-rows" data-ui="rows">' + (D.bots || []).map(b => {
        const st = HX.ui.botState(b);
        return H.row({ title: b.name, sub: b.role, end: st.key === 'idle' ? '' : esc(st.word), endTone: st.tone === 'attention' ? 'attention' : null, value: b.id, current: b.id === selection.bots,
          lead: H.leadFor({ attention: st.tone === 'attention', running: st.key === 'working', current: b.id === selection.bots }) });
      }).join('') + '</ul></nav>';
      HX.ui.hydrate(root);
      root.addEventListener('ui:select', (e) => {
        const id = e.detail.value;
        selection.bots = id; HX.emit('hx:bot-select', { id, from: 'list' }); pushHistory({ tab: 'bots', sel: id }); updateTitle();
      }, { signal: ac.signal });
    },
    session(root) {
      const D = HX.data, H = HX.ui.html, c = (D.conversation || []);
      const u = c.find(m => m.role === 'user'), a = c.find(m => m.role === 'assistant');
      const models = a ? String(a.model).split('→').map(x => x.trim()) : [];
      root.innerHTML = '<div class="hx-stub"><div class="hx-stub-col">' +
        (u ? H.entry({ kind: 'user', who: 'You', callno: ['14:01'], body: H.request(u.text) }) : '') +
        (a ? H.entry({ callno: models.map((m, i) => (i ? '→ ' : '') + m).concat([a.time, a.cost]),
          body: '<div class="ui-prose">' + (a.paragraphs || []).map(t => '<p>' + H.inline(t) + '</p>').join('') +
            '<ul>' + (a.bullets || []).map(t => '<li>' + H.inline(t) + '</li>').join('') + '</ul>' +
            (a.blank ? '<p>' + H.inline(a.blank.question) + ' ' + H.stamp('waiting for you') + '</p>' : '') + '</div>' }) : '') +
        '</div><div class="hx-stub-composer"></div></div>';
      root.querySelector('.hx-stub-composer').appendChild(HX.ui.composer({ value: D.composerDraft || '', spend: { spent: '$0.37', cap: '$0.60' }, label: 'Message (placeholder)' }));
    },
    bots(root, ac) {
      const H = HX.ui.html;
      const paint = (id) => {
        const b = (HX.data.bots || []).find(x => x.id === id);
        root.innerHTML = '<div class="hx-stub"><div class="hx-stub-empty">' + (b
          ? H.orb(b, { size: 56 }) + H.empty({ title: b.name, text: b.role })
          : H.empty({ mark: true, title: 'Pick a bot', text: 'Bots are teammates with a name and a job. Choose one from the list, or make a new one.', action: H.button({ label: 'New bot', variant: 'primary', class: 'hx-stub-new' }) })) + '</div></div>';
      };
      paint(selection.bots);
      HX.on('hx:bot-select', function onSel(d) { if (ac.signal.aborted) return HX.off('hx:bot-select', onSel); paint(d.id); });
      root.addEventListener('click', (e) => { if (e.target.closest('.hx-stub-new')) newThing('bots'); }, { signal: ac.signal });
    },
    'session-right'(root, ac) {
      const D = HX.data, ctx = D.context || { used: 0, total: 1 };
      const rows = [['Context', '76k / 200k'], ['Connectors', '2 on'], ['Output', '142 passed'], ['Environment', 'network off'], ['Tasks', '2 of 5'], ['Changes', '+96 −71'], ['Governance', '$0.37 of $0.60']];
      const paint = () => {
        if (state.right === 'open') {
          root.innerHTML = '<div class="hx-stub-panel"><h2 class="ui-set__head">Session details</h2><dl>' + rows.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl></div>';
        } else {
          const n = 8, on = Math.round(n * ctx.used / ctx.total);
          root.innerHTML = '<div class="hx-stub-rail" title="Context ' + Math.round(100 * ctx.used / ctx.total) + '% used">' + Array.from({ length: n }, (_, i) => '<i class="' + (n - i <= on ? 'on' : '') + '"></i>').join('') + '</div>';
        }
      };
      paint();
      HX.on('hx:state', function onS(d) { if (ac.signal.aborted) return HX.off('hx:state', onS); if (d.changed.includes('right')) paint(); });
    },
    dock(root, ac) {
      const H = HX.ui.html, bots = HX.data.bots || [];
      root.innerHTML = '<div class="ui-slab hx-stub-dock" role="toolbar" aria-label="Dock">' + bots.map(b => '<button type="button" class="hx-stub-orb" data-id="' + esc(b.id) + '" aria-label="' + esc(b.name) + '" data-tip="' + esc(b.name) + '" data-tip-pos="top">' + H.orb(b, { size: 36 }) + '</button>').join('') +
        H.iconButton({ icon: 'plus', label: 'New bot', tipPos: 'top' }) + '</div>';
      root.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (!b.dataset.id) return newThing('bots');
        setState({ tab: 'bots' }); selection.bots = b.dataset.id; HX.emit('hx:bot-select', { id: b.dataset.id, from: 'dock' }); updateTitle();
      }, { signal: ac.signal });
    }
  };

  /* ───────────── mounting ───────────── */
  function slotFor(name) {
    switch (name) {
      case 'session-list': return $('#hx-list-session');
      case 'bots-list': return $('#hx-list-bots');
      case 'session': return $('#hx-view-session');
      case 'bots': return $('#hx-view-bots');
      case 'session-right': return $('#hx-right');
      case 'dock': return $('#hx-dock');
      default: return null;
    }
  }
  function mountModule(name) {
    const mod = registry.get(name);
    const slot = slotFor(name);
    const prev = mounted.get(name);
    if (prev && prev.stub) { prev.ac.abort(); slot && (slot.innerHTML = ''); }
    if (!mod || typeof mod.mount !== 'function') return;
    try {
      mod.mount(slot, HX);
      mounted.set(name, { slot, stub: false });
      if (slot) slot.dataset.module = name;
    } catch (err) {
      console.error('[hx] module "' + name + '" failed to mount; showing its placeholder', err);
      mountStub(name);
    }
  }
  function mountStub(name) {
    const slot = slotFor(name), fn = STUBS[name];
    if (!slot || !fn) return;
    const ac = new AbortController();
    slot.innerHTML = '';
    slot.dataset.module = name + ' (placeholder)';
    try { fn(slot, ac); } catch (err) { console.error('[hx] stub ' + name, err); }
    mounted.set(name, { slot, stub: true, ac });
  }

  /* ───────────── boot ───────────── */
  function boot() {
    if (booted) return;
    app = $('#hx-app');
    if (!app) { console.error('[hx] #hx-app not found'); return; }
    /* drawn corners (DESIGN-SYSTEM.md §8): the shell's surfaces take the library's continuous corner */
    if (HX.ui && HX.ui.squircle) {
      HX.ui.squircle.auto('.hx-cmd, .hx-me, .hx-dtab, .hx-pal-row');
      HX.ui.squircle.auto('.hx-dialog__card, .hx-palette__box, .hx-goto, .hxt-preset', { mode: 'surface' });
    }
    el = {
      btnLeft: $('#hx-btn-left'), btnBack: $('#hx-btn-back'), btnFwd: $('#hx-btn-fwd'), btnSearch: $('#hx-btn-search'),
      whereProject: $('#hx-where-project'), whereTitle: $('#hx-where-title'), btnRight: $('#hx-btn-right'),
      btnMin: $('#hx-btn-min'), btnMax: $('#hx-btn-max'), btnClose: $('#hx-btn-close'),
      side: $('#hx-side'), btnNew: $('#hx-btn-new'),
      btnAccount: $('#hx-btn-account'), btnSettings: $('#hx-btn-settings'),
      rightShell: $('#hx-right-shell'), rightSlot: $('#hx-right'),
      scrim: $('#hx-scrim'),
      palette: $('#hx-palette'), palInput: $('#hx-palette-input'), palList: $('#hx-palette-list'),
      settings: $('#hx-settings')
    };
    if (!HX.ui) { console.error('[hx] components/components.js must load before the shell boots'); return; }

    // icons: one set, from the library
    $$('[data-icon]', app).forEach(n => { n.outerHTML = HX.ui.icon(n.dataset.icon); });

    // the tabs: a pill in the sidebar and the same choice, vertical, in the rail
    const opt = (v, extra) => Object.assign({ value: v, dot: false, tip: v === 'session' ? 'Sessions' : 'Bots', keys: v === 'session' ? 'alt+1' : 'alt+2' }, extra);
    seg.tabs = HX.ui.segmented({ label: 'View', fill: true, value: state.tab, class: 'hx-seg', controls: { session: 'hx-list-session', bots: 'hx-list-bots' },
      options: [opt('session', { label: 'Session' }), opt('bots', { label: 'Bots' })] });
    seg.rail = HX.ui.segmented({ label: 'View', vertical: true, value: state.tab, class: 'hx-rail__seg', controls: { session: 'hx-list-session', bots: 'hx-list-bots' },
      options: [opt('session', { icon: 'session', ariaLabel: 'Session' }), opt('bots', { icon: 'bots', ariaLabel: 'Bots' })] });
    seg.tabs.id = 'hx-seg';
    for (const b of $$('[role="tab"]', seg.tabs)) b.id = 'hx-tab-' + b.dataset.value;
    for (const b of $$('[role="tab"]', seg.rail)) b.dataset.tipPos = 'right';
    $('#hx-seg').replaceWith(seg.tabs);
    $('#hx-rail-seg').replaceWith(seg.rail);
    seg.collapse = HX.ui.segmented({ mode: 'radio', size: 's', label: 'When the sidebar collapses', value: prefs.collapse,
      options: [{ value: 'rail', label: 'Rail' }, { value: 'closed', label: 'Hide' }] });
    seg.collapse.setAttribute('aria-labelledby', 'hx-set-collapse-l'); seg.collapse.removeAttribute('aria-label');
    $('#hx-set-collapse').replaceWith(seg.collapse);
    HX.ui.hydrate($('#hx-settings'));

    // user
    const U = HX.data.user || { name: 'you', initials: 'y' };
    $$('.hx-avatar', app).forEach(a => { a.textContent = (U.initials || U.name || '?').slice(0, 1); });
    $('#hx-account-name').textContent = U.name;
    el.btnAccount.setAttribute('aria-label', 'Account, ' + U.name);
    el.btnAccount.dataset.tip = U.name;

    // keyboard chips in static markup
    $$('kbd[data-kbd]', app).forEach(k => { k.outerHTML = kbdHTML(k.dataset.kbd); });
    el.btnNew.setAttribute('aria-keyshortcuts', ariaKeys('mod+shift+O'));
    el.btnSearch.setAttribute('aria-keyshortcuts', ariaKeys('mod+K'));
    $('#hx-keys').innerHTML = keysTableHTML('');
    // shortcuts for assistive tech
    for (const n of $$('[data-kbd]', app)) n.setAttribute('aria-keyshortcuts', ariaKeys(n.dataset.kbd));

    // attention seeded from data; modules refine it with hx:attention
    for (const b of HX.data.bots || []) if (b.attention) attention.set('seed:' + b.id, { count: 1, tab: 'bots' });
    const blank = (HX.data.conversation || []).some(m => m.blank);
    if (blank) attention.set('seed:blank', { count: 1, tab: 'session' });

    // test hooks: ?preset=graphite or ?theme=light pick a preset at load
    const qp = query.get('preset') || (query.get('theme') === 'light' ? 'bone' : null);
    if (qp && window.HX_THEME && window.HX_THEME.presets[qp]) { window.HX_THEME.preset(qp); state.theme = window.HX_THEME.scheme(); }

    applyState(null);
    computeLayout();
    pushHistory({ tab: state.tab, sel: null });
    syncFullscreenIcon();

    wire();

    booted = true;
    mounting = true;
    for (const name of ['session-list', 'bots-list', 'session', 'bots', 'session-right', 'dock']) {
      if (registry.has(name)) mountModule(name); else mountStub(name);
    }
    for (const name of registry.keys()) if (!mounted.has(name) && !slotFor(name)) {
      try { registry.get(name).mount(null, HX); mounted.set(name, { slot: null, stub: false }); } catch (err) { console.error('[hx] module "' + name + '" failed', err); }
    }
    mounting = false;

    HX.emit('hx:state', { state, changed: Object.keys(defaults()), initial: true });
    HX.emit('hx:tab', { tab: state.tab, initial: true });
    layoutNow(false);
    requestAnimationFrame(() => requestAnimationFrame(() => { app.classList.remove('is-booting'); HX.emit('hx:ready', { state }); }));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => queueLayout(false));
  }

  function wire() {
    // chrome
    el.btnLeft.addEventListener('click', () => HX.toggle('left'));
    el.btnBack.addEventListener('click', () => go(-1));
    el.btnFwd.addEventListener('click', () => go(1));
    el.btnSearch.addEventListener('click', () => openPalette({}));
    el.btnRight.addEventListener('click', () => HX.toggle('right'));
    el.btnMin.addEventListener('click', () => toast('Minimize works in the desktop app'));
    el.btnClose.addEventListener('click', () => toast('Close works in the desktop app'));
    el.btnMax.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', syncFullscreenIcon);

    // tabs (both the pill and the rail): the library moves the thumb and the focus, the shell owns the state
    for (const sg of [seg.tabs, seg.rail]) sg.addEventListener('ui:change', (e) => setState({ tab: e.detail.value }));
    el.btnNew.addEventListener('click', () => newThing());
    $('.hx-rail__new', app).addEventListener('click', () => newThing());

    // account (the library toggles the menu when its anchor is pressed again)
    el.btnAccount.addEventListener('click', openMenu);
    el.btnSettings.addEventListener('click', () => openSettings());

    // settings
    $('#hx-set-dock').addEventListener('change', (e) => setState({ dock: e.target.checked ? 'on' : 'off' }));
    $('#hx-settings-close').addEventListener('click', () => el.settings.close());
    for (const t of $$('.hx-dtab', el.settings)) t.addEventListener('click', () => showSettingsSection(t.dataset.section));
    $('.hx-dtabs', el.settings).addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const tabs = $$('.hx-dtab', el.settings), i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      showSettingsSection(n.dataset.section); n.focus();
    });
    HX.on('hx:theme', (d) => {
      const scheme = d && d.scheme === 'light' ? 'light' : 'dark';
      if (state.theme !== scheme) { state.theme = scheme; save(); HX.emit('hx:state', { state, changed: ['theme'] }); }
      queueLayout(false);   // corners and density change sizes
    });
    seg.collapse.addEventListener('ui:change', (e) => {
      prefs.collapse = e.detail.value; save();
      if (state.left !== 'open') setState({ left: e.detail.value });
    });
    el.settings.addEventListener('click', (e) => { if (e.target === el.settings) el.settings.close(); });

    // palette
    el.palInput.addEventListener('input', () => { pal.active = 0; renderPalette(); });
    el.palInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runPal(pal.active); }
      else if (e.key === 'Tab') { e.preventDefault(); movePal(e.shiftKey ? -1 : 1); }
    });
    el.palList.addEventListener('pointermove', (e) => {
      const r = e.target.closest('.hx-pal-row'); if (!r || +r.dataset.i === pal.active) return;
      pal.active = +r.dataset.i;
      for (const x of $$('.hx-pal-row', el.palList)) x.setAttribute('aria-selected', String(x === r));
      el.palInput.setAttribute('aria-activedescendant', r.id);
    });
    el.palList.addEventListener('click', (e) => { const r = e.target.closest('.hx-pal-row'); if (r) runPal(+r.dataset.i); });
    el.palette.addEventListener('pointerdown', (e) => { if (e.target === el.palette) { e.preventDefault(); closePalette(); } });

    // scrim closes overlay drawers
    el.scrim.addEventListener('click', () => {
      if (state.right === 'open' && (HX.layout || {}).rightMode === 'overlay') setState({ right: 'closed' });
      if (state.left === 'open' && (HX.layout || {}).leftMode === 'overlay') setState({ left: prefs.collapse });
    });

    app.addEventListener('focusin', (e) => { const r = regionOf(e.target); if (r) lastInRegion[r] = e.target; });
    document.addEventListener('focusout', (e) => { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-hx-region-focus')) { e.target.removeAttribute('data-hx-region-focus'); e.target.removeAttribute('tabindex'); } });
    const ks = $('#hx-keys-sheet', app);
    $('#hx-keys-close', ks).addEventListener('click', () => ks.close());
    $('#hx-keys-filter', ks).addEventListener('input', (e) => { $('#hx-keys-body', ks).innerHTML = keysTableHTML(e.target.value); });
    ks.addEventListener('click', (e) => { if (e.target === ks) ks.close(); });
    // close on Esc explicitly: a module's window-level key handler must never be able to keep a dialog open
    for (const d of [ks, el.settings]) d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d.open) { e.preventDefault(); e.stopPropagation(); d.close(); } });
    // Tab cycles inside a dialog (KEYMAP §10): a modal dialog would otherwise hand focus to the browser after its last control
    const tabStops = (d) => $$(FOCUSABLE, d).filter(n => visible(n) && n.tabIndex >= 0 && !(n.type === 'radio' && !n.checked && $$('input[type="radio"][name="' + n.name + '"]', d).some(r => r.checked)));
    for (const d of [ks, el.settings]) d.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !d.open || HX.ui.popover.current) return;
      const f = tabStops(d); if (!f.length) return;
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || (!f.includes(a) && !d.contains(a)))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    });

    // keyboard, resize
    window.addEventListener('keydown', onKey);
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      if (app.clientWidth === lastW && app.clientHeight === lastH) return;
      const W = app.clientWidth, wasW = lastW;
      lastW = W; lastH = app.clientHeight;
      /* an open sidebar the person chose does not turn into an overlay by itself when the window narrows past 900px:
         it goes back to following the window */
      if (!leftAuto && state.left === 'open' && W > 0 && W < 900 && wasW >= 900) leftAuto = true;
      if (leftAuto && W > 0 && state.left !== autoLeft(W)) setState({ left: autoLeft(W), _auto: true });
      app.classList.add('is-resizing');
      queueLayout(false);
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => app.classList.remove('is-resizing'), 160);
    });
    ro.observe(app);
    window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t)) setState({ tab: t }); });

    // module events the shell listens to
    HX.on('hx:bot-select', (d) => {
      if (!d || !d.id) return;
      selection.bots = d.id;
      if (d.from !== 'history') { if (state.tab !== 'bots') setState({ tab: 'bots' }); pushHistory({ tab: 'bots', sel: d.id }); }
      updateTitle();
    });
    HX.on('hx:session-select', (d) => {
      if (!d || !d.id) return;
      selection.session = d.id;
      if (d.from !== 'history') { if (state.tab !== 'session') setState({ tab: 'session' }); pushHistory({ tab: 'session', sel: d.id }); }
      updateTitle();
    });
    HX.on('hx:title', (d) => { if (!d) return; titleOverride[TABS.includes(d.tab) ? d.tab : state.tab] = d.title || d.text || null; updateTitle(); });
    HX.on('hx:open-panel', (d) => { if (d && d.from !== 'shell' && state.right !== 'open') setState({ right: 'open' }); });
    HX.on('hx:attention', (d) => {
      if (!d) return;
      const src = d.source || 'unknown', n = Math.max(0, +d.count || 0);
      // an owner reporting zero is kept (zero is an answer), so stale seeds never come back
      if (n || src === 'session' || src === 'bots') attention.set(src, { count: n, tab: tabForSource(src, d.tab), ids: Array.isArray(d.ids) ? d.ids.slice() : null });
      else attention.delete(src);
      updateAttentionDots();
    });
    HX.on('hx:view-inset', (d) => {
      if (!d) return;
      const t = TABS.includes(d.tab) ? d.tab : state.tab;
      insets[t] = { left: +d.left || 0, right: +d.right || 0 };
      if (t === state.tab) queueLayout(true);
    });
    HX.on('hx:toast', (d) => d && toast(d.text || d.message || String(d)));
    // the dock may switch itself off from its own controls; the shell's state follows
    // the dock reports {mode, page, width, height}; its height is the room the composer keeps above it, so an
    // expanded dock lifts the composer instead of growing over it
    HX.on('hx:dock', (d) => {
      if (!d) return;
      if (d.mode === 'off') { if (state.dock !== 'off') setState({ dock: 'off' }); return; }
      if (typeof d.height === 'number' && Math.abs((dockHeight || 0) - d.height) > 0.5) { dockHeight = d.height; queueLayout(true); }
    });
  }

  /* Keep the CSS width of the sidebar list etc. honest while the window resizes. */
  const style = document.createElement('style');
  style.textContent = '.hx.is-resizing, .hx.is-resizing * { transition: none !important; }';
  document.head.appendChild(style);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})();
