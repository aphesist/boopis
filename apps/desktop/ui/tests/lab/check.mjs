/* `pnpm lab:check`: every story's every state, in every theme preset and width, through the lab's checks
   (rules.mjs, probe.js), in Chromium. Writes lab-report/index.html (every failure with a crop and the mock's
   counterpart) and lab-report/summary.json. docs/UI-LAB.md.

   pnpm lab:check [--area composer,dock] [--story composer/composer] [--state "attach hover"]
                  [--quick] [--presets catalog,bone] [--widths 1440] [--jobs 3]
                  [--update] [--no-visual] [--no-axe] [--no-stability] [--strict]

   --dpr 1.6    run at the owner's fractional scale (device pixel ratio 1.6; goldens are kept at 1, so add --no-visual)
   --quick      two presets (catalog, bone) and one width (1440): a fast loop for a fix agent
   --update     accept the screenshots as the new goldens (tests/lab-golden)
   --draw-only  only check that every state draws without an error (seconds, not minutes)
   --strict     exit 1 when any check fails (CI); without it a run that finished exits 0 and the report says what failed

   How a state is checked. One page load per state at 1440 x 900 with reduced motion (the static checks need a still
   page). For each preset: at each width the in-page checks run at rest; at 1440 (and at 390 in the default preset) they
   run again with every interactive element forced to hover, then focus, then pressed; at 1440 axe runs and the
   screenshot is compared. Then the state is drawn a second time (a fresh cell, or a reload) and its DOM compared; then,
   for a state with interactions, a fresh load with full motion samples frames while the interaction plays. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, statfsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { labRoute, typeOf, UI_ROOT } from './serve.mjs';
import { CHECKS, AREAS, AREA_TITLES, BRAND_ALLOW, areaOf, ruleCoverage } from './rules.mjs';
import { scan } from './static-scan.mjs';
import { writeReport } from './report.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default ?? require('pixelmatch');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PROBE = join(UI_ROOT, 'tests', 'lab', 'probe.js');
const DIST = join(UI_ROOT, 'dist-e2e');
const GOLDEN = join(UI_ROOT, 'tests', 'lab-golden');
const REPORT = join(UI_ROOT, 'lab-report');
const TOKEN_NAMES = [...new Set([...readFileSync(join(UI_ROOT, 'src', 'styles', 'tokens.css'), 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))];

/* ───────── arguments ───────── */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const quick = flag('quick');
const PRESETS = opt('presets', quick ? 'catalog,bone' : 'catalog,graphite,bone,typewriter').split(',');
const WIDTHS = opt('widths', quick ? '1440' : '390,1200,1440,1920').split(',').map(Number);
const AREA = opt('area', '') ? opt('area', '').split(',').map(areaOf) : null;
const STORY = opt('story', '');
const STATE = opt('state', '');
const ONLY_OVERLAY = flag('only-overlay');
const JOBS = Number(opt('jobs', '3'));
const DPR = Number(opt('dpr', '1'));   /* --dpr 1.6: the owner's fractional scale, as the device pixel ratio */
const UPDATE = flag('update');
let VISUAL = !flag('no-visual');
const AXE_ON = !flag('no-axe');
const STABLE = !flag('no-stability');
const DRAW_ONLY = flag('draw-only');
const FORCES = ['hover', 'focus', 'active'];
const FORCED_CHECKS = ['geometry.contain', 'concentric', 'tokens.computed', 'overlay'];
const MAX_CROPS = 900;
if (AREA && AREA.some((a) => !AREAS.includes(a))) { console.error('unknown area: ' + AREA.join(',') + ' (areas: ' + AREAS.join(', ') + ')'); process.exit(2); }

