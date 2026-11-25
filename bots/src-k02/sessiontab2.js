/* The Session tab, second half: S10 to S20 (SESSION-TAB.md). */
(function () {
  const { I, mark, orb } = window.V7;
  const S = window.SCREENS;
  const sh = S.sessShell, comp = S.sessComp, title = S.sessTitle, status = S.statusModel;
  const cm = (f, s = 14) => mark(f, s);
  const bubbleU = (h, st = '') => `<div class="b user sq"${st}>${h}</div>`;
  const bubbleA = (h, st = '') => `<div class="b agent sq"${st}>${h}</div>`;
  const base = `<div class="sep">Today 09:42</div>${bubbleU('The dock loses its right half while the slab moves. Find why and fix it.')}
    <div class="worklog">${I('chevron')}Worked for 59s: changed 2 files, ran 1 command</div>${bubbleA('Fixed. The pages are centred by layout now, and the tests pass.', ' style="margin-top:8px"')}`;
  const panel = (tab, inner, W = 520) => `<aside class="rpanel" style="width:${W}px"><div class="rtabs"><span class="seg">${['Diff', 'Files', 'Terminal', 'PR', ...(tab === 'Side chat' ? ['Side chat'] : [])].map((t) => `<span class="${t === tab ? 'on' : ''}">${t}</span>`).join('')}</span><span class="grow"></span><span class="ib s" style="background:transparent;box-shadow:none">${I('close')}</span></div>${inner}</aside>`;
  const emptyInbox = `<aside class="side sb-open"><div class="row" style="justify-content:space-between;padding:0 6px 6px"><span class="seg"><span class="on">Sessions</span><span>Bots</span></span><span class="ib s">${I('plus')}</span></div>
    <div class="s dim" style="padding:18px 10px">No sessions yet</div><div class="foot-ctl" style="flex-direction:row;justify-content:flex-end;padding:12px 6px 0"><span class="ib s">${I('store')}</span><span class="ib s">${I('gear')}</span></div></aside>`;

  /* S10: the empty tab; adding a project; importing sessions (option b shows the import dialog) */
  function s10(o) {
    const mid = `<div style="position:absolute;inset:0;display:grid;place-items:center;padding-bottom:260px"><div class="col" style="align-items:center;gap:14px"><span class="l dim">Add a folder to start</span><div class="row" style="gap:8px"><span class="btn primary">${I('folder')}Add a project</span><span class="btn">Import sessions</span></div></div></div>`;
    const imp = o.opt === 'b' ? `<div class="scrim"></div><div class="dialog form sq" style="left:${300 + (1140 - 520) / 2}px;top:130px;width:520px;padding:18px 20px 12px">
      <div class="l w6">Import sessions</div><div class="s dim" style="margin:2px 0 12px">Found on this computer. They come in with their history and continue on a new engine session.</div>
      <div class="set-head" style="margin:0 0 6px 2px">~/code/boopis</div><div class="card sq" style="padding:4px 0">
        ${[['claude', 'Claude Code', 'Refactor the ledger reader', 'yesterday', 1], ['claude', 'Claude Code', 'Dock: page dots', 'mon', 1], ['openai', 'Codex', 'Store search ranking', 'sun', 0]].map(([f, src, t, w, on]) => `<div class="sr" style="min-height:44px">${on ? `<span style="color:var(--accent-text);display:inline-flex">${I('check')}</span>` : '<span style="width:16px"></span>'}${cm(f, 16)}<div class="lb">${t}<small>${src}, ${w}</small></div></div>`).join('')}</div>
      <div class="foot" style="margin-top:14px"><span class="btn sm ghost">Cancel</span><span class="btn sm primary">Import 2 sessions</span></div></div>` : '';
    return S.newSess({ ...o, st: 'noproject', overlay: imp }); /* the canvas is S41's (no project yet) */
  }

  /* S11: the composer's lists: / commands (a), $ skills with an @ file already in the text (b) */
  function s11(o) {
    const a = o.opt !== 'b';
    const menu = a ? `<div class="menu sq" style="position:absolute;left:0;bottom:calc(100% + 8px);width:360px"><div class="mt">Commands</div>
      ${[['/model', 'switch the model for the next turn'], ['/side', 'ask on the side, outside this session'], ['/clear', 'start fresh, earlier messages stay visible'], ['/compact', 'shrink the context into a summary']].map(([c, d], i) => `<div class="mi sq${i === 1 ? ' hov' : ''}"><span class="mono nm" style="width:76px">${c}</span><span class="ds">${d}</span></div>`).join('')}
      <div class="sepr"></div><div class="mt">Skills and plugins</div><div class="mi sq"><span class="mono nm" style="width:76px">/review</span><span class="ds">Review the diff against the base</span></div></div>`
      : `<div class="menu sq" style="position:absolute;left:150px;bottom:calc(100% + 8px);width:340px"><div class="mt">Skills</div>
      ${[['frontend-design', 'Distinctive interfaces'], ['webapp-testing', 'Drive a browser to check pages'], ['changelog', 'Write release notes from merges']].map(([c, d], i) => `<div class="mi sq${i === 1 ? ' hov' : ''}">${I('spark')}<span class="mono nm">${c}</span><span class="ds">${d}</span></div>`).join('')}</div>`;
    const typed = a ? '/si' : `Check <span class="refchip">@modules/dock/dock.css</span> with $we`;
    const c = comp(o, '', { typed }).replace('<div style="width:720px">', '<div style="width:720px;position:relative">').replace('<div class="composer sq"', `${menu}<div class="composer sq"`);
    return sh(o, base, c);
  }

  /* S12: side chat as a tab of the right panel */
  function s12(o) {
    const inner = `<div style="padding:4px 16px;display:flex;flex-direction:column;flex:1">
      <div class="row xs dim" style="gap:6px;margin:4px 0 10px">${I('session')}Context from Fix the dock's half paint</div>
      <div class="b user sq" style="align-self:flex-end;font-size:14px">What does the clip do to a transformed child?</div>
      <div class="b agent sq" style="margin-top:12px;font-size:14px">WebKitGTK applies the clip before the child's transform while the clip changes, so a child moved by translateX(-50%) loses its right half.</div>
      <div class="row" style="gap:6px;margin-top:8px"><span class="btn xs tint">Add to chat</span><span class="btn xs ghost">Delete</span></div>
      <div style="margin-top:auto;margin-bottom:14px">${S.composer({ composer: 'a', placeholder: 'Ask on the side', composerW: 488 })}</div></div>`;
    return sh(o, base + status('Running the tests'), comp(o, 'Message', { w: 560 }), { panelW: 520, panel: panel('Side chat', inner) });
  }

  /* S13: Files */
  function s13(o) {
    const f = (d, n, ex = '') => `<div class="fl" style="height:28px;padding-left:${d * 16}px">${I(n.endsWith('/') ? 'folder' : 'file')}${n}${ex}</div>`;
    const inner = `<div style="padding:0 16px"><div class="input search" style="height:32px;margin-bottom:10px">${I('search')}<span>Find a file</span></div>
      ${f(0, 'apps/')}${f(1, 'desktop/')}${f(2, 'ui/src/modules/dock/')}${f(3, 'dock.css', '<span class="c"><span style="color:var(--add)">+12</span><span style="color:var(--del)">−3</span></span>')}${f(3, 'engine.ts', '<span class="c"><span style="color:var(--add)">+2</span><span style="color:var(--del)">−2</span></span>')}${f(3, 'input.ts')}${f(3, 'layer.ts')}${f(0, 'docs/')}${f(0, 'tests/')}
      <div class="row xs dim" style="gap:6px;margin-top:12px"><span class="mono">~/.boopis/worktrees/boopis/dock-paint</span></div></div>`;
    return sh(o, base, comp(o, 'Message', { w: 560 }), { panelW: 520, panel: panel('Files', inner) });
  }

  /* S14: Terminal */
  function s14(o) {
    const inner = `<div style="padding:0 12px;flex:1;display:flex;flex-direction:column;margin-bottom:12px"><div class="row xs dim" style="gap:8px;padding:0 4px 8px">${I('folder')}<span class="mono">dock-paint</span>${I('fork')}<span class="mono">w32/dock-paint</span><span class="grow"></span><span class="ib s" style="width:26px;height:26px;background:transparent;box-shadow:none">${I('plus')}</span></div>
      <div class="well sq" style="flex:1;color:var(--text);padding:12px 14px"><div class="term"><span class="p">dock-paint $</span> pnpm test dock
<span class="d"> ✓ geometry.test.ts (12)
 ✓ centred.test.ts (4)
 ✓ clip.guard.test.ts (2)

 Test Files  3 passed (3)
      Tests  18 passed (18)</span>
<span class="p">dock-paint $</span> <span style="border-left:2px solid var(--focus)"></span></div></div>
      <div class="row xs dim" style="gap:6px;margin-top:8px">Select output to attach it to your message</div></div>`;
    return sh(o, base, comp(o, 'Message', { w: 560 }), { panelW: 520, panel: panel('Terminal', inner) });
  }

  /* S15: PR */
  function s15(o) {
    const chk = (ok, n) => `<div class="fl" style="font-family:var(--sans);font-size:13px;height:30px"><span style="color:${ok ? 'var(--ok-text)' : 'var(--text-quiet)'};display:inline-flex">${ok ? I('check') : '<span class="dot run" style="width:7px;height:7px"></span>'}</span>${n}</div>`;
    const inner = `<div style="padding:0 16px"><div class="row xs dim" style="gap:6px">${I('fork')}<span class="mono">w32/dock-paint → main</span></div>
      <div class="l w5" style="margin:6px 0 2px">Centre the dock's pages by layout, not a transform</div><div class="s dim">#412, open, 2 files</div>
      <div class="set-head" style="margin-left:0">Checks</div><div class="card sq" style="padding:4px 12px">${chk(1, 'typecheck')}${chk(1, 'unit')}${chk(0, 'e2e WebKit')}</div>
      <div class="set-head" style="margin-left:0">Review</div><div class="card sq" style="padding:10px 12px"><div class="s">No reviews yet</div></div>
      <div class="row" style="gap:6px;margin-top:14px"><span class="btn sm">Open on GitHub</span><span class="btn sm tint">Update from this session</span></div></div>`;
    return sh(o, base, comp(o, 'Message', { w: 560 }), { panelW: 520, panel: panel('PR', inner) });
  }

  /* S16: usage limits and the context tick */
  function s16(o) {
    const notice = `<div class="notice sq" style="margin-bottom:8px">${cm('claude', 16)}<span class="grow"><span style="color:var(--owe-text)">Claude limited until 14:00</span>, 42 min</span><span class="btn xs ghost">Resume at 14:00</span><span class="btn xs tint">Use gpt 6.1 meanwhile</span></div>`;
    const under = `<span class="row" style="gap:4px">${I('shield')}Supervised</span><span class="row" style="gap:5px">${cm('claude', 12)}sonnet 5.5</span><span class="row" style="gap:6px"><span class="ticks"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span><span class="mono">152k / 200k</span></span><span class="grow"></span><span class="row" style="gap:6px">Weekly<span class="limitbar" style="width:60px"><i style="width:81%"></i></span><span class="mono">81%</span></span>`;
    return sh(o, base + `<div class="sysline">${I('clock')}Paused: the subscription's limit was reached</div>`, comp(o, 'Message', { under }), { above: notice });
  }

  /* S17: continued after a restart */
  function s17(o) {
    const body = base + bubbleU('Now run the WebKit job locally.') + `<div class="sysline">${I('clock')}Continued after a restart</div><div class="queue sq" style="align-self:stretch;margin-top:8px"><div class="q"><span class="n">1</span><span class="grow ell">Then update the README's examples.</span><span class="xs dim">still queued</span></div></div>` + status('Running the WebKit job');
    return sh(o, body, comp(o, 'Message', {}));
  }

  /* S18: errors: a engine stopped, b no model, c gate failed */
  function s18(o) {
    if (o.opt === 'b') return S.newSess({ ...o, mk: 'a', st: 'nomodel' }); /* S41: no model is a kind inline action in the new session's canvas */
    if (o.opt === 'b0') {
      const card = `<div style="width:600px;margin:0 auto;padding-top:160px"><div class="xl w5" style="margin:0 0 14px 4px">New session</div><div class="card sq">
        <div class="sr"><div class="lb">Model</div><span class="row s" style="gap:8px;color:var(--red-text)">No model is signed in for this session<span class="btn xs">Choose a model</span></span></div></div></div>`;
      return sh(o, '', comp(o, 'What should change?', {}), { mainInner: card, title: title('New session') });
    }
    if (o.opt === 'c') {
      const body = base.replace('Fixed. The pages are centred by layout now, and the tests pass.', 'I changed the centring; the gate ran the tests.') + `<div class="files-card sq"><div class="row s" style="gap:8px">${I('terminal')}<span class="w5">Gate</span><span class="word" style="color:var(--red-text)">failed</span><span class="grow"></span><span class="btn xs tint">Fix and retry</span></div><div class="well sq" style="margin-top:8px;color:var(--red-text)">FAIL centred.test.ts &gt; the dock does not move
  expected 720 to be 744</div><div class="xs dim" style="margin-top:6px">Nothing was written: the change stays in the journal, not the workspace.</div></div>`;
      return sh(o, body, comp(o, 'Message', {}));
    }
    const body = base + bubbleU('Run the WebKit job.') + `<div class="sysline act" style="color:var(--red-text)">${I('close')}boopis's engine stopped<span class="btn tint">Start it again</span></div>`;
    return sh(o, body, comp(o, 'Message', {}));
  }

  /* S19: Settings > Sessions with the scope picker (a: segmented in the head, b: a select by the title) */
  function s19(o) {
    const nav = [['gear', 'General'], ['session', 'Sessions', 1], ['bots', 'Bots'], ['spark', 'Models'], ['shield', 'Approvals'], ['plug', 'Connectors'], ['palette', 'Appearance'], ['keyboard', 'Keyboard']].map(([i, l, on]) => `<div class="ni sq${on ? ' on' : ''}">${I(i)}${l}</div>`).join('');
    const sr = (lb, ctl) => `<div class="sr"><div class="lb">${lb}</div>${ctl}</div>`;
    const sel = (v) => `<span class="select">${v}${I('chevron-down')}</span>`;
    const sw = (on) => `<span class="switch${on ? ' on' : ''}"></span>`;
    const head = o.opt === 'b' ? `<div class="row" style="gap:10px;margin:2px 0 18px"><span class="set-title" style="margin:0">Sessions</span><span class="select" style="color:var(--text)">${I('folder')}boopis project${I('chevron-down')}</span></div>`
      : `<div class="row" style="justify-content:space-between;margin:2px 0 18px"><span class="set-title" style="margin:0">Sessions</span><span class="seg"><span>This device</span><span class="on">This project</span></span></div>`;
    const body = `${head}
      <div class="set-head">New sessions</div><div class="card sq">${sr('Workspace', '<span class="seg"><span class="on">New worktree</span><span>This checkout</span></span>')}${sr('Model', `<span class="select">${cm('claude', 14)}sonnet 5.5${I('chevron-down')}</span>`)}${sr('When it runs out', sel('gpt 6.1'))}${sr('How careful', sel('Auto-accept edits'))}</div>
      <div class="set-head">While it runs</div><div class="card sq">${sr('Enter while it runs', '<span class="seg"><span>Steers</span><span class="on">Queues</span></span>')}${sr('Wait for my answer', sel('60 s'))}${sr('Work log shows', sel('Everything'))}</div>
      <div class="set-head">Inbox</div><div class="card sq">${sr('Settle merged sessions', sw(1))}${sr('Settle after 7 idle days', sw(1))}${sr('Continue after a restart', sw(1))}${sr('Keep the computer awake while a session works', sw(0))}</div>`;
    const dlg = `<div class="scrim"></div><div class="dialog sq" style="left:${(1440 - 900) / 2}px;top:64px;width:900px;height:700px;display:flex"><div class="setnav">${nav}</div><div class="setbody">${body}</div><span class="ib s d-close" style="background:transparent;box-shadow:none">${I('close')}</span></div>`;
    return sh(o, base, comp(o, 'Message', {}), { overlay: dlg });
  }

  /* S20: the session's details (the title pill opens them) */
  function s20(o) {
    const sr = (lb, ctl) => `<div class="sr"><div class="lb s">${lb}</div>${ctl}</div>`;
    const inner = `<div class="pane-in" style="padding-top:58px">
      <div class="row" style="gap:8px;padding:0 4px"><span class="l w5 grow ell">Fix the dock's half paint</span><span class="ib s">${I('more')}</span></div>
      <div class="row xs dim" style="gap:6px;padding:2px 4px 6px">${I('folder')}<span class="mono">boopis</span>${I('fork')}<span class="mono">w32/dock-paint</span></div>
      <div class="pane-sec">Session</div><div class="pane-card sq">${sr('Model', `<span class="select">${cm('claude', 14)}sonnet 5.5${I('chevron-down')}</span>`)}${sr('Effort', `<span class="select">Default${I('chevron-down')}</span>`)}${sr('How careful', `<span class="select">Auto-accept edits${I('chevron-down')}</span>`)}${sr('Workspace', '<span class="s dim">worktree</span>')}</div>
      <div class="pane-sec">Use</div><div class="pane-card sq">${sr('Context', '<span class="s dim mono">76k / 200k</span>')}${sr('Cost', '<span class="s dim mono">$0.37 of $0.60</span>')}${sr('Pull request', '<span class="s" style="color:var(--accent-text)">#412</span>')}</div></div>`;
    return sh(o, base, comp(o, 'Message', { w: 600 }), { panelW: 356, panel: `<aside class="pane">${inner}</aside>` });
  }

  Object.assign(window.SCREENS, { emptyInbox, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20 });
})();
