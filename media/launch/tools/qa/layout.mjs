/* Layout checks on the live page, where the DOM is exact (the page is the film's, or any page with window.__film and a
   .film-stage root, which is how selftest.mjs tests these).

     textEdges     text cut by the frame or set outside the safe area. 16:9: at least 48 px inside every edge (the
                   board keeps headlines about 90 px down; 30 px is the critic's A4-07). 9:16: the platforms' UI, the
                   top 220 px and bottom 280 px bands and the right-hand button column (x over 960; left margin 60),
                   craft bible part 10. What counts is the text's box after its own masks and overflow clips (a
                   line rising through a mask is not at the edge), before the frame's. Exempt: a run moving faster
                   than 6 px a frame (a deliberate bleed in motion: a whip, a carry). Sampled 4 times a second.
     actSpans      something an act owns drawn outside that act's span in the film scene. Ownership: the nearest
                   element (itself or an ancestor) whose class starts a1- to a4-. Before the act starts it always
                   fails; after it ends it fails unless it is a carry (drawn without a gap from inside the act across
                   the seam: ctx.carry hands the room, the composer and the desk on), which is listed. Drawn: it or a descendant is
                   visible by the computed styles (a visible child of a hidden parent is drawn, as CSS has it), its
                   opacity through every ancestor is over 0.02, its box meets the frame, and it paints (text, a
                   background, a border, a shadow, an image, svg or canvas). Sampled 4 times a second.
     chipBaselines every inline capsule set in text (.ui-mention, .ui-path, .ui-blank) against the text around it:
                   the capsule's own text baseline minus the line's, in 1080p px. The product's own offset comes from
                   the same capsule cloned into a plain line of the same font with no film transform (the kit's
                   vertical-align: -4px gives 0.8 px); scaled by the capsule's zoom, that is the expected offset, and
                   more than 1 px off it fails. Sampled twice a second. */
import { round } from './video.mjs';

/* in the page: the stage, its scale (screen px per film px), and every element's paint and visibility helpers */
const PAGE_HELPERS = () => {
  const root = document.querySelector('.film-stage');
  const fr = root.getBoundingClientRect(), film = window.__film, k = fr.width / film.width;
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n !== root.parentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.005) return 0; } return o; };
  /* the part of a rect its clipping ancestors leave, up to the stage (the frame itself is not applied) */
  const clipped = (el, r) => {
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let n = el; n && n !== root; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const m = /inset\(([^)]+)\)/.exec(cs.clipPath || '');
      if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY) && !m) continue;
      const c = n.getBoundingClientRect();
      let cx0 = c.left, cy0 = c.top, cx1 = c.right, cy1 = c.bottom;
      if (m) {
        const v = m[1].split(/\s+/).map((s) => (s.endsWith('%') ? parseFloat(s) / 100 : NaN));
        const [t = 0, rt = t, b = t, l = rt] = v.map((p) => (Number.isFinite(p) ? p : 0));
        cx0 = c.left + l * c.width; cx1 = c.right - rt * c.width; cy0 = c.top + t * c.height; cy1 = c.bottom - b * c.height;
      }
      x0 = Math.max(x0, cx0); y0 = Math.max(y0, cy0); x1 = Math.min(x1, cx1); y1 = Math.min(y1, cy1);
    }
    return x1 - x0 < 0.5 || y1 - y0 < 0.5 ? null : { x0: (x0 - fr.left) / k, y0: (y0 - fr.top) / k, x1: (x1 - fr.left) / k, y1: (y1 - fr.top) / k };
  };
  const label = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '');
  return { root, fr, film, k, opacityOf, clipped, label };
};

/** text runs now: [{ id, text, px, x0, y0, x1, y1 }] in film px, boxes after masks and clips, before the frame */
function textRunsNow(helpers) {
  const H = eval('(' + helpers + ')')();
  const out = [];
  const walker = document.createTreeWalker(H.root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let id = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || seen.has(el) || /^(STYLE|SCRIPT)$/.test(el.tagName) || el.closest('.film-hud, svg, .film-noqa')) continue;
    seen.add(el);
    if (getComputedStyle(el).visibility !== 'visible' || H.opacityOf(el) < 0.3) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const box = H.clipped(el, r);
    if (!box) continue;
    const ruler = document.createElement('span');
    ruler.style.cssText = 'display:inline-block;width:0;height:1em;vertical-align:baseline;padding:0;margin:0;border:0';
    el.appendChild(ruler); const px = ruler.getBoundingClientRect().height / H.k; ruler.remove();
    el.dataset.qaId ??= String(Math.random()).slice(2, 10);
    out.push({ id: el.dataset.qaId + ':' + id++, key: el.dataset.qaId, text: text.slice(0, 60), px, ...box });
  }
  return out;
}

