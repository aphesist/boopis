/* boopis restyled with the v7 proposal: key screens, assembled from kit.css components only.
   Content uses boopis's own vocabulary and the mock's bots (kai, nina, moss, iris, hex, nimbus, and the boopis bot). */
(function () {
  const { I, orb, stack, cluster, dock } = window.V7;
  const ORDER = ['boopis', 'kai', 'nina', 'moss', 'iris', 'hex', 'nimbus'];
  const COLORS = { kai: '#4fc9a8', nina: '#f23b5a', moss: '#2fd26a', iris: '#3b82f6', hex: '#a6a6ab', nimbus: '#9b5cf6', boopis: 'var(--text-strong)' };
  const nameIn = (n) => `<span style="color:${n === 'nina' ? '#ff6b81' : n === 'iris' ? '#5b9bff' : n === 'nimbus' ? '#b48cff' : COLORS[n]}">${n}</span>`;
  const mention = (n) => `<span class="mention">${orb(n, 16, { still: true, surface: 'var(--bg-3)' })}${nameIn(n)}</span>`;

  /* chrome: A floating (Grok), B floating + search pill, C unfilled bar */
  function chrome(o) {
    const left = o.sidebar === 'open' ? 300 : (o.railW || 88);
    const title = o.title || '';
    const sv = o.search || 'hint';
    const right = `${sv === 'button' ? `<span class="ib">${I('search', 'l')}</span>` : sv === 'hint' ? `<span class="row s" style="color:var(--text-quiet);gap:8px;height:36px;padding:0 10px;margin-right:2px">Search<span class="keys"><span class="kbd">ctrl</span><span class="kbd">K</span></span></span>` : ''}<span class="ib">${I('sidebar-right', 'l')}</span><span class="wc"><span>${I('minimize')}</span><span>${I('maximize')}</span><span>${I('close')}</span></span>`;
    if (o.chrome === 'c') {
      return `<div class="drag" style="height:40px;padding:6px 8px 0 12px;align-items:center;gap:4px">
        <span class="ib ghost">${I('sidebar-left', 'l')}</span><span class="ib ghost">${I('back', 'l')}</span><span class="ib ghost">${I('forward', 'l')}</span>
        <span style="position:absolute;left:50%;transform:translateX(-50%);top:10px" class="row s">${o.titleBare || title.replace('class="title-pill"', 'class="row" style="gap:8px;height:28px;font-size:14px"')}</span>
        <span class="grow"></span><span class="ib ghost">${I('sidebar-right', 'l')}</span><span class="wc"><span>${I('minimize')}</span><span>${I('maximize')}</span><span>${I('close')}</span></span></div>`;
    }
    const centre = (1440 - left - (o.pane ? 356 : 0)) / 2 + left;
    return `<div class="drag"><span class="ib" style="margin-left:${(o.railW || 88) / 2 - 12 - 18}px">${I('sidebar-left', 'l')}</span>
      <span style="position:absolute;left:${centre}px;top:var(--chrome-y);transform:translateX(-50%)" class="row">${title}${o.chrome === 'b' && sv === 'pill' ? `<span class="search-pill">${I('search')}<span class="grow">Search bots, sessions, settings</span><span class="keys"><span class="kbd">ctrl</span><span class="kbd">K</span></span></span>` : ''}</span>
      <span class="grow"></span>${right}</div>${sv === 'menu' || sv === 'menu-off' ? `<div class="menu sq" style="position:absolute;z-index:6;left:${centre - 120}px;top:58px;width:240px">${sv === 'menu' ? `<div class="mi sq hov">${I('search')}Search<span class="end keys"><span class="kbd">ctrl</span><span class="kbd">K</span></span></div><div class="sepr"></div>` : ''}<div class="mi sq">${I('sidebar-right')}Details<span class="end keys"><span class="kbd">ctrl</span><span class="kbd">alt</span><span class="kbd">B</span></span></div><div class="mi sq">${I('pen')}Rename</div><div class="mi sq">${I('copy')}Copy link</div></div>` : ''}`;
  }
  const pill = (inner, sub, chev) => `<span class="title-pill">${inner}${sub ? `<span class="sub">${sub}</span>` : ''}${chev ? `<span style="color:var(--icon-quiet);display:inline-flex;margin-left:-2px">${I('chevron-down')}</span>` : ''}</span>`;

  /* sidebar: the rail (tile options) or open */
  function rail(o) {
    const t = o.tile || 'a';
    const geo = { a: { w: 88, tile: 54, orb: 36, r: 'var(--r-tile)' }, b: { w: 64, tile: 44, orb: 28, r: 'var(--r-tile)' }, c: { w: 72, tile: 48, orb: 32, r: '999px' } }[t];
    const cur = o.current || 'kai';
    const tiles = ORDER.map((n) => {
      const st = n === 'nina' ? 'needs' : n === 'kai' && o.kaiState ? o.kaiState : n === 'hex' ? 'sleeping' : 'idle';
      const flag = n === 'nina' ? `<span class="flag dot owe badge-ring"></span>` : '';
      return `<span class="tile sq${n === cur ? ' on' : ''}" style="width:${geo.tile}px;height:${geo.tile}px;border-radius:${geo.r}">${orb(n, geo.orb, { state: st === 'idle' ? undefined : st, surface: 'var(--bg-1)', pose: true })}${flag}</span>`;
    }).join('');
    return `<aside class="side rail" style="width:${geo.w}px">${tiles}
      <span style="width:24px;height:0.5px;background:var(--line-strong);margin:6px 0"></span>
      <span class="tile" style="width:${geo.tile}px;height:${geo.tile}px">${cluster(['kai', 'nina', 'moss'], Math.round(geo.orb * 0.42))}</span>
      <div class="foot-ctl"><span class="ib s" style="width:32px;height:32px">${I('plus')}</span><span class="ib s" style="width:32px;height:32px">${I('store')}</span><span class="ib s" style="width:32px;height:32px">${I('gear')}</span></div></aside>`;
  }
  function sidebarOpen(o) {
    const cur = o.current || 'room';
    const row = (n, act, extra = {}) => `<div class="sb-row sq${cur === n ? ' on' : ''}">${orb(n, 28, { state: extra.state, surface: 'var(--bg-1)', pose: true })}<div class="col grow"><span class="nm ell">${n === 'boopis' ? 'boopis' : n}</span><span class="act ell${extra.owe ? ' owe' : ''}">${act}</span></div>${extra.end || ''}</div>`;
    return `<aside class="side sb-open">
      <div class="row" style="justify-content:space-between;padding:0 6px 6px"><span class="seg"><span>Sessions</span><span class="on">Bots</span></span><span class="ib s">${I('plus')}</span></div>
      ${o.search === 'side' ? `<div class="input search" style="margin:4px 4px 10px;height:32px">${I('search')}<span class="grow">Search</span><span class="keys"><span class="kbd">ctrl</span><span class="kbd">K</span></span></div>` : ''}
      ${o.main ? `<div class="sb-main">${orb('boopis', o.main, { surface: 'var(--bg-1)', pose: true })}<span class="nm">boopis</span></div>` : row('boopis', 'Summarised the morning')}
      ${row('kai', 'Writing the changelog', { state: 'working' })}
      ${row('nina', 'Needs you: approve a deploy', { owe: true, state: 'needs', end: '<span class="dot owe"></span>' })}
      ${row('moss', 'Found 2 flaky tests')}
      ${row('iris', 'Checked the new composer')}
      ${row('hex', 'Asleep', { state: 'sleeping' })}
      ${row('nimbus', 'Sorted 14 emails')}
      <div class="sb-head">Groups</div>
      <div class="sb-row sq${cur === 'room' ? ' on' : ''}">${stack(['kai', 'nina', 'moss'], 24, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm ell">release crew</span><span class="act ell">nina: the deploy is ready</span></div></div>
      <div class="foot-ctl" style="flex-direction:row;justify-content:space-between;padding:12px 6px 0;align-items:center">
        <span class="row"><span class="ib s" style="width:32px;height:32px;border-radius:50%;background:var(--current);box-shadow:none;color:var(--text)" class="s">${I('user')}</span><span class="s dim">you</span></span>
        <span class="row"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></span></div></aside>`;
  }

  /* composer: A Grok pill, B pill + mode chips inside, C pill + quiet line under */
  function composer(o) {
    const v = o.composer || 'b';
    const typed = o.typed;
    const sendBtn = typed ? `<span class="ib s inv">${I('arrowup')}</span>` : `<span class="ib s inv">${I('waveform')}</span>`;
    const line = `<div class="line"><span class="ib s">${I('plus')}</span><span class="ph${typed ? ' typed' : ''}">${typed || o.placeholder || 'Message'}</span><span class="ib s">${I('mic')}</span>${sendBtn}</div>`;
    const modes = `<span class="chip mode on">${I('ladder')}Governed</span><span class="chip mode">${I('spark')}Smart</span><span class="grow"></span><span class="xs dim mono">$0.37 of $0.60</span>`;
    const w = o.composerW || 720;
    const held = o.queue ? `<div class="queue sq queue-held"><div class="q">${I('clock')}<span class="grow ell">1 message waits until the discussion ends</span><span class="btn xs tint">Send now</span></div></div>` : ''; /* Queue, held variant (21: merged with the session's queue) */
    if (v === 'a') return `<div style="width:${w}px">${held}<div class="composer sq" style="border-radius:var(--r-pill)">${line}</div></div>`;
    const under = o.under || `<span class="row" style="gap:4px">${I('ladder')}Governed</span><span class="row" style="gap:4px">${I('spark')}Smart</span><span class="grow"></span><span class="mono">$0.37 of $0.60</span>`;
    if (v === 'c') return `<div style="width:${w}px">${held}<div class="composer sq" style="border-radius:var(--r-pill)">${line}</div><div class="composer-under">${under}</div></div>`;
    return `<div style="width:${w}px"><div class="composer sq">${o.queue ? `<div class="queue-strip" style="padding:10px 14px 0">${I('clock')}<span class="grow">1 message waits until the discussion ends</span><span class="btn xs ghost">Send now</span></div>` : ''}${line}<div class="modes">${o.modes || modes}</div></div></div>`;
  }

  function dockRow(o = {}) {
    const orbs = ['boopis', 'kai', 'nina', 'moss', 'iris', 'hex'].map((n) => `<span style="position:relative">${orb(n, 40, { state: n === 'nina' ? 'needs' : n === 'kai' ? 'working' : n === 'hex' ? 'sleeping' : undefined, surface: '#000000', dockInk: true, pose: true })}${n === 'nina' ? '<span class="dot owe" style="position:absolute;right:-1px;top:1px;box-shadow:0 0 0 2px #000"></span>' : ''}</span>`).join('');
    return dock(o.w || 420, 72, `${orbs}<span class="ib s" style="background:#ffffff14;color:#f5f5f5b0;box-shadow:none">${I('plus')}</span>`, { left: o.left });
  }

  function frame(o, inner) {
    return `<div class="win v7" data-theme="${o.theme}" data-font="${o.font || 'geist'}" data-radii="${o.radii || 'b'}" data-accent="${o.accent || 'iris'}" data-attention="${o.attention || 'amber'}" data-shadow="${o.shadow || 'a'}">${inner}</div>`;
  }

  /* 1. the session chat: the agent is nameless (v6 principle 5); its turns carry model, time and cost quietly */
  function session(o) {
    const L = o.sidebar === 'open' ? 300 : 88;
    const title = pill(`<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--fill-2);color:var(--icon)">${I('session')}</span>Fix the dock's half paint`, '');
    return frame(o, `${o.sidebar === 'open' ? sessionsOpen() : rail({ ...o, current: 'none' })}${chrome({ ...o, title })}
      <div class="main" style="left:${L}px"><div class="thread" style="padding-top:72px">
        <div class="sep">Today 09:42</div>
        <div class="b user sq">The dock loses its right half while the slab moves. Find why and fix it.</div>
        <div class="b agent sq"><p>It's the legacy <code>clip</code> on the dock's stage. A child centred with <code>translateX(-50%)</code> is clipped before its transform, so the half right of the centre line goes missing while the clip changes.</p></div>
        <div class="stepsrow">${I('chevron')}Read 6 files, ran 2 commands</div>
        <div class="blk sq wide" style="margin-top:12px"><div class="hd">${I('file')}<span class="mono" style="color:var(--text)">modules/dock/dock.css</span><span class="grow"></span><span class="mono" style="color:var(--add)">+12</span><span class="mono" style="color:var(--del)">−3</span></div>
          <div class="well sq">  .dk-page {
-   left: 50%; transform: translateX(-50%);
+   left: -100vw; right: -100vw; margin-inline: auto;
  }</div></div>
        <div class="meta"><span class="row" style="gap:5px">${window.V7.mark('claude', 14)}sonnet 5.5</span><span class="mono">0m 42s</span><span class="mono">$0.08</span></div>
        <div class="blk sq" style="margin-top:16px"><div class="hd">${I('terminal')}<span>Ship</span></div>
          <div class="w6 l" style="margin-bottom:2px">Write 2 files to the workspace?</div><div class="s dim">dock.css and engine.ts, then the gate runs the tests.</div>
          <div class="foot"><span class="btn sm ghost">Deny <span class="kbd" style="margin-left:4px">esc</span></span><span class="btn sm primary">Hold to approve</span></div></div>
        <div class="status-a l" style="margin-top:14px">${window.V7.mark('claude', 16)}Waiting for your approval</div>
      </div>
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:${o.noDock ? 20 : 96}px">${composer({ ...o, placeholder: 'Describe the change' })}</div>
      ${o.noDock ? '' : window.SCREENS.dockRow()}</div>`);
  }
  function sessionsOpen() {
    const r = (t, w, on, dot) => `<div class="sb-srow sq${on ? ' on' : ''}">${dot ? '<span class="dot run"></span>' : `<span style="width:8px"></span>`}<span class="grow ell">${t}</span><span class="xs dim mono">${w}</span></div>`;
    return `<aside class="side sb-open"><div class="row" style="justify-content:space-between;padding:0 6px 6px"><span class="seg"><span class="on">Sessions</span><span>Bots</span></span><span class="ib s">${I('plus')}</span></div>
      <div class="sb-head">Today<span class="n">3</span></div>${r("Fix the dock's half paint", '09:42', true, true)}${r('Room mentions in every composer', '08:10')}${r('Store: de-duplicate items', '07:55')}
      <div class="sb-head">Yesterday<span class="n">3</span></div>${r('Startup notice for Windows', 'mon')}${r('Hold to approve in the dock', 'mon')}${r('Archived bots group', 'sun')}
      <div class="foot-ctl" style="flex-direction:row;justify-content:flex-end;padding:12px 6px 0"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></div></aside>`;
  }

  /* 2. a bot's chat (kai), the rail, the activity line */
  function botChat(o) {
    o = { ...o, noDock: true }; /* the Bots tab: no dock (owner, 23 Nov) */
    const st = o.status || 'c';
    const act = st === 'c' ? `<div class="activity">${orb('kai', 16, { state: 'working' })}<span class="shimmer">Reading the changelog</span></div>`
      : st === 'a' ? `<div class="status-a" style="margin-top:12px;font-size:var(--fs-l)"><span class="dot run"></span>Reading the changelog</div>`
      : `<div class="status-b" style="margin-top:12px;font-size:var(--fs-l);opacity:.55">Reading the changelog</div>`;
    const title = pill(`${orb('kai', 24, { surface: 'var(--bg-3)' })}kai`, '', o.search === 'menu' || o.search === 'menu-off');
    return frame(o, `${o.sidebar === 'open' ? sidebarOpen({ current: 'kai', search: o.search, main: +o.main || 0 }) : rail({ ...o, current: 'kai', kaiState: 'working' })}${chrome({ ...o, title, railW: o.tile === 'b' ? 64 : o.tile === 'c' ? 72 : 88 })}
      <div class="main" style="left:${o.sidebar === 'open' ? 300 : (o.tile === 'b' ? 64 : o.tile === 'c' ? 72 : 88)}px"><div class="thread" style="padding-top:72px">
        <div class="sep">Today 10:05</div>
        <div class="b user sq">Draft the release notes for 0.2.0 from what merged this week.</div>
        <div class="b agent sq">On it. 14 merges since Monday, most of them the dock and the rooms.</div>
        <div class="b agent sq">One question first.</div>
        <div class="blk sq q" style="margin-top:6px;padding:10px 8px 8px;--sq-bg:linear-gradient(var(--spec),transparent 70%),linear-gradient(var(--bubble-agent),var(--bubble-agent));--sq-line:var(--bubble-ring)">
          <div class="w6 l" style="padding:0 8px 6px">Who are the notes for?</div>
          <div class="opt"><span class="lt">A</span>People who use boopis</div>
          <div class="opt hov"><span class="lt">B</span>Developers building on the Local API</div>
          <div class="opt on"><span class="lt">C</span>Both, in two sections</div>
          <div class="opt quiet"><span class="lt">D</span>Something else</div></div>
        <div class="b user sq" style="margin-top:16px">Both, in two sections</div>
        <div class="b agent sq" style="margin-top:16px">Good. I'll keep the user part to one screen.</div>
        ${act}
      </div>
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:${o.noDock ? 20 : 96}px">${composer({ ...o, placeholder: 'Message kai', modes: `<span class="chip mode on">${I('ladder')}Governed</span><span class="grow"></span><span class="xs dim">sonnet 5.5</span>`, under: `<span class="row" style="gap:4px">${I('ladder')}Governed</span><span class="row" style="gap:5px">${window.V7.mark('claude', 12)}sonnet 5.5</span><span class="grow"></span><span class="mono">$0.12 of $1.00</span>` })}</div>
      ${o.noDock ? '' : window.SCREENS.dockRow()}</div>`);
  }

  /* 3. a group room: bylines in the bot's colour, mention chips, a hand-off row, a message to you, who is replying */
  function room(o) {
    o = { ...o, noDock: true }; /* the Bots tab: no dock (owner, 23 Nov) */
    const L = o.sidebar === 'open' ? 300 : 88;
    const title = pill(`${stack(['kai', 'nina', 'moss'], 24, { surface: 'var(--bg-3)' })}release crew`, '');
    const by = (n) => `<div class="byline">${orb(n, 16, { still: true })}${nameIn(n)}</div>`;
    return frame(o, `${o.sidebar === 'open' ? sidebarOpen({ current: 'room', main: +o.main || 0 }) : rail({ ...o, current: 'none' })}${chrome({ ...o, title })}
      <div class="main" style="left:${L}px"><div class="thread" style="padding-top:72px">
        <div class="sep">Today 11:20</div>
        <div class="b user sq">${mention('kai')} write the notes, ${mention('nina')} ship 0.2.0 to staging when they're in.</div>
        ${by('kai')}<div class="b agent sq">Notes are in <code>CHANGELOG.md</code>, two sections. 41 lines.</div>
        <div class="handoff">${orb('kai', 16, { still: true })}${I('forward')}${orb('nina', 16, { still: true })}<span>kai handed the notes to nina</span></div>
        ${by('nina')}<div class="b agent sq" style="box-shadow:none;--sq-bg:linear-gradient(var(--owe-soft),var(--owe-soft)),linear-gradient(var(--bubble-agent),var(--bubble-agent))"><span class="you">${I('user')}you</span> staging needs your approval before I deploy.</div>
        ${by('moss')}<div class="b agent sq">The two flaky tests are quarantined, so the gate is green.</div>
        <div class="activity">${stack(['kai', 'moss'], 16)}<span class="shimmer">kai and moss are replying</span></div>
      </div>
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:${o.noDock ? 20 : 96}px">${composer({ ...o, placeholder: 'Message release crew', queue: o.queue, under: `<span class="row" style="gap:4px">${I('at')}3 members</span><span class="grow"></span><span class="mono">$0.21</span>`, modes: `<span class="chip mode">${I('at')}Mention</span><span class="grow"></span><span class="xs dim">3 members</span>` })}</div>
      ${o.noDock ? '' : window.SCREENS.dockRow()}</div>`);
  }

  /* 4. Settings: a 900 dialog, the 220 nav, cards of label + value + control (R-calm-1), one hint in the page */
  function settings(o) {
    const nav = [['gear', 'General', 1], ['spark', 'Models'], ['plug', 'Connectors'], ['shield', 'Approvals'], ['palette', 'Appearance'], ['keyboard', 'Keyboard'], ['terminal', 'Diagnostics']]
      .map(([i, l, on]) => `<div class="ni sq${on ? ' on' : ''}">${I(i)}${l}</div>`).join('');
    const sr = (lb, ctl, hint) => `<div class="sr"><div class="lb">${lb}${hint ? `<small>${hint}</small>` : ''}</div>${ctl}</div>`;
    const sel = (v) => `<span class="select">${v}${I('chevron-down')}</span>`;
    const chk = (on) => on ? `<span style="color:var(--accent-text);display:inline-flex">${I('check')}</span>` : '<span style="width:16px"></span>';
    const body = `<div class="set-title">General</div>
      <div class="set-head">Layout</div><div class="card sq">${sr('Show the dock', '<span class="switch on"></span>')}${sr('When the sidebar collapses', '<span class="seg"><span class="on">Rail</span><span>Hide</span></span>')}${sr('Rail size', '<span class="seg"><span class="on">Automatic</span><span>Standard</span><span>Compact</span></span>')}${sr('Show search', '<span class="switch on"></span>')}${sr('Search shows as', sel('A button'))}</div>
      <div class="set-head">Under the composer</div><div class="card sq">${sr('Mode', chk(1))}${sr('Smart or the pinned model', chk(1))}${sr('Model', chk(0))}${sr('Cost against the cap', chk(1))}${sr('Context used', chk(0))}</div>
      <div class="set-head">Appearance</div><div class="card sq">${sr('Theme', sel('Follow system'))}${sr('Accent', `<span class="select"><span style="width:12px;height:12px;border-radius:50%;background:var(--accent)"></span>Iris${I('chevron-down')}</span>`)}${sr('Corners', '<span class="seg"><span class="on">Standard</span><span>Rounder</span></span>')}</div>`;
    const bg = botChat({ ...o, noDock: true }); /* Settings over the Bots tab: no dock there (owner, 23 Nov) */
    return bg.replace(/<\/div>$/, `<div class="scrim"></div><div class="dialog sq" style="left:${(1440 - 900) / 2}px;top:64px;width:900px;height:700px;display:flex">
      <div class="setnav">${nav}</div><div class="setbody">${body}</div><span class="ib s d-close" style="background:transparent;box-shadow:none">${I('close')}</span></div></div>`);
  }

  /* 5. the Store: one status line, items as name + one line + action, marks as tiles */
  function store(o) {
    const item = (m, n, d, a, h) => `<div class="item sq${h ? ' hov' : ''}"><span class="imark sq">${m}</span><div class="col grow"><span class="m ell">${n}</span><span class="s dim ell">${d}</span></div>${a}</div>`;
    const get = '<span class="btn xs tint">Get</span>';
    const body = `<div class="row" style="padding:16px 56px 4px 18px;min-height:52px"><span class="l w6">Store</span><span class="grow"></span><span class="s dim row" style="gap:4px">3 installed${I('chevron')}</span></div>
      <div class="row" style="padding:10px 18px 4px;gap:10px"><div class="input search grow">${I('search')}<span>Search skills, connectors, plugins and mods</span></div></div>
      <div class="row" style="padding:10px 18px 2px;gap:6px"><span class="chip on">All</span><span class="chip">Skills</span><span class="chip">Connectors</span><span class="chip">Plugins</span><span class="chip">Mods</span><span class="grow"></span><span class="status-a">${o.status === 'c' ? '' : '<span class="dot run"></span>'}<span${o.status === 'c' ? ' class="shimmer"' : ''}>Reading sources</span><span class="mono xs dim">0 of 1</span></span></div>
      <div class="set-head" style="margin:18px 0 6px 28px">Recommended</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;padding:0 18px">
        ${item('C7', 'Context7', 'Up-to-date docs for the libraries you use', get, true)}${item('FD', 'Frontend design', 'Distinctive, production-grade interfaces', get)}
        ${item('GH', 'GitHub', 'Issues, pull requests and checks', '<span class="btn xs tint">Open</span>')}${item('PW', 'Playwright', 'Drive a browser to check your pages', get)}
        ${item('LN', 'Linear', 'Read and update your issues', get)}${item('SB', 'Supabase', 'Your database, auth and storage', get)}</div>
      <div class="set-head" style="margin:18px 0 6px 28px">Mods</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;padding:0 18px">
        ${item(I('mod'), 'Pomodoro band', 'A focus timer in the dock', get)}${item(I('mod'), 'Ledger glance', 'Today’s spend beside the composer', get)}</div>`;
    const bg = session({ ...o });
    return bg.replace(/<\/div>$/, `<div class="scrim"></div><div class="dialog sq" style="left:${(1440 - 900) / 2}px;top:70px;width:900px;height:640px">${body}<span class="ib s d-close" style="background:transparent;box-shadow:none">${I('close')}</span></div></div>`);
  }

  /* 6. the dock: kept black (owner decision), opened on nina's session with the 1 s hold */
  function dockScreen(o) {
    const L = 88;
    const sess = `<div style="position:absolute;left:50%;transform:translateX(-50%);bottom:0;width:560px">${''}</div>`;
    const inner = `<div class="col" style="width:100%;padding:18px 18px 16px;gap:10px;align-self:stretch">
      <div class="row" style="gap:10px">${orb('nina', 40, { state: 'needs', surface: '#000000' })}<div class="col grow"><span class="m" style="color:#f5f5f5">nina</span><span class="s" style="color:#ff6463">Needs you</span></div><span class="ib s" style="background:transparent;box-shadow:none;color:#f5f5f5b0">${I('close')}</span></div>
      <div style="font-size:15px;line-height:22px;color:#f5f5f5;padding:7px 12px;border-radius:18px;background:#f5f5f50f;align-self:flex-start">Staging is ready. Deploy 0.2.0?</div>
      <div style="border-radius:22px;background:#f5f5f50a;box-shadow:inset 0 0 0 .5px #f5f5f51a;padding:8px"><div class="row s" style="color:#f5f5f5a8;gap:6px;margin:4px 0 6px 4px">${I('terminal')}Deploy</div>
        <div style="font-family:var(--mono);font-size:12px;color:#f5f5f5a8;background:#f5f5f508;border-radius:10px;padding:8px 10px">boopis deploy staging --tag 0.2.0</div>
        <div class="foot"><span class="btn xs" style="background:transparent;box-shadow:none;color:#f5f5f5a8">Deny</span><span class="btn xs" style="background:#f5f5f5;color:#121212;box-shadow:none">Hold to approve</span></div></div>
      <div style="border-radius:22px;background:#f5f5f50f;box-shadow:inset 0 0 0 .5px #f5f5f51a;display:flex;align-items:center;gap:8px;padding:8px;flex:none"><span class="ib s" style="background:#f5f5f50a;color:#f5f5f58a">${I('plus')}</span><span class="grow s" style="color:#f5f5f58a">Message nina</span><span class="ib s" style="background:#f5f5f50a;color:#f5f5f58a">${I('mic')}</span><span class="ib s" style="background:#f5f5f5;color:#121212">${I('waveform')}</span></div>
      <div class="row" style="justify-content:center;gap:12px;padding-top:4px">${['boopis', 'kai', 'nina', 'moss', 'iris', 'hex'].map((n) => orb(n, 20, { still: true, surface: '#000000', state: n === 'nina' ? 'needs' : 'idle' })).join('')}</div></div>`;
    const d = window.V7.dock(520, 330, inner, { left: `calc(${L}px + (100% - ${L}px) / 2)` }).replace('class="dk-in"', 'class="dk-in" style="padding:0;align-items:stretch"');
    return frame(o, `${rail({ ...o, current: 'none' })}${chrome({ ...o, title: pill(`<boopis-logo still style="font-size:20px;color:var(--text-strong)"></boopis-logo>`, '') })}
      <div class="main" style="left:${L}px"><div style="position:absolute;inset:0;display:grid;place-items:center;padding-bottom:300px"><div class="col" style="align-items:center;gap:14px"><span class="l dim">What should change?</span>${composer({ ...o, placeholder: 'Describe the change', composerW: 620 })}</div></div></div>${d}`);
  }

  window.SCREENS = { session, botChat, room, settings, store, dock: dockScreen, chrome, rail, sidebarOpen, composer, pill, frame, orb, stack, mention, nameIn, dockRow };
})();
