/* The smoke harness: results, a fresh page per section, and the helpers the walk-throughs share. */
import { chromium, open, startServers } from '../lib.mjs';

export { chromium };
export const results = [];
export const errorsAll = [];

export async function start() {
  const srv = await startServers();
  const browser = await chromium.launch();
  return { srv, browser };
}
/** one check: a section, a name, pass or fail, and what was seen */
export const check = (sec, key, pass, detail) => { results.push({ sec, key, pass: !!pass, detail }); };

/** a scenario with its own fresh page; a script error fails the scenario, never the run */
export function scenario(env) {
  let page = null;
  const api = {
    get page() { return page; },
    async fresh(o = {}) { if (page) { errorsAll.push(...page.errors); await page.ctx.close(); } page = await open(env.browser, { origin: env.srv.origin, ...o }); return page; },
    async close() { if (page) { errorsAll.push(...page.errors); await page.ctx.close(); page = null; } },
    ev: (fn, arg) => page.evaluate(fn, arg),
    press: async (k, w) => { await page.keyboard.press(k); await page.waitForTimeout(w == null ? 260 : w); },
    st: () => page.evaluate(() => ({ tab: __hx.state.tab, left: __hx.state.left, right: __hx.state.right, dock: __hx.state.dock })),
    where: () => page.evaluate(WHERE),
    layer: () => page.evaluate(() => ({ pal: !document.getElementById('hx-palette').hidden, settings: document.getElementById('hx-settings').open, sheet: document.getElementById('hx-keys-sheet').open, pop: !!__hx.popover.current, menu: !!document.querySelector('.ui-menu, .ui-listbox, .k7-menu[data-floating]') })),
    dockMode: () => page.evaluate(() => (document.querySelector('#hx-dock [data-mode]') || {}).dataset?.mode),
    title: () => page.evaluate(() => document.querySelector('#hx-btn-title .k7-title__name').textContent),
    async safe(sec, fn) { try { await fn(); } catch (e) { check(sec, 'script', false, String(e.message).split('\n')[0]); if (process.env.SMOKE_STACK) console.error(e.message); } }
  };
  return api;
}

/** where focus is, by region */
export const WHERE = () => {
  const a = document.activeElement;
  if (!a || a === document.body) return { region: 'none' };
  const region = a.closest('.hx-bar') ? 'bar' : a.closest('#hx-list-session, #hx-list-bots, .hx-side') ? 'list' : a.closest('[data-hx-composer], [data-hx-focus="composer"]') ? 'composer'
    : a.closest('#hx-right, [data-hx-panel]') ? 'panel' : a.closest('#hx-dock') ? 'dock' : a.closest('.hx-view') ? 'messages' : a.closest('dialog, .hx-palette, .ui-menu, .ui-listbox, .ui-pop') ? 'layer' : 'other';
  return { region, turn: a.hasAttribute('data-hx-turn'), tag: a.tagName.toLowerCase(), cls: String(a.className).slice(0, 40), id: a.id || null, label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 50) };
};
