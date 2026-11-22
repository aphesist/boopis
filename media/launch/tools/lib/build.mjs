/* Build the film page (vite) into dist/, and open a page on it. Shared by the renderer and the checker. */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SC = process.env.FILM_SC || '/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/launch-video';
const require = createRequire(join(ROOT, 'package.json'));

export async function buildFilm() {
  const vite = await import(require.resolve('vite'));
  await vite.build({ configFile: join(ROOT, 'vite.config.ts'), logLevel: 'error' });
}
export const playwright = () => require('playwright');
export const CHROME_ARGS = ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--disable-threaded-animation', '--disable-checker-imaging'];

/** a page on the film at 1080p (or the vertical frame), nothing allowed off loopback */
export async function openFilm(url, o = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  const context = await browser.newContext({ viewport: { width: o.width ?? 1920, height: o.height ?? 1080 }, deviceScaleFactor: o.scale ?? 1, reducedMotion: 'no-preference', colorScheme: 'dark' });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.filmReady, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__filmError || null);
  if (err) { await browser.close(); throw new Error('page failed: ' + err); }
  return { browser, context, page };
}
