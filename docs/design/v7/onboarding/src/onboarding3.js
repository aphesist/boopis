/* Onboarding boards: O02-O04 (the other open choices, board-09 format) and C01-C02 (new parts for approval, and the reuse map). */
(function () {
  const { I, mark, orb } = window.V7;
  const S = window.SCREENS, OB = window.OB;
  const T = ['dark', 'light'];
  const cell = (theme, inner, style = '') => `<div class="v7 cell" data-theme="${theme}" style="${style}">${inner}</div>`;
  const pair = (fn, style) => `<div class="pair">${T.map((t) => cell(t, fn(t), style)).join('')}</div>`;
  const opt = (letter, title, sub, rec, body, note, tag) => `<section><div class="opt-h"><b>${letter}${letter ? '. ' : ''}${title}</b><span>${sub}</span>${rec ? '<span class="rec">RECOMMENDED</span>' : ''}${tag ? `<span class="rec" style="background:#e28600">${tag}</span>` : ''}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, sections) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${sections.join('')}</div></div>`;
  const col = (inner, w = 560) => `<div class="thread" style="width:${w}px;margin:0;padding:0 0 0 30px;max-width:none">${inner}</div>`;
  const thumb = (q, label, w = 420) => { const k = w / 1440; return `<div><div class="thumb" style="width:${w}px;height:${900 * k}px"><div class="sc" style="transform:scale(${k})">${S[q.s](Object.assign({ theme: q.theme || 'dark', chrome: 'a', tile: 'a', composer: 'c', status: 'c' }, q))}</div></div><div class="thumb-l">${label}</div></div>`; };

  /* O02: where the approval rules are walked through */
  function o02() {
    const a = () => col(`${OB.bsay('Before they start: these are the things every bot asks you about first. Keep, edit or remove any of them.')}${OB.rulesCard({ hov: 6 })}`);
    const b = () => col(`${OB.say('Your bots, if you make any, will ask you before these. Keep, edit or remove any of them.', true)}${OB.rulesCard({})}`);
    return board('O02 Where the approval rules are walked through', 'Owner decision 10: onboarding walks through the plain-language rules (the eight defaults of rules-engine.md section 4, pre-filled and editable). The owner answered on 23 Nov that the rules apply to bots only, not to the owner’s own sessions, whose asks are the four-row scale (O09). So the question is only where the walkthrough sits; the card is the same AskCard either way.', [
      opt('A', 'In the Bots branch', 'after the plan card, before the hold builds the team (O17), spoken by the boopis bot', true, pair(a), 'Recommended. The rules are read when they start to mean something: just before bots exist. A person who starts in Session meets them at the Bots tab’s first open, never twice. The first job (O20) then shows a real approval naming one of these rules.'),
      opt('B', 'In the shared setup', 'after Try it, for everyone, spoken by the app (the mark A)', false, pair(b), 'Everyone sees the rules once, early, including people who may never make a bot; for them it is a rule list about nothing yet, and it adds about 15 seconds before a first session task.')]);
  }

  /* O03: the goal picker */
  function o03() {
    const rows = () => col(`${OB.bsay('What should your bots work on first? Pick up to three.')}${OB.choices('What should they work on?', [['A', 'Code and reviews', 'pull requests, tests, releases', 'on'], ['B', 'Research and writing', 'sources, notes, drafts'], ['C', 'Videos and posts', 'scripts, edits, schedules'], ['D', 'Data and reports', 'dashboards and summaries'], ['E', 'Inbox and calendar', 'needs a connector'], ['F', 'Something else', 'say it in a sentence']], '<span class="btn xs primary">Use these</span><span class="grow"></span><span class="btn xs ghost">Skip</span>', { check: true })}`);
    const tiles = () => {
      const t = [['session', 'Code and reviews', 1], ['file', 'Research and writing'], ['play', 'Videos and posts'], ['sliders', 'Data and reports'], ['clock', 'Inbox and calendar'], ['pen', 'Something else']];
      return col(`${OB.bsay('What should your bots work on first? Pick up to three.')}<div class="blk sq ob-w ob-tiles"><div class="ob-tg">${t.map(([i, l, on]) => `<div class="ob-tile sq${on ? ' on' : ''}">${I(i)}<span>${l}</span></div>`).join('')}</div><div class="ob-foot"><span class="btn xs primary">Use these</span><span class="grow"></span><span class="btn xs ghost">Skip</span></div></div>`);
    };
    return board('O03 The goal picker (O15)', 'Grok-Bot asks "What will you be working on most?" as a grid of tiles. boopis asks the same inside the boopis bot’s chat. The kit already has the AskCard’s lettered rows (choices); tiles would be a new variant of it.', [
      opt('A', 'Lettered rows', 'the AskCard, choices variant, as in board 09 and screen 11; checks for a multiple pick', true, pair(rows), 'Recommended: no new part (one kit), keyboard letters A to F answer, and each row can say what the goal brings ("needs a connector") in one truncating line.'),
      opt('B', 'Tiles', 'Grok’s grid: an icon and a label per tile, the chosen ones outlined in the accent', false, pair(tiles), 'Closer to Grok and more graphical, but it is a third look for an AskCard (NEW, FOR APPROVAL if picked: tiles 166 x 72, radius 14 on the Block’s 8 inset, a 2 px accent ring when chosen) and the tiles cannot carry a description.', '')]);
  }

  /* O04: who speaks in the shared setup */
  function o04() {
    const a = () => col(`${OB.say('Hi. I’ll set boopis up with you; it takes about a minute.')}${OB.say('First, a model to think with. I found these, so you only need to confirm.', true)}${OB.rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}`);
    const b = () => col(`<div class="b agent sq ob-say">Hi, I’m boopis, the bot that runs your team. I’ll set things up with you.</div><div class="b agent sq ob-say"><span class="ob-gm" style="background:none;box-shadow:none">${orb('boopis', 20, { still: true })}</span>First, a model to think with. I found these, so you only need to confirm.</div>${OB.rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}`);
    return board('O04 Who speaks in the shared setup (O05 to O07)', 'Before the branch, setup is a short conversation (Grok continues its onboarding inside the chat). Someone has to say the lines. The new-session mark A is the app’s face (20.1); the boopis bot’s orb is the Bots tab’s main bot (section 19).', [
      opt('A', 'The app, as the mark A', 'the "oo" logomark in the 22 px gutter tile, where a session’s model mark sits (S09); no name in the thread', true, pair(a), 'Recommended. The setup belongs to both tabs, so it speaks as the app. A person who starts in Session never meets a bot they did not ask for; in the Bots branch the eyes drop into the boopis orb (O11), so the bot visibly comes out of the mark.'),
      opt('B', 'The boopis bot, from the start', 'the ink orb in the gutter; the setup is the bot’s first chat', false, pair(b), 'More characterful and one conversation from the first line to the first job, but it says "a bot runs this" to someone who came for sessions, and the bot’s chat would hold the session setup forever.')]);
  }

  /* C01: the new parts, for approval */
  function c01() {
    const spec = `<div class="col ob-spec" style="gap:6px;font-size:13px;line-height:20px;color:var(--text-dim);width:380px">
      <div style="color:var(--text);font-weight:500">Page, intro variant</div>
      <div>Full window, no sidebar, no chrome but the window glyphs.</div>
      <div>Heading <span class="mono">--fs-3xl</span> 26/32 400, top 196.</div>
      <div>One line <span class="mono">--fs-l</span> at <span class="mono">--text-dim</span>, 8 under, at most 420 wide, balanced.</div>
      <div>Scene 760 x 300, 28 under.</div>
      <div>Actions at y 640: primary pill 288 x 36, a secondary 12 under; or the StatusLine (system) while the engine works.</div>
      <div>"Skip the intro": a ghost button, 24 from the left, 20 from the bottom.</div>
      <div>Between steps: the scene and the text cross-fade (200 ms, <span class="mono">--ease-sharp</span>), the buttons stay.</div></div>`;
    const page = (t) => `<div class="row" style="align-items:flex-start;gap:32px">${thumb({ s: 'obIntro', step: 2, theme: t }, 'O02 at 30%', 432)}${spec}</div>`;
    const sc = (fn) => (t) => `<div style="position:relative;width:760px;height:300px">${fn({})}</div>`;
    return board('C01 New parts (NEW, FOR APPROVAL)', 'Consolidation first: every other piece of onboarding is a kit component (C02). Two parts are new, and both are compositions of the kit rather than new controls: a Page variant for the full-window steps, and the Scene, an illustration built only from kit components at their real sizes, so it themes, scales and animates with the kit.', [
      opt('', 'Page, intro variant', 'the full-window step of O01 to O04, O11 and O12 (Grok-Bot 001 to 008)', false, pair(page), '', 'NEW, FOR APPROVAL'),
      opt('', 'Scene: two ways to work (O02)', 'two Cards (radius 14) holding a session in miniature and the bots; captions in the Card’s foot', false, pair(sc(OB.sceneTwoWays), 'padding:28px 0;display:flex;justify-content:center'), 'Real components: Bubble, Block with a Well, the Composer at 36, Avatars 44, the StatusLine, a StatusWord.', 'NEW, FOR APPROVAL'),
      opt('', 'Scene: you stay in charge (O03)', 'the AskCard (approval) and a SystemLine', false, pair(sc(OB.sceneCharge), 'padding:28px 0;display:flex;justify-content:center'), '', 'NEW, FOR APPROVAL'),
      opt('', 'Scene: give each bot a job (O12)', 'three Avatars at 64 with a Chip each, placed as Grok’s 003', false, pair(sc(OB.sceneJobs), 'padding:28px 0;display:flex;justify-content:center'), 'In motion the orbs wake from sleeping one by one (the clip O-M2).', 'NEW, FOR APPROVAL')]);
  }

  /* C02: the reuse map */
  function c02() {
    const rows = [['Intro steps (O01-O04, O11, O12)', 'Page (intro variant, NEW), Scene (NEW), Button, Avatar, the logo’s mark'], ['The setup conversation (O05-O07)', 'Page (column), Bubble, Avatar (brand tile with the mark A), AskCard (choices, question), OptionRow, Chip, Button, Composer, SystemLine'], ['Try it (O06)', 'Composer with its line, Mark (feedforward: shown, open, chosen), Menu with MenuRows, AskCard (question), Notice (the recording label)'], ['Session branch (O08-O10)', 'the new-session canvas pattern (S41): the mark A, SelectorItems (launch), OptionRows in a Block, Chips, Button'], ['Bots branch (O13-O20)', 'Rail, Dock, Avatar, Bubble, AskCard (choices, approval), the plan card (AskCard surface), ListRow (item) for connectors, Switch, StatusLine, SystemLine (receipt, hand-off), ToolRow'], ['Across (O21-O24)', 'AskCard, Notice, Dialog (large: Settings), Card, Row, Button, Well (the sign-in command)']];
    const tbl = () => `<table style="border-collapse:collapse;font-size:13px;line-height:20px;width:100%">${rows.map(([a, b]) => `<tr><td style="padding:8px 16px 8px 0;color:var(--text);white-space:nowrap;vertical-align:top">${a}</td><td style="padding:8px 0;color:var(--text-dim)">${b}</td></tr>`).join('')}</table>`;
    return board('C02 What onboarding reuses from the kit', 'Section 21’s 42 components: onboarding adds no control, only the two compositions on C01. Where a screen needs something the kit does not name, it is a variant listed here.', [opt('', 'The map', 'screens to components', false, pair(tbl, 'padding:20px 28px'), '')]);
  }

  Object.assign(window.OBOARDS, { o02, o03, o04, c01, c02 });
})();
