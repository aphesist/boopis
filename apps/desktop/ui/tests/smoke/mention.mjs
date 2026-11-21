/* The "@" while typing is a list of suggestions, never a picker that takes the keyboard (ADR-0036). The release smoke typed
   "@@reply ...@@" (the fake model's syntax) and the menu swallowed the text; these walk the cases a person types. */
import { check, scenario } from './harness.mjs';

export async function mentions(env) {
  const s = scenario(env);
  const page = await s.fresh();
  const box = '.ss-composer [data-hx-composer] .ui-composer__input';
  const value = () => page.evaluate((sel) => (document.querySelector(sel)?.textContent ?? '').replace(/ /g, ' '), box);
  const menuOpen = () => page.evaluate(() => !!document.querySelector('.ui-listbox'));
  const inBox = () => page.evaluate((sel) => !!document.activeElement?.closest(sel.replace(' .ui-composer__input', '')), box);
  const clear = async () => { await page.click(box); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(150); };
  await s.safe('mention', async () => {
    await clear();
    await page.keyboard.type('@', { delay: 30 }); await page.waitForTimeout(250);
    check('mention', 'an "@" that starts a word opens the suggestions', await menuOpen());
    check('mention', 'and the caret stays in the message', await inBox());
    await page.keyboard.type('@reply hello from the smoke@@', { delay: 15 }); await page.waitForTimeout(250);
    check('mention', 'a second "@" closes the suggestions', !(await menuOpen()));
    check('mention', 'nothing typed is lost ("@@reply ...@@")', (await value()) === '@@reply hello from the smoke@@', await value());

    await clear();
    await page.keyboard.type('see you @ 5pm', { delay: 15 }); await page.waitForTimeout(250);
    check('mention', '"@ 5pm" stays as typed and leaves no menu', (await value()) === 'see you @ 5pm' && !(await menuOpen()), await value());

    await clear();
    await page.keyboard.type('mail me@home', { delay: 15 }); await page.waitForTimeout(250);
    check('mention', 'an "@" inside a word (an address) opens nothing', (await value()) === 'mail me@home' && !(await menuOpen()), await value());

    await clear();
    await page.keyboard.type('fix this @', { delay: 20 }); await page.waitForTimeout(250);
    const first = await page.evaluate(() => (document.querySelector('.ui-listbox .ui-option .ui-menu__label')?.textContent ?? '').trim());
    const letters = (first.split(/\s+/).find((w) => /^[a-z]/i.test(w)) ?? '').slice(0, 2).toLowerCase();
    await page.keyboard.type(letters, { delay: 20 }); await page.waitForTimeout(150);
    check('mention', 'typing letters keeps the suggestions open', await menuOpen());
    await page.keyboard.press('Tab'); await page.waitForTimeout(300);
    const v = await value();
    check('mention', 'Tab takes the model the letters name', v.startsWith('fix this @') && v.toLowerCase().includes(first.toLowerCase()) && !(await menuOpen()), v + ' / ' + first);

    await clear();
    await page.keyboard.type('ask @', { delay: 20 }); await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
    const onOption = await page.evaluate(() => !!document.activeElement?.closest('.ui-listbox'));
    check('mention', 'the down arrow moves into the suggestions', onOption);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const v2 = await value();
    check('mention', 'Enter on a row writes that model after the "@" and the caret is back in the message', v2.startsWith('ask @' + first) && !(await menuOpen()) && (await inBox()), v2);

    await clear();
    await page.keyboard.type('@', { delay: 20 }); await page.waitForTimeout(250);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('mention', 'Esc closes the suggestions and keeps the "@"', (await value()) === '@' && !(await menuOpen()) && (await inBox()), await value());
  });
  await s.close();
}