/* ───────── build and serve ───────── */
function build() {
  const dist = join(DIST, 'lab.html');
  const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((m, d) => Math.max(m, d.isDirectory() ? newest(join(dir, d.name)) : statSync(join(dir, d.name)).mtimeMs), 0);
  const src = Math.max(newest(join(UI_ROOT, 'src')), statSync(join(UI_ROOT, 'index.html')).mtimeMs, statSync(join(UI_ROOT, 'lab.html')).mtimeMs);
  if (existsSync(dist) && statSync(dist).mtimeMs > src) return;
  execFileSync(process.execPath, [join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'e2e'], { cwd: UI_ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}
function serve() {
  const server = createServer((req, res) => {
    const r = labRoute(req.url);
    if (r) { res.writeHead(r[0], { 'content-type': r[1], 'cache-control': 'no-store' }); res.end(r[2]); return; }
    let f = normalize(join(DIST, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!f.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': typeOf(f), 'cache-control': 'no-store' });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

/* ───────── results ───────── */
const findings = new Map();   // key -> finding (with every place it showed)
let crops = 0;
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
function record(row, f, where) {
  const key = row.story + '|' + row.state + '|' + f.key;
  let x = findings.get(key);
  if (!x) {
    x = { story: row.story, state: row.state, area: f.region ?? row.area, kind: row.kind, check: f.check, rule: CHECKS[f.check]?.rule ?? null, severity: CHECKS[f.check]?.severity ?? 'fail', msg: f.msg, el: f.el ?? '', label: f.label ?? '', where: [], crop: null, mock: row.mock, rect: f.rect ?? null, extra: f.extra ?? null };
    findings.set(key, x);
    x.isNew = true;
  }
  if (x.where.length < 40) x.where.push(where);
  return x;
}
async function cropFor(page, x, f) {
  if (!x.isNew) return; x.isNew = false;
  if (!f.rect || crops >= MAX_CROPS || x.severity === 'warn') return;
  const vw = page.viewportSize();
  const box = f.container ?? f.rect;
  const pad = 24;
  let cx = Math.max(0, Math.min(box.x, f.rect.x) - pad), cy = Math.max(0, Math.min(box.y, f.rect.y) - pad);
  let cw = Math.min(Math.max(box.x + box.w, f.rect.x + f.rect.w) + pad, vw.width) - cx, ch = Math.min(Math.max(box.y + box.h, f.rect.y + f.rect.h) + pad, cy + 700) - cy;
  if (cw < 8 || ch < 8) return;
  const name = 'crops/' + (++crops) + '.png';
  try {
    await page.evaluate((r) => { const d = document.createElement('div'); d.id = '__lab_mark'; d.style.cssText = `position:absolute;left:${r.x - 2}px;top:${r.y - 2}px;width:${r.w + 4}px;height:${r.h + 4}px;outline:2px dashed #ff00ff;pointer-events:none;z-index:2147483647`; document.body.appendChild(d); }, f.rect);
    await page.screenshot({ path: join(REPORT, name), clip: { x: cx, y: cy, width: cw, height: ch }, fullPage: true, animations: 'disabled' });
    await page.evaluate(() => document.getElementById('__lab_mark')?.remove());
    x.crop = name;
  } catch { /* outside the page: no crop */ }
}

/* ───────── the in-page work ───────── */
async function openState(browser, origin, row, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: o.dpr ?? DPR, reducedMotion: o.motion ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  page.errorsSeen = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errorsSeen.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => page.errorsSeen.push('pageerror: ' + e.message.slice(0, 300)));
  const url = origin + '/lab.html?frame=1&story=' + encodeURIComponent(row.story) + '&state=' + encodeURIComponent(row.state) + '&preset=catalog';
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.labReady, null, { timeout: 30000 }).catch(() => {});
  const ready = await page.evaluate(() => [document.documentElement.dataset.labReady, window.__labError || '']);
  await page.addScriptTag({ path: PROBE });
  return { ctx, page, ready: ready[0] === '1', error: ready[1] || (ready[0] ? '' : 'the state never finished drawing (30 s)') };
}
const settle = (page, ms) => page.waitForTimeout(ms);
async function setWidth(page, row, w) {
  const size = { width: w, height: w <= 390 ? 844 : 900 };
  const cur = page.viewportSize();
  if (cur && cur.width === size.width && cur.height === size.height) return;
  await page.setViewportSize(size);
  await settle(page, row.app ? 260 : 120);
  /* an open layer closes when the window resizes (layer.ts) and a tooltip keeps its old place: draw the state again at this size */
  if (row.overlay) await redraw(page, row);
}
async function redraw(page, row) {
  if (row.app) {
    const preset = await page.evaluate(() => document.documentElement.dataset.hxPreset);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.labReady, null, { timeout: 30000 }).catch(() => {});
    await page.addScriptTag({ path: PROBE });
    if (preset && preset !== 'catalog') { await page.evaluate((p) => window.__lab.preset(p), preset); await settle(page, 80); }
  } else {
    await page.evaluate(() => window.__lab.rerender());
    await settle(page, 260);
  }
}
/* The checks read the resting state: a colour still travelling from the previous preset (a CSS transition that the 80 ms settle did not outlast) is not a value the design set, so running transitions are finished first (animations that loop are left alone) */
const probe = (page, checks, overlay) => page.evaluate(([c, t, ov, b]) => { for (const a of document.getAnimations()) if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) { try { a.finish(); } catch { /* already done */ } } return window.__labProbe.run({ checks: c, tokenNames: t, overlay: ov, brandAllow: b }); }, [checks, TOKEN_NAMES, overlay, BRAND_ALLOW]);

async function axeRun(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const scope = (window.__lab && window.__lab.scope()) || document.body;
    const res = await window.axe.run(scope, { resultTypes: ['violations'], rules: { region: { enabled: false }, 'landmark-one-main': { enabled: false }, 'page-has-heading-one': { enabled: false }, 'landmark-unique': { enabled: false } } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), msg: (n.any[0] || n.all[0] || n.none[0] || {}).message || '' })) }));
  });
}
async function axeRect(page, target) { return page.evaluate((t) => { try { const e = document.querySelector(t); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; } catch { return null; } }, target); }

