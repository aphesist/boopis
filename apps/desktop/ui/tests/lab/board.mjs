/* `pnpm lab:board <board> [<board> ...] | --all`: the proof that a screen of the app is its approved board.

   For each board of tests/lab/boards.json, in dark and light, at 1440 x 900 and a device pixel ratio of 2 (the approved images' size):
     1. the board is drawn from its own source (docs/design/v7/boards/src, served at /__boards; the orb library is the app's vendored one),
     2. the app's lab story for that board is drawn (the real modules, fed the board's content as fixture data),
     3. a side-by-side sheet (board | app), a pixel-difference image and the difference as a percentage are written: of the whole
        window, of each region the board's row names (chrome, rail, thread, composer, dock, pane ...), and of the window with every
        orb left out (a live orb is caught mid-behaviour, so two renders of one board differ there),
     4. the orbs are compared as boxes: how many each side has, and how far each is from its counterpart,
     5. the board's own render is compared with the approved image (the archive's JPEG) when one is at hand, which proves the source
        still draws what the owner approved.
   A row with `scope` is the reference for the regions it names only (the others have a later board of their own, compared by its
   own row); a region of six numbers [x, y, w, h, dx, dy] says the app's part sits dx, dy from the board's.

   Live things rest: both pages run with reduced motion, and the boards' own `still` class holds their marks.

   Flags: --all, --theme dark|light, --out <dir> (default test-results/boards), --origin <url> (a dev server already running:
   `pnpm dev`), --approved <dir> (the approved images, as the archive branch lays them out; else `git show origin/w33/boards-archive:`),
   --threshold <0..1> (pixelmatch's colour threshold, default 0.015: a grey step of 4 levels counts), --max <percent> (exit 1 when a board differs more), --json. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(HERE, '..', '..');
const MAP = JSON.parse(readFileSync(join(HERE, 'boards.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const VALUED = new Set(['theme', 'out', 'origin', 'approved', 'threshold', 'max']);
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(args[i - 1].slice(2))));
const OUT = resolve(opt('out', join(UI_ROOT, 'test-results', 'boards')));
const THEMES = opt('theme') ? [opt('theme')] : ['dark', 'light'];
/* pixelmatch's colour threshold. Its usual 0.1 lets a grey step of up to 26 levels pass, and this design is made of smaller ones (a
   current row is 8% of ink over its ground, a tinted control 4%, a hairline less): at 0.015 a step of 4 levels counts */
const THRESHOLD = Number(opt('threshold', '0.015'));
const { w: W, h: H, dpr: DPR } = MAP.viewport;
mkdirSync(OUT, { recursive: true });

const wanted = flag('all') ? Object.keys(MAP.boards) : ids;
if (!wanted.length) { console.error('lab:board: name a board (' + Object.keys(MAP.boards).join(', ') + ') or pass --all'); process.exit(2); }
for (const id of wanted) if (!MAP.boards[id]) { console.error('lab:board: no board "' + id + '" in tests/lab/boards.json (' + Object.keys(MAP.boards).join(', ') + ')'); process.exit(2); }

