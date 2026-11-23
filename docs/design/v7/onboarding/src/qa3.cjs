// Render QA for the v7 boards and screens: node qa.cjs <url> ... (or --jobs jobs.json to read the urls of a render job list)
// Flags: wrap (a single-line control on more than one line), overflow (a control's text wider than its box), escape (an element
// crossing its board half or its window), clip (text cut without an ellipsis), baseline (R-inline-1, > 0.5 device px),
// padding (left != right or top != bottom by > 0.5 px in cards and controls), align (siblings that should share a left edge),
// row (a menu or list row whose text wraps or runs past the row), concentric (a control nested near a container's corner whose
// radius is not the outer radius minus the inset, whose insets are unequal, or which runs past the container's edge),
// mark (the dashed underline shown at rest outside feedforward and blank contexts: the composer's text, a reply's guess, an AskCard,
// a blank; an info label shows it only on hover or focus, section 17), sweep (a still shows live things at rest: no status phrase
// mid-shimmer, no breath mid-cycle, no live orb and no logomark with its own idle on; revision 2 adds the last two), same-component
// (v7: one geometry per component across renders), align-btn (revision 3: stacked or sibling buttons share a centre line or both
// edges; a page's CTA sits on its heading's axis; a card's CTA on the card's content edge).
// Clip frames: node qa3.cjs --clips wake,stepsA,...[:r] : every rest point and each transition's end of each clip (r = reduced motion).
const { chromium } = require('playwright');
const fs = require('fs');
let urls = process.argv.slice(2); let clips = null;
if (urls[0] === '--clips') { clips = urls[1].split(',').map((c) => [c.replace(/:r$/, ''), /:r$/.test(c)]); urls = urls.slice(2); }
urls = !urls.length ? [] : urls[0] === '--jobs' ? [].concat(...urls.slice(1).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')).map((j) => ({ url: j.url, w: Math.max(j.w || 2200, 1440) })))) : urls.map((url) => ({ url, w: 2200 }));
const PAGE = (opt = {}) => {
  const out = [];
  const eff = (el) => { let o = 1; for (let a = el; a && a.nodeType === 1; a = a.parentElement) o *= +getComputedStyle(a).opacity; return o; };
  const vis = (el) => { if (el.closest('.thumb')) return false; /* scaled copies of screens QA'd at full size */ const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0 && (!opt.clip || eff(el) > 0.02); };
  const name = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase()) + ' "' + (el.textContent || '').trim().slice(0, 28) + '"';
  const roots = [...document.querySelectorAll('.bd .cell')].length ? [...document.querySelectorAll('.bd .cell')] : [...document.querySelectorAll('.win')];
  const lines = (el, own) => { const tops = new Set(); const rects = []; if (own) { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); rects.push(...rg.getClientRects()); } } else { const rg = document.createRange(); rg.selectNodeContents(el); rects.push(...rg.getClientRects()); } for (const r of rects) if (r.width > 1 && r.height > 4) tops.add(Math.round(r.top + r.height / 2)); const arr = [...tops].sort((a, b) => a - b); let n = 0, last = -99; for (const t of arr) { if (t - last > 6) n++; last = t; } return n; };
  for (const root of roots) {
    const R = root.getBoundingClientRect();
    // wrap and overflow in single-line controls
    for (const el of root.querySelectorAll('.seg span, .scale span, .chip, .btn, .badge2, .kbd, .select, .title-pill, .refchip, .you, .stamp, .tip, .mi, .blank-count, .q .ell')) {
      if (!vis(el) || !(el.textContent || '').trim()) continue;
      if (lines(el) > 1) out.push(['wrap', name(el)]);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis' && getComputedStyle(el).display !== 'inline') out.push(['overflow', name(el)]);
    }
    // escape: the visible part of an element (clipped by its own clipping ancestors inside the root) must stay inside the root
    for (const el of root.querySelectorAll('*')) {
      if (!vis(el) || el.closest('svg') && el.tagName !== 'svg') continue;
      let r = el.getBoundingClientRect(); let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        const cs = getComputedStyle(a); if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible' && cs.clipPath === 'none') continue;
        const ar = a.getBoundingClientRect(); x0 = Math.max(x0, ar.left); y0 = Math.max(y0, ar.top); x1 = Math.min(x1, ar.right); y1 = Math.min(y1, ar.bottom);
      }
      if (x1 <= x0 || y1 <= y0) continue;
      if (x0 < R.left - 0.5 || x1 > R.right + 0.5 || y0 < R.top - 0.5 || y1 > R.bottom + 0.5) { if (!el.closest('.slab') && !el.matches('.dock, .dock *')) out.push(['escape', name(el)]); }
    }
    // clipped text with no ellipsis
    for (const el of root.querySelectorAll('*')) {
      if (!vis(el)) continue; const cs = getComputedStyle(el);
      if (cs.overflow === 'visible' || cs.textOverflow === 'ellipsis' || el.matches('.win, .main, .well, .term, .setbody, .side, .rpanel, .pane, .dialog, .cell, .clip, .gutter')) continue;
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (direct && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2)) out.push(['clip', name(el)]);
    }

    // menu and list rows: every text in a row is on one line and stays inside the row (or truncates with an ellipsis)
    for (const row of root.querySelectorAll('.mi, .sess-row, .q, .q .opt, .sb-srow, .fl, .ni, .sr, .optrow, .file, .sb-row')) {
      if (!vis(row)) continue; const rr = row.getBoundingClientRect(); const rcs = getComputedStyle(row);
      const right = rr.right - parseFloat(rcs.paddingRight) + 0.5;
      for (const el of [row, ...row.querySelectorAll('*')]) {
        if (!vis(el) || el.closest('svg, orb-avatar, .menu .menu') || el !== row && el.closest('.menu') !== row.closest('.menu')) continue;
        const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!direct) continue;
        const cs = getComputedStyle(el);
        if (lines(el, true) > 1 && !el.matches('.wrap-ok, .wrap-ok *')) out.push(['row', 'wraps: ' + name(el)]);
        if (cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') out.push(['row', 'cut without ellipsis: ' + name(el)]);
        const rg = document.createRange(); rg.selectNodeContents(el); let tr = 0; for (const r of rg.getClientRects()) tr = Math.max(tr, r.right);
        let lim = Infinity; for (let a = el; a && a !== row; a = a.parentElement) { const c = getComputedStyle(a); if (c.overflow !== 'visible') lim = Math.min(lim, a.getBoundingClientRect().right + 0.5); }
        if (Math.min(tr, lim) > right) out.push(['row', 'runs past the row: ' + name(el)]);
      }
    }
    // concentric nesting: a control in a container's corner zone has radius = outer radius - inset, equal insets, and stays inside
    const er = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const z = el.offsetWidth ? r.width / el.offsetWidth : 1; const v = (parseFloat(cs.borderTopRightRadius) || 0) * z; return Math.min(v, r.height / 2, r.width / 2); };
    const shelled = (el) => { const cs = getComputedStyle(el); return el.matches('.sq') && cs.getPropertyValue('--sq-bg').trim() !== 'transparent' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'; };
    for (const kid of root.querySelectorAll('.btn, .ib, .chip, .seg > span.on, .scale > span.on, .menu > .mi, .kbd, .select, .badge2, .toggle')) {
      if (!vis(kid) || (parseFloat(getComputedStyle(kid).borderTopRightRadius) || 0) === 0 && !kid.matches('.select')) continue;
      let box = kid.parentElement; while (box && box !== root && !(shelled(box) && (parseFloat(getComputedStyle(box).borderTopRightRadius) || 0) > 0)) box = box.parentElement;
      if (!box || box === root || box.matches('.win, .main, .side, .pane, .dialog, .rpanel, .cell')) continue;
      const k = kid.getBoundingClientRect(), b = box.getBoundingClientRect(), R0 = er(box);
      const iL = k.left - b.left, iR = b.right - k.right, iT = k.top - b.top, iB = b.bottom - k.bottom;
      if (Math.min(iL, iR, iT, iB) < -0.5) { out.push(['concentric', 'runs past its container: ' + name(kid) + ' in ' + name(box)]); continue; }
      const h = Math.min(iL, iR), v = Math.min(iT, iB);
      if (h >= R0 - 0.5 || v >= R0 - 0.5) continue; // not in a corner zone
      if (Math.abs(h - v) > 0.5) out.push(['concentric', `unequal insets ${h.toFixed(1)}/${v.toFixed(1)}: ` + name(kid) + ' in ' + name(box)]);
      else if (Math.abs(er(kid) - (R0 - v)) > 0.75) out.push(['concentric', `radius ${er(kid).toFixed(1)} != ${R0.toFixed(1)} - ${v.toFixed(1)}: ` + name(kid) + ' in ' + name(box)]);
    }

    // section 17: a mark at rest only in feedforward and blank contexts; info labels only on hover or focus
    for (const m of root.querySelectorAll('.mk2')) {
      if (!vis(m)) continue; const st = m.getAttribute('data-state') || '';
      if (!st || st === 'hover' || st === 'open' || m.classList.contains('focus')) continue;
      if (m.classList.contains('gap') || m.closest('.composer, .b, .qcard, .hov')) continue;
      out.push(['mark', `shown at rest (${st}) outside feedforward or a blank: ` + name(m)]);
    }
    if (!opt.clip) {
    // stills: no status phrase frozen mid-sweep (the shimmer's gradient clipped to text) and no breath frozen mid-cycle
    for (const el of root.querySelectorAll('.shimmer, .mk.pulse, .dot.run')) {
      if (!vis(el)) continue; const cs = getComputedStyle(el);
      if (el.matches('.shimmer') && cs.backgroundImage !== 'none' && (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text')) out.push(['sweep', 'a status phrase frozen mid-sweep: ' + name(el)]);
      if (el.matches('.mk.pulse, .dot.run') && cs.animationName !== 'none') out.push(['sweep', 'a breath frozen mid-cycle: ' + name(el)]);
    }
    // revision 2: every live thing at rest in a still: an orb is drawn still (orb2's static frame, in its pose: a live orb can be
    // caught mid-blink, mid-glance or mid-hop), and a logomark either still or with its own idle off and settled (the speaker)
    for (const el of root.querySelectorAll('orb-avatar')) {
      if (!vis(el) || el.closest('[data-motion]')) continue;
      if (!el.hasAttribute('static')) out.push(['sweep', 'a live orb in a still (could be caught mid-blink or mid-move): ' + (el.getAttribute('shape') || '')]);
    }
    for (const el of root.querySelectorAll('boopis-logo')) {
      if (!vis(el) || el.closest('[data-motion]')) continue;
      if (!el.hasAttribute('still') && !(el.getAttribute('gaze') === 'off' && el.getAttribute('blink') === 'off')) out.push(['sweep', 'a live logomark with its own idle on in a still (could be caught mid-blink)']);
      const h = el.closest('.ob-spk-h'); if (h && h.getAnimations && h.getAnimations().length) out.push(['sweep', 'the speaker’s head animating in a still']);
    }
    }
    // R-inline-1
    const probe = () => { const s = document.createElement('span'); s.textContent = 'x'; s.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;vertical-align:baseline'; return s; };
    for (const chip of root.querySelectorAll('.you, .mention, .refchip, .b code, .mk2:not(.gap), .blank-count, .badge2')) {
      const line = chip.parentElement; if (!vis(chip) || !getComputedStyle(chip).display.startsWith('inline') || /flex|grid/.test(getComputedStyle(line).display) || chip.getClientRects().length > 1) continue;
      const a = probe(), a2 = probe(), c = probe(); line.insertBefore(a, chip); line.insertBefore(a2, chip.nextSibling); const t = [...chip.children].find((k) => !k.matches('svg, orb-avatar')) || chip; t.appendChild(c);
      const cr = chip.getBoundingClientRect(); const on = (p) => { const r = p.getBoundingClientRect(); return r.bottom >= cr.top - 1 && r.bottom <= cr.bottom + 1; }; const ref = on(a) ? a : a2;
      const d = Math.abs(ref.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom) * devicePixelRatio; a.remove(); a2.remove(); c.remove();
      if (d > 0.5 && Math.abs(a.getBoundingClientRect().top) < 1e9) out.push(['baseline', name(chip) + ' ' + d.toFixed(1) + 'dpx']);
    }
    // symmetric padding
    for (const el of root.querySelectorAll('.card, .toolrow, .files-card, .qcard, .queue, .chip, .btn, .seg, .dv-c, .b, .badge2, .menu, .tip, .toast, .sess-row, .sr, .banner, .file, .optrow, .refchip, .you')) {
      if (!vis(el)) continue; const cs = getComputedStyle(el); const L = parseFloat(cs.paddingLeft), Rp = parseFloat(cs.paddingRight), T = parseFloat(cs.paddingTop), B = parseFloat(cs.paddingBottom);
      if (Math.abs(L - Rp) > 0.5 || Math.abs(T - B) > 0.5) out.push(['padding', name(el) + ` ${T}/${Rp}/${B}/${L}`]);
    }

    // revision 3, align-btn: stacked or sibling buttons share their centre line or both edges; a page's CTA sits on its
    // heading's axis; a CTA inside a Block or card sits on the card's content edge (the edge its rows start on)
    const bx = (el) => el.getBoundingClientRect();
    const btnOK = (b) => vis(b) && !b.closest('.ob-skip, .composer, .menu, .sr, .notice, .tile, .ob-gt, .seg, .drag, .side, .slab, .dock, .wc, .title-pill');
    const parents = new Set([...root.querySelectorAll('.btn')].filter((b) => btnOK(b) && !b.matches('.ob-skip')).map((b) => b.parentElement));
    for (const par of parents) {
      const bs = [...par.children].filter((k) => k.matches('.btn') && btnOK(k)); if (bs.length < 2) continue;
      const rs = bs.map(bx);
      const stacked = rs.every((r, i) => !i || r.top >= rs[i - 1].bottom - 1);
      if (stacked) { const cx = rs.map((r) => (r.left + r.right) / 2); const sameC = Math.max(...cx) - Math.min(...cx) <= 0.5; const sameE = Math.max(...rs.map((r) => r.left)) - Math.min(...rs.map((r) => r.left)) <= 0.5 && Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.right)) <= 0.5; if (!sameC && !sameE) out.push(['align-btn', 'stacked buttons off one centre line by ' + (Math.max(...cx) - Math.min(...cx)).toFixed(1) + 'px: ' + bs.map(name).join(' / ')]); }
      else { const cy = rs.map((r) => (r.top + r.bottom) / 2); if (Math.max(...cy) - Math.min(...cy) > 0.5) out.push(['align-btn', 'sibling buttons off one centre line by ' + (Math.max(...cy) - Math.min(...cy)).toFixed(1) + 'px: ' + bs.map(name).join(' / ')]); }
    }
    const tc = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const rr = [...rg.getClientRects()].filter((r) => r.width > 1); const l = Math.min(...rr.map((r) => r.left)), r = Math.max(...rr.map((r) => r.right)); return (l + r) / 2; };
    for (const h of root.querySelectorAll('.ob-h, .ns-h')) {
      if (!vis(h)) continue; const scope = h.parentElement; const hc = tc(h);
      for (const b of scope.querySelectorAll('.btn')) {
        if (!btnOK(b) || b.matches('.ob-skip') || b.closest('.qcard, .card, .blk, .q, .ns-hello')) continue;
        const grp = b.parentElement; const g = [...grp.children].filter((k) => k.matches('.btn') && btnOK(k)); const r = g.map(bx);
        const gc = (Math.min(...r.map((x) => x.left)) + Math.max(...r.map((x) => x.right))) / 2;
        if (Math.abs(gc - hc) > 0.5) out.push(['align-btn', `CTA off its heading's axis by ${(gc - hc).toFixed(1)}px: ` + name(b) + ' under ' + name(h)]);
        const own = bx(b); if (r.length > 1 && r.every((x, i) => !i || x.top >= r[i - 1].bottom - 1) && Math.abs((own.left + own.right) / 2 - hc) > 0.5) out.push(['align-btn', `stacked CTA off its heading's axis by ${((own.left + own.right) / 2 - hc).toFixed(1)}px: ` + name(b)]);
      }
    }
    for (const card of root.querySelectorAll('.qcard, .blk')) {
      if (!vis(card)) continue; const first = [...card.querySelectorAll(':scope > .ob-opts > *, :scope > .opt, :scope > .hd, :scope > .ob-qh, :scope > .row, :scope > .m, :scope > .ob-gts, :scope > .ob3-tms')].find(vis); if (!first) continue;
      const edge = bx(first).left;
      const foot = card.querySelector(':scope > .ob-foot, :scope > .row:last-child'); if (!foot || foot === first) continue;
      const cta = [...foot.children].find((k) => (k.matches('.btn, .chip')) && vis(k)); if (!cta) continue;
      if (Math.abs(bx(cta).left - edge) > 0.5) out.push(['align-btn', `card CTA off the card's content edge by ${(bx(cta).left - edge).toFixed(1)}px: ` + name(cta) + ' in ' + name(card)]);
    }
    // shared left edges
    const groups = [['.card', ':scope > .sr'], ['.steps', ':scope > .step'], ['.queue', ':scope > .q'], ['.menu', ':scope > .mi'], ['.files-card', ':scope > .fl'], ['.dv', ':scope > .dv-r'], ['.side', ':scope > .sess-row, :scope > .sb-row'], ['.thread.sess', ':scope > .b.agent, :scope > .worklog, :scope > .toolrow, :scope > .files-card, :scope > .turnbar, :scope > .qcard, :scope > .activity']];
    for (const [c, k] of groups) for (const box of root.querySelectorAll(c)) {
      const ls = [...box.querySelectorAll(k)].filter(vis).map((e) => e.getBoundingClientRect().left);
      if (ls.length > 1 && Math.max(...ls) - Math.min(...ls) > 0.5) out.push(['align', c + ' > ' + k.split(',')[0].replace(':scope > ', '') + ' spread ' + (Math.max(...ls) - Math.min(...ls)).toFixed(1)]);
    }
    for (const dv of root.querySelectorAll('.dv')) {
      const code = dv.querySelector('.dv-r > span:nth-child(3)'), cm = dv.querySelector('.dv-c');
      if (code && cm && vis(cm) && Math.abs(code.getBoundingClientRect().left - cm.getBoundingClientRect().left) > 0.5) out.push(['align', '.dv-c not on the code column ' + (cm.getBoundingClientRect().left - code.getBoundingClientRect().left).toFixed(1)]);
    }
  }
  return out;
};
const SIG = (isScreen) => {
  const out = [], cs = (el) => getComputedStyle(el), r2 = (v) => v.replace(/-?\d+(\.\d+)?px/g, (m) => Math.round(parseFloat(m) * 2) / 2 + 'px'), px = (el, ...k) => r2(k.map((x) => cs(el)[x]).join(' '));
  for (const d of document.querySelectorAll('.dock')) {
    const kind = d.getAttribute('data-dk');
    if (!kind) { out.push(['dock:legacy', 'drawn outside the one component']); continue; }
    const row = d.querySelector('.dk-in > .dk7-row, .dk7-row'), geom = d.getAttribute('data-geom');
    const path = kind === 'open' ? '' : (d.querySelector('svg.slab > path') || {}).getAttribute?.('d') || '';
    out.push(['dock:' + kind, [geom, path.length + ':' + path.slice(0, 40), row ? px(row, 'paddingLeft', 'paddingRight', 'columnGap', 'height') : 'no row'].join(' | ')]);
  }
  if (isScreen) {
    for (const c of document.querySelectorAll('.composer')) { const l = c.querySelector(':scope > .line'); if (!l || c.querySelector('.modes, .queue-strip')) continue; out.push(['composer', [px(c, 'borderTopLeftRadius'), px(l, 'height', 'paddingLeft', 'paddingRight', 'columnGap')].join(' | ')]); }
    for (const t of document.querySelectorAll('.title-pill')) out.push(['title-pill', px(t, 'height', 'borderTopLeftRadius', 'paddingLeft', 'paddingRight')]);
    for (const q of document.querySelectorAll('.qcard')) out.push(['askcard', px(q, 'borderTopLeftRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft')]);
  }
  return out;
};

