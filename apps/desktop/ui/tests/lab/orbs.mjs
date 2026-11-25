/* `pnpm lab:orbs`: the v7 orb checks on every story state that draws an orb (docs/UI-LAB.md, "The orb checks"), ported from the
   bots' character probes (docs/design/v7/character/ORBS.md on w31/bot-character: probes/tools/rec.cjs and edges.py).

   Each state loads with full motion, the orbs on the main thread (`?orbs=main`, so their canvases can be read) and Playwright's clock
   installed and paused: time moves only by `runFor`, 32 ms a frame (two orb updates exactly), whatever a frame costs to read. After
   1.5 s, FRAMES frames are read from every orb's own canvas pixels (exact: no screenshot, no encoding):
     orb.rest    an orb at rest (on the dock, the Bots sidebar or the rail, its reaction a rest one, not hovered, no attribute
                 changed for 1.5 s) changes 0 pixels between frames (G5)
     orb.edges   for every orb: shimmer, silhouette pixels that step out and back (A-B-A, alpha moved by more than 24 and came back
                 within 4) while the shape holds or creeps; lone flips, A-B-A pixels whose four neighbours held still; a canvas that
                 jumps on the screen or refits its backing store. Each must be 0 (G6, G7). A-B-A inside real motion (the shape went
                 out and came back, or moved on by more than 0.15 of its perimeter) is reported in the summary and does not block.

   pnpm lab:orbs [--story v7/dock] [--state "one bot"] [--frames 48] [--jobs 3]
   Writes lab-report-orbs/summary.json (the lab's summary shape: findings[] with check, story, state, el, msg); gate.mjs reads it. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { labRoute, localFonts, typeOf, UI_ROOT } from './serve.mjs';
import { ORB_REST_SURFACES, ORB_REST_REACTIONS } from './v7.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIST = join(UI_ROOT, 'dist-e2e');
const REPORT = join(UI_ROOT, 'lab-report-orbs');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const STORY = opt('story', ''), STATE = opt('state', '');
const FRAMES = Number(opt('frames', '48'));
const JOBS = Number(opt('jobs', '3'));
const MAX_ORBS = 16;
const STEP = 32;

function build() {
  const dist = join(DIST, 'lab.html');
  const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((m, d) => Math.max(m, d.isDirectory() ? newest(join(dir, d.name)) : statSync(join(dir, d.name)).mtimeMs), 0);
  const src = Math.max(newest(join(UI_ROOT, 'src')), statSync(join(UI_ROOT, 'lab.html')).mtimeMs);
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
    res.end(/\.(html|css)$/.test(f) ? localFonts(readFileSync(f, 'utf8')) : readFileSync(f));   /* the bundled @fontsource faces, never Google's */
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

