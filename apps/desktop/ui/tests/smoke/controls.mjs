/* Controls: the library's themed select and model picker in a real engine. No platform popup anywhere: the open list is the
   app's own (role listbox, themed surface, the thin bar), it opens inside the Settings dialog, the keyboard walks it, and axe
   finds nothing on the open picker in a dark and a light theme. With CONTROLS_SHOTS=<dir> it leaves a screenshot of the open
   picker per theme. */
import { mkdirSync } from 'node:fs';
import { check, scenario } from './harness.mjs';

const MODELS = ['sonnet 5.5', 'haiku 4.5', 'opus 4.1', 'gpt-5', 'gpt-5-codex', 'qwen3-coder', 'deepseek-v3.1', 'gemini-2.5-pro', 'grok-4', 'llama-4-maverick', 'mistral-large', 'glm-4.6', 'kimi-k2', 'minimax-m2'];
const NATIVE = 'select, datalist, input[type="color"], input[type="number"], input[type="date"], input[type="time"], input[type="range"], input[type="datetime-local"]';

/** a model field in a probe card inside the app, the way the new-bot sheet and the bot settings draw it */
const PROBE = (models) => {
  const host = document.getElementById('hx-app');
  const card = document.createElement('div');
  card.id = 'probe';
  card.style.cssText = 'position:fixed;left:48px;top:96px;width:340px;padding:16px;border-radius:var(--r-m);background:var(--bg-1);color:var(--text);z-index:var(--z-menu)';
  card.append(__hx.ui.field({ kind: 'model', label: 'Model', options: models, value: models[0], hint: 'From the providers boopis has keys for.' }));
  host.append(card);
};
const AXE_RUN = (page) => page.evaluate(async () => {
  const res = await axe.run(document.getElementById('hx-app').parentElement, { resultTypes: ['violations'], preload: false, rules: { region: { enabled: false } } });
  return res.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0] ? ' - ' + n.any[0].message.slice(0, 90) : '')) }));
});

