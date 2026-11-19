/* boopis v6 · mod view (proposal for the owner's review; MODS.md §2 and §3)
   HX.ui.modView(tree, opts) draws a Claude Code mod's element tree with the library, so a mod looks native.
   One renderer for every surface a mod draws into: a pane, the band above the composer, a placed transcript row.

   An element is {type, props, children}; a child may also be a string or a number (drawn as Text).
   Types: Box, Text, Button, Input, Select, Markdown, Code, Link, Svg. Anything else fails validation and the whole
   tree is skipped (modView returns null; the host falls back to its own drawing and logs), as in Claude Code.
   Handlers never run here: a prop such as onPress is an id, and the view answers through opts.dispatch(event).

   modView(tree, {surface, dispatch, label, keep})
     surface   'frame' (a pane, on --bg-1) | 'ground' (a placed row, on --bg-2) | 'inset' (the band, on --bg-0)
     dispatch  ({type: 'ui.press'|'ui.input'|'ui.select'|'ui.submit', id, value, key}) the mod host answers
   -> element (.mv-root). HX.ui.modView.update(root, tree, opts) draws a new tree in place and keeps focus and caret.

   Mapping (the table is in code, below; the questions for the owner are in the report):
     Box      a flex container on the spacing scale. A terminal cell becomes a step: 1 is --sp-2, 2 is --sp-3, 3 is --sp-4,
              4 is --sp-5, more is --sp-6. Borders are the hairline; backgroundColor draws a surface token.
     Text     the type scale (xs 11, s 13, m 14, l 16); `mono` is --mono, `tabular` tabular figures.
     Button   HX.ui.button (variant and role become its variants; a hotkey that collides with the app's keys is dropped).
     Input    the field of FORMS.md (.ui-input). Select: the card layer's picker pattern, with the library's menu.
     Markdown paragraphs, lists, inline code, bold, italic and https links, through the library's prose.
     Code     the session's well (mono 11, --bg-0), with a line gutter, a path line and a diff format.
     Link     https: only; anything else is plain text.
     Svg      sanitised (no script, no foreignObject, no external references), colours through the same map as Text.
     Progress a Box with `progress` (0 to 100) or role 'progressbar' is drawn as dots, never a bar (F18): `progress` a number is
              the determinate form (dots filled in proportion, the library's measure row), a missing or null `progress` the
              indeterminate one (one dot travelling along the row). `dots` sets the count (default 10, 3 to 20).
   Colours stay in theme (owner decision, 19 November 2026). Every colour a mod names, by Claude Code name or theme key, maps onto
   the active theme's tokens (the maps below), so a mod reads as part of the app in every preset and keeps its contrast. A
   literal colour from a mod (a hex, rgb()) is drawn as given only when it has enough contrast on the surface under it (4.5 for
   text, 3 for marks), else the nearest semantic token. The pairs are re-read on hx:theme. A mod that wants its own palette
   proposes a theme (the card with the live preview), it never paints around the theme. */
