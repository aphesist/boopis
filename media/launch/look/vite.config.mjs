/* The launch film's style frames: one page per frame, drawn with the real design tokens and the real kit (@boopis/ui) from
   apps/desktop/ui, scaled up for film. Nothing here is copied from the app: the kit, its CSS, the orb element, the logo and
   the fonts are imported from where they live, so a frame changes when the product does.

     ../../../apps/desktop/ui/node_modules/.bin/vite --config media/launch/look/vite.config.mjs      (from the repo root)
     node media/launch/look/render.mjs [--scale 2] [frame ...]                                          (PNGs, see render.mjs)

   The config imports nothing (vite is resolved from apps/desktop/ui, the one place it is installed). */
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const UI = here('../../../apps/desktop/ui/');
const pages = (dir) => readdirSync(here('./' + dir)).filter((f) => f.endsWith('.html')).map((f) => [dir + '/' + f.replace(/\.html$/, ''), here('./' + dir + '/' + f)]);
const frames = Object.fromEntries([...pages('frames'), ...pages('board')]);

export default {
  root: here('./'),
  base: './',
  publicDir: false,
  cacheDir: here('./.vite'),
  resolve: {
    alias: [
      { find: '@boopis/ui', replacement: UI + 'src/components/index.ts' },
      { find: /^@ui\//, replacement: UI },
      { find: /^@fontsource\//, replacement: UI + 'node_modules/@fontsource/' }
    ]
  },
  define: { __HX_TEST_API__: 'false' },
  server: { host: '127.0.0.1', port: 5288, strictPort: false, fs: { allow: [here('./'), UI, here('../../../apps/shared/data')] } },
  build: { target: 'es2022', outDir: here('./.build'), emptyOutDir: true, rollupOptions: { input: { index: here('./index.html'), ...frames } } }
};
