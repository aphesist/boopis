/* The UI lab's in-page checks (`pnpm lab:check` injects this file into every frame). Plain browser JavaScript, no
   imports: `window.__labProbe.run(opts)` looks at one state's scope as it is drawn now (the checker forces hover, focus
   and pressed states and switches theme and width around it) and returns findings:
     { check, msg, el, rect: {x, y, w, h} (page coordinates), key (stable, for de-duplication) }
   The checks (docs/UI-LAB.md):
     geometry.contain   a shaped child's box (and its rounded corners) stays inside its shaped container's rounded rect
                        (and is not cut part-way by a scroller on a side it does not scroll)
     geometry.center    items of a control row are vertically centred within 1 px
     geometry.clip      text is not clipped unless it ends in an ellipsis
     geometry.hscroll   no horizontal scroll (the page, or a scroller that is not code)
     geometry.target    hit targets are at least 24 px (WCAG 2.5.8, DESIGN-SYSTEM.md section 15), or spaced as 2.5.8 allows
     geometry.overlap   text painted over other text: two visible text runs in different subtrees whose boxes meet, with nothing opaque
                        above the lower one and neither clipped away (overlays are meant to sit over text and are left out)
     concentric         a shape in a container's corner has equal insets, radius = outer - inset (the preset's --r-floor) or a pill, and
                        never crosses the container's edge, focus ring and hover fill included (section 8.2, 14.10)
     overlay            tooltips, menus and popovers sit outside their anchor with the system's gap, inside the window,
                        aligned as the system says, never over the anchor's container's text field (14.18, 14.19, 14.23)
     tokens.computed    computed colours, font sizes and radii are design-system tokens (section 3)
     tokens.spacing     computed padding, margin and gap are on the spacing scale (a warning: the system names some
                        literal paddings itself)
     native             no unthemed native control (select, date, colour, range, file, number, checkbox and radio drawn
                        by the engine, progress, meter)
     scrollbar          every scroller has the system's scrollbar: a ::-webkit-scrollbar rule (WebKitGTK ignores
                        scrollbar-width) no wider than 8 px and a thumb in --bg-4; and fades an edge it is scrolled off
                        (R-scroll-9): the edge flags match its position and it is masked (or a conversation's ground)
   And two helpers for the stability check: `signature(root)` (the DOM's structure, for render-twice) and
   `sampler(root, {orbs})` (frames of opacity, visibility and boxes during an interaction, plus nodes replaced). */
