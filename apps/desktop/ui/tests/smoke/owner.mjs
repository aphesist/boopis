/* The owner's decisions (design-system/DESIGN-SYSTEM.md, "Owner decisions"), checked in the running app:
   the dock is #000 in every preset and geometry, the dock's orb gestures, a click outside returns it to rest, hold to approve
   takes 1 second, a card animates its height (and snaps under reduced motion), reduced motion reduces and never freezes,
   archived bots wait in a collapsed group under the roster and are restored from it and from the palette, and a profile boopis
   did not make carries a "made outside boopis" mark (19 November 2026). */
import { check, scenario } from './harness.mjs';

export async function ownerDecisions(env) {
  const s = scenario(env);
  const { ev } = s;
  let page;

  /* the dock is pitch black in every preset and in each of its geometries (v7: the row, a bot's card open, the asks open) */
  for (const preset of ['catalog', 'graphite', 'bone', 'typewriter']) {
    page = await s.fresh({ q: 'preset=' + preset });
    const bgs = [];
    for (const [mode, go] of [['row', () => __hx.dock().setMode('normal')], ['card', () => __hx.dock().openSession(__hx.dock().botAt(1))], ['asks', () => __hx.dock().openAsks()]]) {
      await ev(go); await page.waitForTimeout(900);
      bgs.push(mode + ':' + await ev(() => {
        const path = document.querySelector('#hx-dock .k7-dock__slab path');
        const fill = path ? getComputedStyle(path).fill : 'no shape';
        const r = path ? path.getBoundingClientRect() : { width: 0, height: 0 };
        return (fill === 'rgb(0, 0, 0)' ? 'rgb(0,0,0)' : fill) + '/' + Math.round(r.width) + 'w' + Math.round(r.height) + 'h';
      }));
    }
    check('owner', 'the dock is #000 in ' + preset, bgs.every((b) => /:rgb\(0,0,0\)\/\d+w\d+h/.test(b)) && /^row:.*w72h$/.test(bgs[0]) && /w432h$/.test(bgs[1]) && /w432h$/.test(bgs[2]), bgs.join(' '));
  }

  /* orb gestures: one click opens the bot's card in the dock (a poke as feedback, the tab stays); the same orb again
     closes it; a double-click opens the full chat in the Bots tab */
  page = await s.fresh();
  const orb = '#hx-dock .k7-dock__orb:not([data-out]) >> nth=1';
  const id = await page.locator(orb).getAttribute('data-bot');
  await ev(() => { window.__pokes = 0; const P = customElements.get('orb-avatar').prototype; const o = P.poke; P.poke = function (...a) { window.__pokes++; return o && o.apply(this, a); }; });
  const sess = () => ev(() => { const d = __hx.dock().state, v = document.querySelector('#hx-dock .k7-dock__panel[data-open="card"]'); return { tab: __hx.state.tab, session: d.open === 'card' && !!v && v.getClientRects().length > 0 ? d.card : null, name: v?.querySelector('.k7-dock__name')?.textContent ?? null, pokes: window.__pokes }; });
  await page.locator(orb).click(); await page.waitForTimeout(1100);
  const c = await sess();
  check('owner', 'one click opens the bot\'s card in the dock', c.tab === 'session' && c.session === id && c.pokes > 0, c);
  await page.locator(orb).click(); await page.waitForTimeout(1100);
  const c2 = await sess(); check('owner', 'the same orb again closes it', !c2.session, c2);
  page = await s.fresh();
  await page.locator(orb).dblclick(); await page.waitForTimeout(1100);
  const dc = await ev(() => ({ tab: __hx.state.tab, title: document.querySelector('#hx-btn-title .k7-title__name').textContent }));
  check('owner', 'a double-click opens the full chat in Bots', dc.tab === 'bots' && dc.title.toLowerCase() === String(id).toLowerCase(), { id, ...dc });

  /* bots are one stream: a bot made in the Bots tab joins the dock, last, with no reload (v7: the row shows the bots that matter now,
     so a new idle bot is counted in "N more"; back on the Sessions tab the dock is there with it) */
  page = await s.fresh();
  const dockBots = () => ev(() => ({ ids: [...document.querySelectorAll('#hx-dock .k7-dock__orb')].sort((a, b) => +a.style.order - +b.style.order).map((b) => b.dataset.bot), more: __hx.dock().state.more, shown: __hx.dock().state.shown }));
  const before = await dockBots();
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  await ev(() => __hx.emit('hx:new-bot', { from: 'test' })); await page.waitForTimeout(400);
  await page.fill('[data-new-name]', 'rex'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  const hiddenOnBots = (await dockBots()).shown;
  await page.keyboard.press('Alt+1'); await page.waitForTimeout(700);
  const after = await dockBots();
  const orbIn = await ev(() => { const b = document.querySelector('#hx-dock .k7-dock__orb[data-bot="rex"]'); return !!b && !!b.querySelector('.ui-orb[data-bot="rex"] orb-avatar'); });
  check('owner', 'a bot created in the Bots tab joins the dock, last, with its orb, no reload', after.ids.length === before.ids.length + 1 && after.ids.at(-1) === 'rex' && orbIn && after.more === before.more + 1 && after.shown && !hiddenOnBots && before.ids.every((id, i) => after.ids[i] === id), { before: before.ids.length, after: after.ids.slice(-2), more: [before.more, after.more] });

  /* a click outside returns the dock to rest (gone with v7's dock: the minimised pill, 21.4) */
  page = await s.fresh();
  await page.locator(orb).click(); await page.waitForTimeout(1100);
  const open1 = await ev(() => __hx.dock().state.open);
  await page.mouse.click(700, 300); await page.waitForTimeout(1100);
  const rest = await ev(() => __hx.dock().state.open);
  check('owner', 'a click outside returns the dock to rest', open1 === 'card' && rest === null, open1 + ' -> ' + rest);
  await page.locator('#hx-dock .k7-dock__ask').click(); await page.waitForTimeout(900);
  const open2 = await ev(() => __hx.dock().state.open);
  await page.mouse.click(700, 300); await page.waitForTimeout(900);
  check('owner', 'a click outside folds the open asks too', open2 === 'stack' && (await ev(() => __hx.dock().state.open)) === null, open2);

  /* hold to approve takes 1 second, in the Bots tab and in the dock */
  for (const where of ['bots', 'dock']) {
    page = await s.fresh();
    let sel;
    if (where === 'bots') { await page.keyboard.press('Alt+2'); await page.waitForTimeout(700); sel = '#hx-view-bots [data-kit~="AskCard"] [data-hold]'; }
    else {
      const nid = await ev(() => { const b = document.querySelector('#hx-dock .k7-dock__orb[aria-label*="needs you"]'); return b && b.dataset.bot; });
      const b = page.locator(`#hx-dock .k7-dock__orb[data-bot="${nid}"]`);
      if (await b.count()) { await b.focus(); await page.keyboard.press('Space'); await page.waitForTimeout(1000); }
      sel = '#hx-dock [data-kit~="AskCard"] [data-hold]';
    }
    if (!(await page.locator(sel).count())) { check('owner', 'hold to approve · ' + where, false, 'no hold button'); continue; }
    const ms = await ev((q) => document.querySelector(q).dataset.ms || getComputedStyle(document.documentElement).getPropertyValue('--dur-hold').trim(), sel);
    const bb = await page.locator(sel).first().boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await ev((q) => {
      const b = document.querySelector(q); window.__t0 = 0; window.__t1 = 0;
      b.addEventListener('pointerdown', () => { window.__t0 = performance.now(); }, { capture: true, once: true });
      new MutationObserver(() => { if ((b.dataset.state === 'done' || b.hasAttribute('data-held')) && !window.__t1) window.__t1 = performance.now(); }).observe(b, { attributes: true });
      /* the commit is the provider's: the approval stops waiting (the card's own button may be gone with it) */
      __hx.data().waits.subscribe((e) => { if (e.type !== 'added' && !window.__t1) window.__t1 = performance.now(); });
    }, sel);
    await page.mouse.down(); await page.waitForTimeout(1250); await page.mouse.up(); await page.waitForTimeout(800);
    const dt = await ev(() => Math.round(window.__t1 - window.__t0));
    check('owner', 'hold commits at 1 s · ' + where, dt >= 950 && dt <= 1150, { dataMs: ms, committedAfterMs: dt });
    /* a hold released before 1 s does not approve */
    page = await s.fresh();
    if (where === 'bots') { await page.keyboard.press('Alt+2'); await page.waitForTimeout(700); }
    else { const nid = await ev(() => document.querySelector('#hx-dock .k7-dock__orb[aria-label*="needs you"]').dataset.bot); await page.locator(`#hx-dock .k7-dock__orb[data-bot="${nid}"]`).focus(); await page.keyboard.press('Space'); await page.waitForTimeout(1000); }
    const bb2 = await page.locator(sel).first().boundingBox();
    await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(600);
    check('owner', 'a hold released at 0.7 s does not approve · ' + where, await ev((q) => { const b = document.querySelector(q); return !!b && b.dataset.state !== 'done' && !b.hasAttribute('data-held') && __hx.data().waits.snapshot().some((w) => w.kind === 'approval'); }, sel));
  }

  /* cards animate their height when their state changes (the one height animation), and snap under reduced motion. A form (the
     kit's AskCard block) going from open to done collapses to its one-row receipt: a state change that changes its height. (The v6
     ship card this checked went at step 6e.) */
  for (const reduced of [false, true]) {
    page = await s.fresh({ reduced });
    const r = await ev(async () => {
      const heights = [];
      const o = Element.prototype.animate;
      Element.prototype.animate = function (k, opt) { try { const ks = Array.isArray(k) ? k : []; if (ks.some((f) => f && 'height' in f)) heights.push([ks[0].height, ks[ks.length - 1].height, typeof opt === 'object' ? opt.duration : opt]); } catch { /* keep going */ } return o.call(this, k, opt); };
      const c = __hx.card('form', { id: 'smoke-height', kind: 'approval', title: 'Deploy 0.2.0 to staging', why: 'The dry run matched all 200 invoices to the cent.', origin: { kind: 'agent', model: 'sonnet 5.5' }, schema: { properties: {} } }, { size: 'inline' });
      document.getElementById('hx-view-session').appendChild(c); await new Promise((r) => setTimeout(r, 200));
      c.update({ state: 'done', receiptText: 'You approved it' }); await new Promise((r) => setTimeout(r, 700));
      Element.prototype.animate = o; c.remove();
      return heights;
    });
    check('owner', 'card height ' + (reduced ? 'snaps under reduced motion' : 'animates when its state changes'), reduced ? r.length === 0 : r.length > 0 && r[0][2] >= 150, r.slice(0, 1));
  }

  /* reduced motion reduces and never freezes: live orbs keep their life, the jelly drops to .12, travel is instant */
  for (const reduced of [false, true]) {
    page = await s.fresh({ reduced });
    /* a bot at rest on a rest surface (the v7 dock, sidebar and rail: ORBS.md section 23) is still by decision, jelly 0, in either motion
       setting; the live orbs of the v7 Sessions tab are in a bot's card (its head), so one is opened for the count */
    await ev(() => __hx.dock().openSession(__hx.dock().botAt(1))); await page.waitForTimeout(500);
    const orbs = await ev(() => { const o = [...document.querySelectorAll('orb-avatar')]; const rest = (x) => !!x.closest('.ui-orb[data-orb-rest]'); const live = o.filter((x) => !x.hasAttribute('static') && !rest(x)); return { total: o.length, live: live.length, rest: o.filter(rest).length, restJelly0: o.filter(rest).every((x) => x.getAttribute('jelly') === '0'), jelly12: live.filter((x) => x.getAttribute('jelly') === '.12' || x.jelly === 0.12).length }; });
    await ev(() => __hx.dock().closeSession()); await page.waitForTimeout(300);
    const before = await ev(() => ({ booting: document.getElementById('hx-app').classList.contains('is-booting'), tab: __hx.state.tab, op: getComputedStyle(document.getElementById('hx-view-bots')).opacity, cls: document.getElementById('hx-view-bots').className }));
    await page.keyboard.press('Alt+2'); await page.waitForTimeout(100);
    const mid = await ev(() => getComputedStyle(document.getElementById('hx-view-bots')).opacity);
    const after = await ev(() => ({ tab: __hx.state.tab, cls: document.getElementById('hx-view-bots').className, tr: getComputedStyle(document.getElementById('hx-view-bots')).transition.slice(0, 80) }));
    await page.waitForTimeout(700);
    const dur = await ev(() => getComputedStyle(document.querySelector('.hx-view')).transitionDuration.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000)).reduce((a, b) => Math.max(a, b), 0));
    const settled = await ev(() => +getComputedStyle(document.getElementById('hx-view-bots')).opacity);
    check('owner', 'reduced motion ' + (reduced ? 'on: reduces, orbs stay live' : 'off: the shell animates'),
      reduced ? dur <= 2 && settled === 1 && orbs.live > 0 && orbs.jelly12 === orbs.live && orbs.restJelly0 : dur >= 150 && +mid < 1 && orbs.jelly12 === 0 && orbs.restJelly0, { viewTransitionMs: dur, midOpacity: +mid, settled, orbs, before, after });
  }

  /* archived bots: a collapsed group under the roster, with a count; open, each shows its name, when it was archived and Restore */
  page = await s.fresh();
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  const ag = () => ev(() => { const h = document.querySelector('.bt-archived .k7-shead__btn'); const rows = [...document.querySelectorAll('.bt-archived [data-kit~="ListRow"]')]; return { head: h && h.textContent, open: h && h.getAttribute('aria-expanded'), visible: rows.filter((r) => r.offsetParent !== null).length, names: rows.map((r) => r.querySelector('.k7-lrow__title').textContent), subs: rows.map((r) => r.querySelector('.k7-lrow__sub').textContent), bots: document.querySelectorAll('.bt-rows [data-kit~="ListRow"]').length, rail: getComputedStyle(document.querySelector('.bt-archived')).display }; });
  const a0 = await ag();
  check('owner', 'the Archived group sits under the roster with its count, collapsed: no archived bot shows', /^Archived\s*2$/.test((a0.head ?? '').trim()) && a0.open === 'false' && a0.visible === 0, a0);
  await page.click('.bt-archived .k7-shead__btn'); await page.waitForTimeout(300);
  const a1 = await ag();
  check('owner', 'opened, each archived bot shows its name and when it was archived, and has Restore', a1.open === 'true' && a1.visible === 2 && a1.names.join() === 'ledger,nina' && a1.subs.join() === 'Archived yesterday,Archived mon' && (await page.locator('.bt-archived [data-kit~="ListRow"]').first().evaluate((li) => { li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return !!li.querySelector('[data-act="restore"][aria-label="Restore ledger"]'); })), a1);
  await page.reload(); await page.waitForTimeout(800);
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  const a2 = await ag();
  check('owner', 'the group stays open after a reload: it is remembered per user', a2.open === 'true' && a2.visible === 2, a2);
  /* a refusal: nina's name is in use, so the archived nina stays */
  await page.locator('.bt-archived [data-kit~="ListRow"] >> nth=1').hover();
  await page.click('.bt-archived [data-act="restore"][aria-label="Restore nina"]'); await page.waitForTimeout(500);
  const refused = await ev(() => ({ toast: document.querySelector('.k7-notify .k7-notice__text')?.textContent, archived: document.querySelectorAll('.bt-archived [data-kit~="ListRow"]').length, nina: [...document.querySelectorAll('.bt-rows [data-kit~="ListRow"]')].filter((r) => r.dataset.value === 'nina').length }));
  check('owner', 'restoring a bot whose name is in use is refused in words, and nothing moves', /^Could not restore nina: there is a teammate called nina already; archive or delete it, then restore$/.test(refused.toast ?? '') && refused.archived === 2 && refused.nina === 1, refused);
  /* one Notice at a time (2a): the refusal is dismissed before the next restore, whose Notice then shows at once */
  await page.click('#hx-notify [data-dismiss]'); await page.waitForTimeout(300);
  await page.locator('.bt-archived [data-kit~="ListRow"] >> nth=0').hover();
  await page.click('.bt-archived [data-act="restore"][aria-label="Restore ledger"]'); await page.waitForTimeout(600);
  const back = await ev(() => ({ toast: document.querySelector('.k7-notify .k7-notice__text')?.textContent, head: document.querySelector('.bt-archived .k7-shead__btn')?.textContent.trim(), ledger: !!document.querySelector('.bt-rows [data-kit~="ListRow"][data-value="ledger"]'), dock: !!document.querySelector('#hx-dock .k7-dock__orb[data-bot="ledger"] orb-avatar'), focus: document.activeElement?.dataset?.value }));
  check('owner', 'Restore brings the bot back into the roster and the dock, says so, and the group counts one fewer', back.toast === 'Restored ledger' && /^Archived\s*1$/.test(back.head ?? '') && back.ledger && back.dock && back.focus === 'ledger', back);

  /* the palette's "Restore bot…" lists the archived bots alone and restores the chosen one (or says why not) */
  page = await s.fresh();
  await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
  await page.keyboard.type('restore'); await page.waitForTimeout(150);
  const pc = await ev(() => [...document.querySelectorAll('#hx-palette-list .k7-cpal__label')].map((n) => n.textContent));
  check('owner', 'the palette offers "Restore bot…" while bots are archived', pc.join() === 'Restore bot…', pc);
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  const pl = await ev(() => ({ open: !document.getElementById('hx-palette').hidden, group: [...document.querySelectorAll('#hx-palette-list .k7-cpal__head')].map((n) => n.textContent), rows: [...document.querySelectorAll('#hx-palette-list .k7-cpal__label')].map((n) => n.textContent), ph: document.getElementById('hx-palette-input').placeholder }));
  check('owner', 'it lists the archived bots, and only them', pl.open && pl.group.join() === 'Archived bots' && pl.rows.join() === 'ledger,nina' && pl.ph === 'Restore which bot', pl);
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  const pr = await ev(() => ({ open: !document.getElementById('hx-palette').hidden, toast: document.querySelector('.k7-notify .k7-notice__text')?.textContent, ledger: __hx.data().bots.snapshot().bots.some((b) => b.id === 'ledger'), left: __hx.data().bots.archived.get().map((a) => a.was) }));
  check('owner', 'choosing one restores it and says so', !pr.open && pr.toast === 'Restored ledger' && pr.ledger && pr.left.join() === 'nina', pr);

  /* the mark: a profile boopis did not make says so in the roster and over its chat (the quiet line above the thread), with its words as the description, and it goes when boopis keeps a setting for it */
  page = await s.fresh({ q: 'fixture=outside' });
  await page.keyboard.press('Alt+2'); await page.waitForTimeout(500);
  await page.click('.bt-rows [data-kit~="ListRow"][data-value="sage"]'); await page.waitForTimeout(400);
  const mk = await ev(() => { const row = document.querySelector('.bt-rows [data-kit~="ListRow"][data-value="sage"]'); const head = document.querySelector('#hx-view-bots [data-outside][tabindex="0"]'); const d = (id) => (id && document.getElementById(id)?.textContent) || null; const css = getComputedStyle(row.querySelector('[data-outside]')); return { rowText: row.querySelector('[data-outside]')?.textContent, label: row.getAttribute('aria-label'), rowDesc: d(row.getAttribute('aria-describedby')), head: head?.textContent, headDesc: d(head?.getAttribute('aria-describedby')), tip: head?.getAttribute('data-tip'), others: document.querySelectorAll('.bt-rows [data-kit~="ListRow"]:not([data-value="sage"]) [data-outside]').length, pill: css.borderRadius, h: css.height }; });
  const WORDS = 'Made outside boopis, for example on the command line. boopis keeps its look and settings once you change them here.';
  check('owner', 'a profile boopis did not make carries "made outside boopis", with its words as the tooltip and the accessible description', mk.rowText === 'outside' && mk.head === 'made outside boopis' && mk.rowDesc === WORDS && mk.headDesc === WORDS && mk.tip === WORDS && mk.label === "sage, reads release notes, outside" && mk.others === 0, mk);
  await page.keyboard.press('Shift'); await page.focus('#hx-view-bots [data-outside][tabindex="0"]'); await page.waitForTimeout(300);   /* a key first, so the focus is a keyboard's (:focus-visible) */
  const tip = await ev(() => { const t = document.querySelector('.k7-tip'); return { text: t?.textContent, shown: t?.classList.contains('is-in'), w: t ? Math.round(t.getBoundingClientRect().width) : 0, fits: t ? t.getBoundingClientRect().right <= innerWidth : false }; });
  check('owner', 'the mark is reachable by keyboard and its tooltip shows on focus, within the window', tip.shown && tip.text === WORDS && tip.fits, tip);
  await ev(() => __hx.data().bots.update('sage', { cfg: { cap: '1.00' } })); await page.waitForTimeout(300);
  const gone = await ev(() => document.querySelectorAll('[data-outside]').length);
  check('owner', 'saving a boopis setting for it creates the store and the mark goes, in the roster and in the header', gone === 0, gone);

  /* the voice button is never hidden (owner, 26 November): every composer draws it while it is empty; with no voice model set up a
     press starts nothing and opens a Notice at it, whose one action opens Settings at Models */
  for (const [where, sel, go] of [['a session', '.ss-composer', null], ['a bot\'s chat', '#hx-view-bots .bt-composer-zone', () => page.keyboard.press('Alt+2')], ['a bot\'s card in the dock', '#hx-dock .k7-dock__panel', async () => { await page.keyboard.press('Alt+1'); await page.waitForTimeout(400); await ev(() => __hx.dock().openSession(__hx.dock().botAt(2))); }]]) {
    if (where === 'a session') page = await s.fresh();
    if (go) { await go(); await page.waitForTimeout(900); }
    const circle = sel + ' [data-kit~="Composer"] [data-send]', text = sel + ' .k7-composer__text';
    await page.click(text); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(200);
    const at = await ev((q) => { const b = document.querySelector(q), r = b.getBoundingClientRect(); return { shown: r.width > 0 && getComputedStyle(b).visibility !== 'hidden', name: b.getAttribute('aria-label'), tip: b.getAttribute('data-tip'), glyph: !!b.querySelector('svg') }; }, circle);
    await page.click(circle); await page.waitForTimeout(400);
    const n = await ev((q) => { const n = document.querySelector('.k7-notice[data-floating]'), b = document.querySelector(q); if (!n) return null; const r = n.getBoundingClientRect(), c = b.getBoundingClientRect(); return { words: n.querySelector('.k7-notice__text').textContent, acts: [...n.querySelectorAll('[data-kit~="Button"]')].map((x) => x.textContent.trim()), above: r.bottom <= c.top + 0.5, inWindow: r.left >= 0 && r.right <= innerWidth, focus: !!document.activeElement.closest('.k7-notice') }; }, circle);
    check('owner', `the voice circle shows in ${where} and says it needs setting up`, at.shown && at.glyph && /set up a voice model/.test(at.name) && at.tip === at.name, at);
    check('owner', `pressed with no voice model, it opens the Notice over the composer: one action, "Set up voice" · ${where}`, !!n && n.words === 'Voice needs a voice model' && n.acts.join() === 'Set up voice' && n.above && n.inWindow && n.focus, n);
    if (process.env.SMOKE_SHOTS && where === 'a bot\'s chat') await page.screenshot({ path: process.env.SMOKE_SHOTS + '/voice-notice.png' });
    if (where === 'a session') {
      await page.keyboard.press('Enter'); await page.waitForTimeout(700);
      const set = await ev(() => ({ open: document.getElementById('hx-settings').open, models: document.querySelector('#hx-set-nav-models')?.getAttribute('aria-current'), notice: !!document.querySelector('.k7-notice[data-floating].is-in') }));
      check('owner', '"Set up voice" opens Settings at Models, and the Notice is gone', set.open && set.models === 'page' && !set.notice, set);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    } else { await page.keyboard.press('Escape'); await page.waitForTimeout(300); check('owner', `Esc closes it, the focus back on the circle · ${where}`, await ev((q) => !document.querySelector('.k7-notice[data-floating].is-in') && document.activeElement === document.querySelector(q), circle)); }
  }
  await s.close();
}
