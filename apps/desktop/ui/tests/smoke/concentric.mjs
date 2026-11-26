/* Concentric corners and overlay placement in the real cascade (DESIGN-SYSTEM.md §8.2, §14.10, §14.23; rules R-corner-3,
   R-corner-4, R-corner-5, R-float-1, R-tip-2; findings F39, F40): every composer (the session's, the Bots tab's, the one in a
   bot's card in the dock) is the kit's one-row Composer, and holds its controls inside its box, the two at its ends equally
   inset from the edges of their corner (within 1px) and concentric with it (inset + radius = the box's radius: one centre),
   empty, typed, hovered, focused (the ring inside the box too) and pressed; and such a control's tooltip sits outside it,
   centred on it, inside the window, and never over the text. */
import { check } from './harness.mjs';

const CASES = [['dark', '', 1], ['light', 'preset=bone', 2], ['dark 1.6', '', 1.6]];

/* every number the checks need, read in the page: the box (the kit Composer's one row), its controls, the tip.
   The corner controls are the first and the last of the row: "+" at the start, the primary circle at the end */
const MEASURE = (sel) => {
  const root = document.querySelector(sel); if (!root) return null;
  const boxEl = root.querySelector('.k7-composer__box'); if (!boxEl) return null;
  const b = boxEl.getBoundingClientRect(), cs = getComputedStyle(boxEl);
  const px = (v) => parseFloat(v) || 0;
  const els = [...boxEl.querySelectorAll('[data-plus], [data-stop], [data-mic], [data-send]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const ctl = els.map((e, i) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e), focused = e.matches(':focus-visible');
    const ring = focused && s.outlineStyle !== 'none' ? px(s.outlineOffset) + px(s.outlineWidth) : 0;
    const name = e.hasAttribute('data-plus') ? 'plus' : e.hasAttribute('data-stop') ? 'stop' : e.hasAttribute('data-mic') ? 'mic' : 'primary';
    return { name, corner: i === 0 || i === els.length - 1, l: r.left - b.left, r: b.right - r.right, t: r.top - b.top, b: b.bottom - r.bottom, w: r.width, h: r.height, rad: Math.min(px(s.borderTopLeftRadius), r.height / 2), ring, focused };
  });
  const tipEl = document.querySelector('.ui-tip.is-in'), tr = tipEl && tipEl.getBoundingClientRect();
  const keep = [...root.querySelectorAll('.k7-composer__text')].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
  return {
    box: { l: b.left, t: b.top, r: b.right, b: b.bottom, h: b.height, rad: Math.min(px(cs.borderTopLeftRadius) || b.height / 2, b.height / 2) },
    ctl, tip: tr ? { l: tr.left, t: tr.top, r: tr.right, b: tr.bottom } : null, keep: keep.map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })), W: innerWidth, H: innerHeight
  };
};

/** the corner checks on one measure; returns the failures (empty when every rule holds) */
function cornerFaults(m, state) {
  const out = [];
  if (!m) return ['no composer'];
  const { box } = m, near = (a, b) => Math.abs(a - b) <= 1;
  for (const c of m.ctl) {
    const name = c.name + ' ' + state;
    const ring = Math.max(0, c.ring);
    if (Math.min(c.l, c.r, c.t, c.b) - ring < 1 - 0.01) out.push(name + ': crosses or touches the border ' + JSON.stringify(c));
    if (!c.corner) continue;
    const side = c.l < c.r ? c.l : c.r;
    if (state !== 'pressed' && !(near(side, c.b) && near(side, c.t))) out.push(name + ': not equally inset (side ' + side + ', top ' + c.t + ', bottom ' + c.b + ')');
    if (!near(side + c.rad, box.rad)) out.push(name + ': not concentric (radius ' + c.rad + ', inset ' + side + ', box ' + box.rad + ')');
  }
  const corners = m.ctl.filter((c) => c.corner);
  if (corners.length >= 2 && state !== 'pressed' && !near(corners[0].b, corners[corners.length - 1].b)) out.push('corner controls not equally inset ' + state);
  return out;
}
function tipFaults(m, anchor, align) {
  if (!m || !m.tip) return ['no tooltip'];
  const t = m.tip, out = [], hit = (a, b) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
  for (const k of m.keep) if (hit(t, k)) out.push('covers the text ' + JSON.stringify({ t, k }));
  if (hit(t, anchor)) out.push('covers its control');
  if (t.l < 7.5 || t.t < 7.5 || t.r > m.W - 7.5 || t.b > m.H - 7.5) out.push('leaves the window');
  /* R-float-3: a tooltip is centred on its anchor, unless the window's margin moves it */
  if (Math.abs((t.l + t.r) / 2 - (anchor.l + anchor.r) / 2) > 1 && t.l > 8.5 && t.r < m.W - 8.5) out.push('not centred on the control: tip ' + (t.l + t.r) / 2 + ' vs control ' + (anchor.l + anchor.r) / 2);
  return out;
}

