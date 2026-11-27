import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/* The kit's article (`pnpm kit:docs`, scripts/kit-docs.mjs): kit-docs/index.html built as one script and one stylesheet with every
   asset (the fonts) inlined, so the script can fold the page into a single self-contained HTML file. Never part of the app's build. */
/* two data tables the kit bundles carry notes of where they were read from (a mark set's upstream and the brands' addresses, a mention
   rule's upstream file); nothing reads them at run time, and a published page names none of them: the article's build leaves them out */
const provenance = (): Plugin => ({
  name: 'kit-docs-provenance', enforce: 'pre',
  transform(code, id) {
    if (!/service-marks[\\/]map\.json$|room-mentions\.json$/.test(id)) return null;
    const o = JSON.parse(code) as Record<string, unknown>;
    delete o['source'];
    /* the mark set: its rule in prose, and each mark's origin and brand-guideline addresses and why its colour is what it is (item-mark.ts reads none) */
    if (/map\.json$/.test(id)) { delete o['rule']; for (const m of (o['marks'] as Record<string, unknown>[] | undefined) ?? []) { delete m['origin']; delete m['guidelines']; const c = m['color'] as Record<string, unknown> | undefined; if (c) delete c['why']; } }
    return { code: JSON.stringify(o), map: null };
  }
});

export default defineConfig({
  plugins: [provenance()],
  root: fileURLToPath(new URL('./kit-docs', import.meta.url)),
  base: './',
  define: { __HX_TEST_API__: 'false' },
  resolve: { alias: { '@boopis/ui': fileURLToPath(new URL('./src/components/index.ts', import.meta.url)) } },
  build: {
    target: 'es2022', outDir: fileURLToPath(new URL('./dist-kit-docs/build', import.meta.url)), emptyOutDir: true, copyPublicDir: false,
    assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false, sourcemap: false,
    rolldownOptions: { output: { codeSplitting: false } }
  }
});
