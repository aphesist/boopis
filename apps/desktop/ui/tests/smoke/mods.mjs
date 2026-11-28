/* Mods, on the live provider over a recording of real mod events (plugins/boopis/tests/test_mods_frames.py: two mods in the real
   hx worker, their events captured as the plugin emitted them and spliced into a recorded session). Checks the places of 2b (the
   lead's decisions for conflict 32) in a real engine: the band in the held or queued strip's slot (the kit's Queue), a mod's status on
   the composer's own line with nothing rising, panes as tabs of the tools after their fixed tabs at every width, tick progress in the
   band, one notice at a time with "+N", the theme card with its live preview and every way the preview ends, a mod's question in the
   conversation, and the refusals. */
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
const composerTop = (page) => page.evaluate(() => document.querySelector('.ss-composer .ss-composer__slot').getBoundingClientRect().top);
/** the room the shell keeps for the dock: none until a session has started (this recording has no bots, and the dock only rises with the first message) */
const dockSpace = (page) => page.evaluate(() => parseFloat(document.getElementById('hx-app').style.getPropertyValue('--hx-dock-space-to')) || 0);

export async function mods(env, AXE) {
  const s = scenario(env);

  await s.safe('mods', async () => {
    const page = await s.fresh({ q: URL, settle: 1500 });
    const top0 = await composerTop(page), room0 = await dockSpace(page);
    await send(page);
    const st = await page.evaluate(() => ({
      status: [...document.querySelectorAll('.ss-composer .k7-composer__line [data-mod-status]')].map((n) => n.textContent),
      band: document.querySelector('.ss-strip [data-kit~="Queue"][data-variant="mod"] [data-kit-part~="QueueRow"]')?.textContent ?? '',
      bandGlyph: !!document.querySelector('.ss-strip .k7-queue__who svg'),
      notice: document.querySelector('.k7-notify .k7-notice__text')?.textContent ?? '', noticeWho: document.querySelector('.k7-notify .k7-notice__title')?.textContent ?? '', noticeMore: document.querySelector('.k7-notify .k7-notice__more')?.textContent ?? '',
      logs: [...document.querySelectorAll('[data-mod-log][data-kit~="SystemLine"] [data-kit~="StatusWord"]')].map((n) => n.textContent),
      glyphs: document.querySelectorAll('[data-mod-log] > svg').length
    }));
    check('mods', 'boots on the recording with no console errors', page.errors.length === 0, page.errors);
    check('mods', 'each mod\'s status joins the composer\'s own line, in the order they spoke', st.status.join('|') === 'test-runner 1 failing|token-meter 12.4k tokens this turn', st.status);
    check('mods', 'the band is the kit\'s Queue in the strip\'s slot: the mod\'s row (its glyph and name)', /Tests idle/.test(st.band) && st.bandGlyph, st);
    check('mods', 'the log lines are the kit\'s SystemLine, the mod\'s glyph and name leading', st.logs.join() === 'test-runner,token-meter' && st.glyphs === 2, st);

    /* nothing rises (2b): the composer's line holds the status, so the composer stays where it was but for the room the dock now keeps */
    const top1 = await composerTop(page);
    const rise = await page.evaluate(() => window.__anims.filter((a) => a.frames.some((f) => 'transform' in f) && /k7-composer|ss-composer__slot/.test(a.cls || '')));
    const room1 = await dockSpace(page);
    check('mods', 'a status lifts nothing: the composer moves only by the room the dock keeps, and nothing travels', Math.abs((top0 - top1) - (room1 - room0)) <= 1 && rise.length === 0, { top0, top1, room0, room1, rise });

    /* notices (the kit's floating Notice): one at a time, in order, led by the mod, with a quiet "+N" */
    check('mods', 'notices show one at a time, led by "name mod", with "+2" while two wait', /1 test failing/.test(st.notice) && /mod$/.test(st.noticeWho) && st.noticeMore === '+2', st);
    await page.waitForTimeout(4600);
    const t2 = await page.evaluate(() => ({ text: (() => { const n = document.querySelector('.k7-notify .k7-notice__text'); const w = n?.querySelector('.k7-notice__title')?.textContent ?? ''; return (n?.textContent ?? '').slice(w.length).trim(); })(), more: document.querySelector('.k7-notify .k7-notice__more')?.textContent ?? '' }));
    check('mods', 'the next notice comes as the first has faded, in order, with "+1"', t2.text === 'Indexed 296 files' && t2.more === '+1', t2);
    await page.click('.k7-notify [data-dismiss]'); await page.waitForTimeout(300);
    const t3 = await page.evaluate(() => ({ text: (() => { const n = document.querySelector('.k7-notify .k7-notice__text'); const w = n?.querySelector('.k7-notice__title')?.textContent ?? ''; return (n?.textContent ?? '').slice(w.length).trim(); })(), more: document.querySelector('.k7-notify .k7-notice__more')?.textContent ?? '', shown: !!document.querySelector('.k7-notify[data-in]') }));
    check('mods', 'dismissing a notice shows the next at once, and the last has no count', t3.text === 'Context is at 78%' && t3.more === '' && t3.shown, t3);

    /* the theme card previews live; the dock stays black */
    const pv = await page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(), card: document.querySelector('hx-card[data-mod-theme] .k7-ask__ask')?.textContent, live: document.querySelector('hx-card[data-previewing] .k7-ask__head .k7-word')?.textContent, dock: getComputedStyle(document.querySelector('#hx-dock .k7-dock__slab path')).fill, saved: localStorage.getItem('hx.v6.theme') }));
    check('mods', 'the theme card asks "Apply name\'s colours?" and the whole app previews them, "Previewing" showing', pv.previewing && pv.brass === '#b8a4f0' && /Apply test-runner.s colours\?/.test(pv.card) && pv.live === 'previewing', pv);
    check('mods', 'a preview is never saved, and the dock stays pitch black in it', !/b8a4f0/.test(pv.saved ?? '') && pv.dock === 'rgb(0, 0, 0)', pv);

    /* continuous corners: only leaf controls are clipped, never a container of a mod's drawing */
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.ss-strip, .ss-strip [data-kit~="Queue"], .k7-mv, .k7-mv__box, hx-card[data-mod-theme]')].filter((n) => getComputedStyle(n).clipPath !== 'none').map((n) => n.className));
    check('mods', 'no container of a mod\'s drawing is clipped (only leaf controls are)', clipped.length === 0, clipped);

    /* the tools: a tab per pane after their fixed tabs (here the Diff); the details have none */
    await page.keyboard.press('Control+i'); await page.waitForTimeout(900);
    const inDetails = await page.evaluate(() => document.querySelectorAll('#hx-right .k7-pane__tabs [role="tab"]').length);
    await page.evaluate(() => __hx.emit('hx:open-panel', { panel: 'changes', from: 'smoke' })); await page.waitForTimeout(900);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#hx-right .k7-pane__tabs [role="tab"]')].map((n) => n.textContent + (n.dataset.tip ? ', ' + n.dataset.tip : '')));
    check('mods', 'each pane is a tab of the tools after the Diff, and the details have no strip', tabs.join('|') === 'Diff|Tests|Token usage' && inDetails === 0, { tabs, inDetails });
    await page.click('#hx-right .k7-pane__tabs [data-value="usage"]'); await page.waitForTimeout(400);
    const chart = await page.evaluate(() => { const f = [...document.querySelectorAll('.ss-mod-pane svg rect')].map((r) => getComputedStyle(r).fill); return { n: f.length, fills: [...new Set(f)] }; });
    check('mods', 'the chart is drawn in theme: claude is the accent as a mark, a literal that holds its contrast is kept', chart.n >= 8 && chart.fills.some((x) => x === 'rgb(184, 164, 240)') && chart.fills.length === 2, chart);

    /* the pane and its handlers: a press, a select and an input go back by id */
    await page.click('#hx-right .k7-pane__tabs [data-value="tests"]'); await page.waitForTimeout(400);
    await page.click('.ss-mod-pane [data-kit~="Button"]:has-text("Re-run")'); await page.waitForTimeout(700);
    const run = await page.evaluate(() => ({ dots: !!document.querySelector('.ss-strip [data-kit-part~="ModProgress"][data-indeterminate]'), runner: document.querySelector('.ss-mod-pane')?.textContent.includes('Running tests'), req: window.__hxReplay.requests.filter((r) => r.method === 'plugin.boopis.mod.press').map((r) => r.params) }));
    check('mods', 'Re-run sends the id of its handler to the mod, and the band and the pane redraw: ticks, never a bar', run.req.length === 1 && /^0\.h\d+\.\d+$/.test(run.req[0].handler) && run.req[0].session_id.startsWith('local-') && run.dots && run.runner, run);
    const bar = await page.evaluate(() => document.querySelectorAll('.ss-strip progress, .ss-strip meter').length);
    check('mods', 'progress is ticks: no bar element, one tick that travels', bar === 0, bar);
    await page.click('.ss-mod-pane [data-kit~="SelectorItem"]'); await page.waitForTimeout(250);
    await page.click('.k7-menu[data-floating] [data-kit~="MenuRow"]:has-text("Failing only")'); await page.waitForTimeout(500);
    const sel = await page.evaluate(() => window.__hxReplay.requests.filter((r) => r.method === 'plugin.boopis.mod.select').map((r) => r.params.value));
    check('mods', 'a choice in a Select goes back as ui.select with its value', sel.join() === 'failing', sel);

    /* a mod's question: a form with the mod as its origin, in the conversation and among what waits on you (the v7 dock carries your bots' approvals only) */
    const waits0 = await page.evaluate(() => __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length);
    await page.click('.ss-mod-pane [data-kit~="Button"]:has-text("Ask which")'); await page.waitForTimeout(1200);
    const ask = await page.evaluate(() => ({
      inline: [...document.querySelectorAll('.ss-col hx-card[data-kind="form"]')].filter((c) => c.querySelector('[data-kit~="AskCard"][data-origin="mod"]')).map((c) => c.querySelector('.k7-ask__ask')?.textContent),
      by: document.querySelector('.ss-col hx-card[data-kind="form"] [data-kit~="AskCard"][data-origin="mod"] .k7-ask__who')?.textContent.replace(/\s+/g, ' ').trim(),
      glyph: !!document.querySelector('.ss-col hx-card[data-kind="form"] [data-kit~="AskCard"][data-origin="mod"] .k7-ask__head > .k7-ic'),
      waits: __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length, dockCards: [...document.querySelectorAll('#hx-dock hx-card')].filter((c) => c.querySelector('[data-origin="mod"]')).length
    }));
    check('mods', 'the mod\'s question is a choice form with its glyph and "test-runner mod", in the conversation', ask.inline.includes('Which tests should I re-run?') && /test-runner mod asks/.test(ask.by ?? '') && ask.glyph, ask);
    check('mods', 'and it waits on you (one more wait in the provider\'s own count, not the DOM)', ask.waits === waits0 + 1, { waits0, waits: ask.waits });
    const card = await page.$('.ss-col hx-card[data-kind="form"]:has([data-origin="mod"]) :is(.k7-orow, .k7-seg__item, .k7-ask__choice, .k7-ask__answers .k7-chip:not([data-action]))');
    if (card) { await card.click(); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(1600);
    const done = await page.evaluate(() => ({ sub: window.__hxReplay.requests.filter((r) => r.method === 'plugin.boopis.form.submit').map((r) => r.params.values), waits: __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length }));
    check('mods', 'answering it sends form.submit through the plugin and it waits no more', done.sub.length === 1 && done.waits === waits0, done);

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
    /* Keep commits; Later restores (Esc is Reject's key since 6d); opening it again previews it again; another theme chosen ends it without bringing the old one back */
    const card = 'hx-card[data-mod-theme]';
    const st = () => page.evaluate(() => ({ previewing: __hx.theme.previewing(), brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(), preset: document.documentElement.dataset.hxPreset }));
    await page.click(card + ' [data-action="defer"]'); await page.waitForTimeout(300);
    const later = await st();
    check('mods', 'Later on the card restores the theme, and the card says it stays as it was', !later.previewing && later.brass !== '#b8a4f0' && /Later\. The theme stays as it was/.test(await text(page, card)), later);
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
    const css = () => page.evaluate(() => { const g = (t) => document.documentElement.style.getPropertyValue(t); return { previewing: __hx.theme.previewing(), text: g('--text'), quiet: g('--text-quiet'), brass: g('--brass'), ground: g('--bg-2'), say: document.querySelector('hx-card[data-mod-theme="low-light"] .k7-ask__sub')?.textContent ?? '', live: document.querySelector('hx-card[data-previewing] .k7-ask__head .k7-word')?.textContent ?? '', failing: __hx.theme.contrast().filter((c) => c.scope === 'app' && c.min >= 4.5 && !c.pass).map((c) => c.label + ' ' + c.ratio) }; });
    const pv = await css();
    check('mods', 'a colour that would make text hard to read is not applied: the theme\'s own text stays, and the rest applies', pv.previewing && pv.text === '' && pv.quiet === '' && pv.brass === '#c8e0ff' && pv.ground === '#201e31' && pv.live === 'previewing', pv);
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
    /* at every width a pane is a tab of the tools (2b): nothing is drawn over the composer but the band, and nothing runs off the window */
    for (const w of [1199, 1000, 390]) {
      const page = await s.fresh({ q: URL, w, h: 800, settle: 1500 });
      await send(page);
      await page.evaluate(() => __hx.emit('hx:open-panel', { panel: 'changes', from: 'smoke' })); await page.waitForTimeout(900);
      const r = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('#hx-right .k7-pane__tabs [role="tab"]')].map((n) => n.textContent), band: document.querySelectorAll('.ss-strip [data-kit-part~="QueueRow"]').length, over: document.documentElement.scrollWidth > innerWidth }));
      check('mods', `at ${w} the panes are tabs of the tools, and the band is the one row over the composer`, r.tabs.join('|') === 'Diff|Tests|Token usage' && r.band === 1 && !r.over, r);
    }
  });

  await s.safe('mods', async () => {
    const page = await s.fresh({ q: URL, settle: 1500 });
    await send(page);
    await page.evaluate(() => __hx.emit('hx:open-panel', { panel: 'changes', from: 'smoke' })); await page.waitForTimeout(900);
    await page.click('#hx-right .k7-pane__tabs [data-value="tests"]'); await page.waitForTimeout(500);
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const res = await axe.run({ include: [['.ss-view'], ['#hx-right'], ['#hx-dock']] }, { resultTypes: ['violations'], preload: false, rules: { region: { enabled: false } } }); return res.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0] ? ' - ' + n.any[0].message.slice(0, 90) : '')) })); });
    check('mods', 'axe (the conversation, the tools and the dock): the session with the band, the status on the line, the pane, the notice, a log line and the theme card', v.length === 0, v);
  });
  await s.close();
}
