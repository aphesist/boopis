// @vitest-environment node
/* Where the toast sits, in a real engine with the system's own stylesheets: the shell's registered properties (shell.css) and
   the kit (components.css). `--hx-center-x` is a registered <length> with an initial 0px, so before the shell published its
   centre line the toast took 0px and hung half off the window's left edge (the owner's recording, 0.1.9: the governance
   notice during the start). Without a centre line it now centres on the window; with one, on the line. That a notice waits
   for the shell is toast.test.ts. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const REGISTERED = read('../modules/shell/shell.css').split('\n').filter((l) => l.startsWith('@property')).join('\n');
const KIT = read('./components.css');
const W = 1000;

let browser: import('playwright').Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); });

/** the toast's box, shown (`is-in`), inside an app root whose inline style is `appStyle` */
async function toastBox(appStyle: string): Promise<{ left: number; right: number; centre: number }> {
  const page = await browser.newPage({ viewport: { width: W, height: 600 } });
  try {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${REGISTERED}\n${KIT}</style>
      <div id="hx-app" style="${appStyle}"><div class="ui-toast is-in" role="status"><span>Governed mode now really applies to a bot when you turn it on.</span></div></div>`);
    return await page.evaluate(() => { const r = (document.querySelector('.ui-toast') as HTMLElement).getBoundingClientRect(); return { left: r.left, right: r.right, centre: (r.left + r.right) / 2 }; });
  } finally { await page.close(); }
}

describe('the toast in a real engine', () => {
  it('before the shell publishes its centre line, centres on the window and never hangs off its left edge', async () => {
    const b = await toastBox('');
    expect(b.left).toBeGreaterThan(0);
    expect(b.right).toBeLessThan(W);
    expect(Math.abs(b.centre - W / 2)).toBeLessThan(1);
  }, 30_000);

  it('once the shell publishes its centre line, centres on it', async () => {
    const b = await toastBox('--hx-center-x-to: 620px');
    expect(Math.abs(b.centre - 620)).toBeLessThan(1);
  }, 30_000);
});
