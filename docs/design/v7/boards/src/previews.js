/* Previews after the owner's picks (23 Nov): P1 accent, P2 search placements, P3 the mark, P4 status. */
(function () {
  const { I, orb, stack, mark } = window.V7;
  const S = window.SCREENS;
  const T = ['dark', 'light'];
  const cell = (theme, attrs, inner, style = '') => `<div class="v7 cell" data-theme="${theme}" ${attrs} style="${style}">${inner}</div>`;
  const pair = (attrs, fn, style) => `<div class="pair">${T.map((t) => cell(t, attrs, fn(t), style)).join('')}</div>`;
  const stackT = (fn, style) => `<div class="pair" style="grid-template-columns:1fr">${T.map((t) => cell(t, '', fn(t), style)).join('')}</div>`;
  const sec = (title, sub, body, note) => `<section><div class="opt-h"><b>${title}</b><span>${sub || ''}</span></div>${body}${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, sections) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${sections.join('')}</div></div>`;
  const clip = (w, h, inner) => `<div style="width:${w}px;height:${h}px;overflow:hidden;position:relative"><div style="position:absolute;left:0;top:0">${inner}</div></div>`;
  const win = (fn, o) => fn(Object.assign({ chrome: 'a', tile: 'a', composer: 'c', status: 'c', accent: 'iris' }, o));
  const cap = (t) => `<div class="cap">${t}</div>`;

  /* P1: the five indigo candidates with amber attention beside them */
  function accent() {
    const C = [['iris', 'Iris', '#5b5bd6 / #8b8dff / #4546c8', 'white on fill 5.4:1; fill on #121212 3.5:1'], ['indigo', 'Indigo', '#4f46e5 / #8f8cff / #4338ca', 'white on fill 6.3:1; fill on #121212 3.0:1 (just under 3:1 as a mark)'],
      ['ultramarine', 'Ultramarine', '#3e4fd8 / #7d8cff / #3241c4', 'white on fill 6.3:1; fill on #121212 2.96:1 (under 3:1 as a mark)'], ['violet', 'Violet-indigo', '#5e4ad9 / #9d8cff / #4d3bc4', 'white on fill 6.1:1; fill on #121212 3.1:1'],
      ['soft', 'Soft indigo', '#6366f1 / #9497ff / #4f4fd8', 'white on fill 4.47:1 (under 4.5); fill on #121212 4.2:1']];
    const vignette = (k) => (t) => `<div class="row" style="gap:28px;align-items:flex-start" data-accent="${k}">
      <div class="col" style="gap:14px"><span class="row" style="gap:12px"><span class="switch on"></span><span class="switch"></span></span>
        <div class="q" style="width:260px"><div class="opt"><span class="lt">A</span>People who use boopis</div><div class="opt on"><span class="lt">B</span>Both, in two sections</div></div>
        <span class="s" style="color:var(--accent-text);text-decoration:underline;text-underline-offset:3px">Manage approval rules</span></div>
      <div class="col" style="gap:14px;width:300px"><div class="banner">${I('check')}Your engine is on the latest version</div>
        <span class="btn" style="align-self:flex-start;outline:2px solid var(--focus);outline-offset:2px">Focused button</span>
        <div style="height:6px;border-radius:99px;background:var(--fill-2);overflow:hidden"><div style="width:38%;height:100%;background:var(--accent)"></div></div></div>
      <div class="col" style="background:var(--bg-1);padding:8px;border-radius:14px;width:290px">
        <div class="sb-row">${orb('nina', 36, { surface: 'var(--bg-1)', state: 'needs' })}<div class="col grow"><span class="nm">nina</span><span class="act owe">Needs you: approve a deploy</span></div><span class="dot owe"></span></div>
        <div class="sb-row">${orb('kai', 36, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm">kai</span><span class="act">Writing the changelog</span></div></div>
        <div class="row" style="gap:10px;padding:8px 10px"><span class="you">${I('user')}you</span><span class="word" style="color:var(--red-text)">failed</span><span class="btn xs danger">Delete</span></div></div></div>`;
    return board('P1 Accent: the indigo candidates, with amber attention', 'The owner picked an indigo default accent, editable in custom themes, and Grok\'s amber for "needs you" (red stays for failed and destructive confirms). Each candidate is shown in board 09\'s vignette (switch, chosen option, link, focus ring, progress, info banner) beside the amber attention row (the sidebar\'s needs-you line and dot, the "you" capsule) and red\'s two remaining uses. Values: fill / dark-theme text / light-theme text. Iris is the placeholder in the key screens.',
      C.map(([k, n, v, note]) => sec(n, v, pair('', vignette(k)), note)));
  }

  /* P2: where search lives; each on and off */
  function search() {
    const top = (o) => (t) => clip(1440, o.h || 150, win(S.botChat, { theme: t, noDock: true, ...o }));
    const row = (title, sub, oOn, oOff, note) => sec(title, sub, `<div class="pair" style="grid-template-columns:1fr">${T.map((t) => cell(t, '', cap('SEARCH ON') + top(oOn)(t) + `<div style="height:14px"></div>` + cap('SEARCH OFF (ctrl K still opens the palette)') + top(oOff)(t), 'padding:18px 0 18px 0')).join('')}</div>`, note);
    return board('P2 Search placements', 'The owner\'s rule: search is always reachable (ctrl K opens the palette from anywhere, and the palette is in the keyboard sheet) and its visible control can be turned off in Settings > General > Layout ("Show search"). The floating button (A, the standard) and the search pill (B) are settings; three more placements are offered. Each is shown on, then off.', [
      row('S1. The floating search button (chrome A, standard)', 'a 36 circle beside the details button; its tooltip says "Search ctrl K"', { search: 'button' }, { search: 'none' }),
      row('S2. The search pill beside the title (chrome B, a Settings option)', 'boopis\'s command field kept as a centred pill with its key chips', { chrome: 'b', search: 'pill' }, { chrome: 'b', search: 'none' }),
      row('S3. A search field at the top of the open sidebar', 'Grok\'s rail has a search button there; with the sidebar collapsed it is the rail\'s first glyph', { sidebar: 'open', search: 'side', h: 220 }, { sidebar: 'open', search: 'none', h: 220 }, 'Close to where people look for a bot or a session; nothing in the chrome.'),
      row('S4. Inside the title pill\'s menu', 'the title pill gains a chevron; its menu starts with Search, then Details, Rename, Copy link', { search: 'menu', h: 330 }, { search: 'menu-off', h: 330 }, 'The calmest chrome, but search is two clicks away for the pointer.'),
      row('S5. Keyboard only, with a hint', 'no control: a quiet "ctrl K to search" in the drag region, fading after the first use', { search: 'hint' }, { search: 'none' }, 'The most Grok-like; relies on the palette, which every path already has (principle 8).')]);
  }

  /* P3: the mark: one primitive, three contexts (feedforward, blanks, info labels) */
  function marks() {
    const pop = (txt, x, y) => `<div class="pop sq" style="left:${x}px;top:${y}px">${txt}</div>`;
    const m = (txt, st, p, extra = '') => `<span class="mk2${extra}" data-state="${st}"${p ? ` style="--p:${p}"` : ''}>${txt}</span>`;
    const comp = (inner, menu) => `<div style="position:relative;width:440px;height:200px"><div class="composer sq" style="width:440px;border-radius:var(--r-composer)"><div class="line" style="height:auto;min-height:44px;padding:8px;align-items:flex-start"><span class="ib s">${I('plus')}</span><span class="grow" style="padding:3px 4px 3px;font-size:14px;line-height:22px">${inner}</span><span class="ib s inv">${I('arrowup')}</span></div></div>${menu || ''}</div>`;
    const ff = (st) => (t) => st === 1 ? comp(`Make the ${m('dock', 'shown', '55%')} stop losing half`)
      : st === 2 ? comp(`Make the ${m('dock', 'shown')} stop losing half in the ${m('webkit build', 'shown', '40%')}`)
      : st === 3 ? comp(`Make the ${m('dock', 'shown')} stop losing half in the ${m('webkit build', 'hover')}`)
      : st === 4 ? comp(`Make the ${m('dock', 'shown')} stop losing half in the ${m('webkit build', 'open')}`, `<div class="menu sq" style="position:absolute;left:140px;top:62px;width:260px"><div class="mt">I read "webkit build" as</div><div class="mi sq">${I('check')}the Linux app (WebKitGTK)</div><div class="mi sq hov"><span style="width:16px"></span>the macOS app (WebKit)</div><div class="mi sq"><span style="width:16px"></span>Something else…</div></div>`)
      : comp(`Make the ${m('dock', 'shown')} stop losing half in the ${m('macOS app', 'chosen')}`);
    const reply = (inner, card) => `<div style="position:relative;width:440px;height:250px"><div class="b agent sq" style="max-width:440px">${inner}</div>${card || ''}</div>`;
    const ask = (head, title, sub, actions) => `<div class="qcard sq"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${head}</div><div class="m" style="margin-bottom:8px">${title}</div>${sub || ''}${actions}</div>`;
    const qc = (who, q, body) => ask(`${mark('claude', 14)}asked during the turn`, q, '', body);
    const bl = (st) => (t) => st === 1 ? reply(`The notes are ready. I'll deploy them to ${m('', 'waiting-owe', '', ' gap')}<span class="blank-count">0:42</span><span class="blank-word lapsed">waiting for you</span>`, `<div class="xs dim" style="margin:8px 4px">paused until you answer or the time runs out</div>`)
      : st === 2 ? reply(`The notes are ready. I'll deploy them to ${m('staging', 'chosen')} once the gate is green. Tagging 0.2.0 now<span class="stream-caret"></span>`)
      : st === 3 ? reply(`The notes are ready. I'll deploy them to ${m('staging', 'shown', '', ' guess')} (my guess) once the gate is green. Tagged 0.2.0.`, qc('session', 'Deploy to which environment?', `<div class="row" style="gap:6px"><span class="chip on">staging</span><span class="chip">production</span><span class="chip out">Something else</span></div>`))
      : st === 4 ? reply(`The notes are ready. I'll deploy them to ${m('staging', 'shown', '', ' guess')} (my guess) once the gate is green. Tagged 0.2.0.`, qc('session', 'Deploy to which environment?', `<div class="row" style="gap:8px"><span class="mk2" data-state="chosen">production</span><span class="xs dim">sent as a correction</span></div>`))
      : `<div style="position:relative;width:440px;height:250px">${ask(`${orb('nina', 16, { state: 'needs', still: true, surface: 'var(--bg-3)' })}nina asks<span class="grow"></span><span class="stamp"><span class="dot owe"></span>needs you</span>`, 'Run a command: git push origin main', `<div class="xs dim ell" style="margin:-4px 0 8px">Rule: <span style="color:var(--accent-text);text-decoration:underline;text-underline-offset:3px">“Pushes to a shared branch”</span></div>`, `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip on">Hold to allow once</span><span class="chip">Allow all this turn</span><span class="chip">Always allow</span><span class="chip out">Deny <span class="kbd" style="margin-left:2px;height:18px">esc</span></span></div>`).replace('class="qcard sq"', 'class="qcard sq" style="margin-top:0"')}
        <div class="xs dim" style="margin:8px 4px">no countdown: it waits until answered</div></div>`;
    const info = (st) => (t) => {
      const lab = (txt, s, f) => `<span class="mk2${f ? ' focus' : ''}" data-state="${s}">${txt}</span>`;
      const s1 = st === 1 ? '' : st === 2 ? 'shown' : st === 3 ? 'hover' : st === 4 ? 'open' : 'shown';
      return `<div style="position:relative;width:300px;height:200px"><div class="card sq" style="width:300px">
        <div class="sr sq${st === 2 || st === 3 || st === 4 ? ' hov' : ''}"><div class="lb">${lab('Autonomy', s1, st === 5)}</div><span class="seg"><span class="on">Ask</span><span>Go</span></span></div>
        <div class="sr"><div class="lb">${lab('Spend cap', '')}</div><span class="val mono">none</span></div></div>
        ${st === 4 ? pop('How far the bot goes before it asks you. Ask stops at every approval rule.', 20, 52) : ''}</div>`;
    };
    const strip = (fn, labels) => `<div class="pair" style="grid-template-columns:1fr">${T.map((t) => cell(t, '', `<div class="row" style="gap:20px;align-items:flex-start">${labels.map((l, i) => `<div>${cap(l)}${fn(i + 1)(t)}</div>`).join('')}</div>`)).join('')}</div>`;
    return board('P3 The mark: one dashed underline for the whole app', 'One primitive for boopis\'s three dashed uses (DESIGN-SYSTEM.md 17): the same dash (3 on 2, 1px, 3px under the baseline), the same draw-in (left to right, 180 ms, --ease-sharp), the same hover and focus, the same solid accent for a filled or chosen mark, the same 120 ms fade out. The contexts differ only in whether the mark shows at rest and in what opening it does. Feedforward and blanks are always visible (that is the feature); info labels are the only marks hidden at rest. Reduced motion: every change is instant, no sweep.', [
      sec('1. Feedforward, in the composer', 'always visible: each newly marked span draws in once as the reading arrives; marks already there stay still; alt+Down or a click opens the reading; the person\'s choice turns solid accent', strip(ff, ['A READING ARRIVES: "DOCK" DRAWS IN', 'TYPING ON: ONLY THE NEW SPAN DRAWS', 'HOVER', 'THE READING, OPEN (alt+Down)', 'READING CHANGED: SOLID ACCENT'])),
      sec('2. Blanks, in a session\'s reply (sessions only)', 'always visible. A blank waits inline for a limited time with a countdown, the agent paused and the blank amber; answered in time it turns solid accent in the same reply; unanswered it lapses: the agent goes on with its guess and the question stays answerable as a card, where a late answer is a correction. Bots never leave blanks: they ask through approvals, drawn with the same card (AskCard, the last frame), with no countdown', strip(bl, ['SESSION: WAITING, COUNTING DOWN', 'ANSWERED IN TIME: SAME REPLY', 'LAPSED: THE AGENT WENT ON, A CARD ASKS', 'ANSWERED LATER: A CORRECTION', 'THE SAME CARD: A BOT\'S APPROVAL'])),
      sec('3. Info labels', 'hidden at rest; hovering the row draws the mark in; hovering the label opens the popover (300 ms); keyboard focus reveals it too; with no hover the marks show at rest', strip(info, ['REST', 'ROW HOVER: DRAWS IN', 'LABEL HOVER', 'POPOVER OPEN', 'KEYBOARD FOCUS'])),
      sec('Reduced motion', 'the same states, changed at once: a new mark appears whole, no sweep, no fade', `<div class="pair">${T.map((t) => cell(t, '', `<div class="row" style="gap:22px">${ff(2)(t).replace('--p:40%', '--p:100%')}${bl(1)(t)}</div>`)).join('')}</div>`)]);
  }

  /* P4: status: the bot's live orb and shimmer, the session's model logo */
  function status() {
    const frames = [['18%', 0.55, 0.92], ['50%', 0.8, 0.96], ['82%', 1, 1]];
    const botF = (i) => `<div class="activity" style="margin:0">${orb('kai', 16, { state: 'working', surface: 'var(--bg-2)' })}<span class="shimmer" style="background-position:${100 - parseInt(frames[i][0])}% 0">Reading the changelog</span></div>`;
    const sesF = (fam, i, phrase) => `<div class="activity" style="margin:0">${mark(fam, 16).replace('style="flex:none"', `style="flex:none;opacity:${frames[i][1]};transform:scale(${frames[i][2]})"`)}<span class="shimmer" style="background-position:${100 - parseInt(frames[i][0])}% 0">${phrase}</span></div>`;
    const rowF = (fn) => (t) => `<div class="row" style="gap:44px">${[0, 1, 2].map((i) => `<div>${cap('FRAME ' + (i + 1) + ' OF 3 (0, 0.7, 1.4 S)')}${fn(i)}</div>`).join('')}<div>${cap('REDUCED MOTION')}${fn(2).replace(/opacity:[0-9.]+;transform:scale\([0-9.]+\)/, 'opacity:1').replace(/background-position:[^"]+/, 'background-position:100% 0')}</div></div>`;
    return board('P4 Status: the bot\'s live orb, the session\'s model logo', 'One status line, one shimmer (2.2 s sweep, the phrase held at least 800 ms), one configuration. A bot shows its own 16 px orb, live in its working face. A normal session (the nameless agent) shows the logo of the model answering, from the provider marks boopis already ships (LobeHub, MIT, monochrome in --text-dim), breathing on the working pulse (opacity .55 to 1, scale .92 to 1, 1.4 s); waiting shows the logo still and no sweep. Reduced motion: both still, no sweep. How the session screen itself should look is the next discussion with the owner; this only replaces the dot.', [
      sec('A bot', 'kai, working', stackT(rowF(botF))),
      sec('A session answered by Claude', '', stackT(rowF((i) => sesF('claude', i, 'Running the tests')))),
      sec('A session answered by OpenAI', '', stackT(rowF((i) => sesF('openai', i, 'Reading 6 files')))),
      sec('A session answered by Gemini', '', stackT(rowF((i) => sesF('gemini', i, 'Writing dock.css'))))]);
  }

  window.PREVIEWS = { p1: accent, p2: search, p3: marks, p4: status };
})();
