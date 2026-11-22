// @vitest-environment node
/* The proof of the lab's geometry.overlap check (tests/lab/probe.js): it flags text painted over other text, the 0.1.8 bug where a
   group's held-messages strip was drawn over the conversation's last entry, and it passes what is meant to overlap or does not
   really. Each page is a bare fixture (no app, no styles of the system) run through the real probe in Chromium. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const PROBE = fileURLToPath(new URL('../../tests/lab/probe.js', import.meta.url));

/* a conversation log of three entries, 200px tall and scrolled to its end, in a room 320px wide and 200px tall */
const LOG = `<div id="log" style="position:absolute;left:0;top:0;width:320px;height:200px;overflow:auto"><p style="margin:0;height:120px">first entry of the conversation</p><p style="margin:0;height:120px">second entry of the conversation</p><p id="last" style="margin:0;height:30px">the last entry, still being read</p></div>`;
const STRIP = (style: string) => `<div id="strip" style="position:absolute;left:12px;right:12px;bottom:0;${style}"><span>2 messages waiting for nina</span></div>`;
const room = (inner: string, extra = '') => `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101010;color:#eee;font:13px/1.4 sans-serif}${extra}</style><div id="room" style="position:relative;width:320px;height:200px">${inner}</div>`;

let browser: import('playwright').Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); });

async function overlaps(html: string, overlay?: { anchor: string; layer: string }): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  try {
    await page.setContent(html);
    await page.addScriptTag({ path: PROBE });
    await page.evaluate(() => { const l = document.getElementById('log'); if (l) l.scrollTop = l.scrollHeight; });
    const r = await page.evaluate((ov) => (window as unknown as { __labProbe: { run(o: object): { findings: { check: string; msg: string }[] } } }).__labProbe.run({ scope: 'body', checks: ['geometry.overlap'], overlay: ov }), overlay ?? null);
    return r.findings.filter((f) => f.check === 'geometry.overlap').map((f) => f.msg);
  } finally { await page.close(); }
}

describe('geometry.overlap', () => {
  it('flags a bare strip of text laid over the conversation\'s last entry', async () => {
    const found = await overlaps(room(LOG + STRIP('height:40px;line-height:40px')));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('2 messages waiting');
    expect(found[0]).toContain('the last entry');
  });
  it('flags it too when the strip ignores the pointer', async () => {
    expect(await overlaps(room(LOG + STRIP('height:40px;line-height:40px;pointer-events:none')))).toHaveLength(1);
  });
  it('flags it when the strip is only translucent', async () => {
    expect(await overlaps(room(LOG + STRIP('height:40px;line-height:40px;background:rgba(16,16,16,.5)')))).toHaveLength(1);
  });
  it('passes the strip once it has an opaque surface of its own', async () => {
    expect(await overlaps(room(LOG + STRIP('height:40px;line-height:40px;background:#202020')))).toEqual([]);
  });
  it('passes the strip once the conversation ends above it', async () => {
    expect(await overlaps(room(LOG.replace('height:200px', 'height:150px') + STRIP('height:40px;line-height:40px;bottom:0')))).toEqual([]);
  });
  it('passes text the log\'s overflow clips away under the strip, and flags it when nothing clips', async () => {
    const strip = STRIP('height:20px;line-height:20px;top:122px;bottom:auto');
    expect(await overlaps(room(LOG.replace('height:200px', 'height:120px').replace('overflow:auto', 'overflow:hidden') + strip))).toEqual([]);
    expect(await overlaps(room(LOG.replace('height:200px', 'height:120px').replace('overflow:auto', 'overflow:visible') + strip))).toHaveLength(1);
  });
  it('leaves a tooltip over text alone, and the overlay the lab declares', async () => {
    const tip = '<div class="ui-tip" style="position:absolute;left:20px;top:52px;background:transparent">a tooltip over the first entry</div>';
    expect(await overlaps(room(LOG + tip))).toEqual([]);
    const layer = '<div id="layer" style="position:absolute;left:20px;top:52px">a layer the story declares</div>';
    expect(await overlaps(room(LOG + layer))).toHaveLength(1);
    expect(await overlaps(room(LOG + layer), { anchor: '#log', layer: '#layer' })).toEqual([]);
  });
  it('passes a hidden drawn copy of the same words (a reveal layer), but not other hidden text', async () => {
    const hold = (copy: string) => '<button id="hold" style="position:absolute;left:20px;top:20px;width:140px;height:30px"><span>Hold to approve</span><span aria-hidden="true" style="position:absolute;left:0;top:6px">' + copy + '</span></button>';
    expect(await overlaps(room(hold('Hold to approve')))).toEqual([]);
    expect(await overlaps(room(hold('Approved')))).toHaveLength(1);
  });
  it('does not take the lines of one paragraph, or an inline child, for an overlap', async () => {
    expect(await overlaps(room('<p style="margin:0;width:120px;line-height:1">a paragraph that wraps over several lines with <b>a bold run</b> and <code>some code</code> in it</p>'))).toEqual([]);
  });
});