async function shot(page, row) {
  await page.addStyleTag({ content: 'orb-avatar, .ui-hold__fx, canvas { visibility: hidden !important } * { caret-color: transparent !important; animation-play-state: paused !important }' });
  await settle(page, 60);
  const clip = await page.evaluate((app) => {
      const scope = window.__lab.scope();
      if (app && (!scope || scope.id === 'hx-app' || scope === document.body)) return null;
      const els = [app ? scope : document.querySelector('.lab-cell'), ...document.querySelectorAll('.ui-tip.is-in, .ui-menu:not([data-static]), .ui-pop, .ui-listbox, .ui-toast.is-in')].filter(Boolean);
      let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
      for (const e of els) { const r = e.getBoundingClientRect(); if (!r.width) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      const pad = 12;
      if (!(x1 > x0)) return null;
      const x = Math.max(0, Math.floor(x0 - pad)), y = Math.max(0, Math.floor(y0 - pad));
      return { x, y, width: Math.min(innerWidth - x, Math.ceil(x1 - x0 + 2 * pad)), height: Math.min(1600, Math.ceil(y1 - y0 + 2 * pad)) };
    }, row.app);
  const buf = await page.screenshot({ ...(clip ? { clip, fullPage: true } : {}), animations: 'disabled' });
  return buf;
}
/* Goldens, compactly: per story a folder with an eighth-scale screenshot per state and preset (PNG, each pixel the
   mean of an 8 x 8 block) and the full screenshot's SHA-1 (hashes.json). The same hash passes at once; otherwise the
   screenshot is scaled the same way and pixel-diffed against the thumbnail (pixelmatch, threshold 0.1, limit 0.5% of
   its pixels). Full-resolution goldens for every state and preset would be about 75 MB, quarter-scale ones about 20;
   these are about 5. A slip smaller than a block is the geometry checks' to catch. */
const SCALE = 8;
function thumb(png) {
  const w = Math.max(1, Math.floor(png.width / SCALE)), h = Math.max(1, Math.floor(png.height / SCALE));
  const out = new PNG({ width: w, height: h, colorType: 2 });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0];
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) { const i = ((y * SCALE + dy) * png.width + (x * SCALE + dx)) * 4; acc[0] += png.data[i]; acc[1] += png.data[i + 1]; acc[2] += png.data[i + 2]; }
    const o = (y * w + x) * 4;
    out.data[o] = acc[0] / (SCALE * SCALE); out.data[o + 1] = acc[1] / (SCALE * SCALE); out.data[o + 2] = acc[2] / (SCALE * SCALE); out.data[o + 3] = 255;
  }
  return out;
}
const hashesCache = new Map();
function hashes(dir) {
  if (!hashesCache.has(dir)) { const f = join(dir, 'hashes.json'); hashesCache.set(dir, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}); }
  return hashesCache.get(dir);
}
export function flushHashes() {
  for (const [dir, h] of hashesCache) if (UPDATE && Object.keys(h).length) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'hashes.json'), JSON.stringify(Object.fromEntries(Object.entries(h).sort()), null, 1) + '\n'); }
}
function compareGolden(row, preset, buf) {
  const dir = join(GOLDEN, row.story.replace(/\//g, '__'));
  const name = slug(row.state) + '@' + preset;
  const png = PNG.sync.read(buf);
  const sha = createHash('sha1').update(png.data).digest('hex');
  const h = hashes(dir);
  const file = join(dir, name + '.png');
  if (UPDATE) { mkdirSync(dir, { recursive: true }); writeFileSync(file, PNG.sync.write(thumb(png), { deflateLevel: 9, colorType: 2 })); h[name] = { sha, w: png.width, h: png.height }; return null; }
  if (!existsSync(file) || !h[name]) return { msg: 'no golden screenshot yet (run pnpm lab:check --update to accept this one)' };
  if (h[name].sha === sha) return null;
  if (h[name].w !== png.width || h[name].h !== png.height) return { msg: 'the screenshot is ' + png.width + ' x ' + png.height + ', its golden ' + h[name].w + ' x ' + h[name].h };
  const a = PNG.sync.read(readFileSync(file)), b = thumb(png);
  if (a.width !== b.width || a.height !== b.height) return { msg: 'the thumbnail size changed' };
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const limit = Math.max(4, a.width * a.height * 0.005);
  if (n <= limit) return null;
  const d = 'diffs/' + slug(row.story + '-' + row.state + '-' + preset) + '.png';
  writeFileSync(join(REPORT, d), PNG.sync.write(diff));
  return { msg: n + ' of ' + a.width * a.height + ' thumbnail pixels differ from the golden (limit ' + Math.round(limit) + ')', diff: d };
}

async function checkRow(browser, origin, row, log) {
  const t0 = Date.now();
  const first = await openState(browser, origin, row);
  const { page, ctx } = first;
  try {
    if (!first.ready) { const x = record(row, { check: 'errors', msg: first.error.split('\n')[0].slice(0, 400), key: 'errors|draw' }, 'catalog/1440'); x.extra = { stack: first.error.slice(0, 2000) }; return; }
    const allow = row.allow || {};
    const skip = (c) => !!allow[c];
    if (DRAW_ONLY) { for (const e of page.errorsSeen) record(row, { check: 'errors', msg: e, key: 'errors|' + e.slice(0, 120) }, 'load'); return; }
    for (const preset of PRESETS) {
      await page.evaluate((p) => window.__lab.preset(p), preset);
      await settle(page, 80);
      for (const w of WIDTHS) {
        if (!row.app && row.width && row.width + 48 > w) continue;   /* a fixed-width cell wider than this window: not meaningful */
        await setWidth(page, row, w);
        const where = preset + '/' + w;
        const rest = await probe(page, null, row.overlayDecl);
        for (const f of rest.findings || []) { if (skip(f.check)) continue; const x = record(row, f, where); await cropFor(page, x, f); }
        if (w === 1440 || (w === 390 && preset === 'catalog')) {
          for (const fs of FORCES) {
            await page.evaluate((s) => window.__lab.force(null, s, true), fs);
            await settle(page, 40);
            const r = await probe(page, FORCED_CHECKS, row.overlayDecl);
            for (const f of r.findings || []) { if (skip(f.check)) continue; const x = record(row, f, where + '/' + fs); await cropFor(page, x, f); }
            await page.evaluate(() => window.__lab.clearForced());
          }
        }
        if (w === 1440 && AXE_ON && !skip('axe')) {
          for (const v of await axeRun(page)) for (const n of v.nodes) {
            const rect = await axeRect(page, n.target);
            const x = record(row, { check: 'axe', msg: v.id + ' (' + v.impact + '): ' + v.help + (n.msg ? '. ' + n.msg : ''), el: n.target, key: 'axe|' + v.id + '|' + n.target, rect }, where);
            await cropFor(page, x, { rect });
          }
        }
        if (w === 1440 && VISUAL && !skip('visual')) {
          const buf = await shot(page, row);
          const bad = compareGolden(row, preset, buf);
          if (bad) { const x = record(row, { check: 'visual', msg: bad.msg, key: 'visual|' + preset }, where); x.diff = bad.diff ?? null; if (!x.crop) { const name = 'crops/' + (++crops) + '.png'; writeFileSync(join(REPORT, name), buf); x.crop = name; } }
          await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (/orb-avatar, \.ui-hold__fx/.test(s.textContent)) s.remove(); });
        }
      }
    }
    for (const e of page.errorsSeen) record(row, { check: 'errors', msg: e, key: 'errors|' + e.slice(0, 120) }, 'load');
    if (!STABLE) return;
    /* render twice */
    if (!skip('stability.render')) {
      await page.evaluate(() => window.__lab.preset('catalog'));
      await setWidth(page, row, 1440);
      const a = await page.evaluate(() => window.__labProbe.signature());
      let b;
      if (row.app) {
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.labReady, null, { timeout: 30000 }).catch(() => {});
        await page.addScriptTag({ path: PROBE });
        b = await page.evaluate(() => window.__labProbe.signature());
      } else {
        await page.evaluate(() => window.__lab.rerender());
        await settle(page, 260);
        b = await page.evaluate(() => window.__labProbe.signature());
      }
      if (a.join('\n') !== b.join('\n')) {
        let i = 0; while (i < a.length && a[i] === b[i]) i++;
        record(row, { check: 'stability.render', msg: 'the second render differs at line ' + (i + 1) + ': "' + (a[i] ?? '(nothing)').trim().slice(0, 140) + '" became "' + (b[i] ?? '(nothing)').trim().slice(0, 140) + '"', key: 'stability.render' }, 'catalog/1440');
      }
    }
  } finally {
    await ctx.close();
    log(row, Date.now() - t0);
  }
  /* interactions, with full motion, on a fresh load */
  if (STABLE && !DRAW_ONLY && row.interact && !(row.allow || {})['stability.interact']) {
    const second = await openState(browser, origin, row, { motion: true });
    try {
      if (second.ready) {
        const list = await second.page.evaluate(() => window.__lab.interact);
        for (const it of list) {
          const p = second.page;
          await p.evaluate((w) => { window.__labSampler = window.__labProbe.sampler(w || null); }, it.watch ?? null);
          for (const s of it.steps) {
            if (s.do === 'hover') await p.hover(s.sel, { timeout: 4000 }).catch(() => {});
            else if (s.do === 'click') await p.click(s.sel, { timeout: 4000 }).catch(() => {});
            else if (s.do === 'dblclick') await p.dblclick(s.sel, { timeout: 4000 }).catch(() => {});
            else if (s.do === 'focus') await p.focus(s.sel, { timeout: 4000 }).catch(() => {});
            else if (s.do === 'press') await p.keyboard.press(s.key);
            else if (s.do === 'move-away') await p.mouse.move(5, 5);
            else if (s.do === 'call') await p.evaluate((js) => { (0, eval)(js); }, s.js);
            if (s.ms || s.do === 'wait') await p.waitForTimeout(s.ms ?? 300);
          }
          await p.waitForTimeout(it.sample ?? 900);
          const issues = await p.evaluate(() => window.__labSampler.stop());
          for (const i of issues) record(row, { check: 'stability.interact', msg: it.name + ': ' + i.msg, key: 'stability.interact|' + it.name + '|' + i.kind + '|' + i.key }, 'catalog/1440/full motion');
        }
      }
    } finally { await second.ctx.close(); }
  }
}