const CLOCK = fs.readFileSync(__dirname + '/rec3.cjs', 'utf8').match(/const CLOCK = `([\s\S]*?)`;/)[1];
(async () => {
  const b = await chromium.launch(); let total = 0; const lines = []; const sigs = {};
  if (clips) {
    // clip frames: every rest point and each transition's end. A frame is at rest when no page part (outside the speaker, the
    // orbs and a status phrase) changed its inline transform, opacity, visibility, height or text since the previous frame;
    // the first frame of each rest is checked
    for (const [clip, reduced] of clips) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => console.error('PAGEERR', e.message));
      await pg.addInitScript(CLOCK);
      await pg.goto('file://' + __dirname + '/ob3-motion.html?clip=' + clip + (reduced ? '&reduced=1' : ''));
      await pg.evaluate(() => document.fonts.ready);
      const dur = await pg.evaluate((c) => { window.CLIP = window.CLIPS[c](); window.__step(16); return window.CLIP.dur; }, clip);
      await pg.evaluate(() => { for (let i = 0; i < 30; i++) { window.__step(1000 / 60); window.CLIP.at(0); } });   /* the recorder's pre-roll */
      const N = Math.round(dur / 1000 * 60); let prev = '', lastQA = '', n = 0, found = 0; const by = {};
      for (let f = 0; f < N; f++) {
        const sg = await pg.evaluate((t) => { window.__step(1000 / 60); window.CLIP.at(t); const parts = []; for (const e of document.querySelectorAll('#r *')) { if (e.closest('.ob-spk, orb-avatar, .shimmer, svg, .ob2-orbit')) continue; const st = e.getAttribute('style'); if (st) parts.push(st); } for (const e of document.querySelectorAll('.ph, .word, .shimmer')) parts.push(e.textContent); return parts.join('|'); }, f * 1000 / 60);
        const rest = sg === prev; prev = sg;
        if (rest && sg !== lastQA) { lastQA = sg; n++; const res = await pg.evaluate(PAGE, { clip: true }); for (const [k, v] of res) { found++; ((by[k + ' @' + (f / 60).toFixed(2) + 's'] = by[k + ' @' + (f / 60).toFixed(2) + 's'] || [])).push(v); } }
      }
      total += found;
      lines.push((found ? 'FAIL ' : 'ok   ') + `clip ${clip}${reduced ? ' reduced' : ''}: ${n} rest points checked` + (found ? '  ' + Object.entries(by).map(([k, v]) => `${k}: ${[...new Set(v)].slice(0, 2).join(' | ')}`).join('  ;  ') : ''));
      await ctx.close();
    }
  }
  for (const { url, w } of urls) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
    await p.goto(url); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(900);   /* orb3's stills freeze 520 ms in */
    const H = await p.evaluate(() => document.documentElement.scrollHeight); await p.setViewportSize({ width: w, height: Math.min(H, 12000) });
    await p.evaluate(() => { window.V7 && V7.brand && V7.brand(); window.V7 && V7.paint(); });
    const res = await p.evaluate(PAGE, {}); total += res.length;
    for (const [cls, key] of await p.evaluate(SIG, /\?s=/.test(url))) { if (cls === 'dock:legacy') { res.push(['same-component', 'a dock drawn outside the one component']); total++; continue; } ((sigs[cls] = sigs[cls] || {})[key] = sigs[cls][key] || []).push(url.split('?')[1]); }
    const by = {}; for (const [k, v] of res) (by[k] = by[k] || []).push(v);
    lines.push((res.length ? 'FAIL ' : 'ok   ') + url.split('?')[1] + (res.length ? '  ' + Object.entries(by).map(([k, v]) => `${k} ${v.length}: ${[...new Set(v)].slice(0, 3).join(' | ')}`).join('  ;  ') : ''));
    await p.close();
  }
  for (const [cls, keys] of Object.entries(sigs)) { const ks = Object.keys(keys); if (ks.length > 1) { total++; lines.push(`FAIL same-component ${cls}: ${ks.length} geometries: ` + ks.map((k) => `[${k}] in ${keys[k].slice(0, 2).join(', ')}${keys[k].length > 2 ? ' +' + (keys[k].length - 2) : ''}`).join('  vs  ')); } }
  console.log(lines.join('\n')); console.log(`\n${urls.length} pages, ${clips ? clips.length + ' clips, ' : ''}${total} findings`); await b.close();
})();
