/* Concentric corners and overlay placement in the real cascade (DESIGN-SYSTEM.md §8.2, §14.10, §14.23): every composer
   (the session's, the Bots tab's, the dock session's) holds its corner controls inside its box, equally inset from both
   edges of their corner (within 1px), with the radius the container's rule derives (inset + radius = the box's radius:
   one centre), at rest, hovered, focused (the ring inside the box too), pressed and disabled; and a corner control's
   tooltip sits outside it, aligned to it, inside the window, and never over the text or the assumptions. */
import { check } from './harness.mjs';

const CASES = [['dark', '', 1], ['light', 'preset=bone', 2], ['dark 1.6', '', 1.6]];

/* every number the checks need, read in the page: the box, its corner controls, the derived tokens, the tip */
const MEASURE = (sel) => {
  const root = document.querySelector(sel); if (!root) return null;
  const boxEl = root.querySelector('.ui-composer__box'), b = boxEl.getBoundingClientRect(), cs = getComputedStyle(boxEl);
  const px = (v) => parseFloat(v) || 0;
  /* the derived tokens are unresolved calc() text on the custom property: resolve them on a probe inside the box */
  const probe = document.createElement('i'); probe.style.cssText = 'position:absolute;visibility:hidden;padding-left:var(--corner-inset);padding-right:var(--r-corner)';
  boxEl.append(probe); const ps = getComputedStyle(probe), inset = px(ps.paddingLeft), rc = px(ps.paddingRight); probe.remove();
  const ctl = [...root.querySelectorAll('.ui-composer__box .ui-corner, .ui-composer__mic')].filter((e) => e.getClientRects().length).map((e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e), focused = e.matches(':focus-visible');
    const ring = focused && s.outlineStyle !== 'none' ? px(s.outlineOffset) + px(s.outlineWidth) : 0;
    return { cls: e.className, corner: e.classList.contains('ui-corner'), l: r.left - b.left, r: b.right - r.right, t: r.top - b.top, b: b.bottom - r.bottom, w: r.width, h: r.height, rad: px(s.borderTopLeftRadius), ring, focused };
  });
  const tipEl = document.querySelector('.ui-tip.is-in'), tr = tipEl && tipEl.getBoundingClientRect();
  const keep = [...root.querySelectorAll('.ui-composer__input, .ui-composer[data-hinting] .ui-composer__hint, [data-hinting] > .ui-composer__hint')].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
  return {
    box: { l: b.left, t: b.top, r: b.right, b: b.bottom, rad: px(cs.borderTopLeftRadius), inset, rc },
    ctl, tip: tr ? { l: tr.left, t: tr.top, r: tr.right, b: tr.bottom } : null, keep: keep.map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })), W: innerWidth, H: innerHeight
  };
};

/** the corner checks on one measure; returns the failures (empty when every rule holds) */
function cornerFaults(m, state) {
  const out = [];
  if (!m) return ['no composer'];
  const { box } = m, near = (a, b) => Math.abs(a - b) <= 1;
  for (const c of m.ctl) {
    const name = c.cls.split(' ').find((x) => /ui-composer__|ui-send/.test(x)) + ' ' + state;
    const ring = Math.max(0, c.ring);
    if (Math.min(c.l, c.r, c.t, c.b) - ring < 1 - 0.01) out.push(name + ': crosses or touches the border ' + JSON.stringify(c));
    if (!c.corner) continue;
    const side = c.l < c.r ? c.l : c.r;
    if (state !== 'pressed' && !near(side, c.b)) out.push(name + ': not equally inset (side ' + side + ', bottom ' + c.b + ')');
    if (state !== 'pressed' && !near(c.b, box.inset)) out.push(name + ': inset ' + c.b + ' is not the derived ' + box.inset);
    if (!near(c.rad, box.rc) || !near(box.inset + Math.min(c.rad, c.h / 2), box.rad)) out.push(name + ': not concentric (radius ' + c.rad + ', inset ' + box.inset + ', box ' + box.rad + ')');
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
  if (align === 'start' && Math.abs(t.l - anchor.l) > 1 && t.l > 8.5) out.push('not aligned to the control\'s left ' + t.l + ' vs ' + anchor.l);
  if (align === 'end' && Math.abs(t.r - anchor.r) > 1 && t.r < m.W - 8.5) out.push('not aligned to the control\'s right ' + t.r + ' vs ' + anchor.r);
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
      /* the session's composer, then the Bots tab's: rest, disabled, hover, focus, pressed, and the tips */
      for (const [label, sel, tab] of [['session', '.ss-composer', null], ['bots', '.bt-composer-zone', 'Alt+2']]) {
        if (tab) { await page.keyboard.press(tab); await page.waitForTimeout(700); }
        const root = sel + ' [data-hx-composer]';
        const faults = [];
        await page.click(root + ' .ui-composer__input'); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.mouse.move(2, 2); await page.waitForTimeout(300);
        faults.push(...cornerFaults(await measure(root), 'disabled'));
        await page.click(root + ' .ui-composer__input'); await page.keyboard.type('testing. does this work?'); await page.mouse.move(2, 2); await page.waitForTimeout(400);
        faults.push(...cornerFaults(await measure(root), 'rest'));
        for (const [ctl, align] of [['.ui-composer__attach', 'start'], ['.ui-send', 'end']]) {
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
        if (await page.$(root + ' .ui-composer__attach')) {
          await page.hover(root + ' .ui-composer__attach'); await page.mouse.down(); await page.waitForTimeout(120);
          faults.push(...cornerFaults(await measure(root), 'pressed'));
          await page.mouse.up(); await page.waitForTimeout(250); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        }
        check('corners', `${label} composer (${scheme}, @${dsf}): corner controls concentric and equally inset in every state, tips outside, aligned, off the text`, faults.length === 0, faults.slice(0, 6));
      }
      /* the dock session's composer (compact: the actions in the bottom-right corner, 6px from both edges) */
      await go();
      await page.keyboard.press('Control+g'); await page.waitForTimeout(100); await page.keyboard.press('d'); await page.waitForTimeout(400); await page.keyboard.press('Space'); await page.waitForTimeout(1200);
      const dsel = '#hx-dock [data-hx-composer]', faults = [];
      if (!(await page.$(dsel))) faults.push('the dock session did not open');
      else {
        await page.click(dsel + ' .ui-composer__input'); await page.keyboard.type('ok'); await page.mouse.move(2, 2); await page.waitForTimeout(300);
        faults.push(...cornerFaults(await measure(dsel), 'rest'));
        await page.hover(dsel + ' .ui-send'); await page.waitForTimeout(700);
        const mh = await measure(dsel);
        faults.push(...cornerFaults(mh, 'hover'), ...tipFaults(mh, await rectOf(dsel + ' .ui-send'), 'end').map((f) => 'tip: ' + f));
        await keyFocus(dsel + ' .ui-send');
        faults.push(...cornerFaults(await measure(dsel), 'focus'));
      }
      check('corners', `dock session composer (${scheme}, @${dsf}): the actions concentric in the corner, the tip aligned and off the text`, faults.length === 0, faults.slice(0, 6));
    } catch (e) { check('corners', `concentric (${scheme}): script`, false, String(e.message).split('\n')[0]); }
    await ctx.close();
  }
}
