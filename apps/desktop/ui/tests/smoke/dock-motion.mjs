/* The dock in motion (owner, Linux: "the dock is really bugged out, flickering and stuff"). What a viewer sees as a
   flicker is one of a few mechanical things, and each is asserted here by recording the v7 dock on every animation frame
   across a bot's card opening and closing, the asks opening and closing, a hover sweep, a bot made and a bot archived:
   - nothing is replaced: the bot buttons and the live orbs of the row are the same elements before and after (a re-render
     that rebuilds the DOM loses hover and focus and pulls the orbs out of their places; WebKitGTK then stops painting them);
   - the slab never leaves its path: between the row (72) and the one open size (432) it never overshoots, no frame takes
     most of the way at once, and its height never passes through a size it is not going to;
   - focus is never lost to the page: it is in the dock when the slab has settled;
   - the frames: no long task while the dock moves.
   Gone with the v7 dock (DESIGN-SYSTEM.md v7 21.4): the expanded roster, the pages and their nub, the minimised pill, the Run page. */
import { check, scenario } from './harness.mjs';

const INSTALL = () => {
  const root = document.querySelector('#hx-dock .dk');
  const ids = new WeakMap(); let n = 0; const idOf = (e) => { if (!ids.has(e)) ids.set(e, ++n); return ids.get(e); };
  window.__ids = () => ({ bots: [...root.querySelectorAll('.k7-dock__row .k7-dock__orb')].map(idOf), orbs: [...root.querySelectorAll('.k7-dock__row orb-avatar')].map(idOf) });
  window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* none */ }
  window.__rec = []; window.__on = false;
  const tick = () => {
    const s = root.querySelector('.k7-dock').getBoundingClientRect();
    window.__rec.push({ t: performance.now(), h: s.height, w: s.width, top: s.top, bottom: s.bottom, focusIn: root.contains(document.activeElement), ...window.__ids() });
    if (window.__on) requestAnimationFrame(tick);
  };
  window.__start = () => { window.__rec = []; window.__long = []; window.__on = true; requestAnimationFrame(tick); };
  window.__stop = () => { window.__on = false; return { rec: window.__rec, long: window.__long, innerH: innerHeight }; };
};

function analyse({ rec, long, innerH }, base) {
  const out = { frames: rec.length, h0: rec[0].h, h1: rec.at(-1).h, w0: rec[0].w, w1: rec.at(-1).w, maxStep: 0, maxStepW: 0, maxGap: 0, overshoot: 0, replacedBots: 0, replacedOrbs: 0, offEdge: 0, long: long.length ? Math.max(...long) : 0, avg: 0, focusIn: rec.at(-1).focusIn };
  const lo = Math.min(out.h0, out.h1), hi = Math.max(out.h0, out.h1);
  for (let i = 0; i < rec.length; i++) {
    const r = rec[i];
    if (i) { out.maxStep = Math.max(out.maxStep, Math.abs(r.h - rec[i - 1].h)); out.maxStepW = Math.max(out.maxStepW, Math.abs(r.w - rec[i - 1].w)); out.maxGap = Math.max(out.maxGap, r.t - rec[i - 1].t); }
    out.overshoot = Math.max(out.overshoot, lo - r.h, r.h - hi);
    out.offEdge = Math.max(out.offEdge, Math.abs(r.bottom - innerH));
    for (const id of base.orbs) if (!r.orbs.includes(id)) out.replacedOrbs++;
    for (const id of base.bots) if (!r.bots.includes(id)) out.replacedBots++;
  }
  out.rangeW = Math.max(...rec.map((r) => r.w)) - Math.min(...rec.map((r) => r.w));
  out.avg = rec.length > 1 ? (rec.at(-1).t - rec[0].t) / (rec.length - 1) : 0;
  out.total = Math.abs(out.h1 - out.h0);
  return out;
}

