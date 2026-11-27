/* Onboarding + setup (docs/design/v7/onboarding/ONBOARDING.md): the key screens O-NN and the choice boards O01-O04.
   Built only from the kit (kit.css, kit.js, screens.js, the session and bot builders); the intro page and its scenes are
   the two new parts, tagged NEW, FOR APPROVAL on the component board. */
(function () {
  const { I, mark, orb } = window.V7;
  const S = window.SCREENS;
  const cm = (f, s = 14) => mark(f, s);
  const wc = () => `<span class="wc"><span>${I('minimize')}</span><span>${I('maximize')}</span><span>${I('close')}</span></span>`;
  const logo = (size, ex = '') => `<boopis-logo mark${ex} style="font-size:${size}px;color:var(--text-strong)"></boopis-logo>`;
  const ticks = (n) => `<span class="ticks">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const STEPS = [['Supervised', 'Asks before every change and every command.'], ['Auto-accept edits', 'Changes apply when the gate passes; commands ask.'], ['Auto', 'Only your approval rules ask.'], ['Full access', 'Nothing asks. Every write is still recorded.']];

  /* ---------- scenes (NEW, FOR APPROVAL): illustrations made of real kit components ---------- */
  /* O02: two ways to work. Left a session in miniature, right the bots with their jobs. */
  function sceneTwoWays(o = {}) {
    const sess = `<div class="ob-in" style="gap:8px">
      <div class="b user sq" style="font-size:13px;line-height:18px;padding:5px 10px;max-width:240px">Fix the dock's half paint</div>
      <div class="blk sq" style="width:100%;padding:8px"><div class="hd" style="margin-bottom:6px">${I('file')}<span class="mono ell" style="color:var(--text)">dock.css</span><span class="grow"></span><span class="mono" style="color:var(--add)">+12</span><span class="mono" style="color:var(--del)">−3</span></div>
        <div class="well sq" style="font-size:11px;line-height:16px;padding:6px 10px">-  transform: translateX(-50%);
+  margin-inline: auto;</div></div>
      <div class="composer sq" style="border-radius:var(--r-pill);margin-top:auto"><div class="line" style="height:36px;padding:0 4px"><span class="ib s" style="width:28px;height:28px">${I('plus')}</span><span class="ph" style="font-size:13px">Steer or queue</span><span class="ib s inv" style="width:28px;height:28px">${I('arrowup')}</span></div></div></div>`;
    const bots = `<div class="ob-in" style="align-items:center;justify-content:center;gap:14px">
      <div class="row" style="gap:18px">${['kai', 'nina', 'moss'].map((n) => orb(n, 44, { state: o.asleep ? 'sleeping' : n === 'kai' ? 'working' : 'idle', surface: 'var(--bg-3)' })).join('')}</div>
      <div class="activity" style="margin:0;font-size:13px">${orb('kai', 16, { state: 'working', surface: 'var(--bg-3)' })}<span class="shimmer">kai is writing the changelog</span></div>
      <div class="row xs dim" style="gap:6px">${orb('nina', 16, { still: true, state: 'needs', surface: 'var(--bg-3)' })}<span class="stamp"><span class="dot owe"></span>nina asks before a deploy</span></div></div>`;
    return `<div class="ob-scene">
      <div class="ob-card sq" style="left:22px;top:0">${sess}<div class="ob-cap"><b>Sessions</b><span>You and one agent, step by step</span></div></div>
      <div class="ob-card sq" style="right:22px;top:0">${bots}<div class="ob-cap"><b>Bots</b><span>A team that works on its own</span></div></div></div>`;
  }
  /* O03: you stay in charge. An approval waiting, held to allow; every change recorded. */
  function sceneCharge(o = {}) {
    const ask = `<div class="qcard sq" style="width:340px;margin:0"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${orb('nina', 16, { state: 'needs', still: true, surface: 'var(--bg-3)' })}nina asks<span class="grow"></span><span class="stamp"><span class="dot owe"></span>needs you</span></div>
      <div class="m" style="margin-bottom:4px">Deploy 0.2.0 to staging</div><div class="xs dim ell" style="margin-bottom:8px">Rule: “Ask before publishing anything”</div>
      <div class="row" style="gap:6px"><span class="chip on">Hold to allow once</span><span class="chip out">Deny</span></div></div>`;
    const rec = `<div class="sysline" style="margin:0">${I('check')}Every change is recorded. Undo any turn.</div>`;
    return `<div class="ob-scene" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">${ask}${rec}</div>`;
  }
  /* bots intro (O12, O13): the boopis bot, then three bots with a job each */
  function sceneJobs(o = {}) {
    const st = o.asleep ? 'sleeping' : 'idle';
    const job = (n, label, x, y) => `<div class="ob-job" style="left:${x}px;top:${y}px">${orb(n, 64, { state: st, surface: 'var(--bg-2)' })}<span class="chip">${label}</span></div>`;
    return `<div class="ob-scene">${job('kai', 'Reviews pull requests', 380, 0)}${job('moss', 'Night shift', 210, 128)}${job('iris', 'Research with sources', 560, 112)}</div>`;
  }
  function sceneMeetBot(o = {}) {
    return `<div class="ob-scene"><div class="ob-hero" style="width:140px;height:140px">${orb('boopis', 120, { state: o.state || 'idle', surface: 'var(--bg-2)' })}</div></div>`;
  }

  /* ---------- the intro page (NEW, FOR APPROVAL) ---------- */
  function page(o, inner) { return S.frame(o, `<div class="ob-page">${inner}</div><div class="ob-wc">${wc()}</div>`); }
  /* O01-O03: o.step 1..3; o.engine: ready | busy | blocked */
  function intro(o) {
    const st = +(o.step || 1);
    const skip = `<span class="btn ghost ob-skip">Skip the intro</span>`;
    if (st === 1) return page(o, `<div class="ob-h">Meet boopis</div><div class="ob-lede">Work with AI on this computer: hands on, or with a team.</div><div class="ob-scene"><div class="ob-hero">${logo(96)}</div></div>
      <div class="ob-acts"><span class="btn primary">See how it works</span></div>${skip}`);
    if (st === 2) return page(o, `<div class="ob-h">Two ways to work</div><div class="ob-lede">Steer one task yourself, or hand work to bots that keep going.</div>${sceneTwoWays(o)}
      <div class="ob-acts"><span class="btn primary">Next</span><span class="btn">Back</span></div>${skip}`);
    const eng = o.engine || 'ready';
    const act = eng === 'busy' ? `<div class="ob-status">${'<span class="shimmer">Getting boopis ready</span>'}<span class="mono xs dim">62%</span></div>`
      : eng === 'blocked' ? `<span class="btn primary">Try again</span><span class="btn">Show what happened</span>` : `<span class="btn primary">Set up boopis</span><span class="btn">Back</span>`;
    const lede = eng === 'blocked' ? `<div class="ob-lede" style="color:var(--red-text)">The engine could not be installed: the download stopped. Nothing else was changed.</div>` : '';
    return page(o, `<div class="ob-h">You stay in charge</div>${lede || '<div class="ob-lede">boopis asks before anything risky. Nothing leaves this computer unless you allow it.</div>'}${sceneCharge(o)}<div class="ob-acts">${act}</div>${eng === 'busy' ? '' : skip}`);
  }

  /* ---------- the setup conversation (shared, before the branch) ---------- */
  const say = (h, last, st = '') => `<div class="b agent sq ob-say"${st}>${last ? `<span class="ob-gm">${logo(9, ' still')}</span>` : ''}${h}</div>`;
  const you = (h) => `<div class="b user sq">${h}</div>`;
  const rcpt = (h) => `<div class="ob-rcpt">${I('check')}${h}</div>`;
  function setupFrame(o, body, compHTML, ex = {}) {
    const title = S.pill(`${logo(14, ' still')}<span>Set up boopis</span>`, `<span class="mono" style="font-size:12px">${ex.step || '2 of 4'}</span>`);
    const chrome = `<div class="drag"><span style="position:absolute;left:720px;top:var(--chrome-y);transform:translateX(-50%)" class="row">${title}</span><span class="grow"></span><span class="btn ghost" style="height:36px">Skip setup</span>${wc()}</div>`;
    return S.frame(o, `${chrome}<div class="main ob-chat" style="left:0"><div class="thread">${body}</div>
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:24px">${ex.above || ''}${compHTML}</div>${ex.overlay || ''}</div>`);
  }
  const m = (t, st, ex = '') => `<span class="mk2${ex}" data-state="${st}">${t}</span>`;

  /* O05 models: pre-selected from the sign-ins already on this computer */
  function models(o) {
    const opt = (lead, n, d, on) => `<div class="optrow sq${on ? ' on' : ''}"><span class="ring"></span>${lead}<div class="col grow"><span class="m">${n}</span><span class="xs dim ell">${d}</span></div></div>`;
    const card = `<div class="qcard sq ob-w"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${logo(9, ' still')}Found on this computer</div>
      <div class="ob-opts">${opt(cm('claude', 16), 'Claude', 'Claude Code, signed in. Starts on Claude Opus.', 1)}${opt(cm('openai', 16), 'ChatGPT', 'Your ChatGPT plan, signed in')}${opt(cm('ollama', 16) || I('terminal'), 'Ollama', '2 models on this computer')}</div>
      <div class="ob-foot"><span class="btn xs primary">Use Claude</span><span class="btn xs">Add another</span><span class="grow"></span><span class="btn xs ghost">Use the free models</span></div></div>`;
    const body = `<div class="sep">Today 09:40</div>${say('Hi. I’ll set boopis up with you; it takes about a minute.')}${say('First, a model to think with. I found these, so you only need to confirm.', true)}${card}`;
    return setupFrame(o, body, S.composer({ ...o, composer: 'c', placeholder: 'Choose a model first', under: '<span>Nothing is sent until you pick</span>', composerW: 720 }), { step: '1 of 3' });
  }

  /* O06 Try it: the real composer, a real read (or the labelled recording), one mark opened, keep it on or off */
  function tryIt(o) {
    const rec = o.rec === '1';
    const phase = o.phase || 'open';
    const ship = phase === 'chosen' || phase === 'ask' ? m('ship it', 'chosen') : m('ship it', phase === 'open' ? 'open' : 'shown');
    const typed = `refactor ${m('the billing helpers', 'shown')} and ${ship}`;
    const menu = phase === 'open' ? `<div class="menu sq" style="position:absolute;left:596px;bottom:${rec ? 156 : 104}px;width:268px;z-index:6"><div class="mt">I read “ship it” as</div><div class="mi sq hov">${I('check')}Open a pull request</div><div class="mi sq"><span style="width:16px"></span>Merge it into main</div><div class="mi sq"><span style="width:16px"></span>Commit, don’t push</div><div class="sepr"></div><div class="mi sq"><span style="width:16px"></span>Something else…</div></div>` : '';
    const ask = phase === 'ask' ? `<div class="qcard sq ob-w"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${logo(9, ' still')}Reading your drafts<span class="grow"></span><span class="word">on</span></div>
      <div class="m" style="margin-bottom:4px">Keep reading my drafts?</div><div class="ob-sub ell">Reads with Claude Haiku, the cheapest model you have. Each read is on the ledger.</div>
      <div class="row" style="gap:6px"><span class="chip on">Keep it on</span><span class="chip">Turn it off</span></div></div>` : '';
    const sent = phase === 'chosen' || phase === 'ask' ? rcpt('Sent with your message: “ship it” means open a pull request (your choice)') : '';
    const recNote = rec ? `<div class="notice sq" style="margin-bottom:8px">${I('clock')}<span class="grow">Recorded example. Connect a model and boopis reads your own drafts.</span></div>` : '';
    const body = `<div class="sep">Today 09:41</div>${you('Use Claude')}${rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}
      ${say('One thing boopis does differently: I read what you write before you send it, and mark what I’d otherwise ask you later.', false, ' style="margin-top:16px"')}${say(rec ? 'Here’s a recorded example. Open a mark to answer it.' : 'Watch the composer. Open a mark to answer it.', true)}${sent}${ask}`;
    const under = `<span class="row" style="gap:4px">${I('pen')}Will assume: the helpers in <span class="mono">billing/</span></span><span class="grow"></span><span>Nothing is sent</span>`;
    return setupFrame(o, body, S.composer({ ...o, composer: 'c', typed, under, composerW: 720 }), { step: '2 of 3', above: recNote, overlay: menu });
  }

  /* O13 (and O12): the bots intro, in the Bots tab: the rail has only boopis until the team is made */
  function botsIntro(o) {
    const st = +(o.step || 2);
    const rail = `<aside class="side rail" style="width:88px"><span class="tile sq on" style="width:54px;height:54px">${orb('boopis', 36, { surface: 'var(--bg-1)' })}</span>
      <div class="foot-ctl"><span class="ib s" style="width:32px;height:32px">${I('plus')}</span><span class="ib s" style="width:32px;height:32px">${I('store')}</span><span class="ib s" style="width:32px;height:32px">${I('gear')}</span></div></aside>`;
    const chrome = `<div class="drag"><span class="ib" style="margin-left:${88 / 2 - 12 - 18}px">${I('sidebar-left', 'l')}</span><span class="grow"></span>${wc()}</div>`;
    const inner = st === 1
      ? `<div class="ob-h">Meet the boopis bot</div><div class="ob-lede">It works with you, makes your bots, hands them work and tells you what it cost.</div>${sceneMeetBot(o)}
         <div class="ob-acts"><span class="btn primary">Show me the bots</span></div>`
      : `<div class="ob-h">Give each bot a job</div><div class="ob-lede">They work on their own, on this computer, and ask you before anything risky.</div>${sceneJobs(o)}
         <div class="ob-acts"><span class="btn primary">Make my team</span><span class="btn">Back</span></div>`;
    return S.frame(o, `${rail}${chrome}<div class="main" style="left:88px"><div class="ob-page" style="left:0">${inner}</div><span class="btn ghost ob-skip">Not now</span></div>`);
  }

  Object.assign(window.SCREENS, { obIntro: intro, obModels: models, obTry: tryIt, obBots: botsIntro });
  window.OB = { sceneTwoWays, sceneCharge, sceneJobs, sceneMeetBot, say, you, rcpt, setupFrame, logo, wc, m, STEPS, ticks };
})();

