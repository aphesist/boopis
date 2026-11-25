/* Bot sessions at Grok-Bot parity (DESIGN-SYSTEM.md 19), with the owner's picks: screens 11, 12 and 17. */
(function () {
  const { I, mark, orb, stack } = window.V7;
  const S = window.SCREENS;
  const bubbleA = (html, extra = '') => `<div class="b agent sq"${extra}>${html}</div>`;
  const bubbleU = (html) => `<div class="b user sq">${html}</div>`;
  const ask = (head, title, sub, actions) => `<div class="qcard sq" style="align-self:flex-start;width:min(100%,var(--bubble-max))"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${head}</div><div class="m" style="margin-bottom:8px">${title}</div>${sub || ''}${actions}</div>`;
  const approval = (bot, title, rule) => ask(`${orb(bot, 16, { state: 'needs', still: true, surface: 'var(--bg-3)' })}${bot} asks<span class="grow"></span><span class="stamp"><span class="dot owe"></span>needs you</span>`, title,
    `<div class="xs dim ell" style="margin:-4px 0 8px">Rule: <span style="color:var(--accent-text);text-decoration:underline;text-underline-offset:3px">“${rule}”</span></div>`,
    `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip on">Hold to allow once</span><span class="chip">Allow all this turn</span><span class="chip">Always allow</span><span class="chip out">Deny <span class="kbd" style="margin-left:2px;height:18px">esc</span></span></div>`);
  const tool = (icon, head, inner = '') => `<div class="tool sq"><div class="th">${I(icon)}${head}<span class="grow"></span>${I(inner ? 'chevron-down' : 'chevron')}</div>${inner}</div>`;
  const file = (name, size) => `<div class="file sq"><span class="fi">${I('file')}</span><div class="col"><span class="m">${name}</span><span class="xs dim mono">${size}</span></div></div>`;
  const activity = (who, phrase, still) => `<div class="activity">${orb(who, 16, { state: still ? 'needs' : 'working' })}<span class="${still ? '' : 'shimmer'}">${phrase}</span></div>`;

  /* the open sidebar, Grok style: search and new floating at the top, the main bot (boopis) big, then the rows */
  function sidebarG(o) {
    const cur = o.current;
    const row = (n, act, ex = {}) => `<div class="sb-row sq${cur === n ? ' on' : ''}">${orb(n, 36, { state: ex.state, surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm ell">${n}</span><span class="act ell${ex.owe ? ' owe' : ''}">${act}</span></div>${ex.end || ''}</div>`;
    return `<aside class="side sb-open" style="padding-top:12px">
      <div class="row" style="justify-content:flex-end;gap:8px;padding:0 4px 4px 0"><span class="ib s" style="width:36px;height:36px">${I('plus')}</span></div>
      <div class="mainbot">${orb('boopis', 64, { surface: 'var(--bg-1)' })}<span>boopis</span></div>
      ${row('kai', o.kaiAct || 'Writing the changelog', { state: 'working' })}
      ${row('nina', 'Needs you: approve a deploy', { owe: true, state: 'needs', end: '<span class="dot owe"></span>' })}
      ${row('moss', 'Found 2 flaky tests')}
      ${row('iris', 'Checked the new composer')}
      ${row('hex', 'Asleep', { state: 'sleeping' })}
      <div class="sb-row sq${cur === 'room' ? ' on' : ''}">${stack(['kai', 'nina', 'moss'], 24, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm ell">release crew</span><span class="act ell">@nina the deploy is ready</span></div></div>
      <div class="foot-ctl" style="flex-direction:row;justify-content:space-between;padding:12px 6px 0;align-items:center">
        <span class="row"><span class="ib s" style="width:32px;height:32px;background:var(--current);box-shadow:none;color:var(--text)">${I('user')}</span><span class="s dim">you</span></span>
        <span class="row"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></span></div></aside>`;
  }

  /* the details pane (the title pill opens it): big orb, name, Activity | Library, only what exists */
  function pane() {
    const sr = (lb, ctl) => `<div class="sr"><div class="lb s">${lb}</div>${ctl}</div>`;
    return `<aside class="pane"><div class="pane-in">
      <div class="col" style="align-items:center;gap:8px">${orb('kai', 64, { surface: 'var(--bg-pane)' })}<span class="l w5">kai</span><span class="seg"><span class="on">Activity</span><span>Library</span></span></div>
      <div class="pane-sec">Upcoming</div><div class="pane-card sq">${sr('Weekly changelog<br><span class="xs dim">Fridays around 16:00</span>', '<span class="switch on"></span>')}</div>
      <div class="pane-sec">Work</div><div class="pane-card sq">${sr('Model', `<span class="row s dim" style="gap:5px">${mark('claude', 14)}sonnet 5.5</span>`)}${sr('Spend', '<span class="s dim mono">$0.12 of $1.00</span>')}${sr('Workspace', '<span class="s dim mono">worktree notes-0.2</span>')}</div>
    </div></aside>`;
  }

  const shell = (o, side, title, body, comp, extra = '') => {
    const L = o.sidebar === 'open' ? 300 : 88, P = o.pane ? 356 : 0;
    const bf = o.botFill ? ` data-botfill style="left:${L}px;right:${P}px;--bubble-user:${o.botFill[0]};--bubble-user-text:${o.botFill[1]}"` : ` style="left:${L}px;right:${P}px"`;
    return S.frame(o, `${side}${S.chrome({ ...o, title, pane: o.pane })}
      <div class="main"${bf}><div class="thread" style="padding-top:72px">${body}</div>
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:24px">${comp}</div></div>${o.pane ? pane() : ''}${extra}`);
  };
  const comp = (o, ph, under) => S.composer({ ...o, composer: 'c', placeholder: ph, under, composerW: o.pane ? 600 : 720 });
  const underBot = `<span class="row" style="gap:4px">${I('ladder')}Governed</span><span class="row" style="gap:5px">${mark('claude', 12)}sonnet 5.5</span><span class="grow"></span><span class="mono">$0.12 of $1.00</span>`;

  /* 11: a bot's chat, the rail, the details pane open, an approval waiting */
  function bot11(o) {
    const title = S.pill(`${orb('kai', 24, { surface: 'var(--bg-3)' })}kai`, '');
    const body = `<div class="sep">Today 10:05</div>
      ${bubbleU('Draft the release notes for 0.2.0 and push them.')}
      ${bubbleA('On it. 14 merges since Monday, most of them the dock and the rooms.', ' style="margin-top:16px"')}
      ${tool('session', '<b>Read</b> 14 merged pull requests')}
      ${file('CHANGELOG.md', '41 lines, 2.1 KB')}
      <div class="row" style="align-self:stretch;margin-top:6px">${bubbleA('The notes are in two sections: one screen for people, one for the Local API.')}<span class="hoverbar"><span>${I('copy')}</span><span>${I('more')}</span></span></div>
      <div style="height:6px"></div>${approval('kai', 'Push to a shared branch: git push origin notes-0.2', 'Pushes to a shared branch')}
      ${activity('kai', 'Waiting for you', true)}`;
    return shell({ ...o, pane: true, botFill: ['#4fc9a8', '#121212'] }, S.rail({ ...o, current: 'kai', kaiState: 'needs' }), title, body, comp({ ...o, pane: true }, 'Message kai', underBot));
  }

  /* 12: a group room, the sidebar open: names above bubbles in the bot's colour, the orb at the bubble's lower left */
  function room12(o) {
    const title = S.pill(`${stack(['kai', 'nina', 'moss'], 24, { surface: 'var(--bg-3)' })}release crew`, '');
    const said = (n, html) => `<div class="gname">${S.nameIn(n)}</div><div class="gutter" style="align-self:stretch"><span class="g-orb">${orb(n, 20, { still: true, surface: 'var(--bg-2)' })}</span>${html}</div>`;
    const body = `<div class="sep">Today 11:20</div>
      ${bubbleU(`${S.mention('kai')} write the notes, ${S.mention('nina')} ship 0.2.0 to staging when they're in.`)}
      ${said('kai', bubbleA(`Notes are in <code>CHANGELOG.md</code>, two sections. The dock fix is the headline (<span class="cite"><i></i>WebKit bug 27611</span>).`))}
      <div class="sysline">${I('clock')}Created routine Weekly changelog</div>
      ${said('nina', bubbleA(`<span class="you">${I('user')}you</span> staging needs your approval before I deploy.`, ' style="--sq-bg:linear-gradient(var(--owe-soft),var(--owe-soft)),linear-gradient(var(--bubble-agent),var(--bubble-agent))"'))}
      <div class="gutter" style="align-self:stretch;margin-top:6px">${approval('nina', 'Deploy 0.2.0 to staging', 'Deploys need my OK')}</div>
      ${said('moss', bubbleA('The two flaky tests are quarantined, so the gate is green.'))}
      <div class="activity">${stack(['kai', 'moss'], 16)}<span class="shimmer">kai and moss are replying</span></div>`;
    return shell({ ...o, sidebar: 'open' }, sidebarG({ current: 'room' }), title, body, comp(o, 'Message release crew', `<span class="row" style="gap:4px">${I('at')}3 members</span><span class="grow"></span><span class="mono">$0.21</span>`));
  }

  /* 17: a bot working through a multi-step task: acknowledge, then the steps, then the activity line */
  function work17(o) {
    const title = S.pill(`${orb('kai', 24, { surface: 'var(--bg-3)' })}kai`, '');
    const st = (cls, ic, t, time) => `<div class="step ${cls}"><span class="ic">${ic}</span>${t}${time ? `<span class="t">${time}</span>` : ''}</div>`;
    const body = `<div class="sep">Today 14:02</div>
      ${bubbleU('Prepare the 0.2.0 release: notes, tests, tag, and staging.')}
      ${bubbleA('On it. Five steps; I’ll tell you when staging is up.', ' style="margin-top:16px"')}
      ${tool('session', '<b>Release 0.2.0</b> step 3 of 5', `<div class="steps">
        ${st('done', I('check'), 'Read 14 merged pull requests', '0:12')}
        ${st('done', I('check'), 'Wrote CHANGELOG.md, 41 lines', '0:48')}
        ${st('now', '<span class="dot run" style="width:7px;height:7px"></span>', 'Run the tests', '3 of 5 suites')}
        ${st('todo', '<span class="dot" style="width:6px;height:6px;background:var(--mark-off)"></span>', 'Tag 0.2.0')}
        ${st('todo', '<span class="dot" style="width:6px;height:6px;background:var(--mark-off)"></span>', 'Deploy to staging (asks first)')}</div>`)}
      ${tool('terminal', '<b>Terminal</b> ran 2 commands')}
      ${file('CHANGELOG.md', '41 lines, 2.1 KB')}
      ${activity('kai', 'Running the tests')}`;
    return shell({ ...o, botFill: ['#4fc9a8', '#121212'] }, S.rail({ ...o, current: 'kai', kaiState: 'working' }), title, body, comp(o, 'Message kai', underBot));
  }

  Object.assign(window.SCREENS, { bot11, room12, work17 });
})();