export async function dockMotion(env) {
  const s = scenario(env);
  await s.safe('motion', async () => {
    const page = await s.fresh({ settle: 1500 });
    await page.evaluate(INSTALL);
    const base = await page.evaluate(() => window.__ids());
    const run = async (name, act, o = {}) => {
      const b = o.base ?? base;
      await page.evaluate(() => window.__start());
      await act(); await page.waitForTimeout(o.wait ?? 900);
      const r = analyse(await page.evaluate(() => window.__stop()), b);
      check('motion', `${name}: nothing is replaced (${b.bots.length} bot buttons, ${b.orbs.length} orbs stay the same elements)`, r.replacedBots === 0 && r.replacedOrbs === 0, r);
      if (r.total > 20) check('motion', `${name}: the slab goes ${r.h0.toFixed(0)} to ${r.h1.toFixed(0)}px without overshoot, no frame takes most of the way, and it stays on the window's edge`, r.overshoot <= 1.5 && r.maxStep <= 0.7 * r.total && r.offEdge <= 1, { overshoot: r.overshoot, maxStep: r.maxStep, total: r.total, offEdge: r.offEdge, frames: r.frames });
      if (o.focus) check('motion', `${name}: the focus is in the dock when the slab has settled`, r.focusIn, { focusIn: r.focusIn });
      check('motion', `${name}: no long task (over 120 ms) while the dock moves`, r.long <= 120, { long: r.long, maxGap: r.maxGap, avg: r.avg });
      return r;
    };
    check('motion', 'the row at rest is 72 tall and the row has its bots', base.bots.length > 5 && base.orbs.length === base.bots.length && Math.abs((await page.evaluate(() => document.querySelector('#hx-dock .k7-dock').getBoundingClientRect().height)) - 72) <= 0.5, base.bots.length);

    /* keyboard: Enter on a bot opens its card, Esc folds it; the same from the API; the asks */
    await page.keyboard.press('Control+g'); await page.keyboard.press('d'); await page.waitForTimeout(500);
    const open = await run('a card opens (keyboard, Enter)', () => page.keyboard.press('Enter'), { focus: true });
    check('motion', 'the open dock is the one fixed size, 640 x 432', Math.abs(open.h1 - 432) <= 0.5 && Math.abs(open.w1 - 640) <= 0.5, { w: open.w1, h: open.h1 });
    await run('the card folds (keyboard, Esc)', () => page.keyboard.press('Escape'), { focus: true });
    await run('a card opens (another bot)', () => page.evaluate(() => __hx.dock().openSession(__hx.dock().botAt(2))));
    const swap = await run('the card changes bot in place', () => page.evaluate(() => __hx.dock().openSession(__hx.dock().botAt(3))));
    check('motion', 'changing the bot keeps the open size (the slab does not move)', swap.total <= 0.5 && swap.maxStep <= 0.5, { total: swap.total, maxStep: swap.maxStep });
    await run('the card closes', () => page.evaluate(() => __hx.dock().closeSession()));
    const asks = await run('the asks open (the ask pill)', () => page.click('#hx-dock .k7-dock__ask'), { focus: true });
    check('motion', 'the asks open at the same fixed size', Math.abs(asks.h1 - 432) <= 0.5 && Math.abs(asks.w1 - 640) <= 0.5, { w: asks.w1, h: asks.h1 });
    /* Esc on an ask is its Deny; the asks fold from their head's close button and nothing is decided, so the pill is still there for the sweep */
    await run('the asks fold (the close button)', () => page.click('#hx-dock .k7-dock__head [aria-label="Close the asks"]'), { focus: true });
    check('motion', 'folding the asks decides nothing: the ask pill is back at the row\'s end', await page.evaluate(() => __hx.dock().state.asks > 0 && !!document.querySelector('#hx-dock .k7-dock__ask')));
    const y = await page.evaluate(() => { const r = document.querySelector('#hx-dock .k7-dock__row').getBoundingClientRect(); return (r.top + r.bottom) / 2; });
    /* the dock's own clock runs four times slower for the sweep (its 200 ms are 800): a busy machine's frame cannot swallow the ease */
    await page.evaluate(() => __hx.dock().timeScale(0.25));
    const sweep = await run('a hover sweep across the row', async () => { for (let x = 300; x < 1150; x += 25) { await page.mouse.move(x, y); await page.waitForTimeout(16); } await page.mouse.move(700, 300); }, { wait: 1600 });
    await page.evaluate(() => __hx.dock().timeScale(1));
    /* the row's width follows its content (a hovered bot grows, the end slot names it) and eases: it changes, and no frame takes most of the change at once */
    check('motion', 'a hover sweep: the slab keeps its height, and its width eases with the row (no frame takes most of the change)', sweep.total <= 0.5 && sweep.rangeW > 4 && sweep.maxStepW <= 0.7 * sweep.rangeW, { maxStepW: sweep.maxStepW, rangeW: sweep.rangeW, total: sweep.total, maxGap: sweep.maxGap, frames: sweep.frames });
    check('motion', 'the pointer gone, no bot is hovered and the pill is back', await page.evaluate(() => __hx.dock().state.hover === null && !!document.querySelector('#hx-dock .k7-dock__ask')));

    /* a bot made and a bot archived: the others stay put (the bots already in the row keep their order; the new one takes the place
       its rank gives it; how many fit is the row's own business: "N more" is measured for the longest count it could say) */
    const rowNow = () => page.evaluate(() => { const d = __hx.dock().state; return { n: document.querySelectorAll('#hx-dock .k7-dock__orb').length, more: d.more, row: d.row }; });
    const samePrefix = (a, b) => { const k = Math.min(a.length, b.length); return k > 0 && a.slice(0, k).join() === b.slice(0, k).join(); };
    const row0 = await rowNow();
    await run('a bot is made', () => page.evaluate(() => __hx.data().bots.create({ name: 'orbit', role: 'watches the build', shape: 'star', color: '#e8b04a', eyes: 'pill' })), { wait: 1200 });
    const row1 = await rowNow();
    check('motion', 'a bot made: the dock holds one more bot (in the row by its rank, or counted in "N more"), and the others keep their order', row1.n === row0.n + 1 && row1.row.length + row1.more === row1.n && Math.abs(row1.row.length - row0.row.length) <= 1 && samePrefix(row0.row, row1.row.filter((id) => id !== 'orbit')), { row0, row1 });
    await run('a bot is archived', () => page.evaluate(() => __hx.data().bots.archive('orbit')), { wait: 1200 });
    const row2 = await rowNow();
    check('motion', 'a bot archived: the row is back to what it was', row2.n === row0.n && row2.more === row0.more && row2.row.join() === row0.row.join(), { row0, row2 });
    check('motion', 'no console errors', page.errors.length === 0, page.errors);
  });
  await s.close();
}
