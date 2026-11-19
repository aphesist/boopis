import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/* The kit as a package: `pnpm kit` builds the component library (src/components, its CSS and the design-system tokens it reads)
   into dist-kit/boopis-ui.js (an ES module) and dist-kit/boopis-ui.css, for anything outside the app that wants the real
   components (the UI lab, a design reference). Fonts are not in it: the page that loads the kit loads them (styles/fonts.ts). */
export default defineConfig({
  base: './',
  define: { __HX_TEST_API__: 'false' },
  resolve: { alias: { '@boopis/ui': fileURLToPath(new URL('./src/components/index.ts', import.meta.url)) } },
  build: {
    target: 'es2022', sourcemap: true, outDir: 'dist-kit', emptyOutDir: true, copyPublicDir: false,
    lib: { entry: fileURLToPath(new URL('./src/components/kit.ts', import.meta.url)), formats: ['es'], fileName: () => 'boopis-ui.js', cssFileName: 'boopis-ui' }
  }
});
