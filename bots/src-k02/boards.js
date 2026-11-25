/* The owner's option boards: each open choice as 2-3 options, dark and light, at app scale (1:1 CSS px). */
(function () {
  const { I, orb, stack } = window.V7;
  const S = window.SCREENS;
  const T = ['dark', 'light'];
  const cell = (theme, attrs, inner, style = '') => `<div class="v7 cell" data-theme="${theme}" ${attrs} style="${style}">${inner}</div>`;
  const pair = (attrs, fn, style) => `<div class="pair">${T.map((t) => cell(t, attrs, fn(t), style)).join('')}</div>`;
  const opt = (letter, title, sub, rec, body, note) => `<section><div class="opt-h"><b>${letter}. ${title}</b><span>${sub}</span>${rec ? '<span class="rec">RECOMMENDED</span>' : ''}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, sections) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${sections.join('')}</div></div>`;
  const clip = (w, h, inner, o = {}) => `<div style="width:${w}px;height:${h}px;overflow:hidden;position:relative;border-radius:${o.r ?? 10}px;${o.style || ''}"><div style="position:absolute;left:${-(o.x || 0)}px;top:${-(o.y || 0)}px;${o.bottom ? 'top:auto;bottom:0' : ''}">${inner}</div></div>`;
  const win = (fn, o) => fn(Object.assign({ chrome: 'a', tile: 'a', composer: 'b', status: 'c' }, o)).replace(/^<div class="win v7"/, '<div class="win v7" style="border-radius:0"');

  /* shared samples */
  const typeRamp = () => `<div class="col" style="gap:6px">
    ${[['3xl', 26, 400, 'Meet your team'], ['2xl', 22, 400, 'Give each bot a job'], ['xl', 17, 500, 'General'], ['l', 15, 400, 'Notes are in CHANGELOG.md, two sections.'], ['l', 15, 600, 'Who are the notes for?'], ['m', 14, 400, 'Show the dock  Hold to approve  Message kai'], ['s', 13, 400, 'Writing the changelog  Enter starts a new line'], ['xs', 12, 400, 'Today 10:05  Recommended  needs you']]
      .map(([k, px, w, t]) => `<div class="row" style="gap:14px;align-items:baseline"><span class="mono" style="width:56px;font-size:11px;color:var(--text-quiet)">${px}/${w}</span><span style="font-size:var(--fs-${k});line-height:var(--lh-${k});font-weight:${w}${k === 's' ? ';color:var(--text-dim)' : k === 'xs' ? ';color:var(--text-dim)' : ''}">${t}</span></div>`).join('')}
    <div class="row" style="gap:14px;align-items:baseline"><span class="mono" style="width:56px;font-size:11px;color:var(--text-quiet)">mono 12</span><span class="mono" style="font-size:12px;color:var(--text-dim)">$0.37 of $0.60  76k / 200k  +96 −71  ctrl K</span></div></div>`;
  const chatSample = (t) => `<div class="col" style="gap:0;width:520px">
    <div class="b user sq">Draft the release notes for 0.2.0.</div>
    <div class="b agent sq" style="margin-top:16px">On it. 14 merges since Monday, most of them the dock and the rooms.</div>
    <div class="b agent sq">I'll keep the user part to one screen.</div>
    <div class="activity">${orb('kai', 16, { state: 'working' })}<span class="shimmer">Reading the changelog</span></div></div>`;
  const setCard = () => `<div class="card sq" style="width:520px"><div class="sr"><div class="lb">Theme</div><span class="select">Follow system${I('chevron-down')}</span></div><div class="sr"><div class="lb">Show the dock</div><span class="switch on"></span></div><div class="sr"><div class="lb">Send with ctrl+Enter<small>Enter starts a new line</small></div><span class="switch"></span></div></div>`;
  const menu = (hov = 1) => `<div class="menu sq"><div class="mi sq">${I('pen')}Rename bot</div><div class="mi sq${hov ? ' hov' : ''}">${I('copy')}Copy conversation link</div><div class="mi sq">${I('bell')}Mark as unread</div><div class="sepr"></div><div class="mi sq">${I('archive')}Archive</div><div class="mi sq danger">${I('close')}Delete…</div></div>`;

  /* 01 fonts */
  function fonts() {
    const refs = `<div class="pair" style="grid-template-columns:1fr 1fr"><div class="v7 cell" data-theme="dark"><div class="cap">GROK BOT (XVF, PROPRIETARY): REFERENCE FOR METRICS ONLY, NEVER SHIPPED</div><img src="ref-grok-type.png" style="width:625px;display:block;border-radius:8px"></div>
      <div class="v7 cell" data-theme="dark"><div class="cap">SETTINGS, SAME SCALE</div><img src="ref-grok-settings.png" style="width:669px;display:block;border-radius:8px"></div></div>`;
    const body = (f) => pair(`data-font="${f}"`, (t) => `<div class="row" style="align-items:flex-start;gap:36px">${typeRamp()}<div class="col" style="gap:18px">${chatSample(t)}${setCard()}</div></div>`);
    return board('01 Fonts', 'Grok Bot sets everything in XVF, a proprietary variable sans; v7 picks an open family with close metrics (large x-height, open apertures, neutral width) and keeps Geist Mono for code, numbers and keys. All three are SIL OFL 1.1 (licences in src/fonts/). The scale is Grok\'s: 11/12/13/14/15/17/22/26 on a 4px line grid, +0.01em tracking, 400 almost everywhere, hierarchy by alpha.', [
      `<section><div class="opt-h"><b>Reference</b><span>Grok Bot at its own scale, cropped from screens 130 and 020</span></div>${refs}</section>`,
      opt('A', 'Geist', 'Vercel, SIL OFL 1.1. Already bundled (@fontsource/geist): no new dependency', true, body('geist'), 'Closest in colour and width to XVF; slightly more geometric "a" and "g". One family with Geist Mono.'),
      opt('B', 'Inter', 'Rasmus Andersson, SIL OFL 1.1. A new @fontsource package (variable, about 48 KB latin)', false, body('inter'), 'The most neutral; a touch narrower and smaller-looking at 13 than XVF.'),
      opt('C', 'Figtree', 'Erik Kennedy, SIL OFL 1.1. A new @fontsource package (variable, about 25 KB latin)', false, body('figtree'), 'Rounder and friendlier, echoes the orbs; wider at 14 and 15, so rows truncate sooner.')]);
  }

  /* 02 radii */
  function radii() {
    const sample = (t) => `<div class="row" style="align-items:flex-start;gap:28px">
      <div class="col" style="gap:18px;align-items:flex-start">${menu()}<span class="tip sq">Hide sidebar <span class="keys"><span class="kbd">ctrl</span><span class="kbd">B</span></span></span><span class="toast sq"><span class="tx">Link copied</span><span class="btn xs ghost">Undo</span></span></div>
      <div class="col" style="gap:14px;width:470px">${S.composer({ composer: 'b', composerW: 470, placeholder: 'Message kai' })}
        <div class="blk sq" style="width:470px"><div class="hd">${I('terminal')}Terminal</div><div class="w6 l">Allow nina to run a command?</div><div class="well sq" style="margin-top:8px">boopis deploy staging --tag 0.2.0</div><div class="foot"><span class="btn sm ghost">Not now</span><span class="btn sm primary">Allow</span></div></div>
        <div class="b agent sq">Notes are in CHANGELOG.md, two sections.</div></div>
      <div class="col" style="gap:14px"><div class="dialog form sq" style="position:relative;width:300px;height:150px;padding:18px 20px"><div class="l w6">Delete nina?</div><div class="s dim" style="margin-top:4px">Its chat history goes too.</div><span class="ib s d-close" style="background:transparent;box-shadow:none">${I('close')}</span><div class="foot" style="position:absolute;right:10px;bottom:10px"><span class="btn sm ghost">Cancel</span><span class="btn sm danger">Delete</span></div></div>
        <div class="row" style="gap:6px;background:var(--bg-1);padding:10px;border-radius:14px"><span class="tile sq on">${orb('kai', 36, { surface: 'var(--bg-1)' })}</span><span class="tile sq">${orb('nina', 36, { surface: 'var(--bg-1)' })}</span><span class="tile sq">${orb('iris', 36, { surface: 'var(--bg-1)' })}</span></div>
        <div class="card sq" style="width:300px"><div class="sr"><div class="lb">Accent</div><span class="select">Blue${I('chevron-down')}</span></div><div class="sr"><div class="lb">Size</div><span class="select">Default${I('chevron-down')}</span></div></div></div></div>`;
    const zoom = () => {
      const r = 14, s = 6, w = 120;
      const arc = window.SQ.squirclePath(w, w, r, { smoothing: 0 }), cont = window.SQ.squirclePath(w, w, r, { smoothing: 0.6 });
      return `<svg width="${w * s / 2}" height="${w * s / 2}" viewBox="0 0 ${w / 2} ${w / 2}" style="background:#121212;border-radius:10px"><path d="${arc}" fill="none" stroke="#ff6463" stroke-width=".25"/><path d="${cont}" fill="#1f1f1f" stroke="#f5f5f5" stroke-width=".25"/></svg>`;
    };
    return board('02 Radii', 'Grok\'s radii, measured: pills for every control, composer 22, bubbles 18, form dialogs 20, menus 16 with 10px rows, cards and large dialogs 14, tiles 12, fields 10, nav rows 8, tooltips 6. Grok\'s numbers are already concentric (menu 16 = row 10 + inset 6; palette 14 = 8 + 6; composer 22 = 14 + 8), so v7 keeps v6\'s nesting rule (8.2) and lowers the floor from 8 to 6. The open question is the curve and how far to push. The dock and the notch keep --r-slab 30 either way.', [
      opt('A', 'Grok exact', 'its radii as plain circular arcs (corner smoothing 0)', false, pair('data-radii="a"', sample)),
      opt('B', 'Grok\'s radii with boopis\'s continuous corner', 'smoothing 0.6 kept (owner decision of 18 November), concentric rule kept', true, pair('data-radii="b"', sample) + `<div class="row" style="gap:16px;margin-top:14px;align-items:center">${zoom()}<span class="note" style="max-width:420px">A 14px corner at 6x: the red line is A\'s plain arc, the filled shape B\'s continuous corner. Same radius, the curve eases out of the edge. This is the corner every boopis surface already draws (squircle.ts), so B changes values, not machinery, and the notch spec\'s section 2.1 stays true.</span></div>`),
      opt('C', 'Rounder', 'every step one notch up: bubbles 22, dialogs 24, menus 20, cards 18, tiles 16, fields 12', false, pair('data-radii="c"', sample), 'Softer than Grok; the menus and cards start to read as bubbles, and the 6px floor turns into 8 to stay concentric.')]);
  }

  /* 03 light-theme shadows */
  function shadows() {
    const sample = (t) => `<div class="row" style="align-items:flex-start;gap:28px">
      <div class="col" style="gap:16px"><span class="row" style="gap:8px"><span class="ib">${I('sidebar-left', 'l')}</span>${S.pill(`${orb('kai', 24, { surface: 'var(--bg-3)' })}kai`)}<span class="btn">Share</span></span>${menu()}</div>
      <div class="col" style="gap:16px;width:520px">${S.composer({ composer: 'a', composerW: 520, placeholder: 'Message kai' })}${setCard()}<span class="toast sq" style="align-self:flex-start"><span class="tx">Link copied</span><span class="btn xs ghost">Undo</span></span></div>
      <div style="position:relative;width:360px;height:300px;background:var(--bg-2);border-radius:12px;overflow:hidden"><div class="scrim"></div><div class="dialog form sq" style="left:30px;top:50px;width:300px;height:180px;padding:18px 20px"><div class="l w6">Create a new bot</div><div class="input sq" style="margin-top:12px">Name your bot</div><div class="foot" style="position:absolute;right:10px;bottom:10px"><span class="btn sm ghost">Cancel</span><span class="btn sm off">Create</span></div></div></div></div>`;
    const one = (k) => `<div class="pair" style="grid-template-columns:1fr">${cell('light', `data-shadow="${k}"`, sample('light'))}</div>`;
    return board('03 Light-theme shadows', 'Dark has no shadows (hairlines, surface steps and an inset specular line). Grok\'s light theme uses real shadows; this board decides how much of that boopis takes. Shown on the light theme only; dark is the same in all three.', [
      opt('A', 'Grok\'s measured shadows', 'inline 0 4 12 -1 8%, popover 0 10 20 -3 10%, modal 0 20 32 -5 10%, each with a 1px 1% ring', true, one('a')),
      opt('B', 'Hairline plus half-strength shadows', 'a 0.5px 12% line on every elevated surface and shadows at about half', false, one('b')),
      opt('C', 'Flat, like dark', 'no shadows at all: a 0.5px line and surface steps', false, one('c'), 'Closest to v6\'s "depth is tone", but menus and toasts lose their lift over white.')]);
  }

  /* 04 the orb on a Grok-style surface */
  function orbs() {
    const sample = (eyes, tileFill) => (t) => {
      const o = (n, s, x = {}) => orb(n, s, { eyes, ...x });
      const tile = (n, on, st) => `<span class="tile sq${on ? ' on' : ''}" ${tileFill && !on ? 'style="--sq-bg:var(--fill-2)"' : ''}>${o(n, 36, { surface: 'var(--bg-1)', state: st })}</span>`;
      return `<div class="row" style="align-items:flex-start;gap:24px">
        <div class="col" style="gap:6px;background:var(--bg-1);padding:12px 17px;border-radius:14px">${tile('boopis', 0)}${tile('kai', 1, 'working')}${tile('nina', 0, 'needs')}${tile('iris', 0)}${tile('hex', 0, 'sleeping')}</div>
        <div class="col" style="gap:16px;width:300px">${S.pill(`${o('kai', 24, { surface: 'var(--bg-3)' })}kai`)}
          <div class="col" style="background:var(--bg-1);padding:8px;border-radius:14px">
            <div class="sb-row">${o('boopis', 36, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm">boopis</span><span class="act">Summarised the morning</span></div></div>
            <div class="sb-row">${o('moss', 36, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm">moss</span><span class="act">Found 2 flaky tests</span></div></div>
            <div class="sb-row">${o('nimbus', 36, { surface: 'var(--bg-1)', state: 'thinking' })}<div class="col grow"><span class="nm">nimbus</span><span class="act">Thinking</span></div></div></div>
          <div class="activity" style="margin:0">${o('kai', 16, { state: 'working' })}<span class="shimmer">Reading the changelog</span></div></div>
        <div class="col" style="align-items:center;gap:10px;width:200px;padding-top:4px">${o('iris', 64, { surface: 'var(--bg-2)' })}<span class="l">iris</span><span class="seg"><span class="on">Activity</span><span>Library</span></span></div>
        <div class="col" style="align-items:center;gap:12px;width:180px">${o('boopis', 96, { surface: 'var(--bg-2)' })}<span class="s dim">the boopis bot: the theme's ink</span></div>
        <div style="background:#000;border-radius:30px 30px 0 0;padding:14px 22px;display:flex;gap:12px;align-self:flex-end;--text-strong:#f5f5f5;--bg-2:#000">${['boopis', 'kai', 'nina', 'moss'].map((n) => o(n, 40, { surface: '#000000', state: n === 'nina' ? 'needs' : 'idle' })).join('')}</div></div>`;
    };
    return board('04 The orb on a Grok-style surface', 'Kept as they are: orb2\'s shapes, faces, states and the bots\' own colours; the boopis bot in the theme\'s foreground (owner decision 1), light on the dock. Grok\'s characters have their eyes cut out of the body, so the eyes show the surface. orb2 draws eyes in a colour, so v7 can get the same read by giving the eyes the surface colour. Sizes are v7\'s: 16 activity line, 24 title pill, 36 rail and rows, 40 dock, 64 details, 96 new-bot preview.', [
      opt('A', 'orb2 as it is', 'its own dark eyes on every surface', false, pair('', sample('dark', false))),
      opt('B', 'Cut-out eyes', 'eye-color = the surface behind the orb (read on hx:theme, as R-theme-5 already asks)', true, pair('', sample('cut', false)), 'On dark surfaces A and B read alike; on light surfaces and tiles the eyes go white, as Grok\'s do; the boopis bot\'s eyes are always the ground, so it reads as the logo given a body.'),
      opt('C', 'Cut-out eyes in a tile', 'every orb sits on a quiet 4% tile, as Grok\'s rail; the current one 8%', false, pair('', sample('cut', true)), 'More Grok, but a second shape around every orb; the rail gets busier.')]);
  }

  /* 05 chrome */
  function chrome() {
    const top = (k) => (t) => clip(1440, 132, win(S.botChat, { theme: t, chrome: k, noDock: true }), { r: 0 });
    const pair1 = (fn) => `<div class="pair" style="grid-template-columns:1fr">${T.map((t) => cell(t, '', fn(t), 'padding:0')).join('')}</div>`;
    return board('05 Chrome', 'Grok draws no title bar: the top 56px is a drag region with three floating controls (a 36px sidebar toggle, the title pill with the bot\'s orb and name that opens the details pane, and Share) plus thin window glyphs. v6 has a 40px frame bar with back, forward, the command field and the details toggle. Each option keeps every v6 path somewhere (principle 4: the palette is always ctrl K).', [
      opt('A', 'Floating, as Grok', 'toggle, title pill (opens details), search and details as 36px pills; back and forward move to keys and the palette', true, pair1(top('a'))),
      opt('B', 'Floating plus a search pill', 'A, with boopis\'s command field kept as a centred pill beside the title', false, pair1(top('b')), 'Keeps the most-used v6 affordance visible; the top centre gets crowded at 1100px and under.'),
      opt('C', 'An unfilled bar', 'v6\'s controls in place, no fill and no line: the ground runs to the top', false, pair1(top('c')), 'The least change for muscle memory; it is still a bar, which Grok avoids.')]);
  }

  /* 06 sidebar tile */
  function tiles() {
    const side = (k) => (t) => clip(270, 900, win(S.botChat, { theme: t, tile: k }), { r: 0 });
    return board('06 Sidebar: the rail tile', 'The rail is the sidebar collapsed; v6\'s is 56px with 24px orbs on the x = 28 axis. Grok\'s is 88px with 54px rounded tiles (radius 12, 9 padding, a 36px character, the current tile an 8% fill, a badge with a 2.5px ring). The open sidebar (key screen 12) uses the same orb size in its rows, so the tile sets the sidebar\'s rhythm.', [
      `<div class="row" style="gap:28px;align-items:flex-start">${['a', 'b', 'c'].map((k, i) => `<section style="flex:1"><div class="opt-h"><b>${'ABC'[i]}. ${['Grok', 'Compact', 'Round'][i]}</b>${i === 0 ? '<span class="rec">RECOMMENDED</span>' : ''}</div><div class="note" style="margin:0 0 10px">${['54 tile, radius 12, orb 36, rail 88', '44 tile, radius 12, orb 28, rail 64', '48 circle, orb 32, rail 72'][i]}</div><div class="pair" style="grid-template-columns:1fr 1fr">${T.map((t) => cell(t, '', side(k)(t), 'padding:0')).join('')}</div></section>`).join('')}</div>`]);
  }

  /* 07 composer */
  function composers() {
    const sample = (k) => (t) => `<div class="col" style="gap:22px">
      <div><div class="cap">EMPTY</div>${S.composer({ composer: k, placeholder: 'Message kai', composerW: 620 })}</div>
      <div><div class="cap">TYPED: THE VOICE BUTTON BECOMES SEND IN THE SAME SLOT</div>${S.composer({ composer: k, typed: 'Ship it to staging when the notes are in', composerW: 620 })}</div>
      <div><div class="cap">A ROOM WITH A HELD MESSAGE</div>${S.composer({ composer: k, placeholder: 'Message release crew', composerW: 620, queue: true, modes: `<span class="chip mode">${I('at')}Mention</span><span class="grow"></span><span class="xs dim">3 members</span>` })}</div></div>`;
    return board('07 Composer', 'Grok\'s composer is a 44px pill (radius 22, elevated fill, a 10-22% hairline, a soft 3-layer shadow): + on the left, mic and a white voice button on the right that turns into send when there is text, so send never moves. boopis\'s composers also carry modes (Governed, Smart, the model) and a capacity ("$0.37 of $0.60"); every composer can talk (owner decision).', [
      opt('A', 'Grok exact', 'the pill alone; modes move to the + menu and the title pill', false, pair('', sample('a'))),
      opt('B', 'Pill plus a mode line inside', 'two lines: the text, then the mode chips and the capacity; radius 22; a held message joins as a strip inside', true, pair('', sample('b')), 'Keeps principle 3 (cost and model knowable, never loud) where the user is looking.'),
      opt('C', 'Pill, modes as a quiet line under it', 'the pill stays Grok\'s; Governed, Smart and the capacity as 12px text below', false, pair('', sample('c')), 'Lightest, but the line under the composer competes with the dock and the status line.')]);
  }

  /* 08 calm-pass options (w31c/calm, 36219708) */
  function calm() {
    const status = (k) => (t) => `<div class="col" style="gap:14px;width:520px">
      <div class="b agent sq">On it. 14 merges since Monday.</div>
      ${k === 'a' ? `<div class="status-a l"><span class="dot run"></span>Reading the changelog<span class="mono xs dim">3 of 14</span></div>`
        : k === 'b' ? `<div class="status-b l" style="opacity:.5">Reading the changelog <span class="mono xs">3 of 14</span></div>`
        : `<div class="activity" style="margin:0">${orb('kai', 16, { state: 'working' })}<span class="shimmer">Reading the changelog</span><span class="mono xs dim">3 of 14</span></div>`}
      <div class="row" style="gap:12px"><span class="cap" style="margin:0">IN A LIST (STORE)</span>${k === 'c' ? `<span class="status-a"><span class="shimmer">Reading sources</span><span class="mono xs dim">0 of 1</span></span>` : k === 'a' ? `<span class="status-a"><span class="dot run"></span>Reading sources<span class="mono xs dim">0 of 1</span></span>` : `<span class="status-b" style="opacity:.5">Reading sources 0 of 1</span>`}</div></div>`;
    const danger = (k) => (t) => k === 'a'
      ? `<div style="width:520px"><div class="set-head" style="margin-top:0">Look</div><div class="card sq"><div class="sr"><div class="lb">Colour and shape</div>${orb('nina', 24, { surface: 'var(--bg-3)', still: true })}</div><div class="sr"><div class="lb">Role</div><span class="val">deploys</span></div></div>
        <div class="card sq" style="margin-top:24px"><div class="sr"><div class="lb dim">Danger zone</div>${I('chevron')}</div></div></div>`
      : `<div style="position:relative;width:520px;height:250px"><div class="row" style="gap:10px;padding:6px 4px 14px">${orb('nina', 24, { surface: 'var(--bg-2)', still: true })}<span class="l w5 grow">nina</span><span class="ib s" style="background:var(--current)">${I('more')}</span></div>
        <div class="card sq"><div class="sr"><div class="lb">Colour and shape</div>${orb('nina', 24, { surface: 'var(--bg-3)', still: true })}</div><div class="sr"><div class="lb">Role</div><span class="val">deploys</span></div></div>
        <div style="position:absolute;right:0;top:44px">${`<div class="menu sq" style="width:200px"><div class="mi sq">${I('copy')}Copy link</div><div class="mi sq">${I('archive')}Archive</div><div class="sepr"></div><div class="mi sq hov danger">${I('close')}Delete…</div></div>`}</div></div>`;
    const info = (k) => (t) => `<div class="card sq" style="width:520px"><div class="sr"><div class="lb row" style="gap:6px">${k === 'c' ? '<span style="text-decoration:underline dotted var(--text-quiet);text-underline-offset:4px">Autonomy</span>' : `Autonomy<span style="color:var(--text-quiet);display:inline-flex">${I(k === 'b' ? 'info-fill' : 'info')}</span>`}</div><span class="seg"><span class="on">Ask</span><span>Go</span></span></div>
      <div class="sr"><div class="lb row" style="gap:6px">${k === 'c' ? '<span style="text-decoration:underline dotted var(--text-quiet);text-underline-offset:4px">Spend cap</span>' : `Spend cap<span style="color:var(--text-quiet);display:inline-flex">${I(k === 'b' ? 'info-fill' : 'info')}</span>`}</div><span class="val mono">none</span></div></div>
      <div class="row" style="margin-top:10px;gap:8px"><span class="tip sq">How far the bot goes before it asks you</span></div>`;
    const longText = (k) => (t) => k === 'a'
      ? `<div style="position:relative;width:620px;height:360px;background:var(--bg-2);border-radius:12px;overflow:hidden"><div class="scrim"></div><div class="dialog form sq" style="left:40px;top:24px;width:540px;height:312px;display:flex;flex-direction:column"><div class="row" style="padding:16px 20px 10px"><span class="l w6 grow">Instructions for kai</span><span class="ib s" style="background:transparent;box-shadow:none">${I('close')}</span></div><div class="well sq" style="margin:0 16px;flex:1;white-space:pre-wrap;font-size:12px"># kai, docs and changelog\n\nYou write the changelog from merged pull requests.\nKeep the user part to one screen. Never invent a version.</div><div class="foot" style="padding:0 12px 12px"><span class="btn sm ghost">Cancel</span><span class="btn sm primary">Save</span></div></div></div>`
      : `<div style="position:relative;width:620px;height:360px;background:var(--bg-2);border-radius:12px;overflow:hidden"><div class="row" style="position:absolute;left:12px;right:12px;top:10px"><span class="ib">${I('back', 'l')}</span><span class="grow"></span>${S.pill(`${orb('kai', 24, { surface: 'var(--bg-3)', still: true })}Instructions`)}<span class="grow"></span><span class="btn sm primary">Save</span></div><div style="position:absolute;left:90px;right:90px;top:70px;bottom:20px;font-family:var(--mono);font-size:13px;line-height:22px;color:var(--text);white-space:pre-wrap"># kai, docs and changelog\n\nYou write the changelog from merged pull requests.\nKeep the user part to one screen. Never invent a version.<span style="border-left:2px solid var(--focus);margin-left:1px"></span></div></div>`;
    return board('08 Calm-pass options', 'The four choices the calm pass (w31c/calm, commit 36219708, lab story components/calm-options) left open, redrawn in v7 so the owner decides once. Part H asks for a "status shimmer"; the kit has none yet, so C is new.', [
      opt('Status A', 'Breathing dot and the phrase', 'the calm pass default; the dot is the one loop (1.4s in v7)', false, pair('', status('a'))),
      opt('Status B', 'The phrase alone, breathing', 'the text pulses in opacity: mid-breath it is under 4.5:1 (axe allowlisted in the calm story)', false, pair('', status('b'))),
      opt('Status C', 'Grok: live orb and a shimmer', 'the bot\'s 16px orb in its working face, the phrase swept by a 2.2s highlight, held at least 800ms; without a bot, the phrase shimmers alone', true, pair('', status('c')), 'The text stays at 66% (7.3:1) under the sweep; reduced motion stops the sweep. Recommended: C wherever a bot works, A for the nameless agent and system jobs.'),
      opt('Danger A', 'A collapsed Danger zone', 'at the end of the page, its own card; opening it shows Archive and Delete as rows', false, pair('', danger('a'))),
      opt('Danger B', 'The overflow menu in the header', 'the ... button beside the name; Delete is the last item, in red, and confirms in a form dialog', true, pair('', danger('b')), 'Recommended: B on sheets and panes (as Grok\'s bot menu), A at the end of a Settings page.'),
      opt('Info A', 'The (i) glyph', 'the calm pass\'s: a circle in the 16 grid at 1.5 stroke, --text-quiet, opens a tooltip-sized popover', true, pair('', info('a'))),
      opt('Info B', 'A filled disc', 'a solid 13px disc with the i knocked out', false, pair('', info('b'))),
      opt('Info C', 'No glyph', 'the label is dotted-underlined and is itself the trigger', false, pair('', info('c'))),
      opt('Long text A', 'A centred form dialog', '720 x 640 in the app, radius 20, Cancel and Save in the foot', false, pair('', longText('a'))),
      opt('Long text B', 'A full focused view', 'the editor takes the work area, the chrome stays (back, the title pill, Save)', true, pair('', longText('b')), 'Matches Grok\'s skill editor and R-calm-9 ("a focused editor view"); the text gets the measure, not a dialog\'s width.')]);
  }

  /* 09 accent and attention */
  function accent() {
    const acc = (k) => (t) => `<div class="row" style="gap:28px;align-items:flex-start" data-accent="${k}">
      <div class="col" style="gap:14px"><span class="row" style="gap:12px"><span class="switch on"></span><span class="switch"></span></span>
        <div class="q" style="width:280px"><div class="opt"><span class="lt">A</span>People who use boopis</div><div class="opt on"><span class="lt">B</span>Both, in two sections</div></div>
        <span class="s" style="color:var(--accent-text);text-decoration:underline;text-underline-offset:3px">Manage approval rules</span></div>
      <div class="col" style="gap:14px;width:340px"><div class="banner">${I('check')}Your engine is on the latest version</div>
        <span class="btn" style="align-self:flex-start;outline:2px solid var(--focus);outline-offset:2px">Focused button</span>
        <div style="height:6px;border-radius:99px;background:var(--fill-2);overflow:hidden"><div style="width:38%;height:100%;background:var(--accent)"></div></div></div></div>`;
    const att = (k) => (t) => `<div class="row" style="gap:28px;align-items:flex-start" data-attention="${k}">
      <div class="col" style="background:var(--bg-1);padding:8px;border-radius:14px;width:300px">
        <div class="sb-row">${orb('nina', 36, { surface: 'var(--bg-1)', state: 'needs' })}<div class="col grow"><span class="nm">nina</span><span class="act owe">Needs you: approve a deploy</span></div><span class="dot owe"></span></div>
        <div class="sb-row">${orb('kai', 36, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm">kai</span><span class="act">Writing the changelog</span></div></div></div>
      <div class="col" style="gap:12px;width:420px"><div class="b agent sq" style="--sq-bg:linear-gradient(color-mix(in srgb,var(--owe) 9%,transparent),color-mix(in srgb,var(--owe) 9%,transparent)),linear-gradient(var(--bubble-agent),var(--bubble-agent))"><span class="you">${I('user')}you</span> staging needs your approval.</div>
        <span class="row" style="gap:14px"><span class="stamp"><span class="dot owe"></span>needs you</span><span class="word" style="color:var(--red-text)">failed</span><span class="btn sm danger">Delete</span></span></div></div>`;
    return board('09 Accent and attention', 'Grok has one accent, a blue, for the switch, links and the chosen option, and uses warn amber for "needs you" and red for destructive. v6 has brass for "you are here" (never text) and red for what the person owes. Neither colour is on the keep list, so Grok wins by default; these two boards show what that costs.', [
      opt('Accent A', 'Grok blue', '#116dd2 fill, #4d9bff text (6.6:1), the focus ring in the text blue', true, pair('', acc('blue'))),
      opt('Accent B', 'Ink', 'Grok\'s "Black" accent: the inverted ink for fills, the text colour for links, a grey ring', false, pair('', acc('ink')), 'The most austere; the switch on and the chosen option read as primary buttons.'),
      opt('Accent C', 'Keep brass', 'v6\'s brass and its rule (never text) kept on Grok\'s surfaces', false, pair('', acc('brass')), 'Keeps boopis\'s warmth; next to pure neutral greys it reads as a stray colour.'),
      opt('Attention A', 'Grok amber', 'needs you in warn amber (#e28600, 6.8:1); red only for failed and a destructive confirm', false, pair('', att('warn')), 'Reverses the 22-23 November owner decisions that name red (the "you" capsule, the notch\'s edge).'),
      opt('Attention B', 'boopis red, Grok\'s values', 'what you owe stays red (#cf2b35 marks, #ff6463 text, 6.5:1); destructive confirms are red too, as Grok\'s Reset', true, pair('', att('red')), 'Keeps "red means you owe something" from v6 and the approved notch; the only change is the values.')]);
  }


  /* K02 the main bot in the open sidebar: decided, A (owner, 23 Nov). Bots tab only, the list's first entry, below the switch */
  function mainbot() {
    const side = (scr, o) => (t) => clip(300, 600, win(S[scr], Object.assign({ theme: t, sidebar: 'open' }, o)), { r: 0 });
    return board('K02 The main bot in the open sidebar', 'Decided (owner, 23 Nov): A, 44 px, Grok-Bot\'s size (measured on its 2880 px capture of the open sidebar, 157-live-sidebar-expanded: a 44 px main bot over 28 px rows and a 36 px rail; the rows take 28 px too). boopis is the first entry of the Bots tab\'s list, below the Sessions and Bots switch, centred with its name under it, as Grok-Bot shows its main bot. The Sessions tab shows no bot: there the dock is the quick way to the bots. The rail keeps its size. Every bot holds the decided home pose (K08 B, orb3 3.0.0: the whole bot turned 38°, nodded 22° and leaned −24°, with big upright pills painted on its face) and animates in a state: kai working, nina needing you. A hovered bot comes alive from that pose and settles back to it (ORBS.md §23).', [
      opt('A', '44 px, the Bots tab only', 'the bots list\'s first entry, 16 px larger than a row (28 px, Grok-Bot\'s row size, decided with it)', true, `<div class="row" style="gap:24px;align-items:flex-start">${pair('', side('room', { main: 44 }))}${pair('', side('botChat', { main: 44 }))}</div>`, 'Left: the room (screen 12). Right: a bot\'s chat (screen 11). Both are the Bots tab, with no dock.'),
      opt('Sessions tab', 'shows no bot', 'the session list only; the bots are reached from the dock under the session', false, `<div class="row" style="gap:24px;align-items:flex-start">${pair('', side('session', {}))}</div>`, 'Screen 13: no boopis entry; the dock (not in this crop) is the quick access to the bots.')]);
  }
  window.BOARDS = { mainbot, fonts, radii, shadows, orbs, chrome, tiles, composers, calm, accent };
})();
