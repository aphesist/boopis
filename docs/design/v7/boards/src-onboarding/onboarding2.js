/* Onboarding batch 2: every remaining screen (O03-O25), the choice boards O02-O04, and the component board. Kit only. */
(function () {
  const { I, mark, orb, stack } = window.V7;
  const S = window.SCREENS;
  const OB = window.OB;
  const { say, you, rcpt, setupFrame, logo, wc, m, STEPS, ticks } = OB;
  const cm = (f, s = 14) => mark(f, s);
  const LOOK = { kai: 'Reviews pull requests', moss: 'Runs the tests at night', iris: 'Research with sources' };

  /* ---------- shared pieces ---------- */
  const opts = (rows, ex = {}) => rows.map(([lt, name, desc, st], i) => `<div class="opt${st === 'on' ? ' on' : st === 'hov' ? ' hov' : ''}"><span class="lt">${ex.check && st === 'on' ? I('check') : lt}</span><span class="nm">${name}</span>${desc ? `<span class="ds">${desc}</span>` : ''}</div>`).join('');
  const choices = (q, rows, foot = '', ex = {}) => `<div class="blk sq q ob-w ob-ch"><div class="w6 l ob-qh">${q}</div>${opts(rows, ex)}${foot ? `<div class="ob-foot">${foot}</div>` : ''}</div>`;
  const askHead = (who, line, end = '') => `<div class="row xs dim" style="gap:6px;margin-bottom:4px">${who}${line}<span class="grow"></span>${end}</div>`;
  const approval = (bot, title, rule, ex = {}) => `<div class="qcard sq ob-w"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${orb(bot, 16, { state: 'needs', still: true, surface: 'var(--bg-3)' })}<span>${bot} asks${ex.origin ? `, ${ex.origin}` : ''}</span><span class="grow"></span><span class="stamp"><span class="dot owe"></span>needs you</span></div>
    <div class="m" style="margin-bottom:4px">${title}</div><div class="xs dim ell" style="margin-bottom:8px">Rule: <span style="color:var(--accent-text);text-decoration:underline;text-underline-offset:3px">“${rule}”</span></div>
    <div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip on">Hold to allow once</span><span class="chip">Allow all this turn</span><span class="chip">Always allow</span><span class="chip out">Deny</span></div></div>`;

  /* the bots tab while onboarding: the rail holds only the bots that exist; the dock the same */
  function dockOf(names, o = {}) {
    const orbs = names.map((n) => { const st = o.state && o.state[n] || 'idle'; return `<span style="position:relative">${orb(n, 40, { state: st, surface: '#000000' })}${st === 'needs' ? '<span class="dot owe" style="position:absolute;right:-1px;top:1px;box-shadow:0 0 0 2px #000"></span>' : ''}</span>`; }).join('');
    return window.V7.dock(names.length * 54 + 108, 72, `${orbs}<span class="ib s" style="background:#ffffff14;color:#f5f5f5b0;box-shadow:none">${I('plus')}</span>`);
  }
  function railOf(names, cur = 'boopis', st = {}) {
    return `<aside class="side rail" style="width:88px">${names.map((n) => `<span class="tile sq${n === cur ? ' on' : ''}" style="width:54px;height:54px">${orb(n, 36, { state: st[n] || 'idle', surface: 'var(--bg-1)' })}${st[n] === 'needs' ? '<span class="flag dot owe badge-ring"></span>' : ''}</span>`).join('')}
      <div class="foot-ctl"><span class="ib s" style="width:32px;height:32px">${I('plus')}</span><span class="ib s" style="width:32px;height:32px">${I('store')}</span><span class="ib s" style="width:32px;height:32px">${I('gear')}</span></div></aside>`;
  }
  const underBoopis = `<span class="row" style="gap:4px">${I('ladder')}Governed</span><span class="row" style="gap:5px">${cm('claude', 12)}Claude Opus</span><span class="grow"></span><span class="mono">$0.00</span>`;
  function botChat(o, body, ex = {}) {
    const names = ex.bots || ['boopis'];
    const title = S.pill(`${orb('boopis', 24, { surface: 'var(--bg-3)' })}boopis`, '');
    const chrome = `<div class="drag"><span class="ib" style="margin-left:${88 / 2 - 12 - 18}px">${I('sidebar-left', 'l')}</span><span style="position:absolute;left:${88 + (1440 - 88) / 2}px;top:var(--chrome-y);transform:translateX(-50%)" class="row">${title}</span><span class="grow"></span><span class="row s" style="color:var(--text-quiet);gap:8px;height:36px;padding:0 10px;margin-right:2px">Search<span class="keys"><span class="kbd">ctrl</span><span class="kbd">K</span></span></span><span class="ib">${I('sidebar-right', 'l')}</span>${wc()}</div>`;
    const comp = S.composer({ ...o, composer: 'c', placeholder: ex.ph || 'Type your answer, or ask something else', typed: ex.typed, under: ex.under || underBoopis, composerW: 720 });
    return S.frame(o, `${railOf(names, 'boopis', ex.st || {})}${chrome}<div class="main" style="left:88px"><div class="thread" style="padding-top:72px">${body}</div>
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:96px">${ex.above || ''}${comp}</div>${dockOf(names, { state: ex.st })}</div>${ex.overlay || ''}`);
  }
  const bsay = (h, st = '') => `<div class="b agent sq"${st}>${h}</div>`;

  /* ---------- O03 engine states, O04 consent ---------- */
  function consent(o) {
    const row = (k, v, why) => `<div class="sr"><div class="lb">${why}<small class="mono">${k} = ${v}</small></div><span style="color:var(--accent-text);display:inline-flex">${I('check')}</span></div>`;
    const card = `<div class="card sq" style="width:520px;margin-top:28px">${row('tools.tool_search.enabled', 'off', 'Show boopis’s tools directly')}${row('delegation.backend', 'boopis', 'Route governed work to each model tier')}${row('plugins.entries.boopis.allow_gateway_injection', 'true', 'Let a held message continue a turn')}</div>`;
    return S.frame(o, `<div class="ob-page"><div class="ob-h">Settings boopis needs</div><div class="ob-lede">boopis changes three engine settings, and only these. It asks before it changes any other.</div>${card}
      <div class="ob-acts"><span class="btn primary">Apply the changes</span><span class="btn">Not now</span></div></div><div class="ob-wc">${wc()}</div>`);
  }

  /* ---------- O05 model states ---------- */
  function models(o) {
    const st = o.st || 'found';
    if (st === 'found') return S.obModels(o);
    const signins = `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="btn xs">${cm('claude', 14)}Sign in with Claude</span><span class="btn xs">${cm('openai', 14)}Sign in with ChatGPT</span><span class="btn xs">${cm('gemini', 14)}Use a Gemini key</span></div>`;
    let card, line, above = '';
    if (st === 'none') { line = 'First, a model to think with. Use a plan you already pay for, or a key.'; card = `<div class="qcard sq ob-w">${askHead(logo(9, ' still'), 'Nothing signed in on this computer yet')}${signins}<div class="ob-foot"><span class="btn xs">More ways to connect</span><span class="grow"></span><span class="btn xs ghost">Use the free models</span></div></div>`; }
    if (st === 'waiting') { line = 'First, a model to think with.'; card = `<div class="qcard sq ob-w">${askHead(cm('claude', 14), 'Signing in with Claude', '<span class="word">waiting</span>')}<div class="m" style="margin-bottom:8px">Finish signing in in your browser. This card updates when it’s done.</div><div class="ob-foot"><span class="btn xs">Open the page again</span><span class="grow"></span><span class="btn xs ghost">Cancel</span></div></div>`; }
    if (st === 'failed') { line = 'First, a model to think with. I found Claude Code here.'; card = `<div class="qcard sq ob-w">${askHead(cm('claude', 14), 'Claude', '<span class="word" style="color:var(--red-text)">not signed in</span>')}<div class="m" style="margin-bottom:8px">Claude Code is installed but not signed in. Sign in once in a terminal, then check again.</div><div class="well sq" style="margin:0 0 8px">claude auth login</div><div class="ob-foot"><span class="btn xs primary">Check again</span><span class="btn xs">Copy the command</span><span class="grow"></span><span class="btn xs ghost">Use something else</span></div></div>`; }
    if (st === 'offline') { line = 'First, a model to think with. I found these, so you only need to confirm.'; card = `<div class="qcard sq ob-w">${askHead(logo(9, ' still'), 'Found on this computer')}<div class="ob-opts"><div class="optrow sq on"><span class="ring"></span>${cm('claude', 16)}<div class="col grow"><span class="m">Claude</span><span class="xs dim ell">Claude Code, signed in. Starts on Claude Opus.</span></div></div></div><div class="ob-foot"><span class="btn xs primary">Use Claude</span><span class="grow"></span></div></div>`;
      above = `<div class="notice sq" style="margin-bottom:8px">${I('clock')}<span class="grow"><span style="color:var(--text)">No internet right now.</span> Finish this later; your answers are saved.</span><span class="btn xs ghost">Try again</span></div>`; }
    const body = `<div class="sep">Today 09:40</div>${say('Hi. I’ll set boopis up with you; it takes about a minute.')}${say(line, true)}${card}`;
    return setupFrame(o, body, S.composer({ ...o, composer: 'c', placeholder: 'Choose a model first', under: '<span>Nothing is sent until you pick</span>', composerW: 720 }), { step: '1 of 3', above });
  }

  /* ---------- O07 where to start ---------- */
  function where(o) {
    const body = `<div class="sep">Today 09:42</div>${rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}${rcpt('Reading your drafts: on')}
      ${say('That’s all boopis needs. Where do you want to start? The other tab is one click away, and it introduces itself the first time you open it.', true, ' style="margin-top:16px"')}
      ${choices('Where do you want to start?', [['A', 'A session', 'work on code with one agent, step by step', 'hov'], ['B', 'Bots', 'a team that works on its own and asks first'], ['C', 'Decide later', 'open an empty session']])}`;
    return setupFrame(o, body, S.composer({ ...o, composer: 'c', placeholder: 'Pick an answer above', under: '<span>A, B or C answers</span><span class="grow"></span><span>Esc decides later</span>', composerW: 720 }), { step: '3 of 3' });
  }

  /* ---------- Session branch: S41's canvas with onboarding's content ---------- */
  function sessCanvas(o, inner, ex = {}) {
    const keep = S.dockRow; S.dockRow = () => dockOf(['boopis']);
    const out = S.sessShell(o, '', S.sessComp(o, ex.ph || 'What should change? @ files, $ skills, / commands', { typed: ex.typed, under: ex.under || '<span>Enter starts the session</span><span class="grow"></span><span>ctrl Enter starts it in the background</span>' }), { mainInner: `<div class="ns">${inner}</div>`, title: S.sessTitle(ex.title || 'New session'), side: S.emptyInbox });
    S.dockRow = keep; return out;
  }
  const nsMark = (ex = '') => `<span class="ns-mark">${logo(44, ex)}</span>`;
  function sFolder(o) {
    return sessCanvas(o, `${nsMark()}<div class="ns-h">Add a folder to start</div><div class="s dim" style="margin:-6px 0 16px">A session works in one project folder. Nothing in it changes until you say so.</div><div class="row" style="gap:8px;justify-content:center"><span class="btn primary">${I('folder')}Add a project</span><span class="btn">Import sessions</span></div>`, { title: 'Sessions', ph: 'Add a folder to start', under: '<span>Sessions start in a folder</span>' });
  }
  function sCareful(o) {
    const rows = STEPS.map(([n, d], i) => `<div class="optrow sq${i === 1 ? ' on' : ''}"><span class="ring"></span><div class="col grow"><span class="m">${n}${i === 1 ? '<span class="xs dim" style="margin-left:8px">recommended</span>' : ''}</span><span class="xs dim">${d}</span></div></div>`).join('');
    const block = `<div class="qcard sq" style="width:440px;margin:0"><div class="ob-opts">${rows}</div><div class="ob-foot"><span class="btn xs primary">Use Auto-accept edits</span><span class="grow xs dim" style="text-align:right;padding-right:4px">Change it in Settings, Sessions</span></div></div>`;
    return sessCanvas(o, `${nsMark()}<div class="ns-h">How careful should sessions be?</div><div class="ns-launch" style="margin-bottom:16px"><span class="select ns-sel">${I('folder')}boopis${I('chevron-down')}</span><span class="select ns-sel">${I('fork')}New worktree${I('chevron-down')}</span><span class="select ns-sel">${cm('claude', 14)}Claude Opus${I('chevron-down')}</span></div>${block}`, { ph: 'Pick how careful first' });
  }
  function sFirst(o) {
    const typed = `Find why ${m('the tests', 'shown')} fail on ${m('CI', 'shown')} and fix it`;
    const chips = `<div class="row" style="gap:6px;justify-content:center;margin-top:24px"><span class="chip">Explain how this project is laid out</span><span class="chip">Find and fix one failing test</span><span class="chip">Review the last 3 commits</span></div>`;
    return sessCanvas(o, `${nsMark(' data-look')}<div class="ns-h">What’s next for boopis?</div><div class="ns-launch"><span class="select ns-sel">${I('folder')}boopis${I('chevron-down')}</span><span class="select ns-sel">${I('fork')}New worktree${I('chevron-down')}</span><span class="select ns-sel">${cm('claude', 14)}Claude Opus${I('chevron-down')}</span><span class="select ns-sel">${ticks(3)}Default${I('chevron-down')}</span><span class="select ns-sel">${I('shield')}Auto-accept edits${I('chevron-down')}</span></div>${chips}`, { typed });
  }

  /* ---------- Bots branch ---------- */
  function bWhere(o) {
    const body = `<div class="sep">Today 09:43</div>${bsay('Hi, I’m boopis. I make your bots, give them work, and tell you what they did and what it cost.')}${bsay('First, your bots need a computer to work on. Where should it be?')}
      ${choices('Where should your bots work?', [['A', 'This computer, in a container', 'recommended, kept apart, about 4 GB', 'hov'], ['B', 'A computer I own', 'a home server, paired by a code'], ['C', 'A cloud server', 'your own server, set up over SSH'], ['D', 'Directly on this computer', 'no container; risky steps ask']], '<span class="grow xs dim">Change it any time in Settings, Bots.</span>')}`;
    return botChat(o, body);
  }
  function bName(o) {
    const body = `<div class="sep">Today 09:43</div>${you('This computer, in a container')}${bsay('Setting it up in the background; I’ll tell you when it’s ready.', ' style="margin-top:16px"')}
      <div class="activity">${orb('boopis', 16, { state: 'working', surface: 'var(--bg-2)' })}<span class="shimmer">Getting the container</span><span class="mono xs dim">1.2 of 3.8 GB</span></div>
      ${bsay('While it does, what should I call you?', ' style="margin-top:12px"')}
      ${choices('What should I call you?', [['A', 'Alex', 'your name on this computer'], ['B', 'alex', 'your login name'], ['C', 'Something else', ''], ['D', 'Don’t use a name', '']], '<span class="grow xs dim">Your bots use it too. Change it in Settings, Bots.</span>')}`;
    return botChat(o, body);
  }
  function bGoal(o) {
    const rows = [['A', 'Code and reviews', 'pull requests, tests, releases', 'on'], ['B', 'Research and writing', 'sources, notes, drafts'], ['C', 'Videos and posts', 'scripts, edits, schedules'], ['D', 'Data and reports', 'dashboards and summaries'], ['E', 'Inbox and calendar', 'needs a connector'], ['F', 'Something else', 'say it in a sentence']];
    const body = `<div class="sep">Today 09:44</div>${you('Alex')}${bsay('Alex it is.', ' style="margin-top:16px"')}${bsay('What should your bots work on first? Pick up to three.')}
      ${choices('What should they work on?', rows, '<span class="btn xs primary">Use these</span><span class="grow"></span><span class="btn xs ghost">Skip</span>', { check: true })}`;
    return botChat(o, body);
  }
  function bTeam(o) {
    const bot = (n, role, sh) => `<div class="ob-rule">${orb(n, 20, { still: true, surface: 'var(--bg-3)' })}<span class="nm" style="white-space:nowrap">${n}</span><span class="t dim">${role}</span>${cm('claude', 12)}</div>`;
    const plan = `<div class="qcard sq ob-w">${askHead(logo(9, ' still'), 'Team plan', '<span class="word">nothing made yet</span>')}<div class="m" style="margin-bottom:6px">A small crew for <span class="mono">~/code/boopis</span></div>
      <div class="ob-opts">${bot('kai', 'reviews pull requests')}${bot('moss', 'runs the tests at night, proposes fixes')}${bot('iris', 'release notes and the changelog')}</div>
      <div class="ob-sub ell" style="margin:6px 0 8px">Room “crew”, kai leads. Routine: moss’s test sweep, weekdays at 02:00, paused.</div>
      <div class="row" style="gap:6px"><span class="chip on">Hold to build this team</span><span class="chip">Change it</span><span class="chip out">Just you and me</span></div></div>`;
    const conn = `<div class="qcard sq ob-w" style="margin-top:6px">${askHead(I('plug'), 'Optional, from the Store')}<div class="item sq" style="height:52px;padding:0 0 0 4px"><span class="imark sq" style="width:36px;height:36px">GH</span><div class="col grow"><span class="m ell">GitHub</span><span class="xs dim ell">Let kai and moss read issues and pull requests</span></div><span class="btn xs tint">Add GitHub</span></div>
      <div class="xs dim" style="margin:4px 0 2px">Asks before every change. Remove it any time in Settings, Connectors.</div></div>`;
    const body = `<div class="sep">Today 09:45</div>${you('Code and reviews')}${bsay('Here’s a small team for that. Nothing is made until you hold the button.', ' style="margin-top:16px"')}${plan}${bsay('They can also use tools you already work in. Each one asks before it does anything.', ' style="margin-top:16px"')}${conn}`;
    return botChat(o, body);
  }
  const RULES = ['Deleting or overwriting files outside a bot’s workspace', 'Running as root, installing or removing packages', 'Disks, the bootloader, system services, /etc', 'Startup files, SSH keys, keyrings, .env and credentials', 'Force-pushing, rewriting history, deleting branches or cloud resources', 'Opening ports, the firewall, VPN or network settings', 'Sending messages, emails or posts; publishing anything', 'Purchases and spending money'];
  function rulesCard(o = {}) {
    const rows = RULES.map((r, i) => `<div class="ob-rule${o.hov === i ? ' hov' : ''}"><span class="switch on"></span><span class="t">${r}</span>${o.hov === i ? `<span class="ib s">${I('pen')}</span><span class="ib s">${I('close')}</span>` : ''}</div>`).join('');
    return `<div class="qcard sq ob-w">${askHead(I('shield'), 'Your approval rules, for every bot', '<span class="word">8 on</span>')}<div class="m" style="margin-bottom:6px">Your bots ask you before</div><div class="ob-opts ob-q4">${rows}</div>
      <div class="ob-sub ell" style="margin:8px 0">Anything not on the list runs on its own. A check that fails holds the action.</div>
      <div class="row" style="gap:6px"><span class="chip on">Keep these rules</span><span class="chip">Add a rule</span><span class="chip out">Open in Settings</span></div></div>`;
  }
  function bRules(o) {
    const body = `<div class="sep">Today 09:46</div>${you('Hold to build this team')}${bsay('Before they start: these are the things every bot asks you about first. Keep, edit or remove any of them.', ' style="margin-top:16px"')}${rulesCard({ hov: 6 })}`;
    return botChat(o, body);
  }
  function bBuild(o) {
    const body = `<div class="sep">Today 09:47</div>${you('Keep these rules')}${rcpt('Kept: 8 approval rules for every bot')}
      <div class="sysline act">${I('check')}Built at 09:47: 3 bots, 1 room, 1 routine (paused)<span class="btn tint">Undo</span></div>
      ${bsay('kai, moss and iris are ready. They’re in the rail, and along the bottom of the screen.', ' style="margin-top:6px"')}`;
    return botChat(o, body, { bots: ['boopis', 'kai', 'moss', 'iris'], st: { iris: 'happy' } });
  }
  function bReach(o) {
    const sr = (lb, sub, ctl) => `<div class="sr" style="padding:6px 4px"><div class="lb">${lb}<small>${sub}</small></div>${ctl}</div>`;
    const card = `<div class="qcard sq ob-w">${askHead(logo(9, ' still'), 'Keeping up without this window')}
      ${sr('The dock', 'Your bots along the bottom edge. Hold to approve.', '<span class="btn xs">Show me</span>')}
      ${sr('The island and the notch', 'Answer approvals from the top of the screen.', '<span class="switch on"></span>')}
      ${sr('Your phone', 'Message boopis from Telegram, Signal, Slack and more.', '<span class="btn xs">Connect a chat app</span>')}
      <div class="ob-foot"><span class="btn xs primary">Done with this</span><span class="grow"></span><span class="btn xs ghost">Skip</span></div></div>`;
    const body = `<div class="sep">Today 09:48</div>${bsay('You don’t need this window open to keep up with your bots.')}${card}`;
    return botChat(o, body, { bots: ['boopis', 'kai', 'moss', 'iris'] });
  }
  function bFirst(o) {
    const body = `<div class="sep">Today 09:49</div>${you('Review the last 3 commits and list the risks')}${bsay('On it. kai leads; moss runs the tests.', ' style="margin-top:16px"')}
      <div class="handoff">${orb('boopis', 16, { still: true })}${I('forward')}${orb('kai', 16, { still: true })}<span>boopis handed the review to kai</span></div>
      <div class="tool sq"><div class="th">${I('session')}<b>Read</b> 3 commits, 14 files<span class="grow"></span>${I('chevron')}</div></div>
      ${approval('moss', 'Install pytest-xdist to run the tests in parallel', 'Ask before running as root, and before installing or removing packages', { origin: 'boopis started this for you' })}`;
    return botChat(o, body, { bots: ['boopis', 'kai', 'moss', 'iris'], st: { moss: 'needs', kai: 'working' }, ph: 'Message boopis' });
  }

  /* ---------- across the flow ---------- */
  function resume(o) {
    const body = `<div class="sep">Yesterday 18:12</div>${rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}${say('One thing boopis does differently: I read what you write before you send it, and mark what I’d otherwise ask you later.', true, ' style="margin-top:16px"')}
      <div class="sep">Today 09:02</div>${say('Pick up where we left off? We were on the last two steps.', true)}
      <div class="qcard sq ob-w">${askHead(logo(9, ' still'), 'Setup, 2 of 3 done')}<div class="row" style="gap:6px"><span class="chip on">Pick up</span><span class="chip">Start again</span><span class="chip out">Finish later</span></div></div>`;
    return setupFrame(o, body, S.composer({ ...o, composer: 'c', placeholder: 'Pick an answer above', under: '<span>Your answers are saved as you go</span>', composerW: 720 }), { step: '2 of 3' });
  }
  function settings(o) {
    const nav = [['gear', 'General', 1], ['spark', 'Models'], ['plug', 'Connectors'], ['shield', 'Approvals'], ['session', 'Sessions'], ['bots', 'Bots'], ['palette', 'Appearance'], ['keyboard', 'Keyboard']].map(([i, l, on]) => `<div class="ni sq${on ? ' on' : ''}">${I(i)}${l}</div>`).join('');
    const sr = (lb, val, ctl) => `<div class="sr"><div class="lb">${lb}</div>${val ? `<span class="val">${val}</span>` : ''}${ctl}</div>`;
    const b = (t) => `<span class="btn sm">${t}</span>`;
    const body = `<div class="set-title">General</div>
      <div class="set-head">Getting started</div><div class="card sq">${sr('The intro', '', b('Show it again'))}${sr('Setup', 'Done', b('Run it again'))}${sr('Sessions tour', 'Done', b('Run it again'))}${sr('Bots tour', 'Not started', b('Start'))}${sr('Try reading drafts', '', b('Try it'))}</div>
      <div class="set-head">This computer</div><div class="card sq">${sr('boopis engine', 'Up to date', b('Check now'))}${sr('Models', 'Claude, ChatGPT', b('Change'))}${sr('Where bots work', 'Container', b('Change'))}</div>`;
    const bg = sCareful(o).replace('class="ns-h"', 'class="ns-h"');
    return bg.replace(/<\/div>$/, `<div class="scrim"></div><div class="dialog sq" style="left:${(1440 - 900) / 2}px;top:64px;width:900px;height:700px;display:flex"><div class="setnav">${nav}</div><div class="setbody">${body}</div><span class="ib s d-close" style="background:transparent;box-shadow:none">${I('close')}</span></div></div>`);
  }
  function returning(o) {
    const body = `<div class="sep">Today 09:40</div>${say('Welcome to the new boopis. You’re already set up, so this takes a few seconds.')}
      ${rcpt('Models: Claude and ChatGPT, as before')}${rcpt('Settings boopis needs: already set')}${rcpt('Your 4 bots and 12 sessions: all here')}
      ${say('One new thing: I read what you write before you send it. Want to see it?', true, ' style="margin-top:16px"')}
      <div class="qcard sq ob-w">${askHead(logo(9, ' still'), 'New in this version')}<div class="row" style="gap:6px"><span class="chip on">Show me</span><span class="chip">Keep it on, skip the demo</span><span class="chip out">Turn it off</span></div></div>`;
    return setupFrame(o, body, S.composer({ ...o, composer: 'c', placeholder: 'Pick an answer above', under: '<span>Nothing else to set up</span>', composerW: 720 }), { step: '1 of 1' });
  }

  Object.assign(window.SCREENS, { obConsent: consent, obModelsSt: models, obWhere: where, obFolder: sFolder, obCareful: sCareful, obFirst: sFirst, obBWhere: bWhere, obBName: bName, obBGoal: bGoal, obBTeam: bTeam, obBRules: bRules, obBBuild: bBuild, obBReach: bReach, obBFirst: bFirst, obResume: resume, obSettings: settings, obReturning: returning });
  Object.assign(window.OB, { choices, opts, rulesCard, approval, botChat, dockOf, railOf, bsay, RULES });
})();
