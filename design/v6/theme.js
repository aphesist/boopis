/* hypotaxis v6 · theme runtime and customizer (owner: wireframe agent)
   Loaded before the app markup so a saved theme applies before the first paint.
   A theme = a preset (a block of tokens in tokens.css, chosen with data-hx-preset on <html>) + the user's overrides
   (solid colours, interface and code fonts, interface case, corners, density). Overrides are written as inline
   custom properties on <html>; translucent tokens derive from the solid ones in tokens.css. The dock's black
   (--dock-bg) is fixed and never offered. Saved in localStorage when it is available.
   API: window.HX_THEME = { get, set(patch), preset(id), reset(), exportJSON(), importJSON(text), scheme(),
   presets, mount(container) }. Emits 'hx:theme' (through HX when it exists, else on window). */
(function () {
  'use strict';
  const KEY = 'hx.v6.theme';
  const root = document.documentElement;
  const HEX = /^#[0-9a-f]{6}$/i;

  const PRESETS = {
    catalog:    { name: 'Card catalog', note: 'Warm dark, the default', sans: 'Libre Franklin', mono: 'IBM Plex Mono', case: 'sentence', corners: 'default', density: 'regular', logo: 'closed' },
    graphite:   { name: 'Graphite', note: 'Neutral grey, close to the Figma', sans: 'Geist', mono: 'Geist Mono', case: 'sentence', corners: 'default', density: 'regular', logo: 'closed' },
    bone:       { name: 'Bone', note: 'Light', sans: 'Libre Franklin', mono: 'IBM Plex Mono', case: 'sentence', corners: 'default', density: 'regular', logo: 'closed' },
    typewriter: { name: 'Typewriter', note: 'Mono and lowercase', sans: 'Geist Mono', mono: 'Geist Mono', case: 'lower', corners: 'round', density: 'regular', logo: 'closed' }
  };
  const MONO_STACK = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
  const SANS_STACK = '"Helvetica Neue", Arial, system-ui, sans-serif';
  const FONTS = {
    sans: [
      ['Libre Franklin', '"Libre Franklin", "Franklin Gothic", ' + SANS_STACK, 'Libre+Franklin:wght@400;500;600'],
      ['Geist', '"Geist", ' + SANS_STACK, 'Geist:wght@400;500;600'],
      ['IBM Plex Sans', '"IBM Plex Sans", ' + SANS_STACK, 'IBM+Plex+Sans:wght@400;500;600'],
      ['Instrument Sans', '"Instrument Sans", ' + SANS_STACK, 'Instrument+Sans:wght@400;500;600'],
      ['Public Sans', '"Public Sans", ' + SANS_STACK, 'Public+Sans:wght@400;500;600'],
      ['Geist Mono', '"Geist Mono", ' + MONO_STACK, 'Geist+Mono:wght@400;500;600'],
      ['IBM Plex Mono', '"IBM Plex Mono", ' + MONO_STACK, 'IBM+Plex+Mono:wght@400;500;600'],
      ['System', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', null]
    ],
    mono: [
      ['IBM Plex Mono', '"IBM Plex Mono", ' + MONO_STACK, 'IBM+Plex+Mono:wght@400;500'],
      ['Geist Mono', '"Geist Mono", ' + MONO_STACK, 'Geist+Mono:wght@400;500'],
      ['JetBrains Mono', '"JetBrains Mono", ' + MONO_STACK, 'JetBrains+Mono:wght@400;500'],
      ['Source Code Pro', '"Source Code Pro", ' + MONO_STACK, 'Source+Code+Pro:wght@400;500'],
      ['System', MONO_STACK, null]
    ]
  };
  const GROUPS = [
    ['Signal', [['--brass', 'Accent', 'You are here: focus, the current item, checked items'], ['--red', 'Attention', 'Dots and outlines when you are needed'], ['--red-text', 'Attention text', 'Stamps such as "waiting for you"']]],
    ['Surfaces', [['--bg-1', 'Frame', 'Title bar, sidebars, panels, menus'], ['--bg-2', 'Ground', 'Behind the conversation'], ['--bg-3', 'Raised', 'Your messages, the composer, tooltips'], ['--bg-0', 'Inset', 'Fields and cards in the conversation'], ['--bg-4', 'Pressed', ''], ['--chip', 'Code chips', '']]],
    ['Text', [['--text', 'Text', 'Lines and hover fills follow this colour'], ['--text-strong', 'Strong text', ''], ['--text-dim', 'Secondary text', ''], ['--text-quiet', 'Meta text', 'Times, costs, labels'], ['--text-faint', 'Faint', 'Decoration and disabled only']]],
    ['Icons', [['--icon', 'Icons', ''], ['--icon-quiet', 'Window controls', ''], ['--icon-off', 'Disabled icons', '']]],
    ['Selection', [['--selected', 'Selected fill', 'The selected tab, primary buttons'], ['--text-on-light', 'Text on the selected fill', '']]],
    ['Status', [['--ok', 'Success', ''], ['--warn', 'Warning', ''], ['--add', 'Added lines', ''], ['--del', 'Removed lines', '']]]
  ];
  const EDITABLE = GROUPS.flatMap(g => g[1].map(r => r[0]));
  const LABEL = Object.fromEntries(GROUPS.flatMap(g => g[1].map(r => [r[0], r[1]])));
  /* The pairs that must hold (DESIGN-SYSTEM.md 5.4). [fg, bg, min, label, scope]. 'a@b' is a translucent token laid
     over a solid one. scope 'dock' measures inside [data-ground="dock"] (the pitch-black dock, whose inks derive from
     the theme). The flag dot goes on the editable colours a failing pair is made of. */
  const PAIRS = [
    ['--text', '--bg-1', 4.5, 'Text on the frame'], ['--text', '--bg-2', 4.5, 'Text on the ground'], ['--text', '--bg-3', 4.5, 'Text on raised surfaces'], ['--text', '--bg-0', 4.5, 'Text on inset cards'],
    ['--text-dim', '--bg-1', 4.5, 'Secondary text on the frame'], ['--text-dim', '--bg-2', 4.5, 'Secondary text on the ground'], ['--text-dim', '--bg-3', 4.5, 'Secondary text on raised surfaces'],
    ['--text-quiet', '--bg-1', 4.5, 'Meta text on the frame'], ['--text-quiet', '--bg-2', 4.5, 'Meta text on the ground'], ['--text-quiet', '--bg-3', 4.5, 'Meta text on raised surfaces'], ['--text-quiet', '--bg-0', 4.5, 'Meta text on inset cards'],
    ['--text', '--current@--bg-1', 4.5, 'Text on a selected row'], ['--text-quiet', '--current@--bg-1', 4.5, 'Meta text on a selected row'],
    ['--text', '--chip', 4.5, 'Code in a chip'], ['--text-dim', '--bg-4', 4.5, 'Keys in a tooltip'],
    ['--text-on-light', '--selected', 4.5, 'Text on the selected fill'],
    ['--red-text', '--bg-2', 4.5, 'Attention text on the ground'], ['--red-text', '--bg-0', 4.5, 'Attention text on inset cards'], ['--red-text', '--bg-1', 4.5, 'Attention text on the frame'], ['--red-text', '--current@--bg-1', 4.5, 'Attention text on a selected row'],
    ['--add', '--bg-1', 4.5, 'Added-line count on the frame'], ['--del', '--bg-1', 4.5, 'Removed-line count on the frame'],
    ['--brass', '--bg-1', 3, 'Accent on the frame'], ['--brass', '--bg-2', 3, 'Accent on the ground'], ['--brass', '--bg-3', 3, 'Accent on raised surfaces'],
    ['--icon', '--bg-1', 3, 'Icons on the frame'], ['--icon-quiet', '--bg-1', 3, 'Window controls on the frame'],
    ['--red', '--bg-2', 3, 'Attention dots on the ground'], ['--red', '--bg-1', 3, 'Attention dots on the frame'],
    ['--line-field@--bg-0', '--bg-1', 3, 'Field outline against the frame'], ['--line-field@--bg-0', '--bg-0', 3, 'Field outline against the field'],
    ['--mark-off', '--bg-1', 3, 'Inactive marks on the frame'], ['--mark-off', '--bg-3', 3, 'Inactive marks on raised surfaces'],
    ['--text', '--bg-1', 4.5, 'Dock text on black', 'dock'], ['--text-quiet', '--bg-1', 4.5, 'Dock meta on black', 'dock'], ['--text-quiet', '--bg-3', 4.5, 'Meta on a card set into the dock', 'dock'],
    ['--red-text', '--bg-1', 4.5, 'Dock attention text on black', 'dock'], ['--brass', '--bg-1', 3, 'Dock accent on black', 'dock'],
    ['--mark-off', '--bg-1', 3, 'Dock inactive marks on black', 'dock']
  ];
  /* which editable colours a dock pair is made of: the dock's inks derive from text (the ground in light themes),
     the accent and the attention red; its black is fixed */
  const DOCK_BLAME = { '--text': ['--text', '--bg-2'], '--mark-off': ['--text', '--bg-2'], '--text-quiet': ['--text', '--bg-2'], '--red-text': ['--red'], '--brass': ['--brass'], '--bg-3': ['--text', '--bg-2'], '--bg-1': [] };
  const CASES = ['sentence', 'lower'], CORNERS = ['sharp', 'default', 'round'], DENSITIES = ['compact', 'regular', 'comfortable'], LOGOS = ['closed', 'open'];

  const blank = () => ({ preset: 'catalog', colors: {}, sans: null, mono: null, case: null, corners: null, density: null, logo: null });
  const fontOf = (kind, name) => FONTS[kind].find(f => f[0] === name) || null;
  function sanitize(t) {
    if (!t || typeof t !== 'object') return null;
    const d = blank();
    d.preset = PRESETS[t.preset] ? t.preset : 'catalog';
    const cols = t.colors && typeof t.colors === 'object' ? t.colors : {};
    for (const k of Object.keys(cols)) {
      const key = k.startsWith('--') ? k : '--' + k;
      if (EDITABLE.includes(key) && HEX.test(String(cols[k]))) d.colors[key] = String(cols[k]).toLowerCase();
    }
    if (fontOf('sans', t.sans)) d.sans = t.sans;
    if (fontOf('mono', t.mono)) d.mono = t.mono;
    if (CASES.includes(t.case)) d.case = t.case;
    if (CORNERS.includes(t.corners)) d.corners = t.corners;
    if (DENSITIES.includes(t.density)) d.density = t.density;
    if (LOGOS.includes(t.logo)) d.logo = t.logo;
    return d;
  }
  function load() { try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')) || blank(); } catch (e) { return blank(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch (e) { /* storage blocked: the theme still applies */ } }

  let theme = load();
  let applied = [];
  let ui = null;           // the customizer's container once Settings mounts it
  const loadedFonts = new Set(['Libre Franklin', 'IBM Plex Mono', 'System']);
  const eff = (k) => theme[k] || PRESETS[theme.preset][k];

  function ensureFont(f) {
    if (!f || !f[2] || loadedFonts.has(f[0])) return;
    loadedFonts.add(f[0]);
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + f[2] + '&display=swap';
    (document.head || root).appendChild(l);
  }

  /* colours as the browser resolves them. Chrome reports a color-mix() as color(srgb r g b / a) with channels from
     0 to 1, other colours as rgb(a) from 0 to 255; both are read here (Finding F6). */
  let probe = null, dockScope = null;
  function parseColor(css) {
    const ch = (v, scale) => (v == null || v === 'none' ? 0 : v.endsWith('%') ? parseFloat(v) / 100 * scale : parseFloat(v));   // scale: what 100% means
    const f = /color\(srgb\s+([^\s/)]+)\s+([^\s/)]+)\s+([^\s/)]+)(?:\s*\/\s*([^\s)]+))?\)/.exec(css);
    if (f) return [ch(f[1], 1) * 255, ch(f[2], 1) * 255, ch(f[3], 1) * 255, f[4] == null ? 1 : ch(f[4], 1)];
    const m = css.match(/-?[\d.]+(?:e[-+]?\d+)?%?/gi) || [];
    return [ch(m[0], 255), ch(m[1], 255), ch(m[2], 255), m[3] == null ? 1 : ch(m[3], 1)];
  }
  function rgbaOf(token, scope) {
    if (!probe) {
      probe = document.createElement('i');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
    }
    let host = document.body || root;
    if (scope === 'dock') {
      if (!dockScope) { dockScope = document.createElement('div'); dockScope.setAttribute('data-ground', 'dock'); dockScope.setAttribute('aria-hidden', 'true'); dockScope.style.cssText = probe.style.cssText; }
      host.appendChild(dockScope); host = dockScope;
    }
    host.appendChild(probe);
    probe.style.color = 'var(' + token + ')';
    const c = parseColor(getComputedStyle(probe).color).map((v, i) => (i < 3 ? Math.max(0, Math.min(255, v)) : Math.max(0, Math.min(1, v))));
    probe.remove();
    if (dockScope) dockScope.remove();
    return c;
  }
  const toHex = (c) => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  function hexOf(token, scope) { return toHex(rgbaOf(token, scope)); }
  /* a translucent token laid over a solid one ('--current@--bg-1'), as the eye sees it */
  function compositeOf(spec, scope) {
    const [top, under] = spec.split('@');
    if (!under) return hexOf(spec, scope);
    const t = rgbaOf(top, scope), b = rgbaOf(under, scope), a = t[3];
    return toHex([0, 1, 2].map(i => t[i] * a + b[i] * (1 - a)));
  }
  function lum(hex) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

  function emit(detail) {
    if (window.HX && typeof window.HX.emit === 'function') window.HX.emit('hx:theme', detail);
    else window.dispatchEvent(new CustomEvent('hx:theme', { detail }));
  }

  function apply(quiet) {
    root.setAttribute('data-hx-preset', theme.preset);
    root.setAttribute('data-hx-case', eff('case'));
    root.setAttribute('data-hx-corners', eff('corners'));
    root.setAttribute('data-hx-density', eff('density'));
    root.setAttribute('data-hx-logo', eff('logo'));
    for (const k of applied) root.style.removeProperty(k);
    applied = [];
    for (const [k, v] of Object.entries(theme.colors)) { root.style.setProperty(k, v); applied.push(k); }
    const sans = fontOf('sans', eff('sans')), mono = fontOf('mono', eff('mono'));
    if (theme.sans && sans) { root.style.setProperty('--sans', sans[1]); applied.push('--sans'); }
    if (theme.mono && mono) { root.style.setProperty('--mono', mono[1]); applied.push('--mono'); }
    ensureFont(sans); ensureFont(mono);
    const light = lum(hexOf('--bg-2')) > .4;
    root.style.setProperty('color-scheme', light ? 'light' : 'dark');
    if (light) root.setAttribute('data-hx-theme', 'light'); else root.removeAttribute('data-hx-theme');
    save();
    if (!quiet) emit({ preset: theme.preset, scheme: light ? 'light' : 'dark' });
    if (ui) refreshUI();
  }

  function exportObject() {
    const colors = {};
    for (const k of EDITABLE) colors[k] = hexOf(k);
    return { format: 'hypotaxis-theme', version: 1, preset: theme.preset, sans: eff('sans'), mono: eff('mono'), case: eff('case'), corners: eff('corners'), density: eff('density'), logo: eff('logo'), colors };
  }

  const API = {
    presets: PRESETS,
    get: () => JSON.parse(JSON.stringify(theme)),
    scheme: () => (root.getAttribute('data-hx-theme') === 'light' ? 'light' : 'dark'),
    set(patch) {
      if (patch && patch.colors) theme.colors = Object.assign({}, theme.colors, patch.colors);
      for (const k of ['sans', 'mono', 'case', 'corners', 'density', 'logo']) if (patch && k in patch) theme[k] = patch[k] === PRESETS[theme.preset][k] ? null : patch[k];
      apply();
    },
    preset(id) { if (!PRESETS[id]) return; theme = Object.assign(blank(), { preset: id }); apply(); },
    reset() { theme = Object.assign(blank(), { preset: theme.preset }); apply(); },
    exportJSON: () => JSON.stringify(exportObject(), null, 2),
    importJSON(text) {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { throw new Error('The text is not valid JSON.'); }
      if (!obj || obj.format !== 'hypotaxis-theme') throw new Error('This JSON is not a hypotaxis theme (it needs "format": "hypotaxis-theme").');
      const t = sanitize(obj);
      // keep only the colours that differ from the preset, so the preset stays meaningful
      const base = Object.assign(blank(), { preset: t.preset });
      theme = base; apply(true);
      const colors = {};
      for (const [k, v] of Object.entries(t.colors)) if (v !== hexOf(k)) colors[k] = v;
      theme = Object.assign(t, { colors });
      for (const k of ['sans', 'mono', 'case', 'corners', 'density', 'logo']) if (theme[k] === PRESETS[theme.preset][k]) theme[k] = null;
      apply();
    },
    mount(container) { mountUI(container); },
    contrast() { return PAIRS.map(([fg, bg, min, label, scope]) => { const r = ratio(compositeOf(fg, scope), compositeOf(bg, scope)); return { label, fg, bg, scope: scope || 'app', min, ratio: Math.round(r * 100) / 100, pass: r >= min - 0.005 }; }); },
    parseColor
  };
  window.HX_THEME = API;
  apply(true);

  /* ───────────── customizer UI ───────────── */
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idOf = (token) => 'hxt-' + token.slice(2);

  const L = () => window.HX && window.HX.ui;
  /* a radio segmented control (HX.ui.html.segmented) named for the change handler and labelled by its row */
  function segHTML(name, options, cls) {
    return L().html.segmented({ mode: 'radio', size: 's', options, class: cls }).replace(' data-ui="seg"', ' data-ui="seg" data-name="' + name + '" aria-labelledby="' + name + '-l"');
  }
  function choice(name, label, options, labels) {
    return '<div class="ui-set__row"><span class="ui-set__label" id="' + name + '-l"><span>' + esc(label) + '</span></span>' +
      segHTML(name, options.map((o, i) => ({ value: o, label: labels[i] }))) + '</div>';
  }
  function mountUI(container) {
    if (!container) return;
    if (!L()) { container.textContent = 'The appearance settings need the component library.'; return; }
    container.innerHTML =
      '<section class="hx-set" aria-labelledby="hxt-h-preset"><h3 class="ui-set__head" id="hxt-h-preset">Theme</h3>' +
        '<div class="hxt-presets" role="radiogroup" aria-labelledby="hxt-h-preset">' + Object.entries(PRESETS).map(([id, p]) =>
          '<label class="hxt-preset" data-hx-preset="' + id + '" data-hx-case="' + p.case + '"><input type="radio" name="hxt-preset" id="hxt-preset-' + id + '" value="' + id + '">' +
          '<span class="hxt-preset__chips" aria-hidden="true"><i style="background:var(--bg-1)"></i><i style="background:var(--bg-2)"></i><i style="background:var(--bg-3)"></i><i style="background:var(--text)"></i><i style="background:var(--brass)"></i><i style="background:var(--red)"></i></span>' +
          '<span class="hxt-preset__name">' + esc(p.name) + '</span><span class="hxt-preset__note">' + esc(p.note) + '</span></label>').join('') + '</div>' +
      '</section>' +
      '<section class="hx-set" aria-labelledby="hxt-h-brand"><h3 class="ui-set__head" id="hxt-h-brand">Brand</h3>' +
        '<div class="ui-set__row"><span class="ui-set__label" id="hxt-logo-l"><span>Logo</span><small>The mark in the title bar</small></span>' +
          segHTML('hxt-logo', [{ value: 'closed', ariaLabel: 'Closed, \u03a6' }, { value: 'open', ariaLabel: 'Open, \u03c6' }], 'hxt-logos') + '</div>' +
      '</section>' +
      '<section class="hx-set" aria-labelledby="hxt-h-type"><h3 class="ui-set__head" id="hxt-h-type">Type</h3>' +
        '<div class="ui-set__row"><label class="ui-set__label" for="hxt-sans"><span>Interface font</span><small>Labels, buttons and the conversation</small></label><select id="hxt-sans" class="ui-input hxt-select">' + FONTS.sans.map(f => '<option>' + esc(f[0]) + '</option>').join('') + '</select></div>' +
        '<div class="ui-set__row"><label class="ui-set__label" for="hxt-mono"><span>Code font</span><small>Code, paths, times and costs</small></label><select id="hxt-mono" class="ui-input hxt-select">' + FONTS.mono.map(f => '<option>' + esc(f[0]) + '</option>').join('') + '</select></div>' +
        choice('hxt-case', 'Interface text', CASES, ['Sentence case', 'lowercase']) +
      '</section>' +
      '<section class="hx-set" aria-labelledby="hxt-h-shape"><h3 class="ui-set__head" id="hxt-h-shape">Shape</h3>' +
        choice('hxt-corners', 'Corners', CORNERS, ['Sharp', 'Default', 'Round']) +
        choice('hxt-density', 'Density', DENSITIES, ['Compact', 'Regular', 'Comfortable']) +
      '</section>' +
      '<section class="hx-set" aria-labelledby="hxt-h-colours"><h3 class="ui-set__head" id="hxt-h-colours">Colours</h3>' +
        '<p class="hxt-hint">Changes show at once. Lines and hover fills follow the text colour. The dock stays black in every theme.</p>' +
        GROUPS.map(([g, rows]) => '<h4 class="hxt-group">' + g + '</h4>' + rows.map(([t, label, note]) =>
          '<div class="hxt-row" data-token="' + t + '">' +
            '<input type="color" class="hxt-swatch" id="' + idOf(t) + '-c" aria-label="' + esc(label) + ' colour">' +
            '<label class="hxt-row__label" for="' + idOf(t) + '-x"><span>' + esc(label) + '<i class="hxt-flag" title="Fails a contrast check" hidden></i></span>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</label>' +
            '<input type="text" class="ui-input ui-input--mono hxt-hex" id="' + idOf(t) + '-x" spellcheck="false" autocomplete="off" maxlength="7" aria-label="' + esc(label) + ' hex value">' +
            '<button type="button" class="ui-btn ui-btn--ghost ui-btn--s hxt-undo" data-undo="' + t + '" aria-label="Reset ' + esc(label) + ' to the theme colour"><span>Reset</span></button>' +
          '</div>').join('')).join('') +
      '</section>' +
      '<section class="hx-set" aria-labelledby="hxt-h-contrast"><h3 class="ui-set__head" id="hxt-h-contrast">Contrast</h3><ul class="hxt-contrast" id="hxt-contrast" aria-live="polite"></ul></section>' +
      '<section class="hx-set" aria-labelledby="hxt-h-share"><h3 class="ui-set__head" id="hxt-h-share">Share</h3>' +
        '<label class="hxt-json-label" for="hxt-json">Theme as JSON. Copy it to share, or paste one and apply it.</label>' +
        '<textarea id="hxt-json" class="ui-input ui-input--mono hxt-json" rows="7" spellcheck="false"></textarea>' +
        '<div class="hxt-actions">' +
          '<button type="button" class="ui-btn ui-btn--s" id="hxt-copy"><span>Copy JSON</span></button>' +
          '<button type="button" class="ui-btn ui-btn--s" id="hxt-apply"><span>Apply JSON</span></button>' +
          '<label class="ui-btn ui-btn--s hxt-file" for="hxt-file"><span>Import file</span><input type="file" id="hxt-file" accept="application/json,.json"></label>' +
          '<button type="button" class="ui-btn ui-btn--ghost ui-btn--s hxt-end" id="hxt-reset"><span>Reset to theme</span></button>' +
        '</div>' +
        '<p class="hxt-msg" id="hxt-msg" role="status"></p>' +
      '</section>';
    // the logo choice shows the two marks themselves (the sprite keeps both)
    const marks = { closed: '<svg aria-hidden="true" focusable="false"><use href="#i-phi-closed"/></svg>', open: '<svg aria-hidden="true" focusable="false" class="is-open"><use href="#i-phi"/></svg>' };
    for (const b of container.querySelectorAll('.hxt-logos [data-value]')) b.insertAdjacentHTML('afterbegin', marks[b.dataset.value]);
    L().hydrate(container);
    ui = container;
    for (const p of Object.values(PRESETS)) { ensureFont(fontOf('sans', p.sans)); ensureFont(fontOf('mono', p.mono)); }
    wireUI();
    refreshUI();
  }

  let rafPending = 0, msgTimer = 0;
  function setColor(token, value) {
    if (!HEX.test(value)) return;
    theme.colors[token] = value.toLowerCase();
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => { rafPending = 0; apply(); });
  }
  function say(text, isError) {
    const m = ui.querySelector('#hxt-msg');
    m.textContent = text;
    m.classList.toggle('is-error', !!isError);
    clearTimeout(msgTimer);
    if (!isError) msgTimer = setTimeout(() => { m.textContent = ''; }, 3000);
  }
  function wireUI() {
    ui.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'hxt-preset') API.preset(t.value);
      else if (t.id === 'hxt-sans') API.set({ sans: t.value });
      else if (t.id === 'hxt-mono') API.set({ mono: t.value });
      else if (t.id === 'hxt-file' && t.files && t.files[0]) {
        const r = new FileReader();
        r.onload = () => { ui.querySelector('#hxt-json').value = String(r.result || ''); applyJSON(); };
        r.onerror = () => say('The file could not be read. Try pasting its text instead.', true);
        r.readAsText(t.files[0]);
        t.value = '';
      } else if (t.classList.contains('hxt-hex')) {
        const v = t.value.trim().startsWith('#') ? t.value.trim() : '#' + t.value.trim();
        if (HEX.test(v)) setColor(t.closest('.hxt-row').dataset.token, v);
        else { t.value = hexOf(t.closest('.hxt-row').dataset.token); say('Use a six-digit hex colour, such as #c8a66a.', true); }
      }
    });
    const SEG = { 'hxt-case': 'case', 'hxt-corners': 'corners', 'hxt-density': 'density', 'hxt-logo': 'logo' };
    ui.addEventListener('ui:change', (e) => {
      const key = SEG[e.target.dataset && e.target.dataset.name];
      if (key) API.set({ [key]: e.detail.value });
    });
    ui.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('hxt-swatch')) { const row = t.closest('.hxt-row'); row.querySelector('.hxt-hex').value = t.value; setColor(row.dataset.token, t.value); }
      else if (t.classList.contains('hxt-hex')) { const v = t.value.trim(); if (HEX.test(v)) setColor(t.closest('.hxt-row').dataset.token, v); }
    });
    ui.addEventListener('click', (e) => {
      const u = e.target.closest('[data-undo]');
      if (u) { delete theme.colors[u.dataset.undo]; apply(); return; }
      const hit = (id) => !!e.target.closest('#' + id);   // the buttons carry their label in a span
      if (hit('hxt-reset')) { API.reset(); say('Back to the ' + PRESETS[theme.preset].name + ' colours.'); return; }
      if (hit('hxt-apply')) { applyJSON(); return; }
      if (hit('hxt-copy')) {
        const ta = ui.querySelector('#hxt-json');
        ta.value = API.exportJSON();
        const fallback = () => { ta.focus(); ta.select(); say('Copying is blocked here. The JSON is selected: copy it with your keyboard.'); };
        try { navigator.clipboard.writeText(ta.value).then(() => say('Copied.'), fallback); } catch (err) { fallback(); }
      }
    });
  }
  function applyJSON() {
    const text = ui.querySelector('#hxt-json').value;
    try { API.importJSON(text); say('Theme applied.'); }
    catch (err) { say(err.message, true); }
  }
  function refreshUI() {
    if (!ui || !ui.isConnected) return;
    const presetIn = ui.querySelector('#hxt-preset-' + theme.preset); if (presetIn) presetIn.checked = true;
    ui.querySelector('#hxt-sans').value = eff('sans');
    ui.querySelector('#hxt-mono').value = eff('mono');
    for (const [name, val] of [['hxt-case', eff('case')], ['hxt-corners', eff('corners')], ['hxt-density', eff('density')], ['hxt-logo', eff('logo')]]) {
      const sg = ui.querySelector('[data-name="' + name + '"]'); if (sg && sg.select) sg.select(val);
    }
    const values = {};
    for (const t of EDITABLE) values[t] = hexOf(t);
    for (const row of ui.querySelectorAll('.hxt-row')) {
      const t = row.dataset.token, v = values[t];
      const sw = row.querySelector('.hxt-swatch'), hx = row.querySelector('.hxt-hex');
      if (document.activeElement !== sw) sw.value = v;
      if (document.activeElement !== hx) hx.value = v;
      row.classList.toggle('is-changed', t in theme.colors);
    }
    // contrast
    const val = (k, scope) => (!scope && !k.includes('@') && values[k]) || compositeOf(k, scope);
    const fails = PAIRS.map(([fg, bg, min, label, scope]) => ({ fg, bg, min, label, scope, r: ratio(val(fg, scope), val(bg, scope)) })).filter(p => p.r < p.min - 0.005);
    // a derived token is blamed on the editable colours it is mixed from
    const DERIVED = { '--current': ['--text'], '--line-field': ['--text'], '--mark-off': ['--text-quiet', '--text-faint'] };
    const parts = (k) => k.split('@').flatMap(t => (EDITABLE.includes(t) ? [t] : DERIVED[t] || []));
    const blame = (f) => (f.scope === 'dock' ? [...(DOCK_BLAME[f.fg] || []), ...(DOCK_BLAME[f.bg] || [])] : [...parts(f.fg), ...parts(f.bg)]);
    const flagged = new Set(fails.flatMap(blame));
    for (const row of ui.querySelectorAll('.hxt-row')) row.querySelector('.hxt-flag').hidden = !flagged.has(row.dataset.token);
    ui.querySelector('#hxt-contrast').innerHTML = fails.length
      ? fails.map(f => '<li class="is-fail"><span>' + esc(f.label) + '</span><span class="hxt-ratio">' + f.r.toFixed(1) + ':1, needs ' + f.min + ':1</span></li>').join('')
      : '<li><span>Every checked pair passes WCAG AA.</span><span class="hxt-ratio">' + PAIRS.length + ' pairs</span></li>';
    const ta = ui.querySelector('#hxt-json');
    if (document.activeElement !== ta) ta.value = API.exportJSON();
  }
})();
