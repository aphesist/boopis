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
  /* Bots: the rail holds only the bots that exist (boopis until the team is built) */
  function railOf(names, cur = 'boopis', st = {}) {
    return `<aside class="side rail" style="width:88px">${names.map((n) => `<span class="tile sq${n === cur ? ' on' : ''}" style="width:54px;height:54px">${orb(n, 36, { state: st[n] || 'idle', surface: 'var(--bg-1)' })}</span>`).join('')}
      <div class="foot-ctl"><span class="ib s" style="width:32px;height:32px">${I('plus')}</span><span class="ib s" style="width:32px;height:32px">${I('store')}</span><span class="ib s" style="width:32px;height:32px">${I('gear')}</span></div></aside>`;
  }
  function botsPage(o, inner, ex = {}) {
    const chrome = `<div class="drag"><span class="ib" style="margin-left:${88 / 2 - 12 - 18}px">${I('sidebar-left', 'l')}</span><span class="grow"></span>${wc()}</div>`;
    return S.frame(o, `${railOf(ex.rail || ['boopis'])}${chrome}<div class="main" style="left:88px"><div class="ob-page ob2">${inner}</div>${ex.skip === false ? '' : `<span class="btn ghost ob-skip">${ex.skip || 'Not now'}</span>`}</div>${ex.overlay || ''}`);
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
    return botsPage(o, `<div class="ob-h">${h}</div><div class="ob-lede">${l}</div>${scene}${acts(busy || prim(v === 'second' ? 'Continue' : 'Let’s start'))}`, { skip: 'Not now' });
  }

  /* ---------- O-B03: your team comes alive (Grok's "give each bot a job", with life) ----------
     The boopis bot (met in O-B02) and three bots, each with its job. At rest in the still, every bot looks at another one:
     kai at moss, moss at boopis, iris at kai, and boopis at the person. In the clip they wake one by one (orb2's own wakeUp,
     happy, poke, spin and lookAt). */
  const TEAM = { kai: 'Reviews pull requests', moss: 'Runs the tests at night', iris: 'Writes the release notes' };
  function teamScene(o = {}) {
    const asleep = o.asleep;
    const g = o.gaze || {};
    const at = (n, x, y, size, label) => `<div class="ob-job" data-n="${n}" style="left:${x}px;top:${y}px">${orb(n, size, { state: asleep && n !== 'boopis' ? 'sleeping' : 'idle', surface: 'var(--bg-2)', gaze: g[n], id: n })}${label ? `<span class="chip">${label}</span>` : ''}</div>`;
    return `<div class="ob-scene ob2-team">${at('boopis', 380, 24, 72, '')}${at('kai', 150, 96, 60, TEAM.kai)}${at('moss', 380, 156, 60, TEAM.moss)}${at('iris', 610, 96, 60, TEAM.iris)}</div>`;
  }
  /* where each bot looks in the still: a bot looks at another (yaw, pitch in degrees, orb2's gaze) */
  const LOOKS_AT = { boopis: '0 -6', kai: '24 -10', moss: '0 20', iris: '-26 -6' };
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

  Object.assign(window.SCREENS, { obS01: (o) => hello(o, 'sess'), obB01: (o) => hello(o, 'bots'), obB03: team, obB04: goals });
  window.OB2 = { sessPage, botsPage, railOf, orb, teamScene, tiles, tile, GOALS, TEAM, LOOKS_AT, acts, prim, sec };
})();
