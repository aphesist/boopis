import { defineConfig } from 'vite';

/* The test hooks (`window.__hx`) are compiled in only for `vite build --mode e2e`, which the Playwright smoke and
   parity tests serve. A production build has no global. */
export default defineConfig(({ mode }) => ({
  base: './',
  build: { target: 'es2022', sourcemap: true, outDir: mode === 'e2e' ? 'dist-e2e' : 'dist' },
  define: { __HX_TEST_API__: JSON.stringify(mode === 'e2e') },
  /* the dev server also serves the shared data the UI imports (apps/shared/data); a build bundles it */
  server: { port: 5173, strictPort: true, fs: { allow: ['.', '../../shared/data', '../../../crates/hx-proto'] } }
}));