/* ───────── the server: a dev server of our own unless one is given ───────── */
async function freePort() { return new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); }); }
async function serve() {
  const given = opt('origin');
  if (given) return { origin: given.replace(/\/$/, ''), close: async () => undefined };
  const { createServer } = await import('vite');
  const port = await freePort();
  const vite = await createServer({ root: UI_ROOT, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', open: false } });
  await vite.listen();
  return { origin: 'http://127.0.0.1:' + port, close: () => vite.close() };
}

/* ───────── drawing ───────── */
const orbBoxes = () => [...document.querySelectorAll('orb-avatar')].map((o) => { const r = o.getBoundingClientRect(); return { shown: o.checkVisibility ? o.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true, x: r.left, y: r.top, w: r.width, h: r.height, shape: o.getAttribute('shape') || '', color: ((c) => { const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(c); return m ? getComputedStyle(o).getPropertyValue(m[1]).trim() || (m[2] ?? '') : c; })(o.getAttribute('color') || '').toLowerCase(), reaction: o.getAttribute('reaction') || 'idle' }; }).filter((b) => b.w > 0 && b.h > 0 && b.x < innerWidth && b.y < innerHeight && b.shown);
async function shot(browser, url, wait, ready) {
  /* the board is drawn as it was approved; the app rests its live things (the sweep, the breath) as the boards' `still` does */
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, ...(ready ? { reducedMotion: 'reduce' } : {}) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  if (ready) {
    await page.waitForFunction(() => document.documentElement.dataset.labReady, null, { timeout: 60000 });
    const bad = await page.evaluate(() => window.__labError || null);
    if (bad) errors.push(bad);
  }
  await page.waitForTimeout(wait);
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  const orbs = await page.evaluate(orbBoxes);
  await page.close();
  return { png, orbs, errors };
}

/* ───────── comparing ───────── */
let pixelmatch;
function diffOf(a, b) {
  const out = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: THRESHOLD, includeAA: true, alpha: 0.25, diffColor: [255, 0, 96] });
  return { n, out };
}
/** the differing pixels of a diff image inside a rect of CSS px (a differing pixel is drawn in the diff colour) */
function countIn(diff, rect, skip = []) {
  const [x0, y0, w, h] = rect.map((v) => Math.round(v * DPR));
  const skips = skip.map((r) => r.map((v) => Math.round(v * DPR)));
  let n = 0, total = 0;
  for (let y = Math.max(0, y0); y < Math.min(diff.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(diff.width, x0 + w); x++) {
      if (skips.some(([sx, sy, sw, sh]) => x >= sx && x < sx + sw && y >= sy && y < sy + sh)) continue;
      total++;
      const i = (y * diff.width + x) * 4;
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 96) n++;
    }
  }
  return { n, total, pct: total ? (100 * n) / total : 0 };
}
/** a rect of CSS px cut out of a screenshot */
function crop(png, [x, y, w, h]) {
  const out = new PNG({ width: Math.round(w * DPR), height: Math.round(h * DPR) });
  PNG.bitblt(png, out, Math.round(x * DPR), Math.round(y * DPR), out.width, out.height, 0, 0);
  return out;
}
/** one named part of the window, the board's against the app's: `rect` is [x, y, w, h] on the board and, when the app's part sits
    elsewhere (a later board moved what is around it), [x, y, w, h, dx, dy] with the app's offset. Counts the differing pixels,
    and again with every orb's box left out */
function regionDiff(b, a, rect, threshold = THRESHOLD) {
  const [x, y, w, h, dx = 0, dy = 0] = rect;
  const bc = crop(b.png, [x, y, w, h]), ac = crop(a.png, [x + dx, y + dy, w, h]);
  const out = new PNG({ width: bc.width, height: bc.height });
  const n = pixelmatch(bc.data, ac.data, out.data, bc.width, bc.height, { threshold, includeAA: true, alpha: 0.25, diffColor: [255, 0, 96] });
  const inside = (o, ox, oy) => o.x + o.w > ox && o.x < ox + w && o.y + o.h > oy && o.y < oy + h;
  const orbRects = [...(b.orbs ?? []).filter((o) => inside(o, x, y)).map((o) => [o.x - x - 1, o.y - y - 1, o.w + 2, o.h + 2]), ...(a.orbs ?? []).filter((o) => inside(o, x + dx, y + dy)).map((o) => [o.x - x - dx - 1, o.y - y - dy - 1, o.w + 2, o.h + 2])];
  const noOrbs = countIn(out, [0, 0, w, h], orbRects);
  return { n, total: bc.width * bc.height, pct: (100 * n) / (bc.width * bc.height), noOrbs };
}
const sum = (list) => { const n = list.reduce((t, r) => t + r.n, 0), total = list.reduce((t, r) => t + r.total, 0); return { n, total, pct: total ? (100 * n) / total : 0 }; };
function sideBySide(a, b) {
  const gap = 16, out = new PNG({ width: a.width + gap + b.width, height: Math.max(a.height, b.height) });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 96; out.data[i + 3] = 255; }
  PNG.bitblt(a, out, 0, 0, a.width, a.height, 0, 0);
  PNG.bitblt(b, out, 0, 0, b.width, b.height, a.width + gap, 0);
  return out;
}
/** each board orb's nearest app orb of the same shape and colour: how far apart, and the size difference */
function matchOrbs(board, app) {
  const left = [...app], rows = [];
  for (const o of board) {
    let best = -1, bd = Infinity;
    left.forEach((p, i) => { if (p.shape !== o.shape) return; const d = Math.hypot(p.x - o.x, p.y - o.y) + Math.abs(p.w - o.w); if (d < bd) { bd = d; best = i; } });
    if (best < 0) { rows.push({ board: o, app: null }); continue; }
    const p = left.splice(best, 1)[0];
    rows.push({ board: o, app: p, dx: +(p.x - o.x).toFixed(2), dy: +(p.y - o.y).toFixed(2), dw: +(p.w - o.w).toFixed(2), colour: p.color === o.color, reaction: p.reaction === o.reaction });
  }
  return { rows, extra: left };
}
function approvedImage(rel) {
  const dir = opt('approved');
  try {
    const buf = dir ? readFileSync(join(resolve(dir), rel)) : execFileSync('git', ['show', 'origin/w33/boards-archive:' + rel], { cwd: UI_ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    return buf;
  } catch { return null; }
}
/** the approved JPEG as pixels: decoded by the browser, drawn at its own size */
async function decode(browser, buf) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const data = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, buf.toString('base64'));
  await page.close();
  return PNG.sync.read(Buffer.from(data, 'base64'));
}

