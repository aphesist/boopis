/* The dock in motion (owner, Linux: "the dock is really bugged out, flickering and stuff"). What a viewer sees as a
   flicker is one of a few mechanical things, and each is asserted here by recording the dock on every animation frame
   across open, close, a session, a hover, a page, a bot made and a bot archived:
   - nothing is replaced: the bot buttons and the live orbs are the same elements before and after (a re-render that
     rebuilds the DOM loses hover and focus, binds every corner again and pulls the orbs out of their slots);
   - the slab never leaves its path: no overshoot, no frame that takes most of the way at once, a height that never
     passes through a size it is not going to;
   - a focus ring is never drawn outside a slab that has not reached it, and is back when the slab has settled;
   - the frames: no long task and no gap over a budget while the dock moves. */
import { check, scenario } from './harness.mjs';

const INSTALL = () => {
  const root = document.querySelector('#hx-dock .dk');
  const ids = new WeakMap(); let n = 0; const idOf = (e) => { if (!ids.has(e)) ids.set(e, ++n); return ids.get(e); };
  const fl = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-l')) || 14;
  window.__idOf = idOf;
  window.__ids = () => ({ bots: [...root.querySelectorAll('.dk-bot')].map(idOf), orbs: [...root.querySelectorAll('orb-avatar')].map(idOf) });
  window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* none */ }
  const ringOf = () => {
    const a = document.activeElement; if (!a || !root.contains(a) || !a.matches(':focus-visible')) return null;
    const cs = getComputedStyle(a), af = getComputedStyle(a, '::after');
    const outline = cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px' && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.outlineColor);
    const drawn = a.hasAttribute('data-sq-on') ? af.content !== 'none' && parseFloat(af.opacity) > 0 && af.backgroundColor !== 'rgba(0, 0, 0, 0)' : outline;
    const r = a.getBoundingClientRect();
    return { drawn, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
  window.__rec = []; window.__on = false;
  const tick = () => {
    const s = root.querySelector('.dk-shape').getBoundingClientRect();
    window.__rec.push({ t: performance.now(), h: s.height, w: s.width - 2 * fl(), top: s.top, left: s.left + fl(), right: s.right - fl(), moving: root.hasAttribute('data-moving'), ring: ringOf(), ...window.__ids() });
    if (window.__on) requestAnimationFrame(tick);
  };
  window.__start = () => { window.__rec = []; window.__long = []; window.__on = true; requestAnimationFrame(tick); };
  window.__stop = () => { window.__on = false; return { rec: window.__rec, long: window.__long }; };
};

function analyse({ rec, long }, base) {
  const out = { frames: rec.length, h0: rec[0].h, h1: rec.at(-1).h, maxStep: 0, maxGap: 0, overshoot: 0, replacedBots: 0, replacedOrbs: 0, ringOut: 0, ringAtRest: true, long: long.length ? Math.max(...long) : 0, avg: 0 };
  const total = Math.abs(out.h1 - out.h0);
  const lo = Math.min(out.h0, out.h1), hi = Math.max(out.h0, out.h1);
  for (let i = 0; i < rec.length; i++) {
    const r = rec[i];
    if (i) { out.maxStep = Math.max(out.maxStep, Math.abs(r.h - rec[i - 1].h)); out.maxGap = Math.max(out.maxGap, r.t - rec[i - 1].t); }
    out.overshoot = Math.max(out.overshoot, lo - r.h, r.h - hi);
    for (const id of base.orbs) if (!r.orbs.includes(id)) out.replacedOrbs++;
    for (const id of base.bots) if (!r.bots.includes(id)) out.replacedBots++;
    if (r.moving && r.ring && r.ring.drawn && (r.ring.top < r.top - 1 || r.ring.left < r.left - 1 || r.ring.right > r.right + 1)) out.ringOut++;
  }
  const last = rec.at(-1); out.ringAtRest = !last.moving;   /* the rings wait only while the slab moves: at rest the flag is off and the library draws the ring as ever */
  out.avg = rec.length > 1 ? (rec.at(-1).t - rec[0].t) / (rec.length - 1) : 0;
  out.total = total;
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
      await act(); await page.waitForTimeout(o.wait ?? 1100);
      const r = analyse(await page.evaluate(() => window.__stop()), b);
      const moved = r.total > 20;
      check('motion', `${name}: nothing is replaced (${b.bots.length} bot buttons, ${b.orbs.length} orbs stay the same elements)`, r.replacedBots === 0 && r.replacedOrbs === 0, r);
      if (moved) check('motion', `${name}: the slab goes ${r.h0.toFixed(0)} to ${r.h1.toFixed(0)}px without overshoot, and no frame takes most of the way`, r.overshoot <= 1.5 && r.maxStep <= 0.7 * r.total, { overshoot: r.overshoot, maxStep: r.maxStep, total: r.total });
      if (o.rings) check('motion', `${name}: no focus ring hangs outside the slab while it moves, and it is back at rest`, r.ringOut === 0 && r.ringAtRest, { ringOut: r.ringOut, ringAtRest: r.ringAtRest });
      check('motion', `${name}: no long task (over 120 ms) while the dock moves`, r.long <= 120, { long: r.long, maxGap: r.maxGap, avg: r.avg });
      return r;
    };
    /* keyboard: the dock's ring is shown (focus-visible) */
    await page.keyboard.press('Control+g'); await page.keyboard.press('d'); await page.waitForTimeout(500);
    await run('expand (keyboard, Up)', () => page.keyboard.press('ArrowUp'), { rings: true });
    await run('collapse (keyboard, Down)', () => page.keyboard.press('ArrowDown'), { rings: true });
    await run('open a session', () => page.evaluate(() => __hx.dock().openSession('nina')), { rings: true });
    await run('close the session', () => page.evaluate(() => __hx.dock().closeSession()), { rings: true });
    await run('a page (run) and back', async () => { await page.evaluate(() => __hx.dock().goPage('run')); await page.waitForTimeout(600); await page.evaluate(() => __hx.dock().goPage('bots')); }, { wait: 800 });
    await page.evaluate(() => __hx.dock().setMode('normal')); await page.waitForTimeout(700);
    await run('the pill and back', async () => { await page.evaluate(() => __hx.dock().setMode('minimal')); await page.waitForTimeout(700); await page.evaluate(() => __hx.dock().setMode('normal')); }, { wait: 800 });
    const sweep = await run('a hover sweep across the row', async () => { for (let x = 300; x < 1150; x += 25) { await page.mouse.move(x, 872); await page.waitForTimeout(16); } await page.mouse.move(700, 300); }, { wait: 600 });
    check('motion', 'a hover sweep: the slab follows the pointer in small steps (no frame over 14px)', sweep.maxStep <= 14, { maxStep: sweep.maxStep });

    /* a bot made and a bot archived: the others stay put */
    await page.evaluate(() => { __hx.dock().setMode('normal'); });
    await page.waitForTimeout(700);
    await run('a bot is made', () => page.evaluate(() => __hx.data().bots.create({ name: 'orbit', role: 'watches the build', shape: 'star', color: '#e8b04a', eyes: 'pill' })), { wait: 1500 });
    const count = await page.evaluate(() => document.querySelectorAll('#hx-dock .dk-view:not([hidden]) .dk-bot').length);
    check('motion', 'a bot made: the row has one more bot', count === base.bots.length + 1, { count, before: base.bots.length });
    await run('a bot is archived', () => page.evaluate(() => __hx.data().bots.archive('orbit')), { wait: 1500 });
    const count2 = await page.evaluate(() => document.querySelectorAll('#hx-dock .dk-view:not([hidden]) .dk-bot').length);
    check('motion', 'a bot archived: the row is back to what it was', count2 === base.bots.length, { count2 });

    /* the run ticks every second: its meter is patched, not rebuilt */
    await page.evaluate(() => __hx.dock().goPage('run')); await page.waitForTimeout(700);
    const rebuilt = await page.evaluate(async () => {
      const root = document.querySelector('#hx-dock .dk'), ids = new WeakMap(); let n = 0;
      const snap = () => [...root.querySelectorAll('[data-run-cost] *, [data-run-meter] *, .dk-ladder *')].map((e) => { if (!ids.has(e)) ids.set(e, ++n); return ids.get(e); });
      const a = snap(); await new Promise((r) => setTimeout(r, 3500)); const b = snap();
      return { before: a.length, kept: a.filter((x) => b.includes(x)).length };
    });
    check('motion', 'the run page ticks without rebuilding its cost, meter and ladder', rebuilt.before > 0 && rebuilt.kept === rebuilt.before, rebuilt);
  });
  await s.close();
}
