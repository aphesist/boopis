/* The owner's decisions (design-system/DESIGN-SYSTEM.md, "Owner decisions"), checked in the running app:
   the dock is #000 in every preset and mode, the dock's orb gestures, a click outside returns it to rest, hold to approve
   takes 1 second, a card animates its height (and snaps under reduced motion), reduced motion reduces and never freezes,
   archived bots wait in a collapsed group under the roster and are restored from it and from the palette, and a profile boopis
   did not make carries a "made outside boopis" mark (19 November 2026). */
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
    const before = await ev(() => ({ booting: document.getElementById('hx-app').classList.contains('is-booting'), tab: __hx.state.tab, op: getComputedStyle(document.getElementById('hx-view-bots')).opacity, cls: document.getElementById('hx-view-bots').className }));
    await page.keyboard.press('Alt+2'); await page.waitForTimeout(100);
    const mid = await ev(() => getComputedStyle(document.getElementById('hx-view-bots')).opacity);
    const after = await ev(() => ({ tab: __hx.state.tab, cls: document.getElementById('hx-view-bots').className, tr: getComputedStyle(document.getElementById('hx-view-bots')).transition.slice(0, 80) }));
    await page.waitForTimeout(700);
    const dur = await ev(() => getComputedStyle(document.querySelector('.hx-view')).transitionDuration.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000)).reduce((a, b) => Math.max(a, b), 0));
    const settled = await ev(() => +getComputedStyle(document.getElementById('hx-view-bots')).opacity);
    check('owner', 'reduced motion ' + (reduced ? 'on: reduces, orbs stay live' : 'off: the shell animates'),
      reduced ? dur <= 2 && settled === 1 && orbs.live > 0 && orbs.jelly12 === orbs.live : dur >= 150 && +mid < 1 && orbs.jelly12 === 0, { viewTransitionMs: dur, midOpacity: +mid, settled, orbs, before, after });
  }

  /* archived bots: a collapsed group under the roster, with a count; open, each shows its name, when it was archived and Restore */
  page = await s.fresh();
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  const ag = () => ev(() => { const h = document.querySelector('.bt-archived .ui-group__head'); const rows = [...document.querySelectorAll('.bt-archived .ui-row')]; return { head: h && h.textContent, open: h && h.getAttribute('aria-expanded'), visible: rows.filter((r) => r.offsetParent !== null).length, names: rows.map((r) => r.querySelector('.ui-row__title').textContent), subs: rows.map((r) => r.querySelector('.ui-row__sub').textContent), bots: document.querySelectorAll('.bt-rows .ui-row').length, rail: getComputedStyle(document.querySelector('.bt-archived')).display }; });
  const a0 = await ag();
  check('owner', 'the Archived group sits under the roster with its count, collapsed: no archived bot shows', /^Archived \(2\)$/.test((a0.head ?? '').trim()) && a0.open === 'false' && a0.visible === 0, a0);
  await page.click('.bt-archived .ui-group__head'); await page.waitForTimeout(300);
  const a1 = await ag();
  check('owner', 'opened, each archived bot shows its name and when it was archived, and has Restore', a1.open === 'true' && a1.visible === 2 && a1.names.join() === 'ledger,nina' && a1.subs.join() === 'Archived yesterday,Archived mon' && (await page.locator('.bt-archived .ui-row-wrap').first().evaluate((li) => { li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return !!li.querySelector('[data-act="restore"][aria-label="Restore ledger"]'); })), a1);
  await page.reload(); await page.waitForTimeout(800);
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  const a2 = await ag();
  check('owner', 'the group stays open after a reload: it is remembered per user', a2.open === 'true' && a2.visible === 2, a2);
  /* a refusal: nina's name is in use, so the archived nina stays */
  await page.locator('.bt-archived .ui-row-wrap >> nth=1').hover();
  await page.click('.bt-archived [data-act="restore"][aria-label="Restore nina"]'); await page.waitForTimeout(500);
  const refused = await ev(() => ({ toast: document.querySelector('.ui-toast')?.textContent, archived: document.querySelectorAll('.bt-archived .ui-row').length, nina: [...document.querySelectorAll('.bt-rows .ui-row')].filter((r) => r.dataset.value === 'nina').length }));
  check('owner', 'restoring a bot whose name is in use is refused in words, and nothing moves', /^Could not restore nina: there is a teammate called nina already; archive or delete it, then restore$/.test(refused.toast ?? '') && refused.archived === 2 && refused.nina === 1, refused);
  await page.locator('.bt-archived .ui-row-wrap >> nth=0').hover();
  await page.click('.bt-archived [data-act="restore"][aria-label="Restore ledger"]'); await page.waitForTimeout(600);
  const back = await ev(() => ({ toast: document.querySelector('.ui-toast')?.textContent, head: document.querySelector('.bt-archived .ui-group__head')?.textContent.trim(), ledger: !!document.querySelector('.bt-rows .ui-row[data-value="ledger"]'), dock: !!document.querySelector('#hx-dock .dk-bot[data-id="ledger"]'), focus: document.activeElement?.dataset?.value }));
  check('owner', 'Restore brings the bot back into the roster and the dock, says so, and the group counts one fewer', back.toast === 'Restored ledger' && back.head === 'Archived (1)' && back.ledger && back.dock && back.focus === 'ledger', back);

  /* the palette's "Restore bot…" lists the archived bots alone and restores the chosen one (or says why not) */
  page = await s.fresh();
  await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
  await page.keyboard.type('restore'); await page.waitForTimeout(150);
  const pc = await ev(() => [...document.querySelectorAll('#hx-palette-list .hx-pal-row__label')].map((n) => n.textContent));
  check('owner', 'the palette offers "Restore bot…" while bots are archived', pc.join() === 'Restore bot…', pc);
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  const pl = await ev(() => ({ open: !document.getElementById('hx-palette').hidden, group: [...document.querySelectorAll('#hx-palette-list .hx-pal-group')].map((n) => n.textContent), rows: [...document.querySelectorAll('#hx-palette-list .hx-pal-row__label')].map((n) => n.textContent), ph: document.getElementById('hx-palette-input').placeholder }));
  check('owner', 'it lists the archived bots, and only them', pl.open && pl.group.join() === 'Archived bots' && pl.rows.join() === 'ledger,nina' && pl.ph === 'Restore which bot', pl);
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  const pr = await ev(() => ({ open: !document.getElementById('hx-palette').hidden, toast: document.querySelector('.ui-toast')?.textContent, ledger: __hx.data().bots.snapshot().bots.some((b) => b.id === 'ledger'), left: __hx.data().bots.archived.get().map((a) => a.was) }));
  check('owner', 'choosing one restores it and says so', !pr.open && pr.toast === 'Restored ledger' && pr.ledger && pr.left.join() === 'nina', pr);

  /* the mark: a profile boopis did not make says so in the roster and the header, with its words as the description, and it goes when boopis keeps a setting for it */
  page = await s.fresh({ q: 'fixture=outside' });
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  await page.click('.bt-rows .ui-row[data-value="sage"]'); await page.waitForTimeout(400);
  const mk = await ev(() => { const row = document.querySelector('.bt-rows .ui-row[data-value="sage"]'); const head = document.querySelector('.bt-p-line .bt-outside'); const d = (id) => (id && document.getElementById(id)?.textContent) || null; const css = getComputedStyle(row.querySelector('.bt-outside')); return { rowText: row.querySelector('.bt-outside')?.textContent, label: row.getAttribute('aria-label'), rowDesc: d(row.getAttribute('aria-describedby')), head: head?.textContent, headDesc: d(head?.getAttribute('aria-describedby')), tip: head?.getAttribute('data-tip'), others: document.querySelectorAll('.bt-rows .ui-row:not([data-value="sage"]) .bt-outside').length, pill: css.borderRadius, h: css.height }; });
  const WORDS = 'Made outside boopis, for example on the command line. boopis keeps its look and settings once you change them here.';
  check('owner', 'a profile boopis did not make carries "made outside boopis", with its words as the tooltip and the accessible description', mk.rowText === 'outside' && mk.head === 'made outside boopis' && mk.rowDesc === WORDS && mk.headDesc === WORDS && mk.tip === WORDS && mk.label === "sage, reads release notes, outside" && mk.others === 0, mk);
  await page.keyboard.press('Shift'); await page.focus('.bt-p-line .bt-outside'); await page.waitForTimeout(300);   /* a key first, so the focus is a keyboard's (:focus-visible) */
  const tip = await ev(() => { const t = document.querySelector('.ui-tip'); return { text: t?.textContent, shown: t?.classList.contains('is-in'), w: t ? Math.round(t.getBoundingClientRect().width) : 0, fits: t ? t.getBoundingClientRect().right <= innerWidth : false }; });
  check('owner', 'the mark is reachable by keyboard and its tooltip shows on focus, within the window', tip.shown && tip.text === WORDS && tip.fits, tip);
  await ev(() => __hx.data().bots.update('sage', { cfg: { cap: '1.00' } })); await page.waitForTimeout(300);
  const gone = await ev(() => document.querySelectorAll('.bt-outside').length);
  check('owner', 'saving a boopis setting for it creates the store and the mark goes, in the roster and in the header', gone === 0, gone);
  await s.close();
}
