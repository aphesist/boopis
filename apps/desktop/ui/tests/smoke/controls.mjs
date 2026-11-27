/* Controls: the app's choosers in a real engine (step 2a: the v6 select and its listbox went; every list is the kit's Menu). No platform
   popup anywhere: a bot's model field (the kit's SelectorItem in its settings sheet) opens the kit's Menu of models, grouped by
   provider with their marks, the chosen one focused; the keyboard walks it (Esc, Down, a word typed, Enter); it opens inside the
   Settings dialog; and axe finds nothing on the open picker in a dark and a light theme. With CONTROLS_SHOTS=<dir> it leaves a
   screenshot of the open picker per theme. */
import { mkdirSync } from 'node:fs';
import { check, scenario } from './harness.mjs';

const NATIVE = 'select, datalist, input[type="color"], input[type="number"], input[type="date"], input[type="time"], input[type="range"], input[type="datetime-local"]';

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
      /* noct is the mock's ungoverned bot: its sheet's Model section has the model field (the mock offers opus, sonnet, haiku and qwen) */
      await page.keyboard.press('Alt+2'); await page.waitForTimeout(400);
      await page.evaluate(() => { __hx.emit('hx:bot-settings', { open: true, id: 'noct', section: 'model', from: 'keyboard' }); });
      await page.waitForTimeout(1700);
      await page.addScriptTag({ content: AXE });
      const trigger = page.locator('.bt-sheet [data-model-pick]');
      const tr = await trigger.evaluate((b) => ({ tag: b.tagName, kit: b.getAttribute('data-kit'), popup: b.getAttribute('aria-haspopup'), expanded: b.getAttribute('aria-expanded'), mark: !!b.querySelector('svg.ui-mm'), text: b.textContent.trim(), name: b.getAttribute('aria-label') }));
      check('controls', `${name}: the model field is the kit's SelectorItem with the provider's mark, not a <select>`, tr.tag === 'BUTTON' && tr.kit === 'SelectorItem' && tr.popup === 'menu' && tr.expanded === 'false' && tr.mark && /sonnet/i.test(tr.text) && /^Model: /.test(tr.name ?? ''), tr);

      await trigger.click();
      await page.waitForFunction(() => !!document.querySelector('.k7-menu[data-floating]'), null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);
      const open = await page.evaluate(() => {
        const m = document.querySelector('.k7-menu[data-floating]'); if (!m) return null;
        const list = m.querySelector('[role="menu"]') ?? m, f = document.activeElement, r = m.getBoundingClientRect(), cs = getComputedStyle(m.querySelector('.k7-menu__list'));
        return {
          kit: m.getAttribute('data-kit'), role: list.getAttribute('role'), variant: m.dataset.variant, rows: m.querySelectorAll('[role="menuitemradio"]').length, heads: [...m.querySelectorAll('.k7-menu__head')].map((h) => h.textContent),
          marks: m.querySelectorAll('[role="menuitemradio"] svg.ui-mm[data-color="brand"]').length, bar: m.querySelector('.k7-menu__list').classList.contains('ui-scroll') ? 'kit' : cs.overflowY,
          inView: r.top >= 0 && r.bottom <= innerHeight, focusOn: f.getAttribute('role'), focusVal: f.dataset.value, checked: m.querySelector('[aria-checked="true"]')?.dataset.value,
          expanded: document.querySelector('.bt-sheet [data-model-pick]').getAttribute('aria-expanded')
        };
      });
      const ok = !!open && open.kit === 'Menu' && open.role === 'menu' && open.variant === 'list' && open.rows === 4 && open.heads.length === 2 && open.marks === 4 && open.bar === 'kit' &&
        open.focusOn === 'menuitemradio' && open.focusVal === 'sonnet 5.5' && open.checked === 'sonnet 5.5' && open.expanded === 'true' && open.inView;
      check('controls', `${name}: it opens the kit's Menu (a list, the kit's scroll area), grouped by provider with their marks, with the chosen model focused`, ok, open);

      const bad = await AXE_RUN(page);
      check('controls', `${name}: axe finds nothing on the open model picker`, bad.length === 0, bad);

      /* the keyboard: Esc closes and returns to the field, Down opens, a word typed jumps, Enter chooses and says so */
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      const esc = await page.evaluate(() => ({ list: !!document.querySelector('.k7-menu[data-floating]'), field: document.activeElement.hasAttribute('data-model-pick'), ex: document.activeElement.getAttribute('aria-expanded') }));
      check('controls', `${name}: Esc closes the list and focus goes back to the field`, !esc.list && esc.ex === 'false' && esc.field, esc);
      await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
      if (shots) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); await page.screenshot({ path: `${shots}/model-picker-${name}.png`, clip: { x: 760, y: 60, width: 680, height: 600 } }); }
      await page.keyboard.type('qw'); await page.waitForTimeout(100);
      const jumped = await page.evaluate(() => document.activeElement.dataset.value);
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const chosen = await page.evaluate(() => { const f = document.querySelector('.bt-sheet [data-model-pick]'); return { value: f.dataset.value, text: f.querySelector('.k7-sel__value').textContent, family: f.querySelector('svg.ui-mm')?.dataset.family, open: !!document.querySelector('.k7-menu[data-floating]'), focus: document.activeElement === f, saved: __hx.data().bots.snapshot().bots.find((b) => b.id === 'noct')?.cfg.model }; });
      check('controls', `${name}: Down opens, typing "qw" jumps to qwen3-coder, Enter chooses it, saves it and shows its mark`, jumped === 'qwen3-coder' && chosen.value === 'qwen3-coder' && /qwen3 coder/i.test(chosen.text) && chosen.family === 'qwen' && !chosen.open && chosen.focus && chosen.saved === 'qwen3-coder', { jumped, ...chosen });
    });
  }

  /* Settings > Appearance (board 14's rows on the kit): the accent select opens its Menu inside the modal dialog, on top, the choice applies */
  const page = await s.fresh({ q: 'preset=catalog' });
  await s.safe('controls', async () => {
    await page.addScriptTag({ content: AXE });
    await page.keyboard.press('Control+Shift+Comma'); await page.waitForTimeout(700);
    await page.click('#hx-set-appearance [data-select="accent"]'); await page.waitForTimeout(350);
    const f = await page.evaluate(() => { const m = document.querySelector('.k7-menu[data-floating]'); const r = m?.getBoundingClientRect(); const top = r && document.elementFromPoint(r.left + r.width / 2, r.top + 20); return { inDialog: !!m?.closest('dialog'), rows: m?.querySelectorAll('[role^="menuitem"]').length, onTop: !!(top && m.contains(top)), native: document.querySelectorAll('select, input[type="color"]').length }; });
    check('controls', 'Appearance: the accent menu opens inside the dialog, on top, and nothing the platform draws is left', f.inDialog && f.rows === 5 && f.onTop && f.native === 0, f);
    const bad = await AXE_RUN(page);
    check('controls', 'axe: Appearance with the accent menu open', bad.length === 0, bad);
    await page.locator('.k7-menu[data-floating] [role^="menuitem"]').nth(1).click(); await page.waitForTimeout(400);
    const picked = await page.evaluate(() => ({ text: document.querySelector('#hx-set-appearance [data-select="accent"] .k7-sel__value').textContent, accent: getComputedStyle(document.getElementById('hx-app')).getPropertyValue('--accent').trim() }));
    check('controls', 'choosing an accent applies it to the app', picked.text === 'Indigo' && picked.accent === '#4f46e5', picked);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  /* every Settings tab and the sheets: nothing the platform draws is left in the DOM */
  const walk = await s.fresh();
  await s.safe('controls', async () => {
    const seen = [];
    await walk.keyboard.press('Control+Comma'); await walk.waitForTimeout(500);
    for (const tab of ['general', 'sessions', 'bots', 'models', 'connectors', 'appearance', 'keys']) {
      await walk.click('#hx-set-nav-' + tab); await walk.waitForTimeout(400);
      seen.push([tab, await walk.evaluate((q) => document.querySelectorAll(q).length, NATIVE)]);
    }
    check('controls', 'no native select, colour, number, date, time or range field on any Settings page', seen.every((x) => x[1] === 0), seen);
    await walk.keyboard.press('Escape');
    await walk.keyboard.press('Alt+2'); await walk.waitForTimeout(500);
    await walk.keyboard.press('Control+i'); await walk.waitForTimeout(500);
    const n = await walk.evaluate((q) => document.querySelectorAll(q).length, NATIVE);
    check('controls', 'no native field in the Bots tab and its settings sheet', n === 0, n);
  });
  await s.close();
}
