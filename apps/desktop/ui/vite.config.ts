import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { labMiddleware } from './tests/lab/serve.mjs';

/* The test hooks (`window.__hx`) are compiled in only for `vite build --mode e2e`, which the Playwright smoke and
   parity tests serve. A production build has no global.
   The UI lab (`lab.html`, `src/lab/`, docs/UI-LAB.md) is served by the dev server and built only into the e2e build:
   the production and desktop builds have one input, `index.html`, so the lab never ships. */
const lab = (): Plugin => ({ name: 'hx-lab-routes', apply: 'serve', configureServer(server) { server.middlewares.use(labMiddleware); } });

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [lab()],
  /* the component library is the kit: everything that draws UI imports it by this name (src/components/README.md) */
  resolve: { alias: { '@boopis/ui': fileURLToPath(new URL('./src/components/index.ts', import.meta.url)) } },
  build: {
    target: 'es2022', sourcemap: true, outDir: mode === 'e2e' ? 'dist-e2e' : 'dist',
    rollupOptions: { input: mode === 'e2e' ? { index: resolve(import.meta.dirname, 'index.html'), lab: resolve(import.meta.dirname, 'lab.html') } : { index: resolve(import.meta.dirname, 'index.html') } }
  },
  define: { __HX_TEST_API__: JSON.stringify(mode === 'e2e') },
  /* the dev server also serves the shared data the UI imports (apps/shared/data); a build bundles it */
  server: { port: 5173, strictPort: true, fs: { allow: ['.', '../../shared/data', '../../../crates/hx-proto'] } }
}));
