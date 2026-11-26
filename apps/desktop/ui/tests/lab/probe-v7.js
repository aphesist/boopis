/* The v7 lab's in-page checks (docs/UI-LAB.md, "The v7 checks"), ported from the design's render QA
   (docs/design/v7/render-qa.cjs on w31/design-system-v7) onto the lab's story interface: a check names components, and the
   checker passes in which elements are each component (tests/lab/v7.mjs, V7_TARGETS). Plain browser JavaScript, injected after
   probe.js. `window.__labProbeV7.run({ targets, checks, forced })` returns { findings, sigs }:
     geometry.wrap      a single-line control (Segmented item, Chip, Button, Badge, Kbd, SelectorItem, title pill, InlineChip,
                        StatusWord, Tooltip, MenuRow, a blank's countdown) on more than one line, or its text wider than its box
                        without an ellipsis (R-row-1, R-type-11)
     geometry.row       in a MenuRow, ListRow, OptionRow, Row, queue or file row: a text run on two lines, cut without an ellipsis,
                        or running past the row's padding edge (R-row-1)
     geometry.escape    the visible part of an element (after its own clipping ancestors) leaves its story cell, or the window
                        (geometry.contain, extended: R-corner-4, R-overflow-1)
     geometry.padding   left padding != right or top != bottom by more than 0.5 px (R-space-3)
     geometry.align     siblings that share a left edge are more than 0.5 px apart (R-space-4)
     concentric.strict  a control in a container's corner zone: radius = outer - inset (floor 6), equal insets within 0.5 px, never
                        past the container's edge, measured after CSS zoom (R-corner-10)
     mark.rest          a dashed underline at rest outside feedforward, an AskCard or a blank; an info label's mark at rest (section 17)
     sweep              in a still: a status phrase frozen mid-shimmer, or a breath frozen mid-cycle; [data-motion] is exempt (9.2, P4)
     contrast.accent    a derived accent token under 4.5:1 on its surface (section 18), when the theme defines them
   and the same-component signatures (`sigs`: [class, geometry]) the checker compares across every render. */
(() => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const px = (v) => parseFloat(v) || 0;
  const SKIP = 'svg, canvas, orb-avatar, boopis-logo, script, style, template, .hx-probe, #__lab_probe, .ui-sr, .sr-only';
  const vis = (el) => { const r = el.getBoundingClientRect(); if (!(r.width > 0.5 && r.height > 0.5)) return false; return !el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true }); };
  const matches = (el, s) => { if (!s) return false; try { return el.matches(s); } catch { return false; } };
  const all = (root, s) => { if (!s) return []; try { return [...root.querySelectorAll(s)]; } catch { return []; } };
  const describe = (el) => {
    const part = (e) => { let s = e.tagName.toLowerCase(); if (e.id && !/\d{3,}|-[a-z0-9]{6,}$/.test(e.id)) s += '#' + e.id; const cls = [...e.classList].filter((c) => !/^is-|^lab-/.test(c)).slice(0, 2); if (cls.length) s += '.' + cls.join('.'); const k = e.getAttribute('data-kit'); if (k) s += '[' + k + ']'; return s; };
    const parts = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) { parts.unshift(part(e)); if (e.id && i > 0) break; }
    return parts.join(' > ');
  };
  const text = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r1(r.left + scrollX), y: r1(r.top + scrollY), w: r1(r.width), h: r1(r.height) }; };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  /* how many lines a text takes: the distinct line centres of its text rects (its own text nodes, or all of it) */
  function lines(el, own) {
    const rects = [];
    const rg = document.createRange();
    if (own) { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { rg.selectNodeContents(n); rects.push(...rg.getClientRects()); } }
    else {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (!n.textContent.trim() || (n.parentElement && n.parentElement.closest(SKIP))) continue; rg.selectNodeContents(n); rects.push(...rg.getClientRects()); }
    }
    const mids = rects.filter((r) => r.width > 1 && r.height > 4).map((r) => r.top + r.height / 2).sort((a, b) => a - b);
    let n = 0, last = -1e9;
    for (const t of mids) { if (t - last > 6) n++; last = t; }
    return n;
  }
  const textRight = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); let tr = 0; for (const r of rg.getClientRects()) tr = Math.max(tr, r.right); return tr; };
  /* the zoom an element is drawn at (CSS zoom on it or an ancestor): its drawn width over its layout width */
  const zoomOf = (el) => { const r = el.getBoundingClientRect(); return el.offsetWidth ? r.width / el.offsetWidth : 1; };
  /* the corner radius as drawn: after zoom, capped at half the box */
  const radiusOf = (el, corner = 'borderTopRightRadius') => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const v = px(cs[corner]) * zoomOf(el); return Math.min(v, r.height / 2, r.width / 2); };
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/ 0\)$/.test(c);
  /* a shell: a surface that is drawn (a fill, a border, or the squircle layer's fill) */
  const shelled = (el) => {
    const cs = getComputedStyle(el);
    if (!transparent(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none' && !/text/.test(cs.backgroundClip))) return true;
    if (px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && !transparent(cs.borderTopColor)) return true;
    if (el.hasAttribute('data-sq-on')) { const b = getComputedStyle(el, '::before'); if (b.content !== 'none' && !transparent(b.backgroundColor)) return true; }
    return false;
  };

  function run(o) {
    const T = o.targets || {};
    const want = new Set(o.checks || ['geometry.wrap', 'geometry.row', 'geometry.escape', 'geometry.padding', 'geometry.align', 'concentric.strict', 'mark.rest', 'sweep', 'contrast.accent']);
    const scope = o.scope ? document.querySelector(o.scope) : (window.__lab && window.__lab.scope && window.__lab.scope()) || document.body;
    if (!scope) return { findings: [], sigs: [] };
    /* the story's cell: a stage state's cell (or the scope it names apart from the cell), an app state's window */
    const cell = document.querySelector('.lab-cell');
    const root = window.__lab && window.__lab.app ? null : (cell && (scope.contains(cell) || scope === cell) ? cell : scope);
    const out = [];
    const seen = new Set();
    const add = (check, el, msg, extra) => {
      const key = check + '|' + describe(el) + '|' + msg.replace(/-?[\d.]+(px| px|dpx)?/g, 'N');
      if (seen.has(key)) return; seen.add(key);
      out.push({ check, el: describe(el), label: text(el), msg, rect: rectOf(el), key, ...extra });
    };
    const inScope = (el) => scope.contains(el) && !el.closest(SKIP) && vis(el);

    /* geometry.wrap */
    if (want.has('geometry.wrap')) for (const el of all(scope, T.wrap)) {
      if (!inScope(el) || !text(el)) continue;
      const cs = getComputedStyle(el);
      const n = lines(el);
      if (n > 1) add('geometry.wrap', el, 'a single-line control on ' + n + ' lines');
      else if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.display !== 'inline') add('geometry.wrap', el, 'its text is ' + (el.scrollWidth - el.clientWidth) + 'px wider than its box, with no ellipsis');
    }

    /* geometry.row */
    if (want.has('geometry.row')) for (const row of all(scope, T.row)) {
      if (!inScope(row)) continue;
      const rr = row.getBoundingClientRect(), rcs = getComputedStyle(row);
      const right = rr.right - px(rcs.paddingRight) * zoomOf(row) + 0.5;
      const menu = T.menu ? row.closest(T.menu) : null;
      for (const el of [row, ...row.querySelectorAll('*')]) {
        if (!vis(el) || el.closest(SKIP) || !ownText(el)) continue;
        if (el !== row && T.menu && el.closest(T.menu) !== menu) continue;   /* a menu inside the row is its own */
        if (el.closest('.wrap-ok, [data-wrap-ok]')) continue;
        const cs = getComputedStyle(el);
        if (lines(el, true) > 1) add('geometry.row', el, 'wraps onto two lines in its row ' + describe(row));
        else if (cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') add('geometry.row', el, 'cut without an ellipsis in its row ' + describe(row));
        let lim = Infinity;
        for (let a = el; a && a !== row; a = a.parentElement) { const c = getComputedStyle(a); if (c.overflowX !== 'visible') lim = Math.min(lim, a.getBoundingClientRect().right + 0.5); }
        const tr = Math.min(textRight(el), lim);
        if (tr > right) add('geometry.row', el, 'runs ' + r1(tr - right + 0.5) + 'px past the padding edge of its row ' + describe(row));
      }
    }

    /* geometry.escape: the visible part of every element stays inside the cell (a stage state) and the window */
    if (want.has('geometry.escape')) {
      const R = root ? root.getBoundingClientRect() : null;
      const W = document.documentElement.clientWidth;
      const csCache = new Map();
      const gcs = (e) => { let c = csCache.get(e); if (!c) { c = getComputedStyle(e); csCache.set(e, c); } return c; };
      let n = 0;
      for (const el of scope.querySelectorAll('*')) {
        if (++n > 6000) break;
        if (el.closest(SKIP) && !matches(el, 'svg, orb-avatar, canvas')) continue;
        if (matches(el, 'svg *')) continue;
        if (T.escapeOk && el.closest(T.escapeOk)) continue;
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom, fixedAt = null;
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const c = gcs(a);
          if (c.position === 'fixed' && !fixedAt) fixedAt = a;
          if (a === root) break;
          if (c.overflowX === 'visible' && c.overflowY === 'visible' && (!c.clipPath || c.clipPath === 'none') && c.contain.indexOf('paint') < 0) continue;
          const ar = a.getBoundingClientRect(); x0 = Math.max(x0, ar.left); y0 = Math.max(y0, ar.top); x1 = Math.min(x1, ar.right); y1 = Math.min(y1, ar.bottom);
        }
        if (gcs(el).position === 'fixed') fixedAt = el;
        if (x1 - x0 <= 0.5 || y1 - y0 <= 0.5) continue;
        if (x0 < -0.5 || x1 > W + 0.5) { add('geometry.escape', el, 'its visible part leaves the window by ' + r1(Math.max(-x0, x1 - W)) + 'px'); continue; }
        if (fixedAt && (y0 < -0.5 || y1 > innerHeight + 0.5)) { add('geometry.escape', el, 'a fixed layer leaves the window by ' + r1(Math.max(-y0, y1 - innerHeight)) + 'px'); continue; }
        if (R && !fixedAt && root.contains(el) && (x0 < R.left - 0.5 || x1 > R.right + 0.5 || y0 < R.top - 0.5 || y1 > R.bottom + 0.5)) {
          add('geometry.escape', el, 'its visible part leaves its story cell by ' + r1(Math.max(R.left - x0, x1 - R.right, R.top - y0, y1 - R.bottom)) + 'px');
        }
      }
    }

    /* geometry.padding */
    if (want.has('geometry.padding')) for (const el of all(scope, T.padding)) {
      if (!inScope(el)) continue;
      const cs = getComputedStyle(el);
      const L = px(cs.paddingLeft), Rp = px(cs.paddingRight), Tp = px(cs.paddingTop), B = px(cs.paddingBottom);
      if (Math.abs(L - Rp) > 0.5 || Math.abs(Tp - B) > 0.5) add('geometry.padding', el, `uneven padding ${Tp}/${Rp}/${B}/${L} (top/right/bottom/left): left must equal right and top bottom; an asymmetric inset is an inner element`);
    }

    /* geometry.align */
    if (want.has('geometry.align')) for (const [box, kids] of T.align || []) for (const b of all(scope, box)) {
      if (!inScope(b)) continue;
      const ks = [...b.children].filter((k) => matches(k, kids) && vis(k) && !/absolute|fixed/.test(getComputedStyle(k).position));
      const ls = ks.map((k) => k.getBoundingClientRect().left);
      if (ls.length > 1 && Math.max(...ls) - Math.min(...ls) > 0.5) {
        const lo = Math.min(...ls), off = ks[ls.findIndex((l) => Math.abs(l - lo) > 0.5)];
        add('geometry.align', off || b, 'the rows of ' + describe(b) + ' do not share a left edge: spread ' + r1(Math.max(...ls) - lo) + 'px');
      }
    }
    if (want.has('geometry.align') && T.diffComment) for (const dv of all(scope, T.diffView)) {
      const code = dv.querySelector(T.diffCode), cm = dv.querySelector(T.diffComment);
      if (code && cm && vis(cm) && Math.abs(code.getBoundingClientRect().left - cm.getBoundingClientRect().left) > 0.5) add('geometry.align', cm, 'a DiffView comment is ' + r1(cm.getBoundingClientRect().left - code.getBoundingClientRect().left) + 'px off the code column');
    }

    /* concentric.strict (R-corner-10). At rest a control with no shell of its own is skipped: it is checked when forced (hover) */
    if (want.has('concentric.strict')) for (const kid of all(scope, T.corner)) {
      if (!inScope(kid)) continue;
      /* boards 11 and S17 (screens.js `chrome`): the key chips at the end of the search hint, as the boards draw them (REPASS rule 7) */
      if (kid.matches('.k7-search-hint .k7-kbd')) continue;
      if (!o.forced && !shelled(kid)) continue;
      if (px(getComputedStyle(kid).borderTopRightRadius) === 0 && px(getComputedStyle(kid).borderTopLeftRadius) === 0) continue;
      let box = kid.parentElement;
      while (box && box !== document.body && !(shelled(box) && radiusOf(box) > 0)) box = box.parentElement;
      if (!box || box === document.body || matches(box, T.region)) continue;
      const k = kid.getBoundingClientRect(), b = box.getBoundingClientRect();
      const iL = k.left - b.left, iR = b.right - k.right, iT = k.top - b.top, iB = b.bottom - k.bottom;
      if (Math.min(iL, iR, iT, iB) < -0.5) { add('concentric.strict', kid, 'runs past its container ' + describe(box), { container: rectOf(box) }); continue; }
      const corners = [['top-left', iL, iT, 'borderTopLeftRadius'], ['top-right', iR, iT, 'borderTopRightRadius'], ['bottom-right', iR, iB, 'borderBottomRightRadius'], ['bottom-left', iL, iB, 'borderBottomLeftRadius']];
      for (const [name, h, v, prop] of corners) {
        const R0 = radiusOf(box, prop);
        if (R0 <= 0 || h >= R0 - 0.5 || v >= R0 - 0.5) continue;   /* not in this corner's zone */
        const kr = radiusOf(kid, prop), kidPill = kr >= Math.min(k.width, k.height) / 2 - 0.5, boxPill = R0 >= Math.min(b.width, b.height) / 2 - 0.5;
        if (Math.abs(h - v) > 0.5) { add('concentric.strict', kid, `in the ${name} corner of ${describe(box)}: insets ${r1(h)}px and ${r1(v)}px are not equal`, { container: rectOf(box) }); break; }
        if (kidPill && boxPill) continue;   /* a pill in a pill on equal insets */
        const wantR = Math.max(6, R0 - v);
        if (Math.abs(kr - wantR) > 0.5) { add('concentric.strict', kid, `in the ${name} corner of ${describe(box)}: radius ${r1(kr)}px, the corner wants ${r1(wantR)}px (${r1(R0)} - ${r1(v)}, floor 6)`, { container: rectOf(box) }); break; }
      }
    }

    /* mark.rest (section 17): only at rest, never under a forced state */
    if (want.has('mark.rest') && !o.forced) {
      for (const el of scope.querySelectorAll('*')) {
        if (el.closest(SKIP) || !ownText(el) && !matches(el, T.mark)) continue;
        const cs = getComputedStyle(el);
        const dashedLine = /underline/.test(cs.textDecorationLine) && cs.textDecorationStyle === 'dashed';
        const dashedBorder = cs.borderBottomStyle === 'dashed' && px(cs.borderBottomWidth) > 0 && cs.borderTopStyle !== 'dashed' && !transparent(cs.borderBottomColor);
        /* the v7 Mark draws its dashes as a background layer (section 17.1), so it says when they show: --mark-dashes is 1 */
        const drawn = matches(el, T.mark) && cs.getPropertyValue('--mark-dashes').trim() === '1';
        if (!dashedLine && !dashedBorder && !drawn) continue;
        if (!vis(el)) continue;
        if (T.infoMark && matches(el, T.infoMark)) { add('mark.rest', el, 'an info label\'s mark shows at rest: it shows only on hover or focus'); continue; }
        if (T.markContext && el.closest(T.markContext)) continue;
        add('mark.rest', el, 'a dashed mark at rest outside feedforward, an AskCard or a blank (a heading or static text never carries one)');
      }
    }

    /* sweep: in a still (the checker's static load is reduced motion) nothing is frozen mid-shimmer or mid-breath */
    if (want.has('sweep') && !o.forced) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (const el of scope.querySelectorAll('*')) {
        if (el.closest(SKIP) || el.closest('[data-motion]') || !vis(el)) continue;
        const cs = getComputedStyle(el);
        const clipText = /text/.test(cs.backgroundClip) || /text/.test(cs.webkitBackgroundClip || '');
        if (clipText && /gradient/.test(cs.backgroundImage) && ownText(el)) add('sweep', el, 'a status phrase frozen mid-sweep: a gradient clipped to its text in a still');
        else if (reduced && cs.animationName !== 'none' && cs.animationIterationCount === 'infinite' && cs.animationPlayState !== 'paused' && (matches(el, T.live) || ownText(el) || el.children.length === 0)) add('sweep', el, 'a breath frozen mid-cycle: "' + cs.animationName + '" still loops in a still');
      }
    }

    /* contrast.accent: the derived accent tokens on their surfaces, when the theme defines them */
    if (want.has('contrast.accent') && o.accentPairs) {
      /* the v7 root's tokens where there is one (the kit's stories), else the document's */
      const rs = getComputedStyle(document.querySelector('[data-ui="v7"]') || document.documentElement);
      const p = document.createElement('i'); p.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px'; document.documentElement.appendChild(p);
      const rgb = (v) => { p.style.color = ''; p.style.color = v; const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(p).color); return m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : null; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      for (const [fg, bg] of o.accentPairs) {
        const a = rs.getPropertyValue(fg).trim(), b = rs.getPropertyValue(bg).trim();
        if (!a || !b) continue;
        const ca = rgb(a), cb = rgb(b);
        if (!ca || !cb) continue;
        const L1 = lum(ca), L2 = lum(cb), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (ratio < 4.5) add('contrast.accent', document.documentElement, `${fg} (${a}) on ${bg} (${b}) is ${r1(ratio * 10) / 10}:1, under 4.5:1`);
      }
      p.remove();
    }

    /* same-component signatures, compared across every render by the checker */
    const sigs = [];
    if (o.signatures && T.same) {
      const cs = (el) => getComputedStyle(el);
      const r2 = (v) => String(v).replace(/-?\d+(\.\d+)?px/g, (m) => Math.round(parseFloat(m) * 2) / 2 + 'px');
      const pick = (el, ...k) => r2(k.map((x) => cs(el)[x]).join(' '));
      for (const d of all(document, T.same.dock)) {
        if (!vis(d)) continue;
        const kind = d.getAttribute('data-dk');
        if (!kind) { add('same-component', d, 'a dock drawn outside the one component (no data-dk geometry: the kit\'s Dock draws every dock)'); continue; }
        const row = d.querySelector('[data-kit-part~="DockRow"]'), geom = d.getAttribute('data-geom') || '';
        sigs.push(['dock:' + kind, [geom, row ? pick(row, 'paddingLeft', 'paddingRight', 'columnGap', 'height') : 'no row'].join(' | '), describe(d)]);
        if (kind !== 'open' && row) {
          const kids = [...row.children].filter((k) => cs(k).position !== 'absolute'), z = zoomOf(d);
          /* from the leftmost item to the rightmost as they are laid out: the app's dock orders its bots by their rank (CSS `order`), not by where they stand in the markup */
          const boxes = kids.map((k) => k.getBoundingClientRect());
          const content = kids.length ? (Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left))) / z : 0, pad = +d.getAttribute('data-pad');
          if (Math.abs(content + 2 * pad - d.offsetWidth) > 1) add('same-component', d, `the dock does not fit its content: width ${d.offsetWidth} != content ${r1(content)} + 2 x ${pad}`);
        }
      }
      for (const c of all(document, T.same.composer)) if (vis(c)) sigs.push(['composer', pick(c, 'borderTopLeftRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'minHeight'), describe(c)]);
      for (const t of all(document, T.same.titlePill)) if (vis(t)) sigs.push(['title-pill', pick(t, 'height', 'borderTopLeftRadius', 'paddingLeft', 'paddingRight'), describe(t)]);
      for (const q of all(document, T.same.askCard)) if (vis(q)) sigs.push(['askcard', pick(q, 'borderTopLeftRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'), describe(q)]);
    }
    return { findings: out, sigs };
  }
  window.__labProbeV7 = { run };
})();