/* ---------- the boards ---------- */
(function () {
  const S = window.SCREENS;
  const n = (cls, b, i) => `<span class="fl-n ${cls}"><b>${b}</b>${i ? `<i>${i}</i>` : ''}</span>`;
  const a = '<span class="fl-a"></span>';
  const chain = (...xs) => `<div class="fl-row">${xs.join(a)}</div>`;
  const key = `<div class="fl-key"><span style="--k:#3a3a3a;--kb:#202020">intro, full window</span><span style="--k:#4546c8;--kb:#1a1a2c">shared setup, in the conversation</span><span style="--k:#2f6f5a;--kb:#142420">Session</span><span style="--k:#6b4f9c;--kb:#201a2c">Bots</span><span style="--k:#c8770c;--kb:#2a1e10">asked or explained twice</span><span style="--k:#f0f0f0;--kb:#f0f0f0">first real result</span></div>`;
  const fork = (head, rows) => `<div class="fl-fk">${head}<span class="fl-a"></span><span class="fl-br" style="height:${(rows.length - 1) * 62}px"></span><div class="fl-fork">${rows.map((r) => `<div class="fl-row"><span class="fl-a"></span>${r.slice(r.indexOf('>') + 1, -6)}</div>`).join('')}</div></div>`;
  const stats = (rows) => `<div class="fl-stats">${rows.map(([v, l]) => `<div><b>${v}</b>${l}</div>`).join('')}</div>`;
  const thumb = (q, label, w = 480) => { const k = w / 1440; return `<div><div class="thumb" style="width:${w}px;height:${900 * k}px"><div class="sc" style="transform:scale(${k})">${S[q.s](Object.assign({ theme: 'dark', chrome: 'a', tile: 'a', composer: 'c', status: 'c' }, q))}</div></div><div class="thumb-l">${label}</div></div>`; };
  const section = (letter, title, sub, rec, body, note) => `<section><div class="opt-h"><b>${letter}. ${title}</b><span>${sub}</span>${rec ? '<span class="rec">RECOMMENDED</span>' : ''}</div><div class="v7 cell" data-theme="dark" style="background:#111;border-radius:14px;box-shadow:0 0 0 1px #2a2a2a">${body}</div>${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, sections) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${sections.join('')}</div></div>`;

  function o01() {
    const one = `<div class="fl-lab">FIRST LAUNCH</div>
      ${chain(n('intro', 'Meet boopis', 'O01'), n('intro', 'Two ways to work', 'O02'), n('intro', 'You stay in charge', 'O03, engine ready'), n('intro', 'Settings boopis needs', 'O04, required'), n('setup', 'Model', 'O05, pre-selected'), n('setup', 'Try it', 'O06, feedforward'))}
      <div class="fl-lab">THEN THE BRANCH: ONLY WHAT BELONGS TO THE TAB YOU START IN</div>
      ${fork(n('setup', 'Where to start', 'O07'), [chain(n('sess', 'Add a folder', 'O08'), n('sess', 'How careful', 'O09, Auto-accept edits'), n('task', 'First task', 'O10, ~1:40')), chain(n('bots', 'boopis bot', 'O11-O12'), n('bots', 'Where bots work', 'O13'), n('bots', 'Goal, team', 'O14-O16'), n('bots', 'Approvals', 'O17, the rules'), n('bots', 'Build, reach', 'O18-O19'), n('task', 'First job', 'O20, ~3:30'))])}
      <div class="fl-lab">FIRST OPEN OF THE OTHER TAB (deferred; shared setup never repeats)</div>
      <div class="fl-fork">${chain(n('later', 'Bots, first open', 'from O11, skips the model'), n('task', 'First job', ''))}${chain(n('later', 'Session, first open', 'O09 only'), n('task', 'First task', ''))}</div>
      ${stats([['3 + 3', 'screens before the branch'], ['~1:40', 'to a first session task'], ['0', 'topics asked twice'], ['0 tokens', 'until the first real task (Try it reads once, on the ledger)']])}
      <div class="thumbs">${thumb({ s: 'obIntro', step: 2 }, 'O02 Two ways to work')}${thumb({ s: 'obTry', phase: 'open' }, 'O06 Try it, in the real composer')}${thumb({ s: 'obBots', step: 2 }, 'O12 Give each bot a job (Bots branch)')}</div>`;
    const two = `<div class="fl-lab">FIRST OPEN OF SESSION</div>
      ${chain(n('sess', 'Meet Sessions', 'intro'), n('dup', 'Model', 'asked here'), n('dup', 'Try it', 'here'), n('sess', 'Folder', ''), n('sess', 'How careful', ''), n('task', 'First task', '~1:30'))}
      <div class="fl-lab">FIRST OPEN OF BOTS</div>
      ${chain(n('bots', 'Meet the bots', 'intro'), n('dup', 'Model', 'skipped or asked again'), n('dup', 'What boopis is', 'explained again'), n('bots', 'Where bots work', ''), n('bots', 'Goal, team', ''), n('bots', 'Approvals', ''), n('task', 'First job', '~3:30'))}
      ${stats([['2', 'separate flows to build and keep in step'], ['~1:30', 'to a first session task'], ['3', 'topics that need a "seen it" rule or repeat'], ['none', 'single place that says what boopis is']])}
      <div class="thumbs">${thumb({ s: 'obTry', phase: 'open' }, 'Try it would sit inside Session’s flow')}${thumb({ s: 'obBots', step: 1 }, 'Bots would open on its own intro')}</div>`;
    const three = `<div class="fl-lab">FIRST LAUNCH</div>
      ${chain(n('intro', 'Meet boopis', 'one screen'), n('intro', 'Settings boopis needs', 'required'), n('sess', 'Session canvas', 'S41'))}
      <div class="fl-lab">THEN, EACH TOPIC AT ITS MOMENT OF NEED, ONCE</div>
      ${chain(n('setup', 'Model', 'first Enter'), n('sess', 'How careful', 'first launch'), n('setup', 'Feedforward', 'first draft, live'), n('task', 'First task', '~0:45'))}
      ${chain(n('bots', 'Bots intro', 'first open'), n('bots', 'Approvals', 'first bot'), n('task', 'First job', ''))}
      ${stats([['1', 'screen before work'], ['~0:45', 'to a first session task'], ['0', 'topics asked twice'], ['3', 'asks that interrupt the first real task']])}
      <div class="thumbs">${thumb({ s: 'newSess', mk: 'a', st: 'nomodel' }, 'the model asked when the first task needs it (S37)')}</div>`;
    return board('O01 Onboarding structure', 'One app, one kit: the owner asked whether each tab needs its own onboarding or one hybrid works. Three structures, drawn as flows with their key frames. The test: nothing explained twice, the least time to a first real result, and the shared setup (model, Try it) asked once. Times are estimates for a person who already has a sign-in; the engine unpacks during the intro in every option.', [
      section('A', 'One hybrid onboarding', 'a shared intro and setup, then a short branch for the tab you start in; the other tab’s intro waits for its first open', true, one + key,
        'Recommended. The intro explains boopis once, as one app with two ways to work; the model and Try it are asked once for both tabs; the branch holds only what is specific to a tab (Session: the folder and how careful; Bots: the boopis bot, where bots work, the team and its approval rules). The other tab never repeats the shared part.'),
      section('B', 'A double onboarding', 'a separate flow the first time each tab opens', false, two + key,
        'The model and Try it either repeat or need a "seen it" rule, and neither flow can say what boopis is as a whole, so the second tab explains the app again. Two flows to build and keep consistent, against the one-kit rule.'),
      section('C', 'Just in time', 'one welcome screen, then every topic at the moment it is first needed', false, three + key,
        'Fastest to a first task, but the model, how careful and feedforward each interrupt that first task, and nothing ever explains the two tabs. Its useful idea is kept inside A: the other tab’s intro is just in time.')]);
  }
  window.OBOARDS = { o01 };
})();