export async function concentric(env) {
  for (const [scheme, q, dsf] of CASES) {
    const ctx = await env.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    const go = async () => { await page.goto(env.srv.origin + '/index.html' + (q ? '?' + q : '')); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900); };
    const measure = (sel) => page.evaluate(MEASURE, sel);
    const rectOf = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
    const keyFocus = async (sel) => { await page.mouse.move(2, 2); await page.keyboard.press('Shift'); await page.evaluate((s) => document.querySelector(s).focus(), sel); await page.waitForTimeout(250); };
    try {
      await go();
      /* the session's composer, the Bots tab's, then the one in a bot's card in the dock: empty, typed, hover, focus, pressed, and the tips */
      for (const [label, sel, to] of [['session', '.ss-composer', null], ['bots', '#hx-view-bots .bt-composer-zone', async () => { await page.keyboard.press('Alt+2'); await page.waitForTimeout(700); }],
        ['dock card', '#hx-dock .k7-dock__panel', async () => { await page.keyboard.press('Alt+1'); await page.waitForTimeout(500); await page.keyboard.press('Control+g'); await page.waitForTimeout(100); await page.keyboard.press('d'); await page.waitForTimeout(400); await page.keyboard.press('Space'); await page.waitForTimeout(1200); }]]) {
        if (to) await to();
        const root = sel + ' [data-kit~="Composer"]', text = root + ' .k7-composer__text';
        const faults = [];
        if (!(await page.$(text))) { check('corners', `${label} composer (${scheme}, @${dsf})`, false, 'no kit Composer at ' + root); continue; }
        await page.click(text); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.mouse.move(2, 2); await page.waitForTimeout(300);
        faults.push(...cornerFaults(await measure(root), 'empty'));
        await page.click(text); await page.keyboard.type('testing. does this work?'); await page.mouse.move(2, 2); await page.waitForTimeout(400);
        faults.push(...cornerFaults(await measure(root), 'typed'));
        for (const [ctl, align] of [['[data-plus]', 'start'], ['[data-send]', 'end']]) {
          const c = root + ' ' + ctl;
          if (!(await page.$(c))) continue;
          await page.hover(c); await page.waitForTimeout(700);
          const mh = await measure(root);
          faults.push(...cornerFaults(mh, 'hover ' + ctl));
          faults.push(...tipFaults(mh, await rectOf(c), align).map((f) => 'tip of ' + ctl + ' on hover: ' + f));
          await keyFocus(c);
          const mf = await measure(root);
          if (!mf.ctl.some((x) => x.focused)) faults.push(ctl + ' did not take keyboard focus');
          faults.push(...cornerFaults(mf, 'focus ' + ctl));
          faults.push(...tipFaults(mf, await rectOf(c), align).map((f) => 'tip of ' + ctl + ' on focus: ' + f));
        }
        if (await page.$(root + ' [data-mic]')) {
          await page.hover(root + ' [data-mic]'); await page.mouse.down(); await page.waitForTimeout(120);
          faults.push(...cornerFaults(await measure(root), 'pressed'));
          await page.mouse.up(); await page.waitForTimeout(250); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        }
        check('corners', `${label} composer (${scheme}, @${dsf}): R-corner-3/4 its end controls concentric and equally inset in every state; R-float-1/R-tip-2 tips outside, centred, off the text`, faults.length === 0, faults.slice(0, 6));
      }
    } catch (e) { check('corners', `concentric (${scheme}): script`, false, String(e.message).split('\n')[0]); }
    await ctx.close();
  }
}
