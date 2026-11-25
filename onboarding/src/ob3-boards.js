/* Onboarding revision 3: the boards. O01 records the owner's final structure (one continuous first run: the setup before the
   app, Sessions, the hand-off, the boopis bot in its chat); O02, O03 and C01, C02 are revision 2's, moved to where the parts now
   live; O04 (the speaker) is unchanged. Board scaffolding (.bd, .fl-) is the board's own; the cells draw the real screens. */
(function () {
  const S = window.SCREENS, SP = window.OB2S, O2 = window.OB2, O3 = window.OB3;
  const n = (cls, b, i) => `<span class="fl-n ${cls}"><b>${b}</b>${i ? `<i>${i}</i>` : ''}</span>`;
  const a = '<span class="fl-a"></span>';
  const chain = (...xs) => `<div class="fl-row">${xs.join(a)}</div>`;
  const stats = (rows) => `<div class="fl-stats">${rows.map(([v, l]) => `<div><b>${v}</b>${l}</div>`).join('')}</div>`;
  const thumb = (q, label, w = 340) => { const k = w / 1440; return `<div><div class="thumb" style="width:${w}px;height:${900 * k}px"><div class="sc" style="transform:scale(${k})">${S[q.s](Object.assign({ theme: 'dark', chrome: 'a', tile: 'a', composer: 'c', status: 'c' }, q))}</div></div><div class="thumb-l">${label}</div></div>`; };
  const picked = (who) => `<span class="rec" style="background:#4fc9a8">${who}</span>`;
  const section = (letter, title, sub, tag, body, note) => `<section><div class="opt-h"><b>${letter}${letter ? '. ' : ''}${title}</b><span>${sub}</span>${tag || ''}</div><div class="v7 cell" data-theme="dark" style="background:#111;border-radius:14px;box-shadow:0 0 0 1px #2a2a2a">${body}</div>${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, sections) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${sections.join('')}</div></div>`;
  const key = `<div class="fl-key"><span style="--k:#4546c8;--kb:#1a1a2c">(a) setup, full window, before the app</span><span style="--k:#2f6f5a;--kb:#142420">(b) Sessions, in the app</span><span style="--k:#c8770c;--kb:#2a1e10">(c) the hand-off</span><span style="--k:#6b4f9c;--kb:#201a2c">(d) Bots, in boopis’s chat</span><span style="--k:#f0f0f0;--kb:#f0f0f0">a first real result</span></div>`;
  const tb = (rows) => `<div class="ob2-spec"><table>${rows.map(([x, y]) => `<tr><th>${x}</th><td>${y}</td></tr>`).join('')}</table></div>`;

  /* ---------- O01: the structure (the owner's final word, 23 Nov): one continuous first run ---------- */
  function o01() {
    const flow = `<div class="fl-lab">THE FIRST RUN, ONE CONTINUOUS SEQUENCE (about 3:40 with a sign-in)</div>
      ${chain(n('setup', 'Hello', 'O-P01, the oo mark wakes'), n('setup', 'Settings boopis needs', 'O-P02, required'), n('setup', 'A model', 'O-P03'), n('setup', 'Try it', 'O-P04'))}
      <div class="fl-lab">THE APP OPENS ROUND THE SPEAKER: SESSIONS, MARK A SPEAKS</div>
      ${chain(n('sess', 'Add a folder', 'O-S01'), n('sess', 'Worktree', 'O-S02'), n('sess', 'How careful', 'O-S03, Auto-accept edits'), n('sess', 'Ready', 'O-S04, ~1:20'), n('dup', 'The hand-off', 'O-H01: mark A becomes the boopis bot'))}
      <div class="fl-lab">THE TAB SWITCHES TO BOTS BY ITSELF; THE BOOPIS BOT TAKES OVER IN ITS OWN CHAT</div>
      ${chain(n('bots', 'boopis greets you', 'O-B01'), n('bots', 'What bots are', 'O-B02'), n('bots', 'Goals', 'O-B03, tiles'), n('bots', 'Where, your name', 'O-B04, O-B05'), n('bots', 'Team, connectors', 'O-B06'), n('bots', 'Approval rules', 'O-B07'), n('bots', 'Build, reach', 'O-B08, O-B09'), n('task', 'First job', 'O-B10, ~3:40'))}`;
    const hand = tb([
      ['(a) Setup', 'the whole window, no app chrome: no sidebar, composer, title pill or dock; only the window glyphs and "Skip setup". Grok-Bot’s 001 to 008 anatomy (BOOPIS-MASTER 3.1): one heading at 196, the scene, the actions at 640. The oo mark leads: hero size on hello, 44 above the heading after. The engine installs behind hello.'],
      ['(b) Sessions', 'the app assembles round the speaker (the sidebar slides in, the title pill and the composer come), and the speaker lands as mark A on the new-session canvas, where it keeps speaking: the folder, the worktree, how careful (the four rows, Auto-accept edits pre-selected), ready. No dock: there is no bot of your own yet (DESIGN-SYSTEM 21.4).'],
      ['(c) The hand-off', 'on the ready canvas, mark A says "One more thing: your bots", looks over at the Bots tab, and morphs into the boopis bot where it stands (the eyes shrink and drop into the body, which grows round them, opaque from its first frame: never two faces). The tab then switches to Bots by itself; the bot travels to the head of its chat. Later is visible from the line to the switch.'],
      ['(d) Bots', 'the boopis bot speaks in its own chat, Grok-style: choice cards, the team card, the goal tiles, the plan, the rules, the build, connectors, reach, the first job. The Bots sidebar holds boopis at 44 and the bots as they are made, at the sidebar’s fixed pose.'],
      ['The ledger', '<code>onboarding.json</code>: <code>{ version: 3, step, parts: { setup, sessions, bots }, answers }</code>, written as answers are given. It is only for resume, skip and returning users: reopening mid-way resumes at the step (O-X01); "Skip setup" lands in Sessions with what is answered; Later at the hand-off marks Bots open, and the Bots tab’s first open then starts from the morph (O-X04); a returning user gets receipts and the one new thing (O-X03).']]);
    const choice = `<div class="fl-lab">THE TAB SWITCH: TWO WAYS (RECOMMENDED: AUTO, WITH LATER VISIBLE)</div><div class="thumbs">${thumb({ s: 'o3H01' }, 'RECOMMENDED: O-H01, auto, with Later', 400)}${thumb({ s: 'o3H01', v: 'prompt' }, 'THE OTHER OPTION: O-H01b, a prompt', 400)}${thumb({ s: 'o3B01' }, 'O-B01: boopis greets you in its chat', 400)}</div>
      <div class="ob2-ledger"><p><b>Why auto:</b> the owner’s words put the bot in charge ("the tab will change itself"), the morph already tells you something is about to happen, and one less button keeps the sequence continuous; Later, beside the countdown, is the escape. <b>The prompt</b> is the safer choice for someone who might be surprised by a tab changing under them; it costs one press. Either way the morph plays on the canvas first, and Later leaves you on Sessions, ready to type.</p></div>`;
    const morph = (st) => `<div class="v7 ob2-bcell" data-theme="dark"><div class="ob2-poses" style="gap:28px">${[
      ['mark A, ready', SP.spk(44, { pose: 'you' })],
      ['it looks over at Bots', SP.spk(44, { pose: 'turnLeft' })],
      ['the eyes drop in', `<span style="position:relative;display:grid;place-items:center;width:72px;height:72px">${O2.orb('boopis', 64, { surface: 'var(--bg-2)', state: 'sleeping' })}</span>`],
      ['the bot wakes, happy', `<span style="display:grid;place-items:center;width:72px;height:72px">${O2.orb('boopis', 64, { surface: 'var(--bg-2)', state: 'happy' })}</span>`],
      ['in its chat', `<span style="display:grid;place-items:center;width:72px;height:72px">${O2.orb('boopis', 64, { surface: 'var(--bg-2)' })}</span>`]].map(([l, h]) => `<div class="ob2-pose">${h}<span>${l}</span></div>`).join('')}</div></div>`;
    const thumbs = `<div class="fl-lab">ONE FRAME OF EACH PART</div><div class="thumbs">${thumb({ s: 'o3P01' }, '(a) O-P01 Hello, before the app', 300)}${thumb({ s: 'o3S03' }, '(b) O-S03 How careful, mark A', 300)}${thumb({ s: 'o3H01' }, '(c) O-H01 the hand-off', 300)}${thumb({ s: 'o3B03', picks: 'two' }, '(d) O-B03 the goals in boopis’s chat', 300)}</div>`;
    const body = `<div style="padding:4px 0">${flow}${key}${stats([['1', 'continuous first run'], ['0', 'onboardings that start on a tab’s first open'], ['~1:20', 'to a ready session'], ['~3:40', 'to the first job']])}${hand}<div class="fl-lab">THE MORPH (clip O-M8, 60 fps; reduced motion: a dip from the mark to the bot)</div>${morph()}${choice}${thumbs}</div>`;
    return board('O01 Onboarding structure: setup first, then Sessions, then the boopis bot', 'The owner’s final word (23 Nov): "the entire setup needs to happen directly at the start. after setting up the sessions tab and talking to you through the oo mark, the oo mark will transform into the boopis bot and the tab will change itself (or it can prompt you to change it). and then boopis bot will take over." Revision 2’s one onboarding per tab (each tab running its own on first open) is replaced: the first run is one sequence, and the ledger only resumes, skips and welcomes back.', [
      section('', 'One continuous first run', 'the owner’s structure, 23 Nov', picked('THE OWNER’S STRUCTURE'), body, 'Who speaks: the oo mark from hello to the hand-off (setup pages, then mark A on the canvas: one pair of eyes the whole way); the boopis bot from the morph on, in its own chat. That is section 10’s "the logo given a body", shown literally once.')]);
  }

  /* ---------- O02: the approval rules, in the boopis bot's chat (A, unchanged) ---------- */
  function o02() {
    const body = `<div class="fl-lab">WHERE THE RULES ARE WALKED THROUGH</div>${chain(n('bots', 'Team plan', 'O-B06'), n('bots', 'Approval rules', 'O-B07, the eight defaults'), n('bots', 'Build', 'O-B08, hold'), n('task', 'First job', 'O-B10, a real ask names its rule'))}
      <div class="thumbs">${thumb({ s: 'o3B07' }, 'O-B07: the rules card in boopis’s chat', 456)}</div>`;
    return board('O02 Where the approval rules are walked through', 'Picked A on 23 Nov: in the Bots part, just before the team is built, where the rules start to mean something. In revision 3 that part is the boopis bot’s chat after the hand-off. Sessions never show them: a session’s "how careful" (O-S03) is its own setting.', [section('A', 'In the boopis bot’s chat', 'picked 23 Nov', picked('PICKED, OWNER'), body, '')]);
  }

  /* ---------- O03: the goal tiles, now a card in boopis's chat ---------- */
  function o03() {
    const G = O2.GOALS;
    const cell = (inner, cap = '') => `<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start"><div class="ob3-goals" style="width:200px;padding:0;margin:0;background:none">${inner}</div>${cap ? `<div class="thumb-l">${cap}</div>` : ''}</div>`;
    const states = (theme) => `<div class="v7 ob2-bcell" data-theme="${theme}"><div class="row" style="gap:16px;align-items:flex-start;flex-wrap:nowrap">${cell(O2.tile(G[1], ''), 'rest')}${cell(O2.tile(G[1], 'hov'), 'hover: +4% ink, 120 ms')}${cell(O2.tile(G[0], 'on'), 'chosen: the bot takes it')}${cell(O2.tile(G[3], 'on'), 'a second pick: another bot')}</div></div>`;
    const spec = tb([
      ['Where', 'a wide Block in boopis’s chat (the thread’s 640), content on its 8 inset; the free bots wait in its head at 24 px, looking at the tile under the pointer'],
      ['Grid', '3 × 2, tiles 200 × 100 (the thread’s width), gap 8; Grok: 3 × 3 tiles of 160 × 77'],
      ['Tile', 'the Card’s surface (<code>--bg-3</code>, <code>--line</code>, <code>--shadow-inline</code> light), radius 14 (the Block’s 22 less its 8 inset: concentric), continuous corners, 14 inset'],
      ['Chosen', 'a 2 px ring and a 10% tint in the colour of the bot that takes it; its bot flies from the head into the icon’s disc (660 ms travel, a 40 px arc, 24 to 28 px)'],
      ['Picks', 'up to three; a fourth press shakes the tile and the head reads "Up to three. Unpick one first."; Next is the card’s chip, on after the first pick'],
      ['Keys', 'arrows move, Space picks, Enter is Next; each tile is a checkbox ("Code and reviews, kai takes it, checked")']]);
    const body = `<div style="padding:20px">${states('dark')}${states('light')}${spec}<div class="thumbs">${thumb({ s: 'o3B03' }, 'O-B03: one pick, one hovered', 456)}${thumb({ s: 'o3B03', picks: 'two' }, 'two picks: kai and iris took theirs', 456)}</div></div>`;
    return board('O03 The goal picker: Grok’s tiles, in the chat', 'The owner chose "closer to B": Grok-Bot’s tiles, an onboarding-only component. Revision 3 moves them into the boopis bot’s chat (Grok continues its onboarding inside the chat), as a card the bot asks with; the bots that will take the goals wait in its head.', [section('B', 'Goal tiles, onboarding only', 'picked 23 Nov, "closer to B"', picked('PICKED, OWNER'), body, 'The AskCard stays for every other in-chat question.')]);
  }

  /* ---------- O04: the speaker, unchanged (revision 2's board, its copy brought to revision 3's places) ---------- */
  function o04() {
    return window.OB2BOARDS.o04().replace(/It speaks on every page and in the [^.]*\./, 'It speaks on every setup page and, as mark A, on the Sessions canvas, until it becomes the boopis bot at the hand-off.');
  }

  /* ---------- C01: onboarding's own parts and motion ---------- */
  function c01() {
    const parts = tb([
      ['The speaker', 'the oo mark with a head of its own (board O04). Hero 96 on hello, 44 above a setup page’s heading and as mark A.'],
      ['The setup page', 'the Page’s intro variant (approved in revision 1) on the whole window: heading at 196, the scene, actions at 640 (one centre line: the heading, the card, the actions), the ghost bottom left, the window glyphs; nothing else of the app.'],
      ['The app assembling', 'between Try it and the folder: the setup page’s parts go (120 ms), the sidebar slides in 16 px (300 ms travel), the title pill and the composer come (200 ms, the composer 8 px up), the canvas words follow; the speaker travels into mark A’s place throughout (680 ms travel).'],
      ['The hand-off', 'mark A’s line and Later enter (200 ms); it looks at the Bots tab (520 ms, turn ease, a blink); the morph: the eyes shrink to .35 and drop .18 W (380 ms spring), the bot opaque round them from .45 (380 ms spring), the eyes gone inside it by 110 ms; the bot wakes and is happy; the tab switches (the switch’s pill slides 200 ms, the list empties, the canvas goes in 120 ms, the chat comes in 200 ms), the bot travels to its chat’s head (680 ms travel) and hops; its name, then its lines, then the choice card.'],
      ['The team card', 'three bots at 44 with their jobs in a Block in the chat; they wake one by one (orb2’s wake, double take), look at each other and at boopis, and hop together.'],
      ['The goal tiles', 'board O03; a pick sends a bot from the card’s head into its tile.'],
      ['The team assembles', 'each bot is made above the composer, looks at boopis, turns and flies to its row in the Bots sidebar, settling on the sidebar’s fixed pose before it lands.'],
      ['NEW easings', 'turn, cubic-bezier(.45, 0, .2, 1); travel, cubic-bezier(.32, 0, .12, 1). Reduced motion everywhere: nothing travels, scales or turns; a change is a dip, never a cross-fade of two faces.']]);
    const body = `<div style="padding:20px">${parts}<div class="thumbs">${thumb({ s: 'o3P03' }, 'a setup page: O-P03', 456)}${thumb({ s: 'o3H01' }, 'the hand-off: O-H01', 456)}${thumb({ s: 'o3B02' }, 'the team card: O-B02', 456)}</div></div>`;
    return board('C01 Onboarding’s own parts and motion', 'Approved in revision 2 with "much more animation"; revision 3 adds the setup page on the whole window, the app assembling round the speaker, and the hand-off. Nothing here enters the kit; the product UI on screen is v7 exactly.', [section('', 'Parts and motion', 'onboarding only (owner C02)', '', body, '')]);
  }

  /* ---------- C02: what onboarding takes from the kit and from orb2 ---------- */
  function c02() {
    const t2 = (head, rows) => `<div class="ob2-spec"><table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => i ? `<td>${c}</td>` : `<th>${c}</th>`).join('')}</tr>`).join('')}</table></div>`;
    const kit = t2(['Screen', 'Kit components (DESIGN-SYSTEM.md 21)'], [
      ['O-P01 to O-P04', 'Button (primary, secondary, ghost), StatusLine, Card with SettingsRows, AskCard (options) as a Block, Notice, Well, Composer with its line, Mark (feedforward), Menu'],
      ['O-S01 to O-S04, O-H01', 'S41’s canvas: the launch row selectors, OptionRows in a Block, Buttons, Chips, the Composer (no dock: no bot of your own yet), the sidebar with its Sessions / Bots switch'],
      ['O-B01 to O-B10', 'Bubble (agent, you), Receipt, AskCard (choices, plan, rules with Switches, approval), Chip, StatusLine, SystemLine with Undo, ToolRow, hand-off line, ListRow, the Bots sidebar (main bot 44, rows 28)'],
      ['O-X01 to O-X04', 'the same, and Settings (Card, SettingsRows)']]);
    const orbs = t2(['orb2 behaviour (existing)', 'Where onboarding uses it'], [
      ['the <code>wake</code> emote, <code>reaction</code> from sleeping', 'the boopis bot after the morph (O-M8); kai and moss waking (O-M3)'],
      ['<code>emote(\'doubletake\')</code>', 'iris waking (O-M3)'],
      ['<code>lookAt(x, y)</code>, <code>gaze</code>', 'bots looking at each other, at boopis, at the tile under the pointer, at the choice card, at you'],
      ['<code>react(\'happy\')</code>, <code>poke</code>', 'a bot born, landing in its chat’s head, its tile or its row'],
      ['<code>spin(\'turntable\')</code>', 'round bodies only, until the geometric silhouette fix (flat bodies use <code>curious</code>)'],
      ['<code>blink()</code>', 'a bot noticing; boopis as each of its lines lands'],
      ['the fixed sidebar pose', 'every bot in the Bots sidebar (and the dock, which onboarding never shows): orb3’s home orientation (38, 22, −24) with K07’s pills at rest (the pose reaction), idle off, jelly 0, states only (ORBS.md 23, K08 B); ']]);
    const body = `<div style="padding:20px"><div class="fl-lab">THE KIT ON EACH SCREEN</div>${kit}<div class="fl-lab" style="margin-top:20px">THE BOTS: ORB2’S OWN BEHAVIOURS</div>${orbs}<div class="fl-lab">WOULD NEED NEW</div><div class="ob2-ledger"><p>None. The morph is scene motion between two existing elements (the logo and orb2), never a new behaviour of either.</p></div></div>`;
    return board('C02 What onboarding takes from the kit and from orb2', 'Every product part on an onboarding screen is a kit component as v7 draws it; every bot behaves only as orb2 already can (ORBS.md, w31/bot-character).', [section('', 'The kit and orb2', '', '', body, '')]);
  }

  window.OB3BOARDS = { o01, o02, o03, o04, c01, c02 };
})();