const seekTo = (page, t) => page.evaluate((t) => window.__film.seek(t, { paint: false }), t);

export async function textEdges(page, { vertical = false, step = 0.25, minPx = 12 } = {}) {
  const meta = await page.evaluate(() => ({ duration: window.__film.duration, fps: window.__film.fps, width: window.__film.width, height: window.__film.height }));
  const W = meta.width, H = meta.height;
  const safe = vertical ? { left: 60, right: W - 120, top: 220, bottom: H - 280 } : { left: 48, right: W - 48, top: 48, bottom: H - 48 };
  const found = new Map();
  const helpers = PAGE_HELPERS.toString();
  for (let t = 0; t <= meta.duration + 1e-9; t += step) {
    await seekTo(page, t);
    const now = await page.evaluate(textRunsNow, helpers);
    await seekTo(page, Math.min(meta.duration, t + 1 / meta.fps));
    const late = await page.evaluate(textRunsNow, helpers);
    const byKey = new Map(late.map((r) => [r.key, r]));
    for (const r of now) {
      if (r.px < minPx) continue;
      if (r.x1 <= 0 || r.x0 >= W || r.y1 <= 0 || r.y0 >= H) continue;
      const cut = [];
      if (r.x0 < 0) cut.push('left edge'); if (r.x1 > W) cut.push('right edge'); if (r.y0 < 0) cut.push('top edge'); if (r.y1 > H) cut.push('bottom edge');
      const out = [];
      if (!cut.length) {
        if (r.x0 < safe.left) out.push('left ' + Math.round(r.x0) + ' px'); if (r.x1 > safe.right) out.push('right ' + Math.round(W - r.x1) + ' px from the edge');
        if (r.y0 < safe.top) out.push('top ' + Math.round(r.y0) + ' px'); if (r.y1 > safe.bottom) out.push('bottom ' + Math.round(H - r.y1) + ' px from the edge');
      }
      if (!cut.length && !out.length) continue;
      const l = byKey.get(r.key), speed = l ? Math.hypot((l.x0 + l.x1) / 2 - (r.x0 + r.x1) / 2, (l.y0 + l.y1) / 2 - (r.y0 + r.y1) / 2) : 0;
      if (speed > 6) continue;
      const kind = cut.length ? 'cut by the ' + cut.join(' and ') : 'outside the safe area (' + out.join(', ') + ')';
      const key = r.text + '|' + kind.replace(/\d+ px/g, '');
      const e = found.get(key) ?? { text: r.text, kind, from: round(t, 2), to: round(t, 2), box: [Math.round(r.x0), Math.round(r.y0), Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0)] };
      e.to = round(t, 2); found.set(key, e);
    }
  }
  /* the pieces of one line (words or letters set as separate spans) with the same fault over the same time: one entry */
  const lines = new Map();
  for (const e of found.values()) {
    const side = e.kind.replace(/\s*\(.*$/, '') + '|' + (e.kind.match(/left|right|top|bottom/g) ?? []).join(',');
    const k = e.from + '|' + e.to + '|' + side + '|' + Math.round(e.box[1] / 24);
    const l = lines.get(k);
    if (!l) { lines.set(k, { ...e, parts: [e] }); continue; }
    l.parts.push(e);
  }
  return [...lines.values()].map((l) => {
    const parts = l.parts.sort((p, q) => p.box[0] - q.box[0]);
    const x0 = Math.min(...parts.map((p) => p.box[0])), y0 = Math.min(...parts.map((p) => p.box[1])), x1 = Math.max(...parts.map((p) => p.box[0] + p.box[2])), y1 = Math.max(...parts.map((p) => p.box[1] + p.box[3]));
    return { text: parts.map((p) => p.text).join(parts.every((p) => p.text.length === 1) ? '' : ' '), kind: parts[0].kind, from: l.from, to: l.to, box: [x0, y0, x1 - x0, y1 - y0] };
  });
}

