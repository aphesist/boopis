/* hypotaxis v6 · shared component library (owner: design-system agent)
   window.HX.ui: one canonical version of every piece more than one module draws.
   The system is design-system/DESIGN-SYSTEM.md; what each module deletes and calls instead is MIGRATION.md.

   Two ways in, one markup:
     HX.ui.html.<name>(opts) -> string     for modules that build innerHTML (cards, dock)
     HX.ui.<name>(opts)      -> HTMLElement, already wired (session, bots, shell)
     HX.ui.hydrate(root)                   wires every [data-ui] element under root once (string-built markup)
   Behaviours: HX.ui.menu.open(), HX.ui.popover.open(), HX.ui.tooltip (delegated, [data-tip]),
   HX.ui.layer (the same layer for a node with its own surface), HX.ui.toast(), HX.ui.hold (hold to approve),
   HX.ui.composer(), HX.ui.orb(), HX.ui.botState(), HX.ui.icon(), HX.ui.announce().
   Events bubble from the element and are cancelable where an action follows:
     'ui:change' {value}  segmented, switch, chip, option group
     'ui:commit'          hold to approve finished
     'ui:select' {value, item}  menu item, row
     'ui:send' {text}     composer;  'ui:stop' composer while running;  'ui:decision' {kind, text, el} feedforward mark
   Load order: tokens.css, components.css (before module CSS); components.js after shell.js (which defines HX)
   and before every module script. vendor/orb-avatar.min.js
   before the first HX.ui.orb() call. No colour, family or size lives here: everything visual is in components.css. */
