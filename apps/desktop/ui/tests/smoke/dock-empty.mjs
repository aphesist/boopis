/* The dock with no bots, and the row's own geometry. It used to be a lone "+" in a tall black tombstone (owner, Linux), then a
   session part with no roster; the v7 dock (DESIGN-SYSTEM.md v7 21.4, board K06) settles it: with no bot of your own there is
   NO dock in the Sessions tab, and the composer keeps no room for it. This part says what there is instead:
   - a first install (`?fixture=fresh`) and a workspace with sessions and no bots (`?fixture=none`) show no dock at all: not
     drawn, inert, out of the accessibility tree, below the window's edge, and "Show the dock" is still on;
   - with bots the slab keeps the geometry the tombstone broke: 72 tall, flush to the window's edge, as wide as its content (at
     most 640), a flat top between its two corners, and everything in the row inside the slab's body, 30 from its sides (nothing
     in a corner zone); there is no "+" in it (new bots are made in the Bots tab).
   Geometry assertions, plus a screenshot in test-results/. */
import { join } from 'node:path';
import { check, scenario } from './harness.mjs';
import { OUT } from '../lib.mjs';

const STATE = () => {
  const d = document.querySelector('#hx-dock .dk'), k = d.querySelector('.k7-dock'), cs = getComputedStyle(d), r = k.getBoundingClientRect();
  const box = document.querySelector('.ss-composer .k7-composer__box');
  return {
    shown: __hx.dock().state.shown, in: d.hasAttribute('data-in'), vis: cs.visibility, inert: d.inert, aria: d.getAttribute('aria-hidden'), top: r.top, innerH: innerHeight,
    setting: __hx.state.dock, stored: (() => { try { return /"dock"\s*:\s*"off"/.test(localStorage.getItem('hx.v6.shell') || '') ? 'off' : 'not off'; } catch { return null; } })(),
    room: parseFloat(document.getElementById('hx-app').style.getPropertyValue('--hx-dock-space-to')) || 0, gap: box ? Math.round(innerHeight - box.getBoundingClientRect().bottom) : null,
    focusable: d.querySelectorAll('button:not([tabindex="-1"])').length && !d.inert
  };
};
const MEASURE = () => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const root = document.querySelector('#hx-dock .dk'), k = root.querySelector('.k7-dock'), svg = k.querySelector('.k7-dock__slab');
  const live = (sel) => [...root.querySelectorAll(sel)].filter((e) => !e.closest('[hidden], [data-out]') && e.getClientRects().length > 0);
  const items = live('.k7-dock__row > *').map((e) => ({ cls: e.className.toString().replace('k7-reset ', '').slice(0, 20), ...r(e) }));
  return { body: r(k), svg: r(svg), d: svg.querySelector('path').getAttribute('d'), items, orbs: live('.k7-dock__orb').length, add: live('[aria-label*="New bot"], .dk-add, [data-act="add"]').length, geom: k.dataset.geom, kind: k.dataset.dk, innerH: innerHeight };
};

export async function dockEmpty(env) {
  const s = scenario(env);
  await s.safe('dock-empty', async () => {
    const withBots = await (await s.fresh({ settle: 1200 })).evaluate(STATE);
    for (const reduced of [false, true]) {
      const tag = reduced ? 'reduced motion' : 'motion';
      for (const [fixture, what] of [['fresh', 'a first install'], ['none', 'sessions and no bots']]) {
        const page = await s.fresh({ q: 'fixture=' + fixture, settle: 1500, reduced });
        const f = await page.evaluate(STATE);
        check('dock', `${tag}: ${what} shows no dock (not drawn, hidden, inert, out of the accessibility tree, below the window's edge)`, !f.shown && !f.in && f.vis === 'hidden' && f.inert && f.aria === 'true' && f.top >= f.innerH, f);
        check('dock', `${tag}: ${what}: it is not the setting ("Show the dock" is still on, nothing stored says otherwise)`, f.setting === 'on' && f.stored !== 'off', f);
        check('dock', `${tag}: ${what}: the composer keeps no room for a dock (72 lower than with bots: board K06)`, f.room === 0 && withBots.room === 72 && f.gap !== null && withBots.gap - f.gap === 72, { room: f.room, gap: f.gap, withBots: withBots.gap });
        check('dock', `${tag}: ${what}: no console errors`, page.errors.length === 0, page.errors);
      }
    }

    /* the dock with the default bots: the row's geometry */
    const page = await s.fresh({ settle: 1200 });
    const m = await page.evaluate(MEASURE);
    check('dock', 'with bots the dock is the row: the kit\'s Dock in its row geometry, with bots in it and no "+"', m.kind === 'row' && m.geom === 'fit,72,30,30' && m.orbs > 3 && m.add === 0, { kind: m.kind, geom: m.geom, orbs: m.orbs, add: m.add });
    check('dock', 'the slab is 72 tall, flush to the window\'s edge, and as wide as its content (at most 640)', Math.abs(m.body.h - 72) <= 0.5 && Math.abs(m.body.b - m.innerH) <= 0.5 && m.body.w <= 640.5 && m.body.w > 200, m.body);
    const left = Math.min(...m.items.map((k) => k.l)) - m.body.l, right = m.body.r - Math.max(...m.items.map((k) => k.r));
    check('dock', 'its width is its content\'s: the first and last things in the row sit 30 from the slab\'s sides, out of the corner zones', Math.abs(left - 30) <= 0.5 && Math.abs(right - 30) <= 0.5, { left, right });
    check('dock', 'everything in the row is inside the slab\'s body, top to bottom', m.items.every((k) => k.t >= m.body.t && k.b <= m.body.b + 0.5 && k.l >= m.body.l && k.r <= m.body.r), m.items.map((k) => [k.cls, Math.round(k.t - m.body.t), Math.round(m.body.b - k.b)]));
    check('dock', 'no tombstone: the slab\'s drawn path is the body plus its two 30 flares, with a flat top between the corners', Math.abs(m.svg.w - (m.body.w + 60)) <= 0.5 && m.body.w > 2 * 30 + 8 && /^M0 72/.test(m.d), { svg: m.svg.w, body: m.body.w, d: m.d.slice(0, 24) });
    await page.screenshot({ path: join(OUT, 'dock-row.png'), clip: { x: Math.max(0, (m.body.l + m.body.r) / 2 - 400), y: m.body.t - 60, width: 800, height: m.body.h + 60 } });
    check('dock', 'no console errors', page.errors.length === 0, page.errors);
  });
  await s.close();
}
