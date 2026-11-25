/* Session tab boards, arranged as the Bots tab's: option boards S01-S07, component boards S08-S16 (DESIGN-SYSTEM.md 20). */
(function () {
  const { I, mark, orb } = window.V7;
  const S = window.SCREENS;
  const T = ['dark', 'light'];
  const cm = (f, s = 14) => mark(f, s);
  const cell = (t, inner, style = '') => `<div class="v7 cell" data-theme="${t}" style="${style}">${inner}</div>`;
  const pair = (fn, style) => `<div class="pair">${T.map((t) => cell(t, fn(t), style)).join('')}</div>`;
  const opt = (l, n, sub, rec, body, note) => `<section><div class="opt-h"><b>${l}. ${n}</b><span>${sub}</span>${rec ? `<span class="rec">${rec === true ? 'RECOMMENDED' : rec}</span>` : ''}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const comp = (n, sub, body, note) => `<section><div class="opt-h"><b>${n}</b><span>${sub}</span><span class="rec" style="background:#5b5bd6;color:#fff">NEW, FOR APPROVAL</span></div>${body}${note ? `<div class="note">${note}</div>` : ''}</section>`;
  const board = (title, lede, secs) => `<div class="bd"><h1>${title}</h1><p class="lede">${lede}</p><div class="opts">${secs.join('')}</div></div>`;
  const states = (list) => (t) => `<div class="row" style="gap:28px;align-items:flex-start;flex-wrap:wrap">${list.map(([cap, html]) => `<div><div class="cap">${cap}</div>${html}</div>`).join('')}</div>`;
  const ticks = (n) => `<span class="ticks">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const STEPS = [['Supervised', 'Asks before every change and every command.'], ['Auto-accept edits', 'Changes apply when the gate passes; commands ask.'], ['Auto', 'Only your approval rules ask.'], ['Full access', 'Nothing asks.']];
  const track = (k) => `<div class="scale">${STEPS.map(([n], i) => `<span class="${i === k ? 'on' : ''}">${i === k ? I('shield') : ''}${n}</span>`).join('')}</div><div class="xs dim" style="margin:8px 4px 0">${STEPS[k][1]} Every write is recorded either way.</div>`;
  const rows = (k) => `<div class="col" style="gap:2px">${STEPS.map(([n, d], i) => `<div class="optrow sq${i === k ? ' on' : ''}"><span class="ring"></span><div class="col"><span class="m">${n}</span><span class="xs dim">${d}</span></div></div>`).join('')}</div>`;
  const row = (lb, ctl) => `<div class="sr" style="padding:6px 16px"><div class="lb">${lb}</div>${ctl}</div>`;
  const launch = (scale, k, w = 560) => `<div style="width:${w}px"><div class="card sq">${row('Project', `<span class="row s" style="gap:6px">${I('folder')}<span class="mono">~/code/boopis</span>${I('chevron-down')}</span>`)}${row('Workspace', '<span class="seg"><span class="on">New worktree</span><span>This checkout</span></span>')}${row('Model', `<span class="select" style="color:var(--text)">${cm('claude')}sonnet 5.5${I('chevron-down')}</span>`)}${row('Effort', `<span class="row s dim" style="gap:8px">${ticks(3)}Default${I('chevron-down')}</span>`)}</div>
    <div class="set-head">How careful</div><div class="card sq" style="padding:${scale === 'rows' ? '6px' : '14px'}">${scale === 'rows' ? rows(k) : track(k)}</div></div>`;
  const clipSide = (side, h = 760) => `<div style="position:relative;width:300px;height:${h}px;overflow:hidden;border-radius:12px">${side.replace('class="side sb-open"', 'class="side sb-open" style="padding-top:16px"')}</div>`;
  const lineItems = { perm: `<span class="row" style="gap:4px">${I('shield')}Supervised</span>`, branch: `<span class="row" style="gap:4px">${I('fork')}<span class="mono">w32/dock-paint</span></span>`, model: `<span class="row" style="gap:5px">${cm('claude', 12)}sonnet 5.5 ${ticks(3)}</span>`, ctx: `<span class="row" style="gap:6px">${ticks(2)}<span class="mono">76k / 200k</span></span>`, cost: '<span class="mono">$0.37 of $0.60</span>' };
  const line = (keys) => keys.length ? keys.filter((k) => k !== 'cost' && k !== 'ctx').map((k) => lineItems[k]).join('') + '<span class="grow"></span>' + keys.filter((k) => k === 'ctx' || k === 'cost').map((k) => lineItems[k]).join('') : '';
  const composerWith = (keys, ph = 'Message', w = 720, extra = {}) => S.composer({ composer: 'c', placeholder: ph, under: keys.length ? line(keys) : '<span style="height:16px"></span>', composerW: w, typed: extra.typed });

  /* ---------- option boards ---------- */
  function s01() {
    return board('S01 The permission scale', 'The owner decided one 4-step scale for how careful a session is: Supervised, Auto-accept edits, Auto, Full access. Every write is recorded on all four. What is open is how it looks in the launch step.', [
      opt('A', 'One segmented track', 'the four steps as one pill track, one line explains the chosen step', false, pair(() => launch('track', 1)), 'One control and one line; the long step names barely fit four segments, and not at all in narrower places.'),
      opt('B', 'Four rows', 'each step a row with its own one-line meaning', true, pair(() => launch('rows', 1)), 'The owner’s pick (23 Nov): every step’s meaning visible at once; the four lines are the exception R-calm-2 allows for a consequential choice.')]);
  }
  function s02() {
    return board('S02 The default step for new sessions', 'Which step a new session starts on (a setting, Settings > Sessions; any session can change it). T3 Code starts on Full access; the plan does not set a default.', [
      opt('A', 'Supervised', 'asks before every change and every command', false, pair(() => launch('rows', 0)), 'Every change is seen before it lands. Also the fallback for a project without a trusted gate.'),
      opt('B', 'Auto-accept edits', 'changes apply when the gate passes; commands ask', true, pair(() => launch('rows', 1)), 'The owner’s pick: fewer stops, the gate between a change and the workspace. A project without a trusted gate falls back to Supervised; onboarding asks for the default; Settings > Sessions changes it.'),
      opt('C', 'Full access', 'nothing asks; every write is still recorded and can be rewound', false, pair(() => launch('rows', 3)), 'T3’s default; fastest, and still journaled, but a first session would run commands without asking.')]);
  }
  function s03() {
    return board('S03 The session inbox', 'The session list sorts by what needs the person: Needs you, Working, Pinned, Recent, Settled, with snooze and settle on hover. Open: sections in the list, or filter chips over one list.', [
      opt('A', 'Sections in the list', 'Needs you first, Settled folded at the end', true, pair(() => clipSide(S.inbox({})), 'padding:0'), 'What needs you is always at the top of the eye; counts on every head.'),
      opt('B', 'Filter chips over one list', 'one sorted list, chips with counts filter it', false, pair(() => clipSide(S.inboxB({})), 'padding:0'), 'Denser and one tap to filter; the needs-you session is a badge among others.')]);
  }
  function s04() {
    const page = (k) => () => `<div style="width:600px">${k === 'a' ? '<div class="row" style="justify-content:space-between;margin:0 0 16px"><span class="set-title" style="margin:0">Sessions</span><span class="seg"><span>This device</span><span class="on">This project</span></span></div>' : `<div class="row" style="gap:10px;margin:0 0 16px"><span class="set-title" style="margin:0">Sessions</span><span class="select" style="color:var(--text)">${I('folder')}boopis project${I('chevron-down')}</span></div>`}
      <div class="card sq">${row('Workspace', '<span class="seg"><span class="on">New worktree</span><span>This checkout</span></span>')}${row('How careful', `<span class="select">Supervised${I('chevron-down')}</span>`)}${row('Enter', '<span class="seg"><span class="on">Steers</span><span>Queues</span></span>')}</div></div>`;
    return board('S04 The settings scope', 'Session settings cascade device → project → the project’s file. Each page shows which level it is setting.', [
      opt('A', 'A segmented control in the page head', 'This device / This project', true, pair(page('a')), 'Says there are two levels at a glance.'),
      opt('B', 'A select beside the title', 'names the project', false, pair(page('b')), 'Scales to several projects; hides that a device level exists.')]);
  }
  function s05() {
    const plusMenu = `<div class="menu sq" style="width:250px"><div class="mt">Quick menu: show under the composer</div>${[['How careful', 1], ['Branch', 1], ['Model and effort', 1], ['Context', 1], ['Cost', 1]].map(([n, on]) => `<div class="mi sq">${on ? `<span style="color:var(--accent-text);display:inline-flex">${I('check')}</span>` : '<span style="width:16px"></span>'}${n}</div>`).join('')}</div>`;
    return board('S05 The composer’s line in a session', 'Pick 07 C puts a line of toggleable items under the composer. A session adds two items (how careful, the branch). Each item is also its control. Toggled from the composer’s + menu and Settings > General.', [
      opt('A', 'How careful, branch, model, cost', 'context shows only near the limit', false, pair(() => composerWith(['perm', 'branch', 'model', 'cost']))),
      opt('B', 'Everything, customizable', 'the default; the quick menu turns items off', true, pair(() => `<div class="row" style="gap:24px;align-items:flex-end">${composerWith(['perm', 'branch', 'model', 'ctx', 'cost'])}${plusMenu}</div>`), 'The owner’s pick. The quick menu (this popup) opens from the composer’s + or from the line itself; under 900 px the branch and the context fold into the quick menu first.'),
      opt('C', 'Off', 'nothing under the composer', false, pair(() => composerWith([])), 'The calmest; the step and the branch move to the session’s details only.')]);
  }
  function s06() {
    const q = `<div class="queue sq" style="width:620px"><div class="q"><span class="n">1</span><span class="grow ell">Also add a short docstring to every function.</span><span class="btn xs ghost">${I('pen')}</span><span class="btn xs ghost">${I('close')}</span><span class="btn xs tint">Send now</span></div></div>`;
    const hint = (a, b) => `<div class="row xs dim" style="gap:6px;justify-content:flex-end;padding:6px 8px 0">Enter ${a}<span class="keys"><span class="kbd">ctrl</span><span class="kbd">Enter</span></span>${b}</div>`;
    return board('S06 Steer or queue by default', 'While a turn runs, a new message either steers it (the agent changes course now) or waits in the engine’s queue. One key does the default, ctrl Enter the opposite.', [
      opt('A', 'Enter steers', 'ctrl Enter queues', false, pair(() => `<div style="width:620px">${q}${composerWith(['perm', 'cost'], 'Steer, or ctrl Enter to queue', 620)}${hint('steers', 'queues')}</div>`), 'The hands-on default: what you type now changes what the agent does now (T3’s default too).'),
      opt('B', 'Enter queues', 'ctrl Enter steers', true, pair(() => `<div style="width:620px">${q}${composerWith(['perm', 'cost'], 'Queue, or ctrl Enter to steer', 620)}${hint('queues', 'steers')}</div>`), 'The owner’s pick: sending normally never interrupts the running turn; steering is the deliberate key.')]);
  }
  function s07() {
    const bar = (tabs, plus) => `<div class="rpanel" style="position:relative;width:520px;height:120px"><div class="rtabs" style="padding-top:14px"><span class="seg">${tabs.map((t, i) => `<span class="${i === 0 ? 'on' : ''}">${t}</span>`).join('')}</span>${plus ? `<span class="ib s" style="width:28px;height:28px">${I('plus')}</span>` : ''}<span class="grow"></span><span class="ib s" style="background:transparent;box-shadow:none">${I('close')}</span></div><div class="xs dim" style="padding:0 16px">${plus ? 'Only the surfaces you opened are tabs; + adds Files, Terminal, PR or a side chat' : 'Opens on Diff when the turn changed files, else on Files'}</div></div>`;
    return board('S07 The right panel’s tabs', 'One panel on the right holds the session’s surfaces. Open: fixed tabs, or tabs only for what was opened (T3’s "+").', [
      opt('A', 'Four fixed tabs', 'Diff, Files, Terminal, PR; a side chat joins while open', true, pair(() => bar(['Diff', 'Files', 'Terminal', 'PR'])), 'Every surface is one click and always in the same place (R-flow-7).'),
      opt('B', 'Opened surfaces only, with +', 'starts with Diff; + adds the others', false, pair(() => bar(['Diff', 'Terminal'], true)), 'Lighter at rest; the place of each tab changes with use.')]);
  }

  /* ---------- component boards ---------- */
  const tool = (state) => {
    const head = `<div class="h">${cm('claude', 14)}<span style="color:var(--icon-quiet);display:inline-flex">${I('pen')}</span><b>modules/dock/dock.css</b><span class="mono" style="color:var(--add)">+12</span><span class="mono" style="color:var(--del)">−3</span><span class="grow"></span>`;
    if (state === 'wait') return `<div class="toolrow sq" style="width:560px">${head}<span class="word owe">Waiting for you</span></div><div class="row" style="justify-content:flex-end;gap:6px;margin-top:6px"><span class="chip out">Decline</span><span class="chip">Always allow this session</span><span class="chip on">Hold to allow once</span></div></div>`;
    if (state === 'ok') return `<div class="toolrow sq" style="width:560px">${head}<span class="xs dim">Allowed once 09:43</span></div></div>`;
    return `<div class="toolrow sq" style="width:560px">${head}<span class="xs" style="color:var(--text-dim)">Declined 09:44</span></div><div class="xs dim" style="margin-top:4px">“Keep the transform, fix the clip instead”</div></div>`;
  };
  const statusL = (p, still) => `<div class="activity" style="margin:0">${mark('claude', 16)}<span class="${still ? '' : 'shimmer'}">${p}</span></div>`;
  function s08() {
    return board('S08 Launch: the launch card, the scale, its item', 'The pieces of the launch step. The card is a settings card of rows; the scale is the segmented track; the same scale is an item of the composer’s line with a menu.', [
      comp('LaunchCard', 'the New session card', pair(states([['REST', launch('rows', 1, 520)], ['A MODEL MISSING', `<div class="card sq" style="width:420px">${row('Model', `<span class="row s" style="gap:8px;color:var(--red-text)">No model is signed in<span class="btn xs">Choose</span></span>`)}</div>`]]))),
      comp('PermissionScale', 'four rows (the owner’s pick S01 B); each state is the chosen row', pair(states(STEPS.map(([n], i) => [n.toUpperCase(), `<div class="card sq" style="width:380px;padding:6px">${rows(i)}</div>`])))),
      comp('The scale as a line item', 'in the composer’s line; its menu changes the step mid-session (S8 line)', pair(states([['ITEM', `<span class="row xs dim" style="gap:4px">${I('shield')}Supervised</span>`], ['MENU', `<div class="menu sq" style="width:250px">${STEPS.map(([n], i) => `<div class="mi sq${i === 1 ? ' hov' : ''}">${i === 0 ? `<span style="color:var(--accent-text);display:inline-flex">${I('check')}</span>` : '<span style="width:16px"></span>'}${n}</div>`).join('')}</div>`]])))]);
  }
  function s09() {
    return board('S09 The turn and its approvals', 'A change waiting in Supervised mode sits on its own tool row; the answers are chips; typing in the composer declines with feedback. The status is the model’s logo (P4).', [
      comp('ToolRow with an inline approval', 'waiting, allowed, declined with feedback; the model’s mark heads every agent card, as a bot’s orb heads its own', pair(states([['WAITING', tool('wait')], ['ALLOWED', tool('ok')], ['DECLINED WITH FEEDBACK', tool('no')]]))),
      comp('Decline with feedback', 'the composer while a change waits', pair(() => S.composer({ composer: 'c', placeholder: 'Send feedback to decline this request', composerW: 620, under: line(['perm', 'cost']) }))),
      comp('The status line, a session', 'working (the logo breathes, the phrase shimmers) and waiting (still)', pair(states([['WORKING', statusL('Running the tests')], ['WAITING', statusL('Waiting for your approval', true)]])), 'An expired Supervised approval (300 s) becomes the AskCard, as a lapsed blank does.')]);
  }
  function s10() {
    const log = (open) => `<div style="width:560px"><div class="worklog" style="margin:0">${I(open ? 'chevron-down' : 'chevron')}Worked for 59s: changed 2 files, ran 1 command</div>${open ? `<div class="steps" style="margin-left:22px">${[['session', 'Read 6 files'], ['pen', 'Changed dock.css, +12 −3'], ['pen', 'Changed engine.ts, +2 −2'], ['terminal', 'Ran pnpm test dock']].map(([i, t]) => `<div class="step">${I(i)}${t}</div>`).join('')}</div>` : ''}</div>`;
    const files = `<div class="files-card sq" style="width:560px"><div class="row s dim" style="gap:6px;margin-bottom:4px">2 changed files<span class="mono" style="color:var(--add)">+14</span><span class="mono" style="color:var(--del)">−5</span><span class="grow"></span><span class="btn xs tint">Open diff</span></div><div class="fl">${I('file')}modules/dock/dock.css<span class="c"><span style="color:var(--add)">+12</span><span style="color:var(--del)">−3</span></span></div><div class="fl">${I('file')}modules/dock/engine.ts<span class="c"><span style="color:var(--add)">+2</span><span style="color:var(--del)">−2</span></span></div></div>`;
    const bar = (h) => `<div class="turnbar" style="width:560px"><span class="xs dim" style="margin-right:6px">Checkpoint 3</span><span class="btn ghost"${h ? ' style="background:var(--hover)"' : ''}>${I('back')}Undo</span><span class="btn ghost">${I('pen')}Edit from here</span><span class="btn ghost">${I('fork')}Fork</span><span class="grow"></span><span class="mono xs dim">sonnet 5.5 0m 59s $0.08</span></div>`;
    return board('S10 Work log, changed files, checkpoint', 'What a finished turn leaves: one line of work, the files it changed, and the checkpoint to rewind from (a journaled ship, undoable, never gated).', [
      comp('WorkLog', 'collapsed (the default) and open', pair(states([['COLLAPSED', log(false)], ['OPEN', log(true)]]))),
      comp('ChangedFilesCard', 'counts, files, Open diff', pair(() => files)),
      comp('CheckpointBar', 'at rest and with Undo hovered', pair(states([['REST', bar(false)], ['UNDO HOVERED', bar(true)]])))]);
  }
  function s11() {
    const qs = (n, edit) => `<div class="queue sq" style="width:560px">${[['Also add a short docstring to every function.'], ['Then update the README’s examples.']].slice(0, n).map(([t], i) => `<div class="q"${edit && i === 0 ? ' style="background:var(--current)"' : ''}><span class="n">${i + 1}</span><span class="grow ell">${edit && i === 0 ? `<span style="border-bottom:1px solid var(--line-field)">${t}</span>` : t}</span><span class="btn xs ghost">${I(edit && i === 0 ? 'check' : 'pen')}</span><span class="btn xs ghost">${I('close')}</span><span class="btn xs tint">Send now</span></div>`).join('')}</div>`;
    return board('S11 Queue and steer', 'Queued messages are the engine’s own queue; steering shows inline in the turn.', [
      comp('QueueStrip', 'one, two, and editing the first', pair(states([['ONE', qs(1)], ['TWO', qs(2)], ['EDITING', qs(2, true)]]))),
      comp('SteerLine', 'a message steering the running turn', pair(() => `<div class="steer" style="width:560px;justify-content:flex-end">${I('forward')}Steer<span class="b user sq" style="font-size:14px;padding:5px 12px">Use type hints on the new functions.</span></div>`))]);
  }
  function s12() {
    const tabs = (on) => `<span class="seg">${['Diff', 'Files', 'Terminal', 'PR'].map((t) => `<span class="${t === on ? 'on' : ''}">${t}</span>`).join('')}</span>`;
    const diff = `<div style="width:560px">${S.diffView(true)}</div>`;
    const term = `<div class="well sq" style="width:520px;color:var(--text);padding:12px 14px"><div class="term"><span class="p">dock-paint $</span> pnpm test dock
<span class="d"> Test Files  3 passed (3)</span>
<span class="p">dock-paint $</span> </div></div>`;
    return board('S12 Right panel, diff, terminal', 'One panel, tabs for the session’s surfaces; the diff’s comment becomes a reference chip in the composer.', [
      comp('RightPanel tab bar', 'each tab chosen; the scope select on Diff', pair(states([['DIFF', `<div class="row" style="gap:10px">${tabs('Diff')}<span class="select" style="color:var(--text)">This turn${I('chevron-down')}</span></div>`], ['TERMINAL', tabs('Terminal')], ['SCOPES', `<div class="menu sq" style="width:220px">${['This turn', 'This session', 'Uncommitted', 'Branch against main'].map((t, i) => `<div class="mi sq${i === 0 ? ' hov' : ''}">${t}</div>`).join('')}</div>`]]))),
      comp('DiffView with an inline comment', 'stacked hunks on add and remove washes', pair(() => diff)),
      comp('ReferenceChip', 'the comment in the composer, on the line (R-inline-1)', pair(() => composerWith(['perm', 'cost'], '', 560, { typed: '<span class="refchip">dock.css:42</span> Keep the comment that explains why the transform clipped.' }))),
      comp('Terminal', 'a mono well in the session’s worktree', pair(() => term))]);
  }
  function s13() {
    const fl = (n, a, d, on = true) => `<div class="fl" style="height:30px">${on ? `<span style="color:var(--accent-text);display:inline-flex">${I('check')}</span>` : '<span style="width:16px"></span>'}${n}<span class="c"><span style="color:var(--add)">+${a}</span><span style="color:var(--del)">−${d}</span></span></div>`;
    const split = (open) => `<div style="position:relative;width:260px;height:${open ? 190 : 40}px"><div class="row" style="gap:0;justify-content:flex-end"><span class="btn sm primary" style="border-radius:999px 0 0 999px">Commit and push</span><span class="btn sm primary" style="border-radius:0 999px 999px 0;padding:0 10px;margin-left:1px">${I('chevron-down')}</span></div>${open ? `<div class="menu sq" style="position:absolute;right:0;top:44px;width:230px"><div class="mi sq">Commit</div><div class="mi sq hov">Commit and push</div><div class="mi sq">Commit, push and open a PR</div><div class="mi sq">Commit on a new branch</div></div>` : ''}</div>`;
    return board('S13 Commit', 'The commit dialog: files, a written message, one stacked action; no agent credits.', [
      comp('File rows', 'chosen (a check) and left out', pair(() => `<div class="card sq" style="width:480px;padding:6px 12px">${fl('modules/dock/dock.css', 12, 3)}${fl('tests/e2e/dock_webkit.py', 9, 0, false)}</div>`)),
      comp('Split primary action', 'at rest and open', pair(states([['REST', split(false)], ['OPEN', split(true)]])))]);
  }
  function s14() {
    const r = (t, sub, end, fam = 'claude', on) => `<div class="sess-row sq${on ? ' on' : ''}" style="width:290px">${cm(fam, 16)}<div class="col grow"><span class="t ell">${t}</span><span class="sub">${sub}</span></div>${end || ''}</div>`;
    return board('S14 Inbox', 'Section heads with counts; row badges; snooze and settle on hover.', [
      comp('Section head', 'with its count; Settled folded', pair(states([['HEAD', '<div class="inbox-h" style="width:290px">Needs you<span class="n">1</span></div>'], ['FOLDED', `<div class="inbox-h" style="width:290px">Settled<span class="n">12</span><span class="grow"></span>${I('chevron')}</div>`]]))),
      comp('Session row', 'approval, blank, working, recent, current', pair(states([['APPROVAL', r("Fix the dock's half paint", '<span class="mono">w32/dock-paint</span>', '<span class="badge2 owe">Approval</span>')], ['BLANK', r('Calc: multiply and divide', '<span class="mono">w32/calc-ops</span>', '<span class="badge2 owe">Blank</span>')], ['WORKING', r('Room mentions', '<span class="mono">w29/mentions</span>', '<span class="dot run"></span>', 'openai')], ['CURRENT', r('Release checklist', '<span class="mono">main</span>', '', 'gemini', true)]]))),
      comp('Hover: snooze and settle', 'the row’s two actions and the snooze menu', pair(states([['HOVER', r('Startup notice for Windows', '<span class="mono">w29/notice</span><span>2h</span>', `<span class="row" style="gap:2px"><span class="ib s" style="width:26px;height:26px;background:transparent;box-shadow:none">${I('clock')}</span><span class="ib s" style="width:26px;height:26px;background:transparent;box-shadow:none">${I('check')}</span></span>`)], ['SNOOZE', `<div class="menu sq" style="width:200px"><div class="mt">Snooze until</div><div class="mi sq hov">In 1 hour</div><div class="mi sq">This evening</div><div class="mi sq">Tomorrow</div><div class="mi sq">When usage resets</div><div class="mi sq">Pick a time…</div></div>`]])))]);
  }
  function s15() {
    return board('S15 Limits, lines and errors', 'One line where something happened, with one way out.', [
      comp('LimitNotice', 'a limit reached; the fallback or the reset', pair(() => `<div class="notice sq" style="width:620px">${cm('claude', 16)}<span class="grow"><span style="color:var(--owe-text)">Claude limited until 14:00</span>, 42 min</span><span class="btn xs ghost">Resume at 14:00</span><span class="btn xs tint">Use gpt 6.1 meanwhile</span></div>`)),
      comp('Context tick', 'in the composer line: low, high, near the limit', pair(states([['LOW', `<span class="row xs dim" style="gap:6px">${ticks(1)}<span class="mono">31k / 200k</span></span>`], ['HIGH', `<span class="row xs dim" style="gap:6px">${ticks(4)}<span class="mono">152k / 200k</span></span>`], ['WEEKLY QUOTA', '<span class="row xs dim" style="gap:6px">Weekly<span class="limitbar" style="width:60px"><i style="width:81%"></i></span><span class="mono">81%</span></span>']]))),
      comp('SettingsLine and the thread’s lines', 'settings changed, after a restart, the engine stopped', pair(states([['SETTINGS', `<div class="sysline" style="margin:0">${I('sliders')}Settings changed: continued with Auto-accept edits<span class="mono" style="margin-left:6px">+$0.04</span></div>`], ['RESTART', `<div class="sysline" style="margin:0">${I('clock')}Continued after a restart</div>`], ['ENGINE', `<div class="sysline act" style="margin:0;color:var(--red-text)">${I('close')}boopis's engine stopped<span class="btn tint">Start it again</span></div>`]])))]);
  }
  function s16() {
    return board('S16 Scope picker', 'At the head of a settings page: which level the page sets. A value set for the project says so on its row.', [
      comp('ScopePicker', 'This device, This project', pair(states([['DEVICE', '<span class="seg"><span class="on">This device</span><span>This project</span></span>'], ['PROJECT', '<span class="seg"><span>This device</span><span class="on">This project</span></span>']]))),
      comp('A row set for the project', 'its value and a quiet "this project" with Reset', pair(() => `<div class="card sq" style="width:520px">${row('How careful<small>Set for this project</small>', `<span class="row" style="gap:8px"><span class="btn xs ghost">Reset</span><span class="select">Auto-accept edits${I('chevron-down')}</span></span>`)}</div>`))]);
  }


  /* S41: the new session's content; the v7 layout stays, the four brand marks change what sits in the canvas */
  function s41() {
    const P = S.nsParts;
    const scr = (t, o) => `<div style="zoom:.6;width:1440px;height:900px;border-radius:16px;overflow:hidden">${S.newSess(Object.assign({ theme: t, chrome: 'a', tile: 'a', composer: 'c', status: 'c' }, o))}</div>`;
    const head = (mk, st) => `<div style="position:relative;height:190px"><div class="ns" style="top:0;bottom:0">${P.brand(mk, st)}<div class="ns-h" style="margin:0">${st === 'nomodel' ? 'Choose a model to start' : 'What’s next for boopis?'}</div></div></div>`;
    const close = (mk) => (t) => `<div class="row" style="gap:28px;justify-content:center;align-items:flex-start">${[['READY, 1:1', 'ready'], ['NO MODEL YET, 1:1', 'nomodel']].map(([c, st]) => `<div style="width:380px"><div class="cap">${c}</div>${head(mk, st)}</div>`).join('')}</div>`;
    const O = [
      ['a', 'The “oo” logomark: the owner’s pick (23 Nov)', 'the two eyes of the wordmark, large; they glance and blink on their own (the logo’s own idle), look at the composer while you type, and sleep while no model is signed in', 'THE OWNER’S PICK', 'Picked. The calmest and most branded: it says boopis, not who answers; the model’s brand stays on the agent’s messages and cards (S09). Motion: DESIGN-SYSTEM.md 20.1.'],
      ['b', 'The boopis orb, alive', 'the main bot’s orb and face: idle blinks, looks at the composer while you type, asleep while no model is signed in', false, 'The most characterful; it makes the session tab feel like boopis’s own bot is doing the work, which is not true: the model is.'],
      ['c', 'The model’s logo, breathing', 'the answering model’s mark in a tile, breathing as the P4 status does; an empty dashed tile while no model is signed in', false, 'Ties the canvas to P4 and to the brand on every agent message (S09); the screen loses boopis’s own face.'],
      ['d', 'The orb wearing the model', 'the boopis orb with the model’s mark on its shoulder (the S09 gutter tile, 24px); the orb sleeps and the tile turns to a + while no model is signed in', false, 'Was the recommendation, not chosen. Both facts at once: boopis is the place, the model is who answers. The tile is the same component as the brand tile in the thread (S09), so it costs nothing new; a model change swaps the tile with a 120ms fade.']];
    return board('S41 The new session', 'The owner kept the v7 layout (title pill, search hint, details, the composer and its line, the dock, the sidebar) and asked for better content in the empty canvas: a brand mark with character, the launch choices quiet and compact, the sessions waiting on you, the no-model state as a kind inline action, and the usage notice above the composer from the existing Notice. Only the canvas changes between options. The launch row is the same selector item the composer’s line uses; while a session has not started, those items sit up here and the line under the composer only names the keys; when the session starts they settle into the line (200ms, --ease-sharp).', [
      ...O.map(([k, n, sub, rec, note]) => opt(k.toUpperCase(), n, sub, rec, pair((t) => scr(t, { mk: k, usage: 1 })) + `<div style="height:14px"></div>` + pair(close(k)), note)),
      comp('What the canvas holds', 'the same in every option; shown with A, the pick', pair((t) => `<div class="col" style="gap:24px;align-items:flex-start">${[['THE PERMISSION SELECTOR OPEN: THE FOUR ROWS (S01 B)', `<div style="position:relative;height:360px;width:600px"><div class="ns" style="top:0;bottom:auto;justify-content:flex-start">${P.launch('ready', true)}</div></div>`], ['NO MODEL: A KIND INLINE ACTION, NOT A RED ROW', `<div style="width:500px">${P.noModel()}</div>`]].map(([c, h]) => `<div><div class="cap">${c}</div>${h}</div>`).join('')}</div>`) + `<div style="height:14px"></div>` + pair((t) => `<div class="col" style="gap:24px;align-items:flex-start">${[['WAITING ON YOU: THE INBOX ROW, ONE LINE', `<div style="width:520px">${P.waiting()}</div>`], ['THE USAGE NOTICE: THE NOTICE COMPONENT (S15)', `<div style="width:620px">${P.usage}</div>`]].map(([c, h]) => `<div><div class="cap">${c}</div>${h}</div>`).join('')}</div>`), 'Every piece is an existing kit component: the selector item, the menu with the S01 rows, the Block, the inbox row (one-line variant), the Notice.')]);
  }

  window.SBOARDS = { s41, s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15, s16 };
})();