(function () {
  'use strict';

  /* ───────────── HX, minimal when the shell is absent (same contract as shell.js) ───────────── */
  if (!window.HX) {
    const bus = new EventTarget(), wraps = new Map();
    window.HX = {
      state: { tab: 'session', left: 'open', right: 'closed', dock: 'on', theme: 'dark' },
      on(t, fn) { const w = (e) => fn(e.detail, e); wraps.set(t + '\u0000' + fn, w); bus.addEventListener(t, w); },
      off(t, fn) { const k = t + '\u0000' + fn, w = wraps.get(k); if (w) { bus.removeEventListener(t, w); wraps.delete(k); } },
      emit(t, d) { bus.dispatchEvent(new CustomEvent(t, { detail: d })); },
      register() {},
      setState(p) { Object.assign(this.state, p); this.emit('hx:state', { state: this.state, changed: p }); },
      cards: null, data: window.HX_DATA, stub: true
    };
  }
  const HX = window.HX;
  if (HX.ui && HX.ui.version) return;
  const ui = HX.ui = {};
  ui.version = '1.0.0';

  /* ───────────── helpers ───────────── */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const attrs = (o) => Object.entries(o || {}).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? ' ' + k : ' ' + k + '="' + esc(v) + '"').join('');
  const cx = (...a) => a.filter(Boolean).join(' ');
  const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => RMQ.matches;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  let uid = 0;
  const nid = (p) => (p || 'ui') + (++uid).toString(36);
  function frag(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function fire(el, type, detail, cancelable) { return el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, cancelable: !!cancelable })); }
  const tokenMs = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); const n = parseFloat(v); return isNaN(n) ? fb : (/ms$/.test(v) ? n : n * 1000); };
  ui.esc = esc;

  /* one polite live region for the whole app */
  let live = null;
  ui.announce = function (text) {
    if (!live || !live.isConnected) { live = document.createElement('div'); live.className = 'ui-sr'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); document.body.appendChild(live); }
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 30);
  };

  /* ───────────── icons: any grid, one rendered stroke (components.css .ui-icon) ─────────────
     [viewBox, inner]. Chrome glyphs on the shell's 20 grid; content glyphs on the session's 16 grid. */
  const I20 = '0 0 20 20', I16 = '0 0 16 16';
  const ICONS = {
    'sidebar-left': [I20, '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path class="is-fill is-fill-on" d="M3.5 6.25a1.75 1.75 0 0 1 1.75-1.75H7.5v11H5.25A1.75 1.75 0 0 1 3.5 13.75z"/><path d="M7.75 4v12"/>'],
    'sidebar-right': [I20, '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path class="is-fill is-fill-on" d="M12.5 4.5h2.25a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75H12.5z"/><path d="M12.25 4v12"/>'],
    back: [I20, '<path d="M12 5 7 10l5 5"/>'],
    forward: [I20, '<path d="m8 5 5 5-5 5"/>'],
    search: [I20, '<circle cx="8.75" cy="8.75" r="5"/><path d="m12.5 12.5 4 4"/>'],
    minimize: [I20, '<path d="M5 10.5h10"/>'],
    maximize: [I20, '<rect x="5.25" y="5.25" width="9.5" height="9.5" rx="1.5"/>'],
    restore: [I20, '<rect x="4.75" y="7.25" width="8" height="8" rx="1.5"/><path d="M7.25 4.75h6.5a1.5 1.5 0 0 1 1.5 1.5v6.5"/>'],
    close: [I20, '<path d="m5.5 5.5 9 9m0-9-9 9"/>'],
    plus: [I20, '<path d="M10 4.5v11M4.5 10h11"/>'],
    gear: ['0 0 24 24', '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'],
    session: [I20, '<path d="m4.5 6 4 4-4 4M10.5 14.5h5"/>'],
    bots: [I20, '<circle cx="10" cy="10" r="6.75"/><path d="M8 8.6v2.4M12 8.6v2.4"/>'],
    dock: [I20, '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path d="M6.5 16.25v-2a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2"/>'],
    send: [I16, '<path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2"/>'],
    mic: [I16, '<rect x="6" y="2.2" width="4" height="7.4" rx="2"/><path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2"/>'],
    stop: [I16, '<rect class="is-fill" x="4.5" y="4.5" width="7" height="7" rx="1.2"/>'],
    ladder: [I16, '<path d="M4 2.5v11M12 2.5v11M4 5.5h8M4 8.5h8M4 11.5h8"/>'],
    spark: [I16, '<path d="M8.8 1.8 3.6 9.2h4.1l-.6 5 5.2-7.4H8.2z"/>'],
    chevron: [I16, '<path d="m6 3.5 4.5 4.5L6 12.5"/>'],
    'chevron-down': [I16, '<path d="m4 6 4 4 4-4"/>'],
    fork: [I16, '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="11.5" cy="3.5" r="1.5"/><circle cx="8" cy="12.5" r="1.5"/><path d="M4.5 5v1.2a1.8 1.8 0 0 0 1.8 1.8h3.4a1.8 1.8 0 0 0 1.8-1.8V5M8 8v3"/>'],
    unarchive: [I16, '<rect x="2" y="2.8" width="12" height="3.2" rx=".8"/><path d="M3.2 6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V6M8 12V8.2M6.4 9.6 8 8l1.6 1.6"/>'],
    slash: [I16, '<path d="M10.5 2.5 5.5 13.5"/>'],
    copy: [I16, '<rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.2V3a1 1 0 0 0-1-1H3.4a1 1 0 0 0-1 1v6.1a1 1 0 0 0 1 1h.4"/>'],
    check: [I16, '<path d="m3.2 8.4 3 3 6.6-6.8"/>'],
    play: [I16, '<path d="M5 3.4v9.2L12.4 8z"/>'],
    pen: [I16, '<path d="M10.6 2.6a1.5 1.5 0 0 1 2.1 2.1L5.5 11.9l-2.8.7.7-2.8z"/>'],
    archive: [I16, '<rect x="2" y="2.8" width="12" height="3.2" rx=".8"/><path d="M3.2 6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V6M6.5 8.6h3"/>'],
    file: [I16, '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>'],
    folder: [I16, '<path d="M1.8 4.2a1 1 0 0 1 1-1h3.3l1.4 1.6h5.7a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>'],
    at: [I16, '<circle cx="8" cy="8" r="2.6"/><path d="M10.6 8v1.1a1.9 1.9 0 0 0 3.6.6A6.2 6.2 0 1 0 11 13.4"/>'],
    clock: [I16, '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>'],
    sliders: [I16, '<path d="M2.5 5h6M11.5 5h2M2.5 11h1.5M7 11h6.5"/><circle cx="10" cy="5" r="1.6"/><circle cx="5.5" cy="11" r="1.6"/>'],
    dice: [I16, '<rect x="2.5" y="2.5" width="11" height="11" rx="2.6"/><circle class="is-fill" cx="5.6" cy="5.6" r="1.05"/><circle class="is-fill" cx="8" cy="8" r="1.05"/><circle class="is-fill" cx="10.4" cy="10.4" r="1.05"/>'],
    more: [I16, '<circle class="is-fill" cx="3.5" cy="8" r="1.1"/><circle class="is-fill" cx="8" cy="8" r="1.1"/><circle class="is-fill" cx="12.5" cy="8" r="1.1"/>'],
    phi: ['139.19 40.89 724.12 918.22', null]
  };
  /* the φ mark: the owner's closed form (brand/phi-closed.svg), filled, never stroked, never red */
  const PHI_D = 'M480.7 277.7 522.6 219.3 533.7 209.4 545.1 204.2 574.2 198.3 600.4 199 642 203.7 677.5 212.8 704.7 226.3 724.9 245 801.8 366.4 820.4 405 827.9 441.4 829.3 464.1 827.7 489.6 815.1 551.7 793.2 627.9 774.8 659.8 711.9 742.9 688.2 763.9 668.1 776.7 651.2 784.3 633.3 789.3 604.4 792.8 550 804.2 512.2 807.5 476.7 806.1 423.1 799.7 382.6 788.8 353.5 776.2 328 761.7 298.8 738.2 271.9 711.8 250.4 687.2 226.2 653.6 212.1 632.4 193.8 596.6 184.8 537.2 173.9 490.6 173.2 469.5 178.8 440.2 222.2 349.8 246.6 306 274.7 266.9 307 234.7 329.2 218.5 353.4 205.6 379.7 197.2 409.8 192.5 451.9 191.6 591.7 198.5 651 205.4 671.7 210.8 694.2 220.1 712 231.8 724.9 245 753.8 291.9 776.1 335.8 784.6 366.2 786.4 380.5 784.6 390.2 780.3 392.2 771.4 390.8 737.4 370.9 706.4 357.1 694.8 346.9 682.2 325.1 668 310.4 649.2 298 628.3 289.2 587.1 279.6 499.2 269.9 438.1 258.8 414.8 256.7 394.2 258.3 379.9 263 365.6 273.3 326.5 314.5 312.3 340.3 301.7 375.2 289.3 444.8 286.2 475.3 286.2 505.3 291.5 538.4 299.8 562.3 312.3 614.7 320.4 634.7 349 677.6 387.9 724.1 407.8 741 424.9 750.6 453.5 761.6 475.2 764.9 510 766.2 544.5 762.5 575.5 753.4 606 749.3 626.6 741.7 653.1 726.1 678.4 701.8 694.4 681.2 705.2 662.6 715.1 636.7 729.7 551.6 734.3 476 733.8 459.9 728 430 701.1 372.2 688.2 334.9 677.8 319.8 660.8 305 643.1 295 617.6 286 559.2 275.6 532 265 523.1 267.1 505.9 278.5ZM481.9 925.1 477.1 917.9 470.8 878.9 465 804.9 467.5 732.9 465.5 674.9 470 598.9 469.9 588.9 466.2 579.9 469.5 523.9 465.5 445.9 470 372.9 464 280.9 464 237.9 468.6 171.9 472.4 158.9 487 121.9 511.3 83.9 520.8 74.9 526.4 82.9 534 121.9 539.1 164.9 534.5 207.9 534.5 231.9 539.5 311.9 532 391.9 531.5 418.9 533.5 496.9 539.9 580.9 536 589.9 534 624.9 538.3 633.9 532 679.9 537.5 770.9 532.7 819.9 520.7 860.9 509.2 885.9 490.8 915.9Z';
  ui.icons = Object.keys(ICONS);
  ui.icon = function (name, o) {
    o = o || {};
    if (name === 'phi') return '<svg class="' + cx('ui-mark', o.class) + '" viewBox="' + ICONS.phi[0] + '" aria-hidden="true" focusable="false"><path fill="currentColor" d="' + PHI_D + '"/></svg>';
    const ic = ICONS[name];
    if (!ic) return '';
    return '<svg class="' + cx('ui-icon', o.size && 'ui-icon--' + o.size, o.class) + '" viewBox="' + ic[0] + '" aria-hidden="true" focusable="false">' + ic[1] + '</svg>';
  };

  /* keys: 'mod+shift+K' -> two or three chips; mod is ⌘ on a Mac and ctrl elsewhere */
  function keyLabel(k) {
    const m = { mod: isMac ? '⌘' : 'ctrl', shift: isMac ? '⇧' : 'shift', alt: isMac ? '⌥' : 'alt', enter: 'enter', esc: 'esc', up: '↑', down: '↓', left: '←', right: '→', comma: ',', period: '.', space: 'space' };
    return m[k.toLowerCase()] || (k.length === 1 ? k.toUpperCase() : k);
  }
  const ariaKeys = (keys) => String(keys).split('+').map((k) => ({ mod: isMac ? 'Meta' : 'Control', shift: 'Shift', alt: 'Alt', esc: 'Escape', enter: 'Enter' }[k.toLowerCase()] || k)).join('+');

  /* ───────────── bot states: one map for every module (list, dock, header, cards, tooltips) ─────────────
     state -> the orb2 reaction, the one word shown beside the name, and its tone. Idle shows no word in lists. */
  const STATES = {
    idle:      { reaction: 'idle',      word: 'idle' },
    listening: { reaction: 'listening', word: 'listening', tone: 'busy' },
    thinking:  { reaction: 'thinking',  word: 'thinking',  tone: 'busy' },
    working:   { reaction: 'working',   word: 'working',   tone: 'busy' },
    compute:   { reaction: 'compute',   word: 'running',   tone: 'busy' },
    speaking:  { reaction: 'speaking',  word: 'replying',  tone: 'busy' },
    needs:     { reaction: 'needs',     word: 'needs you', tone: 'attention' },
    done:      { reaction: 'done',      word: 'done' },
    happy:     { reaction: 'happy',     word: 'done' },
    sleeping:  { reaction: 'sleeping',  word: 'asleep' },
    paused:    { reaction: 'sleeping',  word: 'paused' },
    error:     { reaction: 'error',     word: 'failed',    tone: 'attention' }
  };
  ui.states = STATES;
  ui.botState = function (bot) {
    const b = typeof bot === 'string' ? { state: bot } : (bot || {});
    const key = b.paused ? 'paused' : (b.attention && b.state !== 'error' ? 'needs' : (STATES[b.state] ? b.state : 'idle'));
    const s = STATES[key];
    /* attention outranks work: a bot that needs you shows the needs face and the red word, whatever it was doing */
    return { key, reaction: s.reaction, word: s.word, tone: s.tone || 'none', attention: s.tone === 'attention', busy: s.tone === 'busy' };
  };
  ui.botLabel = (b) => { const s = ui.botState(b); return b.name + (b.role ? ', ' + b.role : '') + (s.key === 'idle' ? '' : ', ' + s.word); };

  /* ═════════════ string templates (HX.ui.html.*) ═════════════ */
  const html = ui.html = {};

  html.icon = ui.icon;
  html.keys = (keys) => (keys ? '<span class="ui-keys" aria-hidden="true">' + String(keys).split('+').map((k) => '<kbd class="ui-kbd">' + esc(keyLabel(k)) + '</kbd>').join('') + '</span>' : '');
  html.kbd = html.keys;
  html.code = (text) => '<code class="ui-code">' + esc(text) + '</code>';
  /* inline `code` in a data string -> chips; everything else escaped */
  html.inline = (text) => esc(text).replace(/`([^`]+)`/g, '<code class="ui-code">$1</code>');
  html.stamp = (text, o) => '<span class="ui-stamp"' + attrs((o || {}).attrs) + '>' + esc(text) + '</span>';
  html.dot = (kind, o) => { o = o || {}; return '<span class="' + cx('ui-dot', kind && 'ui-dot--' + kind, o.size === 's' && 'ui-dot--s') + '"' + (o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : ' aria-hidden="true"') + (o.show ? ' data-show' : '') + '></span>'; };
  html.capacity = (spent, cap, o) => '<span class="ui-capacity"' + attrs({ 'aria-label': (o && o.label) || (spent + ' of ' + cap + ' spent') }) + '><b>' + esc(spent) + '</b> of ' + esc(cap) + '</span>';

  /* button: {label, variant: 'secondary'|'primary'|'ghost', size: 'm'|'s', icon, keys, disabled, tip, attrs} */
  html.button = function (o) {
    o = o || {};
    return '<button type="' + (o.type || 'button') + '" class="' + cx('ui-btn', o.variant && o.variant !== 'secondary' && 'ui-btn--' + o.variant, o.size === 's' && 'ui-btn--s', o.class) + '"' +
      attrs(Object.assign({ disabled: o.disabled, 'data-action': o.action, 'data-tip': o.tip, 'data-kbd': o.tip && o.keys, 'aria-keyshortcuts': o.keys && ariaKeys(o.keys) }, o.attrs)) + '>' +
      (o.icon ? ui.icon(o.icon) : '') + '<span>' + esc(o.label) + '</span>' + (o.keys && o.showKeys ? '<span class="ui-btn__kbd">' + html.keys(o.keys) + '</span>' : '') + '</button>';
  };
  /* icon button: {icon, label (required), keys, pressed, expanded, haspopup, size: 's', window, tipPos, attrs} */
  html.iconButton = function (o) {
    return '<button type="button" class="' + cx('ui-ib', o.window && 'ui-ib--window', o.size === 's' && 'ui-ib--s', o.class) + '"' +
      attrs(Object.assign({ 'aria-label': o.label, 'data-tip': o.tip === false ? null : (o.tip || o.label), 'data-kbd': o.keys, 'data-tip-pos': o.tipPos, 'aria-keyshortcuts': o.keys && ariaKeys(o.keys),
        'aria-pressed': o.pressed == null ? null : String(!!o.pressed), 'aria-expanded': o.expanded == null ? null : String(!!o.expanded), 'aria-haspopup': o.haspopup, disabled: o.disabled, 'data-action': o.action }, o.attrs)) + '>' + ui.icon(o.icon) + '</button>';
  };
  html.send = (o) => { o = o || {}; const run = !!o.running; return '<button type="button" class="ui-send" data-ui="send"' + attrs({ 'aria-label': run ? 'Stop' : 'Send', 'data-tip': run ? 'Stop' : 'Send', 'data-kbd': run ? 'mod+period' : 'enter', 'aria-keyshortcuts': run ? ariaKeys('mod+.') : 'Enter', disabled: o.disabled && !run }) + '>' + ui.icon(run ? 'stop' : 'send') + '</button>'; };
  /* hold to approve: {label, ms, fill: 'dots'|'solid', describedby, attrs}. Wire with ui.hold.wire(el) or ui.hydrate(). */
  html.hold = function (o) {
    o = o || {};
    const id = o.hintId || nid('hold');
    const label = o.label || 'Hold to approve';
    return '<button type="button" class="ui-btn ui-hold" data-ui="hold" data-state="idle"' + attrs(Object.assign({ 'data-ms': o.ms, 'data-fill': o.fill, 'aria-describedby': id, 'aria-label': o.ariaLabel }, o.attrs)) + '>' +
      '<span class="ui-hold__solid" aria-hidden="true"></span><canvas class="ui-hold__fx" aria-hidden="true"></canvas>' +
      '<span class="ui-hold__label">' + esc(label) + '</span><span class="ui-hold__label ui-hold__label--on" aria-hidden="true">' + esc(label) + '</span></button>' +
      '<span class="ui-sr" id="' + id + '">Press and hold for one second, hold the space bar, or press enter twice</span>';
  };
  /* switch: a native checkbox. {id, checked, disabled, label (aria-label when no visible <label for>)} */
  html.switch = (o) => '<input type="checkbox" role="switch" class="ui-switch" data-ui="switch"' + attrs({ id: o.id, checked: !!o.checked, disabled: o.disabled, 'aria-label': o.label, name: o.name }) + '>';
  /* segmented: {options: [{value, label, dot}], value, mode: 'tabs'|'radio', label, size: 's', vertical, fill, controls: {value: panelId}} */
  html.segmented = function (o) {
    const opts = o.options || [];
    const i = Math.max(0, opts.findIndex((x) => x.value === o.value));
    const tabs = o.mode !== 'radio';
    return '<div class="' + cx('ui-seg', o.size === 's' && 'ui-seg--s', o.vertical && 'ui-seg--vertical', o.fill && 'ui-seg--fill', o.class) + '" data-ui="seg" role="' + (tabs ? 'tablist' : 'radiogroup') + '"' +
      attrs({ 'aria-label': o.label, 'aria-orientation': o.vertical ? 'vertical' : null, style: '--n:' + opts.length + ';--i:' + i }) + '><span class="ui-seg__thumb" aria-hidden="true"></span>' +
      opts.map((x, j) => '<button type="button" class="ui-seg__opt" role="' + (tabs ? 'tab' : 'radio') + '" data-value="' + esc(x.value) + '"' +
        attrs({ [tabs ? 'aria-selected' : 'aria-checked']: String(j === i), tabindex: j === i ? '0' : '-1', 'aria-controls': o.controls && o.controls[x.value], 'aria-label': x.ariaLabel, 'data-tip': x.tip, 'data-kbd': x.keys }) + '>' +
        (x.icon ? ui.icon(x.icon, { size: 'm' }) : '') + (x.label != null ? '<span>' + esc(x.label) + '</span>' : '') + (x.dot != null ? html.dot('attention', { show: !!x.dot }) : '') + '</button>').join('') + '</div>';
  };
  /* chip: {label, icon, pressed, mono, haspopup, expanded, option, checked, tip} */
  html.chip = function (o) {
    const option = !!o.option;
    return '<button type="button" class="' + cx('ui-chip', o.mono && 'ui-chip--mono', option && 'ui-chip--option', o.class) + '" data-ui="chip"' +
      attrs(Object.assign({ role: option ? 'radio' : null, 'aria-checked': option ? String(!!o.checked) : null, 'aria-pressed': !option && o.pressed != null ? String(!!o.pressed) : null,
        'aria-haspopup': o.haspopup, 'aria-expanded': o.haspopup ? String(!!o.expanded) : null, 'data-tip': o.tip, 'data-value': o.value, tabindex: o.tabindex }, o.attrs)) + '>' +
      (o.icon ? ui.icon(o.icon) : '') + '<span>' + esc(o.label) + '</span>' + (o.haspopup ? ui.icon('chevron-down', { size: 's' }) : '') + '</button>';
  };
  html.chipGroup = (o) => '<div class="ui-chips" role="radiogroup" data-ui="options"' + attrs({ 'aria-label': o.label }) + ' style="display:flex;flex-wrap:wrap;gap:6px">' +
    o.options.map((x) => html.chip({ label: x.label, value: x.value, option: true, checked: x.value === o.value, tabindex: x.value === o.value ? '0' : '-1' })).join('') + '</div>';

  /* orb: (bot, {size, render, state, flag, motion: 'calm'|'lively'|'off', live, still}) -> <span class="ui-orb">
     Owner decision: reduced motion REDUCES and never freezes an orb. Blinks, eye morphs, small glances and reactions
     stay; orb2 itself drops floating, head travel, hops and spins under prefers-reduced-motion, the jelly is lowered so
     a poke does not bounce, and ui.glance moves the eyes in small steps (orb2 holds its ambient gaze still then).
     Live or still: `live: true` always animates (whatever the size); `still: true` is one still frame (picker tiles up
     to 28px, arrange tiles); by default an orb is live above 16px and still at 16px and under. Off-screen orbs are
     paused by orb2 itself, so nothing needs `static` for that. Orbs made elsewhere: HX.ui.liven(orbAvatar, {size}). */
  const orbIsStill = (o, size) => (o.live ? false : (!!o.still || size <= 16));
  html.orb = function (b, o) {
    o = o || {};
    const size = o.size || 20, s = ui.botState(Object.assign({}, b, o.state ? { state: o.state } : null));
    const still = orbIsStill(o, size);
    const dark = lumHex(b.color) < 0.05;
    const render = o.render && o.render !== size ? o.render : null;
    return '<span class="ui-orb"' + attrs({ 'data-bot': b.id, 'data-render': render ? '' : null, style: '--o:' + size + (render ? ';--r:' + render : ''), 'data-size': size >= 40 ? 'l' : null }) + '>' +
      '<orb-avatar' + attrs({ size: render || size, shape: b.shape || 'circle', color: b.color, 'eye-shape': b.eyes || 'pill', 'eye-color': dark ? 'var(--ink-on-dock)' : null,
        reaction: s.reaction, 'idle-motion': o.motion || 'calm', mode: o.mode || 'drift', static: still, jelly: !still && reduced() ? '.12' : null,
        'data-glance': still ? null : '', label: b.name, 'aria-hidden': 'true' }) + '></orb-avatar>' +
      (o.flag && s.attention ? '<span class="ui-dot ui-dot--flag" aria-hidden="true"></span>' : '') + '</span>';
  };
  function lumHex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1;
    const n = parseInt(m[1], 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  html.stateWord = (b, o) => { const s = ui.botState(b); if (s.key === 'idle' && !(o && o.showIdle)) return ''; return '<span class="ui-state"' + (s.tone !== 'none' ? ' data-tone="' + s.tone + '"' : '') + '>' + esc(s.word) + '</span>'; };

  /* ───────────── glance: small eye steps for live orbs under reduced motion (shared by bots and the dock) ─────────────
     orb2 holds its ambient gaze still under prefers-reduced-motion. While reduced motion is on, every few seconds up
     to three visible live orbs (orb-avatar[data-glance]:not([static])) get a small new `gaze`; turning reduced motion
     off clears it so orb2's own idle life takes over again. HX.ui.orb() marks its orbs; mark others with
     HX.ui.glance.add(orbAvatar).
     The lead: three random orbs of fifteen would leave the one orb the user is looking at (the room's presence orb,
     the new-bot preview) nearly still. HX.ui.glance.lead(orb | () => orb, {skip}) names it: under reduced motion it gets
     its own step every 1.8s, a blink (one in three) or a small gaze, and the random steps leave it alone. A getter is
     read on every step, so a lead that changes with the view needs one call. The step is skipped while the pointer is
     on the orb, while it carries data-glance-hold (it is following something), or when skip(orb) says so.
     lead(null) clears it; there is one lead at a time. */
  ui.glance = (function () {
    let t = 0, leadT = 0, lead = null, leadSkip = null;
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    const step = () => (Math.random() < 0.25 ? '8 5' : Math.round(Math.random() * 28 - 14) + ' ' + Math.round(Math.random() * 16 - 6));
    const leadOrb = () => { let o = null; try { o = typeof lead === 'function' ? lead() : lead; } catch (e) { o = null; } return o && o.isConnected ? o : null; };
    function tick() {
      clearTimeout(t); t = 0;
      if (!reduced() || document.hidden) return;
      const L = leadOrb();
      const live = [...document.querySelectorAll('orb-avatar[data-glance]:not([static])')].filter((o) => o !== L && visible(o));
      for (let k = 0; k < 3 && live.length; k++) live.splice(Math.floor(Math.random() * live.length), 1)[0].setAttribute('gaze', step());
      t = setTimeout(tick, 1400 + Math.random() * 1600);
    }
    function leadTick() {
      clearTimeout(leadT); leadT = 0;
      if (!lead || !reduced() || document.hidden) return;
      const o = leadOrb();
      if (o && !o.hasAttribute('static') && visible(o)) {
        if (!o.hasAttribute('data-glance')) { o.setAttribute('data-glance', ''); o.setAttribute('jelly', '.12'); }
        const held = o.matches(':hover') || o.hasAttribute('data-glance-hold') || (leadSkip && leadSkip(o));
        if (!held) { if (Math.random() < 0.34 && typeof o.blink === 'function') o.blink(); else o.setAttribute('gaze', step()); }
      }
      leadT = setTimeout(leadTick, 1800);
    }
    const onChange = () => {
      /* the jelly follows the preference too: lowered while reduced, orb2's own default otherwise */
      for (const o of document.querySelectorAll('orb-avatar[data-glance]')) { if (reduced()) o.setAttribute('jelly', '.12'); else if (o.getAttribute('jelly') === '.12') o.removeAttribute('jelly'); }
      if (reduced()) { tick(); leadTick(); } else { clearTimeout(t); clearTimeout(leadT); t = leadT = 0; for (const o of document.querySelectorAll('orb-avatar[data-glance][gaze]')) o.removeAttribute('gaze'); }
    };
    if (RMQ.addEventListener) RMQ.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && reduced()) { if (!t) tick(); if (!leadT) leadTick(); } });
    if (reduced()) setTimeout(tick, 600);
    const api = {
      add(o) { if (o) o.setAttribute('data-glance', ''); if (reduced() && !t) tick(); return o; },
      lead(target, opts) {
        lead = target || null; leadSkip = (opts && opts.skip) || null;
        if (lead && typeof lead !== 'function') api.add(lead);
        clearTimeout(leadT); leadT = 0;
        if (lead && reduced()) leadT = setTimeout(leadTick, 600);
        return target;
      },
      get current() { return leadOrb(); },
      tick
    };
    return api;
  })();
  /* liven an orb made outside HX.ui.orb (the dock's 80px-rendered row orbs, a bot's presence orb): the same rule.
     {lead: true} also makes it the glance lead (HX.ui.glance.lead). */
  ui.liven = function (orbEl, o) {
    if (!orbEl) return orbEl;
    o = o || {};
    const size = o.size || +orbEl.getAttribute('size') || 20;
    if (orbIsStill(o, size)) { orbEl.setAttribute('static', ''); orbEl.removeAttribute('data-glance'); return orbEl; }
    orbEl.removeAttribute('static');
    if (reduced()) orbEl.setAttribute('jelly', '.12');
    ui.glance.add(orbEl);
    if (o.lead) ui.glance.lead(orbEl, { skip: o.skip });
    return orbEl;
  };

  /* ───────────── squircle: Apple's continuous corners, the same in every engine (owner decision) ─────────────
     WebKit (Tauri's webview on Linux and macOS) has no corner-shape, so the corner is a path: Figma's corner smoothing,
     ported from figma-squircle (MIT licence, Copyright (c) 2021 Tien Pham, github.com/phamfoo/figma-squircle), which
     follows Daniel Furse, "Desperately seeking squircles" (Figma, 2018). A corner of radius R with smoothing ξ (0.6,
     as iOS) keeps a circular arc of 90(1 − ξ)° in its middle and replaces each end with a cubic, so curvature eases in
     from zero at the straight edge; the corner runs (1 + ξ)·R along each edge. Where an edge is too short for that
     run, ξ shrinks first (the corner never pokes past the middle of an edge).

     Applied as clip-path: path() on the element (Chromium and WebKit draw it alike). A clip-path also clips the inset
     hairline and the focus ring, so both are drawn by ::after, clipped to a band of the same path: 1px for the line
     (colour --sq-line, set by the component), 2px brass for the focus ring, inside the edge. Floating surfaces (menus,
     popovers, tooltips, toasts) are not clipped, so their elevation shadow survives: their background (--sq-bg) is
     painted by a clipped ::before instead (data-sq-mode="surface").

     Sizes come from one shared ResizeObserver (border box), whose callback the browser runs once per frame after
     layout: the paths are written there, in the same frame as the size, so a card animating its height or the dock
     morphing never shows a stale clip, and no style is read after a write. Paths are cached by size and radii. The
     radii come from the element's computed border-radius (the tokens, so --r-outer and --pad nesting holds), read once
     and again on hx:theme. A corner as round as half the element (a capsule, a circle) needs no path: it stays native.
       HX.ui.squircle.auto(selector, {mode})  binds every match, now and as they appear (a MutationObserver); [data-sq]
                                      and the library's own surfaces are bound already
       HX.ui.squircle.bind(el, {mode: 'clip'|'surface'|'slab'|'concave'}), .unbind(el), .refresh()
       HX.ui.squircle.path(w, h, r | [tl, tr, br, bl], {smoothing, x, y}) -> an SVG path string
       HX.ui.squircle.stats() -> {bound, cached, frames, lastMs, maxMs} */
  ui.squircle = (function () {
    const n = (x) => Math.round(x * 100) / 100;
    const rad = Math.PI / 180;
    let SMOOTH = 0.6;
    /* figma-squircle's getPathParamsForCorner, preserveSmoothing off */
    function params(r, sm, budget) {
      if (!(r > 0)) return null;
      let p = (1 + sm) * r;
      sm = Math.min(sm, budget / r - 1);
      p = Math.min(p, budget);
      const arcMeasure = 90 * (1 - sm);
      const arc = Math.sin(arcMeasure / 2 * rad) * r * Math.SQRT2;
      const alpha = (90 - arcMeasure) / 2;
      const p3p4 = r * Math.tan(alpha / 2 * rad);
      const beta = 45 * sm;
      const c = p3p4 * Math.cos(beta * rad);
      const d = c * Math.tan(beta * rad);
      const b = (p - arc - c - d) / 3;
      return { a: 2 * b, b, c, d, p, arc, r };
    }
    /* one corner from the current point: u is the direction in, v the direction out (unit vectors) */
    function seg(q, ux, uy, vx, vy) {
      if (!q) return '';
      const pt = (pu, pv) => n(pu * ux + pv * vx) + ' ' + n(pu * uy + pv * vy);
      const { a, b, c, d, arc, r } = q;
      return 'c' + pt(a, 0) + ' ' + pt(a + b, 0) + ' ' + pt(a + b + c, d) +
        'a' + n(r) + ' ' + n(r) + ' 0 0 ' + (ux * vy - uy * vx > 0 ? 1 : 0) + ' ' + pt(arc, arc) +
        'c' + pt(d, c) + ' ' + pt(d, b + c) + ' ' + pt(d, a + b + c);
    }
    /* a corner's commands are relative, so they depend only on its radius, the smoothing, the turn and (when the edge
       is too short for the full run) the budget: cached, so a resize only rebuilds the four straight edges */
    const DIRS = [[0, -1, 1, 0], [1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1]];   /* tl, tr, br, bl */
    const segCache = new Map(), NONE = ['', 0];
    function corner(r, sm, budget, dir) {
      const rr = Math.min(Math.max(0, r), budget);
      if (!(rr > 0)) return NONE;
      const key = rr + '|' + sm + '|' + ((1 + sm) * rr <= budget ? '' : budget) + '|' + dir;
      let v = segCache.get(key);
      if (!v) {
        const q = params(rr, sm, budget), D = DIRS[dir];
        v = [seg(q, D[0], D[1], D[2], D[3]), q.p];
        if (segCache.size > 4000) segCache.clear();
        segCache.set(key, v);
      }
      return v;
    }
    function path(w, h, r, o) {
      const sm = o && o.smoothing != null ? o.smoothing : SMOOTH, x = (o && o.x) || 0, y = (o && o.y) || 0;
      const R = typeof r === 'number' ? [r, r, r, r] : r;
      const budget = Math.min(w, h) / 2;
      const tl = corner(R[0], sm, budget, 0), tr = corner(R[1], sm, budget, 1), br = corner(R[2], sm, budget, 2), bl = corner(R[3], sm, budget, 3);
      return 'M' + n(x + w - tr[1]) + ' ' + n(y) + tr[0] + 'L' + n(x + w) + ' ' + n(y + h - br[1]) + br[0] +
        'L' + n(x + bl[1]) + ' ' + n(y + h) + bl[0] + 'L' + n(x) + ' ' + n(y + tl[1]) + tl[0] + 'Z';
    }
    /* a corner between two straight edges meeting at (cx, cy), from the current point (ax, ay) to (bx, by): its run
       is |a − c|, so its radius is run / (1 + ξ). Convex or concave: the turn's direction picks the arc's sweep. */
    function cornerTo(ax, ay, cx, cy, bx, by, o) {
      const sm = o && o.round ? 0 : (o && o.smoothing != null ? o.smoothing : SMOOTH);
      const run = Math.hypot(cx - ax, cy - ay); if (!run) return 'L' + n(bx) + ' ' + n(by);
      const ux = (cx - ax) / run, uy = (cy - ay) / run, vl = Math.hypot(bx - cx, by - cy) || 1, vx = (bx - cx) / vl, vy = (by - cy) / vl;
      return seg(params(run / (1 + sm), sm, run), ux, uy, vx, vy);
    }
    /* the dock's slab in the coordinates dock.js uses: the body spans x ∈ [x, x + w] (x defaults to F), the floor is
       y = h; flares of run F (concave), top corners of radius R; {round: true} for a pill's round ends */
    function slab(w, h, R, F, o) {
      o = o || {};
      const sm = o.round ? 0 : (o.smoothing != null ? o.smoothing : SMOOTH);
      const x0 = o.x != null ? o.x : F, x1 = x0 + w;
      const top = params(Math.min(R, w / 2), sm, Math.max(0, Math.min(w / 2, h - F)));
      const pt = top ? top.p : 0;
      return 'M' + n(x0 - F) + ' ' + n(h) + (F > 0 ? cornerTo(x0 - F, h, x0, h, x0, h - F, o) : '') +
        'L' + n(x0) + ' ' + n(pt) + seg(top, 0, -1, 1, 0) + 'L' + n(x1 - pt) + ' 0' + seg(top, 1, 0, 0, 1) +
        'L' + n(x1) + ' ' + n(h - F) + (F > 0 ? cornerTo(x1, h - F, x1, h, x1 + F, h, o) : '') + 'Z';
    }

    /* ── binding ── */
    const state = new WeakMap(), bound = new Set(), cache = new Map();
    const stats = { frames: 0, lastMs: 0, maxMs: 0 };
    const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';
    const SURFACE = '.ui-menu, .ui-pop, .ui-tip, .ui-toast, hx-card[data-size="popover"]';
    /* Owner rule: never clip-path a container whose content may overflow. Only these leaf controls clip; every other
       bound element is a frame (content unclipped, the corner drawn by ::before and ::after), floating ones a surface. */
    const LEAF = '.ui-btn, .ui-ib, .ui-send, .ui-seg__thumb, .ui-file';
    /* the library's surfaces and the card layer's (HX.ui.card); modules add theirs with auto() or [data-sq] */
    const selector = '[data-sq], .ui-btn, .ui-ib, .ui-send, .ui-seg, .ui-seg__thumb, .ui-row, .ui-menu__item, .ui-request, .ui-file, ' +
      '.ui-composer__box, .ui-slab, .ui-concave, ' + SURFACE + ', hx-card[data-size="inline"]:not([data-kind="blank"]):not([data-kind="escalation"]), ' +
      'hx-card[data-size="compact"], .cd-well, .cd-mini, .cd-opt, .cd-free, .cd-preview';
    const px = (v) => parseFloat(v) || 0;
    function radii(el) {
      const cs = getComputedStyle(el);
      return [px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius)];
    }
    /* Crisp lines at any device pixel ratio: the browser snaps a native border to whole device pixels; a clip path is
       drawn where it falls, so a 1px band at 1.25x straddles two device pixels and looks soft. The path is therefore
       snapped: its straight edges land on device pixels (from the element's position on screen, rounded inward) and the line is a whole
       number of device pixels thick, the way the browser rounds a border (at least one, rounded down: one device pixel
       below 2x, two at 2x). Positions change without a resize (a sidebar opening, a font loading), so resnap() re-reads
       them after transitions, animations, scrolling and layout. */
    const DPR = () => window.devicePixelRatio || 1;
    function snapOf(s) {
      if (s.mode === 'slab' || s.mode === 'concave') return { ox: 0, oy: 0, w: Math.round(s.w * 2) / 2, h: Math.round(s.h * 2) / 2, t: 1, t2: 2, D: 1 };
      /* inward: a box paints its background only inside its own rect, so a path edge outside that rect loses part
         of its line. Browsers snap that rect to device pixels (layout in device pixels), or to whole CSS pixels and
         then scale (some builds, headless Chromium among them), or not at all (a transformed box, such as the
         composer centred with translate); each edge goes to the innermost of the three, then inward to the next
         device pixel. The shape is at most about a device pixel inside the box. */
      const D = DPR(), e = 0.02;
      const lo = (a) => Math.ceil(Math.max(Math.round(a) * D, Math.round(a * D), a * D) - e);
      const hi = (b) => Math.floor(Math.min(Math.round(b) * D, Math.round(b * D), b * D) + e);
      const L = lo(s.x), T = lo(s.y), w = (hi(s.x + s.w) - L) / D, h = (hi(s.y + s.h) - T) / D;
      return { ox: L / D - s.x, oy: T / D - s.y, w, h, D, t: Math.max(1, Math.floor(D + 1e-6)) / D, t2: Math.max(1, Math.floor(2 * D + 1e-6)) / D };
    }
    function build(s, g) {
      const w = g.w, h = g.h;
      const R = s.r, key = s.mode + '|' + w.toFixed(3) + '|' + h.toFixed(3) + '|' + R.join(',') + '|' + (s.focusable ? 1 : 0) + '|' + SMOOTH + '|' + g.ox.toFixed(3) + '|' + g.oy.toFixed(3) + '|' + g.D;
      let v = cache.get(key);
      if (v) return v;
      if (cache.size > 800) cache.clear();
      if (s.mode === 'slab') {
        const r = R[0], F = r;
        v = { key, clip: 'path("' + slab(w, h, r, F, { x: 0 }) + '")' };
      } else if (s.mode === 'concave') {
        const at = s.at, sz = Math.min(w, h);
        const d = at === 'tr' ? 'M' + n(sz) + ' 0L0 0' + cornerTo(0, 0, sz, 0, sz, sz) + 'Z' : 'M0 0L' + n(sz) + ' 0' + cornerTo(sz, 0, 0, 0, 0, sz) + 'Z';
        v = { key, clip: 'path("' + d + '")' };
      } else {
        const ox = g.ox, oy = g.oy;
        const outer = path(w, h, R, { x: ox, y: oy });
        const inner = (t) => path(Math.max(0, w - 2 * t), Math.max(0, h - 2 * t), R.map((r) => Math.max(0, r - t)), { x: ox + t, y: oy + t });
        v = { key, clip: 'path("' + outer + '")', edge: 'path(evenodd, "' + outer + inner(g.t) + '")', ring: '', outer, inner, t2: g.t2 };
      }
      cache.set(key, v);
      return v;
    }
    function apply(el, s) {
      const g = snapOf(s), w = g.w, h = g.h;
      if (!(w >= 1 && h >= 1) || !s.r) return;
      const half = Math.min(w, h) / 2;
      const native = s.mode !== 'slab' && s.mode !== 'concave' && s.r.every((r) => r >= half - 0.5 || r === 0) && s.r.some((r) => r > 0);
      if (native || s.r.every((r) => r === 0) && s.mode !== 'concave') {
        if (s.on) { el.removeAttribute('data-sq-on'); s.on = false; s.key = ''; }
        return;
      }
      const v = build(s, g);
      if (v.key === s.key) { if (s.focusable && el === document.activeElement) ring(el, s, v); return; }
      const st = el.style;
      st.setProperty('--sq-clip', v.clip);
      if (v.edge) st.setProperty('--sq-edge', v.edge);
      s.key = v.key; s.ringKey = '';
      if (s.focusable && el === document.activeElement) ring(el, s, v);
      if (!s.on) { el.setAttribute('data-sq-on', ''); s.on = true; }
    }
    /* the focus ring's band is built when the element takes focus (or resizes while focused), not for every button */
    function ring(el, s, v) {
      if (s.ringKey === v.key || !v.outer) return;
      if (!v.ring) v.ring = 'path(evenodd, "' + v.outer + v.inner(v.t2 || 2) + '")';
      el.style.setProperty('--sq-ring', v.ring); s.ringKey = v.key;
    }
    document.addEventListener('focusin', (e) => {
      const el = e.target, s = el && state.get(el);
      if (s && s.on && s.focusable) ring(el, s, cache.get(s.key) || build(s, snapOf(s)));
    }, true);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
      const t0 = performance.now();
      /* every read first (sizes from the entries, radii of new elements), then every write: no style thrash */
      const todo = [];
      for (const e of entries) {
        const el = e.target, s = state.get(el);
        if (!s) continue;
        const b = e.borderBoxSize && e.borderBoxSize[0];
        s.w = b ? b.inlineSize : el.offsetWidth; s.h = b ? b.blockSize : el.offsetHeight;
        const rc = el.getBoundingClientRect(); s.x = rc.left; s.y = rc.top;
        if (!s.r) s.r = radii(el);
        todo.push(el, s);
      }
      for (let i = 0; i < todo.length; i += 2) apply(todo[i], todo[i + 1]);
      const ms = performance.now() - t0;
      stats.frames++; stats.lastMs = ms; if (ms > stats.maxMs) stats.maxMs = ms;
    }) : null;
    function bind(el, o) {
      if (!ro || !el || state.has(el)) return el;
      let mode = (o && o.mode) || el.getAttribute('data-sq-mode') || (el.matches(SURFACE) ? 'surface' : el.matches('.ui-slab') ? 'slab' : el.matches('.ui-concave') ? 'concave' : el.matches(LEAF) ? 'clip' : 'frame');
      if (mode === 'clip' && !el.matches(LEAF)) mode = 'frame';   /* clip is for leaf controls only, whoever asks */
      const s = { mode, w: 0, h: 0, x: 0, y: 0, r: null, key: '', on: false, focusable: (mode === 'clip' || mode === 'frame') && el.matches(FOCUSABLE), at: el.getAttribute('data-at') };
      state.set(el, s); bound.add(el);
      el.setAttribute('data-sq-mode', mode);
      ro.observe(el, { box: 'border-box' });
      return el;
    }
    function unbind(el) {
      const s = state.get(el); if (!s) return;
      ro.unobserve(el); state.delete(el); bound.delete(el);
      el.removeAttribute('data-sq-on'); el.removeAttribute('data-sq-mode');
      for (const k of ['--sq-clip', '--sq-edge', '--sq-ring']) el.style.removeProperty(k);
    }
    const extra = [];   /* [selector, mode] from auto() */
    function scan(root) {
      if (root.nodeType !== 1) return;
      for (const [sel, mode] of extra) { if (root.matches(sel)) bind(root, { mode }); for (const el of root.querySelectorAll(sel)) bind(el, { mode }); }
      if (root.matches(selector)) bind(root);
      for (const el of root.querySelectorAll(selector)) bind(el);
    }
    /* positions only: every bound element's place on screen, read first, then the paths whose snap changed */
    let snapRaf = 0, snapTimer = 0;
    function resnap() {
      snapRaf = 0;
      const t0 = performance.now(), todo = [];
      for (const el of bound) {
        const s = state.get(el); if (!s || !s.on || s.mode === 'slab' || s.mode === 'concave') continue;
        if (!el.isConnected) continue;
        const rc = el.getBoundingClientRect();
        if (Math.abs(rc.left - s.x) > 0.004 || Math.abs(rc.top - s.y) > 0.004) { s.x = rc.left; s.y = rc.top; todo.push(el, s); }
      }
      for (let i = 0; i < todo.length; i += 2) apply(todo[i], todo[i + 1]);
      stats.snaps = (stats.snaps || 0) + 1; stats.snapMs = performance.now() - t0;
    }
    /* now (next frame) and again once motion has settled */
    function queueSnap() {
      if (!snapRaf) snapRaf = requestAnimationFrame(resnap);
      clearTimeout(snapTimer); snapTimer = setTimeout(() => { if (!snapRaf) snapRaf = requestAnimationFrame(resnap); }, 420);
    }
    let raf = 0;
    function refresh() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        SMOOTH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--corner-smoothing'));
        if (!(SMOOTH >= 0 && SMOOTH <= 1)) SMOOTH = 0.6;
        const t0 = performance.now();
        for (const el of bound) { const s = state.get(el); if (!s) continue; if (!el.isConnected) { unbind(el); continue; } s.r = radii(el); s.key = ''; }
        for (const el of bound) { const s = state.get(el); if (s) apply(el, s); }
        stats.lastMs = performance.now() - t0;
      });
    }
    if (ro) {
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const nd of m.addedNodes) if (nd.nodeType === 1) scan(nd);
          for (const nd of m.removedNodes) if (nd.nodeType === 1 && !nd.isConnected) { if (state.has(nd)) unbind(nd); if (nd.querySelectorAll) for (const el of nd.querySelectorAll('[data-sq-mode]')) unbind(el); }
        }
      });
      const start = () => { SMOOTH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--corner-smoothing')) || 0.6; scan(document.documentElement); mo.observe(document.documentElement, { childList: true, subtree: true }); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
      window.addEventListener('hx:theme', refresh);
      for (const ty of ['transitionend', 'animationend', 'scrollend']) document.addEventListener(ty, queueSnap, true);
      window.addEventListener('resize', queueSnap);
      let scrollT = 0;
      document.addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(queueSnap, 120); }, { capture: true, passive: true });
      if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', queueSnap);
      if (window.HX && typeof window.HX.on === 'function') for (const ty of ['hx:layout', 'hx:dock', 'hx:state', 'hx:tab']) window.HX.on(ty, queueSnap);
      if (window.HX && typeof window.HX.on === 'function') window.HX.on('hx:theme', refresh);
      /* the corner setting and the preset change the radii: theme.js sets these on <html> */
      new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-hx-corners', 'data-hx-preset', 'data-hx-density', 'style'] });
    }
    return {
      path, cornerTo, slab, bind, unbind, refresh, resnap: queueSnap,
      auto(sel, o) { if (!sel) return; extra.push([sel, o && o.mode]); if (document.readyState !== 'loading') scan(document.documentElement); },
      stats: () => Object.assign({ bound: bound.size, cached: cache.size, smoothing: SMOOTH }, stats),
      get smoothing() { return SMOOTH; }
    };
  })();
  /* the old name: HX.ui.shape draws the same corner for paths (the dock's slab) */
  ui.shape = {
    corner: (ax, ay, cx, cy, bx, by, o) => ui.squircle.cornerTo(ax, ay, cx, cy, bx, by, o),
    slab: (w, h, R, F, o) => ui.squircle.slab(w, h, R, F, o),
    radius: (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name || '--r-l')) || 0,
    continuous: () => true
  };

  /* row: {title, sub, end, endTone, lead: html, current, archived, acts: html, attrs, tag} */
  html.row = function (o) {
    const two = o.sub != null;
    const tag = o.tag || 'button';
    const row = '<' + tag + (tag === 'button' ? ' type="button"' : '') + ' class="' + cx('ui-row', two && 'ui-row--2', o.class) + '"' +
      attrs(Object.assign({ 'aria-current': o.current ? 'true' : null, 'data-archived': o.archived, 'data-value': o.value, tabindex: o.tabindex }, o.attrs)) + '>' +
      '<span class="ui-row__lead">' + (o.lead || '') + '</span>' +
      '<span class="ui-row__text"><span class="ui-row__title">' + (o.titleHTML || esc(o.title)) + '</span>' + (two ? '<span class="ui-row__sub">' + esc(o.sub) + '</span>' : '') + '</span>' +
      (o.end ? '<span class="ui-row__end"' + attrs({ 'data-tone': o.endTone, 'data-swap': o.acts ? '' : null }) + '>' + o.end + '</span>' : '') + '</' + tag + '>';
    /* --acts: how many action buttons show on hover or focus, so the title can make room for them */
    return o.acts ? '<li class="ui-row-wrap" style="--acts:' + (o.acts.match(/<button/g) || []).length + '">' + row + '<span class="ui-row__acts">' + o.acts + '</span></li>' : '<li>' + row + '</li>';
  };
  html.leadFor = function (o) { /* the glyph column: running breathes, attention is red, current and idle is brass, else nothing */
    if (o.attention) return html.dot('attention');
    if (o.running) return html.dot('run');
    if (o.current) return html.dot('here');
    return '';
  };
  /* group: {label, collapsible, expanded, rows: html, id} */
  html.group = function (o) {
    const id = o.id || nid('grp');
    const head = o.collapsible
      ? '<button type="button" class="ui-group__head" data-ui="group" aria-expanded="' + (o.expanded !== false) + '" aria-controls="' + id + '"><span>' + esc(o.label) + '</span>' + ui.icon('chevron') + '</button>'
      : '<div class="ui-group__head" id="' + id + '-h">' + esc(o.label) + '</div>';
    return '<div class="ui-group" role="group" aria-label="' + esc(o.label) + '">' + head + '<ul class="ui-rows" id="' + id + '" data-ui="rows">' + (o.rows || '') + '</ul></div>';
  };

  /* ladder: {stations: [[model, rule]], current, variant: 'line'|'list', label, off, ground} */
  html.ladder = function (o) {
    const L = o.stations || [], cur = o.current == null ? 0 : o.current;
    const st = (i) => (i < cur ? 'past' : i === cur ? 'now' : 'next');
    const style = o.ground ? '--ui-ladder-ground:' + o.ground : null;
    if (o.variant === 'list') {
      return '<ol class="ui-ladder ui-ladder--list"' + attrs({ 'aria-label': o.label || 'Model ladder', 'data-off': o.off, style }) + '>' + L.map((x, i) =>
        '<li' + (i === cur ? ' aria-current="step"' : '') + '><span class="ui-ladder__mark"><i class="ui-ladder__st" data-s="' + st(i) + '"></i></span>' +
        '<span class="ui-ladder__name">' + esc(x[0]) + '</span><span class="ui-ladder__rule">' + esc(x[1] || '') + '</span></li>').join('') + '</ol>';
    }
    const name = L[cur] ? L[cur][0] : '';
    return '<span class="ui-ladder" role="img"' + attrs({ 'aria-label': (o.label || 'Model ladder') + ', station ' + (cur + 1) + ' of ' + L.length + (name ? ': ' + name : ''), 'data-off': o.off, style }) + '>' +
      L.map((_, i) => '<i class="ui-ladder__st" data-s="' + st(i) + '"></i>').join('') + '</span>';
  };

  /* measure: {used, total, dots, variant: 'strip'|'row'|'grid', parts: [[label, n]], label, cols} */
  html.measure = function (o) {
    const n = o.dots || (o.variant === 'grid' ? 40 : 8), per = o.total / n;
    let cells = '';
    if (o.parts) {
      let acc = 0, k = 0, edges = o.parts.map((p) => (acc += p[1]));
      for (let i = 0; i < n; i++) { const mid = (i + 0.5) * per; while (k < edges.length && mid > edges[k]) k++; cells += k < edges.length ? '<i data-p="' + Math.min(k, 3) + '"></i>' : '<i></i>'; }
    } else {
      const on = Math.round(o.used / per);
      for (let i = 0; i < n; i++) cells += i < on ? '<i data-on></i>' : '<i></i>';
    }
    const pct = Math.round((o.used != null ? o.used : (o.parts || []).reduce((a, p) => a + p[1], 0)) / o.total * 100);
    return '<span class="' + cx('ui-measure', 'ui-measure--' + (o.variant || 'strip')) + '" role="img"' + attrs({ 'aria-label': (o.label || 'Context') + ' ' + pct + '% used', style: o.cols ? '--cols:' + o.cols : null }) + '>' + cells + '</span>';
  };
  html.legend = (parts, fmt) => '<ul class="ui-legend">' + parts.map((p, i) => '<li><i style="background:var(' + ['--text', '--text-dim', '--text-quiet', '--text-faint'][Math.min(i, 3)] + ')"></i><span>' + esc(p[0]) + '</span><b>' + esc(fmt ? fmt(p[1]) : p[1]) + '</b></li>').join('') + '</ul>';
  /* pages: {pages: [{id, label, attention}], current, interactive, label} */
  html.pages = function (o) {
    const P = o.pages || [];
    if (!o.interactive) return '<span class="ui-pages ui-pages--still" role="img" aria-label="' + esc(o.label || ('Page ' + (P.findIndex((p) => p.id === o.current) + 1) + ' of ' + P.length)) + '">' + P.map((p) => '<span class="ui-pages__dot"' + (p.id === o.current ? ' data-current' : '') + (p.attention ? ' data-attention' : '') + '><i></i></span>').join('') + '</span>';   /* still: an image named by its label; the dots carry no ARIA state */
    return '<span class="ui-pages" role="tablist" data-ui="pages"' + attrs({ 'aria-label': o.label || 'Pages' }) + '>' + P.map((p) => '<button type="button" class="ui-pages__dot" role="tab" data-value="' + esc(p.id) + '"' +
      attrs({ 'aria-selected': String(p.id === o.current), tabindex: p.id === o.current ? '0' : '-1', 'aria-label': p.label + (p.attention ? ', needs you' : ''), 'data-attention': p.attention, 'data-tip': p.label }) + '><i></i></button>').join('') + '</span>';
  };

  /* conversation */
  html.request = (text) => '<div class="ui-request">' + esc(text) + '</div>';
  /* entry: {kind: 'user'|'agent'|'bot', who: html, callno: [strings], first: html, body: html, steps: {count, id, open}} */
  html.entry = function (o) {
    const lines = (o.callno || []).map((l, i) => (i === 0 && !o.who ? '<b>' + esc(l) + '</b>' : '<span>' + esc(l) + '</span>')).join('');
    const steps = o.steps ? html.disclosure({ label: o.steps.count + ' steps', controls: o.steps.id, expanded: o.steps.open }) : '';
    return '<article class="ui-entry"' + attrs({ 'data-kind': o.kind, 'aria-label': o.label }) + '><div class="ui-callno">' + (o.who ? '<span class="' + cx('ui-callno__who', o.kind === 'user' && 'is-you') + '">' + o.who + '</span>' : '') + lines + steps + '</div>' +
      '<div class="ui-entry__body">' + (o.body || '') + '</div></article>';
  };
  html.disclosure = (o) => '<button type="button" class="ui-disclosure" data-ui="disclosure"' + attrs({ 'aria-expanded': String(!!o.expanded), 'aria-controls': o.controls }) + '>' + ui.icon('chevron') + '<span>' + esc(o.label) + '</span></button>';
  /* steps: [{title, mono, meta: [..], time, kind: 'step'|'fail'|'escalate'}] */
  html.steps = (items, o) => '<ol class="ui-steps"' + attrs({ id: o && o.id, hidden: o && o.hidden, 'aria-label': 'Steps' }) + '>' + items.map((s) =>
    '<li class="ui-step" data-kind="' + esc(s.kind || 'step') + '"><span class="ui-step__mark"><i></i></span><span class="ui-step__title' + (s.mono ? ' ui-mono' : '') + '">' + esc(s.title) +
    (s.meta ? '<span class="ui-step__meta">' + s.meta.map((m) => '<span>' + esc(m) + '</span>').join('') + '</span>' : '') + '</span><span class="ui-step__time">' + esc(s.time || '') + '</span></li>').join('') + '</ol>';
  /* the blank inside a sentence: {answer, label} -> a button; the card layer (HX.cards blank) owns the popover */
  html.blank = (o) => { o = o || {}; const a = o.answer || ''; return '<button type="button" class="ui-blank"' + attrs({ 'data-answered': a ? '' : null, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': a ? 'Answer: ' + a + '. Change it' : 'Answer the open question, waiting for you' }) + '><span class="ui-blank__gap">' + esc(a) + '</span>' + (a ? '' : html.stamp('waiting for you', { attrs: { 'aria-hidden': 'true' } })) + '</button>'; };

  /* section (right panel): {label, meta: html, open, body: html, id} */
  html.section = function (o) {
    const id = o.id || nid('sec');
    return '<div class="ui-sec" role="group"' + attrs({ 'aria-labelledby': id + '-h', 'data-name': o.name }) + '><button type="button" class="ui-sec__head" data-ui="section" id="' + id + '-h" aria-expanded="' + (!!o.open) + '" aria-controls="' + id + '">' +
      '<span class="ui-sec__label">' + esc(o.label) + '</span><span class="ui-sec__meta">' + (o.meta || '') + '</span>' + ui.icon('chevron') + '</button><div class="ui-sec__body" id="' + id + '">' + (o.body || '') + '</div></div>';
  };
  /* menu items: [{label, value, desc, icon, keys, checked, mono, disabled, stamp} | '-' | {title}] */
  html.menuItems = function (items, o) {
    o = o || {};
    const radio = items.some((x) => x && x.checked != null);
    return items.map((x) => {
      if (x === '-') return '<div class="ui-menu__sep" role="separator"></div>';
      if (x.title) return '<div class="ui-menu__title" role="presentation">' + esc(x.title) + '</div>';
      if (x.foot) return '<div class="ui-menu__foot">' + esc(x.foot) + '</div>';
      const role = x.role || (radio ? (o.multi ? 'menuitemcheckbox' : 'menuitemradio') : 'menuitem');
      return '<button type="button" class="ui-menu__item" role="' + role + '"' + attrs({ 'aria-checked': role === 'menuitem' ? null : String(!!x.checked), 'data-value': x.value != null ? x.value : x.label, disabled: x.disabled, tabindex: '-1', 'aria-keyshortcuts': x.keys && ariaKeys(x.keys) }) + '>' +
        '<span class="ui-menu__glyph">' + (role !== 'menuitem' ? (x.checked ? ui.icon('check') : '') : (x.lead || (x.icon ? ui.icon(x.icon) : ''))) + '</span>' +
        '<span class="ui-menu__text"><span class="' + cx('ui-menu__label', x.mono && 'ui-mono') + '"' + (x.content ? ' data-content' : '') + '>' + esc(x.label) + '</span>' + (x.desc ? '<span class="ui-menu__desc">' + esc(x.desc) + '</span>' : '') + '</span>' +
        (x.stamp ? html.stamp(x.stamp) : '') + (x.keys ? html.keys(x.keys) : '') + '</button>';
    }).join('');
  };
  /* field: {id, label, hint, error, kind: 'text'|'textarea'|'select', value, placeholder, mono, raised, options} */
  html.field = function (o) {
    const id = o.id || nid('fld'), hid = id + '-hint';
    const common = { id, name: o.name, placeholder: o.placeholder, 'aria-describedby': o.hint || o.error ? hid : null, 'aria-invalid': o.error ? 'true' : null, disabled: o.disabled, spellcheck: o.mono ? 'false' : null, autocomplete: 'off' };
    const cls = cx('ui-input', o.mono && 'ui-input--mono', o.raised && 'ui-input--raised');
    let control;
    if (o.kind === 'textarea') control = '<textarea class="' + cls + '" data-ui="autosize" rows="2"' + attrs(common) + '>' + esc(o.value || '') + '</textarea>';
    else if (o.kind === 'select') control = '<select class="' + cls + '"' + attrs(common) + '>' + (o.options || []).map((x) => '<option' + (x === o.value ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>';
    else control = '<input type="' + (o.type || 'text') + '" class="' + cls + '"' + attrs(Object.assign(common, { value: o.value })) + '>';
    return '<div class="ui-field">' + (o.label ? '<label class="ui-field__label" for="' + id + '">' + esc(o.label) + '</label>' : '') + control +
      (o.error || o.hint ? '<p class="ui-field__hint" id="' + hid + '"' + (o.error ? ' data-tone="attention"' : '') + '>' + esc(o.error || o.hint) + '</p>' : '') + '</div>';
  };
  html.setRow = (o) => '<div class="ui-set__row"><' + (o.for ? 'label for="' + esc(o.for) + '"' : 'span') + ' class="ui-set__label"><span>' + esc(o.label) + '</span>' + (o.hint ? '<small>' + esc(o.hint) + '</small>' : '') + '</' + (o.for ? 'label' : 'span') + '>' + (o.control || '') + '</div>';
  html.empty = (o) => '<div class="ui-empty">' + (o.mark ? '<span style="width:24px;height:32px;color:var(--text-faint)">' + ui.icon('phi') + '</span>' : '') + '<h2 class="ui-empty__title">' + esc(o.title) + '</h2>' + (o.text ? '<p class="ui-empty__text">' + esc(o.text) + '</p>' : '') + (o.action || '') + '</div>';

  /* ═════════════ element factories (wired) ═════════════ */
  const make = (name) => (o, ...rest) => { const el = frag(html[name](o || {}, ...rest)); hydrateOne(el); return el; };
  for (const n of ['button', 'iconButton', 'send', 'switch', 'segmented', 'chip', 'chipGroup', 'stamp', 'dot', 'code', 'keys', 'capacity', 'ladder', 'measure', 'legend', 'pages', 'request', 'entry', 'disclosure', 'steps', 'blank', 'section', 'field', 'empty']) ui[n] = make(n);
  ui.orb = (bot, o) => frag(html.orb(bot, o));
  ui.row = (o) => { const li = frag(html.row(o)); hydrateOne(li); return li; };
  ui.group = (o) => { const g = frag(html.group(o)); ui.hydrate(g); return g; };
  ui.hold = function (o) { const wrap = document.createElement('span'); wrap.style.display = 'contents'; wrap.innerHTML = html.hold(o || {}); const btn = wrap.firstElementChild; wireHold(btn, o || {}); return wrap; };
  ui.hold.wire = (btn, o) => wireHold(btn, o || {});
  ui.inline = (text) => { const s = document.createElement('span'); s.innerHTML = html.inline(text); return s; };

  /* ═════════════ behaviours ═════════════ */
  const WIRED = new WeakSet();
  function hydrateOne(el) {
    if (!el || el.nodeType !== 1) return;
    const kind = el.dataset && el.dataset.ui;
    if (kind && !WIRED.has(el)) { WIRED.add(el); (WIRE[kind] || (() => {}))(el); }
    for (const c of el.querySelectorAll('[data-ui]')) if (!WIRED.has(c)) { WIRED.add(c); (WIRE[c.dataset.ui] || (() => {}))(c); }
  }
  ui.hydrate = function (root) { hydrateOne(root || document.body); return root; };
  const WIRE = {
    hold: (el) => wireHold(el, {}),
    seg: wireSeg,
    options: wireOptions,
    pages: wireSeg,
    rows: wireRows,
    group: (el) => el.addEventListener('click', () => { const open = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', String(open)); fire(el, 'ui:change', { value: open }); }),
    section: (el) => el.addEventListener('click', () => { const open = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', String(open)); fire(el, 'ui:change', { value: open }); }),
    disclosure: (el) => el.addEventListener('click', () => {
      const open = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', String(open));
      const t = el.getAttribute('aria-controls') && document.getElementById(el.getAttribute('aria-controls')); if (t) t.hidden = !open;
      fire(el, 'ui:change', { value: open });
    }),
    chip: (el) => { if (el.hasAttribute('aria-pressed')) el.addEventListener('click', () => { const v = el.getAttribute('aria-pressed') !== 'true'; if (fire(el, 'ui:change', { value: v }, true)) el.setAttribute('aria-pressed', String(v)); }); },
    switch: (el) => el.addEventListener('change', () => fire(el, 'ui:change', { value: el.checked })),
    autosize: (el) => { const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }; el.addEventListener('input', fit); requestAnimationFrame(fit); },
    send: () => {}
  };

  /* segmented, page dots: one tab stop, arrows move and select, the thumb slides by transform */
  function wireSeg(root) {
    const opts = () => [...root.querySelectorAll(':scope > [role="tab"], :scope > [role="radio"]')];
    const vertical = root.getAttribute('aria-orientation') === 'vertical';
    const sel = (b) => b.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-checked';
    function select(b, focus, quiet) {
      const list = opts(), i = list.indexOf(b);
      if (i < 0) return;
      const prev = list.find((x) => x.getAttribute(sel(x)) === 'true');
      if (prev === b) { if (focus) b.focus(); return; }
      if (!quiet && !fire(root, 'ui:change', { value: b.dataset.value, index: i }, true)) return;
      list.forEach((x, j) => { x.setAttribute(sel(x), String(j === i)); x.tabIndex = j === i ? 0 : -1; });
      root.style.setProperty('--i', i);
      if (focus) b.focus();
    }
    root.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"], [role="radio"]'); if (b && root.contains(b)) select(b, false); });
    root.addEventListener('keydown', (e) => {
      const list = opts(), i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const next = { [vertical ? 'ArrowDown' : 'ArrowRight']: i + 1, [vertical ? 'ArrowUp' : 'ArrowLeft']: i - 1, Home: 0, End: list.length - 1 }[e.key];
      if (next == null) return;
      e.preventDefault();
      select(list[(next + list.length) % list.length], true);
    });
    root.select = (value) => { const b = opts().find((x) => x.dataset.value === String(value)); if (b) select(b, false, true); };
  }
  /* option chips (role=radio): the same keyboard as the segmented control, no thumb */
  function wireOptions(root) {
    const opts = () => [...root.querySelectorAll('[role="radio"]')];
    function select(b, focus) {
      if (!fire(root, 'ui:change', { value: b.dataset.value }, true)) return;
      opts().forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
      if (focus) b.focus();
    }
    root.addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) select(b, false); });
    root.addEventListener('keydown', (e) => {
      const list = opts(), i = list.indexOf(document.activeElement); if (i < 0) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
      e.preventDefault(); select(list[(i + d + list.length) % list.length], true);
    });
  }
  /* rows: Up and Down move between rows (Home, End); Enter or Space opens the row; one tab stop per list */
  function wireRows(root) {
    const rows = () => [...root.querySelectorAll('.ui-row')].filter((r) => r.offsetParent !== null);
    const sync = () => { const list = rows(); const cur = list.find((r) => r.getAttribute('aria-current')) || list[0]; list.forEach((r) => { r.tabIndex = r === cur ? 0 : -1; }); };
    sync();
    root.addEventListener('keydown', (e) => {
      const list = rows(), i = list.indexOf(document.activeElement); if (i < 0) return;
      const n = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key]; if (n == null) return;
      e.preventDefault(); const t = list[Math.max(0, Math.min(list.length - 1, n))]; list.forEach((r) => { r.tabIndex = r === t ? 0 : -1; }); t.focus();
    });
    root.addEventListener('click', (e) => {
      const r = e.target.closest('.ui-row'); if (!r || !root.contains(r)) return;
      if (!fire(r, 'ui:select', { value: r.dataset.value, item: r }, true)) return;
      root.querySelectorAll('.ui-row[aria-current]').forEach((x) => x.removeAttribute('aria-current'));
      r.setAttribute('aria-current', 'true'); sync();
    });
  }

  /* ───────────── hold to approve (promoted from cards.js holdController) ─────────────
     Pointer: press and hold. Keyboard: hold Space, or press Enter twice (the first press arms it; a screen
     reader's single activation works the same way). The fill gathers as an ordered dot field (Bayer 4x4 on a
     3px grid) whose leading edge thins out; behind the edge the dots fuse into the solid bone fill. Released
     early, it drains back. data-fill="solid" drops the dots. Fires 'ui:commit' (cancelable: preventDefault
     keeps the button armed for the host). States on data-state: idle, holding, done. */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const HOLDS = new Set();
  const refreshHolds = () => { for (const c of HOLDS) if (c.btn.isConnected) c.refresh(); else HOLDS.delete(c); };
  if (typeof HX.on === 'function') HX.on('hx:theme', refreshHolds);
  window.addEventListener('hx:theme', refreshHolds);
  function wireHold(btn, o) {
    if (btn._hold) return btn._hold;
    const fx = btn.querySelector('canvas'), solid = btn.querySelector('.ui-hold__solid');
    const labels = btn.querySelectorAll('.ui-hold__label'), on = btn.querySelector('.ui-hold__label--on');
    const ctx = fx.getContext('2d');
    const DUR = +(o.ms || btn.dataset.ms) || tokenMs('--dur-hold', 1000);
    const dots = (o.fill || btn.dataset.fill) !== 'solid';
    const LABEL = labels[0].textContent;
    const say = o.announce || ui.announce;
    let p = 0, mode = 'idle', raf = 0, t0 = 0, p0 = 0, W = 0, H = 0, dpr = 1, color = '', hintT = 0, startedAt = 0, armedT = 0, armed = false;
    const ease = (x) => 1 - Math.pow(1 - x, 1.2);
    function size() {
      const r = btn.getBoundingClientRect();
      W = r.width; H = r.height; dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
      color = getComputedStyle(solid).backgroundColor;
    }
    function draw() {
      /* at rest nothing is filled, whatever the button's size (a hidden button measures 0 wide) */
      if (p <= 0) { solid.style.clipPath = on.style.clipPath = 'inset(0 100% 0 0)'; if (W && H) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fx.width, fx.height); } return; }
      if (!W) size();
      if (!W) { const c = 'inset(0 ' + ((1 - ease(p)) * 100).toFixed(2) + '% 0 0)'; solid.style.clipPath = on.style.clipPath = c; return; }
      const e = ease(p), fr = dots ? Math.min(28, W * 0.22) : 0, P = e * (W + fr), sw = Math.max(0, Math.min(W, P - fr));
      const clip = 'inset(0 ' + (W - sw).toFixed(2) + 'px 0 0)';
      solid.style.clipPath = clip; on.style.clipPath = clip;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (!dots || p <= 0 || p >= 1) return;
      ctx.fillStyle = color;
      const cell = 3, rows = Math.ceil(H / cell), c0 = Math.max(0, Math.floor(sw / cell)), c1 = Math.min(Math.ceil(W / cell), Math.ceil(P / cell)), round = dpr >= 2;
      for (let col = c0; col <= c1; col++) {
        const x = col * cell, v = (P - (x + 1)) / fr;
        if (v <= 0) continue;
        for (let row = 0; row < rows; row++) {
          if (v > (BAYER[((row & 3) << 2) | (col & 3)] + 0.5) / 16) { const y = row * cell; if (round) { ctx.beginPath(); ctx.arc(x + 1, y + 1, 1, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(x, y, 2, 2); }
        }
      }
    }
    function frame(now) {
      raf = 0;
      if (mode === 'hold') { p = Math.min(1, p0 + (now - t0) / DUR); if (p >= 1) return finish(); }
      else if (mode === 'drain') { p = Math.max(0, p0 - (now - t0) / (reduced() ? 1 : 280)); if (p <= 0) { mode = 'idle'; btn.dataset.state = 'idle'; } }
      draw();
      if (mode === 'hold' || mode === 'drain') raf = requestAnimationFrame(frame);
    }
    const disabled = () => btn.disabled || btn.getAttribute('aria-disabled') === 'true';
    function start() {
      if (mode === 'done' || mode === 'hold' || disabled()) return;
      size(); mode = 'hold'; t0 = startedAt = performance.now(); p0 = p;
      setLabel(LABEL); btn.dataset.state = 'holding';
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function release(kbd) {
      if (mode !== 'hold') return;
      const quick = performance.now() - startedAt < 240;
      mode = 'drain'; t0 = performance.now(); p0 = p;
      if (quick && !kbd) hint('Keep holding');
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function finish() {
      mode = 'done'; p = 1; draw();
      solid.style.clipPath = 'inset(0 0 0 0)'; on.style.clipPath = 'inset(0 0 0 0)';
      setLabel(o.doneLabel || 'Approved'); btn.dataset.state = 'done'; btn.removeAttribute('data-armed');
      setTimeout(() => { if (!fire(btn, 'ui:commit', {}, true)) ctl.reset(); }, reduced() ? 60 : 240);
    }
    function setLabel(t) { for (const l of labels) l.textContent = t; }
    function hint(t) {
      clearTimeout(hintT); setLabel(t); say('Keep holding to approve');
      hintT = setTimeout(() => { if (mode !== 'done') setLabel(LABEL); }, 1400);
    }
    function confirmPress() {
      if (mode === 'done' || disabled()) return;
      clearTimeout(hintT);
      if (armed) { armed = false; clearTimeout(armedT); btn.removeAttribute('data-armed'); size(); return finish(); }
      armed = true; btn.setAttribute('data-armed', '');
      setLabel('Press again to approve');
      say('Press again to approve, or hold the space bar');
      armedT = setTimeout(() => { armed = false; btn.removeAttribute('data-armed'); if (mode !== 'done') setLabel(LABEL); }, 4000);
    }
    const isSpace = (e) => e.key === ' ' || e.code === 'Space';
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (document.activeElement !== btn) btn.focus({ preventScroll: true, focusVisible: false });
      try { btn.setPointerCapture(e.pointerId); } catch (_) { /* best effort */ }
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
    const ctl = {
      btn,
      refresh() { size(); draw(); },
      show(v) { size(); p = Math.max(0, Math.min(0.99, v)); mode = 'idle'; btn.dataset.state = p > 0 ? 'holding' : 'idle'; draw(); },
      reset() { if (raf) cancelAnimationFrame(raf); raf = 0; mode = 'idle'; p = 0; btn.dataset.state = 'idle'; setLabel(LABEL); draw(); },
      get progress() { return p; }
    };
    btn._hold = ctl; HOLDS.add(ctl);
    return ctl;
  }

  /* ───────────── menus and popovers: one open at a time, placed against an anchor ───────────── */
  let openLayer = null;
  function place(node, anchor, o) {
    const r = anchor.getBoundingClientRect(), w = node.offsetWidth, h = node.offsetHeight, gap = 8;
    const fitsBelow = r.bottom + h + gap <= innerHeight - 8, fitsAbove = r.top - h - gap >= 8;
    const above = o.place === 'above' ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    let x = o.align === 'end' ? r.right - w : o.align === 'center' ? r.left + r.width / 2 - w / 2 : r.left - (o.inset == null ? 8 : o.inset);
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    node.style.left = x + 'px';
    node.style.top = Math.max(8, above ? r.top - h - gap : r.bottom + gap) + 'px';
    node.dataset.place = above ? 'above' : 'below';
  }
  function closeLayer(returnFocus) {
    if (!openLayer) return;
    const L = openLayer; openLayer = null;
    L.node.classList.remove('is-in');
    setTimeout(() => L.node.remove(), reduced() ? 0 : 160);
    if (L.anchor) L.anchor.setAttribute('aria-expanded', 'false');
    L.off();
    if (returnFocus !== false && L.anchor && L.anchor.isConnected) L.anchor.focus({ preventScroll: true });
    if (L.onClose) L.onClose();
  }
  function openLayerAt(anchor, node, o) {
    if (openLayer && openLayer.anchor === anchor) { closeLayer(); return null; }
    closeLayer(false);
    (o.layer || document.getElementById('hx-app') || document.body).appendChild(node);
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    place(node, anchor, o);
    requestAnimationFrame(() => node.classList.add('is-in'));
    const outside = (e) => { if (!node.contains(e.target) && !(anchor && anchor.contains(e.target))) closeLayer(false); };
    const onResize = () => closeLayer(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', onResize);
    openLayer = { node, anchor, onClose: o.onClose, off() { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', onResize); } };
    return node;
  }
  document.addEventListener('keydown', (e) => {
    if (!openLayer) return;
    const node = openLayer.node;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayer(); return; }
    if (node.classList.contains('ui-menu')) {
      const items = [...node.querySelectorAll('.ui-menu__item:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      const n = { ArrowDown: i + 1, ArrowUp: i < 0 ? items.length - 1 : i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (n != null && items.length) { e.preventDefault(); items[(n + items.length) % items.length].focus(); return; }
      if (e.key === 'Tab') { closeLayer(false); return; }
      if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        const k = e.key.toLowerCase(), start = i + 1;
        const hit = items.slice(start).concat(items.slice(0, start)).find((x) => x.textContent.trim().toLowerCase().startsWith(k));
        if (hit) hit.focus();
      }
    } else if (e.key === 'Tab') {
      const f = [...node.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"], textarea, select')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);
  /* HX.ui.menu.open(anchor, items, {label, place: 'above'|'below', align: 'start'|'end', multi, onSelect, layer}) */
  ui.menu = {
    open(anchor, items, o) {
      o = o || {};
      const node = frag('<div class="ui-menu" role="menu"' + attrs({ 'aria-label': o.label }) + '>' + html.menuItems(items, o) + '</div>');
      if (!openLayerAt(anchor, node, o)) return null;
      node.addEventListener('click', (e) => {
        const it = e.target.closest('.ui-menu__item'); if (!it || it.disabled) return;
        const value = it.dataset.value, item = items.find((x) => x && (x.value != null ? String(x.value) : x.label) === value);
        if (!fire(node, 'ui:select', { value, item }, true)) return;
        if (o.onSelect) o.onSelect(value, item);
        if (!o.multi) closeLayer(); else { const c = it.getAttribute('aria-checked') !== 'true'; it.setAttribute('aria-checked', String(c)); it.querySelector('.ui-menu__glyph').innerHTML = c ? ui.icon('check') : ''; }
      });
      const first = node.querySelector('.ui-menu__item[aria-checked="true"]') || node.querySelector('.ui-menu__item:not(:disabled)');
      if (first) first.focus({ preventScroll: true });
      return node;
    },
    close: closeLayer,
    /* a menu drawn in place (specimens, documentation): no anchor, no positioning */
    still(items, o) { const n = frag('<div class="ui-menu" role="menu" data-static' + attrs({ 'aria-label': (o || {}).label }) + '>' + html.menuItems(items, o) + '</div>'); return n; }
  };
  /* HX.ui.popover.open(anchor, contentNode, {label, place, align, onClose}) -> a dialog-like layer with a focus loop */
  ui.popover = {
    open(anchor, content, o) {
      o = o || {};
      const node = frag('<div class="ui-pop" role="dialog"' + attrs({ 'aria-label': o.label }) + '></div>');
      node.appendChild(content);
      if (!openLayerAt(anchor, node, o)) return null;
      const f = node.querySelector('[data-autofocus]') || node.querySelector('button, input, textarea, select, [tabindex="0"]');
      if (f) f.focus({ preventScroll: true });
      return node;
    },
    close: closeLayer,
    get current() { return openLayer && openLayer.node; }
  };
  /* HX.ui.layer: the same one-at-a-time layer for a node that brings its own surface (the card layer's blank
     popover): placed against its anchor, closed by Esc or an outside press, focus returned to the anchor. */
  ui.layer = {
    open: (anchor, node, o) => openLayerAt(anchor, node, o || {}),
    close: closeLayer,
    place: (node, anchor, o) => place(node, anchor, o || {})
  };

  /* ───────────── tooltip: delegated on [data-tip] (+ data-kbd, data-tip-pos), one element for the app ─────────────
     480ms before the first, none while warm (700ms after the last), at once on keyboard focus. It repeats the
     button's aria-label for sight, so it is hidden from assistive tech; shortcuts go in aria-keyshortcuts. */
  ui.tooltip = (function () {
    let node = null, timer = 0, warm = 0, cur = null, on = false;
    const host = () => document.getElementById('hx-app') || document.body;
    function show(t, now) {
      clearTimeout(timer);
      const label = t.getAttribute('data-tip'); if (!label) return;
      timer = setTimeout(() => {
        if (!t.isConnected || t.closest('[inert]')) return;
        if (!node || !node.isConnected) { node = document.createElement('div'); node.className = 'ui-tip'; node.setAttribute('aria-hidden', 'true'); host().appendChild(node); }
        cur = t;
        const state = t.getAttribute('data-tip-state');
        node.innerHTML = '<span>' + esc(label) + '</span>' + (state ? '<span class="ui-tip__state"' + (t.getAttribute('data-tip-tone') ? ' data-tone="' + esc(t.getAttribute('data-tip-tone')) + '"' : '') + '>' + esc(state) + '</span>' : '') + (t.getAttribute('data-kbd') ? html.keys(t.getAttribute('data-kbd')) : '');
        const r = t.getBoundingClientRect(), w = node.offsetWidth, h = node.offsetHeight;
        const pos = t.getAttribute('data-tip-pos') || (r.top > innerHeight - 160 ? 'top' : 'bottom');
        let x, y;
        if (pos === 'right') { x = r.right + 10; y = r.top + r.height / 2 - h / 2; node.style.setProperty('--tip-dy', '0px'); }
        else if (pos === 'top') { x = r.left + r.width / 2 - w / 2; y = r.top - h - 8; node.style.setProperty('--tip-dy', '3px'); }
        else { x = r.left + r.width / 2 - w / 2; y = r.bottom + 8; node.style.setProperty('--tip-dy', '-3px'); }
        node.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'; node.style.top = Math.max(8, y) + 'px';
        requestAnimationFrame(() => node && node.classList.add('is-in'));
      }, now || performance.now() < warm ? 0 : 480);
    }
    function hide() { clearTimeout(timer); if (cur) warm = performance.now() + 700; cur = null; if (node) node.classList.remove('is-in'); }
    function enable() {
      if (on) return; on = true;
      document.addEventListener('pointerover', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t || t === cur || e.pointerType === 'touch') return; show(t, false); });
      document.addEventListener('pointerout', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) hide(); });
      document.addEventListener('focusin', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && t.matches(':focus-visible')) show(t, true); else hide(); });
      document.addEventListener('focusout', hide);
      document.addEventListener('pointerdown', hide, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    }
    return { enable, show: (t) => show(t, true), hide, refresh: (t) => { if (cur === t) show(t, true); } };
  })();
  /* the shell owns [data-tip] inside #hx-app until it migrates; elsewhere the library answers */
  if (!document.getElementById('hx-tip')) ui.tooltip.enable();

  /* ───────────── toast: one line at the top of the work, with an optional action ───────────── */
  let toastNode = null, toastTimer = 0;
  ui.toast = function (text, o) {
    o = o || {};
    if (!toastNode || !toastNode.isConnected) { toastNode = document.createElement('div'); toastNode.className = 'ui-toast'; toastNode.setAttribute('role', 'status'); toastNode.setAttribute('aria-live', 'polite'); (document.getElementById('hx-app') || document.body).appendChild(toastNode); }
    toastNode.innerHTML = '<span>' + esc(text) + '</span>' + (o.action ? html.button({ label: o.action.label, size: 's', variant: 'ghost' }) : '');
    const b = toastNode.querySelector('button');
    if (b) b.addEventListener('click', () => { o.action.onClick && o.action.onClick(); hideToast(); });
    requestAnimationFrame(() => toastNode.classList.add('is-in'));
    clearTimeout(toastTimer);
    const ms = o.ms || (o.action ? 6000 : 3000);
    const arm = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, ms); };
    toastNode.onpointerenter = () => clearTimeout(toastTimer); toastNode.onpointerleave = arm;
    toastNode.onfocusin = () => clearTimeout(toastTimer); toastNode.onfocusout = arm;
    arm();
    return toastNode;
  };
  function hideToast() { if (toastNode) toastNode.classList.remove('is-in'); }
  ui.toast.hide = hideToast;
  html.toast = (text, action) => '<div class="ui-toast" role="status" data-static><span>' + esc(text) + '</span>' + (action ? html.button({ label: action, size: 's', variant: 'ghost' }) : '') + '</div>';
  html.tip = (label, keys, state) => '<div class="ui-tip" data-static><span>' + esc(label) + '</span>' + (state ? '<span class="ui-tip__state"' + (state.tone ? ' data-tone="' + state.tone + '"' : '') + '>' + esc(state.text) + '</span>' : '') + html.keys(keys) + '</div>';

  /* ───────────── composer: card stock, the toolbar inside, nothing below ─────────────
     The canonical composer (from the session module; bots and any other module reuse it).
     HX.ui.composer({placeholder, value, label, chips: [chip opts | HTMLElement], spend: {spent, cap}, attach,
       bot: bot | id, orbs: () => [orbAvatar], compact, hint: (text) => string | [{label, value, kind, text}],
       feedforward: (text) => [{text, kind, confirmed}], maxHeight})
     -> element with .value, .setValue(t), .focus(), .setRunning(bool), .setSpend(spent, cap), .setHint(text|items),
        .refresh(), .addFile(name), .setListening(bool), .listening, .chips (the slot modules put their chips in),
        .input, .attach, .mic
     Layout: full (text, then the bar) or compact (one row: text and the actions group), chosen by `compact`, else
     compact when the composer has nothing but text (no attach, chips, spend or hint). The actions group (mic, send)
     sits in the box's corner, concentric with it.
     The mic (owner rule: every composer can talk; `mic: false` is ignored). A click toggles listening; pressing and
     holding it (400ms or more) talks while held. With a target `bot`, the mic says "Talk to nina", the bot's orbs
     (every .ui-orb[data-bot] of it, plus `orbs()`) take orb2's "listening" reaction while you talk and the mic shows
     the bot's own small orb listening; the placeholder says "nina is listening". Fires 'ui:dictate'
     {value, bot, mode: 'toggle'|'hold'}; the audio itself is the host's.
     Keys (KEYMAP §7): Enter sends, Shift+Enter breaks the line, mod+Enter sends from anywhere in the composer,
     Up on an empty composer asks for the last message ('ui:edit-last'), Tab moves into the assumptions row when it
     shows (Left/Right between them, Enter or Space opens one: 'ui:assumption', Delete drops it:
     'ui:assumption-drop', Shift+Tab or Esc back to the text), Alt+Down on a dashed word opens it ('ui:decision'),
     Alt+A attaches, Alt+V talks (a tap toggles, a hold talks while held), Esc while listening stops listening.
     Stop is mod+. (the shell's provider) or the stop button; otherwise Esc belongs to the shell (and the dock).
     Region markers: the root carries data-hx-composer, the text field data-hx-focus="composer". */
  ui.composer = function (o) {
    o = Object.assign({ placeholder: 'Describe the change', label: 'Message', attach: true, chips: [], value: '' }, o || {});
    const botOf = (x) => (typeof x === 'string' ? ((window.HX_DATA && window.HX_DATA.bots) || []).find((b) => b.id === x) || null : (x || null));
    let bot = botOf(o.bot);
    const compact = o.compact != null ? !!o.compact : !(o.attach || (o.chips && o.chips.length) || o.spend || o.hint);
    const micLabelOf = () => (bot ? 'Talk to ' + bot.name : 'Dictate');
    const micLabel = micLabelOf();
    const attachHTML = o.attach ? html.iconButton({ icon: 'plus', label: 'Attach files, folders or a teammate', tip: 'Attach', keys: 'alt+A', haspopup: 'menu', expanded: false, class: 'ui-composer__attach' }) : '';
    const acts = '<span class="ui-composer__acts">' + (compact ? attachHTML : '') +
      html.iconButton({ icon: 'mic', label: micLabel, keys: 'alt+V', pressed: false, class: 'ui-composer__mic' }) + html.send({ disabled: true }) + '</span>';
    const root = frag('<div class="ui-composer" data-ui="composer" data-hx-composer' + (compact ? ' data-compact' : '') + '>' +
      (o.hint ? '<div class="ui-composer__hint" role="group" aria-label="Will assume"></div>' : '') +
      '<div class="ui-composer__box"><div class="ui-composer__files"></div>' +
      '<div class="ui-composer__input" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" data-hx-focus="composer"' + attrs({ 'aria-label': o.label, 'data-placeholder': o.placeholder, 'aria-description': o.feedforward ? 'Dashed words are a reading of your request. Alt and down arrow on one changes it; Tab reaches the assumptions.' : null }) + '></div>' +
      '<div class="ui-composer__bar">' + (compact ? '' : attachHTML) +
      '<span class="ui-composer__chips"></span><span class="ui-composer__spacer"></span>' + (o.spend ? html.capacity(o.spend.spent, o.spend.cap) : '') +
      acts + '</div></div></div>');
    const box = root.querySelector('.ui-composer__box'), input = root.querySelector('.ui-composer__input'), send = root.querySelector('.ui-send');
    const chipsEl = root.querySelector('.ui-composer__chips'), hintEl = root.querySelector('.ui-composer__hint'), files = root.querySelector('.ui-composer__files');
    for (const c of o.chips) chipsEl.appendChild(c instanceof Element ? c : ui.chip(c));
    hydrateOne(root);
    let running = false, typingT = 0, typed = false, items = [];
    const text = () => input.textContent.replace(/ /g, ' ');
    function caret() {
      const s = getSelection(); if (!s.rangeCount || !input.contains(s.anchorNode)) return null;
      const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(input); r.setEnd(s.anchorNode, s.anchorOffset); return r.toString().length;
    }
    function setCaret(off) {
      if (off == null) return;
      const w = document.createTreeWalker(input, NodeFilter.SHOW_TEXT); let n, left = off;
      while ((n = w.nextNode())) { if (left <= n.length) { const r = document.createRange(); r.setStart(n, left); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } left -= n.length; }
      const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    /* the hint: a sentence, or the assumptions as a row of quiet buttons ("Will assume: >refactor, >src/billing") */
    function paintHint(h) {
      if (!hintEl) return;
      items = Array.isArray(h) ? h : [];
      if (Array.isArray(h)) {
        hintEl.innerHTML = h.length ? '<span class="ui-composer__hint-label">Will assume:</span>' + h.map((x, i) => '<button type="button" class="ui-assume" tabindex="-1" data-i="' + i + '">' + esc(x.label) + '</button>').join('<span aria-hidden="true">,</span>') : '';
      } else hintEl.textContent = h || '';
      syncHint();
    }
    const hasHint = () => !!(hintEl && hintEl.textContent.trim());
    function syncHint() { root.toggleAttribute('data-hinting', hasHint() && (root.contains(document.activeElement) && (typed || hintEl.contains(document.activeElement)) || root.hasAttribute('data-hint-flash'))); }
    function render(keepCaret) {
      const t = text(), off = keepCaret ? caret() : null;
      if (o.feedforward) {
        const marks = t ? (o.feedforward(t) || []).map((m) => Object.assign({ at: t.indexOf(m.text) }, m)).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at) : [];
        let out = '', i = 0;
        for (const m of marks) { if (m.at < i) continue; out += esc(t.slice(i, m.at)) + '<span class="ui-ff" data-kind="' + esc(m.kind || '') + '"' + (m.confirmed ? ' data-confirmed' : '') + '>' + esc(m.text) + '</span>'; i = m.at + m.text.length; }
        out += esc(t.slice(i));
        if (input.innerHTML !== out) { input.innerHTML = out; if (off != null) setCaret(off); }
      }
      input.dataset.empty = String(!t);
      send.disabled = !running && !t.trim();
      if (o.hint) paintHint(o.hint(t));
    }
    const assumeBtns = () => (hintEl ? [...hintEl.querySelectorAll('.ui-assume')] : []);
    input.addEventListener('input', () => { typed = true; clearTimeout(typingT); typingT = setTimeout(() => render(true), 250); input.dataset.empty = String(!text()); send.disabled = !running && !text().trim(); });
    root.addEventListener('focusin', syncHint);
    root.addEventListener('focusout', () => setTimeout(() => { if (!root.contains(document.activeElement)) typed = false; syncHint(); }, 0));
    input.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
    root.addEventListener('keydown', (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === 'Enter' && mod && !e.altKey) { e.preventDefault(); doSend(); return; }
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyA' && api.attach) { e.preventDefault(); api.attach.click(); return; }
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyV') { e.preventDefault(); if (!e.repeat) talkKey(); return; }
      if (e.key === 'Escape' && listening) { e.preventDefault(); e.stopPropagation(); setListening(false); return; }
      const ab = assumeBtns(), ai = ab.indexOf(document.activeElement);
      if (ai >= 0) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = ab[(ai + (e.key === 'ArrowRight' ? 1 : -1) + ab.length) % ab.length]; ab.forEach((b) => { b.tabIndex = b === n ? 0 : -1; }); n.focus(); return; }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(root, 'ui:assumption', { index: ai, item: items[ai], el: ab[ai] }); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); fire(root, 'ui:assumption-drop', { index: ai, item: items[ai] }); render(false); requestAnimationFrame(() => { const b = assumeBtns(); (b[Math.min(ai, b.length - 1)] || input).focus(); }); return; }
        if (e.key === 'Escape' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); api.focus(); return; }
        if (e.key === 'Tab') { ab.forEach((b) => { b.tabIndex = -1; }); return; }
      }
    });
    input.addEventListener('keydown', (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing) { e.preventDefault(); doSend(); return; }
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !mod && !text().trim() && !caret()) { if (!fire(root, 'ui:edit-last', {}, true)) e.preventDefault(); return; }
      if (e.key === 'Tab' && !e.shiftKey && hasHint() && root.hasAttribute('data-hinting')) { const ab = assumeBtns(); if (ab.length) { e.preventDefault(); ab.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; }); ab[0].focus(); return; } }
      if (e.key === 'ArrowDown' && e.altKey) {
        const s = getSelection(); const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
        const m = n && n.closest('.ui-ff'); if (m) { e.preventDefault(); e.stopPropagation(); fire(root, 'ui:decision', { kind: m.dataset.kind, text: m.textContent, el: m }); }
      }
    });
    if (hintEl) hintEl.addEventListener('click', (e) => { const b = e.target.closest('.ui-assume'); if (b) fire(root, 'ui:assumption', { index: +b.dataset.i, item: items[+b.dataset.i], el: b }); });
    input.addEventListener('click', (e) => { const m = e.target.closest('.ui-ff'); if (m && getSelection().isCollapsed) fire(root, 'ui:decision', { kind: m.dataset.kind, text: m.textContent, el: m }); });
    box.addEventListener('pointerdown', (e) => { if (e.target === box) { e.preventDefault(); api.focus(); } });
    send.addEventListener('click', () => (running ? fire(root, 'ui:stop', {}) : doSend()));
    /* the mic: a click toggles; a press held 400ms or more talks while held; Alt+V the same from the keyboard */
    const mic = root.querySelector('.ui-composer__mic');
    const HOLD_TALK = 400;
    let listening = false, listenMode = null, pressAt = 0, pressStarted = false, keyAt = 0, placeholderWas = null;
    const prevReaction = new Map();
    function botOrbs() {
      const out = [];
      if (bot && bot.id) { const id = String(bot.id).replace(/["\\]/g, ''); for (const el of document.querySelectorAll('.ui-orb[data-bot="' + id + '"] > orb-avatar, orb-avatar[data-bot="' + id + '"]')) out.push(el); }
      if (o.orbs) { try { for (const el of [].concat(o.orbs() || [])) if (el && !out.includes(el)) out.push(el); } catch (err) { /* a getter that throws is ignored */ } }
      return out;
    }
    function setListening(v, mode) {
      v = !!v;
      if (v === listening) { if (v && mode) listenMode = mode; return; }
      listening = v; listenMode = v ? (mode || 'toggle') : null;
      root.toggleAttribute('data-listening', v);
      mic.setAttribute('aria-pressed', String(v));
      mic.setAttribute('aria-label', v ? 'Stop listening' : micLabelOf());
      mic.setAttribute('data-tip', v ? 'Stop listening' : micLabelOf());
      if (v) { placeholderWas = input.getAttribute('data-placeholder'); input.setAttribute('data-placeholder', bot ? bot.name + ' is listening' : 'Listening'); }
      else if (input.getAttribute('data-placeholder') === (bot ? bot.name + ' is listening' : 'Listening')) input.setAttribute('data-placeholder', placeholderWas != null ? placeholderWas : (o.placeholder || ''));
      if (v && bot && !mic.querySelector('.ui-orb')) mic.insertAdjacentHTML('beforeend', html.orb(bot, { size: 18, live: true }));
      const own = mic.querySelector('orb-avatar');
      if (v) {
        for (const el of botOrbs().concat(own ? [own] : [])) { if (!prevReaction.has(el)) prevReaction.set(el, el.getAttribute('reaction')); el.setAttribute('reaction', 'listening'); }
      } else {
        /* give each orb back its reaction, unless something else changed it meanwhile */
        for (const [el, r] of prevReaction) if (el.getAttribute('reaction') === 'listening') { if (r == null) el.removeAttribute('reaction'); else el.setAttribute('reaction', r); }
        prevReaction.clear();
      }
      ui.announce(v ? (bot ? bot.name + ' is listening' : 'Listening') : 'Stopped listening');
      fire(root, 'ui:dictate', { value: v, bot: bot ? bot.id : null, mode: v ? listenMode : null });
    }
    function talkKey() {
      if (listening) { setListening(false); keyAt = 0; return; }
      setListening(true, 'hold'); keyAt = performance.now();
      const up = (e) => {
        if (e.code !== 'KeyV') return;
        removeEventListener('keyup', up, true);
        if (keyAt && performance.now() - keyAt >= HOLD_TALK) setListening(false); else if (listening) listenMode = 'toggle';
        keyAt = 0;
      };
      addEventListener('keyup', up, true);
    }
    mic.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();   /* the text keeps focus: you can talk and type */
      pressAt = performance.now(); pressStarted = !listening;
      if (pressStarted) setListening(true, 'hold');
    });
    const release = () => {
      if (!pressAt) return;
      const held = performance.now() - pressAt >= HOLD_TALK;
      if (!pressStarted || held) setListening(false); else listenMode = 'toggle';
      pressAt = 0;
    };
    mic.addEventListener('pointerup', release);
    mic.addEventListener('pointercancel', release);
    mic.addEventListener('click', (e) => { if (e.detail === 0) setListening(!listening, 'toggle'); });   /* Enter or Space on the focused mic */
    function doSend() { const t = text().trim(); if (!t || running) return; if (fire(root, 'ui:send', { text: t }, true)) { typed = false; api.setValue(''); if (listening) setListening(false); } }
    const api = root;
    Object.defineProperty(api, 'value', { get: text });
    api.setValue = (t) => { input.textContent = t || ''; render(false); };
    api.refresh = () => render(true);
    api.insert = (t) => { api.focus(); document.execCommand('insertText', false, t); };
    api.focus = () => { input.focus(); setCaret(text().length); };
    api.flashHint = (ms) => { root.setAttribute('data-hint-flash', ''); syncHint(); clearTimeout(api._flash); api._flash = setTimeout(() => { root.removeAttribute('data-hint-flash'); syncHint(); }, ms || 2600); };
    api.input = input;
    api.chips = chipsEl;
    api.attach = root.querySelector('.ui-composer__attach');
    api.mic = mic;
    api.setListening = (v) => setListening(v, 'toggle');
    /* a composer reused across bots (the Bots tab) follows the selected one */
    api.setBot = (b) => {
      if (listening) setListening(false);
      bot = botOf(b);
      const own = mic.querySelector('.ui-orb'); if (own) own.remove();
      mic.setAttribute('aria-label', micLabelOf()); mic.setAttribute('data-tip', micLabelOf());
    };
    Object.defineProperty(api, 'listening', { get: () => listening });
    api.addFile = (name) => { const f = frag('<span class="ui-file">' + ui.icon('file') + '<span>' + esc(name) + '</span>' + html.iconButton({ icon: 'close', label: 'Remove ' + name, size: 's', tip: false }) + '</span>'); f.querySelector('button').addEventListener('click', () => { f.remove(); input.focus(); }); files.appendChild(f); };
    api.setRunning = (v) => { running = !!v; const s = frag(html.send({ running })); send.replaceChildren(...s.childNodes); for (const a of ['aria-label', 'data-tip', 'data-kbd', 'aria-keyshortcuts']) { if (s.hasAttribute(a)) send.setAttribute(a, s.getAttribute(a)); else send.removeAttribute(a); } send.disabled = !running && !text().trim(); };
    api.setSpend = (spent, cap) => { const c = root.querySelector('.ui-capacity'); if (c) c.outerHTML = cap ? html.capacity(spent, cap) : '<span class="ui-capacity" aria-label="' + esc(spent + ' spent') + '"><b>' + esc(spent) + '</b></span>'; };
    api.setHint = (h) => paintHint(h);
    api.setValue(o.value);
    return api;
  };

  /* ───────────── cards: the card layer (cards.js) is the canonical card implementation ─────────────
     HX.ui.card(kind, data, opts) creates an <hx-card>: approval, ship, blank, teammate, escalation, error,
     schedule, connector; sizes inline, compact, mini (blank also popover); opts.ground 'dock' inside the dock. */
  ui.card = function (kind, data, opts) {
    if (!HX.cards || typeof HX.cards.create !== 'function') throw new Error('HX.ui.card needs the card layer (cards.js) loaded');
    return HX.cards.create(kind, data, opts);
  };
})();
