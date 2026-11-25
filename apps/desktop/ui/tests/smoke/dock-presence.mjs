/* When the dock shows (owner, 19 November 2026): "make it so the dock only really appears after a bot is either created or a
   session is started. also remove the visible configuration buttons for the dock, they should only appear on hover."
   - a first install (`?fixture=fresh`: no bots, no session) has no dock, and the user's "Show the dock" setting is untouched;
   - the first bot rises in; so does the first session (the run alone, no roster); a part joining a dock that shows grows it
     in place, with nothing rebuilt; the last bot going, with no session, takes it away; the setting off hides it whatever it
     holds; reduced motion fades instead of travelling;
   - the options and minimise controls are transparent at rest and show on hover, on focus and after a tap, and are never
     removed from the keyboard or the accessibility tree; the page nub stays while there is more than one page.
   (The unit side is `modules/dock/presence.test.ts`; the real WebKitGTK is `tests/e2e/dock_webkit.py`.) */
import { check, scenario } from './harness.mjs';

const BOT = { name: 'orbit', role: 'watches the build', shape: 'star', color: '#e8b04a', eyes: 'pill' };
const SEND = { governed: true, smart: true, model: 'sonnet 5.5', assume: [] };

const STATE = () => {
  const d = document.querySelector('#hx-dock .dk');
  const path = d.querySelector('.dk-shape path').getBoundingClientRect();
  const live = (sel) => [...d.querySelectorAll(sel)].filter((e) => !e.closest('[hidden]') && e.getClientRects().length > 0);
  return {
    mode: d.dataset.mode, parts: d.dataset.parts, gone: d.classList.contains('is-gone'), inert: d.inert, hidden: d.getAttribute('aria-hidden'),
    d: d.querySelector('.dk-shape path').getAttribute('d'), h: path.height, w: path.width, setting: __hx.state.dock, page: __hx.dock().state.page,
    bots: live('.dk-bot').length, add: live('.dk-add').length, roster: live('.dk-roster').length,
    dots: [...d.querySelectorAll('.ui-pages__dot')].map((x) => x.dataset.value),
    stored: (() => { try { return /"dock"\s*:\s*"off"/.test(localStorage.getItem('hx.v6.shell') || '') ? 'off' : 'not off'; } catch { return null; } })()
  };
};
const REC = () => {
  window.__rec = []; window.__on = true;
  const tick = () => { const p = document.querySelector('#hx-dock .dk-shape path').getBoundingClientRect(); window.__rec.push({ t: performance.now(), h: p.height }); if (window.__on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
const STOP = () => { window.__on = false; return window.__rec; };

export async function dockPresence(env) {
  const s = scenario(env);
  await s.safe('dock-presence', async () => {
    /* ───────── a first install: no dock, and the setting is left alone ───────── */
    let page = await s.fresh({ q: 'fixture=fresh', settle: 1500 });
    const st = () => page.evaluate(STATE);
    const wait = (ms) => page.waitForTimeout(ms);
    let m = await st();
    check('presence', 'a first install shows no dock: it is off, gone, inert and hidden from the accessibility tree, with no slab', m.mode === 'off' && m.gone && m.inert && m.hidden === 'true' && m.d === '' && m.h === 0 && m.parts === '', m);
    check('presence', 'and the "Show the dock" setting is still on, and nothing stored says otherwise (an empty dock is not a dock turned off)', m.setting === 'on' && m.stored !== 'off', { setting: m.setting, stored: m.stored });
    const gap = () => page.evaluate(() => { const c = document.querySelector('.ss-composer'); return c ? Math.round(innerHeight - c.getBoundingClientRect().bottom) : null; });
    const noDock = await gap();
    check('presence', 'no console errors', page.errors.length === 0, page.errors);

    /* ───────── the first bot: the dock rises in ───────── */
    await page.evaluate(REC);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT);
    await wait(1400);
    const rec = await page.evaluate(STOP);
    m = await st();
    const hs = rec.map((r) => r.h), final = hs.at(-1);
    const grown = hs.filter((h) => h > 0.5);
    let mono = true, over = 0;
    for (let i = 1; i < hs.length; i++) { if (hs[i] < hs[i - 1] - 0.5) mono = false; over = Math.max(over, hs[i] - final); }
    check('presence', 'the first bot makes the dock rise: bots part only, normal, a slab with a bot and its "+" and no Run page', m.mode === 'normal' && m.parts === 'bots' && !m.gone && m.h > 60 && m.bots === 1 && m.add === 1 && !m.dots.includes('run'), m);
    check('presence', 'it rises on its spring: many frames, never down, no overshoot, not a pop', grown.length >= 8 && mono && over <= 1.5 && grown[0] < 0.5 * final, { frames: grown.length, mono, over, first: grown[0], final });

    /* ───────── the last bot goes, with no session: the dock leaves ───────── */
    await page.evaluate(() => __hx.data().bots.archive('orbit'));
    await wait(1600);
    m = await st();
    check('presence', 'the last bot archived, with no session, takes the dock away (off, gone, empty, the setting untouched)', m.mode === 'off' && m.gone && m.inert && m.h === 0 && m.parts === '' && m.setting === 'on' && m.stored !== 'off', m);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT);
    await wait(1400);
    m = await st();
    const withDock = await gap();
    check('presence', 'the shell keeps room for the dock only while it shows: the composer sits higher with it than without', noDock != null && withDock != null && withDock - noDock >= 40, { noDock, withDock });
    check('presence', 'a bot made again brings it back', m.mode === 'normal' && !m.gone && !m.inert && m.hidden === null && m.bots === 1 && m.h > 60, m);

    /* ───────── the first session: the run alone, no roster ───────── */
    page = await s.fresh({ q: 'fixture=fresh', settle: 1500 });
    await page.evaluate(REC);
    await page.evaluate((a) => { const d = __hx.data(); const n = d.sessions.create(null); d.sessions.send(n.id, 'fix the rounding\nin src/billing', a); }, SEND);
    await wait(1400);
    const rec2 = await page.evaluate(STOP);
    m = await st();
    const h2 = rec2.map((r) => r.h).filter((h) => h > 0.5);
    check('presence', 'a blank new session is not a started one: the dock only rose with the message', m.mode === 'normal' && m.parts === 'session' && !m.gone && m.h > 60, m);
    check('presence', 'with a session and no bots only the session part shows: the Run page, no roster, no "+", no Bots or Scheduled page', m.page === 'run' && m.bots === 0 && m.add === 0 && m.roster === 0 && !m.dots.includes('bots') && !m.dots.includes('sched') && m.dots.includes('run'), m);
    check('presence', 'the session\'s dock rises on a spring too', h2.length >= 8 && h2.every((h, i) => !i || h >= h2[i - 1] - 0.5), h2.length);
    const title = await page.evaluate(() => document.querySelector('#hx-dock .dk-v-run-norm .dk-run-title')?.textContent);
    check('presence', 'it shows the session\'s own title', title === 'fix the rounding', title);

    /* ───────── a bot joins a dock that shows: it grows, nothing is rebuilt ───────── */
    await page.evaluate(() => { window.__run = document.querySelector('#hx-dock .dk-run-open'); window.__sec = document.querySelector('#hx-dock .dk-page[data-page="run"]'); });
    await page.evaluate(REC);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT);
    await wait(1400);
    const rec3 = await page.evaluate(STOP);
    m = await st();
    const same = await page.evaluate(() => ({ run: document.querySelector('#hx-dock .dk-run-open') === window.__run, sec: document.querySelector('#hx-dock .dk-page[data-page="run"]') === window.__sec }));
    const hs3 = rec3.map((r) => r.h), jump = Math.max(0, ...hs3.slice(1).map((h, i) => Math.abs(h - hs3[i])));
    check('presence', 'a bot made grows the dock to hold the roster too: both parts, still on the Run page, the Bots dot joined the nub', m.parts === 'bots session' && m.page === 'run' && m.dots.includes('bots') && m.dots.includes('run') && m.bots === 0 && !m.gone, m);
    check('presence', 'nothing was rebuilt (the run\'s button and page are the same elements) and the slab did not pop', same.run && same.sec && jump < 20, { same, jump });
    await page.evaluate(() => __hx.dock().goPage('bots')); await wait(900);
    m = await st();
    check('presence', 'the Bots page then shows the bot and its "+"', m.bots === 1 && m.add === 1, m);
    await page.evaluate(() => __hx.data().bots.archive('orbit')); await wait(1400);
    m = await st();
    check('presence', 'the last bot archived with a session still there: the dock stays, back to the session part, on the Run page', m.mode === 'normal' && m.parts === 'session' && m.page === 'run' && m.bots === 0 && m.h > 60 && !m.gone, m);

    /* ───────── the setting off hides whatever there is ───────── */
    await page.evaluate(() => __hx.setState({ dock: 'off' })); await wait(1200);
    m = await st();
    check('presence', 'the setting off takes the dock away', m.mode === 'off' && m.gone && m.setting === 'off', m);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT); await wait(900);
    m = await st();
    check('presence', 'a bot made while it is off stays hidden', m.mode === 'off' && m.gone && m.parts === 'bots session', m);
    await page.evaluate(() => __hx.setState({ dock: 'on' })); await wait(1500);
    m = await st();
    check('presence', 'the setting on brings it back with both parts', m.mode !== 'off' && !m.gone && m.parts === 'bots session' && m.h > 20, m);
    check('presence', 'no console errors through all of it', page.errors.length === 0, page.errors);

    /* ───────── a first install with the setting off: bots and sessions change nothing until it is on ───────── */
    page = await s.fresh({ q: 'fixture=fresh', settle: 1200 });
    await page.evaluate(() => __hx.setState({ dock: 'off' })); await wait(300);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT); await wait(900);
    m = await st();
    check('presence', 'with the setting off a first bot shows nothing', m.mode === 'off' && m.gone && m.parts === 'bots', m);
    await page.evaluate(() => __hx.setState({ dock: 'on' })); await wait(1500);
    m = await st();
    check('presence', 'and turning it on shows the dock', m.mode !== 'off' && !m.gone && m.bots === 1, m);

    /* ───────── reduced motion: it fades, it does not travel ───────── */
    page = await s.fresh({ q: 'fixture=fresh', settle: 1200, reduced: true });
    await page.evaluate(REC);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT);
    await wait(900);
    const rec4 = await page.evaluate(STOP);
    m = await st();
    const first = rec4.find((r) => r.h > 0.5);
    check('presence', 'reduced motion: the first bot\'s dock is at its size in its first frame (no travel)', m.mode === 'normal' && !!first && Math.abs(first.h - m.h) < 1.5, { first: first && first.h, final: m.h });
    await page.evaluate(() => __hx.data().bots.archive('orbit')); await wait(900);
    m = await st();
    check('presence', 'reduced motion: the last bot archived takes it away', m.mode === 'off' && m.gone, m);

    /* ───────── the controls: hover, focus, touch, and never out of the tree ───────── */
    page = await s.fresh({ settle: 1500 });
    const ctl = () => page.evaluate(() => {
      const root = document.querySelector('#hx-dock .dk');
      const one = (sel) => { const b = root.querySelector(sel), w = b.closest('.dk-foot-ctl'), cs = getComputedStyle(w), bs = getComputedStyle(b);
        return { op: +cs.opacity, pe: cs.pointerEvents, vis: bs.visibility, disp: bs.display, label: b.getAttribute('aria-label'), tab: b.tabIndex, inert: !!b.closest('[inert]'), hiddenAttr: !!b.closest('[hidden], [aria-hidden="true"]') }; };
      const dots = root.querySelector('.dk-dots'), ds = getComputedStyle(dots);
      return { options: one('[data-act="customise"]'), minimise: one('[data-act="down"]'), dots: { op: +ds.opacity, vis: ds.visibility, n: dots.querySelectorAll('.ui-pages__dot').length } };
    });
    await page.mouse.move(700, 300); await wait(600);
    let c = await ctl();
    check('presence', 'at rest the options and minimise controls are transparent and take no pointer', c.options.op === 0 && c.minimise.op === 0 && c.options.pe === 'none' && c.minimise.pe === 'none', c);
    check('presence', 'but they are in the accessibility tree and the tab order: named, shown by the engine, not removed, not inert', [c.options, c.minimise].every((x) => x.label && x.vis === 'visible' && x.disp !== 'none' && x.tab >= 0 && !x.inert && !x.hiddenAttr), c);
    check('presence', 'the page nub (navigation) is visible at rest while there is more than one page', c.dots.n > 1 && c.dots.op === 1 && c.dots.vis === 'visible', c.dots);
    const box = await page.evaluate(() => { const r = document.querySelector('#hx-dock .dk-shape path').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 }; });
    await page.mouse.move(box.x, box.y, { steps: 6 }); await wait(700);
    c = await ctl();
    check('presence', 'the pointer over the dock shows them, faded in', c.options.op === 1 && c.minimise.op === 1 && c.options.pe === 'auto', c);
    await page.mouse.move(700, 300, { steps: 4 }); await wait(700);
    c = await ctl();
    check('presence', 'and off the dock they fade out again', c.options.op === 0 && c.minimise.op === 0, c);
    await page.evaluate(() => __hx.dock().focus()); await page.waitForTimeout(700);
    c = await ctl();
    check('presence', 'keyboard focus inside the dock shows them (focus-within)', c.options.op === 1 && c.minimise.op === 1, c);
    const actNow = () => page.evaluate(() => { const a = document.activeElement; return { act: a && a.dataset && a.dataset.act, within: !!a.closest('#hx-dock') }; });
    await page.keyboard.press('Tab'); await wait(200);
    const t1 = await actNow();
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await wait(200);
    const t2 = await actNow();
    check('presence', 'Tab reaches the options control, then (past the page nub) the minimise control, by keyboard', t1.within && t1.act === 'customise' && t2.within && t2.act === 'down', { t1, t2 });
    await page.evaluate(() => { document.activeElement.blur(); }); await page.mouse.move(700, 300); await wait(700);
    c = await ctl();
    check('presence', 'blurred and away, they are hidden again', c.options.op === 0, c);
    /* a tap: touch has no hover; a pointer-down of type touch on the dock reveals them, and a press outside puts them away */
    await page.evaluate(() => { const p = document.querySelector('#hx-dock .dk-shape path'); const r = p.getBoundingClientRect(); const o = { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: r.left + r.width / 2, clientY: r.top + 20, isPrimary: true }; p.dispatchEvent(new PointerEvent('pointerdown', o)); p.dispatchEvent(new PointerEvent('pointerup', o)); });
    await wait(600);
    const tapped = await page.evaluate(() => ({ attr: document.querySelector('#hx-dock .dk').hasAttribute('data-reveal'), op: +getComputedStyle(document.querySelector('#hx-dock .dk-foot-ctl')).opacity }));
    check('presence', 'a tap on the dock reveals them', tapped.attr && tapped.op === 1, tapped);
    await page.evaluate(() => { const o = { bubbles: true, pointerType: 'touch', pointerId: 8, clientX: 300, clientY: 200, isPrimary: true }; document.querySelector('#hx-btn-title .k7-title__name').dispatchEvent(new PointerEvent('pointerdown', o)); });
    await wait(600);
    const away = await page.evaluate(() => document.querySelector('#hx-dock .dk').hasAttribute('data-reveal'));
    check('presence', 'and a tap elsewhere puts them away', !away, away);
    check('presence', 'no console errors', page.errors.length === 0, page.errors);
  });
  await s.close();
}