/* in the page: mark the orbs to follow (visible, at most MAX_ORBS) and watch their attributes */
const SETUP = ([max, restSel, restReactions]) => {
  window.__T = 0;
  const orbs = [...document.querySelectorAll('orb-avatar')].filter((o) => { const r = o.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && o.shadowRoot && o.shadowRoot.querySelector('canvas'); }).slice(0, max);
  window.__orbs = orbs;
  return orbs.map((o, j) => {
    o.__chg = 0; o.__p1 = o.__p2 = null; o.__w = undefined;
    new MutationObserver(() => { o.__chg = window.__T; }).observe(o, { attributes: true });
    const host = o.closest('[data-bot]');
    let d = o.parentElement ? o.parentElement.tagName.toLowerCase() : '';
    for (let e = o.parentElement, i = 0; e && i < 3; e = e.parentElement, i++) { const c = [...e.classList].filter((x) => !/^is-/.test(x))[0]; if (c) { d = e.tagName.toLowerCase() + '.' + c; break; } }
    o.__restSurface = !!o.closest(restSel);
    o.__restReactions = restReactions;
    return { j, el: 'orb-avatar[' + (host ? host.getAttribute('data-bot') : j) + '] in ' + d, size: +o.getAttribute('size') || 0, rest: o.__restSurface };
  });
};
/* in the page: one frame's numbers per orb, from its canvas (rec.cjs's STAT) */
const STAT = (t) => {
  window.__T = t;
  const dpr = devicePixelRatio;
  return window.__orbs.map((o) => {
    const cv = o.shadowRoot.querySelector('canvas'), r = cv.getBoundingClientRect(), w = cv.width, h = cv.height;
    if (o.__w !== w) { o.__p1 = o.__p2 = null; o.__w = w; }
    if (o.matches(':hover')) o.__chg = t;
    let d;
    try { d = w && h ? cv.getContext('2d').getImageData(0, 0, w, h).data : new Uint8ClampedArray(0); } catch { d = new Uint8ClampedArray(0); }
    let ch = 0, aba = 0, iso = 0, d1 = 0, d2 = 0, sa = 0;
    const p1 = o.__p1, p2 = o.__p2;
    for (let i = 3; i < d.length; i += 4) sa += d[i];
    if (p1 && p1.length === d.length) for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== p1[i] || d[i + 1] !== p1[i + 1] || d[i + 2] !== p1[i + 2] || d[i + 3] !== p1[i + 3]) ch++;
      if (p2 && p2.length === d.length) {
        const u = Math.abs(p1[i + 3] - p2[i + 3]), v = Math.abs(d[i + 3] - p2[i + 3]); d1 += u; d2 += v;
        if (u > 24 && v <= 4) {
          aba++;
          const q = i >> 2, x = q % w, y = (q / w) | 0; let nb = 0;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + ax, Y = y + ay; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const k = (Y * w + X) * 4 + 3; nb = Math.max(nb, Math.abs(p1[k] - p2[k])); }
          if (nb <= 8) iso++;
        }
      }
    }
    o.__p2 = p1; o.__p1 = d;
    const rest = o.__restSurface && o.__restReactions.includes(o.getAttribute('reaction') || 'idle') && !o.matches(':hover') && t - o.__chg >= 1.5 ? 1 : 0;
    return { ch, aba, iso, d1: d1 / 255, d2: d2 / 255, a: sa / 255, rest, x: Math.round(r.left * dpr * 100) / 100, y: Math.round(r.top * dpr * 100) / 100, w };
  });
};

/* edges.py's verdict on one state's frames */
function judge(orbs, S) {
  const out = [];
  for (const o of orbs) {
    const f = S.map((fr) => fr[o.j]);
    const restFrames = f.filter((x) => x.rest).length;
    const restChanged = f.filter((x) => x.rest && x.ch);
    const turnaround = (x) => { const per = 3.6 * Math.max(x.a, 1) ** 0.5; return (x.d1 > 2 && x.d2 < 0.5 * x.d1) || x.d2 > 0.15 * per; };
    let shimmer = 0, motion = 0, lone = 0, jumps = 0, refits = 0;
    for (const x of f) if (x.aba) { if (turnaround(x)) motion += x.aba; else shimmer += x.aba; }
    for (const x of f) lone += x.iso;
    for (let i = 1; i < f.length; i++) { if (f[i].x !== f[i - 1].x || f[i].y !== f[i - 1].y) jumps++; if (f[i].w !== f[i - 1].w) refits++; }
    if (restChanged.length) out.push({ check: 'orb.rest', el: o.el, msg: `a bot at rest changed pixels in ${restChanged.length} of ${restFrames} resting frames (up to ${Math.max(...restChanged.map((x) => x.ch))} px); at rest it changes 0` });
    const bad = [];
    if (shimmer) bad.push(`${shimmer} px of shimmer (A-B-A while the shape holds)`);
    if (lone) bad.push(`${lone} lone flipping px`);
    if (jumps) bad.push(`the canvas jumped ${jumps} time${jumps > 1 ? 's' : ''}`);
    if (refits) bad.push(`its backing store refit ${refits} time${refits > 1 ? 's' : ''}`);
    if (bad.length) out.push({ check: 'orb.edges', el: o.el, msg: bad.join('; ') + ` in ${f.length} frames` + (motion ? ` (and ${motion} px in fast motion, reported only)` : '') });
  }
  return out;
}

