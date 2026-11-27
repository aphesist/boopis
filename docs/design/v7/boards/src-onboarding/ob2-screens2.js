/* Onboarding revision 2, batch 2: every remaining per-tab screen. The Session tab's setup conversation (the speaker on the
   stage above it), the S41 canvas with the speaker as its mark, the Bots tab's pages and boopis's chat. Product cards are
   revision 1's (onboarding.js, onboarding2.js), moved into the tab that owns them. */
(function () {
  const { I, mark } = window.V7;
  const S = window.SCREENS, OB = window.OB, SP = window.OB2S, O2 = window.OB2;
  const { you, rcpt, m, STEPS, ticks, logo, choices, approval, botChat, bsay } = OB;
  const { orb, sessPage, botsPage, botsChat, reshell, acts, prim, sec } = O2;
  const cm = (f, s = 14) => mark(f, s);
  const say = (h, st = '') => `<div class="b agent sq ob-say"${st}>${h}</div>`;
  const askHead = (who, line, end = '') => `<div class="row xs dim" style="gap:6px;margin-bottom:4px">${who}${line}<span class="grow"></span>${end}</div>`;
  const spkStill = (z) => `<boopis-logo mark still style="font-size:${z}px;color:var(--text-strong)"></boopis-logo>`;

  /* ---------- the Session tab's setup conversation: the speaker on the stage above the thread ---------- */
  function sessChat(o, body, comp, ex = {}) {
    const stage = `<div class="ob2-stagehead">${SP.spk(44, { pose: ex.pose || 'down', state: ex.state })}</div>`;
    const pill = S.pill(`<span style="display:grid;place-items:center;width:24px;height:24px">${spkStill(14)}</span><span>${ex.pillText || 'Set up sessions'}</span>`, ex.step === '' ? '' : `<span class="mono" style="font-size:12px">${ex.step || '1 of 3'}</span>`);
    return S.sessShell(o, '', comp, { mainInner: `<div class="thread ob2-sthread">${stage}${body}</div>`, title: pill, side: ex.side === 'inbox' ? undefined : S.emptyInbox, noDock: true, above: ex.above, overlay: ex.overlay });
  }
  const sComp = (o, ex = {}) => S.composer({ ...o, composer: 'c', placeholder: ex.ph || 'Pick an answer above', typed: ex.typed, under: ex.under || '<span>Nothing is sent until you pick</span>', composerW: 720 });
  const modelCard = () => {
    const opt = (lead, n, d, on) => `<div class="optrow sq${on ? ' on' : ''}"><span class="ring"></span>${lead}<div class="col grow"><span class="m">${n}</span><span class="xs dim ell">${d}</span></div></div>`;
    return `<div class="qcard sq ob-w">${askHead('', 'Found on this computer')}<div class="ob-opts">${opt(cm('claude', 16), 'Claude', 'Claude Code, signed in. Starts on Claude Opus.', 1)}${opt(cm('openai', 16), 'ChatGPT', 'Your ChatGPT plan, signed in')}${opt(cm('ollama', 16) || I('terminal'), 'Ollama', '2 models on this computer')}</div>
      <div class="ob-foot"><span class="btn xs primary">Use Claude</span><span class="btn xs">Add another</span><span class="grow"></span><span class="btn xs ghost">Use the free models</span></div></div>`;
  };
  const modelState = (st) => {
    const signins = `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="btn xs">${cm('claude', 14)}Sign in with Claude</span><span class="btn xs">${cm('openai', 14)}Sign in with ChatGPT</span><span class="btn xs">${cm('gemini', 14)}Use a Gemini key</span></div>`;
    if (st === 'none') return ['First, a model to think with. Use a plan you already pay for, or a key.', `<div class="qcard sq ob-w">${askHead('', 'Nothing signed in on this computer yet')}${signins}<div class="ob-foot"><span class="btn xs">More ways to connect</span><span class="grow"></span><span class="btn xs ghost">Use the free models</span></div></div>`, ''];
    if (st === 'waiting') return ['First, a model to think with.', `<div class="qcard sq ob-w">${askHead(cm('claude', 14), 'Signing in with Claude', '<span class="word">waiting</span>')}<div class="m" style="margin-bottom:8px">Finish signing in in your browser. This card updates when it’s done.</div><div class="ob-foot"><span class="btn xs">Open the page again</span><span class="grow"></span><span class="btn xs ghost">Cancel</span></div></div>`, ''];
    if (st === 'failed') return ['First, a model to think with. I found Claude Code here.', `<div class="qcard sq ob-w">${askHead(cm('claude', 14), 'Claude', '<span class="word" style="color:var(--red-text)">not signed in</span>')}<div class="m" style="margin-bottom:8px">Claude Code is installed but not signed in. Sign in once in a terminal, then check again.</div><div class="well sq" style="margin:0 0 8px">claude auth login</div><div class="ob-foot"><span class="btn xs primary">Check again</span><span class="btn xs">Copy the command</span><span class="grow"></span><span class="btn xs ghost">Use something else</span></div></div>`, ''];
    if (st === 'offline') return ['First, a model to think with. I found these, so you only need to confirm.', modelCard(), `<div class="notice sq" style="margin-bottom:8px">${I('clock')}<span class="grow"><span style="color:var(--text)">No internet right now.</span> Finish this later; your answers are saved.</span><span class="btn xs ghost">Try again</span></div>`];
    return ['First, a model to think with. I found these, so you only need to confirm.', modelCard(), ''];
  };

  /* O-S02 / O-B01c: the three engine settings, required (revision 1's O04 content), a page in the tab that runs first */
  function consentInner() {
    const row = (k, v, why) => `<div class="sr"><div class="lb">${why}<small class="mono">${k} = ${v}</small></div><span style="color:var(--accent-text);display:inline-flex">${I('check')}</span></div>`;
    const card = `<div class="card sq" style="width:520px;margin-top:28px">${row('tools.tool_search.enabled', 'off', 'Show boopis’s tools directly')}${row('delegation.backend', 'boopis', 'Route governed work to each model tier')}${row('plugins.entries.boopis.allow_gateway_injection', 'true', 'Let a held message continue a turn')}</div>`;
    return `<div class="ob2-pagespk">${SP.spk(44, { pose: 'down' })}</div><div class="ob-h">Settings boopis needs</div><div class="ob-lede">boopis changes three engine settings, and only these. It asks before it changes any other.</div>${card}${acts(prim('Apply the changes'), sec('Not now'))}`;
  }
  const sConsent = (o) => sessPage(o, consentInner());
  const bConsent = (o) => botsPage(o, consentInner(), { skip: false, noMain: true });

  /* O-S03: the model, in the Session tab's setup conversation */
  function sModel(o) {
    const [line, card, above] = modelState(o.st);
    const body = `<div class="sep">Today 09:40</div>${say('Hi again. I’ll set sessions up with you; it takes about a minute.')}${say(line)}${card}`;
    return sessChat(o, body, sComp(o, { ph: 'Choose a model first' }), { step: '1 of 3', above, pose: o.st === 'waiting' ? 'upLeft' : o.st === 'failed' ? 'downLeft' : 'down', state: o.st === 'failed' ? 'skeptic' : o.st === 'waiting' ? 'thinking' : '' });
  }
  /* O-S04: Try it, in the real composer (revision 1's O06, with the speaker looking down at the composer) */
  function tryBody(o, sayFn) {
    const rec = o.rec === '1', phase = o.phase || 'open';
    const ask = phase === 'ask' ? `<div class="qcard sq ob-w">${askHead('', 'Reading your drafts', '<span class="word">on</span>')}
      <div class="m" style="margin-bottom:4px">Keep reading my drafts?</div><div class="ob-sub ell">Reads with Claude Haiku, the cheapest model you have. Each read is on the ledger.</div>
      <div class="row" style="gap:6px"><span class="chip on">Keep it on</span><span class="chip">Turn it off</span></div></div>` : '';
    const sent = phase === 'ask' ? rcpt('Sent with your message: “ship it” means open a pull request (your choice)') : '';
    return `<div class="sep">Today 09:41</div>${you('Use Claude')}${rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}
      ${sayFn('One thing boopis does differently: I read what you write before you send it, and mark what I’d otherwise ask you later.', ' style="margin-top:16px"')}${sayFn(rec ? 'Here’s a recorded example. Open a mark to answer it.' : 'Watch the composer. Open a mark to answer it.')}${sent}${ask}`;
  }
  const tryTyped = (o) => { const phase = o.phase || 'open'; const ship = phase === 'ask' ? m('ship it', 'chosen') : m('ship it', phase === 'open' ? 'open' : 'shown'); return `refactor ${m('the billing helpers', 'shown')} and ${ship}`; };
  const tryUnder = `<span class="row" style="gap:4px">${I('pen')}Will assume: the helpers in <span class="mono">billing/</span></span><span class="grow"></span><span>Nothing is sent</span>`;
  const tryComp = (o) => S.composer({ ...o, composer: 'c', typed: tryTyped(o), under: tryUnder, composerW: 720 });
  /* the reading's menu, above its mark: 236 px right of the composer's left edge, 80 px above the composer's foot */
  const tryMenu = (o, composerLeft, composerBottom) => (o.phase || 'open') === 'open' ? `<div class="menu sq" style="position:absolute;left:${composerLeft + 236}px;bottom:${composerBottom + 80 + (o.rec === '1' ? 52 : 0)}px;width:268px;z-index:6"><div class="mt">I read “ship it” as</div><div class="mi sq hov">${I('check')}Open a pull request</div><div class="mi sq"><span style="width:16px"></span>Merge it into main</div><div class="mi sq"><span style="width:16px"></span>Commit, don’t push</div><div class="sepr"></div><div class="mi sq"><span style="width:16px"></span>Something else…</div></div>` : '';
  const recNote = (o) => o.rec === '1' ? `<div class="notice sq" style="margin-bottom:8px">${I('clock')}<span class="grow">Recorded example. Connect a model and boopis reads your own drafts.</span></div>` : '';
  function sTry(o) {
    return sessChat(o, tryBody(o, say), tryComp(o), { step: '2 of 3', above: recNote(o), overlay: tryMenu(o, 300 + (1140 - 720) / 2, 24), pose: (o.phase || 'open') === 'ask' ? 'you' : 'down' });
  }

  /* ---------- the S41 canvas, the speaker as its mark (it travelled there from the stage) ---------- */
  function sessCanvas(o, inner, ex = {}) {
    const keep = S.dockRow; S.dockRow = () => window.DOCK.dockRow({ bots: ex.bots || ['boopis'], needs: [], ask: false });   /* the v7 dock (Sessions only): the bots that exist */
    const out = S.sessShell(o, '', S.sessComp(o, ex.ph || 'What should change? @ files, $ skills, / commands', { typed: ex.typed, under: ex.under || '<span>Enter starts the session</span><span class="grow"></span><span>ctrl Enter starts it in the background</span>' }), { mainInner: `<div class="ns">${inner}</div>`, title: S.sessTitle(ex.title || 'New session'), side: S.emptyInbox });
    S.dockRow = keep; return out;
  }
  const nsMark = (pose = 'you', st) => `<span class="ns-mark">${SP.spk(44, { pose, state: st })}</span>`;
  function sFolder(o) {
    const second = o.v === 'second';
    const rc = second ? `<div class="ob2-rcpts">${rcpt('Already set in Bots: Claude Opus, and reading your drafts')}</div>` : '';
    return sessCanvas(o, `${nsMark('you')}<div class="ns-h">Add a folder to start</div><div class="s dim" style="margin:-6px 0 16px">A session works in one project folder. Nothing in it changes until you say so.</div><div class="row" style="gap:8px;justify-content:center"><span class="btn primary">${I('folder')}Add a project</span><span class="btn">Import sessions</span></div>${rc}`, { title: 'Sessions', ph: 'Add a folder to start', under: '<span>Sessions start in a folder</span>', bots: second ? ['boopis', 'kai', 'moss', 'iris'] : ['boopis'] });
  }
  function sCareful(o) {
    const rows = STEPS.map(([n, d], i) => `<div class="optrow sq${i === 1 ? ' on' : ''}"><span class="ring"></span><div class="col grow"><span class="m">${n}${i === 1 ? '<span class="xs dim" style="margin-left:8px">recommended</span>' : ''}</span><span class="xs dim">${d}</span></div></div>`).join('');
    const block = `<div class="qcard sq" style="width:440px;margin:0"><div class="ob-opts">${rows}</div><div class="ob-foot"><span class="btn xs primary">Use Auto-accept edits</span><span class="grow xs dim" style="text-align:right;padding-right:4px">Change it in Settings, Sessions</span></div></div>`;
    return sessCanvas(o, `${nsMark('down')}<div class="ns-h">How careful should sessions be?</div><div class="ns-launch" style="margin-bottom:16px"><span class="select ns-sel">${I('folder')}boopis${I('chevron-down')}</span><span class="select ns-sel">${I('fork')}New worktree${I('chevron-down')}</span><span class="select ns-sel">${cm('claude', 14)}Claude Opus${I('chevron-down')}</span></div>${block}`, { ph: 'Pick how careful first' });
  }
  function sFirst(o) {
    const typed = `Find why ${m('the tests', 'shown')} fail on ${m('CI', 'shown')} and fix it`;
    const chips = `<div class="row" style="gap:6px;justify-content:center;margin-top:24px"><span class="chip">Explain how this project is laid out</span><span class="chip">Find and fix one failing test</span><span class="chip">Review the last 3 commits</span></div>`;
    return sessCanvas(o, `${nsMark('down', 'listening')}<div class="ns-h">What’s next for boopis?</div><div class="ns-launch"><span class="select ns-sel">${I('folder')}boopis${I('chevron-down')}</span><span class="select ns-sel">${I('fork')}New worktree${I('chevron-down')}</span><span class="select ns-sel">${cm('claude', 14)}Claude Opus${I('chevron-down')}</span><span class="select ns-sel">${ticks(3)}Default${I('chevron-down')}</span><span class="select ns-sel">${I('shield')}Auto-accept edits${I('chevron-down')}</span></div>${chips}`, { typed });
  }

  /* ---------- the Bots tab ---------- */
  /* O-B02: meet the boopis bot: the speaker's eyes dropped into the orb (the logo given a body) */
  function bMeet(o) {
    return botsPage(o, `<div class="ob-h">Meet the boopis bot</div><div class="ob-lede">It makes your bots, hands them work and tells you what it cost. It has my eyes.</div><div class="ob-scene ob2-stage"><div class="ob2-hero">${orb('boopis', 120, { surface: 'var(--bg-2)', gaze: '0 -4', state: o.state || 'idle' })}</div></div>${acts(prim('Show me the bots'), sec('Back'))}`, { noMain: true });
  }
  /* O-B05a and O-B05b: the shared model and Try it, asked by the boopis bot in its chat when Bots runs first */
  function bModel(o) {
    const [line, card] = modelState('found');
    const body = `<div class="sep">Today 09:43</div>${you('Code and reviews')}${bsay('Got it. Before I make anyone: your bots need a model to think with.', ' style="margin-top:16px"')}${bsay(line.replace('First, a', 'A'))}${card}`;
    return botsChat(o, body, { ph: 'Choose a model first' });
  }
  function bTry(o) {
    return botsChat(o, tryBody(o, bsay), { typed: tryTyped(o), under: tryUnder, overlay: tryMenu(o, 300 + (1140 - 720) / 2, 24), above: recNote(o) });
  }
  /* O-B06: where your bots work. When Sessions ran first, the shared setup is a receipt, not a question (O-B05c) */
  function bWhere(o) {
    const second = o.v === 'second';
    const lead = second ? `${rcpt('Already set in Sessions: Claude Opus, and reading your drafts')}` : `${you('Keep it on')}${rcpt('Reading your drafts: on')}`;
    const body = `<div class="sep">Today 09:44</div>${lead}${bsay('Now your bots need a computer to work on. Where should it be?', ' style="margin-top:16px"')}
      ${choices('Where should your bots work?', [['A', 'This computer, in a container', 'recommended, kept apart, about 4 GB', 'hov'], ['B', 'A computer I own', 'a home server, paired by a code'], ['C', 'A cloud server', 'your own server, set up over SSH'], ['D', 'Directly on this computer', 'no container; risky steps ask']], '<span class="grow xs dim">Change it any time in Settings, Bots.</span>')}`;
    return botsChat(o, body);
  }

  /* ---------- across both tabs ---------- */
  function resume(o) {
    const body = `<div class="sep">Yesterday 18:12</div>${rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}${say('One thing boopis does differently: I read what you write before you send it, and mark what I’d otherwise ask you later.', ' style="margin-top:16px"')}
      <div class="sep">Today 09:02</div>${say('Pick up where we left off? We were on Try it, then two questions.')}
      <div class="qcard sq ob-w">${askHead('', 'Setting up sessions, 1 of 3 done')}<div class="row" style="gap:6px"><span class="chip on">Pick up</span><span class="chip">Start again</span><span class="chip out">Finish later</span></div></div>`;
    return sessChat(o, body, sComp(o, { under: '<span>Your answers are saved as you go</span>' }), { step: '2 of 3', pose: 'you', state: 'happy' });
  }
  function settings(o) {
    const rev1 = S.obSettings(o); const dlg = rev1.slice(rev1.indexOf('<div class="scrim">'), rev1.lastIndexOf('</div>'));
    const html = sCareful(o).replace(/<\/div>$/, dlg + '</div>');   /* Settings over the Session tab's canvas (revision 2's) */
    const sr = (lb, val, ctl) => `<div class="sr"><div class="lb">${lb}</div>${val ? `<span class="val">${val}</span>` : ''}<span class="btn sm">${ctl}</span></div>`;
    const card = `<div class="set-head">Getting started</div><div class="card sq">${sr('Sessions onboarding', 'Done', 'Run it again')}${sr('Bots onboarding', 'Not started', 'Start')}${sr('Shared setup: model, reading drafts', 'Done in Sessions', 'Change')}${sr('Try reading drafts', '', 'Try it')}</div>`;
    return html.replace(/<div class="set-head">Getting started<\/div><div class="card sq">[\s\S]*?<\/div>\s*<div class="set-head">This computer/, card + '\n      <div class="set-head">This computer');
  }
  function returning(o) {
    const body = `<div class="sep">Today 09:40</div>${say('Welcome to the new boopis. You’re already set up, so this takes a few seconds.')}
      ${rcpt('Models: Claude and ChatGPT, as before')}${rcpt('Settings boopis needs: already set')}${rcpt('Your 4 bots and 12 sessions: all here')}
      ${say('One new thing: I read what you write before you send it. Want to see it?', ' style="margin-top:16px"')}
      <div class="qcard sq ob-w">${askHead('', 'New in this version')}<div class="row" style="gap:6px"><span class="chip on">Show me</span><span class="chip">Keep it on, skip the demo</span><span class="chip out">Turn it off</span></div></div>`;
    return sessChat(o, body, sComp(o, { under: '<span>Nothing else to set up</span>' }), { step: '', pillText: 'What’s new', side: 'inbox', pose: 'you' });   /* a returning user's sessions are all there */
  }

    /* O-B07 to O-B12: revision 1's cards and copy, in the v7 Bots tab (the open sidebar, the main bot, no dock) */
  const TEAM3 = ['kai', 'moss', 'iris'];
  const bName = (o) => reshell(S.obBName(o), o);
  const bTeam = (o) => reshell(S.obBTeam(o), o);
  const bRules = (o) => reshell(S.obBRules(o), o);
  const bBuild = (o) => reshell(S.obBBuild(o).replace('They’re in the rail, and along the bottom of the screen.', 'They’re in your sidebar, under me.'), o, { team: TEAM3, st: { iris: 'happy' } });
  /* the dock is the Sessions tab's (v7 528a5dca): the reach card says so */
  const bReach = (o) => reshell(S.obBReach(o).replace('The dock<small>Your bots along the bottom edge. Hold to approve.</small>', 'The dock, in Sessions<small>Your bots along the bottom while you work in a session.</small>'), o, { team: TEAM3 });
  const bFirst = (o) => reshell(S.obBFirst(o), o, { team: TEAM3, st: { moss: 'needs', kai: 'working' } });
  Object.assign(window.SCREENS, { obB07: bName, obB08: bTeam, obB09: bRules, obB10: bBuild, obB11: bReach, obB12: bFirst, obS02: sConsent, obS03: sModel, obS04: sTry, obS05: sFolder, obS06: sCareful, obS07: sFirst, obB01c: bConsent, obB02: bMeet, obB05a: bModel, obB05b: bTry, obB06: bWhere, obX01: resume, obX02: settings, obX03: returning });
  Object.assign(window.OB2, { sessChat, sessCanvas, say, sComp, nsMark });
})();
