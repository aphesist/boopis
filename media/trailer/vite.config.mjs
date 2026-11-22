/* The trailer's page: a Vite build over the desktop UI's own sources (the kit, its CSS, the card layer, the bundled
   fonts and the vendored <orb-avatar> and <boopis-logo>), so every shot is drawn by boopis's real components.
   Plain object, no import of vite: the config is run by apps/desktop/ui's own Vite (render.mjs and the README say how).
   The output goes outside the repository: TRAILER_OUT, or ./build when it is unset. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ui = resolve(here, '../../apps/desktop/ui');

export default {
  root: resolve(here, 'src'),
  base: './',
  logLevel: 'warn',
  resolve: { alias: { '@boopis/ui': resolve(ui, 'src/components/index.ts'), '@ui': resolve(ui, 'src'), '@vendor': resolve(ui, 'vendor'), '@fontsource': resolve(ui, 'node_modules/@fontsource') } },
  define: { __HX_TEST_API__: 'false' },
  build: {
    target: 'es2022', outDir: process.env.TRAILER_OUT || resolve(here, 'build'), emptyOutDir: true, sourcemap: false,
    assetsInlineLimit: 0, chunkSizeWarningLimit: 4096
  }
};