/* ───────── the mock's counterparts ───────── */
async function mockShots(browser, origin, list) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const out = {};
  for (const m of list) {
    const name = 'mock/' + slug(m.url + (m.crop ?? '')).slice(0, 80) + '.png';
    try {
      await page.goto(origin + m.url, { timeout: 20000 });
      await page.waitForTimeout(1200);
      if (m.crop) {
        const box = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; }, m.crop);
        if (box) await page.screenshot({ path: join(REPORT, name), clip: { x: box.x, y: box.y, width: Math.min(box.w, 1440), height: Math.min(box.h, 1400) }, fullPage: true });
        else await page.screenshot({ path: join(REPORT, name) });
      } else await page.screenshot({ path: join(REPORT, name) });
      out[m.url + '|' + (m.crop ?? '')] = name;
    } catch { /* the mock page failed to load: no counterpart */ }
  }
  await ctx.close();
  return out;
}

/* ───────── run ───────── */
const free = (() => { try { const s = statfsSync(UI_ROOT); return s.bavail * s.bsize; } catch { return Infinity; } })();
if (VISUAL && free < 400e6) { console.warn('lab: less than 400 MB free on the disk; screenshots (visual) are off for this run'); VISUAL = false; }
const t0 = Date.now();
build();
rmSync(REPORT, { recursive: true, force: true });
for (const d of ['crops', 'mock', 'diffs']) mkdirSync(join(REPORT, d), { recursive: true });
const srv = await serve();
const browser = await chromium.launch();
let rows;
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(srv.origin + '/lab.html?manifest=1');
  await p.waitForFunction(() => window.__labManifest, null, { timeout: 30000 });
  rows = await p.evaluate(() => window.__labManifest);
  await ctx.close();
}
const all = rows.length;
/* an area's run also takes the whole-window pages: their findings are assigned to the area whose region they are in */
rows = rows.filter((r) => (!AREA || AREA.includes(r.area) || r.kind === 'page') && (!STORY || r.story === STORY || r.story.includes(STORY)) && (!STATE || r.state === STATE || r.state.includes(STATE)) && (!ONLY_OVERLAY || r.overlay));
for (const r of rows) r.overlayDecl = null;
console.log(`lab: ${rows.length} of ${all} states · presets ${PRESETS.join(',')} · widths ${WIDTHS.join(',')} · ${JOBS} at a time${UPDATE ? ' · accepting goldens' : ''}`);

