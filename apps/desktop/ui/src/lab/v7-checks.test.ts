// @vitest-environment node
/* The proof of the v7 lab checks (tests/lab/probe-v7.js, static-v7.mjs; docs/UI-LAB.md, "The v7 checks"): each one fires on the
   defect it guards and passes its correct counterpart. The pages are the render QA's self-test (LAB-v7 section 4: a wrapped Segmented
   item, a clipped chip, an unequal card padding, a button crossing its cell, a wrapped menu name, a button overflowing a line pill, a
   button of the wrong radius, a button on unequal insets, a heading with a resting mark, two docks of different geometry), drawn as
   bare fixtures with the v7 kit's story interface (`data-kit`, `data-kit-part`) and run through the real probe in Chromium. They are
   not lab stories: a story is drawn with the kit only, and a deliberately broken one would sit in the blocking matrix. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RETIRED, V7_TARGETS, retiredPattern } from '../../tests/lab/v7.mjs';
import { scanV7 } from '../../tests/lab/static-v7.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const PROBE = fileURLToPath(new URL('../../tests/lab/probe-v7.js', import.meta.url));

interface Found { check: string; msg: string; el: string }
interface Result { findings: Found[]; sigs: [string, string, string][] }
const page = (inner: string, extra = '') => `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101010;color:#eee;font:13px/18px sans-serif}
  .lab-cell{position:relative;width:360px;padding:20px;box-sizing:border-box}
  [data-kit~="Button"]{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:14px;background:#333;color:#eee;border:0;font:inherit;white-space:nowrap;box-sizing:border-box}
  [data-kit~="Block"]{position:relative;background:#222;border-radius:22px;padding:8px}
  ${extra}</style><div class="lab-cell">${inner}</div>`;

let browser: import('playwright').Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); });

async function probe(html: string, checks: string[], o: { forced?: boolean; signatures?: boolean; reduced?: boolean; pairs?: [string, string][] } = {}): Promise<Result> {
  const p = await browser.newPage({ viewport: { width: 400, height: 400 }, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  try {
    await p.setContent(html);
    await p.addScriptTag({ path: PROBE });
    return await p.evaluate(([c, t, f, s, pairs]) => (window as unknown as { __labProbeV7: { run(o: object): Result } }).__labProbeV7.run({ scope: 'body', checks: c, targets: t, forced: f, signatures: s, accentPairs: pairs }), [checks, V7_TARGETS, !!o.forced, !!o.signatures, o.pairs ?? null] as const);
  } finally { await p.close(); }
}
const of = (r: Result, check: string): string[] => r.findings.filter((f) => f.check === check).map((f) => f.msg);

describe('geometry.wrap', () => {
  it('flags a Segmented item on two lines and passes it on one', async () => {
    const seg = (w: number) => `<div data-kit="Segmented" style="display:flex;width:${w}px"><span data-kit-part="SegmentedItem" style="display:block">Activity and library</span></div>`;
    expect(of(await probe(page(seg(60)), ['geometry.wrap']), 'geometry.wrap')).toHaveLength(1);
    expect(of(await probe(page(seg(300)), ['geometry.wrap']), 'geometry.wrap')).toEqual([]);
  });
  it('flags a chip whose text is cut without an ellipsis, and passes the ellipsis', async () => {
    const chip = (end: string) => `<span data-kit="Chip" style="display:inline-block;width:60px;white-space:nowrap;overflow:hidden;text-overflow:${end}">a long chip name</span>`;
    expect(of(await probe(page(chip('clip')), ['geometry.wrap']), 'geometry.wrap')).toHaveLength(1);
    expect(of(await probe(page(chip('ellipsis')), ['geometry.wrap']), 'geometry.wrap')).toEqual([]);
  });
});

describe('geometry.row', () => {
  const menu = (row: string) => `<div data-kit="Menu" style="width:180px;padding:6px;background:#222;border-radius:16px">${row}</div>`;
  it('flags a menu name that wraps, and passes two one-line elements', async () => {
    expect(of(await probe(page(menu('<div data-kit="MenuRow" style="padding:6px 8px">Open the session in a new window</div>')), ['geometry.row']), 'geometry.row').length).toBeGreaterThan(0);
    const two = '<div data-kit="MenuRow" style="padding:6px 8px"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Open</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">in a new window, with a long description</div></div>';
    expect(of(await probe(page(menu(two)), ['geometry.row']), 'geometry.row')).toEqual([]);
  });
  it('flags text that runs past the row\'s padding edge', async () => {
    const r = await probe(page(menu('<div data-kit="MenuRow" style="padding:6px 8px;white-space:nowrap">Open the session in a new window</div>')), ['geometry.row']);
    expect(of(r, 'geometry.row').some((m) => /past the padding edge/.test(m))).toBe(true);
  });
});

describe('geometry.escape', () => {
  it('flags a button that crosses its story cell, and passes one inside', async () => {
    expect(of(await probe(page('<button data-kit="Button" style="margin-left:300px">Approve once</button>'), ['geometry.escape']), 'geometry.escape').length).toBeGreaterThan(0);
    expect(of(await probe(page('<button data-kit="Button">Approve once</button>'), ['geometry.escape']), 'geometry.escape')).toEqual([]);
  });
  it('passes what a clipping ancestor hides', async () => {
    expect(of(await probe(page('<div style="overflow:hidden;width:200px"><button data-kit="Button" style="margin-left:300px">Approve</button></div>'), ['geometry.escape']), 'geometry.escape')).toEqual([]);
  });
});

describe('geometry.padding', () => {
  it('flags a card with uneven padding and passes an even one', async () => {
    expect(of(await probe(page('<div data-kit="Card" style="padding:8px 16px 8px 12px">Rows</div>'), ['geometry.padding']), 'geometry.padding')).toHaveLength(1);
    expect(of(await probe(page('<div data-kit="Card" style="padding:4px 16px">Rows</div>'), ['geometry.padding']), 'geometry.padding')).toEqual([]);
  });
});

describe('geometry.align', () => {
  it('flags menu rows that do not share a left edge', async () => {
    const rows = (m: number) => `<div data-kit="Menu"><div data-kit="MenuRow">One</div><div data-kit="MenuRow" style="margin-left:${m}px">Two</div></div>`;
    expect(of(await probe(page(rows(3)), ['geometry.align']), 'geometry.align')).toHaveLength(1);
    expect(of(await probe(page(rows(0)), ['geometry.align']), 'geometry.align')).toEqual([]);
  });
});

describe('concentric.strict', () => {
  const block = (btn: string) => `<div data-kit="Block" style="height:90px;width:240px;padding:0">${btn}</div>`;
  it('passes a 28 control on the 8 inset of a 22 Block (radius 14 = 22 - 8)', async () => {
    expect(of(await probe(page(block('<button data-kit="Button" style="position:absolute;right:8px;bottom:8px">Send</button>')), ['concentric.strict']), 'concentric.strict')).toEqual([]);
  });
  it('flags a button of the wrong radius in the corner', async () => {
    const r = await probe(page(block('<button data-kit="Button" style="position:absolute;right:8px;bottom:8px;border-radius:6px;height:36px">Send</button>')), ['concentric.strict']);
    expect(of(r, 'concentric.strict').some((m) => /radius 6px, the corner wants 14px/.test(m))).toBe(true);
  });
  it('flags a button on unequal insets', async () => {
    expect(of(await probe(page(block('<button data-kit="Button" style="position:absolute;right:8px;bottom:4px">Send</button>')), ['concentric.strict']), 'concentric.strict').some((m) => /not equal/.test(m))).toBe(true);
  });
  it('flags a button that overflows its line pill', async () => {
    const pill = '<div data-kit="Notice" style="position:relative;width:200px;height:32px;border-radius:16px;background:#222"><button data-kit="Button" style="position:absolute;right:-6px;top:2px">Retry</button></div>';
    expect(of(await probe(page(pill), ['concentric.strict']), 'concentric.strict').some((m) => /runs past its container/.test(m))).toBe(true);
  });
  it('checks a control with no shell only when forced, and measures after CSS zoom', async () => {
    const ghost = block('<button data-kit="Button" style="position:absolute;right:8px;bottom:8px;border-radius:4px;background:transparent">Send</button>');
    expect(of(await probe(page(ghost), ['concentric.strict']), 'concentric.strict')).toEqual([]);
    expect(of(await probe(page(ghost), ['concentric.strict'], { forced: true }), 'concentric.strict')).toHaveLength(1);
    const zoomed = `<div style="zoom:1.5">${block('<button data-kit="Button" style="position:absolute;right:8px;bottom:8px">Send</button>')}</div>`;
    expect(of(await probe(page(zoomed), ['concentric.strict']), 'concentric.strict')).toEqual([]);
  });
});

describe('mark.rest', () => {
  it('flags a heading with a resting mark, passes feedforward in the composer, and flags an info label at rest', async () => {
    expect(of(await probe(page('<h3 style="text-decoration:underline dashed">Settings</h3>'), ['mark.rest']), 'mark.rest')).toHaveLength(1);
    expect(of(await probe(page('<div data-kit="Composer"><span data-kit="Mark" style="border-bottom:1px dashed #888">tomorrow</span></div>'), ['mark.rest']), 'mark.rest')).toEqual([]);
    expect(of(await probe(page('<p>a <span data-kit="Mark" data-mark="info" style="border-bottom:1px dashed #888">term</span></p>'), ['mark.rest']), 'mark.rest')).toHaveLength(1);
  });
});

describe('sweep', () => {
  const css = '@keyframes br{to{opacity:.4}} .run{animation:br 1.4s infinite} .sh{background:linear-gradient(90deg,#888,#fff,#888);-webkit-background-clip:text;background-clip:text;color:transparent}';
  it('flags a shimmer and a breath frozen in a still, and exempts a labelled motion strip', async () => {
    const r = await probe(page('<span class="sh">Working</span><i data-live class="run" style="display:inline-block;width:6px;height:6px;background:#fff"></i>', css), ['sweep'], { reduced: true });
    expect(of(r, 'sweep')).toHaveLength(2);
    expect(of(await probe(page('<div data-motion><span class="sh">Working</span></div>', css), ['sweep'], { reduced: true }), 'sweep')).toEqual([]);
  });
});

describe('same-component', () => {
  const dock = (geom: string, w: number) => `<div data-kit="Dock" data-dk="row" data-geom="${geom}" data-pad="30" style="width:${w}px;height:72px;background:#000"><div data-kit-part="DockRow" style="display:flex;column-gap:14px;padding:0 30px;height:72px;align-items:center"><i style="width:40px;height:40px;display:block;background:#555"></i><i style="width:40px;height:40px;display:block;background:#555"></i></div></div>`;
  it('gives two docks of different geometry different signatures, and flags a dock that does not fit its content', async () => {
    const r = await probe(page(dock('640x72 r30', 154) + dock('640x72 r24', 154)), [], { signatures: true });
    const geoms = new Set(r.sigs.filter((s) => s[0] === 'dock:row').map((s) => s[1]));
    expect(geoms.size).toBe(2);
    expect(of(r, 'same-component')).toEqual([]);
    expect(of(await probe(page(dock('640x72 r30', 300)), [], { signatures: true }), 'same-component').some((m) => /does not fit its content/.test(m))).toBe(true);
  });
  it('flags a dock drawn outside the one component', async () => {
    expect(of(await probe(page('<div data-kit="Dock" style="height:72px;background:#000">bots</div>'), [], { signatures: true }), 'same-component')).toHaveLength(1);
  });
});

describe('contrast.accent', () => {
  it('flags a derived token under 4.5:1 and passes one above', async () => {
    const t = (txt: string) => page('', `:root{--bg-1:#101010;--accent-text:${txt}}`);
    expect(of(await probe(t('#3a3a8a'), ['contrast.accent'], { pairs: [['--accent-text', '--bg-1']] }), 'contrast.accent')).toHaveLength(1);
    expect(of(await probe(t('#8b8dff'), ['contrast.accent'], { pairs: [['--accent-text', '--bg-1']] }), 'contrast.accent')).toEqual([]);
  });
});

describe('kit.single and tokens.loose', () => {
  it('spells every retired name as source does', () => {
    const re = retiredPattern('QueueStrip');
    for (const s of ['QueueStrip', 'queueStrip', 'queue-strip', 'queue_strip', 'QUEUE_STRIP']) { re.lastIndex = 0; expect(re.test(s), s).toBe(true); }
    for (const s of ['queues', 'myqueuestrip']) { re.lastIndex = 0; expect(re.test(s), s).toBe(false); }
    expect(Object.keys(RETIRED)).toContain('Toast');
  });
  it('scans the source: every finding names a file and a check of its own', () => {
    const f = scanV7();
    expect(f.every((x) => ['kit.single', 'tokens.loose', 'contrast.accent'].includes(x.check) && x.file.startsWith('src/'))).toBe(true);
  });
});
