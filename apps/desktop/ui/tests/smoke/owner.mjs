/* The owner's decisions (design-system/DESIGN-SYSTEM.md, "Owner decisions"), checked in the running app:
   the dock is #000 in every preset and mode, the dock's orb gestures, a click outside returns it to rest, hold to approve
   takes 1 second, a card animates its height (and snaps under reduced motion), reduced motion reduces and never freezes. */
import { check, scenario } from './harness.mjs';

export async function ownerDecisions(env) {
  const s = scenario(env);
  const { ev } = s;
  let page;

  /* the dock is pitch black in every preset and every mode */
  for (const preset of ['catalog', 'graphite', 'bone', 'typewriter']) {
    page = await s.fresh({ q: 'preset=' + preset });
    const bgs = [];
    for (const mode of ['normal', 'expanded', 'minimal']) {
      await ev((m) => __hx.dock().setMode(m), mode); await page.waitForTimeout(900);
      bgs.push(mode + ':' + await ev(() => {
        const path = document.querySelector('#hx-dock .dk-shape path');
        const fill = path ? getComputedStyle(path).fill : 'no shape';
        const r = path ? path.getBoundingClientRect() : { width: 0 };
        return (fill === 'rgb(0, 0, 0)' ? 'rgb(0,0,0)' : fill) + '/' + Math.round(r.width) + 'w';
      }));
    }
    check('owner', 'the dock is #000 in ' + preset, bgs.every((b) => /:rgb\(0,0,0\)\/\d+w/.test(b)), bgs.join(' '));
  }

  /* orb gestures: one click opens the bot's session in the dock (a poke as feedback, the tab stays); the same orb again
     closes it; a double-click opens the full chat in the Bots tab */
  page = await s.fresh();
  const orb = '#hx-dock .dk-bot >> nth=1';
  const id = await page.locator(orb).getAttribute('data-id');
  await ev(() => { window.__pokes = 0; const P = customElements.get('orb-avatar').prototype; const o = P.poke; P.poke = function (...a) { window.__pokes++; return o && o.apply(this, a); }; });
  const sess = () => ev(() => { const v = document.querySelector('#hx-dock .dk-v-bots-card'); return { tab: __hx.state.tab, session: !!v && !v.hidden && v.getClientRects().length > 0 ? (document.getElementById('dk-card-name') || {}).textContent : null, pokes: window.__pokes }; });
  await page.locator(orb).click(); await page.waitForTimeout(1100);
  const c = await sess();
  check('owner', 'one click opens the bot\'s session in the dock', c.tab === 'session' && c.session === id && c.pokes > 0, c);
  const head = page.locator('#hx-dock .dk-card-head .dk-orb').first();
  if (await head.count()) { await head.click(); await page.waitForTimeout(1100); const c2 = await sess(); check('owner', 'the same orb again closes it', !c2.session, c2); }
  page = await s.fresh();
  await page.locator(orb).dblclick(); await page.waitForTimeout(1100);
  const dc = await ev(() => ({ tab: __hx.state.tab, title: document.getElementById('hx-where-title').textContent }));
  check('owner', 'a double-click opens the full chat in Bots', dc.tab === 'bots' && dc.title.toLowerCase() === String(id).toLowerCase(), { id, ...dc });

  /* bots are one stream: a bot made in the Bots tab joins the dock, last, with no reload */
  page = await s.fresh();
  const before = await ev(() => [...document.querySelectorAll('#hx-dock .dk-bot')].map((b) => b.dataset.id));
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  await ev(() => __hx.emit('hx:new-bot', { from: 'test' })); await page.waitForTimeout(400);
  await page.fill('.bt-name', 'rex'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  const after = await ev(() => [...document.querySelectorAll('#hx-dock .dk-bot')].map((b) => b.dataset.id));
  const orbIn = await ev(() => !!document.querySelector('#hx-dock .dk-bot[data-id="rex"] orb-avatar'));
  check('owner', 'a bot created in the Bots tab appears last in the dock, with its orb, no reload', after.length === before.length + 1 && after.at(-1) === 'rex' && orbIn && before.every((id, i) => after[i] === id), { before: before.length, after: after.slice(-2) });

  /* a click outside returns the dock to rest; the pill stays a pill */
  page = await s.fresh();
  await page.locator(orb).click(); await page.waitForTimeout(1100);
  const open1 = await ev(() => __hx.dock().state.mode);
  await page.mouse.click(700, 300); await page.waitForTimeout(1100);
  const rest = await ev(() => __hx.dock().state.mode);
  check('owner', 'a click outside returns the dock to rest', open1 === 'expanded' && rest === 'normal', open1 + ' -> ' + rest);
  await ev(() => __hx.dock().setMode('expanded')); await page.waitForTimeout(900);
  await page.mouse.click(700, 300); await page.waitForTimeout(900);
  check('owner', 'a click outside collapses an expanded page too', (await ev(() => __hx.dock().state.mode)) === 'normal');
  await ev(() => __hx.dock().setMode('minimal')); await page.waitForTimeout(900);
  await page.mouse.click(700, 300); await page.waitForTimeout(700);
  check('owner', 'the minimised pill stays a pill', (await ev(() => __hx.dock().state.mode)) === 'minimal');

  /* hold to approve takes 1 second, in the Bots tab and in the dock */
  for (const where of ['bots', 'dock']) {
    page = await s.fresh();
    let sel;
    if (where === 'bots') { await page.keyboard.press('Alt+2'); await page.waitForTimeout(700); sel = '#hx-view-bots [data-ui="hold"]'; }
    else {
      const nid = await ev(() => { const b = document.querySelector('#hx-dock .dk-bot[aria-label*="needs you"]'); return b && b.dataset.id; });
      const b = page.locator(`#hx-dock .dk-bot[data-id="${nid}"]`);
      if (await b.count()) { await b.focus(); await page.keyboard.press('Space'); await page.waitForTimeout(1000); }
      sel = '#hx-dock [data-ui="hold"]';
    }
    if (!(await page.locator(sel).count())) { check('owner', 'hold to approve · ' + where, false, 'no hold button'); continue; }
    const ms = await ev((q) => document.querySelector(q).dataset.ms || getComputedStyle(document.documentElement).getPropertyValue('--dur-hold').trim(), sel);
    const bb = await page.locator(sel).first().boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await ev((q) => {
      const b = document.querySelector(q); window.__t0 = 0; window.__t1 = 0;
      b.addEventListener('pointerdown', () => { window.__t0 = performance.now(); }, { capture: true, once: true });
      new MutationObserver(() => { if (b.dataset.state === 'done' && !window.__t1) window.__t1 = performance.now(); }).observe(b, { attributes: true });
    }, sel);
    await page.mouse.down(); await page.waitForTimeout(1250); await page.mouse.up(); await page.waitForTimeout(800);
    const dt = await ev(() => Math.round(window.__t1 - window.__t0));
    check('owner', 'hold commits at 1 s · ' + where, dt >= 950 && dt <= 1150, { dataMs: ms, committedAfterMs: dt });
    /* a hold released before 1 s does not approve */
    page = await s.fresh();
    if (where === 'bots') { await page.keyboard.press('Alt+2'); await page.waitForTimeout(700); }
    else { const nid = await ev(() => document.querySelector('#hx-dock .dk-bot[aria-label*="needs you"]').dataset.id); await page.locator(`#hx-dock .dk-bot[data-id="${nid}"]`).focus(); await page.keyboard.press('Space'); await page.waitForTimeout(1000); }
    const bb2 = await page.locator(sel).first().boundingBox();
    await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(600);
    check('owner', 'a hold released at 0.7 s does not approve · ' + where, (await ev((q) => document.querySelector(q).dataset.state, sel)) !== 'done');
  }

  /* cards animate their height when their state changes (the one height animation), and snap under reduced motion. A ship
     card going from passed to failed is a state change that changes its height. */
  for (const reduced of [false, true]) {
    page = await s.fresh({ reduced });
    const r = await ev(async () => {
      const heights = [];
      const o = Element.prototype.animate;
      Element.prototype.animate = function (k, opt) { try { const ks = Array.isArray(k) ? k : []; if (ks.some((f) => f && 'height' in f)) heights.push([ks[0].height, ks[ks.length - 1].height, typeof opt === 'object' ? opt.duration : opt]); } catch { /* keep going */ } return o.call(this, k, opt); };
      const c = __hx.ui.card('ship', { title: 'ready to ship', passed: 142, rolledBack: 1, branch: 'cents/proration', files: [['src/a.ts', 3, 1], ['src/b.ts', 4, 2]] }, { size: 'inline' });
      document.getElementById('hx-view-session').appendChild(c); await new Promise((r) => setTimeout(r, 200));
      c.update({ state: 'failed', failures: ['invoice.test.ts rounds per line item', 'money.test.ts'] }); await new Promise((r) => setTimeout(r, 700));
      Element.prototype.animate = o; c.remove();
      return heights;
    });
    check('owner', 'card height ' + (reduced ? 'snaps under reduced motion' : 'animates when its state changes'), reduced ? r.length === 0 : r.length > 0 && r[0][2] >= 150, r.slice(0, 1));
  }

  /* reduced motion reduces and never freezes: live orbs keep their life, the jelly drops to .12, travel is instant */
  for (const reduced of [false, true]) {
    page = await s.fresh({ reduced });
    const orbs = await ev(() => { const o = [...document.querySelectorAll('orb-avatar')]; const live = o.filter((x) => !x.hasAttribute('static')); return { total: o.length, live: live.length, jelly12: live.filter((x) => x.getAttribute('jelly') === '.12' || x.jelly === 0.12).length }; });
    await page.keyboard.press('Alt+2'); await page.waitForTimeout(100);
    const mid = await ev(() => getComputedStyle(document.getElementById('hx-view-bots')).opacity);
    await page.waitForTimeout(700);
    const dur = await ev(() => getComputedStyle(document.querySelector('.hx-view')).transitionDuration.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000)).reduce((a, b) => Math.max(a, b), 0));
    const settled = await ev(() => +getComputedStyle(document.getElementById('hx-view-bots')).opacity);
    check('owner', 'reduced motion ' + (reduced ? 'on: reduces, orbs stay live' : 'off: the shell animates'),
      reduced ? dur <= 2 && settled === 1 && orbs.live > 0 && orbs.jelly12 === orbs.live : dur >= 150 && +mid < 1 && orbs.jelly12 === 0, { viewTransitionMs: dur, midOpacity: +mid, settled, orbs });
  }
  await s.close();
}
