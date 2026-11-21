/* Playwright smoke: boot without console errors, the four theme presets (and their contrast), the keyboard walk-through
   (KEYMAP.md), the owner's decisions and the dock's gestures, and an axe scan with zero violations.
   `node tests/smoke/run.mjs [boot|themes|keys|owner|live|forms|mods|controls|store|corners|concentric|dock-empty|dock-motion|dock-presence|axe]` runs one part. Exit code 1 on any failure. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { check, errorsAll, results, scenario, start } from './harness.mjs';
import { keyWalk } from './keys.mjs';
import { ownerDecisions } from './owner.mjs';
import { liveSessions } from './live.mjs';
import { formCards, liveForms, liveRequests } from './forms.mjs';
import { corners } from './corners.mjs';
import { dockEmpty } from './dock-empty.mjs';
import { dockMotion } from './dock-motion.mjs';
import { dockPresence } from './dock-presence.mjs';
import { concentric } from './concentric.mjs';
import { mods } from './mods.mjs';
import { controls } from './controls.mjs';
import { mentions } from './mention.mjs';
import { store } from './store.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const only = process.argv[2] || 'all';
const want = (n) => only === 'all' || only === n;
const env = await start();

if (want('boot')) {
  const s = scenario(env);
  for (const [w, h] of [[1440, 900], [1920, 1080], [390, 844]]) {
    const page = await s.fresh({ w, h });
    const r = await page.evaluate(() => ({ tab: __hx.state.tab, orbs: document.querySelectorAll('orb-avatar').length, dock: !!document.querySelector('#hx-dock .dk'), turns: document.querySelectorAll('[data-hx-turn]').length, booting: document.getElementById('hx-app').classList.contains('is-booting') }));
    check('boot', `boots at ${w}x${h} with no console errors`, page.errors.length === 0 && r.dock && r.turns === 3 && !r.booting && r.orbs > 20, { errors: page.errors, ...r });
  }
  await s.close();
}

if (want('themes')) {
  const s = scenario(env);
  for (const preset of ['catalog', 'graphite', 'bone', 'typewriter']) {
    const page = await s.fresh({ q: 'preset=' + preset });
    const r = await page.evaluate(() => ({ preset: document.documentElement.dataset.hxPreset, scheme: __hx.theme.scheme(), contrast: __hx.theme.contrast().filter((c) => !c.pass).map((c) => c.label + ' ' + c.ratio), dockBlack: getComputedStyle(document.querySelector('#hx-dock .dk-shape path')).fill }));
    check('themes', `${preset}: applies, every contrast pair holds, the dock stays black`, r.preset === preset && r.scheme === (preset === 'bone' ? 'light' : 'dark') && r.contrast.length === 0 && r.dockBlack === 'rgb(0, 0, 0)' && page.errors.length === 0, r);
  }
  const page = await s.fresh();
  const cycle = await page.evaluate(() => { const out = []; for (const id of ['graphite', 'bone', 'typewriter', 'catalog']) { __hx.theme.preset(id); out.push(document.documentElement.dataset.hxPreset + ':' + __hx.state.theme); } return out; });
  check('themes', 'switching presets live updates the scheme in the shared state', cycle.join() === 'graphite:dark,bone:light,typewriter:dark,catalog:dark', cycle);
  await s.close();
}

if (want('keys')) await keyWalk(env);
if (want('owner')) await ownerDecisions(env);
if (want('live')) await liveSessions(env);
if (want('corners')) { await corners(env); await concentric(env); }
if (want('dock-empty')) await dockEmpty(env);
if (want('dock-motion')) await dockMotion(env);
if (want('dock-presence')) await dockPresence(env);
if (want('mods')) await mods(env, AXE);
if (want('controls')) await controls(env, AXE);
if (want('mention')) await mentions(env);
if (want('store')) await store(env);
if (want('forms')) { await formCards(env); await liveForms(env); await liveRequests(env); }

if (want('axe')) {
  const s = scenario(env);
  const STATES = [
    ['session', {}, null], ['bots', {}, (p) => p.keyboard.press('Alt+2')], ['details panel', {}, (p) => p.keyboard.press('Control+i')],
    ['bots settings sheet', {}, async (p) => { await p.keyboard.press('Alt+2'); await p.waitForTimeout(500); await p.keyboard.press('Control+i'); }],
    ['bots archived group expanded', { q: 'fixture=outside' }, async (p) => { await p.keyboard.press('Alt+2'); await p.waitForTimeout(500); await p.click('.bt-rows .ui-row[data-value="sage"]'); await p.click('.bt-archived .ui-group__head'); await p.locator('.bt-archived .ui-row-wrap').first().hover(); }],
    ['bots rail with the archived group', {}, async (p) => { await p.keyboard.press('Alt+2'); await p.evaluate(() => __hx.setState({ left: 'rail' })); }],
    ['palette', {}, (p) => p.keyboard.press('Control+k')], ['settings', {}, (p) => p.keyboard.press('Control+Comma')],
    ['settings models', {}, async (p) => { await p.keyboard.press('Control+Comma'); await p.waitForTimeout(300); await p.click('#hx-dtab-models'); }],
    ['appearance', {}, (p) => p.keyboard.press('Control+Shift+Comma')], ['keys sheet', {}, (p) => p.keyboard.press('Control+Slash')],
    ['store', {}, (p) => p.keyboard.press('Control+Shift+S')],
    ['store installed', {}, async (p) => { await p.keyboard.press('Control+Shift+S'); await p.waitForSelector('#hx-store-body [role=tab]'); await p.getByRole('tab', { name: 'Installed' }).click(); }],
    ['account menu', {}, (p) => p.click('#hx-btn-account')], ['model picker', {}, async (p) => { await p.keyboard.press('Control+g'); await p.keyboard.press('i'); await p.waitForTimeout(200); await p.keyboard.press('Alt+m'); }],
    ['blank popover', {}, async (p) => { await p.keyboard.press('Control+g'); await p.keyboard.press('m'); await p.waitForTimeout(200); await p.keyboard.press('b'); }],
    ['dock with no bots', { q: 'fixture=none' }, null],
    ['dock expanded + session', {}, async (p) => { await p.keyboard.press('Control+g'); await p.keyboard.press('d'); await p.waitForTimeout(300); await p.keyboard.press('Space'); }],
    ['rail', {}, (p) => p.evaluate(() => __hx.setState({ left: 'rail' }))],
    ['bone (light)', { q: 'preset=bone' }, null], ['graphite', { q: 'preset=graphite' }, null], ['typewriter', { q: 'preset=typewriter' }, null],
    ['phone 390', { w: 390, h: 844 }, null]
  ];
  for (const [name, o, act] of STATES) {
    const p = await s.fresh(o);
    if (act) { await act(p); await p.waitForTimeout(900); }
    await p.addScriptTag({ content: AXE });
    const v = await p.evaluate(async () => { const res = await axe.run(document.getElementById('hx-app').parentElement, { resultTypes: ['violations'], preload: false, rules: { region: { enabled: false } } }); return res.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0] ? ' - ' + n.any[0].message.slice(0, 90) : '')) })); });
    check('axe', 'axe: ' + name, v.length === 0, v);
  }
  await s.close();
}

await env.browser.close(); await env.srv.close();
const fails = results.filter((r) => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.sec.padEnd(7) + r.key.padEnd(70) + (r.pass ? '' : JSON.stringify(r.detail ?? '')));
console.log(`\n${results.length - fails.length}/${results.length} pass`);
const errs = errorsAll.filter((e) => !/Failed to load resource.*favicon/.test(e));
console.log('console errors:', errs.length ? errs : 'none');
process.exit(fails.length || errs.length ? 1 : 0);
