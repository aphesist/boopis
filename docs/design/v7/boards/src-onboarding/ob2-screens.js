/* Onboarding revision 2: one onboarding per tab (owner O01 B). The Session tab's onboarding is O-S01..; the Bots tab's is
   O-B01... The shared setup (the engine and its consent, the model, Try it) is asked by whichever tab runs first and is a
   receipt in the other. Product UI is the kit's (screens.js, the session and bot builders, onboarding rev 1's cards); the
   speaker, the goal tiles, the pages' scenes and their motion are onboarding's own (owner C02). */
(function () {
  const { I, mark, orb: kitOrb } = window.V7;
  const S = window.SCREENS, OB = window.OB, SP = window.OB2S;
  const cm = (f, s = 14) => mark(f, s);
  const wc = OB.wc;
  /* an orb with a gaze (orb2's own `gaze` attribute, yaw and pitch in degrees: where a bot looks in a still) */
  const orb = (n, size, o = {}) => {
    let h = kitOrb(n, size, o);
    if (o.gaze) h = h.replace('<orb-avatar ', `<orb-avatar gaze="${o.gaze}" `);
    if (o.id) h = h.replace('<orb-avatar ', `<orb-avatar data-b="${o.id}" `);
    return h;
  };

  /* ---------- the two tabs' shells while onboarding ---------- */
  /* Session: the sidebar with its Sessions / Bots switch and "No sessions yet"; the main area holds the page */
  function sessPage(o, inner, ex = {}) {
    return S.sessShell(o, '', ex.comp || '', { mainInner: `<div class="ob-page ob2">${inner}</div>`, title: S.sessTitle(ex.title || 'Sessions'), side: S.emptyInbox, noDock: !ex.dock, overlay: ex.overlay });
  }
  /* Bots (owner, 23 Nov, ORBS.md): the open sidebar with its Sessions / Bots switch, then the main boopis bot at 44 px,
     centred with its name (the Bots tab only, never Sessions), then the bots that exist as rows at 28 px. The Bots tab has
     no dock (v7 528a5dca: the dock is Sessions only). While onboarding, the list holds only the bots already made. */
  const TEAM_ACT = { kai: 'Reviews pull requests', moss: 'Runs the tests at night', iris: 'Writes the release notes' };
  /* the sidebar's bots sit at one fixed sideways 3/4 angle, as Grok-Bot's do, and move only through their states (owner, 23 Nov;
     the exact angle lands in ORBS.md 23: this value is provisional and set in this one place) */
  const SIDE_GAZE = '-24 4';
  const sideOrb = (n, size, o) => orb(n, size, { ...o, gaze: SIDE_GAZE }).replace('idle-motion="calm"', 'idle-motion="off" data-side');
  function botsSide(o = {}) {
    const team = o.team || [], st = o.st || {};
    const row = (n) => `<div class="sb-row sq ob2-row" data-n="${n}">${sideOrb(n, 28, { state: st[n] || 'idle', surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm ell">${n}</span><span class="act ell${st[n] === 'needs' ? ' owe' : ''}">${st[n] === 'needs' ? 'Needs you: install a package' : st[n] === 'working' ? 'Reviewing 3 commits' : TEAM_ACT[n]}</span></div>${st[n] === 'needs' ? '<span class="dot owe"></span>' : ''}</div>`;
    return `<aside class="side sb-open ob2-bside"><div class="row" style="justify-content:space-between;padding:0 6px 6px"><span class="seg"><span>Sessions</span><span class="on">Bots</span></span><span class="ib s">${I('plus')}</span></div>
      ${o.noMain ? '<div class="s dim ob2-nobots">No bots yet</div>' : `<div class="sb-main" data-n="boopis">${sideOrb('boopis', 44, { state: o.mainState || 'idle', surface: 'var(--bg-1)' })}<span class="nm">boopis</span></div>`}
      <div class="ob2-rows">${team.map(row).join('')}</div>
      <div class="foot-ctl" style="flex-direction:row;justify-content:flex-end;padding:12px 6px 0"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></div></aside>`;
  }
  const botsPill = () => S.pill(`<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--fill-2);color:var(--icon)">${I('bots')}</span>Bots`, '');
  function botsPage(o, inner, ex = {}) {
    return S.frame(o, `${botsSide(ex)}${S.chrome({ ...o, sidebar: 'open', title: botsPill() })}<div class="main" style="left:300px"><div class="ob-page ob2">${inner}</div>${ex.skip === false ? '' : `<span class="btn ghost ob-skip">${ex.skip || 'Not now'}</span>`}</div>${ex.overlay || ''}`);
  }
  /* boopis's chat in the Bots tab: the thread and the composer, no dock; ex.comp replaces the composer block */
  const underBoopis = `<span class="row" style="gap:4px">${I('ladder')}Governed</span><span class="row" style="gap:5px">${mark('claude', 12)}Claude Opus</span><span class="grow"></span><span class="mono">$0.00</span>`;
  function botsChat(o, body, ex = {}) {
    const title = S.pill(`${orb('boopis', 24, { surface: 'var(--bg-3)' })}boopis`, '');
    const comp = ex.comp || S.composer({ ...o, composer: 'c', placeholder: ex.ph || 'Type your answer, or ask something else', typed: ex.typed, under: ex.under || underBoopis, composerW: 720 });
    return S.frame(o, `${botsSide(ex)}${S.chrome({ ...o, sidebar: 'open', title })}<div class="main" style="left:300px"><div class="thread" style="padding-top:72px">${body}</div>
      <div class="ob2-compwrap" style="position:absolute;left:50%;transform:translateX(-50%);bottom:24px">${ex.above || ''}${comp}</div></div>${ex.overlay || ''}`);
  }
  /* revision 1's Bots screens, moved into the v7 Bots tab: the same thread and composer in the new shell */
  function reshell(html, o, ex = {}) {
    const d = document.createElement('div'); d.innerHTML = html;
    const th = d.querySelector('.thread'); const comp = d.querySelector('.composer');
    const wrap = comp && comp.parentElement && comp.parentElement.parentElement;
    return botsChat(o, th ? th.innerHTML : '', { ...ex, comp: wrap ? wrap.innerHTML : '' });
  }
  const acts = (...b) => `<div class="ob-acts">${b.join('')}</div>`;
  const prim = (t) => `<span class="btn primary">${t}</span>`;
  const sec = (t) => `<span class="btn">${t}</span>`;

  /* ---------- O-S01 / O-B01: hello. The speaker, at the hero size, in the scene ---------- */
  function hello(o, tab) {
    const v = o.v || 'first';
    const pose = o.pose || (v === 'second' ? 'you' : 'you');
    const st = o.state || (v === 'second' ? 'happy' : 'idle');
    const scene = `<div class="ob-scene ob2-stage"><div class="ob2-hero">${SP.spk(96, { pose, state: st })}</div></div>`;
    const busy = o.engine === 'busy' ? `<div class="ob-status"><span class="shimmer">Getting boopis ready</span><span class="mono xs dim">62%</span></div>` : '';
    if (tab === 'sess') {
      const h = v === 'second' ? 'Welcome to Sessions' : 'Hi, I’m boopis';
      const l = v === 'second' ? 'Your model and draft reading are already set. Two questions, then you’re working.' : 'Let’s set up sessions: you and one agent, working on your code, step by step.';
      return sessPage(o, `<div class="ob-h">${h}</div><div class="ob-lede">${l}</div>${scene}${acts(busy || prim(v === 'second' ? 'Continue' : 'Let’s start'))}<span class="btn ghost ob-skip">Skip setup</span>`);
    }
    const h = v === 'second' ? 'Welcome to Bots' : 'Hi, I’m boopis';
    const l = v === 'second' ? 'Your model and draft reading are already set, so this is only about your team.' : 'Let’s set up your bots: a small team that works on its own and asks you first.';
    return botsPage(o, `<div class="ob-h">${h}</div><div class="ob-lede">${l}</div>${scene}${acts(busy || prim(v === 'second' ? 'Continue' : 'Let’s start'))}`, { skip: 'Not now', noMain: v !== 'second' });
  }

  /* ---------- O-B03: your team comes alive (Grok's "give each bot a job", with life) ----------
     The boopis bot has just taken its place at the top of the sidebar (it travelled there from O-B02). Three bots, each with
     its job. At rest in the still every bot looks at another one, with orb2's own gaze: kai at moss, moss up at boopis in
     the sidebar, iris at kai. In the clip they wake one by one (orb2's own wake, happy, poke, spin and lookAt). */
  const TEAM = { kai: 'Reviews pull requests', moss: 'Runs the tests at night', iris: 'Writes the release notes' };
  function teamScene(o = {}) {
    const g = o.gaze || {};
    const at = (n, x, y, size, label) => `<div class="ob-job" data-n="${n}" style="left:${x}px;top:${y}px">${orb(n, size, { state: o.asleep ? 'sleeping' : 'idle', surface: 'var(--bg-2)', gaze: g[n], id: n })}${label ? `<span class="chip">${label}</span>` : ''}</div>`;
    return `<div class="ob-scene ob2-team">${at('kai', 160, 52, 64, TEAM.kai)}${at('moss', 380, 112, 64, TEAM.moss)}${at('iris', 600, 52, 64, TEAM.iris)}</div>`;
  }
  /* where each bot looks in the still (yaw, pitch in degrees, orb2's gaze) */
  const LOOKS_AT = { kai: '26 -12', moss: '-34 14', iris: '-30 -2' };
  function team(o) {
    return botsPage(o, `<div class="ob-h">Meet your team</div><div class="ob-lede">Each bot has one job. They work on their own and ask you before anything risky.</div>${teamScene({ gaze: o.asleep ? {} : LOOKS_AT, asleep: o.asleep })}${acts(prim('Next'), sec('Back'))}`);
  }

  /* ---------- the goal tiles (owner O03 "closer to B"): Grok-Bot's tiles, an ONBOARDING-ONLY component ----------
     3 x 2 tiles, 212 x 92, the Card's surface and radius; an icon in a 28 px disc top left, the name at --fs-l bottom
     left, both on a 14 px inset. Picking a tile gives it a bot: the tile takes that bot's colour (a 2 px ring, a 10% tint,
     the disc filled), and the bot's own orb arrives in the tile's top right corner. Up to three picks. */
  const GOALS = [['fork', 'Code and reviews', 'kai'], ['search', 'Research and writing', 'iris'], ['play', 'Videos and posts', 'nimbus'], ['sliders', 'Data and reports', 'moss'], ['clock', 'Inbox and calendar', 'nina'], ['more', 'Something else', '']];
  function tile([ic, name, bot], st = '', o = {}) {
    const L = window.V7.LOOKS[bot] || {};
    const on = st === 'on';
    /* chosen: the icon's disc gives way to the bot that takes the goal (orb2, 28 px, happy as it arrives, then idle) */
    const lead = on ? `<span class="ob-gt-b">${orb(bot, 28, { eyes: 'dark', state: o.botState || 'idle', gaze: o.gaze })}</span>` : `<span class="ob-gt-i">${I(ic)}</span>`;
    return `<div class="ob-gt sq${on ? ' on' : ''}${st === 'hov' ? ' hov' : ''}"${on ? ` style="--bot:${L.color}"` : ''} data-goal="${name}">${lead}<span class="ob-gt-n">${name}</span></div>`;
  }
  function tiles(picks = {}) { return `<div class="ob-gts">${GOALS.map((g) => tile(g, picks[g[1]] || '')).join('')}</div>`; }
  function goals(o) {
    const picks = o.picks === 'none' ? {} : { 'Code and reviews': 'on', 'Research and writing': o.picks === 'two' ? 'on' : 'hov' };
    if (o.picks === 'two') picks['Data and reports'] = 'hov';
    /* Grok's characters orbit the heading; here the bots you just met do, looking down at the tiles. A pick sends its bot
       from the orbit into the tile (the clip), so a picked goal's bot is no longer in the orbit. */
    const ORB = [['kai', 36, '', '18 -24'], ['moss', 30, ' r1', '-10 -28'], ['iris', 34, ' r2', '-22 -26']];
    const pickedBots = GOALS.filter((g) => picks[g[1]] === 'on').map((g) => g[2]);
    const deco = ORB.filter(([n]) => !pickedBots.includes(n)).map(([n, sz, c, gz]) => `<span class="ob2-orbit${c}" data-n="${n}">${orb(n, sz, { surface: 'var(--bg-2)', gaze: gz })}</span>`).join('');
    const deco2 = '';
    const head = `<div class="ob2-gh">${deco}${deco2}<div class="ob-h" style="margin-top:0">What should your bots work on first?</div></div>`;
    return botsPage(o, `${head}<div class="ob-lede">Pick up to three. Each pick gets a bot.</div>${tiles(picks)}${acts(prim('Next'), sec('Back'))}`, { skip: 'Skip' });
  }

  /* the owner's orb decisions (ORBS.md, 23 Nov): eyes at face-scale 1.25 on orbs of 44 px and under (C4); the renderer is
     the tuned orb2 build (C1-C3 clarity, T1-T5 motion: lib/orb-avatar.tuned.js) */
  function orbRules(root = document) { root.querySelectorAll('orb-avatar').forEach((e) => { if (+e.getAttribute('size') <= 44 && !e.hasAttribute('face-scale')) e.setAttribute('face-scale', '1.25'); }); return root; }
  Object.assign(window.SCREENS, { obS01: (o) => hello(o, 'sess'), obB01: (o) => hello(o, 'bots'), obB03: team, obB04: goals });
  window.OB2 = { SIDE_GAZE, sideOrb, orbRules, sessPage, botsPage, botsSide, botsChat, reshell, underBoopis, TEAM_ACT, orb, teamScene, tiles, tile, GOALS, TEAM, LOOKS_AT, acts, prim, sec };
})();
