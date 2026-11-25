/* S41: the new session's content (the empty canvas above the composer). The v7 layout stays as it is: title pill, search hint,
   details button, the composer with its line, the dock, the sidebar. Only what sits in the canvas changes between options. */
(function () {
  const { I, mark, orb } = window.V7;
  const S = window.SCREENS;
  const sh = S.sessShell, comp = S.sessComp, title = S.sessTitle;
  const cm = (f, s = 14) => mark(f, s);
  const ticks = (n) => `<span class="ticks">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const STEPS = [['Supervised', 'Asks before every change and every command.'], ['Auto-accept edits', 'Changes apply when the gate passes; commands ask.'], ['Auto', 'Only your approval rules ask.'], ['Full access', 'Nothing asks. Every write is still recorded.']];

  /* the brand mark: A the "oo" logomark, B the boopis orb, C the model's logo breathing, D the orb wearing the model */
  function brand(k, st) {
    const nm = st === 'nomodel';
    if (k === 'a') return `<span class="ns-mark"><boopis-logo mark${nm ? ' state="sleeping"' : ''} style="font-size:44px;color:var(--text-strong)"></boopis-logo></span>`;
    if (k === 'b') return `<span class="ns-mark">${orb('boopis', 64, { state: nm ? 'sleeping' : 'idle', surface: 'var(--bg-2)' })}</span>`;
    if (k === 'c') return nm ? `<span class="ns-mark"><span class="ns-tile empty"></span></span>` : `<span class="ns-mark"><span class="ns-tile">${mark('claude', 30, 'pulse')}</span></span>`;
    return `<span class="ns-mark">${orb('boopis', 64, { state: nm ? 'sleeping' : 'idle', surface: 'var(--bg-2)' })}<span class="ns-badge">${nm ? I('plus') : mark('claude', 13)}</span></span>`;
  }

  /* the launch row: quiet inline selectors; the permission one opens the four rows (S01 B) */
  function launch(st, open) {
    const sel = (inner, ex = '') => `<span class="select ns-sel${ex}">${inner}${I('chevron-down')}</span>`;
    const model = st === 'nomodel' ? `<span class="select ns-sel ns-need">${I('plus')}Choose a model</span>` : sel(`${cm('claude', 14)}sonnet 5.5`);
    const menu = open ? `<div class="menu sq ns-perm"><div class="mt">How careful</div>${STEPS.map(([n, d], i) => `<div class="optrow sq${i === 1 ? ' on' : ''}"><span class="ring"></span><div class="col"><span class="m">${n}</span><span class="xs dim">${d}</span></div></div>`).join('')}<div class="sepr"></div><div class="xs dim" style="padding:6px 12px 4px">The default for new sessions is in Settings, Sessions.</div></div>` : '';
    return `<div class="ns-launch">${sel(`${I('folder')}boopis`)}${sel(`${I('fork')}New worktree`)}${model}${st === 'nomodel' ? '' : sel(`${ticks(3)}Default`)}<span style="position:relative;display:inline-flex">${sel(`${I('shield')}Auto-accept edits`, open ? ' open' : '')}${menu}</span></div>`;
  }

  /* sessions waiting on you: the inbox row, compact (one line) */
  const waiting = () => {
    const r = (lead, t, sub, badge) => `<div class="sess-row one sq">${lead}<span class="t ell">${t}</span><span class="sub ell">${sub}</span><span class="grow"></span><span class="badge2 owe">${badge}</span></div>`;
    return `<div class="ns-wait"><div class="inbox-h">Waiting on you<span class="n">2</span></div>
      ${r(cm('claude', 16), "Fix the dock's half paint", 'boopis, w32/dock-paint', 'Approval')}${r(cm('openai', 16), 'Store: de-duplicate items', 'boopis, main', 'Question')}</div>`;
  };

  /* the no-model state, said kindly, inside the content */
  const noModel = () => `<div class="ns-hello sq"><div class="s">boopis needs a model to think with. Sign in once and every session can use it.</div>
    <div class="row" style="gap:6px;justify-content:center"><span class="btn xs">${cm('claude', 14)}Claude</span><span class="btn xs">${cm('openai', 14)}ChatGPT</span><span class="btn xs">${cm('gemini', 14)}Gemini</span><span class="btn xs ghost">More</span></div></div>`;

  const usage = `<div class="notice sq" style="margin-bottom:8px">${I('clock')}<span class="grow"><span style="color:var(--text)">Approaching the weekly limit</span>, 81% used, resets Wed 09:00</span><span class="btn xs ghost">Get more usage</span><span class="ib s">${I('close')}</span></div>`;

  /* o.mk: a/b/c/d; o.st: ready | nomodel | noproject; o.open: the permission rows open; o.usage: the notice above the composer */
  function newSess(o) {
    const k = o.mk || 'a', st = o.st || 'ready'; /* the owner's pick: A, the oo logomark */
    const head = st === 'noproject' ? 'Add a folder to start' : 'What’s next for boopis?';
    const body = st === 'noproject'
      ? `<div class="row" style="gap:8px;justify-content:center"><span class="btn primary">${I('folder')}Add a project</span><span class="btn">Import sessions</span></div>`
      : `${launch(st, o.open)}${st === 'nomodel' ? noModel() : ''}${waiting()}`;
    const inner = `<div class="ns" data-mk="${k}">${brand(k, st)}<div class="ns-h">${head}</div>${body}</div>`;
    const ph = st === 'nomodel' ? 'Choose a model to start' : st === 'noproject' ? 'Add a folder to start' : 'What should change? @ files, $ skills, / commands';
    const under = '<span>Enter starts the session</span><span class="grow"></span><span>ctrl Enter starts it in the background</span>';
    return sh(o, '', comp(o, ph, { under }), { mainInner: inner, title: title(st === 'noproject' ? 'Sessions' : 'New session'), above: o.usage ? usage : '', side: st === 'noproject' ? S.emptyInbox : undefined, overlay: o.overlay });
  }

  Object.assign(window.SCREENS, { newSess, nsParts: { brand, launch, noModel, waiting, usage } });
})();
