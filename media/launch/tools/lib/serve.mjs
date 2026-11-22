/* A static server for the built film (dist/), on 127.0.0.1 and a free port. No caching surprises, no network beyond
   loopback. Used by the renderer and the checker. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav', '.map': 'application/json'
};

export async function serve(dir) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      let p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      const s = await stat(p).catch(() => null);
      if (s && s.isDirectory()) p = join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return { url: 'http://127.0.0.1:' + port + '/', close: () => new Promise((ok) => server.close(ok)) };
}
