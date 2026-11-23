/* The UI lab's extra routes, shared by the Vite dev server (vite.config.ts) and `pnpm lab:check`'s static server:
     /v6/...                     the approved v6 mock-up (design/v6), read only
     /v6/__index.html            the v6 app page in the skeleton its own tests used (the file is a fragment)
     /v6/design-system/hx/...    the specimen's `hx/` (the mock's root) and `ui/` (its components) as it was published
     /__gfonts?family=...        Google Fonts requests of the mock, answered from the bundled @fontsource files
     /__frames/<name>.frames.json   the recorded gateway frames (tests/fixtures/frames), for the live-replay provider
   The mock's pages ask Google for their fonts; every HTML page served from /v6/ has those links rewritten to /__gfonts,
   so the lab never reaches the network and a pixel difference is never a font difference. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const UI_ROOT = resolve(HERE, '..', '..');
export const V6 = resolve(UI_ROOT, '..', '..', '..', 'design', 'v6');
const FONTS = join(UI_ROOT, 'node_modules', '@fontsource');
const FRAMES = join(UI_ROOT, 'tests', 'fixtures', 'frames');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.map': 'application/json', '.md': 'text/plain' };
export const typeOf = (file) => TYPES[extname(file)] || 'application/octet-stream';

/** the CSS for a Google Fonts css2 URL, from @fontsource (latin), with its files served from /__fonts/ */
export function googleFontsCss(search) {
  const u = new URLSearchParams(search);
  let css = '';
  for (const fam of u.getAll('family')) {
    const [name, spec] = fam.split(':');
    const pkg = name.trim().toLowerCase().replace(/[ +]/g, '-');
    const weights = spec ? spec.replace(/^(ital,)?wght@/, '').split(';').map((w) => w.split(',').pop()) : ['400'];
    for (const w of weights) {
      const f = join(FONTS, pkg, `latin-${w}.css`);
      if (existsSync(f)) css += readFileSync(f, 'utf8').replace(/url\(\.\/files\//g, `url(/__fonts/${pkg}/files/`);
    }
  }
  return css;
}
/** a page or stylesheet with its Google Fonts reference pointed at /__gfonts (the same faces, from @fontsource, served here): the lab
    never waits on the network, and draws the faces the app bundles (the app's CSP refuses the remote stylesheet) */
export const localFonts = (html) => html.replace(/https:\/\/fonts\.googleapis\.com\/css2\?/g, '/__gfonts?').replace(/<link[^>]+fonts\.gstatic\.com[^>]*>/g, '');

/** the v6 app page: the fragment in the skeleton the owner's test scripts used */
export function v6IndexPage() {
  const skeleton = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><base href="/v6/"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
  return localFonts(skeleton + readFileSync(join(V6, 'index.html'), 'utf8') + '</body></html>');
}

/** resolve a lab route to [status, content-type, body]; null when the route is not the lab's */
export function labRoute(rawUrl) {
  const [path0, search = ''] = (rawUrl || '/').split('?');
  const path = decodeURIComponent(path0);
  if (path === '/__gfonts') return [200, 'text/css', googleFontsCss(search)];
  const file = (base, rest) => {
    const f = normalize(join(base, rest));
    if (!f.startsWith(base)) return [403, 'text/plain', 'forbidden'];
    let g = f;
    if (existsSync(g) && statSync(g).isDirectory()) g = join(g, 'index.html');
    if (!existsSync(g)) return [404, 'text/plain', 'not found'];
    const body = readFileSync(g);
    return [200, typeOf(g), extname(g) === '.html' || extname(g) === '.css' ? localFonts(body.toString('utf8')) : body];
  };
  if (path.startsWith('/__fonts/')) return file(FONTS, path.slice('/__fonts/'.length));
  if (path.startsWith('/__frames/')) return file(FRAMES, path.slice('/__frames/'.length));
  if (path === '/v6/__index.html') return [200, 'text/html', v6IndexPage()];
  if (path.startsWith('/v6/design-system/hx/')) return file(V6, path.slice('/v6/design-system/hx/'.length));
  if (path.startsWith('/v6/design-system/ui/')) return file(join(V6, 'components'), path.slice('/v6/design-system/ui/'.length));
  if (path.startsWith('/v6/')) return file(V6, path.slice('/v6/'.length));
  return null;
}

/** connect-style middleware for Vite's dev server */
export function labMiddleware(req, res, next) {
  const r = labRoute(req.url);
  if (!r) { next(); return; }
  res.writeHead(r[0], { 'content-type': r[1], 'cache-control': 'no-store' });
  res.end(r[2]);
}