let done = 0;
const log = (row, ms) => { done++; if (done % 10 === 0 || done === rows.length || process.env.LAB_VERBOSE) console.log(`  ${done}/${rows.length}  ${row.story} · ${row.state}  ${ms} ms`); };
const queue = [...rows];
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, async () => {
  while (queue.length) {
    const row = queue.shift();
    try { await checkRow(browser, srv.origin, row, log); }
    catch (e) { record(row, { check: 'errors', msg: 'the checker failed on this state: ' + String(e.message).split('\n')[0], key: 'errors|harness' }, 'harness'); log(row, 0); }
  }
}));

/* the static scan belongs to every run that is not narrowed to a story */
flushHashes();
const staticFindings = STORY || STATE ? [] : scan().filter((f) => !AREA || AREA.includes(f.area));
const list = [...findings.values()].map(({ isNew, ...x }) => x).filter((x) => !AREA || AREA.includes(x.area));
const failing = list.filter((x) => x.severity !== 'warn');
const mocks = [...new Map(failing.filter((x) => x.mock).map((x) => [x.mock.url + '|' + (x.mock.crop ?? ''), x.mock])).values()];
const mockFiles = await mockShots(browser, srv.origin, mocks);
for (const x of list) if (x.mock) x.mockShot = mockFiles[x.mock.url + '|' + (x.mock.crop ?? '')] ?? null;
await browser.close();
await srv.close();

const RULES_MD = join(UI_ROOT, '..', '..', '..', 'design', 'v6', 'design-system', 'RULES.md');
const rules = existsSync(RULES_MD) ? ruleCoverage(readFileSync(RULES_MD, 'utf8')) : null;
const summary = writeReport(REPORT, {
  rules,
  generated: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), presets: PRESETS, widths: WIDTHS, area: AREA, story: STORY || null, update: UPDATE,
  states: rows.length, stories: new Set(rows.map((r) => r.story)).size, checks: CHECKS, areas: AREA_TITLES, findings: list, static: staticFindings, rows
});
console.log(`\nlab: ${summary.failures} failures, ${summary.warnings} warnings in ${rows.length} states (${summary.seconds} s)`);
for (const [a, n] of Object.entries(summary.byArea)) console.log('  ' + a.padEnd(11) + n);
if (rules) console.log(`rules: ${rules.covered.length} of ${rules.total} RULES.md rules have a lab check (${rules.machine} are machine-checkable)`);
console.log('report: ' + join(REPORT, 'index.html'));
process.exit(flag('strict') && summary.failures ? 1 : 0);
