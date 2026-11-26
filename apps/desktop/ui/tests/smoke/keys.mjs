/* The keyboard walk-through: every row of KEYMAP.md that has an observable effect, section by section. */
import { check, scenario } from './harness.mjs';

export async function keyWalk(env) {
  const s = scenario(env);
  const { ev, press, st, where, layer, dockMode, title } = s;
  const texts = (sel) => ev((sel) => [...document.querySelectorAll(sel)].map((g) => g.textContent).join(), sel);
  let page;

  /* section 1: global */
  page = await s.fresh();
  await s.safe('1', async () => {
    await press('Control+k'); check('1', 'mod+K opens the palette', (await layer()).pal);
    await page.keyboard.type('>'); await page.waitForTimeout(200);
    check('1', '> limits to commands', (await texts('.hx-pal-group')) === 'Commands');
    await page.fill('#hx-palette-input', '@'); await page.waitForTimeout(200);
    check('1', '@ limits to bots', (await texts('.hx-pal-group')) === 'Bots');
    await press('Escape'); check('1', 'Esc closes the palette', !(await layer()).pal);
    await press('Control+p'); check('1', 'mod+P is the palette without commands', (await texts('.hx-pal-group')) === 'Sessions,Bots'); await press('Escape');
    const newTab = await ev(() => new Promise((r) => { const off = __hx.on('hx:new', (d) => { off(); r(d.tab); }); setTimeout(() => r(null), 600); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true, bubbles: true })); }));
    check('1', 'mod+shift+O new (session)', newTab === 'session', newTab);
    page = await s.fresh();
    await press('Alt+2', 500); check('1', 'alt+2 Bots', (await st()).tab === 'bots');
    await press('Alt+1', 500); check('1', 'alt+1 Session', (await st()).tab === 'session');
    await press('Control+BracketLeft', 500); check('1', 'mod+[ back', (await st()).tab === 'bots');
    await press('Control+BracketRight', 500); check('1', 'mod+] forward', (await st()).tab === 'session');
    await press('Control+b', 500); check('1', 'mod+B collapses to the rail', (await st()).left === 'rail');
    await press('Control+b', 500); check('1', 'mod+B opens', (await st()).left === 'open');
    await press('Control+Shift+b', 500); check('1', 'mod+shift+B hides', (await st()).left === 'closed');
    await press('Control+Shift+b', 500); check('1', 'mod+shift+B shows', (await st()).left === 'open');
    await press('Control+i', 500); check('1', 'mod+I details (Session)', (await st()).right === 'open'); await press('Control+i', 500);
    await press('Control+j', 600); check('1', 'mod+J dock off', (await st()).dock === 'off');
    await press('Control+j', 900); check('1', 'mod+J dock on', (await st()).dock === 'on');
    /* v7: the dock has one row and one open size; mod+shift+J opens what waits on you (the stack of asks) and folds it again */
    await press('Control+Shift+j', 900); check('1', 'mod+shift+J opens the asks in the dock', (await dockMode()) === 'expanded' && (await ev(() => __hx.dock().state.open)) === 'stack', await dockMode());
    await press('Control+Shift+j', 900); check('1', 'mod+shift+J folds it to the row', (await dockMode()) === 'normal' && (await ev(() => __hx.dock().state.open)) === null, await dockMode());
    await press('Control+Comma', 400); check('1', 'mod+, Settings', (await layer()).settings);
    await press('Escape', 300); check('1', 'Esc closes Settings', !(await layer()).settings);
    await press('Control+Shift+Comma', 400); check('1', 'mod+shift+, Appearance', await ev(() => !document.getElementById('hx-dpanel-appearance').hidden && document.getElementById('hx-settings').open)); await press('Escape', 300);
    await press('Control+Shift+l', 300); check('1', 'mod+shift+L light', (await ev(() => __hx.theme.scheme())) === 'light');
    await press('Control+Shift+l', 300); check('1', 'mod+shift+L back to dark', (await ev(() => __hx.theme.scheme() + ' ' + __hx.theme.get().preset)) === 'dark catalog');
    await press('Control+Slash', 400); check('1', 'mod+/ shortcut sheet', (await layer()).sheet);
    check('1', 'the sheet lists alt+V', await ev(() => /Talk/.test(document.getElementById('hx-keys-body').textContent))); await press('Escape', 300);
    check('1', 'Esc closes the sheet', !(await layer()).sheet);
    const seen = [];
    for (let i = 0; i < 6; i++) { await press('F6', 200); seen.push((await where()).region); }
    check('1', 'F6 visits every open region', ['bar', 'list', 'messages', 'composer', 'dock'].every((r) => seen.includes(r)), seen.join(' > '));
    await press('F8', 400); const a1 = await where(); check('1', 'F8 to the first thing that needs you', a1.region === 'messages' || a1.region === 'dock', a1);
    await press('F8', 500); check('1', 'F8 crosses to the other tab', (await st()).tab === 'bots');
    await press('Alt+1', 400);
    for (const [k, r] of [['l', 'list'], ['m', 'messages'], ['i', 'composer'], ['d', 'dock']]) { await press('Control+g', 120); await press(k, 300); check('1', 'mod+G ' + k.toUpperCase(), (await where()).region === r, (await where()).region); }
    await press('Control+g', 120); await press('p', 500); check('1', 'mod+G P opens and focuses the panel', (await st()).right === 'open' && (await where()).region === 'panel', await where()); await press('Control+i', 400);
    await press('Control+g', 120); await press('b', 500); check('1', 'mod+G B', (await st()).tab === 'bots');
    await press('Control+g', 120); await press('s', 500); check('1', 'mod+G S', (await st()).tab === 'session');
    await press('Control+g', 120); await press('3', 600); check('1', 'mod+G 3 is bot 3', (await st()).tab === 'bots' && (await title()).length > 0, await title());
    await press('Alt+1', 400);
    await press('Control+g', 120); await press('i', 300); await press('Escape', 300); check('1', 'Esc from the composer to the conversation', (await where()).region === 'messages');
  });

  /* section 2: the navigation layer */
  page = await s.fresh();
  await s.safe('2', async () => {
    await ev(() => document.activeElement && document.activeElement.blur());
    await press('Shift+Slash', 400); check('2', '? opens the sheet', (await layer()).sheet); await press('Escape', 300);
    await ev(() => document.activeElement && document.activeElement.blur());
    await press('g', 100); await press('l', 300); check('2', 'g L list', (await where()).region === 'list');
    await ev(() => document.activeElement.blur()); await press('Slash', 300); check('2', '/ composer', (await where()).region === 'composer');
    await press('Escape', 300); await press('i', 300); check('2', 'i composer (from the conversation)', (await where()).region === 'composer');
  });

  /* section 4: lists */
  page = await s.fresh();
  await s.safe('4', async () => {
    await press('Control+g', 100); await press('l', 300);
    const r0 = await where(); await press('ArrowDown'); const r1 = await where();
    check('4', 'down moves to the next row', r1.region === 'list' && r1.label !== r0.label, r0.label + ' -> ' + r1.label);
    await press('k'); check('4', 'k previous row', (await where()).label === r0.label);
    await press('j'); check('4', 'j next row', (await where()).label === r1.label);
    await press('End'); const e = await where(); await press('Home'); const h = await where();
    check('4', 'Home and End', e.label !== h.label, h.label + ' / ' + e.label);
    await press('Shift+ArrowDown'); const g = await where(); check('4', 'shift+down next project', g.label !== h.label && g.region === 'list', g.label);
    const t0 = await title(); await press('Enter', 500); const t1 = await title();
    check('4', 'Enter opens the row, focus stays', t1 !== t0 && (await where()).region === 'list', t0 + ' -> ' + t1);
    await press('Escape', 300); check('4', 'Esc to the conversation', (await where()).region === 'messages');
    await press('Alt+2', 500); await press('Control+g', 100); await press('l', 300);
    const b0 = await where(); await press('ArrowDown'); const b1 = await where();
    check('4', 'the bots list moves with down', b1.region === 'list' && b0.label !== b1.label, b0.label + ' -> ' + b1.label);
    await press('Enter', 500); check('4', 'the bots list opens on Enter', (await title()).length > 0 && (await where()).region === 'list', await title());
  });

  /* section 5: the conversation, and 6: the blank popover */
  page = await s.fresh();
  await s.safe('5', async () => {
    await press('Control+g', 100); await press('m', 300);
    const t0 = await where(); check('5', 'a turn is focused', t0.turn, t0.label);
    await press('ArrowUp'); const t1 = await where(); check('5', 'up previous turn', t1.turn && t1.label !== t0.label, t1.label);
    await press('j'); check('5', 'j next turn', (await where()).label === t0.label);
    await press('Home'); const h = await where(); await press('End'); const e = await where();
    check('5', 'Home and End', h.label !== e.label && h.turn && e.turn, h.label + ' / ' + e.label);
    await press('Home'); await press('g', 100); await press('g', 200); check('5', 'g g first turn', (await where()).label === h.label);
    await press('Shift+G'); check('5', 'shift+G latest turn', (await where()).label === e.label);
    const exp = () => ev(() => { const t = document.activeElement; const d = t.querySelector('[aria-expanded]'); return d ? d.getAttribute('aria-expanded') : null; });
    await press('Home'); await press('ArrowDown');
    const x0 = await exp(); await press('Enter', 400); const x1 = await exp();
    check('5', 'Enter opens the steps', x0 !== null && x0 !== x1, x0 + ' -> ' + x1);
    await press('o', 400); check('5', 'o closes the steps', (await exp()) === x0);
    await press('c', 400); check('5', 'c copies (toast)', await ev(() => /copied/i.test((document.querySelector('.k7-notify[data-in]') || document.querySelector('.ui-toast.is-in') || {}).textContent || '')));
    /* the blank is the kit's question (AskCard): B goes to its answers */
    await press('b', 500); check('5', 'b goes to the blank\'s answers', await ev(() => !!document.activeElement?.closest('[data-blank]')));
    await press('1', 300); const picked = await where(); await press('Enter', 600);
    check('6', '1 picks a blank option, Enter confirms', /alias/i.test(picked.label) && await ev(() => !!document.querySelector('#hx-view-session [data-answered]') && !__hx.ui.popover.current), picked.label);
    await ev(() => document.querySelector('#hx-view-session [data-hx-turn]').focus()); await press('e', 500); const ed = await where();
    check('5', 'e edits your message', ed.region === 'composer' && (await ev(() => document.activeElement.textContent.length)) > 10, ed);
    await press('Escape', 300); await press('d', 600);
    check('5', 'd opens the diff', await ev(() => !!document.querySelector('.ss-diff:not([hidden])') || __hx.state.right === 'open'), await ev(() => document.activeElement.className));
  });

  /* section 6: cards. The blank's Esc, an approval's hold (Space, Enter twice) and its deny */
  page = await s.fresh();
  await s.safe('6', async () => {
    await press('Control+g', 100); await press('m', 300); await press('b', 500);
    /* the blank is the kit's question in the thread: B is on its first answer, and there is no popover to close */
    check('6', 'b puts the focus on the blank\'s first answer', (await where()).region === 'messages' && await ev(() => !!document.activeElement?.closest('[data-blank]')), await where());
    await press('Alt+2', 600);
    /* the Bots chat's approval is the kit's AskCard (v7): its hold chip carries data-holding, then data-held */
    const holdSel = '#hx-view-bots [data-kit~="AskCard"] [data-hold]';
    await page.focus(holdSel);
    await page.keyboard.down('Space'); await page.waitForTimeout(500);
    const mid = await ev((q) => { const b = document.querySelector(q); return b.dataset.state || (b.hasAttribute('data-holding') ? 'holding' : 'idle'); }, holdSel);
    await page.keyboard.up('Space'); await page.waitForTimeout(400);
    const early = await ev((q) => { const b = document.querySelector(q); return b && (b.dataset.state || (b.hasAttribute('data-held') ? 'done' : 'idle')); }, holdSel);
    check('6', 'releasing Space early cancels', mid === 'holding' && early !== 'done', mid + ' -> ' + early);
    await page.focus(holdSel); await page.keyboard.down('Space'); await page.waitForTimeout(1150); await page.keyboard.up('Space'); await page.waitForTimeout(500);
    check('6', 'holding Space for 1 s approves', await ev(() => { const b = document.querySelector('#hx-view-bots [data-kit~="AskCard"] [data-hold]'); return !b || b.hasAttribute('data-held') || /approved|allowed/i.test(document.querySelector('#hx-view-bots').textContent); }));
    page = await s.fresh(); await press('Alt+2', 600);
    await page.focus(holdSel); await press('x', 500);
    check('6', 'x denies', await ev(() => /denied/i.test(document.querySelector('#hx-view-bots').textContent) && !document.querySelector('#hx-view-bots [data-kit~="AskCard"][data-state="needs"] [data-hold]')));
    page = await s.fresh(); await press('Alt+2', 600);
    await page.focus(holdSel); await press('Enter', 200); await press('Enter', 600);
    check('6', 'Enter twice approves', await ev(() => { const b = document.querySelector('#hx-view-bots [data-kit~="AskCard"][data-state="needs"] [data-hold]'); return !b || b.hasAttribute('data-held'); }));
  });

  /* section 7: the composer */
  page = await s.fresh();
  await s.safe('7', async () => {
    await press('Control+g', 100); await press('i', 300);
    const pressed = (re) => ev((re) => { const b = [...document.querySelectorAll('#hx-view-session [data-hx-composer] button')].find((x) => new RegExp(re, 'i').test(x.getAttribute('aria-label') + ' ' + x.textContent)); return b ? (b.getAttribute('aria-pressed') || b.getAttribute('aria-checked') || b.textContent.trim()) : null; }, re);
    /* the line shows what board S20 shows; governed mode is the provider's state (alt+G toggles it where the session has no permission scale) */
    const gov = () => ev(() => __hx.data().details.governance.get().governed);
    const g0 = await gov(); await press('Alt+g'); const g1 = await gov(); check('7', 'alt+G toggles governed', g0 !== g1, g0 + ' -> ' + g1);
    await press('Alt+g');
    const smart = () => ev(() => __hx.data().details.governance.get().smart);
    const s0 = await smart(); await press('Alt+s'); const s1 = await smart(); check('7', 'alt+S toggles smart', s0 !== s1, s0 + ' -> ' + s1);
    await press('Alt+s');
    await press('Alt+a', 400); const a = await layer(); check('7', 'alt+A attach', a.menu || a.pop); await press('Escape', 300);
    await ev(() => document.querySelector('#hx-view-session [data-hx-focus="composer"]').focus());
    const mic = () => ev(() => { const m = document.querySelector('#hx-view-session [data-mic]'); return m ? m.getAttribute('aria-pressed') : 'no mic'; });
    await press('Alt+v', 400); const v1 = await mic(); await press('Escape', 400); const v2 = await mic();
    check('7', 'alt+V taps to listen, Esc stops', v1 === 'true' && v2 !== 'true' && (await where()).region === 'composer', v1 + ' -> ' + v2);
    /* the kit's mic is a switch: a press, or alt+V, turns dictation on and off (the v6 composer's talk-while-held is not the kit's) */
    await ev(() => { const i = document.querySelector('#hx-view-session [data-hx-focus="composer"]'); i.textContent = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(300);
    await ev(() => document.querySelector('#hx-view-session [data-hx-focus="composer"]').focus()); await page.waitForTimeout(100);
    await press('ArrowUp', 400); check('7', 'up on an empty composer edits the last message', (await ev(() => document.querySelector('#hx-view-session [data-hx-focus="composer"]').textContent.length)) > 10);
    const turns0 = await ev(() => document.querySelectorAll('#hx-view-session [data-hx-turn]').length);
    await page.keyboard.press('Control+a'); await page.keyboard.type('line one'); await press('Shift+Enter', 100); await page.keyboard.type('line two');
    check('7', 'shift+Enter breaks the line', /line one\s*\n?\s*line two/.test(await ev(() => document.querySelector('#hx-view-session [data-hx-focus="composer"]').innerText)));
    await press('Enter', 900); const turns1 = await ev(() => document.querySelectorAll('#hx-view-session [data-hx-turn]').length);
    check('7', 'Enter sends', turns1 > turns0, turns0 + ' -> ' + turns1);
    const stop = await ev(() => { const e = new KeyboardEvent('keydown', { key: '.', code: 'Period', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    check('7', 'mod+. is answered by the session while it runs', stop);
    await press('Control+f', 400); check('1', 'mod+F find (the session provides it)', await ev(() => { const a = document.activeElement; return !!a && !!a.closest('#hx-view-session, .ui-pop, #hx-app') && a.matches('input, [role="searchbox"], [type="search"]'); }));
  });

  /* section 7: alt+M (or the model chip) opens "who answers next"; the first entry is Automatic (Smart); the chip always says who answers */
  page = await s.fresh();
  await s.safe('7', async () => {
    await press('Control+g', 100); await press('i', 300);
    /* the session composer's line (board S20): the model item says who answers next and opens the kit's menu */
    const chip = () => ev(() => { const b = document.querySelector('#hx-view-session .ss-composer [data-line="model"]'); return { hidden: !b || b.hidden, text: (b?.textContent ?? '').trim(), label: b?.getAttribute('aria-label') ?? '' }; });
    const c0 = await chip();
    check('7', 'the line\'s model item is always shown and says Smart answers next', !c0.hidden && /^Smart/.test(c0.text) && /^Who answers next: Smart/.test(c0.label), c0);
    await press('Alt+m', 500);
    const first = await ev(() => { const m = document.querySelector('.k7-menu[data-floating]'), it = m?.querySelector('[data-kit~="MenuRow"]'); return it ? { label: it.textContent.trim(), checked: it.getAttribute('aria-checked'), role: m.getAttribute('role'), foot: m.querySelectorAll('.k7-menu__head').length > 0 } : null; });
    check('7', 'alt+M opens the menu, Automatic (Smart) first and chosen, with a hint', (await layer()).menu && first && first.role === 'menu' && /^Automatic \(Smart\)/.test(first.label) && first.checked === 'true' && first.foot, first);
    await press('Escape', 300);
    check('7', 'Esc changes nothing', /^Smart/.test((await chip()).text) && !(await layer()).menu && (await where()).region === 'composer', await where());
    await press('Alt+m', 500);
    await page.click('.k7-menu[data-floating] [data-kit~="MenuRow"] >> text=Haiku'); await page.waitForTimeout(400);
    const c1 = await chip();
    check('7', 'picking a model makes it answer next and turns Smart off', !/^Smart/.test(c1.text) && /haiku/i.test(c1.text), c1);
    await press('Alt+m', 500); await page.click('.k7-menu[data-floating] [data-kit~="MenuRow"] >> text=Automatic'); await page.waitForTimeout(400);
    check('7', 'choosing Automatic turns Smart back on', /^Smart/.test((await chip()).text) && (await where()).region === 'composer', await where());
    await press('Alt+s', 300);
    check('7', 'alt+S turns Smart off', !/^Smart/.test((await chip()).text), await chip());
  });

  /* section 8: the dock (v7: the row of your bots; Enter and Space open a bot's card in the dock, mod+Enter the full chat).
     Gone with the v7 dock (DESIGN-SYSTEM.md v7 21.4: one page, no minimal mode): "[" and "]" between pages, up and down for its size */
  page = await s.fresh();
  await s.safe('8', async () => {
    const card = () => ev(() => { const d = __hx.dock().state, p = document.querySelector('#hx-dock .k7-dock__panel[data-open="card"]'); return d.open === 'card' && !!p && p.getClientRects().length > 0 ? d.card : null; });
    await press('Control+g', 100); await press('d', 400);
    const d0 = await where(); check('8', 'focus lands on a dock bot', d0.region === 'dock' && d0.cls.includes('k7-dock__orb'), d0.label);
    await press('ArrowRight'); const d1 = await where(); check('8', 'right moves to the next bot', d1.label !== d0.label && d1.region === 'dock', d1.label);
    await press('End'); const e = await where(); await press('Home'); const h = await where(); check('8', 'Home and End', e.label !== h.label, h.label + ' / ' + e.label);
    const first = await ev(() => document.activeElement.dataset.bot);
    await press('Space', 1000); check('8', 'Space opens the bot\'s card in the dock', (await card()) === first && (await st()).tab === 'session', await dockMode());
    await press('Escape', 1200); check('8', 'Esc closes the card, focus on its orb', !(await card()) && (await where()).region === 'dock' && (await ev(() => document.activeElement.dataset.bot)) === first, await where());
    await press('Enter', 1000); check('8', 'Enter opens the card too', (await card()) === first && (await st()).tab === 'session');
    const comp = await ev(() => { const i = document.querySelector('#hx-dock .k7-dock__panel [role="textbox"], #hx-dock .k7-dock__panel [contenteditable]'); if (i) i.focus(); return !!i; });
    check('8', 'the card has a composer', comp);
    if (comp) {
      const mic = () => ev(() => { const m = document.querySelector('#hx-dock [data-mic], #hx-dock .ui-composer__mic'); return m ? m.getAttribute('aria-pressed') : 'no mic'; });
      await press('Alt+v', 400); const on = await mic();
      await press('Escape', 400); const off = await mic();
      check('7', 'alt+V talks in the bot\'s card; Esc stops and the card stays', on === 'true' && off !== 'true' && !!(await card()), on + ' -> ' + off);
      await press('Escape', 1200);
    }
    check('8', 'Esc from the card\'s composer folds the dock', !(await card()), await dockMode());
    await press('Control+g', 100); await press('d', 400); await press('ArrowRight');
    const who = (await where()).label; await press('Control+Enter', 800);
    check('8', 'mod+Enter opens the full chat', (await st()).tab === 'bots' && who.toLowerCase().startsWith((await title()).toLowerCase()), who + ' / ' + (await title()));
    page = await s.fresh();
    await press('Control+g', 100); await press('d', 400); await press('2', 600);
    const second = await ev(() => __hx.dock().botAt(2));
    check('8', '2 focuses bot 2', await ev((id) => !!document.activeElement.closest('#hx-dock') && document.activeElement.dataset.bot === id, second), second + ' / ' + (await where()).label);
    /* the ask pill is the row's last stop (board DK1: a focused bot takes the ring, the pill stays): Enter opens the asks, Esc folds them and returns to it */
    await press('End', 300);
    const pill = await ev(() => !!document.activeElement.closest('.k7-dock__ask'));
    await press('Enter', 900); const open = await ev(() => ({ open: __hx.dock().state.open, on: !!document.activeElement.closest('[data-kit~="AskCard"] [data-hold]') }));
    /* Esc on an ask is its Deny (the chip says "esc"); from the head it folds the asks, and nothing is decided */
    await ev(() => document.querySelector('#hx-dock .k7-dock__head [data-act="close"]').focus());
    await press('Escape', 900); const back = await ev(() => ({ open: __hx.dock().state.open, pill: !!document.activeElement.closest('.k7-dock__ask'), asks: __hx.dock().state.asks }));
    check('8', 'End reaches the ask pill; Enter opens the asks on the first one\'s hold; Esc from the head folds them and returns to the pill', pill && open.open === 'stack' && open.on && back.open === null && back.pill && back.asks === 1, { pill, open, back });
    await press('ArrowLeft', 300);
    check('8', 'left of the pill is "N more", which goes to the Bots tab', await ev(() => document.activeElement.dataset.act === 'more'));
    await press('Enter', 600); check('8', 'Enter on "N more" opens the Bots tab', (await st()).tab === 'bots');
  });

  /* grow on hover, on and off: the hovered row orb grows only when orbGrow is on */
  for (const grow of [true, false]) {
    page = await s.fresh();
    await s.safe('8', async () => {
      if (!grow) await ev(() => __hx.setState({ orbGrow: false }));
      await page.waitForTimeout(300);
      const w = () => ev(() => { const o = document.querySelectorAll('#hx-dock .k7-dock__orb:not([data-out])')[3]; const r = (o.querySelector('.ui-orb') || o).getBoundingClientRect(); return Math.round(r.width * 10) / 10; });
      const rest = await w();
      await page.hover('#hx-dock .k7-dock__orb:not([data-out]) >> nth=3'); await page.waitForTimeout(700);
      const hov = await w();
      check('8', 'grow ' + (grow ? 'on: the hovered orb grows' : 'off: the hovered orb keeps its size'), grow ? hov > rest + 2 : Math.abs(hov - rest) < 1, rest + ' -> ' + hov);
    });
  }

  /* section 9: the details panel */
  page = await s.fresh();
  await s.safe('9', async () => {
    await press('Control+g', 100); await press('p', 600);
    const s0 = await where(); await press('ArrowDown'); const s1 = await where();
    check('9', 'down moves to the next section header', s1.region === 'panel' && s0.label !== s1.label, s0.label + ' -> ' + s1.label);
    const x0 = await ev(() => document.activeElement.getAttribute('aria-expanded')); await press('Enter', 400); const x1 = await ev(() => document.activeElement.getAttribute('aria-expanded'));
    check('9', 'Enter toggles a section', x0 !== x1, x0 + ' -> ' + x1);
    await press('Escape', 300); check('9', 'Esc to the conversation, the panel stays', (await where()).region === 'messages' && (await st()).right === 'open');
    /* on Bots, mod+I is the open bot's details (board 11's pane); its settings sheet opens from a row of it */
    await press('Control+i', 500); await press('Alt+2', 500); await press('Control+i', 600);
    check('9', 'mod+I opens the bot\'s details on Bots', await ev(() => { const p = document.querySelector('#hx-right-bots > [data-kit~="Pane"]'); return !!p && p.getClientRects().length > 0 && __hx.state.right === 'open'; }));
    await ev(() => __hx.emit('hx:bot-settings', { open: true, from: 'keyboard' })); await page.waitForTimeout(600);
    check('9', 'the bot\'s settings sheet opens beside it', await ev(() => { const p = document.querySelector('.bt-sheet[data-hx-panel]'); return !!p && !p.hidden && p.getClientRects().length > 0; }));
  });

  /* section 10: the palette, menus and dialogs */
  page = await s.fresh();
  await s.safe('10', async () => {
    await press('Control+k', 300); const a0 = await ev(() => document.getElementById('hx-palette-input').getAttribute('aria-activedescendant'));
    await press('Tab'); const a1 = await ev(() => document.getElementById('hx-palette-input').getAttribute('aria-activedescendant'));
    check('10', 'palette Tab moves', a0 !== a1, a0 + ' -> ' + a1);
    await press('Shift+Tab'); check('10', 'palette shift+Tab moves back', (await ev(() => document.getElementById('hx-palette-input').getAttribute('aria-activedescendant'))) === a0);
    await page.keyboard.type('>light'); await page.waitForTimeout(200); await press('Enter', 400); check('10', 'palette Enter runs the command', (await ev(() => __hx.theme.scheme())) === 'light');
    await ev(() => __hx.theme.preset('catalog'));
    /* "you" is in the Bots sidebar's foot (boards S17 and 13 draw Store and Settings alone on the Sessions side) */
    await press('Alt+2', 500);
    await page.focus('#hx-btn-account'); await press('Enter', 300);
    const m0 = await where(); await press('ArrowDown'); const m1 = await where(); await press('End'); const me = await where(); await press('Home'); const mh = await where();
    check('10', 'menu down, Home, End', m0.label !== m1.label && me.label !== mh.label, [m0.label, m1.label, mh.label, me.label].join(' | '));
    await press('Escape', 300); check('10', 'menu Esc returns focus to its opener', (await where()).id === 'hx-btn-account');
    await press('Control+Comma', 400);
    const inside = []; for (let i = 0; i < 8; i++) { await press('Tab', 80); inside.push(await ev(() => !!document.activeElement.closest('#hx-settings'))); }
    check('10', 'dialog Tab cycles inside', inside.every(Boolean), inside.join());
    await page.focus('#hx-dtab-general'); await press('ArrowRight', 300); check('10', 'settings tabs move with left and right', await ev(() => document.getElementById('hx-dtab-models').getAttribute('aria-selected') === 'true'));
    check('10', 'Settings > Models in the page build says the engine is not connected, and offers nothing it cannot do', await ev(() => { const p = document.getElementById('hx-dpanel-models'); return !p.hidden && /boopis's engine is not connected/.test(p.textContent) && !document.getElementById('hx-models-change') && !document.getElementById('hx-set-ladder-h'); }));
    await press('ArrowRight', 300); check('10', 'the Models tab is followed by Connectors, which in the page build says it needs the desktop app and offers nothing', await ev(() => { const p = document.getElementById('hx-dpanel-connectors'); return document.getElementById('hx-dtab-connectors').getAttribute('aria-selected') === 'true' && !p.hidden && /desktop app/.test(p.textContent) && !p.querySelector('button, input'); }));
    await press('ArrowRight', 300); check('10', 'the Connectors tab is followed by Appearance', await ev(() => document.getElementById('hx-dtab-appearance').getAttribute('aria-selected') === 'true'));
    await press('ArrowLeft', 300); await press('ArrowLeft', 300); await press('ArrowLeft', 300); await page.focus('#hx-dpanel-general .ui-seg [aria-checked="true"]'); await press('ArrowRight', 300);
    check('10', 'segmented control left and right', await ev(() => document.querySelector('#hx-dpanel-general .ui-seg [aria-checked="true"]').dataset.value === 'closed'));
    await press('Escape', 300); check('10', 'Esc closes the dialog, focus returns', !(await layer()).settings && (await where()).id !== null, await where());
  });
  await s.close();
}