(function () {
  'use strict';
  const HX = window.HX;
  if (!HX || !HX.ui || HX.ui.modView) return;
  const ui = HX.ui;

  /* ───────────── the mod glyph: one drawn icon, on the library's 16 grid and 1.5px stroke ───────────── */
  const MOD_ICON = ['0 0 16 16', '<path d="M3.5 4h2.7v-.5a1.8 1.8 0 0 1 3.6 0V4h2.7a1 1 0 0 1 1 1v2.2h-.5a1.8 1.8 0 0 0 0 3.6h.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>'];
  const baseIcon = ui.icon;
  ui.icon = function (name, o) {
    if (name !== 'mod') return baseIcon(name, o);
    o = o || {};
    return '<svg class="' + ['ui-icon', o.size && 'ui-icon--' + o.size, o.class].filter(Boolean).join(' ') + '" viewBox="' + MOD_ICON[0] + '" aria-hidden="true" focusable="false">' + MOD_ICON[1] + '</svg>';
  };
  if (Array.isArray(ui.icons) && ui.icons.indexOf('mod') < 0) ui.icons.push('mod');

  /* ───────────── helpers ───────────── */
  const esc = ui.esc;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const LIMITS = { chars: 100000, elements: 20000, depth: 32, href: 2048, svg: 131072 };
  const TYPES = ['Box', 'Text', 'Button', 'Input', 'Select', 'Markdown', 'Code', 'Link', 'Svg'];

  /* terminal cells to the spacing scale */
  const STEP = ['0', 'var(--sp-2)', 'var(--sp-3)', 'var(--sp-4)', 'var(--sp-5)', 'var(--sp-6)'];
  const sp = (n) => STEP[Math.max(0, Math.min(STEP.length - 1, Math.round(+n || 0)))];
  const cell = (n) => 'calc(' + (+n || 0) + ' * var(--sp-2))';      /* a width or height counted in cells: one cell is 8px */
  const size = (v) => (typeof v === 'number' ? cell(v) : /^\d+(\.\d+)?%$/.test(String(v)) ? v : null);

  /* ───────────── colour: Claude Code's names and theme keys to semantic tokens (MODS §2) ───────────── */
  /* text. `claude` is the accent in Claude Code, and brass is never text (DESIGN-SYSTEM 4.3), so text takes --text-strong. */
  const TEXT = {
    text: '--text', claude: '--text-strong', success: '--ok', error: '--del', warning: '--warn', subtle: '--text-quiet', inactive: '--text-quiet',
    suggestion: '--text-dim', permission: '--text-dim', remember: '--text-dim', merged: '--text-dim', autoAccept: '--ok', planMode: '--text-dim',
    inverseText: '--text-on-light', diffAdded: '--add', diffRemoved: '--del', diffAddedWord: '--add', diffRemovedWord: '--del', diffAddedDimmed: '--add', diffRemovedDimmed: '--del',
    red: '--del', green: '--ok', yellow: '--warn', blue: '--text-strong', cyan: '--text-strong', magenta: '--text-dim', white: '--text-strong', gray: '--text-quiet', grey: '--text-quiet', black: '--text',
    redBright: '--del', greenBright: '--ok', yellowBright: '--warn', blueBright: '--text-strong', cyanBright: '--text-strong', magentaBright: '--text-dim', whiteBright: '--text-strong'
  };
  /* marks: fills, strokes and borders (not text), where the accent is allowed */
  const MARK = Object.assign({}, TEXT, { claude: '--brass', blue: '--brass', cyan: '--brass', blueBright: '--brass', cyanBright: '--brass', magenta: '--text-dim', promptBorder: '--line', bashBorder: '--line' });
  /* the diff names that tint a Box background (the rest draw solid) */
  const TINT = { diffAdded: '--add', diffRemoved: '--del', diffAddedWord: '--add', diffRemovedWord: '--del', diffAddedDimmed: '--add', diffRemovedDimmed: '--del' };
  /* surfaces: a mod asks for a surface by name; the active theme decides what it looks like */
  const SURFACE = { 'surface-0': '--bg-0', 'surface-1': '--bg-3', 'surface-2': '--bg-4', inset: '--bg-0', raised: '--bg-3', pressed: '--bg-4' };
  const NEAREST = ['--text', '--text-dim', '--text-quiet', '--brass', '--ok', '--del', '--warn', '--add'];
  const SURF_VAR = { frame: '--bg-1', ground: '--bg-2', inset: '--bg-0' };

  const probe = (() => { let p = null; return () => { if (!p || !p.isConnected) { p = el('i'); p.setAttribute('aria-hidden', 'true'); p.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none'; (document.body || document.documentElement).appendChild(p); } return p; }; })();
  function rgbOf(css) {
    const p = probe(); p.style.color = ''; p.style.color = css;
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(p).color);
    if (!m) return null;
    const v = m[1].split(/[ ,\/]+/).map(parseFloat);
    return v.slice(0, 3);
  }
  const tokenRGB = (name) => rgbOf('var(' + name + ')');
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const isLiteral = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgb\(/i.test(v);
  function parseLiteral(v) {
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    m = /^rgb\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)\s*\)$/i.exec(v);
    return m ? [+m[1], +m[2], +m[3]].map((x) => Math.min(255, x)) : null;
  }
  /* a literal as given when it holds up on the surface under it, else the nearest token that does */
  function literalOn(v, role, surface) {
    const rgb = parseLiteral(v), bg = tokenRGB(SURF_VAR[surface] || '--bg-1');
    if (!rgb || !bg) return 'var(--text)';
    const need = role === 'text' ? 4.5 : 3;
    if (ratio(rgb, bg) >= need) return v;
    const ok = NEAREST.map((n) => ({ n, c: tokenRGB(n) })).filter((x) => x.c && ratio(x.c, bg) >= need).sort((a, b) => dist(a.c, rgb) - dist(b.c, rgb));
    return 'var(' + (ok[0] ? ok[0].n : '--text') + ')';
  }
  /* the CSS value for a mod's colour. Tokens resolve now and follow the theme by themselves; literals are listed to be re-read */
  function colorValue(name, role, ctx, node, prop) {
    if (name == null || name === '') return null;
    name = String(name);
    if (isLiteral(name)) {
      const apply = () => { const v = literalOn(name, role, ctx.surface); if (prop.charAt(0) === '-') node.style.setProperty(prop, v); else node.style[prop] = v; };
      apply();
      ctx.lits.push({ node, apply });
      return undefined;                       /* already written */
    }
    const t = (role === 'text' ? TEXT : MARK)[name];
    if (t) return 'var(' + t + ')';
    return role === 'text' ? 'var(--text)' : 'var(--line)';
  }
  function setColor(node, prop, name, role, ctx) {
    const v = colorValue(name, role, ctx, node, prop);
    if (v) { if (prop.charAt(0) === '-') node.style.setProperty(prop, v); else node.style[prop] = v; }
  }
  /* re-read every literal when the theme changes (a surface or a token moved) */
  const LIVE = new Set();
  const retint = () => { for (const r of LIVE) { if (!r.isConnected) { LIVE.delete(r); continue; } for (const l of r._mvLits || []) l.apply(); } };
  window.addEventListener('hx:theme', retint);

  /* ───────────── validation: the docs' limits ───────────── */
  function validate(tree) {
    let count = 0, chars = 0;
    const walk = (n, depth) => {
      if (depth > LIMITS.depth) return 'deeper than ' + LIMITS.depth;
      if (n == null || n === false || n === true) return null;
      if (typeof n === 'string' || typeof n === 'number') { chars += String(n).length; return chars > LIMITS.chars ? 'more than ' + LIMITS.chars + ' characters' : null; }
      if (typeof n !== 'object' || TYPES.indexOf(n.type) < 0) return 'unknown element ' + (n && n.type);
      if (++count > LIMITS.elements) return 'more than ' + LIMITS.elements + ' elements';
      const p = n.props || {};
      for (const k of ['label', 'placeholder', 'value', 'text', 'source', 'path', 'language', 'href']) if (typeof p[k] === 'string') chars += p[k].length;
      if (n.type === 'Svg' && String(p.svg || p.source || '').length > LIMITS.svg) return 'an Svg over ' + LIMITS.svg + ' characters';
      if (n.type === 'Link' && String(p.href || '').length > LIMITS.href) return 'a Link href over ' + LIMITS.href;
      if (chars > LIMITS.chars) return 'more than ' + LIMITS.chars + ' characters';
      for (const c of [].concat(n.children == null ? [] : n.children)) { const r = walk(c, depth + 1); if (r) return r; }
      return null;
    };
    const reason = walk(tree, 1);
    return reason ? { ok: false, reason } : { ok: true, count, chars };
  }

  /* ───────────── Svg: sanitised ───────────── */
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath']);
  const SVG_ATTRS = new Set(['viewbox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
    'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'offset', 'stop-color', 'stop-opacity', 'id', 'gradientunits', 'gradienttransform', 'preserveaspectratio', 'clip-path', 'role', 'aria-label']);
  function cleanSvg(source, ctx, role) {
    let doc;
    try { doc = new DOMParser().parseFromString(String(source), 'image/svg+xml'); } catch (e) { return null; }
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
    const NS = 'http://www.w3.org/2000/svg';
    const build = (src) => {
      const tag = src.nodeName.toLowerCase();
      if (!SVG_TAGS.has(tag)) return null;                  /* script, foreignObject, image, use, style, a, anything else is dropped with its children */
      const out = document.createElementNS(NS, src.localName);
      for (const a of Array.from(src.attributes)) {
        const n = a.name.toLowerCase(), v = a.value;
        if (!SVG_ATTRS.has(n)) continue;                    /* no on* handlers, no href, no style, no class */
        if (/url\(/i.test(v) && !/^url\(\s*#[\w-]+\s*\)$/.test(v)) continue;   /* an internal reference only */
        if (/javascript:|data:|expression\(/i.test(v)) continue;
        if (n === 'fill' || n === 'stroke' || n === 'stop-color') {
          if (v === 'none' || v === 'currentColor' || /^url\(#/.test(v)) { out.setAttribute(n, v === 'currentColor' ? 'currentColor' : v); continue; }
          const val = colorValue(v, n === 'stop-color' ? 'mark' : 'mark', ctx, out, n === 'stop-color' ? 'stopColor' : n);   /* graphics are marks: 3:1 */
          if (val) out.style[n === 'stop-color' ? 'stopColor' : n] = val;
          continue;
        }
        out.setAttribute(a.name, v);
      }
      if (tag === 'text' || tag === 'tspan') { if (!out.hasAttribute('fill') && !out.style.fill) out.style.fill = 'var(--text-quiet)'; out.style.fontFamily = 'var(--mono)'; }
      for (const c of Array.from(src.childNodes)) {
        if (c.nodeType === 3) out.appendChild(document.createTextNode(c.nodeValue));
        else if (c.nodeType === 1) { const k = build(c); if (k) out.appendChild(k); }
      }
      return out;
    };
    const svg = build(root);
    if (!svg) return null;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('focusable', 'false');
    return svg;
  }

  /* ───────────── Markdown (the session's prose) ───────────── */
  function inlineMd(t) {
    let s = esc(t);
    s = s.replace(/`([^`]+)`/g, '<code class="ui-code">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (m, label, href) => '<a class="mv-link" href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    return s;
  }
  function markdown(text) {
    const root = el('div', 'ui-prose mv-md');
    const lines = String(text).replace(/\r/g, '').split('\n');
    let para = [], list = null;
    const flush = () => {
      if (para.length) { const p = el('p'); p.innerHTML = inlineMd(para.join(' ')); root.append(p); para = []; }
      if (list) { root.append(list.el); list = null; }
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flush(); continue; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flush(); const h = el('p', 'mv-md__h'); h.innerHTML = inlineMd(m[2]); root.append(h); continue; }
      if ((m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line))) {
        const ord = /\d/.test(m[1]);
        if (!list || list.ord !== ord) { flush(); list = { ord, el: el(ord ? 'ol' : 'ul') }; }
        const li = el('li'); li.innerHTML = inlineMd(m[2]); list.el.append(li); continue;
      }
      if (list) flush();
      para.push(line.trim());
    }
    flush();
    return root;
  }

  /* ───────────── builders ───────────── */
  const sizeVar = { xs: '--fs-2xs', s: '--fs-xs', m: '--fs-s', l: '--fs-m', xl: '--fs-l', small: '--fs-xs', large: '--fs-m', '2xs': '--fs-2xs' };
  const weight = (w, bold) => (bold ? 600 : w == null ? null : typeof w === 'number' ? (w >= 600 ? 600 : w >= 500 ? 500 : 400) : w === 'bold' ? 600 : w === 'medium' ? 500 : 400);
  const FLEX = { start: 'flex-start', end: 'flex-end', 'flex-start': 'flex-start', 'flex-end': 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline', 'space-between': 'space-between', 'space-around': 'space-around' };
  const textOf = (children) => [].concat(children == null ? [] : children).map((c) => (c == null || c === false ? '' : typeof c === 'object' ? textOf(c.children) : String(c))).join('');
  /* keys the app owns: a mod's hotkey that collides is dropped, never stolen (MODS §2) */
  const RESERVED = ['mod+k', 'mod+b', 'mod+shift+b', 'mod+i', 'mod+.', 'mod+,', 'mod+[', 'mod+]', 'mod+shift+o', 'mod+enter', 'enter', 'esc', 'escape', 'tab', 'alt+1', 'alt+2', 'alt+v', 'alt+a', 'mod+g', 'x', 'c', 'g', '[', ']', '/'];
  const keyOk = (k) => k && RESERVED.indexOf(String(k).toLowerCase().replace(/ctrl|cmd|meta/g, 'mod')) < 0;

  function build(node, ctx, path) {
    if (node == null || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') return buildText({ props: {}, children: [node] }, ctx, path);
    const p = node.props || {}, kids = [].concat(node.children == null ? [] : node.children);
    switch (node.type) {
      case 'Box': return buildBox(node, p, kids, ctx, path);
      case 'Text': return buildText(node, ctx, path);
      case 'Button': return buildButton(p, kids, ctx, path);
      case 'Input': return buildInput(p, ctx, path);
      case 'Select': return buildSelect(p, ctx, path);
      case 'Markdown': { const m = markdown(p.text != null ? p.text : textOf(kids)); return m; }
      case 'Code': return buildCode(p, kids, ctx);
      case 'Link': return buildLink(p, kids, ctx);
      case 'Svg': return buildSvg(p, ctx);
    }
    return null;
  }

  /* progress is dots (F18): the library's measure row, filled in proportion; or one dot travelling when nothing is known */
  function buildProgress(p) {
    const n = Math.max(3, Math.min(20, Math.round(+p.dots) || 10)), known = p.progress != null && isFinite(+p.progress);
    const pct = known ? Math.max(0, Math.min(100, +p.progress)) : null;
    const wrap = el('span');
    wrap.innerHTML = ui.html.measure({ variant: 'row', used: pct == null ? 0 : pct, total: 100, dots: n, label: p.label || 'Progress' });
    const b = wrap.firstChild;
    b.classList.add('mv-dots'); b.setAttribute('role', 'progressbar'); b.setAttribute('aria-valuemin', '0'); b.setAttribute('aria-valuemax', '100');
    b.setAttribute('aria-label', p['aria-label'] || p.label || 'Progress');
    if (pct != null) b.setAttribute('aria-valuenow', String(Math.round(pct)));
    else {
      b.setAttribute('aria-busy', 'true'); b.dataset.indeterminate = '';
      const run = el('i', 'mv-dots__run'); run.style.setProperty('--mv-run', 'calc(' + (n - 1) + ' * (4px + 6px))'); b.append(run);     /* the dot and the library's gap: 4px and 6px */
    }
    if (p.flexGrow != null) b.style.flexGrow = String(Math.max(0, +p.flexGrow || 0));
    if (p.alignSelf) b.style.alignSelf = 'center';
    return b;
  }

  function buildBox(node, p, kids, ctx, path) {
    if (p.role === 'progressbar' || p.progress !== undefined) return buildProgress(p);
    const b = el('div', 'mv-box'), s = b.style;
    const col = p.flexDirection === 'column' || p.flexDirection === 'column-reverse';
    if (col) s.flexDirection = p.flexDirection;
    else if (p.flexDirection === 'row-reverse') s.flexDirection = 'row-reverse';
    if (p.gap != null) s.gap = sp(p.gap);
    if (p.columnGap != null) s.columnGap = sp(p.columnGap);
    if (p.rowGap != null) s.rowGap = sp(p.rowGap);
    const pad = (k, v) => { if (v != null) s[k] = sp(v); };
    pad('padding', p.padding); pad('paddingLeft', p.paddingLeft != null ? p.paddingLeft : p.paddingX); pad('paddingRight', p.paddingRight != null ? p.paddingRight : p.paddingX);
    pad('paddingTop', p.paddingTop != null ? p.paddingTop : p.paddingY); pad('paddingBottom', p.paddingBottom != null ? p.paddingBottom : p.paddingY);
    pad('margin', p.margin); pad('marginLeft', p.marginLeft != null ? p.marginLeft : p.marginX); pad('marginRight', p.marginRight != null ? p.marginRight : p.marginX);
    pad('marginTop', p.marginTop != null ? p.marginTop : p.marginY); pad('marginBottom', p.marginBottom != null ? p.marginBottom : p.marginY);
    if (p.justifyContent && FLEX[p.justifyContent]) s.justifyContent = FLEX[p.justifyContent];
    if (p.alignItems && FLEX[p.alignItems]) s.alignItems = FLEX[p.alignItems];
    if (p.alignSelf && FLEX[p.alignSelf]) s.alignSelf = FLEX[p.alignSelf];
    if (p.flexWrap === 'wrap') s.flexWrap = 'wrap';
    if (p.flexGrow != null) s.flexGrow = String(Math.max(0, +p.flexGrow || 0));
    if (p.flexShrink != null) s.flexShrink = String(Math.max(0, +p.flexShrink || 0));
    const w = size(p.width), h = size(p.height), mw = size(p.minWidth);
    if (w) s.width = w; if (h) s.height = h; if (mw) s.minWidth = mw;
    if (p.borderStyle) { b.classList.add('mv-box--border'); if (p.borderColor) setColor(b, '--mv-border', p.borderColor, 'mark', ctx); }
    if (p.backgroundColor) {
      const name = String(p.backgroundColor);
      if (SURFACE[name]) s.background = 'var(' + SURFACE[name] + ')';
      else if (/^diff/.test(name) && TINT[name]) s.background = 'color-mix(in srgb, var(' + TINT[name] + ') 12%, transparent)';   /* a diff background is a tint, as the session draws it */
      else if (MARK[name]) s.background = 'var(' + MARK[name] + ')';                                                          /* any other name is a solid mark: a bar, a swatch */
      else if (isLiteral(name)) b.classList.add('mv-box--fill'), setColor(b, 'background', name, 'mark', ctx);
      else s.background = 'var(--hover)';
      b.classList.add('mv-box--filled');
    }
    if (p.overflow === 'hidden') s.overflow = 'hidden';
    if (p['aria-label'] || p.label) { b.setAttribute('role', 'group'); b.setAttribute('aria-label', p['aria-label'] || p.label); }
    kids.forEach((c, i) => { const n = build(c, ctx, path + '.' + i); if (n) b.append(n); });
    return b;
  }

  function buildText(node, ctx, path) {
    const p = node.props || {}, t = el('span', 'mv-text'), s = t.style;
    const sz = sizeVar[p.size];
    if (p.mono) t.classList.add('mv-text--mono');
    if (p.tabular) t.classList.add('mv-text--tab');
    if (sz) s.fontSize = 'var(' + sz + ')';
    const wt = weight(p.weight, p.bold); if (wt) s.fontWeight = wt;
    if (p.italic) s.fontStyle = 'italic';
    const dec = [p.underline && 'underline', p.strikethrough && 'line-through'].filter(Boolean).join(' '); if (dec) s.textDecoration = dec;
    if (p.dimColor && !p.color) s.color = 'var(--text-dim)';
    if (p.color) setColor(t, 'color', p.color, 'text', ctx);
    if (p.inverse) { t.classList.add('mv-text--inverse'); }
    if (p.wrap === 'truncate' || p.wrap === 'truncate-end' || p.wrap === 'truncate-middle') t.classList.add('mv-text--trunc');
    if (p.wrap === 'nowrap' || p.wrap === 'none') t.classList.add('mv-text--nowrap');
    const kids = [].concat(node.children == null ? [] : node.children);
    kids.forEach((c, i) => {
      if (c == null || c === false) return;
      if (typeof c === 'string' || typeof c === 'number') t.append(document.createTextNode(String(c)));
      else { const n = build(c, ctx, path + '.' + i); if (n) t.append(n); }
    });
    return t;
  }

  function buildButton(p, kids, ctx, path) {
    const label = p.label != null ? p.label : textOf(kids);
    const variant = p.variant === 'primary' ? 'primary' : (p.plain || p.variant === 'plain' || p.variant === 'ghost') ? 'ghost' : 'secondary';
    const key = keyOk(p.hotkey) ? p.hotkey : null;
    const b = ui.button({ label, variant, size: 's', disabled: !!p.disabled, icon: p.icon && ui.icons.indexOf(p.icon) >= 0 ? p.icon : null, keys: key, tip: key ? label : null });
    if (!label) { const sp = b.querySelector('span'); if (sp) sp.remove(); b.classList.add('mv-iconbtn'); }   /* a button with no label is a square, as a checkbox is
    */
    if (p.pressed != null) b.setAttribute('aria-pressed', String(!!p.pressed));
    /* role 'danger' has no red button in the system (red is for what you owe); it draws as a secondary and says so to a screen reader */
    if (p.role === 'danger' || p.role === 'destructive') b.setAttribute('aria-description', 'Destructive');
    if (p['aria-label']) b.setAttribute('aria-label', p['aria-label']);
    b.setAttribute('data-mv-key', path);
    b.addEventListener('click', () => { if (p.onPress != null) ctx.dispatch({ type: 'ui.press', id: p.onPress }); });
    return b;
  }

  function buildInput(p, ctx, path) {
    const multi = (p.rows || 1) > 1;
    const wrap = el('div', 'mv-input');
    const f = el(multi ? 'textarea' : 'input', 'ui-input');
    if (!multi) f.type = 'text';
    if (multi) f.rows = Math.min(8, p.rows);
    f.placeholder = p.placeholder || ''; f.value = p.value == null ? '' : p.value;
    f.setAttribute('aria-label', p['aria-label'] || p.label || p.placeholder || 'Input'); f.setAttribute('autocomplete', 'off'); f.spellcheck = false;
    f.setAttribute('data-mv-key', path);
    f.addEventListener('input', () => { if (p.onInput != null) ctx.dispatch({ type: 'ui.input', id: p.onInput, value: f.value }); });
    const submit = () => { if (p.onSubmit != null) ctx.dispatch({ type: 'ui.submit', id: p.onSubmit, value: f.value }); };
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
    wrap.append(f);
    if (p.submitLabel) { const b = ui.button({ label: p.submitLabel, size: 's', variant: 'primary' }); b.setAttribute('data-mv-key', path + 's'); b.addEventListener('click', submit); wrap.append(b); }
    return wrap;
  }

  function buildSelect(p, ctx, path) {
    const opts = (p.options || []).map((o) => (typeof o === 'object' ? { label: String(o.label != null ? o.label : o.value), value: String(o.value != null ? o.value : o.label) } : { label: String(o), value: String(o) }));
    const cur = opts.find((o) => o.value === String(p.value)) || opts[0] || { label: '', value: '' };
    const b = el('button', 'ui-input mv-select');
    b.type = 'button'; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('data-mv-key', path);
    const lab = p['aria-label'] || p.label || 'Choose';
    b.setAttribute('aria-label', lab + ': ' + cur.label);
    b.append(el('span', 'mv-select__v', cur.label)); b.insertAdjacentHTML('beforeend', ui.icon('chevron-down', { size: 's' }));
    b.addEventListener('click', () => {
      ui.menu.open(b, opts.map((o) => ({ label: o.label, value: o.value, checked: o.value === cur.value })), {
        label: lab, align: 'start', onSelect: (v) => { b.setAttribute('aria-expanded', 'false'); ctx.dispatch({ type: 'ui.select', id: p.onSelect, value: v }); }
      });
    });
    return b;
  }

  function buildCode(p, kids, ctx) {
    const src = String(p.source != null ? p.source : textOf(kids)).replace(/\n$/, '');
    const wrap = el('div', 'mv-code' + (p.wrap ? ' mv-code--wrap' : ''));
    if (p.path) wrap.append(el('div', 'mv-code__path ui-mono', p.path));
    const body = el('pre', 'mv-code__pre ui-mono'); body.tabIndex = 0; body.setAttribute('aria-label', p.path ? 'Code, ' + p.path : 'Code');
    const start = p.startLine != null ? +p.startLine : null;
    src.split('\n').forEach((line, i) => {
      const row = el('span', 'mv-code__l');
      if (p.format === 'diff') {
        const d = /^\+(?!\+\+)/.test(line) ? 'add' : /^-(?!--)/.test(line) ? 'del' : /^@@/.test(line) ? 'hunk' : '';
        if (d) row.dataset.d = d;
        row.append(el('span', 'mv-code__sg', d === 'add' ? '+' : d === 'del' ? '−' : ' '), document.createTextNode(d === 'hunk' ? line : line.slice(d ? 1 : 0)));
        if (d === 'add' || d === 'del') row.insertAdjacentHTML('afterbegin', '<span class="ui-sr">' + (d === 'add' ? 'added: ' : 'removed: ') + '</span>');
      } else {
        if (start != null) row.append(el('span', 'mv-code__n', String(start + i)));
        const m = /^(\s*)(PASS|FAIL|✓|✗)(.*)$/.exec(line);   /* test output: a pass or a fail word takes its token */
        if (m && p.format !== 'plain') { row.append(document.createTextNode(m[1])); const w = el('span', 'mv-code__' + (m[2] === 'PASS' || m[2] === '✓' ? 'pass' : 'fail'), m[2]); row.append(w, document.createTextNode(m[3])); }
        else row.append(document.createTextNode(line));
      }
      body.append(row);
    });
    wrap.append(body);
    return wrap;
  }

  function buildLink(p, kids, ctx) {
    const label = p.label != null ? p.label : (textOf(kids) || p.href || '');
    let ok = false;
    try { ok = new URL(String(p.href || '')).protocol === 'https:'; } catch (e) { ok = false; }
    if (!ok) { const s = el('span', 'mv-text', label); s.title = 'Only https links open'; return s; }
    const a = el('a', 'mv-link', label);
    a.href = p.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }

  function buildSvg(p, ctx) {
    const svg = cleanSvg(p.svg != null ? p.svg : p.source, ctx, 'mark');
    const wrap = el('div', 'mv-svg');
    if (!svg) { wrap.append(el('span', 'mv-text mv-text--quiet', 'This graphic can’t be drawn')); return wrap; }
    wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', p.label || p['aria-label'] || 'Graphic');
    if (p.height != null) wrap.style.maxHeight = typeof p.height === 'number' ? cell(p.height) : p.height;
    svg.setAttribute('aria-hidden', 'true');
    wrap.append(svg);
    return wrap;
  }

  /* ───────────── the view ───────────── */
  function modView(tree, opts) {
    opts = opts || {};
    const v = validate(tree);
    if (!v.ok) { if (opts.onInvalid) opts.onInvalid(v.reason); else console.warn('[mod-view] tree skipped: ' + v.reason); return null; }
    const root = el('div', 'mv-root');
    root.dataset.surface = opts.surface || 'frame';
    if (opts.label) { root.setAttribute('role', 'group'); root.setAttribute('aria-label', opts.label); }
    paint(root, tree, opts);
    return root;
  }
  function paint(root, tree, opts) {
    const ctx = { surface: opts.surface || 'frame', dispatch: opts.dispatch || (() => {}), lits: [] };
    const n = build(tree, ctx, '0');
    root.replaceChildren(...(n ? [n] : []));
    root._mvLits = ctx.lits; root._mvOpts = opts;
    LIVE.add(root);
  }
  /* draw a new tree in place; focus and the caret survive when the same control is still there */
  modView.update = function (root, tree, opts) {
    opts = Object.assign({}, root._mvOpts || {}, opts || {});
    const v = validate(tree);
    if (!v.ok) { if (opts.onInvalid) opts.onInvalid(v.reason); return false; }
    const a = document.activeElement, key = a && root.contains(a) ? a.getAttribute('data-mv-key') : null;
    const sel = key && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    paint(root, tree, opts);
    if (key) {
      const n = root.querySelector('[data-mv-key="' + key + '"]');
      if (n) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
    }
    return true;
  };
  modView.validate = validate;
  modView.limits = LIMITS;
  modView.colors = { text: TEXT, mark: MARK, tint: TINT, surface: SURFACE };
  modView.sanitizeSvg = (s) => { const x = cleanSvg(s, { surface: 'frame', lits: [] }, 'mark'); return x ? x.outerHTML : null; };
  /* element constructors for sample trees: h.Box({gap: 1}, h.Text({dimColor: true}, 'quiet')) */
  modView.h = {};
  for (const t of TYPES) modView.h[t] = (props, ...children) => ({ type: t, props: props || {}, children: children.flat() });
  ui.modView = modView;
  /* the mod glyph and its name, one unit (origin slots, tabs, band rows, toasts, placed rows) */
  ui.html.mod = (name, o) => '<span class="mv-by' + (o && o.class ? ' ' + o.class : '') + '">' + ui.icon('mod', { class: 'mv-by__g' }) + '<span class="mv-by__n">' + esc(name) + '</span></span>';
})();
