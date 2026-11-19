/* The dock with no bots. It used to be a lone "+", and that was a visual bug (owner, Linux): the row was 60px with its
   padding and the slab around it a tall black tombstone (its two top corners met, R = half the width) with the foot's controls
   (Arrange, the page nub, Minimise) spilling out of its sides. Since 19 November 2026 (owner: the dock only really appears
   after a bot is created or a session is started) there is no such dock, and this part says what there is instead:
   - a first install (`?fixture=fresh`: no bots and no session) has no dock at all, so no empty slab and no lone "+";
   - a dock with a session and no bots (`?fixture=none`) is the session part alone: no roster, no "+", and its slab keeps the
     geometry rules the tombstone broke (never narrower than its foot, the corners keep their radius, a flat top, flush to the
     window's edge, every foot control inside the slab's body).
   The part stays because both halves are still ways the dock can go wrong. Geometry assertions, plus a screenshot in test-results/. */
import { join } from 'node:path';
import { check, scenario } from './harness.mjs';
import { OUT } from '../lib.mjs';

const MEASURE = () => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2 }; };
  const root = document.querySelector('#hx-dock .dk');
  const shape = root.querySelector('.dk-shape'), foot = root.querySelector('.dk-foot');
  const live = (sel) => [...root.querySelectorAll(sel)].filter((e) => !e.closest('[hidden]') && e.getClientRects().length > 0);
  const flare = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-l')) || 14;
  const slab = shape.getBoundingClientRect();
  const body = { l: slab.left + flare, r: slab.right - flare, t: slab.top, b: slab.bottom, w: slab.width - 2 * flare, h: slab.height, cx: (slab.left + slab.right) / 2 };
  const kids = [...foot.children].map((c) => ({ cls: c.className.toString().slice(0, 24), ...r(c) })).filter((k) => k.w > 0);
  return { n: live('.dk-bot').length, add: live('.dk-add').length, roster: live('.dk-roster').length, flare, body, foot: r(foot), kids, d: shape.querySelector('path').getAttribute('d'), mode: root.dataset.mode, parts: root.dataset.parts, innerH: innerHeight };
};

export async function dockEmpty(env) {
  const s = scenario(env);
  await s.safe('dock-empty', async () => {
    for (const reduced of [false, true]) {
      const tag = reduced ? 'reduced motion' : 'motion';

      /* a first install: no dock, not a dock with nothing in it */
      const first = await s.fresh({ q: 'fixture=fresh', settle: 1500, reduced });
      const f = await first.evaluate(() => {
        const root = document.querySelector('#hx-dock .dk'), cs = getComputedStyle(root), p = root.querySelector('.dk-shape path').getBoundingClientRect();
        return { mode: root.dataset.mode, gone: root.classList.contains('is-gone'), vis: cs.visibility, inert: root.inert, aria: root.getAttribute('aria-hidden'), d: root.querySelector('.dk-shape path').getAttribute('d'), area: p.width * p.height, setting: __hx.state.dock };
      });
      check('dock', `${tag}: a first install shows no dock (off, gone, hidden, inert, no slab drawn)`, f.mode === 'off' && f.gone && f.vis === 'hidden' && f.inert && f.aria === 'true' && f.d === '' && f.area === 0, f);
      check('dock', `${tag}: and it is not the setting: "Show the dock" is still on`, f.setting === 'on', f);

      /* a session and no bots: the session part alone */
      const page = await s.fresh({ q: 'fixture=none', settle: 1500, reduced });
      const m = await page.evaluate(MEASURE);
      check('dock', `${tag}: a session and no bots shows the session part alone, in the normal mode`, m.mode === 'normal' && m.parts === 'session', { mode: m.mode, parts: m.parts });
      check('dock', `${tag}: no roster, no "+" and no bot anywhere in it (a lone "+" can no longer exist)`, m.n === 0 && m.add === 0 && m.roster === 0, { n: m.n, add: m.add, roster: m.roster });
      const need = m.kids.reduce((a, k) => a + k.w, 0);
      check('dock', `${tag}: the slab is at least as wide as the foot's three controls (${m.body.w.toFixed(0)}px for ${need.toFixed(0)}px)`, m.body.w >= need + 8 && Math.abs(m.foot.w - m.body.w) < 1.5, { body: m.body.w, need, foot: m.foot.w });
      check('dock', `${tag}: every foot control sits inside the slab's body, none spills out of its sides`, m.kids.length === 3 && m.kids.every((k) => k.l >= m.body.l - 0.5 && k.r <= m.body.r + 0.5), m.kids.map((k) => [k.cls, Math.round(k.l - m.body.l), Math.round(m.body.r - k.r)]));
      check('dock', `${tag}: no tombstone, the top corners keep their radius and a flat top lies between them`, m.body.w > 2 * m.flare + 8 && m.body.h <= 80, { w: m.body.w, h: m.body.h, flare: m.flare });
      check('dock', `${tag}: the slab is as tall as with bots (76px), flush to the window's edge`, Math.abs(m.body.h - 76) <= 1 && Math.abs(m.body.b - m.innerH) <= 1, { h: m.body.h, bottom: m.body.b, innerH: m.innerH });
      check('dock', `${tag}: the page nub and Minimise sit right of Arrange, in order, with room between them`, m.kids[0].r < m.kids[1].l && m.kids[1].r < m.kids[2].l, m.kids.map((k) => [Math.round(k.l), Math.round(k.r)]));
      if (!reduced) {
        await page.mouse.move(m.body.cx, m.body.t + 30); await page.waitForTimeout(500);   /* the controls show on hover: this is the dock as it is used */
        await page.screenshot({ path: join(OUT, 'dock-empty.png'), clip: { x: Math.max(0, m.body.cx - 360), y: m.body.t - 60, width: 720, height: m.body.h + 60 } });
      }
      check('dock', `${tag}: no console errors`, first.errors.length === 0 && page.errors.length === 0, [...first.errors, ...page.errors]);
    }

    /* the pill stays narrower than the foot, and a dock that returns from the pill to normal is as wide as before */
    const page = await s.fresh({ q: 'fixture=none', settle: 1200 });
    const w = await page.evaluate(async () => {
      const d = __hx.dock(), width = () => document.querySelector('#hx-dock .dk-shape').getBoundingClientRect().width, out = {};
      out.normal = width();
      d.setMode('minimal'); await new Promise((r) => setTimeout(r, 700)); out.minimal = width();
      d.setMode('normal'); await new Promise((r) => setTimeout(r, 700)); out.back = width();
      return out;
    });
    check('dock', 'the pill is narrower than the dock, and normal after it is the dock\'s width again', w.minimal < w.normal && Math.abs(w.back - w.normal) < 1, w);

    /* the dock with bots is unchanged: the row sets the slab, the foot is narrower */
    const withBots = await s.fresh({ settle: 1200 });
    const b = await withBots.evaluate(MEASURE);
    check('dock', 'with the default bots the slab is still the row\'s width (the foot is narrower)', b.n > 5 && b.add === 1 && b.body.w > 400 && Math.abs(b.foot.w - b.body.w) < 1.5, { n: b.n, body: b.body.w });
  });
  await s.close();
}