export async function controls(env, AXE) {
  const s = scenario(env);
  const shots = process.env['CONTROLS_SHOTS'];
  if (shots) mkdirSync(shots, { recursive: true });

  for (const [name, q] of [['dark', 'preset=catalog'], ['light', 'preset=bone']]) {
    const page = await s.fresh({ q });
    await s.safe('controls', async () => {
      await page.evaluate(PROBE, MODELS);
      await page.addScriptTag({ content: AXE });
      const trigger = page.locator('#probe .ui-select');
      const tr = await trigger.evaluate((b) => ({ role: b.getAttribute('role'), popup: b.getAttribute('aria-haspopup'), expanded: b.getAttribute('aria-expanded'), mark: !!b.querySelector('svg.ui-mm'), text: b.textContent.trim() }));
      check('controls', `${name}: the model field is a combobox button with the provider's mark, not a <select>`, tr.role === 'combobox' && tr.popup === 'listbox' && tr.expanded === 'false' && tr.mark && /sonnet/i.test(tr.text), tr);

      await trigger.click(); await page.waitForTimeout(350);
      const open = await page.evaluate(() => {
        const surface = document.querySelector('.ui-listbox'); if (!surface) return null;
        const lb = surface.querySelector('[role="listbox"]'), cs = getComputedStyle(lb), fill = getComputedStyle(surface, '::before').backgroundColor, probe = document.createElement('i');
        probe.style.cssText = 'position:fixed;background:var(--bg-1);color:var(--current)'; document.body.append(probe);
        const frame = getComputedStyle(probe).backgroundColor; probe.style.background = 'var(--current)'; const current = getComputedStyle(probe).backgroundColor; probe.remove();
        const f = document.activeElement, fs = getComputedStyle(f), r = lb.getBoundingClientRect();
        return {
          role: lb.getAttribute('role'), options: lb.querySelectorAll('[role="option"]').length, groups: [...lb.querySelectorAll('.ui-listbox__head')].map((h) => h.textContent), marks: lb.querySelectorAll('.ui-option svg.ui-mm[data-color="brand"]').length,
          bg: fill, frame, bar: cs.scrollbarWidth === 'auto' && lb.classList.contains('ui-scroll') ? 'kit' : cs.scrollbarWidth, overflow: cs.overflowY, h: Math.round(surface.getBoundingClientRect().height), inView: r.top >= 0 && r.bottom <= innerHeight,
          focusOn: f.getAttribute('role'), focusVal: f.dataset.value, focusBg: getComputedStyle(f, '::before').backgroundColor, current, selected: lb.querySelector('[aria-selected="true"]')?.dataset.value,
          expanded: document.querySelector('#probe .ui-select').getAttribute('aria-expanded')
        };
      });
      const ok = !!open && open.role === 'listbox' && open.options === MODELS.length && open.groups.length >= 8 && open.groups[0] === 'Claude' && open.bg === open.frame && open.bar === 'kit' &&
        open.marks === MODELS.length && open.focusOn === 'option' && open.focusVal === 'sonnet 5.5' && open.selected === 'sonnet 5.5' && open.expanded === 'true' && open.inView;
      check('controls', `${name}: it opens a themed listbox (the app's surface and the kit's scroll area, R-scroll-1), grouped by provider, with the chosen model focused`, ok, open);

      const bad = await AXE_RUN(page);
      check('controls', `${name}: axe finds nothing on the open model picker`, bad.length === 0, bad);

      /* the keyboard: Esc closes and returns to the field, Down opens, a letter jumps, Enter chooses and says so */
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      const esc = await page.evaluate(() => ({ list: !!document.querySelector('.ui-listbox.is-in'), focus: document.activeElement.id, ex: document.activeElement.getAttribute('aria-expanded') }));
      check('controls', `${name}: Esc closes the list and focus goes back to the field`, !esc.list && esc.ex === 'false' && /^fld/.test(esc.focus), esc);
      await page.evaluate(() => { window.__chg = []; document.getElementById('probe').addEventListener('ui:change', (e) => window.__chg.push(e.detail.value)); });
      await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
      if (shots) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); await page.screenshot({ path: `${shots}/model-picker-${name}.png`, clip: { x: 0, y: 60, width: 560, height: 600 } }); }
      await page.keyboard.type('qw'); await page.waitForTimeout(100);
      const jumped = await page.evaluate(() => document.activeElement.dataset.value);
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const chosen = await page.evaluate(() => ({ chg: window.__chg, text: document.querySelector('#probe .ui-select__v').textContent, family: document.querySelector('#probe .ui-select svg.ui-mm').dataset.family, open: !!document.querySelector('.ui-listbox.is-in'), focus: document.activeElement.className.includes('ui-select') }));
      check('controls', `${name}: Down opens, typing "qw" jumps to qwen3-coder, Enter chooses it, tells ui:change once and shows its mark`, jumped === 'qwen3-coder' && chosen.chg.join() === 'qwen3-coder' && chosen.text === 'Qwen3 Coder' && chosen.family === 'qwen' && !chosen.open && chosen.focus, { jumped, ...chosen });
    });
  }

  /* Settings > Appearance on the v7 kit: the theme's choices are the kit's Segmented controls and the accent a text Field (no colour
     chooser of the platform); choosing Light applies the light theme to the dialog and the window */
  const page = await s.fresh({ q: 'preset=catalog' });
  await s.safe('controls', async () => {
    await page.addScriptTag({ content: AXE });
    await page.keyboard.press('Control+Shift+Comma'); await page.waitForTimeout(700);
    const f = await page.evaluate(() => ({ segs: document.querySelectorAll('#hx-dpanel-appearance [data-kit~="Segmented"]').length, native: document.querySelectorAll('select, input[type="color"]').length, accent: !!document.querySelector('#hx-set-accent') }));
    check('controls', 'Appearance: the kit\'s Segmented controls and the accent Field, and no native <select> or colour chooser', f.segs >= 4 && f.native === 0 && f.accent, f);
    const bad = await AXE_RUN(page);
    check('controls', 'axe: Appearance', bad.length === 0, bad);
    await page.click('#hx-set-mode [data-value="light"]'); await page.waitForTimeout(400);
    const light = await page.evaluate(() => ({ dialog: document.getElementById('hx-settings').getAttribute('data-theme'), app: document.documentElement.getAttribute('data-hx-theme') }));
    check('controls', 'choosing Light puts the dialog and the window in the light theme', light.dialog === 'light' && light.app === 'light', light);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  /* every Settings tab and the sheets: nothing the platform draws is left in the DOM */
  const walk = await s.fresh();
  await s.safe('controls', async () => {
    const seen = [];
    await walk.keyboard.press('Control+Comma'); await walk.waitForTimeout(500);
    for (const tab of ['general', 'models', 'connectors', 'appearance', 'keys']) {
      await walk.click('#hx-dtab-' + tab); await walk.waitForTimeout(400);
      seen.push([tab, await walk.evaluate((q) => document.querySelectorAll(q).length, NATIVE)]);
    }
    check('controls', 'no native select, colour, number, date, time or range field in any Settings tab', seen.every((x) => x[1] === 0), seen);
    await walk.keyboard.press('Escape');
    await walk.keyboard.press('Alt+2'); await walk.waitForTimeout(500);
    await walk.keyboard.press('Control+i'); await walk.waitForTimeout(500);
    const n = await walk.evaluate((q) => document.querySelectorAll(q).length, NATIVE);
    check('controls', 'no native field in the Bots tab and its settings sheet', n === 0, n);
  });
  await s.close();
}
