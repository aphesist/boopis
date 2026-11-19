import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/* The test hooks (`window.__hx`) are compiled in only for `vite build --mode e2e`, which the Playwright smoke and
   parity tests serve. A production build has no global. */
export default defineConfig(({ mode }) => ({
  base: './',
  /* the component library is the kit: everything that draws UI imports it by this name (src/components/README.md) */
  resolve: { alias: { '@boopis/ui': fileURLToPath(new URL('./src/components/index.ts', import.meta.url)) } },
  build: { target: 'es2022', sourcemap: true, outDir: mode === 'e2e' ? 'dist-e2e' : 'dist' },
  define: { __HX_TEST_API__: JSON.stringify(mode === 'e2e') },
  /* the dev server also serves the shared data the UI imports (apps/shared/data); a build bundles it */
  server: { port: 5173, strictPort: true, fs: { allow: ['.', '../../shared/data', '../../../crates/hx-proto'] } }
}));
