/* The dock, v7 (owner, 23 Nov): only in the Sessions tab; no "+ new bot"; built from the section 21 kit. The slab stays (black,
   flush, its flares); its inside is always the dark theme (data-theme="dark"), so every kit component in it uses tokens. */
(function () {
  const { I, mark, orb } = window.V7;
  const S = window.SCREENS;
  /* the bots, ordered as the dock orders them (D01 B): needs you first, then working, then pinned and recent; boopis is not special */
  const BOTS = ['nina', 'kai', 'boopis', 'moss', 'iris', 'hex'];
  const MANY = ['nina', 'moss', 'kai', 'boopis', 'iris', 'hex', 'nimbus'];
  const STATE = { nina: 'needs', kai: 'working', hex: 'sleeping', moss: 'needs' };

  /* ONE source for the dock's geometry (tokens.v7.json "dock"): every board, component board and screen draws the slab through slab() */
  const DK = {
    row: { w: 640, h: 72, R: 30, F: 30, padX: 30, orb: 40, gap: 14, grow: [52, 46] },   /* padding = the corner radius: nothing sits in the corner zone */
    compact: { w: 380, h: 48, R: 24, F: 24, padX: 24, orb: 24, gap: 8 },
    open: { w: 640, R: 30, F: 30, inset: 8 }
  };
  const POSE = '32 4';   /* provisional until ORBS.md section 23: yaw 32 degrees toward the right, pitch 4 up; inside C9 and C10's limits */
  let clipN = 0;
  /* the slab: black in both themes, flush, its flares; the content is clipped to the slab's own path, so nothing (a fade, an orb)
     can paint outside its curve; the inside is the dark theme */
  function slab(kind, inner, o = {}) {
    const g = DK[kind], w = g.w, h = o.h || g.h, F = g.F, id = 'dkc' + (++clipN);
    const path = window.SQ.slabPath(w, h, g.R, F);
    return `<div class="dock" data-dk="${kind}" data-geom="${w},${kind === 'open' ? 'auto' : h},${g.R},${F}" style="left:${o.left || '50%'};width:${w}px;height:${h}px">` +
      `<svg class="slab" style="inset:auto;top:0;left:-${F}px" viewBox="0 0 ${w + 2 * F} ${h}" width="${w + 2 * F}" height="${h}"><defs><clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${path}" transform="translate(-${F} 0)"/></clipPath></defs><path d="${path}" fill="#000"/></svg>` +
      `<div class="dk-in dk7" data-theme="dark" data-kind="${kind}" style="clip-path:url(#${id})">${inner}</div></div>`;
  }

  /* one orb: its state face; face-scale 1.25 (ORBS.md C4, orbs of 44 px and under); the amber flag when it needs you;
     Live (the owner, 23 Nov): idle bots hold the fixed pose; a hovered bot comes alive smoothly and settles back; a bot in a
     state (working, needs you) animates. A still draws them at rest. */
  const one = (n, o = {}, g = DK.row) => {
    const st = (o.needs || []).includes(n) ? 'needs' : (STATE[n] === 'needs' ? 'idle' : STATE[n] || 'idle');
    const i = (o.bots || BOTS).indexOf(n), hi = (o.bots || BOTS).indexOf(o.hover);
    const s = g.grow && o.hover === n ? g.grow[0] : g.grow && o.hover && Math.abs(hi - i) === 1 ? g.grow[1] : g.orb;
    const flag = (o.needs || []).includes(n) ? `<span class="dot owe dk7-flag"${g.orb < 30 ? ' style="width:6px;height:6px"' : ''}></span>` : '';
    const cls = (o.current === n ? ' dk7-cur' : '') + (o.focus === n ? ' dk7-focus' : '');
    /* at idle every dock bot holds the fixed sideways three-quarter pose of the Bots tab's sidebar (owner, 23 Nov; the exact
       pose lands in ORBS.md section 23: POSE is the one constant to change); the hovered bot is alive, face-on */
    const look = o.hover === n ? ' gaze="0 5"' : ` gaze="${POSE}"`;
    return `<span class="dk7-orb${cls}" style="width:${s}px;height:${s}px">${orb(n, s, { state: st, surface: '#000000', dockInk: true, still: true }).replace('<orb-avatar ', `<orb-avatar${look} `).replace('idle-motion="calm"', 'idle-motion="lively"')}${flag}</span>`;
  };
  const askPill = (n, who, small) => n ? `<span class="dk7-ask${small ? ' sm' : ''}"><span class="dot owe"></span>${n === 1 && who ? who : n} need${n === 1 ? 's' : ''} you</span>` : '';

  /* the row's content: o.bots, o.needs, o.hover, o.focus, o.current, o.more (D01 B: "N more" opens the Bots tab), o.pages and o.fade
     (D01 A, recorded only), o.ask (D03 C: the ask pill at the row's end; on hover the same slot names the bot) */
  function rowHTML(o = {}, g = DK.row) {
    const bots = o.bots || BOTS;
    const orbs = bots.map((n) => one(n, o, g)).join('');
    const more = o.more ? `<span class="chip dk7-more">${o.more} more</span>` : '';
    const hn = o.hover, hs = hn && ((o.needs || []).includes(hn) ? ['owe', 'needs you'] : STATE[hn] === 'working' ? ['', 'working'] : STATE[hn] === 'sleeping' ? ['', 'resting'] : ['', 'idle']);
    const end = hn ? `<span class="dk7-cap"><b>${hn}</b><span class="word ${hs[0]}">${hs[1]}</span></span>` : o.ask !== false ? askPill((o.needs || []).length, (o.needs || [])[0], g === DK.compact) : '';
    const nub = o.pages ? `<span class="dk7-nub">${Array.from({ length: o.pages }, (_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</span>` : '';
    const fades = o.fade ? '<span class="dk7-fade l"></span><span class="dk7-fade r"></span>' : '';
    return `<div class="dk7-row" style="gap:${g.gap}px;padding:0 ${g.padX}px;height:${g.h}px">${orbs}${more}${end}${nub}${fades}</div>`;
  }
  const row = (o) => ({ w: DK.row.w, html: rowHTML(o) });
  function dockRow(o = {}) { return slab('row', rowHTML(o), o); }
  /* compact when idle (D02 A + the Compact setting, off by default): 24 px orbs, the ask pill small; the row rises on hover or ctrl J */
  function compact(o = {}) { return slab('compact', rowHTML({ ...o, bots: (o.bots || BOTS) }, DK.compact), o); }
  const collapsed = compact;

  /* an AskCard from a bot, the approval variant (never expires) or a question */
  const approval = (who = 'nina') => `<div class="qcard sq dk7-q"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${orb(who, 16, { still: true, surface: 'var(--bg-3)' })}<span>${who} asks</span><span class="grow"></span><span class="word owe">needs you</span></div>
    <div class="m" style="margin-bottom:6px">Deploy 0.2.0 to staging?</div><div class="well sq" style="margin:0 0 8px">boopis deploy staging --tag 0.2.0</div>
    <div class="row" style="gap:6px"><span class="chip on">Hold to allow once</span><span class="chip out">Always for staging</span><span class="grow"></span><span class="chip out">Deny <span class="kbd" style="margin-left:4px">esc</span></span></div></div>`;
  const question = (who = 'moss') => `<div class="qcard sq dk7-q"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${orb(who, 16, { still: true, surface: 'var(--bg-3)' })}<span>${who} asks</span><span class="grow"></span><span class="word owe">needs you</span></div>
    <div class="m" style="margin-bottom:8px">The WebKit job flaked twice. Quarantine it?</div>
    <div class="row" style="gap:6px"><span class="chip on">Quarantine</span><span class="chip out">Retry once more</span><span class="chip out">Leave it</span></div></div>`;

  /* the asks, open (D03 C): the stack of AskCards over the row */
  function asks(o = {}) {
    const r = row({ ...o, ask: false, current: null });
    const inner = `<div class="dk7-panel"><div class="dk7-head"><span class="inbox-h" style="padding:0 0 0 4px">Waiting on you<span class="n">2</span></span><span class="grow"></span><span class="ib s dk7-x">${I('close')}</span></div>
      ${approval('nina')}${question('moss')}</div>${r.html}`;
    return slab('open', inner, { ...o, h: 400 });
  }

  /* a bot's card: its own chat, small (the bot's bubble fill), its ask, its composer; the row stays below as the switcher */
  function card(o = {}) {
    const who = o.who || 'nina';
    const r = row({ ...o, ask: false, current: who });
    const inner = `<div class="dk7-panel" style="--bubble-user:#d42746;--bubble-user-text:#ffffff">
      <div class="dk7-head">${orb(who, 28, { state: 'needs', surface: '#000000' })}<span class="m w5" style="margin-left:2px">${who}</span><span class="word owe">needs you</span><span class="grow"></span><span class="ib s dk7-x" title="Open in Bots">${I('bots')}</span><span class="ib s dk7-x">${I('close')}</span></div>
      <div class="dk7-log"><div class="b user sq">Ship 0.2.0 when the notes are in.</div><div class="b agent sq" style="margin-top:16px">The notes are in. Staging is ready.</div></div>
      ${approval(who)}
      <div class="composer sq" style="border-radius:var(--r-pill);flex:none"><div class="line"><span class="ib s">${I('plus')}</span><span class="ph">Message ${who}</span><span class="ib s">${I('mic')}</span><span class="ib s inv">${I('waveform')}</span></div></div></div>${r.html}`;
    return slab('open', inner, { ...o, h: 460 });
  }


  /* ---------- the Sessions tab with the dock (key screens) ---------- */
  const sb = (h, st = '') => `<div class="b user sq"${st}>${h}</div>`, sa = (h, st = '') => `<div class="b agent sq"${st}>${h}</div>`;
  const body = `<div class="sep">Today 09:42</div>${sb('The dock loses its right half while the slab moves. Find why and fix it.')}${sa('Reading the dock’s stage and clip code first.', ' style="margin-top:16px"')}
    <div class="worklog">${I('chevron')}Read 6 files, searched 2 patterns</div><div class="activity">${mark('claude', 16, 'pulse')}<span class="shimmer">Editing modules/dock/dock.css</span></div>`;
  function screen(o) {
    const k = o.k || 'rest', t = o;
    /* while the dock's stack or a card is open, the session's composer steps aside (fades out in 120 ms; focus is in the dock) */
    const comp = k === 'asks' || k === 'card' ? '' : S.sessComp(o, 'Message', {});
    const centre = o.centre ? 'calc(50% - 150px)' : undefined;
    let dock;
    if (k === 'none') return S.sessShell(o, body, comp, { noDock: true }); /* no bot of your own yet (boopis alone does not count): no dock */
    if (k === 'hover') dock = dockRow({ needs: ['nina'], hover: 'nina' });
    else if (k === 'asks') dock = asks({ needs: ['nina', 'moss'] });
    else if (k === 'card') dock = card({ needs: ['nina'], who: 'nina' });
    else if (k === 'many') dock = dockRow({ bots: MANY, needs: ['nina'], more: 12 });
    else if (k === 'compact') dock = compact({ needs: ['nina'] });
    else dock = dockRow({ needs: ['nina'], left: centre });
    if (k === 'rest' && centre) dock = dockRow({ needs: ['nina'], left: centre });
    return S.sessShell(o, body, comp, { dock });
  }
  S.dockv7 = screen;
  S.dock = (o) => screen({ ...o, k: 'card' }); /* screen 16: the dock lives in the Sessions tab now */

  /* ---------- boards ---------- */
  const T = ['dark', 'light'];
  const cell = (t, inner, style = '') => `<div class="v7 cell" data-theme="${t}" style="${style}">${inner}</div>`;
  const pair = (fn, style) => `<div class="pair">${T.map((t) => cell(t, fn(t), style)).join('')}</div>`;
  const opt = (l, n, sub, rec, body2, note) => `<section><div class="opt-h"><b>${l}. ${n}</b><span>${sub}</span>${rec ? `<span class="rec">${rec === true ? 'RECOMMENDED' : rec}</span>` : ''}</div>${body2}${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const comp2 = (n, sub, body2, note) => `<section><div class="opt-h"><b>${n}</b><span>${sub}</span><span class="rec" style="background:#5b5bd6;color:#fff">CHANGED FOR v7</span></div>${body2}${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, secs) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${secs.join('')}</div></div>`;
  const stage = (h, inner, w = 820) => `<div style="position:relative;width:${w}px;height:${h}px;margin:0 auto">${inner}</div>`;
  const states = (list) => `<div class="col" style="gap:22px;align-items:center">${list.map(([cap, html]) => `<div style="width:100%"><div class="cap">${cap}</div>${html}</div>`).join('')}</div>`;
  const scr = (t, o) => `<div style="zoom:.6;width:1440px;height:900px;border-radius:16px;overflow:hidden">${screen(Object.assign({ theme: t, chrome: 'a', tile: 'a', composer: 'c', status: 'c' }, o))}</div>`;

  const stg = (h, inner) => stage(h, inner, 760);
  function d01() {
    return board('D01 Many bots in the dock: the owner’s pick B', 'The dock is in the Sessions tab only, to reach your bots and their asks while you work. The full roster lives in the Bots tab, so the dock no longer opens an expanded roster. Every slab on these boards is the one dock component (640 × 72, radius 30, flares 30, padding 30, orbs 40, gap 14); only its content differs.', [
      opt('A', 'Pages of the row', 'swipe or alt+arrows between pages of orbs; the page nub in the slab’s foot; the sides fade while a page moves', false, pair(() => stg(110, dockRow({ bots: MANY, needs: ['nina'], pages: 3, ask: false }))), 'Not chosen. A nub and a gesture to learn.'),
      opt('B', 'The ones that matter now, then “N more”', 'needs you first, then working, then your pinned and recent bots, as many as fit; “12 more” opens the Bots tab', 'THE OWNER’S PICK', pair(() => stg(110, dockRow({ bots: MANY, needs: ['nina'], more: 12 }))), 'Picked (23 Nov). One row, no paging, no roster to duplicate. Option C (a scrolling strip) was offered and is dropped from this board now that B is picked.')]);
  }
  function d02() {
    return board('D02 The dock at rest while you work: the owner’s pick A, plus a compact idle version', 'The full row at rest (A, picked). The owner added a smaller compact version for idle moments, a setting (Settings > General > “Compact dock when idle”), off by default. Compact is the same component in its compact geometry (380 × 48, radius 24, flares 24, padding 24, orbs 24, gap 8): when nothing has needed you for 10 s and you are typing, the row eases to compact (200 ms, --ease-sharp); a hover, ctrl J or a new ask brings the row back.', [
      opt('A', 'The row', 'every bot that matters now (D01 B), the ask pill at its end; the composer sits 24 px above it', 'THE OWNER’S PICK', pair((t) => scr(t, { k: 'rest' })), 'Picked (23 Nov).'),
      opt('A+', 'Compact when idle (the setting on)', 'the same component, compact: the bots at 24 px, the ask pill small; the row rises on hover or ctrl J', 'NEW STATE', pair((t) => scr(t, { k: 'compact' }))),
      opt('A, A+', 'The two geometries side by side, 1:1', 'the row and the compact dock, from the same component', false, pair(() => `<div class="col" style="gap:20px">${stg(110, dockRow({ needs: ['nina'] }))}${stg(80, compact({ needs: ['nina'] }))}</div>`))]);
  }
  function d03() {
    return board('D03 Where the bots’ asks surface: the owner’s pick C', 'A bot that needs you waits until you answer; it never expires. Sessions’ own asks live in the Sessions inbox, so the dock carries the bots’ asks only.', [
      opt('C', 'An ask pill at the row’s end', '“2 need you” (or “nina needs you”) in amber; it opens the stack of AskCards over the row; each orb keeps its flag', 'THE OWNER’S PICK', pair(() => stg(110, dockRow({ needs: ['nina', 'moss'] }))) + '<div style="height:14px"></div>' + pair(() => stg(372, asks({ needs: ['nina', 'moss'] }))), 'Picked (23 Nov). One place for every ask without a page: the dock is one page, so the nub, the paging and Arrange go away. A (a Needs-you page) and B (on the orbs only) were not chosen.')]);
  }
  function dk1() {
    const st = (cap, o, h = 110) => [cap, stage(h, dockRow(o))];
    return board('DK1 The row', 'The dock’s row in v7, one component: 640 × 72, radius 30, flares 30, padding 30 (the corner radius, so nothing sits in a corner), orbs 40 (ORBS.md keeps the dock at 40, with face-scale 1.25 and the sharp renderer), gap 14. At idle every bot holds the sidebar’s fixed three-quarter pose; the hovered bot turns face-on and comes alive; bots in a state animate. No “+” (new bots are made in the Bots tab); boopis is not special, it is one of your bots. Grow on hover lifts the hovered orb to 52 and its neighbours to 46; the row’s end slot names the hovered bot and its state in words (a tooltip would cover the composer’s line 24 px above); the flag is the amber dot ringed in the slab’s black; the bot whose card is open has an Iris dot under it; focus is the Iris ring.', [
      comp2('States', 'dark and light pages; the slab is black in both', pair(() => states([st('REST: NINA NEEDS YOU, KAI WORKS, HEX RESTS', { needs: ['nina'] }), st('HOVER: GROW, AND THE END SLOT NAMES THE BOT (NO TOOLTIP OVER THE COMPOSER)', { needs: ['nina'], hover: 'nina' }), st('FOCUS (KEYBOARD): THE IRIS RING', { needs: ['nina'], focus: 'kai' }), st('A CARD OPEN: THE IRIS DOT UNDER ITS BOT', { needs: ['nina'], current: 'nina', ask: false }), st('NOTHING NEEDS YOU: NO PILL', { needs: [] }), ['COMPACT WHEN IDLE (THE SETTING ON): THE SAME COMPONENT, COMPACT GEOMETRY', stage(80, compact({ needs: ['nina'] }))]])), 'R-row-1 holds in the end slot and the pill (one line each); the pill is a 32 tall capsule 30 px from the slab’s side, out of the slab’s 30 px corner zone.')]);
  }
  function dk2() {
    return board('DK2 Asks and a bot’s card in the dock', 'What opens from the row. Both grow the slab upward over the session; Esc or the close button folds them back. Inside: kit components only (the Block, the AskCard approval variant, Bubbles, the Composer), on the slab’s 8 px inset: 30 − 8 = 22, the Block’s radius (R-corner-10).', [
      comp2('The asks, open (D03 C)', 'the stack of AskCards: an approval (hold to allow, never expires) and a question; the row stays as the switcher', pair(() => stage(372, asks({ needs: ['nina', 'moss'] })))),
      comp2('A bot’s card', 'nina’s own chat, small: your bubbles in nina’s derived fill (white text at 5.0:1, section 18.1), her ask, her composer; “Open in Bots” goes to the full chat; the strip of mini orbs is gone: the row below is the switcher', pair(() => stage(424, card({ needs: ['nina'], who: 'nina' }))))]);
  }

  window.DBOARDS = { d01, d02, d03, dk1, dk2 };


  /* the slab fits what it holds: an open stack or card sets its height from its content (the slab path is redrawn) */
  function refit(root = document) {
    root.querySelectorAll('.dock').forEach((d) => {
      const p = d.querySelector('.dk7-panel'); if (!p) return;
      const g = DK.open, w = g.w, h = Math.ceil(p.scrollHeight + DK.row.h), F = g.F, path = window.SQ.slabPath(w, h, g.R, F);
      d.style.height = h + 'px';
      const svg = d.querySelector('svg.slab'); svg.setAttribute('viewBox', `0 0 ${w + 2 * F} ${h}`); svg.setAttribute('height', h);
      svg.querySelectorAll('path').forEach((q) => q.setAttribute('d', path));
    });
  }

  Object.assign(window.DOCK = {}, { DK, row, slab, dockRow, compact, collapsed, asks, card, approval, question, refit, BOTS, MANY });
  /* the Sessions tab's dock from now on: no "+"; nina needs you; the ask pill at the row's end */
  S.dockRow = (o = {}) => dockRow({ needs: ['nina'], ...o });
})();
