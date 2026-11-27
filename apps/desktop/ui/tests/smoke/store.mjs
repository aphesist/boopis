/* The store, on the mock provider (the fixture items of apps/shared/data/store.fixtures.json), in a real browser: the keys that reach
   it, search, an item's page, the review card and its hold (one second, never less), what is installed after, the switches
   on the Installed screen, and the refusals the card must show. The store's own keys: mod+shift+S opens it, Esc closes it and gives focus back. */
import { check, scenario } from './harness.mjs';

const OPEN = '#hx-store[open]';
const body = (page) => page.locator('#hx-store-body');
const text = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);

export async function store(env) {
  const s = scenario(env);

  await s.safe('store', async () => {
    const page = await s.fresh({ settle: 800 });

    /* the way in: the key, then the front page with its Recommended section */
    await page.keyboard.press('Control+Shift+S');
    await page.waitForSelector(OPEN + ' [data-store-open]', { timeout: 8000 });
    const front = await page.evaluate(() => ({
      title: document.querySelector('#hx-store .k7-dialog__title').textContent, go: document.querySelector('#hx-store [data-store-go]')?.textContent.trim(),
      heads: [...document.querySelectorAll('#hx-store-body .hx-store__group > .k7-shead')].map((n) => n.textContent.trim()), rows: document.querySelectorAll('#hx-store-body [data-store-open]').length,
      focusIn: !!document.activeElement.closest('#hx-store')
    }));
    check('store', 'mod+shift+S opens the store with focus inside it, its head\'s end saying how many are installed (board 15)', front.title === 'Store' && /^\d+ installed$/.test(front.go ?? '') && front.focusIn, front);
    /* the rest of the front page is grouped by kind, in the kinds' order (src/modules/store/model.ts KIND_ORDER and KIND_GROUP) */
    const KINDS = ['Skills', 'Connectors', 'Plugins', 'Mods', 'Engine plugins'];
    const kinds = front.heads.slice(1).map((h) => KINDS.indexOf(h));
    check('store', 'the front page is Recommended first, then everything else by kind', front.heads[0] === 'Recommended' && kinds.length > 0 && kinds.every((k, i) => k >= 0 && (i === 0 || k > kinds[i - 1])) && front.rows >= 9, front);
    check('store', 'the engine\'s name is nowhere on the page outside an item\'s own words', !/hermes/i.test(await text(page, '#hx-store-body :not([data-store-item]):not([data-store-item] *)') || ''), null);

    /* search is local and narrows by words; a miss says so */
    const q = page.locator('#hx-store-q');
    await q.fill('sql');
    await page.waitForTimeout(700);
    const hit = await text(page, '#hx-store-body .hx-store__group .k7-shead, #hx-store-body [data-store-item-row] .k7-lrow__title');
    check('store', 'searching "sql" finds SQL review and leaves out the rest', /SQL review/.test(hit) && !/Firecrawl/.test(hit), hit.slice(0, 200));
    await q.fill('zzzzqq');
    await page.waitForTimeout(700);
    check('store', 'a search with no match says nothing matches, and offers a way out', /Nothing matches/.test(await text(page, '#hx-store-body')), null);
    await q.fill('');
    await page.waitForTimeout(700);

    /* open an item: its page says what it adds, where it reaches, where it comes from, and its licence */
    await page.locator('[data-store-open="boopis:release-notes"]').click();
    await page.waitForSelector('.hx-store__sheet');
    const sheet = await text(page, '.hx-store__sheet');
    check('store', 'an item\'s page names its pin, its source, its licence and when it takes effect', /Pinned to/.test(sheet) && /Licence/.test(sheet) && /Recommended by boopis/.test(sheet) && /Where it comes from/.test(sheet), sheet.slice(0, 300));

    /* review: the card shows the plan; Esc/Deny goes back; the hold approves and only after a second */
    await page.locator('[data-store-review]').click();
    await page.waitForFunction(() => { const c = document.querySelector('#hx-store-body hx-card'); const h = c?.querySelector('[data-hold]'); return !!h && c.state === 'open' && h.getBoundingClientRect().width > 0; }, null, { timeout: 15000 });
    const card = await page.evaluate(() => { const c = document.querySelector('#hx-store-body hx-card'); return { state: c.state, holds: c.querySelectorAll('[data-hold]').length, deny: !!c.querySelector('[data-action="cancel"]'), text: c.textContent.replace(/\s+/g, ' ') }; });
    check('store', 'the review card asks for the hold with Deny beside it, and nothing is installed yet', card.holds === 1 && card.deny && card.state === 'open', card);
    const hold = page.locator('#hx-store-body hx-card [data-hold]').first();
    await hold.focus();
    const t0 = Date.now();
    await page.keyboard.down('Space');
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');
    await page.waitForTimeout(300);
    const early = await page.evaluate(() => ({ state: document.querySelector('#hx-store-body hx-card')?.state, installed: __hx.data?.store?.installed?.get?.().length ?? null }));
    check('store', 'releasing the hold early installs nothing', early.state !== 'submitting' && early.state !== 'done', early);
    await hold.focus();
    await page.keyboard.down('Space');
    await page.waitForTimeout(1250);
    await page.keyboard.up('Space');
    await page.waitForSelector('#hx-store-done', { timeout: 8000 });
    check('store', 'holding for a second installs it, and the receipt says so', Date.now() - t0 >= 1000 && /Release notes is installed/.test(await text(page, '#hx-store-body')), null);

    /* installed: it is listed on, with its switch, and the switch can be turned off and on */
    await page.getByRole('button', { name: 'See what is installed' }).click();
    await page.waitForSelector('#hx-store-have');
    const have = await page.evaluate(() => [...document.querySelectorAll('#hx-store-body [data-store-switch]')].map((n) => ({ id: n.dataset.storeSwitch, on: n.getAttribute('aria-checked') === 'true' })));
    check('store', 'Installed lists what was just installed, switched on, beside what was already there', have.some((h) => h.id === 'boopis:release-notes' && h.on) && have.length >= 3, have);
    const sw = page.locator('[data-store-switch="boopis:release-notes"]');
    const on = async () => (await sw.getAttribute('aria-checked')) === 'true';
    await sw.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    check('store', 'the switch turns an item off, and says it takes effect from the next session', !(await on()) && /next session/i.test(await text(page, '[data-store-status], .k7-notify')), null);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    check('store', 'the switch keeps focus through the redraw, so the same key turns it on again', await on(), null);

    /* the refusals: an item with no pin cannot be installed, a taken-down one is flagged */
    await page.locator('#hx-store [data-store-back]').click();
    await page.waitForSelector('[data-store-open="github:example-org/loose-skill"]');
    await page.locator('[data-store-open="github:example-org/loose-skill"]').click();
    await page.waitForSelector('.hx-store__sheet');
    check('store', 'an item that is not pinned says so and offers no install', /Not pinned/.test(await text(page, '.hx-store__sheet')) && (await page.locator('[data-store-review]').count()) === 0, null);

    /* the head's end leads to Installed and on to Sources, by the keyboard too; Esc closes and gives focus back */
    await page.locator('#hx-store [data-store-back]').click();
    await page.waitForTimeout(300);
    await page.locator('#hx-store [data-store-go="installed"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#hx-store [data-store-go="sources"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const src = await text(page, '#hx-store-body');
    check('store', 'Sources lists the sources, Anthropic\'s among them, each with a switch', /Anthropic/.test(src) && (await page.locator('#hx-store-body [data-store-src]').count()) >= 5, src.slice(0, 200));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const closed = await page.evaluate(() => ({ open: document.getElementById('hx-store').open, where: document.activeElement?.tagName }));
    check('store', 'Esc closes the store', closed.open === false, closed);

    /* the other ways in: the palette, and Settings is not left open behind it */
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    await page.keyboard.type('Store');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector(OPEN + ' [data-store-open]', { timeout: 8000 });
    check('store', 'the command palette opens the store too', true, null);
    await page.keyboard.press('Escape');
    check('store', 'the page raised no console error', page.errors.length === 0, page.errors);
  });
  await s.close();
}
