/* When the dock shows (DESIGN-SYSTEM.md v7 21.4; the owner: hidden until you have a bot of your own, the Sessions tab's alone,
   "Show the dock" in Settings):
   - a first install (`?fixture=fresh`: no bots) has no dock, and the "Show the dock" setting is untouched; a session alone
     never draws it (the v7 dock has no session part: the session shows its own run);
   - the first bot raises it: the composer makes room first (the shell's 72), then the slab rises from below the window's edge
     with its bot in it; a second bot joins in place, with nothing rebuilt; the last bot going takes it away (an open card
     closes first) and the composer comes back down; reduced motion fades instead of travelling;
   - it is the Sessions tab's: the Bots tab hides it at once and coming back shows it at once;
   - the setting off (mod+J, Settings, the account menu) hides it whatever it holds and gives its room back; on brings it back.
   Gone with the v7 dock: the session part and its Run page, the hover-only options and minimise controls, the page nub.
   (The unit side is `modules/dock/model.test.ts`; the real WebKitGTK is `tests/e2e/dock_webkit.py`.) */
import { check, scenario } from './harness.mjs';

const BOT = { name: 'orbit', role: 'watches the build', shape: 'star', color: '#e8b04a', eyes: 'pill' };
const BOT2 = { name: 'comet', role: 'reads the logs', shape: 'circle', color: '#4ac6a0', eyes: 'pill' };
const SEND = { governed: true, smart: true, model: 'sonnet 5.5', assume: [] };