/** the acts' spans on the film's clock, from src/acts/seams.ts (S1, S2, S3) */
export function actWindows(seamsTs, duration) {
  const t = [...seamsTs.matchAll(/id:\s*'S(\d)',\s*t:\s*([\d.]+)/g)].sort((a, b) => a[1] - b[1]).map((m) => Number(m[2]));
  if (t.length !== 3) throw new Error('could not read the three seams from seams.ts');
  return { a1: [0, t[0]], a2: [t[0], t[1]], a3: [t[1], t[2]], a4: [t[2], duration] };
}

function drawnByActNow(helpers) {
  const H = eval('(' + helpers + ')')();
  const W = H.film.width, Hh = H.film.height;
  const owners = new Map();
  for (const el of H.root.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || cs.display === 'none') continue;
    let owner = null;
    for (let n = el; n && n !== H.root; n = n.parentElement) { const c = typeof n.className === 'string' ? n.className : (n.className && n.className.baseVal) || ''; const m = /(?:^|\s)((a[1-4])-[\w-]+)/.exec(c); if (m) { owner = { act: m[2], el: n, cls: m[1] }; break; } }
    if (!owner) continue;
    const paints = (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'svg' || el.tagName === 'VIDEO') || [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) ||
      (/rgba?\(/.test(cs.backgroundColor) && !/rgba\([^)]*,\s*0\)$/.test(cs.backgroundColor) && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
      ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && !/rgba\([^)]*,\s*0\)$/.test(cs['border' + s + 'Color']));
    if (!paints) continue;
    if (H.opacityOf(el) < 0.02) continue;
    const r = el.getBoundingClientRect();
    const box = H.clipped(el, r);
    if (!box || box.x1 <= 0 || box.y1 <= 0 || box.x0 >= W || box.y0 >= Hh || (box.x1 - box.x0) * (box.y1 - box.y0) < 4) continue;
    const name = owner.el.tagName.toLowerCase() + '.' + owner.cls;
    const o = owners.get(name) ?? { act: owner.act, owner: name, what: H.label(el), area: 0 };
    o.area += (Math.min(W, box.x1) - Math.max(0, box.x0)) * (Math.min(Hh, box.y1) - Math.max(0, box.y0));
    owners.set(name, o);
  }
  return [...owners.values()];
}

/** elements an act owns drawn outside its span: [{ owner, act, what, from, to, carried }] on the film's clock. Drawn
    before the act starts always fails (nothing carries backwards). Drawn after it ends fails unless it is a carry: drawn
    at the act's last sample and on, with no gap, across the seam (ctx.carry hands it to the next act) */
export async function actSpans(page, windows, { step = 0.25 } = {}) {
  const meta = await page.evaluate(() => ({ duration: window.__film.duration, offset: window.__film.offset ?? 0 }));
  const helpers = PAGE_HELPERS.toString(), seen = new Map(), times = [];
  for (let t = 0; t <= meta.duration + 1e-9; t += step) {
    await seekTo(page, t);
    const T = round(t + meta.offset, 3); times.push(T);
    for (const o of await page.evaluate(drawnByActNow, helpers)) {
      const e = seen.get(o.owner) ?? { owner: o.owner, act: o.act, what: o.what, at: new Set(), maxArea: 0 };
      e.at.add(T); e.maxArea = Math.max(e.maxArea, Math.round(o.area)); seen.set(o.owner, e);
    }
  }
  const out = [];
  for (const e of seen.values()) {
    const [a, b] = windows[e.act];
    const inside = (T) => T >= a - 1e-6 && T < b - 1e-6;
    const before = times.filter((T) => T < a - 1e-6 && e.at.has(T)), after = times.filter((T) => T >= b - 1e-6 && e.at.has(T));
    /* a carry: visible at the act's last sample and at every sample after it up to its last showing */
    const lastIn = times.filter(inside).pop(), afterAll = times.filter((T) => T >= b - 1e-6 && T <= (after[after.length - 1] ?? -1));
    const carried = after.length > 0 && lastIn != null && e.at.has(lastIn) && afterAll.every((T) => e.at.has(T));
    const span = a + '-' + (b === Infinity ? 'end' : b) + ' s';
    if (before.length) out.push({ owner: e.owner, act: e.act.toUpperCase(), span, what: e.what, from: before[0], to: before[before.length - 1], when: 'before its act', carried: false, maxArea: e.maxArea });
    if (after.length) out.push({ owner: e.owner, act: e.act.toUpperCase(), span, what: e.what, from: after[0], to: after[after.length - 1], when: carried ? 'carried across the seam' : 'after its act', carried, maxArea: e.maxArea });
  }
  return out;
}

