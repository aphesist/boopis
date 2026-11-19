/* Mods, on the live provider over a recording of real mod events (plugins/boopis/tests/test_mods_frames.py: two mods in the real
   hx worker, their events captured as the plugin emitted them and spliced into a recorded session). Checks the owner's decisions
   of 19 November 2026 in a real engine: the surfaces, panes in the details panel from 1200px and inline below it, dot progress in
   the band, the composer rising 22px by a transform, one toast at a time with "+N", the theme card with its live preview and
   every way the preview ends, a mod's question in the conversation and in the dock, and the refusals. */
import { check, scenario } from './harness.mjs';

const URL = 'provider=live-replay&frames=mods';
const text = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((n) => n.textContent).join('\n'), sel);

/** records every Web Animation made from now on: what moved, and how */
const RECORD = () => {
  window.__anims = [];
  const real = Element.prototype.animate;
  Element.prototype.animate = function (frames, opts) {
    window.__anims.push({ cls: this.className && String(this.className), frames: JSON.parse(JSON.stringify(frames)), duration: typeof opts === 'number' ? opts : opts && opts.duration });
    return real.call(this, frames, opts);
  };
};
const send = async (page) => {
  await page.evaluate(RECORD);
  const c = await page.$('.ss-composer textarea, .ss-composer [contenteditable="true"], .ss-composer [role="textbox"]');
  await c.click();
  await page.keyboard.type('run the tests');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
};
const composerTop = (page) => page.evaluate(() => document.querySelector('.ss-composer').children[1].getBoundingClientRect().top);
/** the room the shell keeps for the dock: none until a session has started (this recording has no bots, and the dock only rises with the first message) */
const dockSpace = (page) => page.evaluate(() => parseFloat(document.getElementById('hx-app').style.getPropertyValue('--hx-dock-space-to')) || 0);

