/* The "@" while typing is a list of suggestions, never a picker that takes the keyboard (ADR-0036). The release smoke typed
   "@@reply ...@@" (the fake model's syntax) and the menu swallowed the text; these walk the cases a person types. */
import { check, scenario } from './harness.mjs';

export async function mentions(env) {
  const s = scenario(env);
  const page = await s.fresh();
  const box = '.ss-composer .k7-composer__text';   /* the session's composer is the kit's (boards S20, S23) */
  const value = () => page.evaluate((sel) => (document.querySelector(sel)?.textContent ?? '').replace(/ /g, ' '), box);
  const menuOpen = () => page.evaluate(() => !!document.querySelector('.k7-menu[data-floating]'));
  const inBox = () => page.evaluate((sel) => !!document.activeElement?.closest(sel.replace(' .k7-composer__text', '')), box);
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
    const first = await page.evaluate(() => (document.querySelector('.k7-menu[data-floating] .k7-mrow__name')?.textContent ?? '').trim());
    const letters = (first.split(/\s+/).find((w) => /^[a-z]/i.test(w)) ?? '').slice(0, 2).toLowerCase();
    await page.keyboard.type(letters, { delay: 20 }); await page.waitForTimeout(150);
    check('mention', 'typing letters keeps the suggestions open', await menuOpen());
    await page.keyboard.press('Tab'); await page.waitForTimeout(300);
    const v = await value();
    check('mention', 'Tab takes the model the letters name', v.startsWith('fix this @') && v.toLowerCase().includes(first.toLowerCase()) && !(await menuOpen()), v + ' / ' + first);

    await clear();
    await page.keyboard.type('ask @', { delay: 20 }); await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
    const onOption = await page.evaluate(() => !!document.activeElement?.closest('.k7-menu[data-floating]'));
    check('mention', 'the down arrow moves into the suggestions', onOption);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const v2 = await value();
    check('mention', 'Enter on a row writes that model after the "@" and the caret is back in the message', v2.startsWith('ask @' + first) && !(await menuOpen()) && (await inBox()), v2);

    await clear();
    await page.keyboard.type('@', { delay: 20 }); await page.waitForTimeout(250);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('mention', 'Esc closes the suggestions and keeps the "@"', (await value()) === '@' && !(await menuOpen()) && (await inBox()), await value());
  });

  /* the same "@" in a group room (the owner, 0.1.9: "it stays as a text"): the members in the kit's Menu, a chip in the text, one Backspace,
     and "@kai." left as text, as the engine reads it */
  await s.safe('mention', async () => {
    const room = await s.fresh({ q: 'fixture=groups&fixture=paper-past' });
    await room.evaluate(() => { __hx.setState({ tab: 'bots' }); }); await room.waitForTimeout(400);
    await room.click('.bt-group-rows > [data-kit~="ListRow"]:nth-of-type(2)'); await room.waitForTimeout(500);
    const rbox = '.bt-group .k7-composer__text';
    const rvalue = () => room.evaluate((sel) => (document.querySelector(sel)?.textContent ?? '').replace(/\u00a0/g, ' '), rbox);
    const rchips = () => room.evaluate((sel) => [...document.querySelectorAll(sel + ' [data-kit~="InlineChip"]')].map((c) => c.getAttribute('data-words')), rbox);
    const rmenu = () => room.evaluate(() => [...document.querySelectorAll('.k7-menu[data-floating] .k7-mrow__name')].map((x) => x.textContent.trim()));
    const rclear = async () => { await room.click(rbox); await room.keyboard.press('Control+a'); await room.keyboard.press('Delete'); await room.waitForTimeout(150); };
    await rclear();
    await room.keyboard.type('@', { delay: 30 }); await room.waitForTimeout(250);
    check('mention', 'a room: "@" suggests the members and the room', (await rmenu()).join() === 'kai,nina,moss,iris,hex,nimbus,all', await rmenu());
    await room.keyboard.type('ni', { delay: 30 }); await room.keyboard.press('Tab'); await room.waitForTimeout(350);
    check('mention', 'a room: Tab writes the member’s handle, drawn as its chip', (await rvalue()) === '@nina ' && (await rchips()).join() === '@nina', [await rvalue(), await rchips()]);
    await room.keyboard.type('and @kai please', { delay: 15 }); await room.waitForTimeout(400);
    check('mention', 'a room: a typed mention becomes a chip, and typing goes on', (await rvalue()) === '@nina and @kai please' && (await rchips()).join() === '@nina,@kai', [await rvalue(), await rchips()]);
    for (let i = 0; i < 'please'.length + 1; i++) await room.keyboard.press('Backspace');
    await room.waitForTimeout(350);
    await room.keyboard.press('Backspace'); await room.waitForTimeout(200);
    check('mention', 'a room: one Backspace takes a chip out', (await rvalue()) === '@nina and ' && (await rchips()).join() === '@nina', [await rvalue(), await rchips()]);
    await rclear();
    await room.keyboard.type('thanks @kai.', { delay: 15 }); await room.waitForTimeout(400);
    const hint = await room.evaluate(() => document.querySelector('.bt-group .bt-composer-zone [data-kit~="Notice"]')?.textContent ?? '');
    check('mention', 'a room: "@kai." stays text and the hint says why', (await rchips()).length === 0 && hint.includes('names nobody'), [await rchips(), hint]);
  });
  await s.close();
}