function chipsNow(helpers) {
  const H = eval('(' + helpers + ')')();
  const out = [];
  const mark = () => { const s = document.createElement('span'); s.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;padding:0;margin:0;border:0;line-height:normal'; return s; };
  const nameOf = (chip) => chip.querySelector('.ui-mention__name, .ui-path__name') || chip;
  const firstText = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim()) return n; return null; };
  for (const chip of H.root.querySelectorAll('.ui-mention, .ui-path, .ui-blank')) {
    const parent = chip.parentElement;
    if (!parent || getComputedStyle(chip).visibility !== 'visible' || H.opacityOf(chip) < 0.3) continue;
    /* set in text: the parent has words of its own outside the capsule */
    const own = [...parent.childNodes].some((c) => c !== chip && ((c.nodeType === 3 && c.textContent.trim()) || (c.nodeType === 1 && !c.matches('.ui-mention, .ui-path, .ui-blank') && c.textContent.trim())));
    if (!own) continue;
    const r = chip.getBoundingClientRect();
    if (r.width < 1 || !H.clipped(chip, r)) continue;
    const tn = firstText(nameOf(chip)); if (!tn) continue;
    const measure = (c) => {
      const tnc = firstText(nameOf(c)); const a = mark(), b = mark();
      tnc.parentElement.insertBefore(a, tnc); c.parentElement.insertBefore(b, c);
      const d = a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom;
      a.remove(); b.remove(); return d;
    };
    const film = measure(chip) / H.k;
    /* the product: the same capsule in a plain line of the parent's font, no film transform */
    const cs = getComputedStyle(parent), ref = document.createElement('div');
    ref.style.cssText = 'position:absolute;left:-10000px;top:0;transform:none;zoom:1;white-space:nowrap;font:' + cs.font + ';letter-spacing:' + cs.letterSpacing + ';color:' + cs.color;
    const clone = chip.cloneNode(true); clone.style.transform = ''; clone.style.zoom = ''; clone.style.translate = ''; clone.style.top = ''; clone.style.position = '';
    ref.append('is it ready to ', clone, ' cut?'); document.body.appendChild(ref);
    const product = measure(clone);
    const ruler = mark(); ruler.style.height = '1em'; ref.appendChild(ruler); const emRef = ruler.getBoundingClientRect().height; ruler.remove();
    ref.remove();
    const pr = mark(); pr.style.height = '1em'; parent.appendChild(pr); const emFilm = pr.getBoundingClientRect().height / H.k; pr.remove();
    const zoom = emRef ? emFilm / emRef : 1;
    out.push({ text: (parent.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50), chip: H.label(chip) + ' "' + tn.textContent.trim() + '"', film, product, zoom, expected: product * zoom });
  }
  return out;
}

/** inline capsules off the line's baseline: [{ text, chip, offset, expected, from, to }] in 1080p px; all: every capsule */
export async function chipBaselines(page, { step = 0.5, tol = 1 } = {}) {
  const meta = await page.evaluate(() => ({ duration: window.__film.duration }));
  const helpers = PAGE_HELPERS.toString(), found = new Map(), all = new Map();
  for (let t = 0; t <= meta.duration + 1e-9; t += step) {
    await seekTo(page, t);
    for (const c of await page.evaluate(chipsNow, helpers)) {
      const key = c.chip + '|' + c.text;
      const a = all.get(key) ?? { text: c.text, chip: c.chip, offset: round(c.film, 2), expected: round(c.expected, 2), product: round(c.product, 2), from: round(t, 2), to: round(t, 2) };
      a.to = round(t, 2); all.set(key, a);
      if (Math.abs(c.film - c.expected) <= tol) continue;
      const e = found.get(key) ?? { ...a, from: round(t, 2) };
      e.to = round(t, 2); if (Math.abs(c.film - c.expected) > Math.abs(e.offset - e.expected)) { e.offset = round(c.film, 2); e.expected = round(c.expected, 2); }
      found.set(key, e);
    }
  }
  return { off: [...found.values()], all: [...all.values()] };
}