export async function mods(env, AXE) {
  const s = scenario(env);

  await s.safe('mods', async () => {
    const page = await s.fresh({ q: URL, settle: 1500 });
    const top0 = await composerTop(page), room0 = await dockSpace(page);
    await send(page);
    const st = await page.evaluate(() => ({
      status: [...document.querySelectorAll('.ss-mods--status .mod-status__i')].map((n) => n.textContent),
      band: document.querySelector('.ss-mods--band .mod-row')?.textContent ?? '',
      bandInset: getComputedStyle(document.querySelector('.ss-mods--band .mod-band') ?? document.body).boxShadow,
      toast: document.querySelector('.ui-toast .mod-toast')?.textContent ?? '', toastMore: document.querySelector('.ui-toast .mod-toast__more')?.textContent ?? '',
      logs: [...document.querySelectorAll('[data-mod-log] .mv-by__n')].map((n) => n.textContent),
      glyphs: document.querySelectorAll('[data-mod-log] svg.mv-by__g').length
    }));
    check('mods', 'boots on the recording with no console errors', page.errors.length === 0, page.errors);
    check('mods', 'the status line names each mod, in the order they spoke', st.status.join('|') === 'test-runner 1 failing|token-meter 12.4k tokens this turn', st.status);
    check('mods', 'the band shows the mod\'s row (a puzzle glyph and a name), inset', /Tests idle/.test(st.band) && st.bandInset !== 'none', st);
    check('mods', 'the log lines are quiet rows with the mod\'s glyph and name in the margin', st.logs.join() === 'test-runner,token-meter' && st.glyphs === 2, st);

    /* the composer rose 22px: the layout moved by the status line's height and the move was a transform, never a layout animation */
    const top1 = await composerTop(page);
    const rise = await page.evaluate(() => window.__anims.filter((a) => a.frames.some((f) => 'transform' in f) && /ui-composer|ss-mods--band/.test(a.cls || '')));
    const room1 = await dockSpace(page);
    check('mods', 'the status line lifts the composer 22px (the room the dock now keeps is its own)', Math.abs((top0 - top1) - (room1 - room0) - 22) <= 1, { top0, top1, room0, room1 });
    check('mods', 'the rise is a FLIP on transform over --dur-3 (translateY(22px) to 0), with no top, bottom or height', rise.length >= 1 && rise.every((a) => a.frames.every((f) => Object.keys(f).every((k) => k === 'transform' || k === 'offset')) && a.frames[0].transform === 'translateY(22px)' && a.frames[1].transform === 'translateY(0)') && rise[0].duration > 100, rise);

    /* toasts: one at a time, in order, with a quiet "+N" */
    check('mods', 'toasts show one at a time with "+2" while two wait', /1 test failing/.test(st.toast) && st.toastMore === '+2', st);
    await page.waitForTimeout(4600);
    const t2 = await page.evaluate(() => ({ text: document.querySelector('.ui-toast .mod-toast__t')?.textContent, more: document.querySelector('.ui-toast .mod-toast__more')?.textContent ?? '' }));
    check('mods', 'the next toast comes as the first has faded, in order, with "+1"', t2.text === 'Indexed 296 files' && t2.more === '+1', t2);
    await page.click('.ui-toast .mod-toast__x'); await page.waitForTimeout(300);
    const t3 = await page.evaluate(() => ({ text: document.querySelector('.ui-toast .mod-toast__t')?.textContent, more: document.querySelector('.ui-toast .mod-toast__more')?.textContent ?? '', shown: document.querySelector('.ui-toast')?.classList.contains('is-in') }));
    check('mods', 'dismissing a toast shows the next at once, and the last has no count', t3.text === 'Context is at 78%' && t3.more === '' && t3.shown, t3);

    /* the theme card previews live; the dock stays black */
    const pv = await page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(), card: document.querySelector('hx-card[data-mod-theme] .cd-lead')?.textContent, live: document.querySelector('hx-card[data-previewing] .cd-live')?.textContent, dock: getComputedStyle(document.querySelector('#hx-dock .dk-shape path')).fill, saved: localStorage.getItem('hx.v6.theme') }));
    check('mods', 'the theme card asks "Apply name\'s colours?" and the whole app previews them, "Previewing" showing', pv.previewing && pv.brass === '#b8a4f0' && /Apply test-runner.s colours\?/.test(pv.card) && pv.live === 'Previewing', pv);
    check('mods', 'a preview is never saved, and the dock stays pitch black in it', !/b8a4f0/.test(pv.saved ?? '') && pv.dock === 'rgb(0, 0, 0)', pv);

    /* continuous corners: only leaf controls are clipped, never a container of a mod's drawing */
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.mod-band, .mod-row, .mv-root, .mv-box, .mv-code, hx-card[data-mod-theme], .ss-mods')].filter((n) => getComputedStyle(n).clipPath !== 'none').map((n) => n.className));
    check('mods', 'no container of a mod\'s drawing is clipped (only leaf controls are)', clipped.length === 0, clipped);

    /* the details panel: a tab per pane after Details; the tabs follow the keys */
    await page.keyboard.press('Control+i'); await page.waitForTimeout(900);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.mod-tab')].map((n) => n.getAttribute('aria-label')));
    check('mods', 'at 1440 each pane is a tab of the details panel after Details, and none is inline', tabs.join('|') === 'Session details|Tests, test-runner mod|Token usage, token-meter mod' && (await page.evaluate(() => document.querySelectorAll('.mod-inline').length)) === 0, tabs);
    await page.click('#mod-tab-usage'); await page.waitForTimeout(400);
    const chart = await page.evaluate(() => { const f = [...document.querySelectorAll('.mod-pane svg rect')].map((r) => getComputedStyle(r).fill); return { n: f.length, fills: [...new Set(f)] }; });
    check('mods', 'the chart is drawn in theme: claude is the accent as a mark, a literal that holds its contrast is kept', chart.n >= 8 && chart.fills.some((x) => x === 'rgb(184, 164, 240)') && chart.fills.length === 2, chart);

    /* the pane and its handlers: a press, a select and an input go back by id */
    await page.click('#mod-tab-tests'); await page.waitForTimeout(400);
    await page.click('.mod-pane .ui-btn:has-text("Re-run")'); await page.waitForTimeout(700);
    const run = await page.evaluate(() => ({ dots: !!document.querySelector('.ss-mods--band .mv-dots[data-indeterminate]'), runner: document.querySelector('.mod-pane')?.textContent.includes('Running tests'), req: window.__hxReplay.requests.filter((r) => r.method === 'plugin.boopis.mod.press').map((r) => r.params) }));
    check('mods', 'Re-run sends the id of its handler to the mod, and the band and the pane redraw: dots, never a bar', run.req.length === 1 && /^0\.h\d+\.\d+$/.test(run.req[0].handler) && run.req[0].session_id.startsWith('local-') && run.dots && run.runner, run);
    const bar = await page.evaluate(() => document.querySelectorAll('.ss-mods--band [role="progressbar"] :is(progress, meter), .ss-mods--band progress, .ss-mods--band meter').length);
    check('mods', 'progress is dots: no bar element, one dot that travels', bar === 0, bar);
    await page.click('.mod-pane .mv-select'); await page.waitForTimeout(250);
    await page.click('.ui-listbox .ui-option:has-text("Failing only")'); await page.waitForTimeout(500);
    const sel = await page.evaluate(() => window.__hxReplay.requests.filter((r) => r.method === 'plugin.boopis.mod.select').map((r) => r.params.value));
    check('mods', 'a choice in a Select goes back as ui.select with its value', sel.join() === 'failing', sel);

    /* a mod's question: a form with the mod as its origin, in the conversation and in the dock's own queue */
    const waits0 = await page.evaluate(() => __hx.dock().state.waits);
    await page.click('.mod-pane .ui-btn:has-text("Ask which")'); await page.waitForTimeout(1200);
    const ask = await page.evaluate(() => ({
      inline: [...document.querySelectorAll('.ss-col hx-card[data-kind="form"]')].filter((c) => c.querySelector('.cd-by[data-origin="mod"]')).map((c) => c.querySelector('.cd-lead')?.textContent),
      by: document.querySelector('.ss-col hx-card[data-kind="form"] .cd-by[data-origin="mod"]')?.textContent.replace(/\s+/g, ' ').trim(),
      waits: __hx.dock().state.waits, dockCards: [...document.querySelectorAll('#hx-dock hx-card')].filter((c) => c.querySelector('.cd-by[data-origin="mod"], .cd-mini__who')).length
    }));
    check('mods', 'the mod\'s question is a choice form with its glyph and "test-runner mod", in the conversation', ask.inline.includes('Which tests should I re-run?') && /test-runner/.test(ask.by ?? ''), ask);
    check('mods', 'and the dock\'s own model counts it (one more wait), not the DOM', ask.waits === waits0 + 1, { waits0, waits: ask.waits });
    const card = await page.$('.ss-col hx-card[data-kind="form"]:has(.cd-by[data-origin="mod"]) .cd-opt');
    if (card) { await card.click(); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(1600);
    const done = await page.evaluate(() => ({ sub: window.__hxReplay.requests.filter((r) => r.method === 'plugin.boopis.form.submit').map((r) => r.params.values), waits: __hx.dock().state.waits }));
    check('mods', 'answering it sends form.submit through the plugin and the dock drops it', done.sub.length === 1 && done.waits === waits0, done);

    /* Reject, and every way a preview ends */
    await page.evaluate(() => document.querySelector('hx-card[data-mod-theme] [data-action="cancel"]')?.scrollIntoView());
    await page.click('hx-card[data-mod-theme] [data-action="cancel"]'); await page.waitForTimeout(300);
    const rj = await page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(), saved: localStorage.getItem('hx.v6.theme'), text: document.querySelector('hx-card[data-mod-theme]')?.textContent }));
    check('mods', 'Reject restores the previous theme at once and says so', !rj.previewing && rj.brass !== '#b8a4f0' && !/b8a4f0/.test(rj.saved ?? '') && /Rejected\. The theme is back as it was/.test(rj.text), rj);
    check('mods', 'nothing in the run logged a console error', page.errors.length === 0, page.errors);
  });

  await s.safe('mods', async () => {
    const page = await s.fresh({ q: URL, settle: 1500 });
    await send(page);
    /* Keep commits; Esc (Later) restores; opening it again previews it again; another theme chosen ends it without bringing the old one back */
    const card = 'hx-card[data-mod-theme]';
    const st = () => page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(), preset: document.documentElement.dataset.hxPreset }));
    await page.focus(card + ' [data-action="submit"]');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const later = await st();
    check('mods', 'Esc on the card (Later) restores the theme, and the card says it stays as it was', !later.previewing && later.brass !== '#b8a4f0' && /Later\. The theme stays as it was/.test(await text(page, card)), later);
    await page.click(card + ' [data-action="reopen"]'); await page.waitForTimeout(300);
    check('mods', 'opening it again previews it again', (await st()).previewing && (await st()).brass === '#b8a4f0');
    await page.evaluate(() => __hx.theme.preset('graphite')); await page.waitForTimeout(200);
    const other = await st();
    check('mods', 'choosing another theme ends the preview and keeps the one chosen', !other.previewing && other.preset === 'graphite' && other.brass !== '#b8a4f0', other);
    await page.evaluate(() => __hx.theme.preset('catalog'));
    await page.click(card + ' [data-action="submit"]'); await page.waitForTimeout(400);
    const kept = await page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(), saved: localStorage.getItem('hx.v6.theme'), text: document.querySelector('hx-card[data-mod-theme]')?.textContent }));
    check('mods', 'Keep commits the colours and saves them, and says where to undo', !kept.previewing && kept.brass === '#b8a4f0' && /b8a4f0/.test(kept.saved ?? '') && /Kept test-runner.s colours\. Undo in Settings, Appearance/.test(kept.text), kept);
  });

  await s.safe('mods', async () => {
    const page = await s.fresh({ q: URL, settle: 1500 });
    await send(page);
    /* the card leaves the screen: the view is set aside (another tab), and back again */
    await page.keyboard.press('Alt+2'); await page.waitForTimeout(700);
    const away = await page.evaluate(() => ({ previewing: __hx.theme.previewing() }));
    await page.keyboard.press('Alt+1'); await page.waitForTimeout(700);
    const back = await page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim() }));
    check('mods', 'leaving the session\'s tab ends the preview; coming back to a card still open starts it again', !away.previewing && back.previewing && back.brass === '#b8a4f0', { away, back });
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    check('mods', 'a window going away restores the theme', !(await page.evaluate(() => __hx.theme.previewing())));
  });

  await s.safe('mods', async () => {
    /* contrast (owner decision, 19 November 2026): a colour that would make text hard to read is not applied, in the real cascade. A second mod offers
       dark text on the dark frame and quiet text that is dark too, with a light accent; the card says what it skipped and the rest applies. */
    const page = await s.fresh({ q: URL, settle: 1500 });
    await send(page);
    await page.evaluate(() => {
      const sid = window.__hxReplay.frames.find((r) => r.frame.params && r.frame.params.type === 'plugin.boopis.mod.theme').frame.params.session_id;
      window.__hxReplay.emitEvent('plugin.boopis.mod.theme', sid, { action: 'set', plugin: 'low-light', theme: { colors: { '--text': '#1a1a1a', '--text-quiet': '#222222', '--brass': '#c8e0ff', '--bg-2': '#201e31' }, label: 'Low light' } });
    });
    await page.waitForTimeout(500);
    const card = 'hx-card[data-mod-theme="low-light"]';
    await page.evaluate((c) => document.querySelector(c)?.scrollIntoView(), card);
    await page.waitForTimeout(300);
    const css = () => page.evaluate(() => { const g = (t) => document.documentElement.style.getPropertyValue(t); return { previewing: __hx.theme.previewing(), text: g('--text'), quiet: g('--text-quiet'), brass: g('--brass'), ground: g('--bg-2'), say: document.querySelector('hx-card[data-mod-theme="low-light"] .cd-text')?.textContent ?? '', live: document.querySelector('hx-card[data-previewing] .cd-live')?.textContent ?? '', failing: __hx.theme.contrast().filter((c) => c.scope === 'app' && c.min >= 4.5 && !c.pass).map((c) => c.label + ' ' + c.ratio) }; });
    const pv = await css();
    check('mods', 'a colour that would make text hard to read is not applied: the theme\'s own text stays, and the rest applies', pv.previewing && pv.text === '' && pv.quiet === '' && pv.brass === '#c8e0ff' && pv.ground === '#201e31' && pv.live === 'Previewing', pv);
    check('mods', 'the card lists what it skipped, in plain words', /Skipped 2 colours that would make text hard to read: text on surface, quiet text\./.test(pv.say), pv.say);
    check('mods', 'in the real cascade every pair that carries text still holds while it previews', pv.failing.length === 0, pv.failing);
    await page.click(card + ' [data-action="submit"]'); await page.waitForTimeout(400);
    const kept = await page.evaluate((c) => ({ saved: JSON.parse(localStorage.getItem('hx.v6.theme') ?? '{}').colors ?? {}, text: document.querySelector(c)?.textContent ?? '', failing: __hx.theme.contrast().filter((x) => x.scope === 'app' && x.min >= 4.5 && !x.pass).length }), card);
    check('mods', 'Keep stores only what was applied, and says what was left out', JSON.stringify(Object.keys(kept.saved).sort()) === JSON.stringify(['--bg-2', '--brass']) && /Kept low-light.s colours, without 2 that would make text hard to read\. Undo in Settings, Appearance/.test(kept.text) && kept.failing === 0, kept);
  });

  await s.safe('mods', async () => {
    /* Reject, Esc and another theme restore a theme that had skipped colours just as they restore any other */
    const page = await s.fresh({ q: URL, settle: 1500 });
    await send(page);
    await page.evaluate(() => {
      const sid = window.__hxReplay.frames.find((r) => r.frame.params && r.frame.params.type === 'plugin.boopis.mod.theme').frame.params.session_id;
      window.__hxReplay.emitEvent('plugin.boopis.mod.theme', sid, { action: 'set', plugin: 'low-light', theme: { colors: { '--text': '#1a1a1a', '--brass': '#c8e0ff' } } });
    });
    await page.waitForTimeout(500);
    const card = 'hx-card[data-mod-theme="low-light"]';
    await page.evaluate((c) => document.querySelector(c)?.scrollIntoView(), card);
    await page.click(card + ' [data-action="cancel"]'); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: document.documentElement.style.getPropertyValue('--brass'), saved: localStorage.getItem('hx.v6.theme') ?? '' }));
    check('mods', 'Reject restores the theme at once after a preview that skipped a colour, and nothing was saved', !r.previewing && r.brass !== '#c8e0ff' && !/c8e0ff|1a1a1a/.test(r.saved), r);
  });

  await s.safe('mods', async () => {
    /* below 1200px a pane is inline above the composer: one open, the rest folded to a head */
    for (const w of [1199, 1000, 390]) {
      const page = await s.fresh({ q: URL, w, h: 800, settle: 1500 });
      await send(page);
      const r = await page.evaluate(() => ({ tabs: document.querySelectorAll('.mod-tab').length, inline: [...document.querySelectorAll('.ss-mods--band .mod-inline')].map((n) => n.dataset.open), over: document.documentElement.scrollWidth > innerWidth }));
      check('mods', `at ${w} the panes are inline above the composer, one open and the other folded`, r.tabs === 0 && r.inline.join() === 'false,true' && !r.over, r);
    }
    const page = await s.fresh({ q: URL, w: 1000, h: 800, settle: 1500 });
    await send(page);
    await page.click('.mod-inline[data-open="false"] .mod-chev'); await page.waitForTimeout(400);
    const swap = await page.evaluate(() => [...document.querySelectorAll('.mod-inline')].map((n) => n.dataset.open).join());
    check('mods', 'unfolding one folds the other, so the composer keeps the screen', swap === 'true,false', swap);
    await page.setViewportSize({ width: 1300, height: 800 }); await page.waitForTimeout(500);
    check('mods', 'crossing 1200px takes the panes out of the composer and into the details panel', (await page.evaluate(() => document.querySelectorAll('.mod-inline').length)) === 0);
  });

  await s.safe('mods', async () => {
    /* reduced motion reduces and never freezes: no travel, a short crossfade */
    const page = await s.fresh({ q: URL, reduced: true, settle: 1500 });
    await send(page);
    const a = await page.evaluate(() => ({ travel: window.__anims.filter((x) => x.frames.some((f) => 'transform' in f) && /ui-composer|ss-mods--band/.test(x.cls || '')).length, fade: window.__anims.filter((x) => x.duration === 120 && x.frames.some((f) => 'opacity' in f)).length, ghost: window.__anims.some((x) => /mod-ghost/.test(x.cls || '')) }));
    check('mods', 'under reduced motion the composer does not travel: a ghost crossfades over 120ms', a.travel === 0 && a.fade >= 2 && a.ghost, a);
  });

  await s.safe('mods', async () => {
    const page = await s.fresh({ q: URL, settle: 1500 });
    await send(page);
    await page.keyboard.press('Control+i'); await page.waitForTimeout(900);
    await page.click('#mod-tab-tests'); await page.waitForTimeout(500);
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const res = await axe.run({ include: [['.ss-view'], ['#hx-right'], ['#hx-dock']] }, { resultTypes: ['violations'], preload: false, rules: { region: { enabled: false } } }); return res.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0] ? ' - ' + n.any[0].message.slice(0, 90) : '')) })); });
    check('mods', 'axe (the conversation, the details panel and the dock): the session with the band, the status line, the pane, the toast, a placed row and the theme card', v.length === 0, v);
  });
  await s.close();
}