/* ───────── the run ───────── */
pixelmatch = (await import('pixelmatch')).default;
const srv = await serve();
const browser = await chromium.launch();
const report = [];
let worst = 0;
try {
  for (const id of wanted) {
    const row = MAP.boards[id];
    for (const theme of THEMES) {
      const boardUrl = srv.origin + '/__boards/' + row.board + (row.board.includes('?') ? '&' : '?') + 'theme=' + theme;
      const appUrl = srv.origin + '/lab.html?frame=1&story=' + encodeURIComponent(row.story) + '&state=' + encodeURIComponent(row.state) + '&preset=' + theme;
      const b = await shot(browser, boardUrl, row.wait ?? 1800, false);
      const a = await shot(browser, appUrl, row.appWait ?? 2200, true);
      const { n, out } = diffOf(b.png, a.png);
      const orbRects = [...b.orbs, ...a.orbs].map((o) => [o.x - 1, o.y - 1, o.w + 2, o.h + 2]);
      const regions = Object.fromEntries(Object.entries(row.regions ?? {}).map(([name, rect]) => [name, regionDiff(b, a, rect)]));
      /* a board that is the reference for some parts only (`scope`: the names of those regions) is measured over those parts: its
         other parts have a board of their own (board 12's sidebar is K02's) */
      const scoped = row.scope ? row.scope.map((k) => [k, row.regions[k]]) : null;
      const whole = scoped ? sum(scoped.map(([k]) => regions[k])) : { n, total: b.png.width * b.png.height, pct: (100 * n) / (b.png.width * b.png.height) };
      const noOrbs = scoped ? sum(scoped.map(([k]) => regions[k].noOrbs)) : countIn(out, [0, 0, W, H], orbRects);
      const within = (o, [x, y, w, h]) => o.x + o.w / 2 >= x && o.x + o.w / 2 < x + w && o.y + o.h / 2 >= y && o.y + o.h / 2 < y + h;
      const orbs = scoped
        ? matchOrbs(b.orbs.filter((o) => scoped.some(([, r]) => within(o, r))), scoped.flatMap(([, r]) => a.orbs.filter((o) => within(o, [r[0] + (r[4] ?? 0), r[1] + (r[5] ?? 0), r[2], r[3]])).map((o) => ({ ...o, x: o.x - (r[4] ?? 0), y: o.y - (r[5] ?? 0) }))))
        : matchOrbs(b.orbs, a.orbs);
      const name = id + '-' + theme;
      writeFileSync(join(OUT, name + '.png'), PNG.sync.write(sideBySide(b.png, a.png)));
      writeFileSync(join(OUT, name + '.diff.png'), PNG.sync.write(out));
      let approved = null;
      const jpg = row.image ? approvedImage(row.image.replace('{theme}', theme)) : null;
      if (jpg) {
        const ap = await decode(browser, jpg);
        if (ap.width === b.png.width && ap.height === b.png.height) {
          /* a JPEG's own noise is under this threshold; what is left is a real difference between the source and the approved image */
          const tmp = new PNG({ width: ap.width, height: ap.height });
          const m = pixelmatch(ap.data, b.png.data, tmp.data, ap.width, ap.height, { threshold: 0.2, includeAA: true });
          const am = scoped ? sum(scoped.map(([, r]) => regionDiff({ png: ap }, a, r, 0.2))).pct : (100 * pixelmatch(ap.data, a.png.data, tmp.data, ap.width, ap.height, { threshold: 0.2, includeAA: true })) / (ap.width * ap.height);
          approved = { source: (100 * m) / (ap.width * ap.height), app: am };
        }
      }
      worst = Math.max(worst, whole.pct);
      report.push({ id, theme, title: row.title, scope: row.scope ?? null, whole, noOrbs, regions, orbs: { board: orbs.rows.length, app: orbs.rows.filter((r) => r.app).length + orbs.extra.length, unmatched: orbs.rows.filter((r) => !r.app).length, extra: orbs.extra.length, moved: orbs.rows.filter((r) => r.app && (Math.abs(r.dx) > 0.5 || Math.abs(r.dy) > 0.5 || Math.abs(r.dw) > 0.5)).map((r) => ({ shape: r.board.shape, at: [Math.round(r.board.x), Math.round(r.board.y)], size: r.board.w, dx: r.dx, dy: r.dy, dw: r.dw })), look: orbs.rows.filter((r) => r.app && (!r.colour || !r.reaction)).map((r) => ({ shape: r.board.shape, at: [Math.round(r.board.x), Math.round(r.board.y)], board: r.board.color + ' ' + r.board.reaction, app: r.app.color + ' ' + r.app.reaction })) }, approved, errors: { board: b.errors, app: a.errors }, files: { sheet: join(OUT, name + '.png'), diff: join(OUT, name + '.diff.png') } });
    }
  }
} finally { await browser.close(); await srv.close(); }

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
if (flag('json')) console.log(JSON.stringify(report, null, 2));
else {
  const f = (v) => v.toFixed(2).padStart(6) + '%';
  for (const r of report) {
    console.log('\n' + r.id + ' (' + r.theme + ')  ' + r.title);
    console.log('  ' + (r.scope ? 'its parts       ' : 'the window      ') + f(r.whole.pct) + '   without the orbs ' + f(r.noOrbs.pct) + (r.scope ? '   (this board is the reference for: ' + r.scope.join(', ') + ')' : ''));
    for (const [k, v] of Object.entries(r.regions)) console.log('  ' + k.padEnd(15) + ' ' + f(v.pct));
    console.log('  orbs            board ' + r.orbs.board + ', app ' + r.orbs.app + (r.orbs.unmatched ? ', ' + r.orbs.unmatched + ' of the board\'s missing' : '') + (r.orbs.extra ? ', ' + r.orbs.extra + ' more in the app' : '') + (r.orbs.moved.length ? ', ' + r.orbs.moved.length + ' off their place' : ', all in place'));
    for (const m of r.orbs.moved) console.log('    ' + m.shape + ' ' + m.size + ' at ' + m.at.join(',') + ': dx ' + m.dx + ' dy ' + m.dy + ' dsize ' + m.dw);
    for (const m of r.orbs.look) console.log('    ' + m.shape + ' at ' + m.at.join(',') + ': board "' + m.board + '", app "' + m.app + '"');
    if (r.approved) console.log('  approved image  the board\'s source ' + f(r.approved.source) + ', the app ' + f(r.approved.app) + '  (JPEG threshold)');
    else console.log('  approved image  not at hand (origin/w33/boards-archive or --approved <dir>)');
    for (const e of r.errors.board) console.log('  BOARD ERROR ' + e);
    for (const e of r.errors.app) console.log('  APP ERROR ' + e);
    console.log('  ' + r.files.sheet);
  }
}
const max = opt('max');
if (max !== undefined && worst > Number(max)) { console.error('\nlab:board: a board differs by ' + worst.toFixed(2) + '%, over the ' + max + '% allowed'); process.exit(1); }
