/* The launch film's page. The real kit (@boopis/ui) is imported from where it lives, apps/desktop/ui, never copied:
   a frame changes when the product does. Fonts are self-hosted (@fontsource): the one remote @import in the product's
   tokens.css (Google Fonts, for the v6 mock-up) is stripped here, so the page never reaches the network.

     pnpm dev            the film's dev server (index.html?scene=test, the preview HUD)
     pnpm build          dist/, which tools/render.mjs serves to its workers

   The art director's style frames in look/ have their own config; this build only takes index.html. */
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const UI = here('../../apps/desktop/ui/');

/* the script's timeline (beats.json): the team's live copy in the shared folder when it is there (FILM_SC overrides
   where that is), else the snapshot committed in script/ (`pnpm beats:sync` refreshes it). src/motion/beats.ts reads it. */
const SC = process.env['FILM_SC'] ?? '/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/launch-video';
const LIVE_BEATS = SC + '/script/beats.json';
const BEATS = process.env['FILM_BEATS'] ?? (existsSync(LIVE_BEATS) ? LIVE_BEATS : here('./script/beats.json'));

/** drop `@import url("https://fonts.googleapis.com/...")` from any stylesheet: the film loads its fonts from @fontsource */
const REMOTE_FONTS = /@import\s+(?:url\(\s*["']?https:\/\/fonts\.googleapis\.com[^)]*\)|"https:\/\/fonts\.googleapis\.com[^"]*"|'https:\/\/fonts\.googleapis\.com[^']*')[^;]*;?/g;
const selfHostedFonts = (): Plugin => ({
  name: 'film-self-hosted-fonts',
  enforce: 'pre',
  transform(code) {
    if (!code.includes('fonts.googleapis.com')) return null;
    return { code: code.replace(REMOTE_FONTS, ''), map: null };
  },
  generateBundle(_o, bundle) {
    for (const f of Object.values(bundle)) {
      if (f.type === 'asset' && f.fileName.endsWith('.css') && typeof f.source === 'string') f.source = f.source.replace(REMOTE_FONTS, '');
    }
  }
});

export default defineConfig({
  root: here('./'),
  base: './',
  publicDir: false,
  cacheDir: here('./node_modules/.vite'),
  plugins: [selfHostedFonts()],
  resolve: {
    alias: [
      { find: '@boopis/ui', replacement: UI + 'src/components/index.ts' },
      { find: /^@ui\//, replacement: UI },
      { find: '@script/beats.json', replacement: BEATS }
    ]
  },
  define: { __HX_TEST_API__: 'false' },
  server: { host: '127.0.0.1', port: 5280, strictPort: false, fs: { allow: [here('./'), UI, here('../../apps/shared/data'), dirname(BEATS)] } },
  build: { target: 'es2022', outDir: here('./dist'), emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 4000, rollupOptions: { input: { index: here('./index.html') } } }
});
