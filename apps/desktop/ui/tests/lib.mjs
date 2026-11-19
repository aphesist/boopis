/* Shared helpers for the Playwright smoke and parity tests.
   Playwright is pre-installed (NODE_PATH); never run `playwright install`. Every page runs at deviceScaleFactor 1.
   The ported app is served from dist-e2e (a `vite build --mode e2e`, which exposes window.__hx); the v6 reference is
   served from design/v6. Both load their fonts from the same bundled @fontsource files, so a pixel difference is never
   a font difference. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const V6 = resolve(ROOT, '..', '..', '..', 'design', 'v6');
export const OUT = join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.map': 'application/json' };

/** build the app for the tests unless dist-e2e is newer than the sources */
export function buildE2E({ force = false } = {}) {
  const dist = join(ROOT, 'dist-e2e', 'index.html');
  const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((m, d) => Math.max(m, d.isDirectory() ? newest(join(dir, d.name)) : statSync(join(dir, d.name)).mtimeMs), 0);
  if (!force && existsSync(dist) && statSync(dist).mtimeMs > Math.max(newest(join(ROOT, 'src')), statSync(join(ROOT, 'index.html')).mtimeMs)) return;
  execFileSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'e2e'], { cwd: ROOT, stdio: 'inherit' });
}

/** a static server over several mounts: { '/': dist-e2e, '/v6/': design/v6, '/__fonts/': @fontsource } */
export function serve(mounts) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const m = Object.keys(mounts).sort((a, b) => b.length - a.length).find((k) => url.startsWith(k));
    if (!m) { res.writeHead(404); res.end(); return; }
    let file = normalize(join(mounts[m], url.slice(m.length)));
    if (!file.startsWith(mounts[m])) { res.writeHead(403); res.end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) })));
}
export async function startServers() {
  buildE2E();
  const nm = join(ROOT, 'node_modules', '@fontsource');
  return serve({ '/': join(ROOT, 'dist-e2e'), '/v6/': V6, '/__fonts/': nm, '/__frames/': join(ROOT, 'tests', 'fixtures', 'frames') });
}

/** Google Fonts requests of the v6 page, answered from the bundled @fontsource files */
function googleFontsCss(url, origin) {
  const slug = (n) => n.toLowerCase().replace(/\+/g, '-');
  const u = new URL(url);
  let css = '';
  for (const fam of u.searchParams.getAll('family')) {
    const [name, spec] = fam.split(':');
    const pkg = slug(name.replace(/ /g, '+'));
    const weights = spec ? spec.replace('wght@', '').split(';') : ['400'];
    for (const w of weights) {
      const f = join(ROOT, 'node_modules', '@fontsource', pkg, `latin-${w}.css`);
      if (existsSync(f)) css += readFileSync(f, 'utf8').replace(/url\(\.\/files\//g, `url(${origin}/__fonts/${pkg}/files/`);
    }
  }
  return css;
}

/** the v6 mock-up in the same skeleton the owner's own test scripts used (the file is a fragment) */
export function v6Page(origin) {
  const skeleton = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><base href="${origin}/v6/"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>`;
  return skeleton + readFileSync(join(V6, 'index.html'), 'utf8') + '</body></html>';
}

/**
 * open a page. o: { w, h, reduced, q (query string), which: 'port' | 'v6', origin, preset }
 * Returns the page with .errors (console errors and warnings, page errors) and .ctx.
 */
export async function open(browser, o) {
  const ctx = await browser.newContext({ viewport: { width: o.w || 1440, height: o.h || 900 }, deviceScaleFactor: 1, reducedMotion: o.reduced ? 'reduce' : 'no-preference', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') page.errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  const which = o.which || 'port';
  if (which === 'v6') {
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: googleFontsCss(r.request().url(), o.origin) }));
    await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
    await page.route(o.origin + '/__v6_index.html**', (r) => r.fulfill({ contentType: 'text/html', body: v6Page(o.origin) }));
  }
  const url = which === 'v6' ? o.origin + '/__v6_index.html' : o.origin + '/index.html';
  const q = o.q ? '?' + o.q : '';
  await page.goto(url + q);
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await page.goto(url + q);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(o.settle || 700);
  page.ctx = ctx;
  return page;
}
/** the app state, for both builds (window.HX in v6, window.__hx in the port) */
export const stateOf = (page) => page.evaluate(() => { const H = window.__hx || window.HX; return { tab: H.state.tab, left: H.state.left, right: H.state.right, dock: H.state.dock }; });