async function checkRow(browser, origin, row) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  await ctx.clock.install({ time: 0 });
  /* the orbs' idle life draws on Math.random: seeded, every run reads the same frames (with the paused clock, the run is exact) */
  await ctx.addInitScript(() => { let a = 0x9e3779b9; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) errors.push('fetched a font from Google: ' + r.url()); });
  try {
    await page.clock.pauseAt(1000);
    await page.goto(origin + '/lab.html?frame=1&orbs=main&story=' + encodeURIComponent(row.story) + '&state=' + encodeURIComponent(row.state) + '&preset=catalog', { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 400 && !(await page.evaluate(() => document.documentElement.dataset.labReady).catch(() => null)); i++) await page.clock.runFor(50);
    const ready = await page.evaluate(() => document.documentElement.dataset.labReady);
    if (ready !== '1') return { orbs: 0, findings: [], error: 'the state never finished drawing' };
    await page.clock.runFor(300);
    const orbs = await page.evaluate(SETUP, [MAX_ORBS, ORB_REST_SURFACES, ORB_REST_REACTIONS]);
    if (!orbs.length) return { orbs: 0, findings: [] };
    await page.clock.runFor(1500);
    const S = [];
    for (let i = 0; i < FRAMES; i++) { await page.clock.runFor(STEP); S.push(await page.evaluate(STAT, 1.5 + (i + 1) * STEP / 1000)); }
    return { orbs: orbs.length, findings: [...judge(orbs, S), ...errors.map((e) => ({ check: 'errors', el: '', msg: e }))] };
  } finally { await ctx.close(); }
}

build();
rmSync(REPORT, { recursive: true, force: true });
mkdirSync(REPORT, { recursive: true });
const srv = await serve();
const t0 = Date.now();
let browser = await chromium.launch();
let rows;
{
  const p = await browser.newPage();
  await p.goto(srv.origin + '/lab.html?manifest=1');
  await p.waitForFunction(() => window.__labManifest, null, { timeout: 30000 });
  rows = await p.evaluate(() => window.__labManifest);
  await p.close();
}
rows = rows.filter((r) => (!STORY || r.story === STORY || r.story.includes(STORY)) && (!STATE || r.state === STATE || r.state.includes(STATE)));
console.log(`lab:orbs: ${rows.length} states, ${FRAMES} frames of ${STEP} ms each after 1.5 s, ${JOBS} at a time`);
const findings = [];
let withOrbs = 0, done = 0;
const queue = [...rows];
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, async () => {
  while (queue.length) {
    const row = queue.shift();
    if (!browser.isConnected()) browser = await chromium.launch();
    let r;
    try { r = await checkRow(browser, srv.origin, row); } catch (e) { r = { orbs: 0, findings: [], error: String(e.message).split('\n')[0] }; }
    if (r.error) findings.push({ area: row.area, check: 'errors', story: row.story, state: row.state, el: '', msg: 'lab:orbs: ' + r.error });
    if (r.orbs) withOrbs++;
    for (const f of r.findings) {
      const a = (row.allow || {})[f.check];
      if (typeof a === 'string' || (a && f.el.includes(a.el))) continue;
      findings.push({ area: row.area, story: row.story, state: row.state, ...f });
    }
    if (++done % 25 === 0 || done === rows.length) console.log(`  ${done}/${rows.length}  (${withOrbs} with orbs, ${findings.length} findings)`);
  }
}));
await browser.close().catch(() => {});
await srv.close();
const byCheck = {};
for (const f of findings) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
writeFileSync(join(REPORT, 'summary.json'), JSON.stringify({ generated: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), states: rows.length, withOrbs, frames: FRAMES, failures: findings.length, byCheck, findings }, null, 1));
console.log(`lab:orbs: ${findings.length} findings in ${withOrbs} states with orbs (${Math.round((Date.now() - t0) / 1000)} s)`, byCheck);
