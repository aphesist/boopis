// @vitest-environment node
/* "Keep the dock centred in the window" (owner, 22 November 2026: "put an option that centralizes the dock and makes sure it doesn't
   move with the other bars/animations"), in a real engine with the system's own stylesheets: the shell's registered properties
   (shell.css) and the dock's (dock.css). A sidebar that opens, closes or turns into a rail publishes a new centre line
   (--hx-center-x-to on the app's root, modules/shell/layout.ts); on the column the dock follows it, centred in the window it
   stays where it is. The room it then fits in is geometry.test.ts; the real app, sidebar and all, is tests/e2e/dock_webkit.py. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const REGISTERED = read('../shell/shell.css').split('\n').filter((l) => l.startsWith('@property')).join('\n');
const DOCK = read('./dock.css');
const W = 1200;

let browser: import('playwright').Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); });

/** where the dock's anchor is (its left edge: the slab is centred on it) for each centre line the shell publishes in turn */
async function anchors(centred: boolean, lines: readonly number[]): Promise<number[]> {
  const page = await browser.newPage({ viewport: { width: W, height: 700 } });
  try {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${REGISTERED}\n${DOCK}</style>
      <div id="hx-app" class="hx" data-dock-centre="${centred ? 'on' : 'off'}"><div id="hx-dock"><div class="dk"></div></div></div>`);
    const out: number[] = [];
    for (const x of lines) {
      out.push(await page.evaluate(async (cx) => {
        document.getElementById('hx-app')?.style.setProperty('--hx-center-x-to', cx + 'px');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return (document.querySelector('.dk') as HTMLElement).getBoundingClientRect().left;
      }, x));
    }
    return out;
  } finally { await page.close(); }
}

/* the sidebar open (288), a rail (56), closed (0), open again: the column's centre line each time, the details panel closed */
const LINES = [(288 + W) / 2, (56 + W) / 2, W / 2, (288 + W) / 2];

describe('the dock and the bars', () => {
  it('on the column (the default): the dock follows the centre line the sidebar moves', async () => {
    expect(await anchors(false, LINES)).toEqual(LINES);
  }, 30_000);

  it('centred in the window: the sidebar opens, turns into a rail, closes and opens again, and the dock does not move', async () => {
    expect(await anchors(true, LINES)).toEqual(LINES.map(() => W / 2));
  }, 30_000);
});