const STATE = () => {
  const d = document.querySelector('#hx-dock .dk'), k = d.querySelector('.k7-dock'), r = k.getBoundingClientRect();
  const live = (sel) => [...d.querySelectorAll(sel)].filter((e) => !e.closest('[hidden], [data-out]') && e.getClientRects().length > 0);
  const box = document.querySelector('.ss-composer .k7-composer__box');
  return {
    mode: d.dataset.mode, shown: __hx.dock().state.shown, in: d.hasAttribute('data-in'), vis: getComputedStyle(d).visibility, inert: d.inert, hidden: d.getAttribute('aria-hidden'),
    top: r.top, h: r.height, w: r.width, innerH: innerHeight, onEdge: Math.abs(r.bottom - innerHeight) <= 1, setting: __hx.state.dock, open: __hx.dock().state.open,
    bots: live('.k7-dock__orb').map((b) => b.dataset.bot), drawn: live('.k7-dock__orb orb-avatar').length,
    room: parseFloat(document.getElementById('hx-app').style.getPropertyValue('--hx-dock-space-to')) || 0, gap: box ? Math.round(innerHeight - box.getBoundingClientRect().bottom) : null,
    stored: (() => { try { return /"dock"\s*:\s*"off"/.test(localStorage.getItem('hx.v6.shell') || '') ? 'off' : 'not off'; } catch { return null; } })()
  };
};
/* the slab's top edge and the composer's bottom gap on every frame */
const REC = () => {
  window.__rec = []; window.__on = true;
  const tick = () => { const p = document.querySelector('#hx-dock .k7-dock').getBoundingClientRect(), d = document.querySelector('#hx-dock .dk'), c = document.querySelector('.ss-composer .k7-composer__box'); window.__rec.push({ t: performance.now(), top: p.top, vis: getComputedStyle(d).visibility === 'visible' && d.hasAttribute('data-in'), gap: c ? innerHeight - c.getBoundingClientRect().bottom : 0 }); if (window.__on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
const STOP = () => { window.__on = false; return window.__rec; };
const gone = (m) => !m.shown && !m.in && m.vis === 'hidden' && m.inert && m.hidden === 'true' && m.bots.length === 0;
const there = (m) => m.shown && m.in && m.vis === 'visible' && !m.inert && m.hidden === null && m.onEdge && Math.abs(m.h - 72) <= 0.5;

export async function dockPresence(env) {
  const s = scenario(env);
  await s.safe('dock-presence', async () => {
    /* ───────── a first install: no dock, and the setting is left alone ───────── */
    let page = await s.fresh({ q: 'fixture=fresh', settle: 1500 });
    const st = () => page.evaluate(STATE);
    const wait = (ms) => page.waitForTimeout(ms);
    let m = await st();
    const noDock = m.gap;
    check('presence', 'a first install shows no dock: not drawn, inert, hidden from the accessibility tree, below the window\'s edge', gone(m) && m.top >= m.innerH && m.room === 0, m);
    check('presence', 'and the "Show the dock" setting is still on, and nothing stored says otherwise (no dock is not a dock turned off)', m.setting === 'on' && m.stored !== 'off' && m.mode !== 'off', { setting: m.setting, stored: m.stored, mode: m.mode });

    /* ───────── a session alone never draws it ───────── */
    await page.evaluate((a) => { const d = __hx.data(); const n = d.sessions.create(null); d.sessions.send(n.id, 'fix the rounding\nin src/billing', a); }, SEND);
    await wait(1200);
    m = await st();
    check('presence', 'a started session alone draws no dock (the v7 dock is your bots\'; the session shows its own run)', gone(m) && m.room === 0, m);
    check('presence', 'no console errors', page.errors.length === 0, page.errors);

    /* ───────── the first bot: the composer makes room, then the dock rises in ───────── */
    page = await s.fresh({ q: 'fixture=fresh', settle: 1500 });
    await page.evaluate(REC);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT);
    await wait(1400);
    const rec = await page.evaluate(STOP);
    m = await st();
    check('presence', 'the first bot makes the dock rise: the row, 72 tall on the window\'s edge, with the bot drawn in it', there(m) && m.bots.join() === 'orbit' && m.drawn === 1 && m.mode === 'normal', m);
    const seen = rec.filter((r) => r.vis), tops = seen.map((r) => r.top), final = tops.at(-1);
    let mono = true, over = 0;
    for (let i = 1; i < tops.length; i++) { if (tops[i] > tops[i - 1] + 0.5) mono = false; over = Math.max(over, final - tops[i]); }
    check('presence', 'it rises from below the window\'s edge: many frames, never back down, no overshoot, not a pop', seen.length >= 8 && mono && over <= 1.5 && tops[0] > final + 0.5 * 72, { frames: seen.length, mono, over, first: tops[0], final });
    const gap0 = rec[0].gap, firstUp = rec.findIndex((r) => r.gap > gap0 + 1), firstSeen = rec.findIndex((r) => r.vis);
    check('presence', 'the composer makes room first (it starts up before the slab shows), and ends 72 higher', firstUp >= 0 && firstUp <= firstSeen && m.gap - noDock === 72 && m.room === 72, { firstUp, firstSeen, gap: m.gap, noDock });

    /* ───────── a second bot joins in place; nothing is rebuilt ───────── */
    await page.evaluate(() => { window.__first = document.querySelector('#hx-dock .k7-dock__orb[data-bot="orbit"]'); window.__firstOrb = window.__first.querySelector('orb-avatar'); });
    await page.evaluate((b) => __hx.data().bots.create(b), BOT2); await wait(900);
    m = await st();
    const same = await page.evaluate(() => { const b = document.querySelector('#hx-dock .k7-dock__orb[data-bot="orbit"]'); return b === window.__first && b.querySelector('orb-avatar') === window.__firstOrb; });
    check('presence', 'a second bot joins the row in place: both drawn, the first bot\'s button and orb the same elements', there(m) && m.bots.join() === 'orbit,comet' && m.drawn === 2 && same, { bots: m.bots, same });

    /* ───────── it is the Sessions tab's ───────── */
    await page.keyboard.press('Alt+2'); await wait(120);
    m = await st();
    check('presence', 'the Bots tab hides it at once (no travel), and keeps no room for it', gone({ ...m, bots: [] }) && !m.shown, m);
    await page.keyboard.press('Alt+1'); await wait(700);
    m = await st();
    check('presence', 'back on the Sessions tab it is there again with its bots', there(m) && m.bots.length === 2 && m.drawn === 2, m);

    /* ───────── the last bot goes: an open card closes, the dock leaves, the composer comes down ───────── */
    await page.evaluate(() => __hx.data().bots.archive('comet')); await wait(700);
    await page.evaluate(() => __hx.dock().openSession('orbit')); await wait(700);
    const opened = (await st()).open;
    await page.evaluate(() => __hx.data().bots.archive('orbit'));
    await wait(1600);
    m = await st();
    check('presence', 'the last bot archived takes the dock away (its open card closed first), the setting untouched, the composer back down', opened === 'card' && gone(m) && m.open === null && m.setting === 'on' && m.stored !== 'off' && m.room === 0 && m.gap === noDock, { opened, ...m });
    await page.evaluate((b) => __hx.data().bots.create(b), BOT);
    await wait(1400);
    m = await st();
    check('presence', 'a bot made again brings it back', there(m) && m.bots.join() === 'orbit' && m.gap - noDock === 72, m);

    /* ───────── the setting off hides whatever there is ───────── */
    await page.keyboard.press('Control+j'); await wait(1200);
    m = await st();
    check('presence', 'mod+J ("Show the dock" off) takes the dock away and gives its room back', m.setting === 'off' && m.mode === 'off' && !m.shown && m.vis === 'hidden' && m.inert && m.room === 0 && m.gap === noDock, m);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT2); await wait(900);
    m = await st();
    check('presence', 'a bot made while it is off stays hidden', m.mode === 'off' && !m.shown && m.vis === 'hidden', m);
    await page.keyboard.press('Control+j'); await wait(1500);
    m = await st();
    check('presence', 'mod+J again brings it back with both bots', there(m) && m.setting === 'on' && m.bots.length === 2 && m.drawn === 2, m);
    check('presence', 'no console errors through all of it', page.errors.length === 0, page.errors);

    /* ───────── a first install with the setting off: a bot changes nothing until it is on ───────── */
    page = await s.fresh({ q: 'fixture=fresh', settle: 1200 });
    await page.evaluate(() => __hx.setState({ dock: 'off' })); await wait(300);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT); await wait(900);
    m = await st();
    check('presence', 'with the setting off a first bot shows nothing', m.mode === 'off' && !m.shown && m.vis === 'hidden', m);
    await page.evaluate(() => __hx.setState({ dock: 'on' })); await wait(1500);
    m = await st();
    check('presence', 'and turning it on shows the dock', there(m) && m.bots.join() === 'orbit', m);

    /* ───────── reduced motion: it fades, it does not travel ───────── */
    page = await s.fresh({ q: 'fixture=fresh', settle: 1200, reduced: true });
    await page.evaluate(REC);
    await page.evaluate((b) => __hx.data().bots.create(b), BOT);
    await wait(900);
    const rec4 = await page.evaluate(STOP);
    m = await st();
    const first = rec4.find((r) => r.vis);
    check('presence', 'reduced motion: the first bot\'s dock is in its place in its first frame (no travel)', there(m) && !!first && Math.abs(first.top - m.top) < 1.5, { first: first && first.top, final: m.top });
    await page.evaluate(() => __hx.data().bots.archive('orbit')); await wait(900);
    m = await st();
    check('presence', 'reduced motion: the last bot archived takes it away', gone(m), m);
    check('presence', 'no console errors', page.errors.length === 0, page.errors);
  });
  await s.close();
}