(() => {
  const SKIP_INSIDE = 'orb-avatar, boopis-logo, svg, canvas, .hx-probe, script, style, template';
  /* visually hidden text (the screen reader's) is not drawn: no geometry, no tokens */
  const SR = '.ui-sr, .sr-only, [class$="-sr"]';
  /* owner decisions that reach past an edge on purpose: an orb's attention flag (orbs stay whole) */
  /* a flag dot sits on its orb's corner; a concave flare lies outside the surface it softens (DESIGN-SYSTEM.md section 8: where the ground meets the frame) */
  const OVERHANG_OK = '.ui-dot--flag, .ui-orb .ui-dot, .ui-concave, .k7-flag';
  const MAX = 4000;
  /* R-space-2's named exceptions, by value (card 14 16, request 10 14, composer 12 14 4 and 6, button 0 14 / 10 / 8, chip 10 8,
     field 6 10, menu 4 and 6 8, popover 12, tooltip 4 8, toast 6 14, segmented 3, stamp 7, code chip 1 5, key chip 4 and 3 apart,
     label 6, settings row 10, dialog head 12 20, body 4 20 24) and R-space-1's 2px in a toolbar */
  const SPACE_NAMED = new Set([1, 2, 3, 5, 6, 7, 10, 14, 20]);
  const px = (v) => parseFloat(v) || 0;
  const r1 = (n) => Math.round(n * 10) / 10;

  /* ───────── colours ───────── */
  const probeEl = () => {
    let p = document.getElementById('__lab_probe');
    if (!p) { p = document.createElement('i'); p.id = '__lab_probe'; p.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;pointer-events:none'; document.documentElement.appendChild(p); }
    return p;
  };
  const rgba = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) { if (c === 'transparent') return [0, 0, 0, 0]; const s = /srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?/.exec(c || ''); return s ? [s[1] * 255, s[2] * 255, s[3] * 255, s[4] == null ? 1 : +s[4]] : null; }
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
  };
  const ckey = (c) => { const v = rgba(c); return v ? v.slice(0, 3).map((x) => Math.round(x)).join(',') + ',' + (Math.round(v[3] * 100) / 100) : String(c); };
  const transparent = (c) => { const v = rgba(c); return !v || v[3] < 0.02; };

  /* token values as they resolve on a ground: the root, or an element that re-derives tokens (the dock's black,
     [data-ground]), so a colour derived on the dock is still a token */
  const tokenCache = new Map();
  const groundOf = (e) => (e && e.closest && e.closest('[data-ui="v7"] [data-theme], [data-ui="v7"][data-theme], [data-ground], [data-hx-preset]:not(html)')) || document.documentElement;   /* an app surface on the kit (data-ui and data-theme on it, w33) is its own ground */   /* a v7 island in the other theme (the dock's dark inside) is its own ground */
  function tokens(names, ground) {
    ground = ground || document.documentElement;
    const de = document.documentElement;
    /* a v7 root (the kit's stories: data-ui="v7" on the body) themes by its own attributes and accent properties */
    const v7 = document.querySelector('[data-ui="v7"]');
    const key = [de.getAttribute('data-hx-preset'), de.getAttribute('data-hx-theme'), de.getAttribute('data-hx-corners'), de.getAttribute('data-hx-density'), de.style.cssText,
      v7 ? [v7.getAttribute('data-theme'), v7.getAttribute('data-radii'), v7.getAttribute('data-shadow'), v7.style.cssText].join(',') : ''].join('|');
    const hit = tokenCache.get(ground);
    if (hit && hit.key === key) return hit;
    const p = document.createElement('i');
    p.style.cssText = 'position:absolute;left:-99px;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden;transition:none !important;animation:none !important';
    (ground === de ? de : ground).appendChild(p);
    const colors = new Set(['0,0,0,0']), lengths = new Set([0]), fs = new Set(), radii = new Set([0]), space = new Set([0]);
    const cs = getComputedStyle(p);
    for (const n of names) {
      const raw = cs.getPropertyValue(n).trim();
      if (!raw) continue;
      if (/^(#|rgb|hsl|color|transparent|var\()/.test(raw) || /rgba?\(|#[0-9a-f]{3,8}\b/i.test(raw)) {
        if (/^(#|rgb|hsl|color|transparent|var\()/.test(raw)) { p.style.color = 'var(' + n + ')'; colors.add(ckey(getComputedStyle(p).color)); }
        for (const m of raw.matchAll(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi)) { p.style.color = m[0]; colors.add(ckey(getComputedStyle(p).color)); }
        p.style.color = '';
      }
      if (/^-?[\d.]+px$/.test(raw) || /^(clamp|calc|max|min)\(/.test(raw)) {
        p.style.width = 'var(' + n + ')';
        const w = px(getComputedStyle(p).width);
        lengths.add(r1(w));
        if (/^--fs-/.test(n)) fs.add(r1(w));
        if (/^--r-/.test(n) || n === '--composer-pad') radii.add(r1(w));
        if (/^--sp-|^--gutter|^--composer-(gap|pad)$|^--pad-|^--ic-gap/.test(n)) space.add(r1(w));
        p.style.width = '1px';
      }
    }
    const families = new Set();
    for (const n of ['--sans', '--mono']) { p.style.fontFamily = 'var(' + n + ')'; const f = getComputedStyle(p).fontFamily.replace(/\s+/g, ' '); if (f) families.add(f); }
    const roles = {};
    for (const n of ['--brass', '--bg-0', '--bg-3', '--red', '--red-text']) { p.style.color = 'var(' + n + ')'; roles[n] = ckey(getComputedStyle(p).color); }
    p.style.color = ''; p.style.fontFamily = '';
    p.remove();
    const t = { key, colors, lengths, fs, radii, space, families, roles };
    tokenCache.set(ground, t);
    return t;
  }


  /* A colour derived from the roles is a token too (R-colour-7: a tint is a color-mix() of a solid role): the same RGB as a
     token at another alpha, or a point on the line between two token colours (a mix of two roles). */
  const mixCache = new Map();
  function derived(T, c) {
    const v = rgba(c); if (!v) return false;
    const k = T.key + '|' + ckey(c);
    if (mixCache.has(k)) return mixCache.get(k);
    const toks = [...T.colors].map((x) => x.split(',').map(Number));
    let ok = toks.some((t) => Math.abs(t[0] - v[0]) <= 1.5 && Math.abs(t[1] - v[1]) <= 1.5 && Math.abs(t[2] - v[2]) <= 1.5);
    for (let i = 0; i < toks.length && !ok; i++) for (let j = i + 1; j < toks.length && !ok; j++) {
      const a = toks[i], b = toks[j], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]; if (len < 9) continue;
      const t = ((v[0] - a[0]) * d[0] + (v[1] - a[1]) * d[1] + (v[2] - a[2]) * d[2]) / len;
      if (t < -0.01 || t > 1.01) continue;
      ok = [0, 1, 2].every((q) => Math.abs(a[q] + t * d[q] - v[q]) <= 2);
    }
    mixCache.set(k, ok);
    return ok;
  }
  /* v7 sets line heights as lengths of its type scale (--lh-2xs to --lh-3xl, DESIGN-SYSTEM.md v7 section 6), not ratios: inside a v7
     root a line height that is one of them is a token */
  let v7Lines = null;
  const v7Line = (e, lh) => {
    const root = e.closest && e.closest('[data-ui="v7"]');
    if (!root) return false;
    if (!v7Lines) { const rs = getComputedStyle(root); v7Lines = new Set(['2xs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl'].map((k) => parseFloat(rs.getPropertyValue('--lh-' + k))).filter((n) => n > 0)); }
    return [...v7Lines].some((n) => Math.abs(n - lh) < 0.05);
  };
  /* bot data, not interface colour: an orb's colour where the system allows it (R-colour-8: orbs, hx-card[data-accent]),
     a swatch of a bot's or a theme's colour drawn from data (an inline colour), a sign-in's or an item's brand mark (ADR-0040) */
  const dataColour = (e, prop) => !!e.closest('hx-card[data-accent], [data-bot-colour], [data-swatch], .bt-swatch, .mod-swatches, .hxt-swatch, .ui-sso__logo, .ui-imark__svg[data-brand], .ui-pub__mark[data-brand]') || (/background|box-shadow/.test(prop) && /#|rgb/.test(e.getAttribute('style') || ''));


  /* in a whole-app state, which fix agent's area an element belongs to (a card in the conversation is the cards area's) */
  const REGIONS = [
    ['cards', 'hx-card, .mod-band, .mod-inline, .mod-status, .mod-tab, .mod-row, .mv-root, [data-mod-log], .ss-mods'],
    ['dock', '#hx-dock'],
    ['settings', '#hx-settings, .hx-first-run, .hxt, [class^="hxt-"]'],
    ['bots', '#hx-view-bots, #hx-list-bots'],
    ['composer', '[data-hx-composer], #hx-view-session, #hx-right-shell'],
    ['shell', '.hx-bar, #hx-side, .hx-palette, #hx-keys-sheet, .ui-menu, .ui-pop, .ui-tip, .ui-toast, .ui-listbox']
  ];
  const regionOf = (el) => { for (const [area, sel] of REGIONS) if (el.closest && el.closest(sel)) return area; return null; };

  /* ───────── element helpers ───────── */
  const describe = (el) => {
    const part = (e) => {
      let s = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}|-[a-z0-9]{6,}$/.test(e.id)) s += '#' + e.id;
      const cls = [...e.classList].filter((c) => !/^is-|^lab-/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const v = e.getAttribute('data-value') || e.getAttribute('data-id') || e.getAttribute('data-act');
      if (v) s += '[' + v.slice(0, 24) + ']';
      return s;
    };
    const parts = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) { parts.unshift(part(e)); if (e.id && i > 0) break; }
    return parts.join(' > ');
  };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r1(r.left + scrollX), y: r1(r.top + scrollY), w: r1(r.width), h: r1(r.height) }; };
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5 && (!el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true })); };
  function elements(scope) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (out.length >= MAX) return;
        if (c.matches(SR)) continue;
        if (c.matches(SKIP_INSIDE)) { if (!c.matches('svg, canvas, script, style, template, .hx-probe')) out.push(c); continue; }
        out.push(c); walk(c);
      }
    };
    if (scope) { out.push(scope); walk(scope); }
    return out;
  }
  /** what paints a shape: a fill, a line, an inset or spread ring, an outline, or a squircle layer */
  function shapeOf(el, cs) {
    cs = cs || getComputedStyle(el);
    const why = [];
    if (!transparent(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none')) why.push('fill');
    if (px(cs.borderTopWidth) + px(cs.borderLeftWidth) > 0 && cs.borderTopStyle !== 'none' && !transparent(cs.borderTopColor)) why.push('border');
    if (cs.boxShadow && cs.boxShadow !== 'none' && !/^rgba\(0, 0, 0, 0\)/.test(cs.boxShadow)) why.push('shadow');
    if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0 && !transparent(cs.outlineColor)) why.push('outline');
    if (el.hasAttribute('data-sq-on')) {
      const b = getComputedStyle(el, '::before'), a = getComputedStyle(el, '::after');
      if (b.content !== 'none' && !transparent(b.backgroundColor)) why.push('sq-fill');
      if (a.content !== 'none' && !transparent(a.backgroundColor)) why.push('sq-line');
    }
    return why;
  }
  const radiiOf = (cs) => [px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius)];
  /** how far a ring reaches past the box: an outline (offset + width), a spread shadow with no blur */
  function ringOf(cs) {
    let out = 0;
    if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0 && !transparent(cs.outlineColor)) out = Math.max(out, px(cs.outlineOffset) + px(cs.outlineWidth));
    if (cs.boxShadow && cs.boxShadow !== 'none') {
      for (const part of cs.boxShadow.split(/,(?![^(]*\))/)) {
        if (/inset/.test(part)) continue;
        const nums = part.replace(/rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]+/gi, '').trim().split(/\s+/).map(px);
        if (nums.length >= 4 && nums[2] === 0 && nums[3] > 0 && !transparent((/rgba?\([^)]*\)/.exec(part) || [''])[0] || 'black')) out = Math.max(out, nums[3] + Math.max(Math.abs(nums[0]), Math.abs(nums[1])));
      }
    }
    return out;
  }
  /** the container's outline as a hit test: its squircle path when one is drawn, else its rounded rect */
  const canvas = document.createElement('canvas').getContext('2d');
  function shapeTest(el, r, radii) {
    const clip = el.style.getPropertyValue('--sq-clip');
    const m = /path\(["']([^"']+)["']\)/.exec(clip || '');
    if (m && window.Path2D) {
      try {
        const p = new Path2D(m[1]);
        return (x, y) => canvas.isPointInPath(p, x - r.left, y - r.top) || canvas.isPointInStroke(p, x - r.left, y - r.top);
      } catch { /* a path the canvas cannot read: the rounded rect below */ }
    }
    return (x, y) => inRounded(x, y, r, radii);
  }
  function inRounded(x, y, r, [tl, tr, br, bl], tol = 0.75) {
    if (x < r.left - tol || x > r.right + tol || y < r.top - tol || y > r.bottom + tol) return false;
    const corner = (cx, cy, rad) => Math.hypot(x - cx, y - cy) <= rad + tol;
    const cap = (v) => Math.min(v, r.width / 2, r.height / 2);
    tl = cap(tl); tr = cap(tr); br = cap(br); bl = cap(bl);
    if (x < r.left + tl && y < r.top + tl) return corner(r.left + tl, r.top + tl, tl);
    if (x > r.right - tr && y < r.top + tr) return corner(r.right - tr, r.top + tr, tr);
    if (x > r.right - br && y > r.bottom - br) return corner(r.right - br, r.bottom - br, br);
    if (x < r.left + bl && y > r.bottom - bl) return corner(r.left + bl, r.bottom - bl, bl);
    return true;
  }
  /** points along a rounded box's outline, the corners sampled finely */
  function outline(r, radii, grow = 0) {
    const x0 = r.left - grow, y0 = r.top - grow, x1 = r.right + grow, y1 = r.bottom + grow, w = x1 - x0, h = y1 - y0;
    const pts = [];
    const cap = (v) => Math.min(v + (v > 0 ? grow : 0), w / 2, h / 2);
    const [tl, tr, br, bl] = radii.map(cap);
    const arc = (cx, cy, rad, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + (Math.PI / 2) * (i / 8); pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } };
    arc(x0 + tl, y0 + tl, tl, Math.PI); arc(x1 - tr, y0 + tr, tr, -Math.PI / 2); arc(x1 - br, y1 - br, br, 0); arc(x0 + bl, y1 - bl, bl, Math.PI / 2);
    pts.push([(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]);
    return pts;
  }
  const clipsContent = (cs) => cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clipPath && cs.clipPath !== 'none' && cs.contain !== 'none' && false);
  const scrolls = (cs) => /auto|scroll/.test(cs.overflowX + cs.overflowY);

  /* ───────── the checks ───────── */
  function run(o) {
    /* a colour or a radius in flight (a preset swap, or a surface that was not drawn when the preset changed and first paints from the old colour)
       is taken to its end first, so R-colour-1 reads the colour a surface rests at and never one half-way. Only colours and corners: a box that
       is travelling (a sidebar, a menu) keeps travelling, and what closes when its anchor leaves is the app's to do in its own time. */
    for (const a of document.getAnimations()) if (a instanceof CSSTransition && /color|background|shadow|outline|fill|stroke|radius/.test(a.transitionProperty)) { try { a.finish(); } catch { /* an animation that cannot finish is left */ } }
    const scope = o.scope ? document.querySelector(o.scope) : (window.__lab && window.__lab.scope && window.__lab.scope()) || document.body;
    if (!scope) return { error: 'no scope', findings: [] };
    const want = new Set(o.checks || ['geometry.contain', 'geometry.center', 'geometry.clip', 'geometry.hscroll', 'geometry.target', 'geometry.overlap', 'concentric', 'overlay', 'tokens.computed', 'tokens.spacing', 'native', 'scrollbar', 'brand', 'copy', 'roles', 'inline-baseline']);
    const els = elements(scope).filter((e) => shown(e));
    const cs = new Map(els.map((e) => [e, getComputedStyle(e)]));
    const shapes = new Map();
    for (const e of els) { const s = shapeOf(e, cs.get(e)); if (s.length) shapes.set(e, s); }
    const out = [];
    const add = (check, el, msg, extra) => out.push({ check, el: describe(el), label: label(el), msg, rect: rectOf(el), key: check + '|' + describe(el) + '|' + msg.replace(/[\d.]+px|[\d.]+ px/g, 'N'), ...(window.__lab && window.__lab.app ? { region: regionOf(el) } : {}), ...extra });
    const shapedParent = (e) => { for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) { if (shapes.has(p)) return p; if (p === scope.parentElement) return null; } return null; };
    const fixed = (e) => { for (let p = e; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return p; return null; };

    /* geometry.contain and concentric */
    if (want.has('geometry.contain') || want.has('concentric')) {
      for (const [e, why] of shapes) {
        if (e === scope) continue;
        const c = shapedParent(e);
        if (!c) continue;
        const ecs = cs.get(e), ccs = cs.get(c) || getComputedStyle(c);
        if (ecs.position === 'fixed' && fixed(c) !== c && !c.contains(e)) continue;
        /* clipped between them: a scroller hides what it scrolls; overflow hidden is a cut, reported as such */
        let clipper = null;
        for (let p = e.parentElement; p && p !== c.parentElement; p = p.parentElement) { const pcs = cs.get(p) || getComputedStyle(p); if (clipsContent(pcs)) { clipper = p; break; } }
        const er = e.getBoundingClientRect(), cr = c.getBoundingClientRect();
        const eRad = radiiOf(ecs), cRad = radiiOf(ccs);
        const ring = ringOf(ecs);
        if (clipper && scrolls(cs.get(clipper) || getComputedStyle(clipper))) continue;
        const selfClip = clipper === c || (ccs.clipPath && ccs.clipPath !== 'none');   /* the container clips to its own shape: nothing shows past it */
        if (e.matches(OVERHANG_OK)) continue;
        const inside = shapeTest(c, cr, cRad);
        const pts = outline(er, eRad, ring);
        const outside = pts.filter(([x, y]) => !inside(x, y));
        if (want.has('geometry.contain') && outside.length && !selfClip) {
          const far = Math.max(...outside.map(([x, y]) => Math.max(cr.left - x, x - cr.right, cr.top - y, y - cr.bottom, 0)));
          const msg = (clipper ? 'cut by ' + describe(clipper) + ': ' : '') + 'reaches outside ' + describe(c) + (far > 0.5 ? ' by ' + r1(far) + 'px' : ' at its rounded corner') + (ring ? ' (with its ' + r1(ring) + 'px ring)' : '') + ' [' + why.join(',') + ']';
          add('geometry.contain', e, msg, { container: rectOf(c) });
        }
        /* boards 11 and S17 (screens.js `chrome`, the search hint: "Search" and its key chips in a 36 row, padding 0 10): the chips (radius 4) stand at its end, 10 in and 8
           down: the boards win over the concentric corner (REPASS rule 7) */
        /* the composer's Stop is the owner's (25 November): a tinted 28 circle with a filled rounded square. The square is the control's
           glyph, drawn as a shape, not a surface set into the circle's corner */
        if (want.has('concentric') && !e.matches('.k7-search-hint .k7-kbd, .k7-composer__stop-glyph')) {
          /* the floor is the corners setting's (--r-floor: 4 sharp, 8 default, 12 round; v7's 6), not a constant (R-corner-3: max(--r-floor, R - gap)) */
          const FLOOR = px(ccs.getPropertyValue('--r-floor')) || px(getComputedStyle(document.documentElement).getPropertyValue('--r-floor')) || 8;   /* the container's: a v7 root sets 6 */
          const corners = [['top-left', er.left - cr.left, er.top - cr.top, 0], ['top-right', cr.right - er.right, er.top - cr.top, 1], ['bottom-right', cr.right - er.right, cr.bottom - er.bottom, 2], ['bottom-left', er.left - cr.left, cr.bottom - er.bottom, 3]];
          for (const [name, dx, dy, i] of corners) {
            const R = Math.min(cRad[i], cr.width / 2, cr.height / 2);
            if (R < FLOOR) continue;
            if (dx < -0.5 || dy < -0.5 || dx >= R || dy >= R) continue;   /* not in this corner (or already outside: geometry.contain) */
            const inset = Math.min(dx, dy);
            if (selfClip && inset < 1) continue;   /* a full-bleed layer inside a clipped leaf: the clip draws its corner */
            const pillR = Math.min(er.width, er.height) / 2;
            const r = Math.min(eRad[i], pillR);
            const want8 = Math.max(FLOOR, R - inset);
            const isPill = r >= pillR - 0.5;
            const problems = [];
            /* a mark (a status dot, a page dot: under 12px) is carried by its row, not set into the corner as a control: it only has to keep the container's --pad from both edges (R-corner-4) */
            const mark = Math.min(er.width, er.height) < 12, padC = px(ccs.getPropertyValue('--pad'));
            /* a piece set into a line of text (the blank in a sentence) is placed by the line breaking, which moves with the font, not set
               into the corner: like a mark it only has to keep the container's --pad from both edges (R-corner-4), and its radius is its own */
            const inText = /^inline/.test(getComputedStyle(e).display) && !/flex|grid/.test(getComputedStyle(e.parentElement || e).display) && !!e.closest('p, li, article');
            if (Math.abs(dx - dy) > 1 && !((mark || inText) && Math.min(dx, dy) >= padC - 1)) problems.push('insets ' + r1(dx) + 'px and ' + r1(dy) + 'px are not equal');
            if (!inText && Math.abs(r - want8) > 1 && !(isPill && want8 >= pillR - 1)) problems.push('radius ' + r1(r) + 'px, the corner wants ' + r1(want8) + 'px (' + r1(R) + ' - ' + r1(inset) + (R - inset < FLOOR ? ', floor ' + FLOOR : '') + ')' + (isPill ? ' or a pill of ' + r1(pillR) + 'px' : ''));
            if (problems.length) add('concentric', e, 'in the ' + name + ' corner of ' + describe(c) + ': ' + problems.join('; ') + ' [' + why.join(',') + ']', { container: rectOf(c) });
          }
        }
      }
    }

    /* geometry.center: control rows (flex rows up to 64px tall) */
    if (want.has('geometry.center')) {
      for (const e of els) {
        const s = cs.get(e);
        if (!/flex/.test(s.display) || /column/.test(s.flexDirection) || e.matches('svg, orb-avatar')) continue;
        /* a row that sets its items on its last line is not a centred row: the kit Composer's box keeps its buttons beside the last line
           of a draft of several lines (thread.css `.k7-composer__box`: align-items flex-end; one line, the boards': they are centred) */
        if (/^(flex-)?end$/.test(s.alignItems)) continue;
        const r = e.getBoundingClientRect();
        if (r.height > 64 || r.height < 8) continue;
        const kids = [...e.children].filter((k) => shown(k) && !/absolute|fixed/.test(getComputedStyle(k).position) && !k.matches('.ui-sr'));
        if (kids.length < 2) continue;
        const boxes = kids.map((k) => k.getBoundingClientRect());
        /* wrapped onto lines: some item sits wholly below another (lines of unequal height put the later line's top above the row's middle) */
        if (s.flexWrap !== 'nowrap' && boxes.some((a) => boxes.some((b) => a.top >= b.bottom - 0.5))) continue;
        const top = r.top + px(s.paddingTop) + px(s.borderTopWidth), bottom = r.bottom - px(s.paddingBottom) - px(s.borderBottomWidth);
        const mid = (top + bottom) / 2;
        for (const k of kids) {
          const kr = k.getBoundingClientRect();
          const kcs = getComputedStyle(k);
          /* boards 11 and S17 (screens.js `chrome`, kit.css `.wc`): the window's own glyphs stand in their 32 by 28 cells 4 above the middle of
             the chrome's end row, beside the 36 controls: the boards win (REPASS rule 7) */
          if (k.matches('.k7-chrome__wc')) continue;
          if (kcs.alignSelf === 'flex-start' || kcs.alignSelf === 'flex-end' || kcs.alignSelf === 'baseline' || (/^(auto|normal)$/.test(kcs.alignSelf) && /baseline/.test(s.alignItems))) continue;
          const off = (kr.top + kr.bottom) / 2 - mid;
          if (Math.abs(off) > 1) { add('geometry.center', k, 'sits ' + r1(Math.abs(off)) + 'px ' + (off > 0 ? 'below' : 'above') + ' the centre of its row ' + describe(e)); }
        }
      }
    }

    /* geometry.contain, cut: a control that shows in part because a box above it cuts it on a side that box does not scroll.
       The owner's Store dialog cut its switches, search field and Details buttons at the right edge, and the lab passed: its
       scroller was wider than the dialog's card, so the switch sat whole inside the nearest clipper, and the card (overflow
       hidden, not a scroller) cut it. Every clipping box from the control up is followed, keeping what stays visible: a part a
       box scrolls away is hidden by scrolling (fine), a part a box that does not scroll that way cuts off, while some of the
       control still shows, is reported. A control wholly out of view (a closed drawer) is not. */
    if (want.has('geometry.contain')) {
      const CONTROL = 'button, a[href], input, textarea, select, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="slider"], [role="combobox"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
      for (const e of els) {
        if (!e.matches(CONTROL) || e.matches(OVERHANG_OK)) continue;
        const r0 = e.getBoundingClientRect();
        let v = { l: r0.left, r: r0.right, t: r0.top, b: r0.bottom };
        let worst = null;
        for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const acs = cs.get(a) || getComputedStyle(a);
          if (!clipsContent(acs)) continue;
          const ar = a.getBoundingClientRect();
          const axes = [['x', 'l', 'r', ar.left, ar.right, acs.overflowX], ['y', 't', 'b', ar.top, ar.bottom, acs.overflowY]];
          for (const [, lo, hi, alo, ahi, ov] of axes) {
            if (v[lo] >= alo - 1 && v[hi] <= ahi + 1) continue;
            const shows = v[lo] < ahi && v[hi] > alo;
            if (shows && !/auto|scroll/.test(ov)) {
              const pastHi = v[hi] - ahi, pastLo = alo - v[lo];
              const [side, by] = pastHi >= pastLo ? [lo === 'l' ? 'right' : 'bottom', pastHi] : [lo === 'l' ? 'left' : 'top', pastLo];
              if (by > 1 && (!worst || by > worst.by)) worst = { a, side, by };
            }
            v[lo] = Math.max(v[lo], alo); v[hi] = Math.min(v[hi], ahi);
          }
          if (v.l >= v.r || v.t >= v.b) { worst = null; break; }   /* wholly out of view */
        }
        if (worst) add('geometry.contain', e, 'cut by ' + describe(worst.a) + ', which does not scroll that way: ' + r1(worst.by) + 'px past its ' + worst.side + ' edge', { container: rectOf(worst.a) });
      }
    }

    /* geometry.clip: text cut without an ellipsis */
    if (want.has('geometry.clip')) {
      for (const e of els) {
        const s = cs.get(e);
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        if (scrolls(s) || e.isContentEditable || e.matches('input, textarea')) continue;
        const hx = s.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1;
        const oneLine = s.textOverflow === 'ellipsis' && /nowrap|pre/.test(s.whiteSpace);
        const vy = s.overflowY !== 'visible' && e.scrollHeight > e.clientHeight + (oneLine ? 3 : 1) && s.webkitLineClamp === 'none';
        if (hx && s.textOverflow !== 'ellipsis') add('geometry.clip', e, 'text cut on the right with no ellipsis (' + e.scrollWidth + ' > ' + e.clientWidth + 'px)');
        if (vy) add('geometry.clip', e, 'text cut at the bottom (' + e.scrollHeight + ' > ' + e.clientHeight + 'px)');
        /* an ellipsis on a node that clips nothing horizontally but loses lines is fine; an ancestor that cuts it off is not */
        for (let p = e.parentElement; p && p !== scope.parentElement; p = p.parentElement) {
          const pcs = getComputedStyle(p);
          if (pcs.overflowX === 'visible' && pcs.overflowY === 'visible') continue;
          if (scrolls(pcs)) break;
          const pr = p.getBoundingClientRect(), er = e.getBoundingClientRect();
          if (er.right > pr.right + 1 && pcs.textOverflow !== 'ellipsis' && s.textOverflow !== 'ellipsis' && er.left < pr.right) add('geometry.clip', e, 'text runs ' + r1(er.right - pr.right) + 'px past ' + describe(p) + ', which cuts it');
          break;
        }
      }
    }

    /* geometry.hscroll */
    if (want.has('geometry.hscroll')) {
      const se = document.scrollingElement;
      if (se.scrollWidth > innerWidth + 1) add('geometry.hscroll', document.body, 'the window scrolls sideways (' + se.scrollWidth + 'px content in ' + innerWidth + 'px)');
      for (const e of els) {
        const s = cs.get(e);
        if (!/auto|scroll/.test(s.overflowX) || e.scrollWidth <= e.clientWidth + 1) continue;
        if (e.matches('pre, code, .ui-code, [class*="__pre"], [class*="term"], .mod-tabs, .ui-tabs--scroll, [data-lab-hscroll], [data-kit~="DiffView"] .ui-scroll') || e.closest('pre')) continue;
        add('geometry.hscroll', e, 'scrolls sideways (' + e.scrollWidth + 'px content in ' + e.clientWidth + 'px)');
      }
    }

    /* geometry.target */
    if (want.has('geometry.target')) {
      const HIT = px(getComputedStyle(document.documentElement).getPropertyValue('--hit-min')) || 24;
      /* a target that an ancestor's overflow clips away entirely (scrolled out of its list or panel) cannot be pressed: it is not a target now (R-a11y-2 measures what the user can hit) */
      const scrolledAway = (e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        let own = getComputedStyle(e).position, wait = own === 'absolute';   /* an absolute box is clipped only by what is, or sits inside, its containing block */
        if (own === 'fixed') return false;
        for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (wait) { if (cs.position === 'static') continue; wait = false; }
          if (cs.position === 'fixed') return false;
          if (cs.position === 'absolute') wait = true;
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const c = p.getBoundingClientRect();
          if (r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) return true;
        }
        return false;
      };
      /* a target another layer covers at its centre (a card under an open sheet or dialog) cannot be pressed either; a point outside the window is not tested */
      const covered = (e) => {
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (r.width === 0 || r.height === 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const h = document.elementFromPoint(x, y);
        if (!h || e.contains(h) || h.contains(e)) return false;
        const lab = h.closest && h.closest('label');
        return !(lab && lab.control === e);
      };
      const targets = els.filter((e) => e.matches('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="switch"], [role="radio"], [role="checkbox"]') && !e.closest('[inert], [aria-hidden="true"]') && !e.disabled && !scrolledAway(e) && !covered(e));
      /* what the user can hit: the element's box united with an absolutely positioned ::before / ::after that takes pointer events (R-a11y-2: a mark smaller than --hit-min gets a hit area of 24 around it) */
      const hitBox = (t) => {
        const r = t.getBoundingClientRect();
        let l = r.left, tp = r.top, rt = r.right, b = r.bottom;
        for (const ps of ['::before', '::after']) {
          const cs = getComputedStyle(t, ps);
          if (cs.content === 'none' || cs.content === 'normal' || cs.position !== 'absolute' || cs.pointerEvents === 'none' || cs.display === 'none') continue;
          const w = px(cs.width), h = px(cs.height), x = px(cs.left), y = px(cs.top);
          if (![w, h, x, y].every(Number.isFinite)) continue;
          const pl = r.left + t.clientLeft + x, pt = r.top + t.clientTop + y;
          l = Math.min(l, pl); tp = Math.min(tp, pt); rt = Math.max(rt, pl + w); b = Math.max(b, pt + h);
        }
        return { left: l, top: tp, right: rt, bottom: b, width: rt - l, height: b - tp };
      };
      const boxes = targets.map(hitBox);
      targets.forEach((t, i) => {
        const r = boxes[i];
        if (r.width >= HIT - 0.01 && r.height >= HIT - 0.01) return;
        if (t.matches('a') && t.closest('p, li') && getComputedStyle(t).display === 'inline') return;   /* a link in a sentence: 2.5.8's inline exception */
        if (t.matches('button') && /^inline/.test(getComputedStyle(t).display) && t.closest('p, li, article')) return;   /* a button set into a sentence (the blank's gap): the same inline exception, its size is set by the line */
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const clash = boxes.some((b, j) => j !== i && Math.max(b.left - cx, 0, cx - b.right) ** 2 + Math.max(b.top - cy, 0, cy - b.bottom) ** 2 < 12 * 12);
        if (clash) add('geometry.target', t, 'target ' + r1(r.width) + ' x ' + r1(r.height) + 'px, under --hit-min (' + HIT + 'px) and too close to another target');
      });
    }

    /* overlay placement */
    if (want.has('overlay')) {
      const layers = [];
      const ov = o.overlay || (window.__lab && window.__lab.overlay);
      if (ov) { const a = document.querySelector(ov.anchor), l = [...document.querySelectorAll(ov.layer)].find(shown); const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && shown(e) && ((h) => !!h && (h === e || e.contains(h)))(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); };
        /* an anchor that is not on screen (a drawer that is closed at this width: off the screen, or clipped by it) cannot hold an overlay open: the app closed it with the drawer, there is nothing to place */
        if (a && !l && !onScreen(a)) { /* nothing to check */ } else if (!a || !l) add('overlay', a || scope, 'the overlay did not open (' + ov.layer + ' against ' + ov.anchor + ')'); else layers.push([a, l]); }
      else {
        const tip = [...document.querySelectorAll('.ui-tip.is-in')].find(shown);
        const ta = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-tip]');
        if (tip && ta) layers.push([ta, tip]);
        for (const l of document.querySelectorAll('.ui-menu:not([data-static]), .ui-pop, .ui-listbox')) { const a = document.querySelector('[aria-expanded="true"][aria-haspopup]'); if (a && shown(l)) layers.push([a, l]); }
      }
      for (const [a, l] of layers) {
        const ar = a.getBoundingClientRect(), lr = l.getBoundingClientRect();
        const isTip = l.matches('.ui-tip');
        const inter = !(lr.right <= ar.left || lr.left >= ar.right || lr.bottom <= ar.top || lr.top >= ar.bottom);
        if (inter) add('overlay', l, 'covers its anchor ' + describe(a));
        const W = innerWidth, H = innerHeight, rootCs = getComputedStyle(document.documentElement);
        const m = px(rootCs.getPropertyValue('--float-margin')) || 8, fgap = px(rootCs.getPropertyValue('--float-gap')) || 8;
        if (lr.left < m - 1 || lr.top < m - 1 || lr.right > W - m + 1 || lr.bottom > H - m + 1) add('overlay', l, 'leaves the window\'s ' + m + 'px margin (' + [r1(lr.left), r1(lr.top), r1(W - lr.right), r1(H - lr.bottom)].join(', ') + ')');
        const below = lr.top >= ar.bottom - 1, above = lr.bottom <= ar.top + 1, right = lr.left >= ar.right - 1;
        const gap = below ? lr.top - ar.bottom : above ? ar.top - lr.bottom : right ? lr.left - ar.right : NaN;
        const wantGap = fgap;   /* R-float-1 (approved, 19 November 2026): 8 on every side, a tooltip to the right of the rail too (the mock's 10 was F45) */
        const clampedY = lr.top <= m + 0.5;
        /* R-tip-2: an anchor inside a container that holds a text field (the composer's attach, chips, mic and send) names what must stay
           visible in data-overlay-avoid, and its overlay sits outside that container, --float-gap beyond its near edge: the gap is then
           measured to the nearest avoided rect on the overlay's side of it, not to the anchor (the anchor is inside the container). The
           overlay still may not cover the text (the field check below) and must clear the container by exactly the gap. */
        let avoidGap = NaN;
        const avoidHost = a.closest('[data-overlay-avoid]'), avoidSel = avoidHost && avoidHost.getAttribute('data-overlay-avoid');
        if (avoidSel && (below || above)) for (const e of avoidHost.querySelectorAll(avoidSel)) {
          if (!shown(e) || e.contains(a)) continue;
          const er = e.getBoundingClientRect(), g = below ? lr.top - er.bottom : er.top - lr.bottom;
          if (g >= -1 && (Number.isNaN(avoidGap) || g < avoidGap)) avoidGap = g;
        }
        const clearsContainer = !Number.isNaN(avoidGap) && Math.abs(avoidGap - fgap) <= 1;
        if (!Number.isNaN(gap) && Math.abs(gap - wantGap) > 1 && !clampedY && !clearsContainer) add('overlay', l, 'sits ' + r1(gap) + 'px from its anchor, the system says ' + wantGap + 'px');
        if (Number.isNaN(gap) && !inter) add('overlay', l, 'is neither above, below nor to the right of its anchor');
        const clampedX = lr.left <= m + 0.5 || lr.right >= W - m - 0.5;
        if (isTip && (below || above) && !clampedX && Math.abs((lr.left + lr.right) / 2 - (ar.left + ar.right) / 2) > 1) add('overlay', l, 'is not centred on its anchor (' + r1((lr.left + lr.right) / 2 - (ar.left + ar.right) / 2) + 'px off)');
        if (isTip && right && Math.abs((lr.top + lr.bottom) / 2 - (ar.top + ar.bottom) / 2) > 1 && !clampedY) add('overlay', l, 'is not centred beside its anchor');
        if (!isTip && (below || above) && !clampedX) {
          const fits = [ar.left - 8, ar.left, ar.right - lr.width, (ar.left + ar.right) / 2 - lr.width / 2].some((x) => Math.abs(x - lr.left) <= 1);
          if (!fits) add('overlay', l, 'is aligned to neither its anchor\'s start (inset 8), end nor centre');
        }
        if (isTip) {
          const tipText = (l.querySelector('span') || l).textContent.trim();
          const name = (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ');
          if (tipText && name && tipText.toLowerCase() !== name.toLowerCase() && !name.toLowerCase().startsWith(tipText.toLowerCase())) add('overlay', l, 'says "' + tipText.slice(0, 40) + '" but its control is named "' + name.slice(0, 40) + '" (a tooltip repeats the accessible name, R-copy-7)');
        }
        if (isTip && (below || above)) {
          const ideal = below ? 'bottom' : 'top';
          const nearBottom = ar.top > H - 160;
          if ((ideal === 'top') !== nearBottom && !a.getAttribute('data-tip-pos')) add('overlay', l, 'opens ' + (ideal === 'top' ? 'above' : 'below') + ' its anchor; the system opens tooltips below, above only within 160px of the window bottom');
        }
        const host = a.closest('[data-hx-composer], .ui-field, hx-card, .ui-pop, dialog, .hx-palette__box, form') || a.parentElement;
        if (l.matches('.ui-listbox') && a.matches('.ui-select, [role="combobox"]')) { /* a select's list opens under its own field */ }
        for (const f of host ? host.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]') : []) {
          if (f === a || !shown(f)) continue;
          const fr = f.getBoundingClientRect();
          if (!(lr.right <= fr.left || lr.left >= fr.right || lr.bottom <= fr.top || lr.top >= fr.bottom)) add('overlay', l, 'covers the text field ' + describe(f) + ' of its anchor\'s container');
        }
      }
    }

    /* tokens */
    if (want.has('tokens.computed') || want.has('tokens.spacing')) {
      const seen = new Set();
      const stray = (check, e, prop, val) => { const k = prop + val + [...e.classList].slice(0, 2).join('.'); if (seen.has(k)) return; seen.add(k); add(check, e, prop + ' ' + val + ' is not a design-system token'); };
      for (const e of els) {
        if (e.closest('orb-avatar, .ui-orb, [data-lab-literal], .mv-root [style]') || e === scope && scope.classList.contains('lab-stage')) continue;
        const s = cs.get(e);
        const T = tokens(o.tokenNames || [], groundOf(e));
        if (want.has('tokens.computed')) {
          const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          const colorProps = [['color', hasText], ['background-color', true], ['border-top-color', px(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'], ['outline-color', s.outlineStyle !== 'none' && px(s.outlineWidth) > 0], ['fill', e.matches('svg *, svg')], ['stroke', e.matches('svg *, svg') && s.stroke !== 'none']];
          for (const [prop, applies] of colorProps) {
            if (!applies) continue;
            const v = s.getPropertyValue(prop);
            if (!v || v === 'none' || transparent(v) || /^url/.test(v)) continue;
            if (!T.colors.has(ckey(v)) && !derived(T, v) && !dataColour(e, prop)) stray('tokens.computed', e, prop, v);
          }
          if (s.boxShadow && s.boxShadow !== 'none') for (const m of s.boxShadow.matchAll(/rgba?\([^)]+\)|color\(srgb[^)]+\)/g)) if (!transparent(m[0]) && !T.colors.has(ckey(m[0])) && !derived(T, m[0]) && !dataColour(e, 'box-shadow')) { stray('tokens.computed', e, 'box-shadow colour', m[0]); break; }
          if (hasText && !T.fs.has(r1(px(s.fontSize)))) stray('tokens.computed', e, 'font-size', s.fontSize);
          if (hasText && T.families.size && !T.families.has(s.fontFamily.replace(/\s+/g, ' '))) stray('tokens.computed', e, 'font-family', s.fontFamily.split(',')[0] + ' (not --sans or --mono, R-type-1)');
          if (hasText && s.lineHeight !== 'normal' && !v7Line(e, px(s.lineHeight))) { const ratio = Math.round(px(s.lineHeight) / px(s.fontSize) * 100) / 100; if (![1, 1.2, 1.35, 1.45, 1.5, 1.6].some((x) => Math.abs(x - ratio) < 0.03)) stray('tokens.computed', e, 'line-height', s.lineHeight + ' (' + ratio + ', not a --lh-* ratio, R-type-4)'); }
          if (hasText && /uppercase|capitalize/.test(s.textTransform)) stray('tokens.computed', e, 'text-transform', s.textTransform + ' (sentence case only; --ui-case lowers, R-copy-1)');
          const r = e.getBoundingClientRect(), pill = Math.min(r.width, r.height) / 2;
          for (const v of radiiOf(s)) {
            if (v === 0 || v >= 999 || T.radii.has(r1(v)) || Math.abs(v - pill) < 0.6) continue;
            const ctx = ['--r-in', '--r-outer', '--r', '--r-card'].map((n) => px(s.getPropertyValue(n))).filter(Boolean);
            if (ctx.some((c) => Math.abs(c - v) < 0.6)) continue;
            stray('tokens.computed', e, 'border-radius', v + 'px');
            break;
          }
        }
        if (want.has('tokens.spacing')) {
          for (const prop of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'row-gap', 'column-gap']) {
            const v = s.getPropertyValue(prop);
            if (!/px$/.test(v)) continue;
            const n = r1(px(v));
            if (n === 0 || T.space.has(n) || SPACE_NAMED.has(n)) continue;
            /* words trimmed to their cap height and baseline (`text-box`) centred in a chip: half of what the chip's height leaves, measured
               from the font in use (calc(... - 1cap) / 2), so its value follows the font and is not a step (inline-baseline) */
            if (/^padding-(top|bottom)$/.test(prop) && s.textBoxTrim && s.textBoxTrim !== 'none') continue;
            if (/gap/.test(prop) && !/flex|grid/.test(s.display)) continue;
            /* R-layout-5: a scroller that runs under the composer or the dock pads its end by their height, a sum of live heights and not a step.
               The pad may sit on the scroller or on the column that fills it (the thread's .ss-col inside .ss-scroll); either way the band
               that matters is the scroller's visible end */
            const scroller = /auto|scroll/.test(s.overflowY) ? e : (e.parentElement && /auto|scroll/.test(getComputedStyle(e.parentElement).overflowY) ? e.parentElement : null);
            if (prop === 'padding-bottom' && scroller) {
              const r = scroller.getBoundingClientRect();
              if ([...document.querySelectorAll('[data-kit~="Composer"], .bt-composer-zone, #hx-dock')].some((f) => { const q = f.getBoundingClientRect(); return q.height > 0 && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.bottom - n; })) continue;
            }
            stray('tokens.spacing', e, prop, v);
          }
        }
      }
    }

    /* brand: the app never names its engine to the user (owner rule, ADR-0031, R-copy-8), except a plugin store item under its own name or publisher */
    if (want.has('brand')) {
      const allow = (o.brandAllow || []).join(', ');
      const ok = (e) => !!(allow && e.closest && e.closest(allow));
      const ATTRS = ['aria-label', 'aria-description', 'title', 'placeholder', 'data-placeholder', 'data-tip', 'alt', 'aria-roledescription', 'aria-valuetext'];
      const seen = new Set();
      const hit = (e, where, text) => { const k = where + describe(e); if (seen.has(k)) return; seen.add(k); add('brand', e, where + ' says "' + text.trim().replace(/\s+/g, ' ').slice(0, 90) + '"; the app never names its engine (ADR-0031, R-copy-8)'); };
      const roots = [scope, ...document.querySelectorAll('.ui-tip.is-in, .ui-menu, .ui-pop, .ui-toast')].filter((r, i, a) => r && a.indexOf(r) === i && (i === 0 || !scope.contains(r)));
      for (const r of roots) {
        const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          const e = n.parentElement;
          if (!e || e.closest('script, style, .hx-probe, [hidden]') || !/hermes/i.test(n.textContent) || ok(e)) continue;
          if (!e.closest('.ui-sr') && !shown(e)) continue;
          hit(e, 'text', n.textContent);
        }
        for (const e of [r, ...r.querySelectorAll('*')]) {
          if (ok(e)) continue;
          for (const a of ATTRS) { const v = e.getAttribute(a); if (v && /hermes/i.test(v)) hit(e, a, v); }
          if (e.matches('input, textarea') && /hermes/i.test(e.value || '')) hit(e, 'value', e.value);
        }
      }
    }

    /* copy: what the engine says never reaches the interface (R-copy-6's machine half, R-copy-9) */
    if (want.has('copy')) {
      const BAD = /\b(undefined|NaN)\b|\[object Object\]|Traceback \(most recent|^\s*at \S+ \(.*:\d+:\d+\)|\bhx\.[a-z]+\.[a-z_.]+\b|\{"\w+":/;
      const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const e = n.parentElement;
        if (!e || e.closest('script, style, code, pre, .ui-code, [class*="__pre"], [class*="term"], [data-lab-literal]') || !shown(e)) continue;
        const m = BAD.exec(n.textContent);
        if (m && !seen.has(e)) { seen.add(e); add('copy', e, 'shows "' + m[0].trim().slice(0, 40) + '": an engine value or error reached the interface'); }
      }
    }
    /* roles: brass marks, never text (R-colour-3); never inset on inset, never raised on raised (R-colour-4) */
    if (want.has('roles')) {
      for (const e of els) {
        const s = cs.get(e), T = tokens(o.tokenNames || [], groundOf(e));
        if (!T.roles) continue;
        const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (hasText && ckey(s.color) === T.roles['--brass'] && !e.closest('[role="menuitemradio"], [aria-current], .ui-ladder')) add('roles', e, 'text in --brass: brass marks position and choice, never text (R-colour-3)');
        const bg = ckey(s.backgroundColor);
        /* board S37 (kit.css `.ns-hello`): the ways an offer holds are the boards' own buttons, drawn on the offer's raised ground and told
           from it by their line: the board wins (REPASS rule 7) */
        const offered = e.matches('.k7-block[data-variant="offer"] [data-kit~="Button"]');
        if (!offered && (bg === T.roles['--bg-0'] || bg === T.roles['--bg-3'])) {
          for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
            let pb = getComputedStyle(p).backgroundColor;
            /* a drawn shape (the squircle) paints its fill from --sq-bg and leaves background-color clear: that fill is its surface */
            if (transparent(pb) && shapes.has(p)) { const sq = getComputedStyle(p).getPropertyValue('--sq-bg').trim(); if (sq) { const q = probeEl(); q.style.cssText += ';transition:none !important;color:' + sq; pb = getComputedStyle(q).color; } }
            if (transparent(pb)) continue;
            if (ckey(pb) === bg) add('roles', e, (bg === T.roles['--bg-0'] ? 'inset (--bg-0) on inset' : 'raised (--bg-3) on raised') + ': ' + describe(p) + ' paints the same (R-colour-4)');
            break;
          }
        }
      }
    }

    /* native controls */
    if (want.has('native')) {
      for (const e of scope.querySelectorAll('select, input, textarea, progress, meter, datalist, details > summary')) {
        if (!shown(e) && !e.matches('datalist')) continue;
        const s = getComputedStyle(e), t = (e.getAttribute('type') || 'text').toLowerCase();
        let why = null;
        if (e.matches('select')) why = 'a native select';
        else if (e.matches('progress, meter')) why = 'a native ' + e.tagName.toLowerCase();
        else if (e.matches('datalist')) why = 'a native datalist';
        else if (e.matches('summary') && s.display === 'list-item') why = 'a native disclosure marker';
        else if (['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'file', 'number'].includes(t)) why = 'a native ' + t + ' input';
        else if ((t === 'checkbox' || t === 'radio') && s.appearance !== 'none' && s.webkitAppearance !== 'none') why = 'a ' + t + ' drawn by the engine';
        else if (e.matches('textarea') && s.resize !== 'none') why = 'a textarea with the engine\'s resize grip (R-field-4)';
        if (why) add('native', e, why + ' (the design system draws its own; the UI-controls work replaces these)');
      }
    }

    /* scrollbars */
    if (want.has('scrollbar')) {
      const rules = scrollbarRules();
      const candidates = [document.documentElement, ...els];
      for (const e of candidates) {
        const s = e === document.documentElement ? getComputedStyle(e) : cs.get(e);
        const isRoot = e === document.documentElement;
        const overflowY = isRoot ? e.scrollHeight > innerHeight + 1 : /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
        const overflowX = isRoot ? false : /auto|scroll/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1;
        if (!overflowY && !overflowX) continue;
        /* the edge fade (R-scroll-9): a scroller scrolled off an edge fades that edge. The flags are scroll-edges.ts's and the
           mask the kit's; a conversation (.ui-scroll--ground) fades with strips of its ground instead (session.css, bots.css) */
        if (!isRoot && e.classList.contains('ui-scroll')) {
          const more = { top: overflowY && e.scrollTop > 1, bottom: overflowY && e.scrollTop + e.clientHeight < e.scrollHeight - 1, left: overflowX && e.scrollLeft > 1, right: overflowX && e.scrollLeft + e.clientWidth < e.scrollWidth - 1 };
          const wrong = Object.entries(more).filter(([k, v]) => v !== e.hasAttribute('data-more-' + k)).map(([k]) => k);
          if (wrong.length) add('scrollbar', e, 'its edge-fade flags do not match where it is scrolled (' + wrong.join(', ') + '): scroll-edges.ts did not see it (R-scroll-9)');
          else if (Object.values(more).some(Boolean) && !e.classList.contains('ui-scroll--ground')) {
            const m = s.maskImage || s.webkitMaskImage || '';
            if (!m || m === 'none') add('scrollbar', e, 'more lies beyond an edge, and the edge is a straight cut: no fade (R-scroll-9)');
          }
        }
        const bar = rules.bar.filter((r) => matchesBase(e, r.base));
        const thumb = rules.thumb.filter((r) => matchesBase(e, r.base));
        const hidden = bar.some((r) => r.display === 'none' || r.width === '0px');
        if (hidden) continue;
        if (!isRoot && s.overscrollBehaviorY !== 'contain' && s.overscrollBehaviorY !== 'none' && overflowY) add('scrollbar', e, 'an inner scroller without overscroll-behavior: contain (R-scroll-8)');
        if (!bar.length) { add('scrollbar', e, 'scrolls with the engine\'s own scrollbar: no ::-webkit-scrollbar rule (WebKitGTK ignores scrollbar-width' + (s.scrollbarWidth && s.scrollbarWidth !== 'auto' ? ', which this sets to ' + s.scrollbarWidth : '') + ')'); continue; }
        const w = Math.max(...bar.map((r) => px(r.width || r.height || '0')));
        const size = px(getComputedStyle(document.documentElement).getPropertyValue('--scroll-size')) || 10;
        if (w > size + 0.5) add('scrollbar', e, 'its scrollbar is ' + w + 'px wide; the system\'s bar is ' + size + 'px (--scroll-size, R-scroll-2)');
        if (!thumb.length) add('scrollbar', e, 'its scrollbar has no ::-webkit-scrollbar-thumb rule (the system\'s thumb is --bg-4)');
        else {
          const T = tokens(o.tokenNames || [], groundOf(e));
          const p = probeEl(); p.style.color = 'var(--bg-4)'; const want4 = ckey(getComputedStyle(p).color); p.style.color = '';
          const bg = thumb.map((r) => r.bg).find(Boolean);
          const bgColour = bg && ((/var\(--[\w-]+\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|color-mix\([^)]*\)\)?/i.exec(bg) || [])[0]);
          if (bgColour) { p.style.color = bgColour; const got = ckey(getComputedStyle(p).color); p.style.color = ''; if (got !== want4 && T) add('scrollbar', e, 'its scrollbar thumb is ' + bgColour + ', not --bg-4 (--scroll-thumb-color, R-scroll-3)'); }
        }
      }
    }

    /* geometry.overlap: text painted over other text. The range rects of every visible text node go in a grid; two runs in different
       subtrees whose rects meet are a finding when, at a point of the meeting, both are painted (document.elementsFromPoint lists
       an element only where it is not clipped by an ancestor's overflow) and no opaque surface sits above the lower one. Pointer
       events are switched on for the look, so a strip with pointer-events: none is seen. Overlays (tooltips, menus, popovers, toasts,
       the lab's declared layer) are meant to sit over text and are left out. */
    let overlapMs = 0;
    if (want.has('geometry.overlap')) {
      const t0 = performance.now();
      const OVERLAY = '.ui-tip, .ui-menu, .ui-pop, .ui-toast, .ui-listbox, .ui-dialog, .hx-palette, [role="tooltip"], [role="menu"], [role="listbox"], [role="dialog"]';
      const ov = o.overlay || (window.__lab && window.__lab.overlay);
      const declared = ov && ov.layer ? [...document.querySelectorAll(ov.layer)] : [];
      const inOverlay = (e) => !!e.closest(OVERLAY) || declared.some((l) => l.contains(e));
      const runs = [];
      const range = document.createRange();
      for (const e of els) {
        if (e.matches('textarea, option, select, input, style, script')) continue;
        const s = cs.get(e);
        if ((rgba(s.color) || [0, 0, 0, 1])[3] < 0.05 || (rgba(s.webkitTextFillColor) || [0, 0, 0, 1])[3] < 0.05) continue;
        for (const n of e.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            if (r.width < 2 || r.height < 4) continue;
            /* the middle of the line box: neighbouring lines of one paragraph may touch at the edges of their content areas */
            const cut = r.height * 0.15;
            runs.push({ el: e, full: n.textContent.trim().replace(/\s+/g, ' '), text: n.textContent.trim().replace(/\s+/g, ' ').slice(0, 28), l: r.left, t: r.top + cut, r: r.right, b: r.bottom - cut, h: r.height });
          }
        }
      }
      const CELL = 64, grid = new Map();
      runs.forEach((q, i) => { for (let gx = Math.floor(q.l / CELL); gx <= Math.floor(q.r / CELL); gx++) for (let gy = Math.floor(q.t / CELL); gy <= Math.floor(q.b / CELL); gy++) { const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(i); } });
      const seen = new Set(), pairs = [];
      for (const list of grid.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const i = list[a], j = list[b], k = i < j ? i + '|' + j : j + '|' + i;
        if (seen.has(k)) continue; seen.add(k);
        const A = runs[i], B = runs[j];
        const l = Math.max(A.l, B.l), t = Math.max(A.t, B.t), r = Math.min(A.r, B.r), bt = Math.min(A.b, B.b);
        if (r - l < 1.5 || bt - t < 1.5 || A.el === B.el) continue;
        /* one inside the other and in the flow of it (an inline child, a nested block) is one paragraph's own business */
        const [outer, inner] = A.el.contains(B.el) ? [A.el, B.el] : B.el.contains(A.el) ? [B.el, A.el] : [null, null];
        if (outer) { let flow = true; for (let p = inner; p && p !== outer; p = p.parentElement) { const ps = cs.get(p) || getComputedStyle(p); if (ps.position === 'absolute' || ps.position === 'fixed') { flow = false; break; } } if (flow) continue; }
        if (inOverlay(A.el) || inOverlay(B.el)) continue;
        /* a conversation's own composer zone floats over the conversation's foot by design, with the conversation's ground strip
           between them (.ui-scroll--ground); while the zone grows, the strip follows it a frame later (its height is the zone's
           measured height), so a probe between the two would see text the strip is about to hide */
        { const zoneOf = (e) => e.closest('.bt-composer-zone, .ss-composer'), convOf = (e) => e.closest('.ui-scroll--ground');
          const pane = (e) => e.closest('.bt-room, .ss-view');
          const z = zoneOf(A.el) || zoneOf(B.el), c = convOf(A.el) || convOf(B.el);
          if (z && c && !zoneOf(A.el) !== !zoneOf(B.el) && pane(z) === pane(c)) continue; }
        /* a drawn copy of the same words, hidden from assistive technology, is the reveal layer of a control (the hold button's inverted label), not other text */
        if (A.full === B.full && (A.el.closest('[aria-hidden="true"]') || B.el.closest('[aria-hidden="true"]'))) continue;
        pairs.push([A, B, l, t, r, bt]);
      }
      if (pairs.length) {
        const st = document.createElement('style'); st.textContent = '* { pointer-events: auto !important }'; document.head.appendChild(st);
        const opacityOf = (e) => { let a = 1; for (let p = e; p && p.nodeType === 1; p = p.parentElement) a *= parseFloat(getComputedStyle(p).opacity); return a; };
        const alphaOf = (c) => { const v = rgba(c); return v ? v[3] : 0; };
        const opaqueCache = new Map();
        /* an element paints an opaque surface: a solid fill, or a gradient whose stops are all solid, or a pseudo-element that does and fills it */
        const opaque = (e) => {
          if (opaqueCache.has(e)) return opaqueCache.get(e);
          const surface = (s, pseudo) => {
            if (pseudo && (s.content === 'none' || s.content === 'normal' || s.display === 'none' || s.position === 'static')) return false;
            let a = alphaOf(s.backgroundColor);
            if (s.backgroundImage && s.backgroundImage !== 'none' && /gradient/.test(s.backgroundImage)) { const al = [...s.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map((m) => alphaOf(m[0])); if (al.length) a = Math.max(a, Math.min(...al)); }
            return a >= 0.9;
          };
          const ok = (surface(getComputedStyle(e)) || surface(getComputedStyle(e, '::before'), true) || surface(getComputedStyle(e, '::after'), true)) && opacityOf(e) >= 0.9;
          opaqueCache.set(e, ok);
          return ok;
        };
        /* an SVG shape paints an opaque surface where its fill is solid and the point lies inside the fill itself (the dock's slab is a
           path filled with --dock-bg, not a box with a background): hit-testing also returns a shape on its stroke, so test the fill */
        const svgFillAt = (e, x, y) => {
          if (!(e instanceof SVGGeometryElement)) return false;
          const s = getComputedStyle(e);
          if (alphaOf(s.fill) * parseFloat(s.fillOpacity) < 0.9 || opacityOf(e) < 0.9) return false;
          const m = e.getScreenCTM();
          if (!m) return false;
          return e.isPointInFill(new DOMPoint(x, y).matrixTransform(m.inverse()));
        };
        /* a strip drawn by an ancestor's positioned ::before or ::after (a conversation's ground under its composer, .ui-scroll--ground)
           covers what lies under it, but hit-testing never returns a pseudo-element: read its box from its resolved offsets, and count
           the point covered when it lies below the strip's fade, where its gradient is solid */
        const raisedOver = (e, p, z) => { for (let q = e; q && q !== p; q = q.parentElement) { const qs = getComputedStyle(q); if (qs.position !== 'static' && parseInt(qs.zIndex, 10) > z) return true; } return false; };
        const pseudoCover = (lo, x, y) => {
          for (let p = lo.parentElement; p && p !== document.body; p = p.parentElement) {
            for (const which of ['::after', '::before']) {
              const ps = getComputedStyle(p, which);
              if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || (ps.position !== 'absolute' && ps.position !== 'fixed')) continue;
              if (!(parseInt(ps.zIndex, 10) >= 1 || which === '::after')) continue;
              const pr = p.getBoundingClientRect();
              const h = parseFloat(ps.height), w = parseFloat(ps.width);
              const top = ps.top !== 'auto' ? pr.top + parseFloat(ps.top) : pr.bottom - parseFloat(ps.bottom) - h;
              const left = ps.left !== 'auto' ? pr.left + parseFloat(ps.left) : pr.right - parseFloat(ps.right) - w;
              if (!(x >= left && x <= left + w && y >= top && y <= top + h)) continue;
              const stops = [...(ps.backgroundImage || '').matchAll(/rgba?\([^)]*\)\s*([\d.]+px)?/g)];
              const solidAt = stops.find((m) => alphaOf(m[0].replace(/\s*[\d.]+px$/, '')) >= 0.9);
              const from = solidAt && solidAt[1] ? parseFloat(solidAt[1]) : 0;
              const fill = alphaOf(ps.backgroundColor) >= 0.9 || !!solidAt;
              const z = parseInt(ps.zIndex, 10) || 0;
              if (fill && y >= top + from && !raisedOver(lo.el, p, z)) return { p, z };
            }
          }
          return null;
        };
        const done = new Set();
        try {
          for (const [A, B, l, t, r, bt] of pairs) {
            const w = r - l, h = bt - t;
            for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85]]) {
              const x = l + w * fx, y = t + h * fy;
              if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
              const stack = document.elementsFromPoint(x, y);
              const ia = stack.indexOf(A.el), ib = stack.indexOf(B.el);
              if (ia < 0 || ib < 0) continue;   /* one is clipped away at this point */
              const [hi, lo, ilo] = ia < ib ? [A, B, ib] : [B, A, ia];
              if (stack.slice(0, ilo).some((e) => !e.contains(lo.el) && (opaque(e) || svgFillAt(e, x, y)))) continue;   /* an opaque surface sits above the lower text */
              const strip = hi.el.contains(lo.el) ? null : pseudoCover(lo, x, y);
              if (strip && raisedOver(hi.el, strip.p, strip.z)) continue;   /* a drawn strip covers the lower text, and the upper is raised over it */
              const dk = describe(hi.el) + '|' + describe(lo.el);
              if (done.has(dk)) break; done.add(dk);
              add('geometry.overlap', hi.el, 'text "' + hi.text + '" is painted over the text "' + lo.text + '" of ' + describe(lo.el) + ', ' + r1(w) + ' x ' + r1(h) + 'px of it, with no opaque surface between', { rect: { x: r1(l + scrollX), y: r1(t + scrollY), w: r1(w), h: r1(h) }, container: rectOf(lo.el) });
              break;
            }
          }
        } finally { st.remove(); }
      }
      overlapMs = r1(performance.now() - t0);
    }

    if (want.has('inline-baseline')) for (const f of inlineBaseline(els, cs)) add('inline-baseline', f.el, f.msg);
    return { findings: out, count: els.length, overlapMs };
  }

  /* ───────── inline-baseline ─────────
     A chip set into running text (a mention, the person's "you" capsule, a model mention or a feedforward mark in the composer, inline
     code, a path, the blank, an attachment chip) sits on the text's line: (a) its text's baseline is the line's baseline within half a
     device pixel; (b) its box is centred on the line's cap band (baseline to cap height) within one device pixel; (c) the line box is
     as tall with the chip as without it; (d) its box holds its content evenly: as much room left as right (a round mark at the start,
     an orb, is as far from the start as from the top and bottom), and as much above the cap height as below the baseline, within half
     a device pixel. The line is measured, never guessed from font metrics: a zero-width inline-block one cap tall (`height: 1cap`)
     set in the parent's text just before the chip stands on the line's baseline and reaches its cap height, and another set in the
     chip's own text does the same for the chip. No pixels are read, so a fallback font (CI's) moves both probes alike.
     (b)'s tolerance is one device pixel because a box's top and bottom each round to the device pixel grid when painted, so a box
     centred exactly in layout can paint up to one device pixel off; anything past that is a slip the eye sees. */
  const INLINE_CHIP = '.ui-mention, .ui-path, .ui-code, .ui-blank, .ui-md .ui-file, .ui-badge, [data-kit~="InlineChip"], [data-kit~="Badge"], [data-kit~="Mark"], [data-kit-part~="Countdown"]';   /* v7: InlineChip and Badge in running text (R-inline-1, LAB-v7 4) */
  const RUNNING = /^(block|inline|list-item|flow-root|table-cell|inline-block|run-in)$/;
  function inlineBaseline(els, cs) {
    const res = [];
    const dpr = window.devicePixelRatio || 1;
    const dev = (n) => r1(n * dpr * 100) / 100;   /* CSS px to device px, for the message */
    /* the probe is an <i>, which the browser sets in italic: `font-style: inherit` keeps it in the face of the text it measures. In italic
       it took `1cap` from the family's italic face, which loads only when something asks for it (Libre Franklin ships italic 400 and 600,
       not 500), so the first probe on a page measured the fallback font while the face loaded: Inter here, 0.2px short of Libre
       Franklin's cap height, Liberation Sans on CI's runner, 0.7px short, which read as a chip 0.7px low in its capsule */
    const STYLE = 'position:static;visibility:hidden;display:inline-block;width:0;height:1cap;margin:0;padding:0;border:0;vertical-align:baseline;font-style:inherit;';
    const capProbe = () => { const p = document.createElement('i'); p.className = 'lab-baseline-probe'; p.setAttribute('aria-hidden', 'true'); p.style.cssText = STYLE; return p; };
    const chips = els.filter((e) => e.matches(INLINE_CHIP) && !e.parentElement?.closest(INLINE_CHIP));
    for (const chip of chips) {
      const c = cs.get(chip) || getComputedStyle(chip);
      const par = chip.parentElement;
      if (!par || !/^inline/.test(c.display) || c.position === 'absolute' || c.position === 'fixed' || c.float !== 'none') continue;
      const pcs = getComputedStyle(par);
      if (!RUNNING.test(pcs.display)) continue;   /* a chip laid out by a flex or grid row is a row item (geometry.center's), not text */
      /* a chip alone in its block (an attachment on a line of its own) is not set into text: there is no line to sit on */
      const blockOf = (() => { for (let p = par; p && p !== document.body; p = p.parentElement) if (!/^inline/.test(getComputedStyle(p).display)) return p; return document.body; })();
      const others = (() => { const w = document.createTreeWalker(blockOf, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) if (!chip.contains(t) && t.data.trim() && !t.parentElement?.closest(SR)) return true; return false; })();
      if (!others) continue;
      /* the chip's text: the first shown element (never a screen reader's copy) whose own text or ::before draws it */
      let holder = null, firstText = null;
      const visit = (n) => {
        for (const k of n.childNodes) {
          if (holder) return;
          if (k.nodeType === 3 && k.data.trim()) { holder = n; firstText = k; return; }
          if (k.nodeType !== 1 || k.matches(SR) || k.matches('svg, orb-avatar, canvas, .ui-orb, .ui-dot')) continue;
          const b = getComputedStyle(k, '::before').content;
          if (b && b !== 'none' && b !== 'normal' && b !== '""' && !k.firstChild) { holder = k; return; }
          visit(k);
        }
      };
      if (chip.firstChild && chip.firstChild.nodeType === 3 && chip.firstChild.data.trim()) { holder = chip; firstText = chip.firstChild; } else visit(chip);
      const lineProbe = capProbe(), ownProbe = holder ? capProbe() : null;
      const painted = (() => {
        /* a box the eye sees: a fill, a ring or a border on more than the bottom edge (a feedforward mark is an underline only) */
        const bg = !transparent(c.backgroundColor), ring = c.boxShadow && c.boxShadow !== 'none';
        const bd = ['Top', 'Left', 'Right'].some((s) => px(c['border' + s + 'Width']) > 0 && c['border' + s + 'Style'] !== 'none');
        return bg || ring || bd;
      })();
      const problems = [];
      try {
        par.insertBefore(lineProbe, chip);
        if (ownProbe) { if (firstText) holder.insertBefore(ownProbe, firstText); else holder.append(ownProbe); }
        let L = lineProbe.getBoundingClientRect();
        const b0 = chip.getClientRects()[0] || chip.getBoundingClientRect();
        /* the chip began a new line: the probe before it stayed at the end of the line above, so it stands just after the chip */
        if (L.bottom < b0.top) { par.insertBefore(lineProbe, chip.nextSibling); L = lineProbe.getBoundingClientRect(); }
        if (L.bottom < b0.top || L.top > b0.bottom) continue;
        const baseLine = L.bottom, capLine = L.height;
        if (!(capLine > 0)) continue;   /* no cap unit, or a probe that did not lay out: nothing to measure against */
        const b = chip.getClientRects()[0] || chip.getBoundingClientRect();
        /* (a) the chip's text stands on the line's baseline */
        let O = null;
        if (ownProbe) {
          O = ownProbe.getBoundingClientRect();
          const da = O.bottom - baseLine;
          if (Math.abs(da) * dpr > 0.5) problems.push('(a) its text\'s baseline is ' + dev(Math.abs(da)) + ' device px ' + (da > 0 ? 'below' : 'above') + ' the line\'s');
        }
        if (painted) {
          /* (b) its box is centred on the line's cap band */
          /* a chip in a smaller type (inline code) centres its box on its own text, as (d) asks, and its text stands on the line's baseline,
             so its box's centre sits half the difference of the two cap heights below the line's: that much is allowed on top of the pixel */
          const capOwn = O ? O.height : capLine;
          const db = (b.top + b.bottom) / 2 - (baseLine - capLine / 2);
          if (Math.abs(db) - Math.max(0, capLine - capOwn) / 2 > 1 / dpr) problems.push('(b) its box\'s centre is ' + dev(Math.abs(db)) + ' device px ' + (db > 0 ? 'below' : 'above') + ' the centre of the line\'s cap band');
          /* (d) top and bottom: as much room over its cap height as under its baseline. An atomic chip (inline-flex, inline-block) only: an
             inline box that flows and wraps with the sentence (inline code) paints its font's content area, ascent to descent, as CSS 2
             lays it out, and centring that on the cap band needs `text-box` on inline boxes, which neither Chromium nor WebKitGTK ships;
             its baseline (a) and its centring on the line (b) are still held */
          if (O && /^inline-/.test(c.display)) {
            const top = O.top - b.top, bottom = b.bottom - O.bottom;
            /* the kit's chips are the boards' own (kit.css `.mention`, `.you`, `.refchip`, boards 12 and K02: 18 and 20 tall on the
               text's line), whose room over the cap height and under the baseline differs by a little over half a CSS pixel with the
               boards' fonts: under a pixel is theirs, and the boards win (REPASS rule 7) */
            const boards = chip.matches('[data-kit~="InlineChip"]') ? 0.75 * dpr : 0.5;
            if (Math.abs(top - bottom) * dpr > boards) problems.push('(d) ' + r1(top) + 'px above its cap height and ' + r1(bottom) + 'px below its baseline');
          }
          /* (d) left and right: the content's extent inside the box */
          const parts = [];
          const walk = (n) => {
            for (const k of n.childNodes) {
              if (k === ownProbe) continue;
              if (k.nodeType === 3) { if (!k.data.trim()) continue; const r = document.createRange(); r.selectNodeContents(k); let clip = null;   /* what a box between the text and the chip cuts away (a path's folders, cut from the left) is not content */
                for (let pe = k.parentElement; pe && pe !== chip; pe = pe.parentElement) if (getComputedStyle(pe).overflowX !== 'visible') { const z = pe.getBoundingClientRect(); clip = clip ? { left: Math.max(clip.left, z.left), right: Math.min(clip.right, z.right) } : { left: z.left, right: z.right }; }
                for (const q0 of r.getClientRects()) { const q = clip ? { left: Math.max(q0.left, clip.left), right: Math.min(q0.right, clip.right), top: q0.top, bottom: q0.bottom, width: q0.width } : q0; if (q.width > 0 && q.right > q.left && q.top < b.bottom && q.bottom > b.top) parts.push({ q, mark: false }); }
                continue; }
              if (k.nodeType !== 1 || k.matches(SR) || !shown(k)) continue;
              if (k.matches('svg, orb-avatar, canvas, .ui-orb, .ui-dot, .ui-icon, .ui-mention__stack, .ui-stamp') || ![...k.childNodes].some((n) => n !== ownProbe)) { const q = k.getBoundingClientRect(); if (q.width > 0 && q.top < b.bottom && q.bottom > b.top) parts.push({ q, mark: k.matches('.ui-orb, orb-avatar, .ui-mention__stack') }); continue; }
              walk(k);
            }
          };
          walk(chip);
          if (parts.length && chip.getClientRects().length === 1) {
            parts.sort((x, y) => x.q.left - y.q.left);
            const first = parts[0], left = first.q.left - b.left, right = b.right - Math.max(...parts.map((p) => p.q.right));
            if (first.mark) {
              /* a round mark at the start, concentric with the capsule's end: as far from the start as from the top and bottom */
              const v = Math.min(first.q.top - b.top, b.bottom - first.q.bottom);
              if (Math.abs(left - v) * dpr > 0.5) problems.push('(d) its leading mark is ' + r1(left) + 'px from the start and ' + r1(v) + 'px from the top and bottom');
            } else if (Math.abs(left - right) * dpr > 0.5) problems.push('(d) ' + r1(left) + 'px of room on the left and ' + r1(right) + 'px on the right');
          }
        }
        /* (c) the line is as tall with the chip as without it: the chip is swapped for a stand-in as wide and no taller than a baseline
           (an atomic chip), or its own inline box is folded to nothing (an inline one, which keeps its widths and so its line breaks) */
        const block = blockOf;
        /* where the chip's line and the block's last line stand (a probe on the baseline at the block's end): fractional layout positions,
           not scrollHeight, which rounds to whole pixels */
        const endProbe = capProbe(); block.append(endProbe);
        const measure = () => { const t = block.getBoundingClientRect().top; return [lineProbe.getBoundingClientRect().bottom - t, endProbe.getBoundingClientRect().bottom - t]; };
        const withChip = measure();
        let without;
        if (/^inline-/.test(c.display)) {
          const stand = document.createElement('i'); stand.className = 'lab-baseline-probe';
          stand.style.cssText = 'position:static;display:inline-block;height:0;padding:0;border:0;vertical-align:baseline;width:' + b.width + 'px;margin:0 ' + c.marginRight + ' 0 ' + c.marginLeft;
          const was = chip.style.getPropertyValue('display'), pri = chip.style.getPropertyPriority('display');
          par.insertBefore(stand, chip); chip.style.setProperty('display', 'none', 'important');
          without = measure();
          chip.style.setProperty('display', was, pri); if (!was) chip.style.removeProperty('display');
          stand.remove();
        } else {
          const st = document.createElement('style'); st.textContent = '.lab-baseline-flat, .lab-baseline-flat * { line-height: 0 !important; vertical-align: baseline !important; }';
          document.head.append(st); chip.classList.add('lab-baseline-flat');
          without = measure();
          chip.classList.remove('lab-baseline-flat'); st.remove();
        }
        endProbe.remove();
        const grew = Math.max(withChip[0] - without[0], withChip[1] - without[1]);
        if (grew * dpr > 0.5) problems.push('(c) it makes its line ' + dev(grew) + ' device px taller');
      } finally {
        lineProbe.remove(); ownProbe?.remove();
      }
      if (problems.length) res.push({ el: chip, msg: 'off its line: ' + problems.join('; ') });
    }
    return res;
  }

  let sbCache = null;
  function scrollbarRules() {
    if (sbCache) return sbCache;
    const bar = [], thumb = [];
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !(r instanceof CSSStyleRule)) { walk(r.cssRules); continue; }
        if (!(r instanceof CSSStyleRule) || !/::-webkit-scrollbar/.test(r.selectorText)) continue;
        for (const sel of r.selectorText.split(/,(?![^(]*\))/)) {
          const m = /^(.*?)::-webkit-scrollbar(-thumb)?(?::[\w-]+)*\s*$/.exec(sel.trim());
          if (!m) continue;
          /* `X ::-webkit-scrollbar` styles the bars of everything inside X (a descendant combinator), `X::-webkit-scrollbar` X's own */
          const base = m[1].trim() ? (/\s$/.test(m[1]) ? m[1].trim() + ' *' : m[1].trim()) : '*';
          if (m[2]) thumb.push({ base, bg: r.style.backgroundColor || r.style.background });
          else bar.push({ base, width: r.style.width, height: r.style.height, display: r.style.display });
        }
      }
    };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch { /* cross-origin */ } }
    sbCache = { bar, thumb };
    return sbCache;
  }
  function matchesBase(e, base) { try { return base === '*' || e.matches(base) || (base.endsWith(' *') && e.matches(base)); } catch { return false; } }

  /* ───────── stability ───────── */
  /* runtime state, not structure: the edge-fade flags follow the scroll position (scroll-edges.ts), which a render does not fix */
  const VOLATILE = /^(id|style|aria-describedby|aria-controls|aria-labelledby|aria-activedescendant|aria-expanded|for|data-sq-on|data-lab-\w+|tabindex|data-glance|width|height|static|d|data-countdown|data-more-(top|bottom|left|right))$/;
  function signature(root) {
    root = root || (window.__lab && window.__lab.scope && window.__lab.scope()) || document.body;
    const lines = [];
    const walk = (n, depth) => {
      for (const c of n.children) {
        if (c.matches('script, style, #__lab_probe, .ui-tip')) continue;
        if (c.matches('orb-avatar')) { lines.push(' '.repeat(depth) + 'orb-avatar [label=' + (c.getAttribute('label') || '') + ']'); continue; }
        const attrs = [...c.attributes].filter((a) => !VOLATILE.test(a.name) && a.name !== 'class').map((a) => a.name + '=' + a.value.replace(/\d{2,}/g, '#').slice(0, 40)).sort().join(' ');
        const cls = [...c.classList].filter((x) => !/^is-(in|out|moving|on|hover)/.test(x)).sort().join('.');
        const text = [...c.childNodes].filter((t) => t.nodeType === 3).map((t) => t.textContent.trim()).join(' ').replace(/\d+/g, '#').slice(0, 60);
        lines.push(' '.repeat(depth) + c.tagName.toLowerCase() + (cls ? '.' + cls : '') + (attrs ? ' [' + attrs + ']' : '') + (text ? ' "' + text + '"' : ''));
        if (!c.matches('orb-avatar, boopis-logo, svg')) walk(c, depth + 1);
      }
    };
    walk(root, 0);
    return lines;
  }

  /** frames of every visible element's opacity, visibility and box under `root`, plus nodes removed and added */
  function sampler(rootSel, opts) {
    const orbsStay = !!(opts && opts.orbs);
    const root = (rootSel && document.querySelector(rootSel)) || (window.__lab && window.__lab.scope && window.__lab.scope()) || document.body;
    const keyOf = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.getAttribute('data-k') ? '[k=' + e.getAttribute('data-k') + ']' : e.getAttribute('data-id') ? '[id=' + e.getAttribute('data-id') + ']' : e.getAttribute('data-slot') ? '[slot=' + e.getAttribute('data-slot') + ']' : '') + '.' + [...e.classList].filter((c) => !/^is-/.test(c)).slice(0, 2).join('.');
    const tracked = new Map(); let n = 0;
    const track = (e) => { if (!tracked.has(e) && n < 500) { tracked.set(e, { key: keyOf(e), frames: [] }); n++; } };
    const pick = () => { for (const e of root.querySelectorAll('*')) { if (e.matches('svg *, script, style')) continue; track(e); } track(root); };
    pick();
    const removed = [], added = [];
    /* the orbs: an orb taken out of the page, and the orbs put in (R-motion-5). An orb's canvas belongs to a worker; a node that is
       detached and attached again, or drawn anew, shows nothing until the worker draws and commits once more. */
    const orbsOf = (n) => (n.matches('orb-avatar') ? [n] : [...n.querySelectorAll('orb-avatar')]);
    const orbOut = new Map(), orbIn = [];
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        for (const r of m.removedNodes) if (r.nodeType === 1 && !r.matches('.ui-tip, #__lab_probe')) {
          if (r.isConnected === false) removed.push({ key: keyOf(r), t: performance.now() });
          for (const o of orbsOf(r)) orbOut.set(o, { label: o.getAttribute('label') || '', t: performance.now() });
        }
        for (const a of m.addedNodes) if (a.nodeType === 1 && !a.matches('.ui-tip, #__lab_probe')) {
          added.push({ key: keyOf(a), t: performance.now() }); track(a);
          for (const o of orbsOf(a)) orbIn.push({ el: o, label: o.getAttribute('label') || '', t: performance.now() });
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });
    let raf = 0, frame = 0, on = true;
    const tick = () => {
      if (!on) return;
      frame++;
      for (const [e, rec] of tracked) {
        if (!e.isConnected) { rec.frames.push(null); continue; }
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        rec.frames.push([r1(r.left), r1(r.top), r1(r.width), r1(r.height), Math.round(parseFloat(s.opacity) * 100) / 100, s.visibility === 'hidden' || s.display === 'none' ? 0 : 1, frame]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return {
      stop() {
        on = false; cancelAnimationFrame(raf); mo.disconnect();
        const issues = analyse(tracked, removed, added);
        if (orbsStay) for (const [o, out] of orbOut) {
          const key = 'orb-avatar[label=' + out.label + ']';
          if (o.isConnected) issues.push({ kind: 'orb-moved', key, msg: key + ' was taken out of the page and put back (its canvas is painted empty until the worker draws again: update the node in place)' });
          else if (orbIn.some((i) => i.el !== o && i.label === out.label && i.t >= out.t - 50 && i.t - out.t <= 1000)) issues.push({ kind: 'orb-replaced', key, msg: key + ' was removed and drawn anew (a new canvas is empty until the worker draws it: keep the node and update its attributes)' });
        }
        return issues;
      }
    };
  }
  function analyse(tracked, removed, added) {
    const issues = [];
    /* replaced: a node removed and one with the same key added (a redraw instead of an update) */
    /* a redraw puts the node back right after it takes it away (innerHTML, replaceWith: the same batch, or a moment later);
       a row that a filter adds on one keystroke and drops on the next is a list that changed, not a node redrawn (R-motion-5) */
    const repl = new Map();
    for (const r of removed) if (/[#[]/.test(r.key) && added.some((a) => a.key === r.key && a.t >= r.t - 50 && a.t - r.t <= 500)) repl.set(r.key, (repl.get(r.key) || 0) + 1);
    for (const [k, c] of repl) issues.push({ kind: 'replaced', key: k, msg: k + ' was removed and drawn again ' + c + ' time' + (c > 1 ? 's' : '') + ' (an update should keep the node)' });
    for (const [, rec] of tracked) {
      const f = rec.frames.filter(Boolean);
      if (f.length < 4) continue;
      /* flicker: shown, gone, shown again (opacity or visibility) */
      /* a flicker is a short dip (at most FLICKER frames, about 130 ms): a view that fades out because the state changed
         and back because it changed again is a transition, not a flicker */
      const FLICKER = 8;
      let dips = 0, state = f[0][4] >= 0.9 && f[0][5] ? 'on' : 'off', offAt = -1;
      f.forEach((x, i) => {
        const vis = x[5] && x[4] >= 0.9, invis = !x[5] || x[4] <= 0.15;
        if (state === 'on' && invis) { state = 'off'; offAt = i; }
        else if (state === 'off' && vis) { if (offAt >= 0 && i - offAt <= FLICKER) dips++; state = 'on'; }
      });
      if (dips) issues.push({ kind: 'flicker', key: rec.key, msg: rec.key + ' blinked out and back within ' + FLICKER + ' frames, ' + dips + ' time' + (dips > 1 ? 's' : '') });
      /* a box that jumps away for a frame or two and comes back, or teleports */
      for (let i = 1; i < f.length - 1; i++) {
        const a = f[i - 1], b = f[i];
        const d = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), Math.abs(b[3] - a[3]));
        if (d <= 8) continue;
        for (let j = i + 1; j < Math.min(f.length, i + 3); j++) {
          const c = f[j];
          if (Math.max(Math.abs(c[0] - a[0]), Math.abs(c[1] - a[1]), Math.abs(c[2] - a[2]), Math.abs(c[3] - a[3])) <= 1) { issues.push({ kind: 'jump', key: rec.key, msg: rec.key + ' jumped ' + r1(d) + 'px for ' + (j - i) + ' frame' + (j - i > 1 ? 's' : '') + ' and came back' }); i = f.length; break; }
        }
      }
    }
    const seen = new Set();
    return issues.filter((x) => { const k = x.kind + x.key; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  }

  window.__labProbe = { run, signature, sampler, tokens: (names) => { const t = tokens(names); return { colors: t.colors.size, fs: [...t.fs], radii: [...t.radii], space: [...t.space] }; } };
})();
