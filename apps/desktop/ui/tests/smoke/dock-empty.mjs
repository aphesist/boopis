/* The dock with no bots (owner, Linux: "visual bug, when no bot is on the dock"): the row is a lone "+", 60px with its
   padding, and the slab around it was a tall black tombstone (its two top corners met, R = half the width) with the foot's
   controls (Arrange, the page nub, Minimise) spilling out of its sides. The slab is never narrower than its foot, the
   corners keep their radius and the top stays flat. Geometry assertions, plus a screenshot in test-results/. */
import { join } from 'node:path';
import { check, scenario } from './harness.mjs';
import { OUT } from '../lib.mjs';

const MEASURE = () => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2 }; };
  const root = document.querySelector('#hx-dock .dk');
  const shape = root.querySelector('.dk-shape'), foot = root.querySelector('.dk-foot'), add = root.querySelector('.dk-add');
  const flare = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-l')) || 14;
  const slab = shape.getBoundingClientRect();
  const body = { l: slab.left + flare, r: slab.right - flare, t: slab.top, b: slab.bottom, w: slab.width - 2 * flare, h: slab.height, cx: (slab.left + slab.right) / 2 };
  const kids = [...foot.children].map((c) => ({ cls: c.className.toString().slice(0, 24), ...r(c) })).filter((k) => k.w > 0);
  return { n: root.querySelectorAll('.dk-bot').length, flare, body, foot: foot ? r(foot) : null, kids, add: add ? r(add) : null, d: shape.querySelector('path').getAttribute('d'), mode: root.dataset.mode, innerH: innerHeight };
};

export async function dockEmpty(env) {
  const s = scenario(env);
  await s.safe('dock-empty', async () => {
    for (const reduced of [false, true]) {
      const tag = reduced ? 'reduced motion' : 'motion';
      const page = await s.fresh({ q: 'fixture=none', settle: 1500, reduced });
      const m = await page.evaluate(MEASURE);
      check('dock', `${tag}: the dock has no bots and still shows its "+" in the normal mode`, m.n === 0 && !!m.add && m.mode === 'normal', { n: m.n, mode: m.mode });
      const need = m.kids.reduce((a, k) => a + k.w, 0);
      check('dock', `${tag}: the slab is at least as wide as the foot's three controls (${m.body.w.toFixed(0)}px for ${need.toFixed(0)}px)`, m.body.w >= need + 8 && Math.abs(m.foot.w - m.body.w) < 1.5, { body: m.body.w, need, foot: m.foot.w });
      check('dock', `${tag}: every foot control sits inside the slab's body, none spills out of its sides`, m.kids.length === 3 && m.kids.every((k) => k.l >= m.body.l - 0.5 && k.r <= m.body.r + 0.5), m.kids.map((k) => [k.cls, Math.round(k.l - m.body.l), Math.round(m.body.r - k.r)]));
      check('dock', `${tag}: no tombstone, the top corners keep their radius and a flat top lies between them`, m.body.w > 2 * m.flare + 8 && m.body.h <= 80, { w: m.body.w, h: m.body.h, flare: m.flare });
      check('dock', `${tag}: the slab is as tall as with bots (76px), flush to the window's edge`, Math.abs(m.body.h - 76) <= 1 && Math.abs(m.body.b - m.innerH) <= 1, { h: m.body.h, bottom: m.body.b, innerH: m.innerH });
      check('dock', `${tag}: the "+" is centred on the slab and above the foot`, Math.abs(m.add.cx - m.body.cx) <= 1 && m.add.b <= m.foot.t + 1, { add: m.add.cx, slab: m.body.cx, addBottom: m.add.b, footTop: m.foot.t });
      check('dock', `${tag}: the page nub and Minimise sit right of Arrange, in order, with room between them`, m.kids[0].r < m.kids[1].l && m.kids[1].r < m.kids[2].l, m.kids.map((k) => [Math.round(k.l), Math.round(k.r)]));
      if (!reduced) await page.screenshot({ path: join(OUT, 'dock-empty.png'), clip: { x: Math.max(0, m.body.cx - 160), y: m.body.t - 60, width: 320, height: m.body.h + 60 } });
      check('dock', `${tag}: no console errors`, page.errors.length === 0, page.errors);
    }

    /* the dock with bots is unchanged, and a dock that returns from the pill to normal is as wide as its foot */
    const page = await s.fresh({ q: 'fixture=none', settle: 1200 });
    const w = await page.evaluate(async () => {
      const d = __hx.dock(), width = () => document.querySelector('#hx-dock .dk-shape').getBoundingClientRect().width, out = {};
      out.normal = width();
      d.setMode('minimal'); await new Promise((r) => setTimeout(r, 700)); out.minimal = width();
      d.setMode('normal'); await new Promise((r) => setTimeout(r, 700)); out.back = width();
      d.setMode('expanded'); await new Promise((r) => setTimeout(r, 700)); out.expanded = width();
      return out;
    });
    check('dock', 'the pill stays narrower than the foot, and normal after it is the foot\'s width again', w.minimal < w.normal && Math.abs(w.back - w.normal) < 1, w);
    check('dock', 'expanded, the roster (a "New bot" row) is wider than the foot and sets the slab', w.expanded > w.normal, w);

    const withBots = await s.fresh({ settle: 1200 });
    const b = await withBots.evaluate(MEASURE);
    check('dock', 'with the default bots the slab is still the row\'s width (the foot is narrower)', b.n > 5 && b.body.w > 400 && Math.abs(b.foot.w - b.body.w) < 1.5, { n: b.n, body: b.body.w });
  });
  await s.close();
}
