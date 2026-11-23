/* Onboarding revision 3 (docs/design/v7/onboarding/ONBOARDING.md): the owner's final structure, one continuous first run.
   (a) SETUP, full window, before the app: no sidebar, composer, title pill or dock; the oo logomark leads (Grok-Bot 001 to 008):
       hello, the engine settings, the model, Try it.
   (b) SESSIONS: the app opens on the Sessions tab and the logomark carries on into the new-session canvas as mark A, still the
       one who speaks: the folder, the worktree, how careful, ready.
   (c) THE HAND-OFF: mark A morphs into the boopis bot and the tab switches to Bots by itself, with Later visible the whole time.
   (d) BOTS: the boopis bot takes over in its own chat, Grok-style, with choice cards: what bots are, the goals, where they work,
       your name, the team and connectors, the approval rules, the build, reach, the first job.
   Revision 2's look and motion are kept (the owner: "everything is looking dandy now"); its builders are reused. */
(function () {
  const { I, mark } = window.V7;
  const S = window.SCREENS, OB = window.OB, SP = window.OB2S, O2 = window.OB2;
  const { you, rcpt, m, STEPS, ticks, choices, bsay } = OB;
  const { orb, acts, prim, sec } = O2;
  const cm = (f, s = 14) => mark(f, s);
  const wc = OB.wc;
  const askHead = (who, line, end = '') => `<div class="row xs dim" style="gap:6px;margin-bottom:4px">${who}${line}<span class="grow"></span>${end}</div>`;

  /* ---------- (a) the setup pages: the whole window, only the window glyphs; the logomark leads ---------- */
  function prePage(o, inner, ex = {}) {
    const skip = ex.skip === false ? '' : `<span class="btn ghost ob-skip">${ex.skip || 'Skip setup'}</span>`;
    return S.frame(o, `<div class="ob-page ob2 ob3-pre">${inner}</div>${skip}<div class="ob-wc">${wc()}</div>`);
  }
  const top = (pose = 'down', st) => `<div class="ob2-pagespk">${SP.spk(44, { pose, state: st })}</div>`;
  const head = (h, l) => `<div class="ob-h">${h}</div><div class="ob-lede">${l}</div>`;

  /* O-P01 hello (the speaker at the hero size, in the scene) */
  function hello(o) {
    const scene = `<div class="ob-scene ob2-stage"><div class="ob2-hero">${SP.spk(96, { pose: o.pose || 'you', state: o.state || 'idle' })}</div></div>`;
    const busy = o.engine === 'busy' ? `<div class="ob-status"><span class="shimmer">Getting boopis ready</span><span class="mono xs dim">62%</span></div>` : '';
    return prePage(o, `${head('Hi, I’m boopis', 'A minute of setup here, then sessions, then your bots. I’ll walk you through it.')}${scene}${acts(busy || prim('Let’s start'))}`);
  }
  /* O-P02 the three engine settings boopis needs (required, invariant 6) */
  function consent(o) {
    const row = (k, v, why) => `<div class="sr"><div class="lb">${why}<small class="mono">${k} = ${v}</small></div><span style="color:var(--accent-text);display:inline-flex">${I('check')}</span></div>`;
    const c = `<div class="card sq ob3-card">${row('tools.tool_search.enabled', 'off', 'Show boopis’s tools directly')}${row('delegation.backend', 'boopis', 'Route governed work to each model tier')}${row('plugins.entries.boopis.allow_gateway_injection', 'true', 'Let a held message continue a turn')}</div>`;
    return prePage(o, `${top('down')}${head('Settings boopis needs', 'boopis changes three engine settings, and only these. It asks before it changes any other.')}${c}${acts(prim('Apply the changes'), sec('Not now'))}`, { skip: false });
  }
  /* O-P03 the model: found (Claude pre-selected), nothing found, signing in, a failed sign-in, offline */
  const optrow = (lead, n, d, on, hv) => `<div class="optrow sq${on ? ' on' : ''}${hv ? ' hov' : ''}"><span class="ring"></span>${lead}<div class="col grow"><span class="m">${n}</span>${d ? `<span class="xs dim ell">${d}</span>` : ''}</div></div>`;
  function model(o) {
    const st = o.st || 'found';
    let c, lede = 'I found these on this computer, so you only need to confirm.', a = acts(prim('Use Claude'), sec('Add another')), pose = 'down', state, above = '';
    const found = () => `<div class="qcard sq ob3-card"><div class="ob-opts">${optrow(cm('claude', 16), 'Claude', 'Claude Code, signed in. Starts on Claude Opus.', 1)}${optrow(cm('openai', 16), 'ChatGPT', 'Your ChatGPT plan, signed in', 0, o.hov === '1')}${optrow(cm('ollama', 16) || I('terminal'), 'Ollama', '2 models on this computer')}</div></div>`;
    if (st === 'found' || st === 'offline') c = found();
    if (st === 'offline') above = `<div class="notice sq ob3-notice">${I('clock')}<span class="grow"><span style="color:var(--text)">No internet right now.</span> Your answers are saved.</span><span class="btn xs ghost">Try again</span></div>`;
    if (st === 'none') { lede = 'Use a plan you already pay for, or a key. Nothing is signed in on this computer yet.'; c = `<div class="qcard sq ob3-card"><div class="ob-opts">${optrow(cm('claude', 16), 'Sign in with Claude', 'Your Claude plan', 1)}${optrow(cm('openai', 16), 'Sign in with ChatGPT', 'Your ChatGPT plan')}${optrow(cm('gemini', 16), 'Use a Gemini key', 'Paste a key from Google AI Studio')}</div></div>`; a = acts(prim('Sign in with Claude'), sec('Use the free models')); }
    if (st === 'waiting') { lede = 'Finish signing in in your browser. This page moves on by itself when it’s done.'; c = `<div class="qcard sq ob3-card">${askHead(cm('claude', 14), 'Signing in with Claude', '<span class="word">waiting</span>')}<div class="m">The sign-in page is open in your browser.</div></div>`; a = acts(prim('Open the page again'), sec('Cancel')); pose = 'upLeft'; state = 'thinking'; }
    if (st === 'failed') { lede = 'I found Claude Code here, but it isn’t signed in. Sign in once in a terminal, then check again.'; c = `<div class="qcard sq ob3-card">${askHead(cm('claude', 14), 'Claude', '<span class="word" style="color:var(--red-text)">not signed in</span>')}<div class="well sq" style="margin:4px 0 0">claude auth login</div></div>`; a = acts(prim('Check again'), sec('Use something else')); pose = 'downLeft'; state = 'skeptic'; }
    return prePage(o, `${top(pose, state)}${head('A model to think with', lede)}${above}${c}${a}`);
  }
  /* O-P04 Try it: the real composer is the scene (the component, not the app); the marks, the menu, then keep it on */
  function tryIt(o) {
    const rec = o.rec === '1', phase = o.phase || 'open';
    const ship = phase === 'ask' ? m('ship it', 'chosen') : m('ship it', phase === 'open' ? 'open' : 'shown');
    const typed = `refactor ${m('the billing helpers', 'shown')} and ${ship}`;
    const under = `<span class="row" style="gap:4px">${I('pen')}Will assume: the helpers in <span class="mono">billing/</span></span><span class="grow"></span><span>${phase === 'ask' ? 'Sent with it: open a pull request' : 'Nothing is sent'}</span>`;
    const comp = S.composer({ ...o, composer: 'c', typed, under, composerW: 640 });
    const menu = phase === 'open' ? `<div class="menu sq ob3-menu" data-anchor="open"><div class="mt">I read “ship it” as</div><div class="mi sq hov">${I('check')}Open a pull request</div><div class="mi sq"><span style="width:16px"></span>Merge it into main</div><div class="mi sq"><span style="width:16px"></span>Commit, don’t push</div><div class="sepr"></div><div class="mi sq"><span style="width:16px"></span>Something else…</div></div>` : '';
    /* the recorded example's Notice sits under the composer, clear of the reading's menu above its mark */
    const note = rec ? `<div class="notice sq ob3-notice">${I('clock')}<span class="grow">Recorded example. Connect a model and boopis reads your own drafts.</span></div>` : '';
    const scene = `<div class="ob-scene ob3-tryscene">${menu}<div class="ob3-trycomp">${comp}${note}</div></div>`;
    const ask = phase === 'ask';
    const a = ask ? acts(prim('Keep it on'), sec('Turn it off')) : acts(sec('Skip the example'));
    const lede = ask ? 'Reads with Claude Haiku, the cheapest model you have. Each read is on the ledger.' : 'I read what you write before you send it, and mark what I’d otherwise ask you later. Open a mark to answer it.';
    return prePage(o, `${top(ask ? 'you' : 'down', ask ? '' : 'listening')}${head(ask ? 'Keep reading your drafts?' : 'One thing boopis does differently', lede)}${scene}${a}`);
  }

  /* ---------- (b) Sessions: the app opens; the logomark is mark A on the new-session canvas ---------- */
  /* no own bot yet (boopis alone does not count), so no dock: the composer sits 24 px from the bottom (DESIGN-SYSTEM 21.4, K06) */
  function canvas(o, inner, ex = {}) {
    return S.sessShell(o, '', S.sessComp(o, ex.ph || 'What should change? @ files, $ skills, / commands', { typed: ex.typed, under: ex.under || '<span>Enter starts the session</span><span class="grow"></span><span>ctrl Enter starts it in the background</span>' }), { mainInner: `<div class="ns">${inner}</div>`, title: S.sessTitle(ex.title || 'New session'), side: ex.side || S.emptyInbox, noDock: true, overlay: ex.overlay });
  }
  const nsMark = (pose = 'you', st) => `<span class="ns-mark">${SP.spk(44, { pose, state: st })}</span>`;
  const sel = (h) => `<span class="select ns-sel">${h}${I('chevron-down')}</span>`;
  const launch = (n = 5) => `<div class="ns-launch">${[sel(`${I('folder')}boopis`), sel(`${I('fork')}New worktree`), sel(`${cm('claude', 14)}Claude Opus`), sel(`${ticks(3)}Default`), sel(`${I('shield')}Auto-accept edits`)].slice(0, n).join('')}</div>`;
  /* a question on the canvas: OptionRows in a Block, its CTA on the Block's content edge (the rows' edge) */
  const block = (rows, cta, note) => `<div class="qcard sq ob3-nsq"><div class="ob-opts">${rows}</div><div class="ob-foot"><span class="btn xs primary">${cta}</span><span class="grow"></span><span class="xs dim">${note}</span></div></div>`;
  function folder(o) {
    return canvas(o, `${nsMark('you')}<div class="ns-h">Add a folder to start</div><div class="s dim ob3-nss">A session works in one project folder. Nothing in it changes until you say so.</div><div class="row ob3-pair"><span class="btn primary">${I('folder')}Add a project</span><span class="btn">Import sessions</span></div>`, { title: 'Sessions', ph: 'Add a folder to start', under: '<span>Sessions start in a folder</span>' });
  }
  function worktree(o) {
    const rows = [['In a new worktree', 'Each session gets its own copy. Your checkout stays as it is.', 1], ['In the folder itself', 'Changes land in your checkout, where you work.']].map(([n, d, on]) => `<div class="optrow sq${on ? ' on' : ''}"><span class="ring"></span><div class="col grow"><span class="m">${n}${on ? '<span class="xs dim" style="margin-left:8px">recommended</span>' : ''}</span><span class="xs dim">${d}</span></div></div>`).join('');
    return canvas(o, `${nsMark('down')}<div class="ns-h">Where should sessions make changes?</div>${launch(1)}<div class="ob3-gap"></div>${block(rows, 'Use worktrees', 'Change it per session')}`, { ph: 'Pick where sessions work first' });
  }
  function careful(o) {
    const rows = STEPS.map(([n, d], i) => `<div class="optrow sq${i === 1 ? ' on' : ''}"><span class="ring"></span><div class="col grow"><span class="m">${n}${i === 1 ? '<span class="xs dim" style="margin-left:8px">recommended</span>' : ''}</span><span class="xs dim">${d}</span></div></div>`).join('');
    return canvas(o, `${nsMark('down')}<div class="ns-h">How careful should sessions be?</div>${launch(3)}<div class="ob3-gap"></div>${block(rows, 'Use Auto-accept edits', 'Change it in Settings, Sessions')}`, { ph: 'Pick how careful first' });
  }
  const chips = `<div class="row ob3-chips"><span class="chip">Explain how this project is laid out</span><span class="chip">Find and fix one failing test</span><span class="chip">Review the last 3 commits</span></div>`;
  function ready(o) {
    const typed = o.typed ? `Find why ${m('the tests', 'shown')} fail on ${m('CI', 'shown')} and fix it` : '';
    return canvas(o, `${nsMark(o.typed ? 'down' : 'you', o.typed ? 'listening' : '')}<div class="ns-h">You’re set. What’s first?</div>${launch(5)}${chips}`, { typed });
  }

  /* ---------- (c) the hand-off: mark A is about to become the boopis bot; the tab switches by itself, Later stays visible ---------- */
  function handoff(o) {
    const prompt = o.v === 'prompt';
    const btns = prompt ? `<div class="row ob3-pair"><span class="btn primary">Meet your bots</span><span class="btn">Later</span></div>` : `<div class="col ob3-auto"><span class="s dim">Opening Bots in 3 s</span><span class="btn">Later</span></div>`;
    return canvas(o, `${nsMark(o.pose || 'you')}<div class="ns-h">One more thing: your bots</div><div class="s dim ob3-nss">A bot of mine takes it from here, in the Bots tab. It has my eyes.</div>${btns}`, { ph: 'What should change? @ files, $ skills, / commands' });
  }

  /* ---------- (d) Bots: the boopis bot in its own chat ---------- */
  /* the Bots tab's sidebar (ORBS.md K02 A): the switch, the main boopis bot at 44 centred with its name, the bots that exist as
     rows at 28. Every sidebar bot holds ONE fixed sideways three-quarter pose and moves only through its states (owner, 23 Nov).
     The exact pose lands in ORBS.md section 23; until then this is the dock's provisional pose (dockv7.js POSE, DESIGN-SYSTEM 21.4),
     so the sidebar and the dock share one constant. */
  const SIDE_POSE = '32 4';
  const sideOrb = (n, size, o) => orb(n, size, { ...o, gaze: SIDE_POSE }).replace('idle-motion="calm"', 'idle-motion="off" data-side');
  function botsSide(o = {}) {
    const team = o.team || [], st = o.st || {};
    const act = (n) => st[n] === 'needs' ? 'Needs you: install a package' : st[n] === 'working' ? 'Reviewing 3 commits' : O2.TEAM_ACT[n];
    const row = (n) => `<div class="sb-row sq ob2-row" data-n="${n}">${sideOrb(n, 28, { state: st[n] || 'idle', surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm ell">${n}</span><span class="act ell${st[n] === 'needs' ? ' owe' : ''}">${act(n)}</span></div>${st[n] === 'needs' ? '<span class="dot owe"></span>' : ''}</div>`;
    return `<aside class="side sb-open ob2-bside"><div class="row" style="justify-content:space-between;padding:0 6px 6px"><span class="seg"><span>Sessions</span><span class="on">Bots</span></span><span class="ib s">${I('plus')}</span></div>
      ${o.noMain ? '<div class="s dim ob2-nobots">No bots yet</div>' : `<div class="sb-main" data-n="boopis">${sideOrb('boopis', 44, { state: o.mainState || 'idle', surface: 'var(--bg-1)' })}<span class="nm">boopis</span></div>`}
      <div class="ob2-rows">${team.map(row).join('')}</div>
      <div class="foot-ctl" style="flex-direction:row;justify-content:flex-end;padding:12px 6px 0"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></div></aside>`;
  }
  const underBoopis = O2.underBoopis;
  function botsChat(o, body, ex = {}) {
    const title = S.pill(`${orb('boopis', 24, { surface: 'var(--bg-3)' })}boopis`, '');
    const comp = ex.comp || S.composer({ ...o, composer: 'c', placeholder: ex.ph || 'Type your answer, or ask something else', typed: ex.typed, under: ex.under || underBoopis, composerW: 720 });
    return S.frame(o, `${botsSide(ex)}${S.chrome({ ...o, sidebar: 'open', title })}<div class="main" style="left:300px"><div class="thread" style="padding-top:72px">${body}</div>
      <div class="ob2-compwrap" style="position:absolute;left:50%;transform:translateX(-50%);bottom:24px">${ex.above || ''}${comp}</div></div>${ex.overlay || ''}`);
  }
  function reshell(html, o, ex = {}) {
    const d = document.createElement('div'); d.innerHTML = html;
    const th = d.querySelector('.thread'); const comp = d.querySelector('.composer');
    const wrap = comp && comp.parentElement && comp.parentElement.parentElement;
    return botsChat(o, th ? th.innerHTML : '', { ...ex, comp: wrap ? wrap.innerHTML : '' });
  }
  /* the head of boopis's chat: the bot with its name, where the morph lands (lively in the clips, still in the stills) */
  const chatHead = (o = {}) => `<div class="ob3-chathead"><span class="ob3-ch-orb">${orb('boopis', 64, { surface: 'var(--bg-2)', state: o.state || 'idle', gaze: o.gaze || '0 -4' })}</span><span class="nm">boopis</span><span class="xs dim">Your main bot. It makes and runs the others.</span></div>`;

  /* O-B01 boopis greets you in its chat */
  function greet(o) {
    const body = `${chatHead({ state: o.state })}<div class="sep">Today 09:42</div>${bsay('Hi again. Same eyes, now with a body.')}${bsay('I’m the boopis bot. I make your bots, hand them work, and tell you what it cost. Shall we build your team?')}
      ${choices('Build your team now?', [['A', 'Yes, let’s go', 'about two minutes', 'hov'], ['B', 'Tell me what bots are first', ''], ['C', 'Later', 'I’ll be here, in Bots', '']])}`;
    return botsChat(o, body);
  }
  /* O-B02 what bots are: three bots in the chat, each with its job (lively in the clip: they wake, look at each other) */
  const TEAM = O2.TEAM;
  function teamCard(o = {}) {
    const g = o.gaze || {};
    const bot = (n) => `<div class="ob3-tm" data-n="${n}">${orb(n, 44, { state: o.asleep ? 'sleeping' : 'idle', surface: 'var(--bg-3)', gaze: g[n], id: n })}<span class="chip">${TEAM[n]}</span></div>`;
    return `<div class="blk sq wide ob3-team"><div class="ob3-tms">${bot('kai')}${bot('moss')}${bot('iris')}</div><div class="ob-foot"><span class="chip on">Got it</span><span class="grow"></span><span class="xs dim">Yours get their own jobs next</span></div></div>`;
  }
  const LOOKS_AT = { kai: '24 -8', moss: '-24 -8', iris: '-24 -4' };
  function bots(o) {
    const body = `<div class="sep">Today 09:42</div>${you('Tell me what bots are first')}${bsay('A bot is a teammate with one job. It works on its own computer, on its own time, and asks you before anything risky.', ' style="margin-top:16px"')}${bsay('Here are three I could make for you:')}${teamCard({ gaze: o.asleep ? {} : LOOKS_AT, asleep: o.asleep })}`;
    return botsChat(o, body);
  }
  /* O-B03 the goals: Grok's tiles (O03), in the chat. The free bots wait in the card's head; a pick sends one into its tile */
  const GOALS = O2.GOALS;
  function goalCard(picks = {}) {
    const free = GOALS.filter((g) => g[2] && picks[g[1]] !== 'on').map((g) => `<span class="ob3-free" data-n="${g[2]}">${orb(g[2], 24, { surface: 'var(--bg-3)', gaze: '0 -10' })}</span>`).join('');
    return `<div class="blk sq wide ob3-goals"><div class="hd"><span>Pick up to three. Each pick gets a bot.</span><span class="grow"></span><span class="row ob3-frees">${free}</span></div><div class="ob-gts">${GOALS.map((g) => O2.tile(g, picks[g[1]] || '')).join('')}</div><div class="ob-foot"><span class="chip${Object.values(picks).includes('on') ? ' on' : ''}">Next</span><span class="grow"></span><span class="xs dim">${Object.values(picks).filter((x) => x === 'on').length} of 3</span></div></div>`;
  }
  function goals(o) {
    const picks = o.picks === 'none' ? {} : { 'Code and reviews': 'on', 'Research and writing': o.picks === 'two' ? 'on' : 'hov' };
    if (o.picks === 'two') picks['Data and reports'] = 'hov';
    const body = `<div class="sep">Today 09:43</div>${you('Got it')}${bsay('So what should your bots work on first?', ' style="margin-top:16px"')}${goalCard(picks)}`;
    return botsChat(o, body);
  }
  /* O-B04 where the bots work */
  function where(o) {
    const body = `<div class="sep">Today 09:44</div>${you('Code and reviews, Research and writing')}${bsay('Good picks. Your bots need a computer to work on. Where should it be?', ' style="margin-top:16px"')}
      ${choices('Where should your bots work?', [['A', 'This computer, in a container', 'recommended, kept apart, about 4 GB', 'hov'], ['B', 'A computer I own', 'a home server, paired by a code'], ['C', 'A cloud server', 'your own server, set up over SSH'], ['D', 'Directly on this computer', 'no container; risky steps ask']], '<span class="grow xs dim">Change it any time in Settings, Bots.</span>')}`;
    return botsChat(o, body);
  }
  /* O-B05 to O-B10: revision 1's cards and copy (revision 2's in the v7 Bots tab), in the order of revision 3 */
  const TEAM3 = ['kai', 'moss', 'iris'];
  const name = (o) => reshell(S.obBName(o), o);
  const team = (o) => reshell(S.obBTeam(o).replace('>Code and reviews<', '>Alex<').replace('Here’s a small team for that. Nothing is made until you hold the button.', 'Alex it is. Here’s a small team for code and reviews. Nothing is made until you hold the button.'), o);
  const rules = (o) => reshell(S.obBRules(o), o);
  const build = (o) => reshell(S.obBBuild(o).replace('They’re in the rail, and along the bottom of the screen.', 'They’re in your sidebar, under me.'), o, { team: TEAM3, st: { iris: 'happy' } });
  const reach = (o) => reshell(S.obBReach(o).replace('The dock<small>Your bots along the bottom edge. Hold to approve.</small>', 'The dock, in Sessions<small>Your bots under the composer while you work in a session.</small>'), o, { team: TEAM3 });
  const first = (o) => reshell(S.obBFirst(o), o, { team: TEAM3, st: { moss: 'needs', kai: 'working' } });

  /* ---------- the ledger: resume, Settings, returning users, the Bots part skipped ---------- */
  function resume(o) {
    return prePage(o, `${top('you', 'happy')}${head('Pick up where we left off?', 'Your model is connected. Next: Try it, then sessions and your bots.')}<div class="ob2-rcpts ob3-rc">${rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}</div>${acts(prim('Pick up'), sec('Start again'))}`, { skip: 'Finish later' });
  }
  function settings(o) {
    const rev1 = S.obSettings(o); const dlg = rev1.slice(rev1.indexOf('<div class="scrim">'), rev1.lastIndexOf('</div>'));
    const html = ready(o).replace(/<\/div>$/, dlg + '</div>');
    const sr = (lb, val, ctl) => `<div class="sr"><div class="lb">${lb}</div>${val ? `<span class="val">${val}</span>` : ''}<span class="btn sm">${ctl}</span></div>`;
    const card = `<div class="set-head">Getting started</div><div class="card sq">${sr('Setup: the model, reading drafts', 'Done', 'Run it again')}${sr('Sessions', 'Done', 'Run it again')}${sr('Bots, with the boopis bot', 'Later', 'Start')}${sr('Try reading drafts', '', 'Try it')}</div>`;
    return html.replace(/<div class="set-head">Getting started<\/div><div class="card sq">[\s\S]*?<\/div>\s*<div class="set-head">This computer/, card + '\n      <div class="set-head">This computer');
  }
  function returning(o) {
    return prePage(o, `${top('you')}${head('Welcome to the new boopis', 'You’re already set up, so this takes a few seconds. One thing is new.')}<div class="ob3-rcs">${rcpt('Models: Claude and ChatGPT, as before')}${rcpt('Settings boopis needs: already set')}${rcpt('Your 4 bots and 12 sessions: all here')}</div><div class="ob3-new"><div class="m">I read what you write before you send it.</div><div class="xs dim">And mark what I’d otherwise ask you later.</div></div>${acts(prim('Show me'), sec('Keep it on, skip the example'))}`, { skip: 'Turn it off' });
  }
  /* the Bots part was skipped (Later): the Bots tab's first open starts from the morph. Before it: mark A, at the chat's head */
  function botsLater(o) {
    const body = `<div class="ob3-chathead"><span class="ob3-ch-orb">${SP.spk(44, { pose: 'you' })}</span><span class="nm">boopis</span><span class="xs dim">Back for your bots? One moment.</span></div>`;
    return botsChat(o, body, { noMain: true, ph: 'boopis is on its way', under: '<span>Nothing is sent yet</span>' });
  }

  Object.assign(window.SCREENS, {
    o3P01: hello, o3P02: consent, o3P03: model, o3P04: tryIt,
    o3S01: folder, o3S02: worktree, o3S03: careful, o3S04: ready, o3H01: handoff,
    o3B01: greet, o3B02: bots, o3B03: goals, o3B04: where, o3B05: name, o3B06: team, o3B07: rules, o3B08: build, o3B09: reach, o3B10: first,
    o3X01: resume, o3X02: settings, o3X03: returning, o3X04: botsLater
  });
  /* the reading's menu sits above its mark: its left edge 8 px left of the mark, its foot 8 px above the mark's top */
  function place(root = document) {
    root.querySelectorAll('.ob3-menu[data-anchor]').forEach((mn) => {
      const w = mn.closest('.win') || root; const mk = w.querySelector('.mk2[data-state="' + mn.dataset.anchor + '"]'); const box = mn.offsetParent; if (!mk || !box) return;
      const r = mk.getBoundingClientRect(), b = box.getBoundingClientRect();
      mn.style.left = (r.left - b.left - 8) + 'px'; mn.style.bottom = (b.bottom - r.top + 8) + 'px';
    });
  }
  window.OB3 = { place, prePage, top, head, canvas, nsMark, botsSide, botsChat, reshell, sideOrb, SIDE_POSE, chatHead, teamCard, goalCard, LOOKS_AT, TEAM3 };
})();
