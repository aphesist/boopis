/* The Session tab redesigned from T3 Code's study, in v7 (DESIGN-SYSTEM.md 20). Batch 1: S1 to S8. */
(function () {
  const { I, mark, orb } = window.V7;
  const S = window.SCREENS;
  const cm = (fam, s = 14) => mark(fam, s);
  const bubbleU = (h, st = '') => `<div class="b user sq"${st}>${h}</div>`;
  const bubbleA = (h, st = '') => `<div class="b agent sq"${st}>${h}</div>`;
  const ask = (head, title, sub, actions, st = '') => `<div class="qcard sq" style="align-self:flex-start;width:min(100%,var(--bubble-max))${st}"><div class="row xs dim" style="gap:6px;margin-bottom:4px">${head}</div><div class="m" style="margin-bottom:8px">${title}</div>${sub || ''}${actions}</div>`;
  const ticks = (n) => `<span class="ticks">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const status = (phrase, still) => `<div class="activity">${mark('claude', 16, still ? '' : 'pulse')}<span class="${still ? '' : 'shimmer'}">${phrase}</span></div>`;

  /* the Sessions sidebar as an inbox (S7 option A: sections in the list) */
  function inbox(o = {}) {
    const row = (t, sub, ex = {}) => `<div class="sess-row sq${ex.on ? ' on' : ''}">${ex.lead || cm(ex.fam || 'claude', 16)}<div class="col grow"><span class="t ell">${t}</span><span class="sub">${sub}</span></div>${ex.end || ''}</div>`;
    const h = (t, n, ex = '') => `<div class="inbox-h">${t}<span class="n">${n}</span><span class="grow"></span>${ex}</div>`;
    const cur = o.current || 'dock';
    return `<aside class="side sb-open">
      <div class="row" style="justify-content:space-between;padding:0 6px 6px"><span class="seg"><span class="on">Sessions</span><span>Bots</span></span><span class="ib s" title="">${I('plus')}</span></div>
      ${h('Needs you', 1)}${row("Fix the dock's half paint", '<span class="mono">w32/dock-paint</span>', { on: cur === 'dock', end: o.dockBadge || '<span class="badge2 owe">Approval</span>' })}
      ${h('Working', 2)}${row('Room mentions in every composer', '<span class="mono">w29/mentions</span>', { on: cur === 'mentions', end: '<span class="dot run"></span>' })}${row('Store: de-duplicate items', '<span class="mono">main</span>', { fam: 'openai', end: '<span class="dot run"></span>' })}
      ${h('Pinned', 1)}${row('Release checklist', '<span class="mono">main</span>', { fam: 'gemini' })}
      ${h('Recent', 3)}${row('Startup notice for Windows', '<span class="mono">w29/notice</span><span>2h</span>', { end: o.hoverRow ? `<span class="row" style="gap:2px"><span class="ib s" style="width:26px;height:26px;background:transparent;box-shadow:none">${I('clock')}</span><span class="ib s" style="width:26px;height:26px;background:transparent;box-shadow:none">${I('check')}</span></span>` : '', on: false })}${row('Hold to approve in the dock', '<span class="mono">w28/hold</span><span>mon</span>')}${row('Archived bots group', '<span class="mono">w27/archive</span><span>sun</span>')}
      ${h('Settled', 12, `<span class="xs dim">${I('chevron')}</span>`)}
      <div class="foot-ctl" style="flex-direction:row;justify-content:flex-end;padding:12px 6px 0"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></div></aside>`;
  }

  /* the composer, session kind: the line underneath carries permissions, workspace, model and effort, cost */
  const underSess = (o = {}) => o.minimal ? `<span class="row" style="gap:4px">${I('shield')}${o.perm || 'Auto-accept edits'}</span><span class="grow"></span><span class="mono">$0.37 of $0.60</span>` : `<span class="row" style="gap:4px">${I('shield')}${o.perm || 'Auto-accept edits'}</span><span class="row" style="gap:4px">${I('fork')}<span class="mono">${o.branch || 'w32/dock-paint'}</span></span><span class="row" style="gap:5px">${cm('claude', 12)}sonnet 5.5 ${ticks(3)}</span><span class="grow"></span><span class="row" style="gap:6px">${ticks(2)}<span class="mono">${o.ctx || '76k / 200k'}</span></span><span class="mono">$0.37 of $0.60</span>`;
  const comp = (o, ph, extra = {}) => S.composer({ ...o, composer: 'c', placeholder: ph, typed: extra.typed, under: extra.under || underSess(extra), composerW: extra.w || 720, queue: false });

  const title = (t, branch) => S.pill(`<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--fill-2);color:var(--icon)">${I('session')}</span>${t}`, branch ? `<span class="mono" style="font-size:12px">${branch}</span>` : '');
  function shell(o, body, compHTML, ex = {}) {
    const L = 300, R = ex.panelW || 0;
    return S.frame(o, `${ex.side || inbox(ex)}${S.chrome({ ...o, sidebar: 'open', title: ex.title || title("Fix the dock's half paint", 'w32/dock-paint'), pane: !!R })}
      <div class="main" style="left:${L}px;right:${R}px">${ex.mainInner || `<div class="thread sess" data-model="${ex.model || 'claude'}" style="padding-top:72px">${body}</div>`}
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:${ex.noDock ? 24 : 96}px">${ex.above || ''}${compHTML}</div>${ex.noDock ? '' : (ex.dock || S.dockRow())}</div>${ex.panel || ''}${ex.overlay || ''}`);
  }

  /* S1: the launch step (option A: the scale as one segmented track; option B: four rows) */
  function s1(o) {
    const scaleA = `<div class="scale"><span class="on">${I('shield')}Supervised</span><span>Auto-accept edits</span><span>Auto</span><span>Full access</span></div>
      <div class="xs dim" style="margin:8px 4px 0">Asks before every change and every command. Every write is recorded either way.</div>`;
    const scaleB = `<div class="col" style="gap:2px">${[['Supervised', 'asks before every change and command'], ['Auto-accept edits', 'changes apply when the gate passes; commands ask', 1], ['Auto', 'only your approval rules ask'], ['Full access', 'nothing asks; every write is still recorded']].map(([n, d, on]) => `<div class="optrow sq${on ? ' on' : ''}"><span class="ring"></span><div class="col"><span class="m">${n}</span><span class="xs dim">${d}</span></div></div>`).join('')}</div>`;
    const row = (lb, ctl) => `<div class="sr" style="padding:6px 16px"><div class="lb">${lb}</div>${ctl}</div>`;
    const sel = (v) => `<span class="select" style="color:var(--text)">${v}${I('chevron-down')}</span>`;
    const card = `<div style="width:600px;margin:0 auto;padding-top:${o.opt === 'a' ? 130 : 84}px">
      <div class="xl w5" style="margin:0 0 4px 4px">New session</div><div class="s dim" style="margin:0 0 16px 4px">Fixed for this session; change any of them later and it continues on a new engine session.</div>
      <div class="card sq">${row('Project', `<span class="row s" style="gap:6px">${I('folder')}<span class="mono">~/code/boopis</span>${I('chevron-down')}</span>`)}
        ${row('Workspace', '<span class="seg"><span class="on">New worktree</span><span>This checkout</span></span>')}
        ${row('Model', `<span class="select" style="color:var(--text)">${cm('claude', 14)}sonnet 5.5${I('chevron-down')}</span>`)}
        ${row('Effort', `<span class="row s dim" style="gap:8px">${ticks(3)}Default${I('chevron-down')}</span>`)}</div>
      <div class="set-head">How careful</div><div class="card sq" style="padding:${o.opt === 'a' ? '14px' : '6px'}">${o.opt === 'a' ? scaleA : scaleB}</div></div>`;
    return shell(o, '', comp(o, 'What should change? @ files, $ skills, / commands'), { mainInner: card, title: title('New session'), dockBadge: '<span class="badge2 owe">Approval</span>' });
  }

  /* S2: a running turn, Supervised: the approval inline on the tool row, feedforward marks, the model logo's status */
  function s2(o) {
    const body = `<div class="sep">Today 09:42</div>
      ${bubbleU('The dock loses its right half while the slab moves. Find why and fix it.')}
      ${bubbleA('Reading the dock’s stage and clip code first.', ' style="margin-top:16px"')}
      <div class="worklog">${I('chevron')}Read 6 files, searched 2 patterns</div>
      <div class="toolrow sq"><div class="h">${cm('claude', 14)}<span style="color:var(--icon-quiet);display:inline-flex">${I('pen')}</span><b>modules/dock/dock.css</b><span class="mono" style="color:var(--add)">+12</span><span class="mono" style="color:var(--del)">−3</span><span class="grow"></span><span class="word owe">Waiting for you</span></div>
        <div class="row" style="justify-content:flex-end;gap:6px;margin-top:6px"><span class="chip out">Decline</span><span class="chip">Always allow this session</span><span class="chip on">Hold to allow once</span></div></div>
      ${status('Waiting for your approval', true)}`;
    const typed = `Don't centre with a transform, use <span class="mk2" data-state="shown">auto margins</span> on the <span class="mk2" data-state="shown">page</span>`;
    return shell(o, body, comp(o, 'Send feedback to decline this request', { typed, perm: 'Supervised' }));
  }

  /* S3: steer vs queue while running */
  function s3(o) {
    const body = `<div class="sep">Today 10:10</div>
      ${bubbleU('Add multiply and divide to calc.py, with tests.')}
      ${bubbleA('On it: two functions, then their tests.', ' style="margin-top:16px"')}
      <div class="worklog">${I('chevron')}Changed 1 file, ran 1 command</div>
      <div class="steer">${I('forward')}Steer<span class="b user sq" style="font-size:14px;padding:5px 12px">Use type hints on the new functions.</span></div>
      ${bubbleA('Adding type hints as I go.', ' style="margin-top:10px"')}
      ${status('Running the tests')}`;
    const queue = `<div class="queue sq"><div class="q"><span class="n">1</span><span class="grow ell">Also add a short docstring to every function.</span><span class="btn xs ghost">${I('pen')}</span><span class="btn xs ghost">${I('close')}</span><span class="btn xs tint">Send now</span></div>
      <div class="q"><span class="n">2</span><span class="grow ell dim">Then update the README's examples.</span><span class="btn xs ghost">${I('pen')}</span><span class="btn xs ghost">${I('close')}</span><span class="btn xs tint">Send now</span></div></div>`;
    const keyhint = `<div class="row xs dim" style="gap:6px;justify-content:flex-end;padding:6px 8px 0"><span>Enter queues</span><span class="keys"><span class="kbd">ctrl</span><span class="kbd">Enter</span></span><span>steers</span></div>`;
    return shell(o, body, comp(o, 'Queue a message, or ctrl Enter to steer', { under: underSess({ branch: 'w32/calc-ops' }) }) + keyhint, { above: queue, title: title('Calc: multiply and divide', 'w32/calc-ops'), current: 'mentions' });
  }

  /* S4: the finished turn: the work log collapsed, changed files, the checkpoint, a blank lapsed into the AskCard */
  function s4(o) {
    const body = `<div class="sep">Today 09:42</div>
      ${bubbleU('The dock loses its right half while the slab moves. Find why and fix it.')}
      <div class="row" style="align-self:stretch;margin-top:12px"><div class="worklog" style="margin:0">${I('chevron')}Worked for 59s: changed 2 files, ran 1 command</div></div>
      ${bubbleA('Fixed. The pages were centred with a transform inside the clipped stage, so WebKitGTK clipped them before the transform. They are centred by layout now, and the tests pass. I guessed <span class="mk2" data-state="shown">staging</span> for the check (my guess).', ' style="margin-top:8px"')}
      <div class="files-card sq"><div class="row s dim" style="gap:6px;margin-bottom:4px">2 changed files<span class="mono" style="color:var(--add)">+14</span><span class="mono" style="color:var(--del)">−5</span><span class="grow"></span><span class="btn xs tint">Open diff</span></div>
        <div class="fl">${I('file')}modules/dock/dock.css<span class="c"><span style="color:var(--add)">+12</span><span style="color:var(--del)">−3</span></span></div><div class="fl">${I('file')}modules/dock/engine.ts<span class="c"><span style="color:var(--add)">+2</span><span style="color:var(--del)">−2</span></span></div></div>
      <div class="turnbar"><span class="xs dim" style="margin-right:6px">Checkpoint 3</span><span class="btn ghost">${I('back')}Undo</span><span class="btn ghost">${I('pen')}Edit from here</span><span class="btn ghost">${I('fork')}Fork</span><span class="grow"></span><span class="mono xs dim">${cm('claude', 12)} sonnet 5.5 0m 59s $0.08</span></div>
      ${ask(`${cm('claude', 14)}asked during the turn`, 'Check the fix on which build?', '', `<div class="row" style="gap:6px"><span class="chip on">staging</span><span class="chip">the Linux app</span><span class="chip out">Something else</span></div>`, ';margin-top:10px')}`;
    return shell(o, body, comp(o, 'What next?', {}), { dockBadge: '' });
  }

  /* DiffView: one grid, [gutter 36][sign 16][code], the comment in the code column */
  function diffView(open, file = 'modules/dock/dock.css', a = 12, d = 3, comment = true) {
    const r = (cls, n, g, code) => `<div class="dv-r ${cls}"><span class="n">${n}</span><span class="g">${g}</span><span>${code}</span></div>`;
    return `<div class="dv sq"><div class="dv-h">${I(open ? 'chevron-down' : 'chevron')}${file}<span class="c"><span style="color:var(--add)">+${a}</span><span style="color:var(--del)">−${d}</span></span></div>${open ? `
      ${r('', 40, '', '.dk-page {')}${r('del', 41, '−', '  left: 50%; transform: translateX(-50%);')}${r('add', 41, '+', '  left: -100vw; right: -100vw;')}${r('add', 42, '+', '  margin-inline: auto;')}
      ${comment ? `<div class="dv-c sq"><div class="who">${I('user')}Your comment on line 42</div>Keep the comment that explains why the transform clipped.<div class="row" style="gap:6px;justify-content:flex-end;margin-top:8px"><span class="chip">Cancel</span><span class="chip on">Add to message</span></div></div>` : ''}
      ${r('', 43, '', '}')}` : ''}</div>`;
  }
  window.SCREENS.diffView = diffView;

  /* S5: the right panel as one panel with tabs; Diff open; a review comment becomes a composer chip */
  function s5(o) {
    const W = 600;
    const panel = `<aside class="rpanel" style="width:${W}px"><div class="rtabs"><span class="seg"><span class="on">Diff</span><span>Files</span><span>Terminal</span><span>PR</span></span><span class="grow"></span><span class="select" style="color:var(--text)">This turn${I('chevron-down')}</span><span class="ib s" style="background:transparent;box-shadow:none">${I('close')}</span></div>
      <div class="row xs dim" style="padding:0 16px 8px;gap:8px">2 files<span class="mono" style="color:var(--add)">+14</span><span class="mono" style="color:var(--del)">−5</span><span class="grow"></span><span>Stacked</span><span>Split</span></div>
      <div style="margin:0 12px">${diffView(true)}</div>
      <div style="margin:10px 12px">${diffView(false, 'modules/dock/engine.ts', 2, 2)}</div></aside>`;
    const body = `<div class="sep">Today 09:42</div>${bubbleU('The dock loses its right half while the slab moves. Find why and fix it.')}
      <div class="worklog">${I('chevron')}Worked for 59s: changed 2 files, ran 1 command</div>${bubbleA('Fixed. The pages are centred by layout now, and the tests pass.', ' style="margin-top:8px"')}`;
    const typed = `<span class="refchip">dock.css:42</span> Keep the comment that explains why the transform clipped.`;
    return shell(o, body, comp(o, '', { typed, w: 500 }), { panelW: W, panel });
  }

  /* S6: the commit dialog: files, a generated message, one stacked action */
  function s6(o) {
    const fl = (n, a, d, on = true) => `<div class="fl" style="height:30px">${on ? `<span style="color:var(--accent-text);display:inline-flex">${I('check')}</span>` : '<span style="width:16px"></span>'}${n}<span class="c"><span style="color:var(--add)">+${a}</span><span style="color:var(--del)">−${d}</span></span></div>`;
    const dlg = `<div class="scrim"></div><div class="dialog form sq" style="left:${300 + (1140 - 520) / 2}px;top:120px;width:520px;padding:18px 20px 12px">
      <div class="l w6">Commit changes</div><div class="s dim" style="margin:2px 0 14px">On <span class="mono">w32/dock-paint</span></div>
      <div class="set-head" style="margin:0 0 6px 2px">Files</div><div class="card sq" style="padding:6px 12px">${fl('modules/dock/dock.css', 12, 3)}${fl('modules/dock/engine.ts', 2, 2)}${fl('tests/e2e/dock_webkit.py', 9, 0, false)}</div>
      <div class="set-head" style="margin:14px 0 6px 2px">Message <span class="quiet">written from the changes</span></div>
      <div class="input sq" style="height:auto;display:block;padding:10px 12px;color:var(--text);font-size:13px;line-height:19px">Centre the dock's pages by layout, not a transform<br><span class="dim">WebKitGTK clipped a transformed child of the stage before its transform while the clip changed, so the right half went missing.</span></div>
      <div class="xs dim" style="margin:8px 2px 0">No agent credits are added.</div>
      <div class="foot" style="margin-top:14px"><span class="btn sm ghost">Cancel</span><span class="row" style="gap:0"><span class="btn sm primary" style="border-radius:999px 0 0 999px">Commit and push</span><span class="btn sm primary" style="border-radius:0 999px 999px 0;padding:0 10px;margin-left:1px">${I('chevron-down')}</span></span></div>
      <div class="menu sq" style="position:absolute;right:12px;top:calc(100% + 6px);width:230px"><div class="mi sq">Commit</div><div class="mi sq hov">Commit and push</div><div class="mi sq">Commit, push and open a PR</div><div class="mi sq">Commit on a new branch</div></div></div>`;
    return s4(o).replace(/<\/div>$/, dlg + '</div>');
  }

  /* S7 option B: the inbox as filter chips over a flat list */
  function inboxB(o = {}) {
    const row = (t, sub, end, fam = 'claude', on) => `<div class="sess-row sq${on ? ' on' : ''}">${cm(fam, 16)}<div class="col grow"><span class="t ell">${t}</span><span class="sub">${sub}</span></div>${end || ''}</div>`;
    return `<aside class="side sb-open">
      <div class="row" style="justify-content:space-between;padding:0 6px 6px"><span class="seg"><span class="on">Sessions</span><span>Bots</span></span><span class="ib s">${I('plus')}</span></div>
      <div class="row" style="gap:6px;padding:4px 6px 10px;flex-wrap:wrap"><span class="chip on">All 7</span><span class="chip">Needs you 1</span><span class="chip">Working 2</span><span class="chip">Pinned 1</span><span class="chip out">Settled</span></div>
      ${row("Fix the dock's half paint", '<span class="mono">w32/dock-paint</span>', '<span class="badge2 owe">Approval</span>', 'claude', true)}
      ${row('Room mentions in every composer', '<span class="mono">w29/mentions</span>', '<span class="dot run"></span>')}
      ${row('Store: de-duplicate items', '<span class="mono">main</span>', '<span class="dot run"></span>', 'openai')}
      ${row('Release checklist', '<span class="mono">main</span><span>pinned</span>', '', 'gemini')}
      ${row('Startup notice for Windows', '<span class="mono">w29/notice</span><span>2h</span>')}
      ${row('Hold to approve in the dock', '<span class="mono">w28/hold</span><span>mon</span>')}
      <div class="foot-ctl" style="flex-direction:row;justify-content:flex-end;padding:12px 6px 0"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></div></aside>`;
  }
  function s7(o) {
    const snooze = `<div class="menu sq" style="position:absolute;z-index:6;left:250px;top:430px;width:200px"><div class="mt">Snooze until</div><div class="mi sq hov">In 1 hour</div><div class="mi sq">This evening</div><div class="mi sq">Tomorrow</div><div class="mi sq">When usage resets</div><div class="mi sq">Pick a time…</div></div>`;
    const body = `<div class="sep">Today 09:42</div>${bubbleU('The dock loses its right half while the slab moves. Find why and fix it.')}`;
    return shell(o, body, comp(o, 'Send feedback to decline this request', { perm: 'Supervised' }), o.opt === 'b' ? { side: inboxB() } : { hoverRow: true, overlay: snooze });
  }

  /* S8: a mid-session settings change: one line in the thread */
  function s8(o) {
    const body = `<div class="sep">Today 11:02</div>${bubbleU('Make the dock tests run in WebKit too.')}
      <div class="worklog">${I('chevron')}Worked for 1m 12s: changed 1 file</div>${bubbleA('Done: the WebKit run is a second job in the same workflow.', ' style="margin-top:8px"')}
      <div class="sysline">${I('sliders')}Settings changed: continued with Auto-accept edits<span class="mono" style="margin-left:6px">+$0.04</span></div>
      ${bubbleU('Now run both jobs locally.')}${status('Running the tests')}`;
    return shell(o, body, comp(o, 'Message', { under: underSess({ perm: 'Auto-accept edits' }) }));
  }

  /* S9: a blank waiting inline (the agent paused, a countdown), in the reply */
  function s9(o) {
    const body = `<div class="sep">Today 12:30</div>${bubbleU('Ship the dock fix and check it.')}
      <div class="worklog">${I('chevron')}Changed 2 files, ran the gate</div>
      ${bubbleA(`The gate passed. Which build should I check it on: <span class="mk2 gap" data-state="waiting-owe"></span><span class="blank-count">0:42</span><span class="blank-word lapsed">waiting for you</span>`, ' style="margin-top:8px"')}
      <div class="xs dim" style="margin:6px 4px">Paused until you answer or the time runs out; then it goes on with its guess and asks again below.</div>
      ${status('Waiting for you', true)}`;
    return shell(o, body, comp(o, 'Message', {}), { dockBadge: '<span class="badge2 owe">Blank</span>' });
  }

  window.SCREENS.inboxB = inboxB;
  Object.assign(window.SCREENS, { s9, s1, s2, s3, s4, s5, s6, s7, s8, inbox, underSess, sessShell: shell, sessTitle: title, sessComp: comp, statusModel: status });
})();
