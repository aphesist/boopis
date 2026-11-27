/* Continuous corners (DESIGN-SYSTEM.md section 8) and the layout the owner found broken, in a real browser:
   no corner-shape anywhere; only leaf controls are clipped (never a container, so orbs and popovers are never cut); the
   squircle's work stays inside its budget (2 ms a frame for 200 bound elements, and through the dock's morphs and a card's
   height animation); the composer is never covered by the dock and the sidebar is there, from 390 to 2880 px at several
   pixel ratios. */
import { check, scenario } from './harness.mjs';

const LEAF = '.ui-btn,.ui-ib,.ui-seg__thumb,.ui-file';
const VIEWPORTS = [[1600, 860, 1.25], [1440, 900, 2], [1920, 1200, 1.5], [2880, 1800, 1], [1366, 768, 1], [390, 844, 1]];

export async function corners(env) {
  const s = scenario(env);
  await s.safe('corners', async () => {
    let page = await s.fresh();
    const css = await page.evaluate(() => [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules].map((r) => r.cssText); } catch { return []; } }).filter((t) => /corner-shape/.test(t)).length);
    check('corners', 'no stylesheet uses corner-shape: the corner is a path in every engine', css === 0, css);
    const modes = await page.evaluate((leaf) => ({ clipped: [...document.querySelectorAll('[data-sq-mode="clip"]')].filter((e) => !e.matches(leaf)).length, any: [...document.querySelectorAll('[data-sq-on]')].length, nonLeafClip: [...document.querySelectorAll('[data-sq-on]')].filter((e) => !e.matches(leaf) && getComputedStyle(e).clipPath !== 'none' && !/slab|concave/.test(e.dataset.sqMode)).length }), LEAF);
    check('corners', 'only leaf controls are clipped: a container never clips what overflows it', modes.clipped === 0 && modes.nonLeafClip === 0 && modes.any > 20, modes);
    const frame = await page.evaluate(() => { const b = document.querySelector('.ss-composer .k7-composer__box'); return { before: getComputedStyle(b, '::before').content, bg: getComputedStyle(b).backgroundColor, clip: getComputedStyle(b).clipPath, mode: b.dataset.sqMode }; });
    check('corners', 'a bound surface draws its corner as a layer (::before) and keeps its content unclipped', frame.mode === 'frame' && frame.clip === 'none' && frame.before !== 'none', frame);

    /* the budget: 200 bound buttons changing height every frame */
    const perf = await page.evaluate(async () => {
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:0;top:0;width:900px;z-index:9999;display:flex;flex-wrap:wrap;gap:4px;background:var(--bg-0)';
      for (let i = 0; i < 200; i++) { const b = document.createElement('button'); b.className = 'ui-btn'; b.textContent = 'b' + i; box.append(b); }
      document.body.append(box);
      await new Promise((r) => setTimeout(r, 400));
      const q = __hx.ui.squircle; const a = q.stats();
      await new Promise((res) => { let n = 0; const tick = () => { for (const b of box.children) b.style.height = (24 + (n % 12)) + 'px'; if (++n < 120) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      await new Promise((r) => setTimeout(r, 100));
      const z = q.stats(); box.remove();
      return { frames: z.frames - a.frames, avg: (z.totalMs - a.totalMs) / Math.max(1, z.frames - a.frames), max: z.maxMs, bound: a.bound };
    });
    check('corners', 'budget: 200 bound elements changing height every frame cost <= 2 ms a frame', perf.frames >= 60 && perf.avg <= 2, perf);

    /* the dock's morphs and a card's height animation */
    const morph = await page.evaluate(async () => {
      const q = __hx.ui.squircle, a = q.stats(), d = __hx.dock();
      /* v7: the dock's morphs are the row to its one open size and back (a bot's card, the asks) */
      for (const m of [() => d.openSession(d.botAt(1)), () => d.closeSession(), () => d.openAsks(), () => d.setMode('normal'), () => d.openSession(d.botAt(2)), () => d.closeSession()]) { m(); await new Promise((r) => setTimeout(r, 650)); }
      const card = __hx.ui.card('form', { id: 'perf', kind: 'question', title: 'q', origin: { kind: 'host' }, schema: { properties: { a: { type: 'string', title: 'A' } }, required: ['a'] } }, { size: 'inline' });
      const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:20px;top:20px;width:520px;z-index:9999'; h.append(card); document.body.append(h);
      await new Promise((r) => setTimeout(r, 300));
      card.querySelector('[data-action="submit"]').click(); await new Promise((r) => setTimeout(r, 700)); h.remove();
      const z = q.stats();
      return { frames: z.frames - a.frames, avg: (z.totalMs - a.totalMs) / Math.max(1, z.frames - a.frames), max: z.maxMs };
    });
    check('corners', 'the dock\'s morphs and a card\'s height animation keep the squircle under 2 ms a frame on average', morph.frames >= 5 && morph.avg <= 2, morph);

    /* layout at the viewports the owner checked */
    for (const [w, h, d] of VIEWPORTS) {
      await page.ctx.close();
      const ctx = await env.browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: d });
      page = await ctx.newPage(); page.errors = []; page.ctx = ctx;
      page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
      await page.goto(env.srv.origin + '/index.html'); await page.evaluate(() => { try { localStorage.clear(); } catch { /* blocked */ } });
      await page.goto(env.srv.origin + '/index.html'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
      const r = await page.evaluate(() => { const b = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }; return { left: __hx.state.left, side: b('.hx-side'), comp: b('.ss-composer'), dock: b('#hx-dock .k7-dock__slab'), hscroll: document.documentElement.scrollWidth > innerWidth, W: innerWidth }; });
      const overlap = r.comp && r.dock ? Math.min(r.comp.b, r.dock.b) - Math.max(r.comp.t, r.dock.t) : 0;
      const wantSide = w >= 900;
      check('corners', `${w}x${h}@${d}: the sidebar follows the width, the dock never covers the composer, nothing scrolls sideways`, (wantSide ? r.left === 'open' && r.side && r.side.r - r.side.l > 200 : r.left !== 'open') && overlap <= 0 && !r.hscroll && !page.errors.length, { ...r, overlap });
      if (w === 1600) {
        /* the viewer that mounts small and grows: the sidebar follows until the person sets it, and only then is it stored */
        await page.setViewportSize({ width: 700, height: 700 }); await page.waitForTimeout(500);
        const small = await page.evaluate(() => ({ left: __hx.state.left, stored: JSON.parse(localStorage.getItem('hx.v6.shell') || '{}') }));
        await page.setViewportSize({ width: 1600, height: 860 }); await page.waitForTimeout(500);
        const big = await page.evaluate(() => __hx.state.left);
        check('corners', 'the sidebar follows the window while the person has not set it (rail when narrow, open again when it grows), and stores nothing', small.left === 'rail' && big === 'open' && small.stored.left === undefined && small.stored.leftBy === undefined, { small, big });
        await page.evaluate(() => __hx.setState({ left: 'closed' })); await page.waitForTimeout(200);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hx.v6.shell') || '{}'));
        check('corners', 'a choice of the person\'s is stored as theirs and then holds', stored.left === 'closed' && stored.leftBy === 'user', stored);
        await page.reload(); await page.waitForTimeout(1200);
        check('corners', 'and survives a reload', await page.evaluate(() => __hx.state.left === 'closed'));
      }
    }
    /* a stored open sidebar from a wide window never boots as an overlay on a narrow one */
    await page.ctx.close();
    const ctx = await env.browser.newContext({ viewport: { width: 500, height: 800 } });
    page = await ctx.newPage(); page.errors = []; page.ctx = ctx;
    await page.goto(env.srv.origin + '/index.html'); await page.evaluate(() => localStorage.setItem('hx.v6.shell', JSON.stringify({ left: 'open', leftBy: 'user', right: 'open' }))); await page.reload(); await page.waitForTimeout(1000);
    check('corners', 'a stored open sidebar or details panel never boots over the work on a narrow window', await page.evaluate(() => __hx.state.left !== 'open' && __hx.state.right === 'closed'));
  });
  await s.close();
}
