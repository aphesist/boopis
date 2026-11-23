/* Onboarding revision 2: the choice boards, recording the owner's picks of 23 Nov (O01 B, O02 A, O03 closer to B, O04 A),
   and the component boards (the speaker, the tiles). Board scaffolding (.bd, .fl-) is the board's own; what is drawn in the
   cells is the real speaker, the real tiles and the real screens. */
(function () {
  const S = window.SCREENS, SP = window.OB2S, O2 = window.OB2;
  const n = (cls, b, i) => `<span class="fl-n ${cls}"><b>${b}</b>${i ? `<i>${i}</i>` : ''}</span>`;
  const a = '<span class="fl-a"></span>';
  const chain = (...xs) => `<div class="fl-row">${xs.join(a)}</div>`;
  const stats = (rows) => `<div class="fl-stats">${rows.map(([v, l]) => `<div><b>${v}</b>${l}</div>`).join('')}</div>`;
  const thumb = (q, label, w = 456) => { const k = w / 1440; return `<div><div class="thumb" style="width:${w}px;height:${900 * k}px"><div class="sc" style="transform:scale(${k})">${S[q.s](Object.assign({ theme: 'dark', chrome: 'a', tile: 'a', composer: 'c', status: 'c' }, q))}</div></div><div class="thumb-l">${label}</div></div>`; };
  const picked = (who) => `<span class="rec" style="background:#4fc9a8">PICKED${who ? ', ' + who : ''}</span>`;
  const section = (letter, title, sub, tag, body, note) => `<section><div class="opt-h"><b>${letter}${letter ? '. ' : ''}${title}</b><span>${sub}</span>${tag || ''}</div><div class="v7 cell" data-theme="dark" style="background:#111;border-radius:14px;box-shadow:0 0 0 1px #2a2a2a">${body}</div>${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, sections) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${sections.join('')}</div></div>`;
  const key = `<div class="fl-key"><span style="--k:#3a3a3a;--kb:#202020">a page (the tab's main area)</span><span style="--k:#4546c8;--kb:#1a1a2c">shared setup: asked once, by the first tab</span><span style="--k:#2f6f5a;--kb:#142420">Session only</span><span style="--k:#6b4f9c;--kb:#201a2c">Bots only</span><span style="--k:#8a8a8a;--kb:transparent">a receipt: already answered, not asked</span><span style="--k:#f0f0f0;--kb:#f0f0f0">first real result</span></div>`;
  const rc = (b, i) => `<span class="fl-n later"><b>${b}</b>${i ? `<i>${i}</i>` : ''}</span>`;

  /* ---------- O01: the structure, B picked: one onboarding per tab, the shared setup asked once ---------- */
  function o01() {
    const ledger = `<div class="fl-lab">THE RULE: ONE LEDGER FOR BOTH TABS (onboarding.json in the profile home)</div>
      <div class="ob2-ledger"><code>{ version: 2, tabs: { session: {step, done}, bots: {step, done} }, shared: { engine, consent, model, feedforward }, answers }</code>
      <p>Each tab's onboarding is a list of steps; a <b>shared</b> step reads the ledger first. Unanswered: the tab asks it, in its own surface, and writes it. Answered: the tab shows one receipt line instead and moves on. Whichever tab runs first asks; the other never does. Answers are written as they are given, so leaving a tab halfway and opening the other skips what is done and the first tab resumes at its step.</p></div>`;
    const sFirst = `<div class="fl-lab">SESSION FIRST (the window opens on Sessions after an install)</div>
      ${chain(n('intro', 'Hello', 'O-S01'), n('setup', 'Settings boopis needs', 'O-S02, required'), n('setup', 'Model', 'O-S03'), n('setup', 'Try it', 'O-S04'), n('sess', 'Add a folder', 'O-S05'), n('sess', 'How careful', 'O-S06'), n('task', 'First task', 'O-S07, ~1:40'))}
      <div class="fl-lab">THEN BOTS, ITS FIRST OPEN</div>
      ${chain(n('bots', 'Welcome to Bots', 'O-B01, second'), n('bots', 'The boopis bot', 'O-B02'), n('bots', 'Your team', 'O-B03'), n('bots', 'Goals', 'O-B04, tiles'), rc('Model, Try it', 'O-B05c, receipt'), n('bots', 'Where, name', 'O-B06, O-B07'), n('bots', 'Team, rules', 'O-B08, O-B09'), n('bots', 'Build, reach', 'O-B10, O-B11'), n('task', 'First job', 'O-B12, ~2:50'))}`;
    const bFirst = `<div class="fl-lab">BOTS FIRST (the person switches to Bots, or the window opened there)</div>
      ${chain(n('intro', 'Hello', 'O-B01'), n('setup', 'Settings boopis needs', 'O-B01c, required'), n('bots', 'The boopis bot', 'O-B02'), n('bots', 'Your team', 'O-B03'), n('bots', 'Goals', 'O-B04'), n('setup', 'Model, Try it', 'O-B05a, O-B05b, in boopis’s chat'), n('bots', 'Where … build', 'O-B06 to O-B10'), n('bots', 'Reach', 'O-B11'), n('task', 'First job', 'O-B12, ~3:30'))}
      <div class="fl-lab">THEN SESSIONS, ITS FIRST OPEN</div>
      ${chain(n('sess', 'Welcome to Sessions', 'O-S01, second'), rc('Settings, model, Try it', 'receipts on O-S05'), n('sess', 'Add a folder', 'O-S05'), n('sess', 'How careful', 'O-S06'), n('task', 'First task', 'O-S07, ~0:40'))}`;
    const thumbs = `<div class="thumbs">${thumb({ s: 'obS01' }, 'O-S01 Hello, the Session tab’s first open')}${thumb({ s: 'obB03' }, 'O-B03 Your team, the Bots tab')}${thumb({ s: 'obB04' }, 'O-B04 Goals, Grok’s tiles (O03)')}</div>`;
    const body = ledger + sFirst + bFirst + stats([['2', 'onboardings, one per tab'], ['0', 'shared questions asked twice'], ['~1:40 / ~3:30', 'to a first task / a first job when that tab is first'], ['~0:40 / ~2:50', 'when it is second (the shared part is receipts)']]) + thumbs + key;
    return board('O01 Onboarding structure: one onboarding per tab', 'The owner picked B on 23 Nov: each tab runs its own onboarding the first time it opens, and the shared setup (the engine and its consent, the model, the Try it of feedforward) is never asked twice. Whichever tab runs first asks it; the other tab’s onboarding shows a receipt and skips it. Revision 1’s A (one hybrid onboarding) and C (just in time) are retired; C’s idea survives as the second tab’s short path.', [
      section('B', 'One onboarding per tab', 'picked 23 Nov; redesigned for the rule below', picked('owner'), body,
        'Each tab explains itself in its own surface (Sessions: the S41 canvas; Bots: Grok’s full-window moment, then boopis’s chat), so neither needs the old shared intro or "Where to start". The speaker is the same in both: the logomark (O04). The engine installs behind the first tab’s first pages either way.')]);
  }

  /* ---------- O02: the approval rules walkthrough, A picked: in the Bots onboarding ---------- */
  function o02() {
    const body = `<div class="fl-lab">WHERE THE RULES ARE WALKED THROUGH</div>${chain(n('bots', 'Team plan', 'O-B08'), n('bots', 'Approval rules', 'O-B09, the eight defaults'), n('bots', 'Build', 'O-B10, hold'), n('task', 'First job', 'O-B12, a real ask names its rule'))}
      <div class="thumbs">${thumb({ s: 'obBRules' }, 'the rules card (revision 1’s O17, unchanged, now O-B09)')}</div>`;
    return board('O02 Where the approval rules are walked through', 'Picked A on 23 Nov: in the Bots onboarding, just before the team is built, where the rules start to mean something. Sessions never show them: a session’s "how careful" (O-S06) is its own setting.', [section('A', 'In the Bots onboarding', 'picked 23 Nov', picked('owner'), body, '')]);
  }

  /* ---------- O03: the goal picker, "closer to B": Grok's tiles, an onboarding-only component ---------- */
  function o03() {
    const G = O2.GOALS;
    const cell = (inner, w = 212, cap = '') => `<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start"><div style="width:${w}px">${inner}</div>${cap ? `<div class="thumb-l">${cap}</div>` : ''}</div>`;
    const states = (theme) => `<div class="v7 ob2-bcell" data-theme="${theme}"><div class="row" style="gap:16px;align-items:flex-start;flex-wrap:nowrap">
      ${cell(O2.tile(G[1], ''), 212, 'rest')}${cell(O2.tile(G[1], 'hov'), 212, 'hover: the surface +4% ink, 120 ms')}${cell(O2.tile(G[0], 'on'), 212, 'chosen: the bot takes it')}${cell(O2.tile(G[3], 'on'), 212, 'a second pick: another bot')}</div></div>`;
    const spec = `<div class="ob2-spec"><table>
      <tr><th>Grid</th><td>3 × 2, tiles 212 × 104, gap 12 (Grok: 3 × 3 tiles of 160 × 77, gap 10; boopis has six goals and longer names)</td></tr>
      <tr><th>Tile</th><td>the Card’s surface (<code>--bg-3</code>, <code>--line</code>, <code>--shadow-inline</code> light), radius <code>--r-card</code>, continuous corners, 14 inset</td></tr>
      <tr><th>Icon</th><td>16 px in a 28 px disc (<code>--fill-2</code>), top left on the 14 inset</td></tr>
      <tr><th>Name</th><td><code>--fs-l</code> 15/22, <code>--text</code>, one line, bottom left on the 14 inset</td></tr>
      <tr><th>Chosen</th><td>a 2 px ring and a 10% tint in the colour of the bot that takes the goal (Grok: the bot’s colour); the icon’s disc gives way to that bot’s orb, 28 px, orb2 as it is</td></tr>
      <tr><th>Picks</th><td>up to three; a fourth press shakes the tile (the speaker’s shake, 10 deg, 560 ms) and the lede reads "Up to three. Unpick one first."; the bots that orbit the heading look at the tile under the pointer</td></tr>
      <tr><th>Keys</th><td>arrows move, Space picks, Enter is Next; each tile is a checkbox to a screen reader ("Code and reviews, kai takes it, checked")</td></tr></table></div>`;
    const body = `<div style="padding:20px">${states('dark')}${states('light')}${spec}<div class="thumbs">${thumb({ s: 'obB04' }, 'O-B04 Goals: one pick made, one hovered')}${thumb({ s: 'obB04', picks: 'two' }, 'two picks: kai and iris took theirs, a third hovered')}</div></div>`;
    return board('O03 The goal picker: Grok’s tiles', 'The owner chose "closer to B" on 23 Nov: Grok-Bot’s tiles, designed as an onboarding-only component (it is not added to the kit and appears nowhere else). It sits on a full-window page of the Bots onboarding (O-B04), the bots you just met orbiting the heading as Grok’s characters do; picking a goal sends a bot into its tile. The choice feeds the starter team (O-B08).', [
      section('B', 'Goal tiles, onboarding only', 'picked 23 Nov, "closer to B"', picked('owner'), body, 'Revision 1’s A (the AskCard’s lettered rows) is retired for this step; the AskCard stays for every in-chat question.')]);
  }

  /* ---------- O04: the speaker, A picked and pushed further: the logomark with a living head ---------- */
  function o04() {
    const P = ['rest', 'you', 'down', 'left', 'right', 'upLeft', 'tiltLeft', 'turnLeft', 'turnRight'];
    const poses = (theme) => `<div class="v7 ob2-bcell" data-theme="${theme}"><div class="ob2-poses">${P.map((p) => `<div class="ob2-pose">${SP.spk(96, { pose: p })}<span>${p}</span></div>`).join('')}</div></div>`;
    const ST = [['idle', 'idle'], ['happy', 'happy: an answer, a hop'], ['listening', 'listening: you type'], ['thinking', 'thinking: looks up left'], ['skeptic', 'doubt: a shake'], ['sleeping', 'asleep: before it wakes']];
    const states = `<div class="v7 ob2-bcell" data-theme="dark"><div class="ob2-poses">${ST.map(([s, l]) => `<div class="ob2-pose">${SP.spk(64, { state: s, pose: s === 'thinking' ? 'upLeft' : s === 'listening' ? 'tiltLeft' : 'rest' })}<span>${l}</span></div>`).join('')}</div></div>`;
    const sizes = `<div class="v7 ob2-bcell" data-theme="dark"><div class="row" style="gap:40px;align-items:flex-end">${[[96, 'hero: a page, 111 px wide'], [44, 'stage: above a conversation and in S41, 51 px'], [22, 'never smaller: below 44 the mark is the still logo']].map(([z, l]) => `<div class="ob2-pose">${z >= 44 ? SP.spk(z, { pose: 'you' }) : `<boopis-logo mark still style="font-size:${z}px;color:var(--text-strong)"></boopis-logo>`}<span>${l}</span></div>`).join('')}</div></div>`;
    const spec = `<div class="ob2-spec"><table>
      <tr><th>Two layers</th><td><b>Eyes</b>: the shipped <code>&lt;boopis-logo mark&gt;</code> with its own idle off (<code>gaze="off" blink="off"</code>); the director calls its <code>look(x, y)</code>, <code>blink()</code> and <code>morph(state)</code>, so every eye shape, the blink and the morphs are the element’s. <b>Head</b>: a wrapper that travels, turns (rotateY in a perspective of 5.2 W, so the pair compresses toward the side it turns to and the far eye shrinks, as Grok’s characters turn), nods, tilts, bobs, hops, squashes and breathes. There is no body; the head is seen only through the eyes.</td></tr>
      <tr><th>Units</th><td>W, the pair’s width: 111 px at the hero size (type 96), 51 px at the stage size (44)</td></tr>
      <tr><th>Look at a thing</th><td>eyes first (the element’s easing), the head 60 ms later: travel up to 0.2 W, yaw up to 34 deg, pitch 18, roll 9; 420 ms <code>--spring</code></td></tr>
      <tr><th>Turn</th><td>a full turn to a thing beside it: yaw 60 deg, travel 0.3 W, 520 ms on the onboarding turn ease (.45, 0, .2, 1), a blink as it starts (Grok blinks into its turns)</td></tr>
      <tr><th>Bob, hop, nod, shake</th><td>bob 0.07 W (a line said), 500 ms; hop 0.14 to 0.22 W with an anticipation squash, 640 ms; nod 12 then 7 deg, 520 ms; shake 3 swings of 10 deg, 560 ms</td></tr>
      <tr><th>Idle</th><td>glance and return (Grok’s pattern, ORBS.md T2): a look aside every 1.4 to 2.8 s, held 0.7 to 1.5 s, then back to <i>you</i>; one in four a double glance; a blink on half the turns over 20 deg; a breath of 1.2% over 3.6 s at the hero size only</td></tr>
      <tr><th>Reduced motion</th><td>the head never moves; a look or a state change is a dip (out 90, hidden 220, in 90 ms) so two pairs of eyes are never shown at once</td></tr>
      <tr><th>Stills</th><td>always at rest in a named pose: no breath, hop, blink or morph in flight (the sweep rule)</td></tr></table></div>`;
    const body = `<div style="padding:20px"><div class="fl-lab">NINE POSES (the head and the eyes together), DARK AND LIGHT</div>${poses('dark')}${poses('light')}<div class="fl-lab">ITS STATES (the bots’ own eye states, through the element)</div>${states}<div class="fl-lab">TWO SIZES</div>${sizes}${spec}</div>`;
    return board('O04 Who speaks: the logomark, alive', 'The owner picked A on 23 Nov, with a direction: not a static ball, but the boopis logomark, its two o’s as eyes, "moving vividly, as if it was a bot, looking around". The base is the "oo" mark of DESIGN-SYSTEM.md 20.1; onboarding pushes it much further with a head of its own (onboarding only, owner C02). It speaks on every page and in the Session tab’s setup conversation, and becomes the S41 mark when the session canvas opens. In the Bots tab its eyes drop into the boopis orb (O-B02) and from then on the boopis bot speaks: the logo given a body.', [
      section('A', 'The app speaks, as the living logomark', 'picked 23 Nov', picked('owner'), body, '')]);
  }

  window.OB2BOARDS = { o01, o02, o03, o04 };
})();
