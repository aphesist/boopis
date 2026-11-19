/* hypotaxis v6 · dock (owner: dock agent)

   One black slab flush to the window's bottom edge. Its outline is ONE SVG path rebuilt every frame from
   the sprung width and height, so the concave flares follow every morph.

   Content lives in "views" (min · norm · exp · card · edit) anchored to the slab's bottom centre.
   An element that exists in two views carries the same data-k key in both; on any state change the
   dock measures every keyed element before and after and springs it from where it was to where it
   belongs (FLIP with springs that keep their velocity when interrupted). Live <orb-avatar> elements
   are re-parented into the visible slot, never re-created, so an orb keeps blinking while it travels.
   Content that has no counterpart fades (exits in 120 ms, entrances in 220 ms). Nothing is clipped.

   Built on the shared library (components/components.js, HX.ui): orbs, bot states, icons, buttons, ladder,
   capacity, measure, page dots, switches, empty states, tooltips, announcements, and the canonical cards for
   approvals and the open question (HX.ui.card, dock ground). The dock keeps only what is its own: the slab, the
   views and their travel, magnification, paging, the arrange view.

   Orbs (owner, v10): one click opens the bot's session in the dock: its last messages, its open card (the
   canonical card; approvals hold for one second) and the library composer, so you can answer, message or approve
   without leaving the tab you are on. The same orb again, Esc or the close button returns to the row; another orb
   switches the session. A double-click (or mod+Enter) opens the full chat in the Bots tab.
   Pages: a quiet nub of page dots in the slab's foot, between Arrange and Minimise. No tab, no side lanes.
   Motion: the slab and its content change in the same frame and nothing leaves the slab while it travels; under
   reduced motion every size change is instant (entrances fade in 140ms), nothing slides, nothing overshoots.

   Registers as HX module "dock". Listens: hx:layout, hx:state, hx:attention, hx:bot-state, hx:bot-select,
   hx:approval. Emits: hx:bot-select, hx:new-bot, hx:approval, hx:blank-answer, hx:bot-state, hx:bot-message,
   hx:run-stop, hx:setting, hx:schedule-run, hx:open-panel, hx:attention, hx:dock. */
(() => {
  'use strict';
  if (window.hxDock) return;

  /* ------------------------------------------------------------------ basics */
  const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = RMQ.matches;
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const detailOf = a => (a && typeof Event !== 'undefined' && a instanceof Event ? a.detail : a) || {};
  const rendered = el => el.getClientRects().length > 0;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  const PREF_KEY = 'hx.dock.v6';
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /* springs: near-critical damping (no visible overshoot); interrupted springs keep their velocity */
  const spring = (x, k, z = 1, eps = .05) => ({ x, v: 0, t: x, k, c: 2 * z * Math.sqrt(k), eps });
  const stepS = (s, h) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * h; s.x += s.v * h; };
  const atRest = s => Math.abs(s.x - s.t) < s.eps && Math.abs(s.v) < s.eps * 4;
  const snapS = (s, t) => { if (t !== undefined) s.t = t; s.x = s.t; s.v = 0; };

  /* morph springs: critically damped (no overshoot); ω ≈ 22 settles in ≈ 300ms, the shell's --dur-3.
     Travel along the centre line is never a JS spring: it rides --hx-center-x or a CSS transition. */
  const K_SLAB = 480, K_FLIP = 480, K_SINK = 400, K_SLIDE = 440, K_DOT = 520;
  /* the slab (LAYOUT.md §1): top corners and concave flares share --r-l (14px by default; the theme
     customizer's corner setting changes it) */
  let R_TOP = 14, FLARE = 14;
  /* a hovered row looks toward the pointer through a clamp (about 20 degrees): no face turns away to its rim */
  const LOOK_X = 72, LOOK_Y = 40;
  const LOG_N = 4;                        /* messages a dock session shows */
  const MOD = isMac ? 'Meta' : 'Control';
  function readRadius() {
    const r = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-l'));
    if (r > 0) { R_TOP = r; FLARE = r; }
  }
  const MAG = 1.42, MAG_ADD = 1.22, SIG = 58;
  /* "Grow bots on hover" (owner, v11; HX.state.orbGrow, default on): the hovered or focused orb grows. With motion the
     row magnifies as before (neighbours shift smoothly, the slab follows on its spring); a focused orb, and under
     reduced motion a hovered one, grows alone (neighbours stay put, the slab keeps its width), at once under reduced
     motion and over about 100ms otherwise, never with a bounce. Off: nothing grows; the switcher keeps its ring. */
  const GROW = 1.22, GROW_ADD = 1.1;
  const ORB_RENDER = 80;                 /* orbs render at 80px and are scaled down: crisp when magnified */

  /* ------------------------------------------------------------------ the library */
  const ui = () => window.HX.ui;
  /* drawn corners (DESIGN-SYSTEM.md §8): the dock's own surfaces take the library's continuous corner (cards and
     their rows are the library's already) */
  if (window.HX && window.HX.ui && window.HX.ui.squircle) {
    window.HX.ui.squircle.auto('.dk-add, .dk-run-open, .dk-sched-row, .dk-sched-what');
    window.HX.ui.squircle.auto('.dk-tile', { mode: 'surface' });
  }
  const IC = { plus: 'plus', close: 'close', stop: 'stop', sliders: 'sliders', down: 'chevron-down', left: 'back', right: 'forward' };
  const icon = (n, o) => ui().icon(IC[n] || n, o);

  /* ------------------------------------------------------------------ state */
  const PAGE_NAME = { bots: 'Bots', run: 'Run', wait: 'Needs you', sched: 'Scheduled', ctx: 'Context', edit: 'Arrange' };
  const PAGE_IDS = ['bots', 'run', 'wait', 'sched', 'ctx'];
  const DEFAULT_PAGES = [{ id: 'bots', on: true }, { id: 'run', on: true }, { id: 'wait', on: true }, { id: 'sched', on: true }, { id: 'ctx', on: false }];
  const LAST = { /* fallback last messages for bots without a thread in HX_DATA (proposed: bots[].last) */
    kai: ['14:21', 'Changelog for 0.23 is drafted. Two entries need your wording before I post it.'],
    iris: ['13:55', 'Checked the pricing page at three widths. Two spacing issues, both in the plan table.'],
    hex: ['09:12', 'Asleep until the next push to main. The last scan found nothing new.'],
    sol: ['yesterday', 'The night shift starts at 02:00. Your digest will be ready by 08:00.'],
    noct: ['07:30', 'Quiet night. No pages and no alerts since 23:00.'],
    terra: ['14:30', 'Planning the invoices_v2 backfill. I will ask before anything writes.'],
    nimbus: ['14:15', 'Inbox sorted. Three drafts are waiting in your voice.'],
    vox: ['14:26', 'Collecting merged pull requests for the release notes.'],
    moss: ['14:29', 'invoice.test.ts fails only after midnight UTC. Writing a fix now.']
  };
  const SCHED = [ /* proposed: HX_DATA.schedules */
    { id: 'nimbus-triage', bot: 'nimbus', what: 'inbox triage', when: 'every hour at :15', next: 'in 7 min' },
    { id: 'moss-flaky', bot: 'moss', what: 'rerun flaky tests', when: 'every 6 hours', next: 'in 2 h' },
    { id: 'sol-digest', bot: 'sol', what: 'morning digest', when: 'nightly at 02:00', next: 'in 11 h' },
    { id: 'kai-changelog', bot: 'kai', what: 'changelog draft', when: 'fridays at 17:00', next: 'friday' },
    { id: 'atlas-review', bot: 'atlas', what: 'review open pull requests', when: 'mondays at 09:00', next: 'monday' }
  ];

  const S = {
    mode: 'normal',        /* off · minimal · normal · expanded · edit */
    page: 'bots',
    card: null, cardFrom: 'normal',
    pages: DEFAULT_PAGES.map(p => ({ ...p })),
    bots: [], waits: [], sched: [], run: null, ctx: null,
    ext: {}, colWidth: null, rowIdx: 0, restore: 'normal', hover: false, hoverT: 0, grow: true
  };
  let HXr = null, root, shapeEl, pathEl, stageEl, footEl, dotsEl, downBtn;
  const pageEls = {};
  const orbs = new Map();
  let curView = null, mounted = false, layoutSeen = false, offSeq = 0;

  const D = () => (HXr && HXr.data) || window.HX_DATA || {};
  const botById = id => S.bots.find(b => b.id === id);
  const shownPages = () => S.pages.filter(p => p.on).map(p => p.id);
  const emit = (type, detail) => { try { if (HXr && HXr.emit) HXr.emit(type, detail); } catch (e) { console.error(e); } };
  const announce = msg => { try { ui().announce(msg); } catch (e) { /* the library is required at mount */ } };
  const attCount = () => {
    let ext = 0;
    for (const [src, n] of Object.entries(S.ext)) if (src !== 'dock') ext += +n || 0;
    return Math.max(S.waits.length, ext);
  };

  function initData() {
    const d = D();
    S.bots = (d.bots || []).map(b => ({ ...b, paused: false }));
    const nina = d.botThreads && d.botThreads.nina;
    const ask = nina && nina.find(m => m.card === 'approval');
    S.waits = [];
    if (ask) {
      const a = ask.data || {};
      S.waits.push({
        id: 'approve-deploy', kind: 'approval', bot: 'nina', who: 'nina', title: a.title || 'deploy to staging',
        data: { from: 'nina', title: a.title || 'deploy to staging', quote: a.quote || '', item: a.item || [], meta: a.meta || '' }
      });
    }
    const conv = (d.conversation || []).find(m => m.blank);
    if (conv) {
      S.waits.push({
        id: 'blank-alias', kind: 'blank', who: 'proration drift', title: 'keep prorate as a deprecated alias?',
        data: { model: conv.model, question: conv.blank.question, short: 'Keep prorate as a deprecated alias?', options: conv.blank.options || [] }
      });
    }
    const g = d.governance || {}, run = (d.sessions || []).find(s => s.running) || {}, c0 = (d.conversation || []).find(m => m.role === 'assistant') || {};
    const parseT = t => { const m = /(\d+)m\s*(\d+)s/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };
    const money = v => parseFloat(String(v || '0').replace(/[^0-9.]/g, '')) || 0;
    S.run = {
      title: run.title || 'current run', model: (g.ladder && g.ladder[g.current] && g.ladder[g.current][0]) || 'sonnet 5.5',
      step: c0.steps || 6, escalated: c0.escalated || 0, elapsed: parseT(c0.time) || 222,
      cost: money(g.spent || c0.cost), cap: money(g.cap) || .6, ladder: g.ladder || [], current: g.current || 0,
      tokens: (d.ledger && d.ledger.tokens) || '', trips: (d.ledger && d.ledger.trips) || 0,
      governed: (g.mode || 'governed') === 'governed', network: !/network off/.test((d.environment && d.environment.sandbox) || 'network off'),
      stopped: false
    };
    S.sched = SCHED.filter(s => botById(s.bot)).map(s => ({ ...s, paused: false }));
    S.ctx = d.context || { used: 0, total: 1, parts: [] };
    const saved = store.get(PREF_KEY);
    if (saved && Array.isArray(saved.pages)) {
      const known = saved.pages.filter(p => PAGE_IDS.includes(p.id));
      for (const id of PAGE_IDS) if (!known.find(p => p.id === id)) known.push({ id, on: false });
      if (known.some(p => p.on)) S.pages = known;
    }
    if (saved && saved.minimal) S.restore = 'minimal';
    if (!shownPages().includes(S.page)) S.page = shownPages()[0];
  }
  const savePrefs = () => store.set(PREF_KEY, { pages: S.pages, minimal: S.mode === 'minimal' || (S.mode === 'off' && S.restore === 'minimal') });

  /* ------------------------------------------------------------------ bots + orbs (HX.ui.botState, HX.ui.orb) */
  const st = b => ui().botState(b);
  const phrase = b => st(b).word;
  const botLabel = b => ui().botLabel(b);
  const hasAtt = b => st(b).attention;
  /* one library orb per bot; it renders at 80 so magnification stays crisp; the wrapper is what travels */
  const makeOrb = b => ui().orb(b, { size: 40, render: 80, flag: true });
  const av = id => { const w = orbs.get(id); return w ? w.querySelector('orb-avatar') : null; };
  const miniOrb = (b, size) => ui().html.orb(b, { size, render: size * 2 });
  const slot = b => `<span class="dk-orb" data-k="orb:${b.id}" data-slot="orb:${b.id}"></span>`;

  function relocateLive() {
    for (const b of S.bots) {
      const w = orbs.get(b.id); if (!w) continue;
      const target = $$(`[data-slot="orb:${b.id}"]`, root).find(x => !x.closest('.is-leaving') && rendered(x));
      if (!target) continue;
      if (w.parentNode !== target) target.prepend(w);
      const o = parseFloat(getComputedStyle(target).getPropertyValue('--o'));
      if (o > 0) w.style.setProperty('--o', String(o));
    }
  }
  /* reduced motion reduces and never freezes (HX.ui.orb lowers the jelly, HX.ui.glance moves the eyes). The dock
     stills an orb only on a page that is not showing and in the 10px minimal pill; the library's own still orbs
     (16px and under) are left as they are. */
  function setOrbLife() {
    for (const b of S.bots) {
      const w = orbs.get(b.id), orb = av(b.id); if (!orb) continue;
      const slotEl = w.parentElement;
      const live = S.mode !== 'off' && S.mode !== 'minimal' && S.page === 'bots' && !!slotEl && rendered(slotEl) && !slotEl.closest('.is-leaving');
      if (orb.hasAttribute('static') === live) live ? orb.removeAttribute('static') : orb.setAttribute('static', '');
      if (orb.getAttribute('mode') !== 'drift') orb.setAttribute('mode', 'drift');
      if (!live && typeof orb.lookAt === 'function') orb.lookAt();
    }
    for (const o of $$('.dk-mini-orb orb-avatar[data-glance]', root)) {
      const vis = S.mode !== 'off' && rendered(o) && !o.closest('.is-leaving');
      if (o.hasAttribute('static') === vis) vis ? o.removeAttribute('static') : o.setAttribute('static', '');
    }
  }
  /* orb2's own follow mode turns a face up to 67 degrees toward a pointer far along the row: the eyes slide to the
     rim and the body reads as a crescent (the "moon" orbs). The dock aims each orb at a point no more than
     LOOK_X / LOOK_Y away instead, and only with motion allowed; under reduced motion a hovered orb just listens. */
  let looking = false;
  function lookRow(px, py) {
    const on = px != null && !reduce && S.mode === 'normal' && S.page === 'bots';
    if (!on && !looking) return;
    looking = on;
    for (const b of S.bots) {
      const o = av(b.id), w = orbs.get(b.id); if (!o || !w || typeof o.lookAt !== 'function') continue;
      if (!on || o.hasAttribute('static')) { o.lookAt(); continue; }
      const r = w.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      o.lookAt(cx + LOOK_X * Math.tanh((px - cx) / 180), cy + LOOK_Y * Math.tanh((py - cy) / 120));
    }
  }
  function refreshBot(b) {
    const s = st(b), w = orbs.get(b.id), orb = av(b.id);
    const talking = composerEls.has(b.id) && composerEls.get(b.id).listening;   /* while you talk to it, it listens */
    if (orb && !talking && orb.getAttribute('reaction') !== s.reaction) orb.setAttribute('reaction', s.reaction);
    if (w) {
      const f = w.querySelector('.ui-dot--flag');
      if (s.attention && !f) w.insertAdjacentHTML('beforeend', ui().html.dot('flag'));
      if (!s.attention && f) f.remove();
    }
    for (const el of $$(`[data-bot-label="${b.id}"]`, root)) {
      el.setAttribute('aria-label', botLabel(b));
      if (el.hasAttribute('data-tip')) {
        s.key === 'idle' ? el.removeAttribute('data-tip-state') : el.setAttribute('data-tip-state', s.word);
        s.attention ? el.setAttribute('data-tip-tone', 'attention') : el.removeAttribute('data-tip-tone');
      }
    }
    for (const el of $$(`[data-bot-phrase="${b.id}"]`, root)) el.textContent = s.word;
  }

  /* ------------------------------------------------------------------ formatting */
  const fmtDur = s => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  const fmtCost = v => '$' + v.toFixed(2);
  const kfmt = n => n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
  const mono = t => `<span class="dk-mono">${esc(t)}</span>`;
  /* the model with its provider's mark (mono), through the library's one primitive */
  const runModel = () => (ui().html.model ? ui().html.model(S.run.model, { size: 14 }) : mono(S.run.model));
  const runSub = () => S.run.stopped ? 'Stopped by you' : `${runModel()} ${S.run.escalated ? `escalated ${S.run.escalated === 1 ? 'once' : S.run.escalated + ' times'}` : 'on the first try'}`;
  /* the run's spend: the library's running total and its row of dots (dots, not bars) */
  const costHTML = () => ui().html.capacity(fmtCost(S.run.cost), fmtCost(S.run.cap), { label: `${fmtCost(S.run.cost)} of the ${fmtCost(S.run.cap)} cap spent` });
  const meterHTML = () => ui().html.measure({ used: S.run.cost, total: S.run.cap || 1, dots: 10, variant: 'row', label: 'Cost cap' });
  /* the ladder (line at rest, list expanded); finish() keys its stations run:t0… so they travel between views */
  const ladderLine = () => `<span class="dk-ladder" data-tip="Model ladder: ${esc(S.run.model)}" data-tip-pos="top">${ui().html.ladder({ stations: S.run.ladder, current: S.run.current, ground: 'var(--dock-bg)' })}</span>`;
  const ladderList = () => ui().html.ladder({ variant: 'list', ground: 'var(--dock-bg)', current: S.run.current,
    stations: S.run.ladder.map(([m, rule], i) => [m, i === S.run.current && !S.run.stopped ? `${rule}, running` : rule]) });
  const pillBtn = label => `<button class="dk-pillbtn" data-act="restore" aria-label="${esc(label)}"></button>`;
  const pillAtt = () => attCount() ? `<span class="dk-att" data-k="att:pill">${ui().html.dot('attention')}</span>` : '';
  const needLabel = n => `${n} ${n === 1 ? 'needs' : 'need'} you`;
  const dotFor = b => { const s = st(b); return s.attention ? ui().html.dot('attention') : s.busy ? ui().html.dot('run') : ''; };
  const emptyWait = () => `<div class="dk-empty" data-e>${ui().html.empty({ title: 'Nothing needs you', text: 'Approvals and open questions from bots and runs land here.' })}</div>`;
  const btn = (label, act, o = {}) => ui().html.button(Object.assign({ label, attrs: Object.assign({ 'data-act': act }, o.attrs || {}) }, o, { attrs: Object.assign({ 'data-act': act }, o.attrs || {}) }));

  /* long names (a bot can be "chief of staff for the billing migration"): a tooltip shows a clipped name, the
     accessible name keeps it whole; rows and the session head ellipsise in CSS */
  const clip = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
  const TIP_CH = 26;                       /* a tooltip's label stays within about 280px with its state and key */
  const tipOf = b => { const n = clip(b.name, 18), room = TIP_CH - n.length - 2; return room >= 8 ? `${n}, ${clip(b.role, room)}` : n; };

  /* ------------------------------------------------------------------ view templates */
  const V = {
    'bots:min': () => {
      const n = attCount();
      return `${pillBtn('Show the dock' + (n ? ', ' + needLabel(n) : ''))}<span class="dk-mini" aria-hidden="true">${S.bots.map(b => slot(b)).join('')}</span>${pillAtt()}`;
    },
    'bots:norm': () => `<div class="dk-row" role="toolbar" aria-label="Bots" aria-orientation="horizontal">${S.bots.map((b, i) => { const s = st(b); return (
      `<button class="dk-bot" data-act="session" data-id="${b.id}" data-bot-label="${b.id}" aria-label="${esc(botLabel(b))}" aria-describedby="dk-bot-hint" aria-keyshortcuts="Enter ${MOD}+Enter" tabindex="${i === S.rowIdx ? 0 : -1}"` +
      ` data-tip="${esc(tipOf(b))}"${s.key === 'idle' ? '' : ` data-tip-state="${esc(s.word)}"`}${s.attention ? ' data-tip-tone="attention"' : ''} data-kbd="enter" data-tip-pos="top">${slot(b)}</button>`); }).join('')}` +
      `<button class="dk-add" data-act="new-bot" aria-label="New bot" data-tip="New bot" data-tip-pos="top" tabindex="${S.rowIdx === S.bots.length ? 0 : -1}"><span data-k="add">${icon('plus')}</span></button></div>`,
    'bots:exp': () => `<ul class="dk-roster" aria-label="All bots">${S.bots.map((b, i) => ui().html.row({ title: b.name, sub: phrase(b), lead: slot(b), tabindex: i === S.rowIdx ? '0' : '-1',
        attrs: { 'data-act': 'session', 'data-id': b.id, 'data-bot-label': b.id, 'aria-label': botLabel(b), 'aria-describedby': 'dk-bot-hint' } })).join('')}` +
      ui().html.row({ title: 'New bot', sub: 'Set one up', tabindex: S.rowIdx === S.bots.length ? '0' : '-1', lead: `<span class="dk-add-ring"><span class="dk-add-ring-o" data-e></span><span data-k="add">${icon('plus')}</span></span>`, attrs: { 'data-act': 'new-bot' } }) + '</ul>',
    /* the bot's session: its last messages, its open cards, the library composer, and the other bots to switch to */
    'bots:card': () => {
      const b = botById(S.card); if (!b) return '';
      const s = st(b);
      return `<div class="dk-card-head">${slot(b)}
        <div class="dk-card-who" data-e><div class="dk-card-line"><span class="dk-card-name" id="dk-card-name" title="${esc(b.name)}">${esc(b.name)}</span>` +
        `<span class="dk-card-state"${s.attention ? ' data-tone="attention"' : ''}>${sessState(b)}</span></div><div class="dk-card-role">${esc(b.role)}</div></div>` +
        `<span class="dk-card-acts" data-e>` +
        ui().html.iconButton({ icon: 'bots', label: `Open the full chat with ${b.name}`, tip: 'Full chat', keys: 'mod+Enter', size: 's', tipPos: 'top', attrs: { 'data-act': 'open-chat', 'data-id': b.id } }) +
        ui().html.iconButton({ icon: 'close', label: `Close the session with ${b.name}`, tip: 'Close', keys: 'Esc', size: 's', tipPos: 'top', attrs: { 'data-act': 'close-card' } }) + `</span></div>
        <div class="dk-sess-log" data-e data-margin="off" role="log" tabindex="0" aria-label="Recent messages with ${esc(b.name)}">${logHTML(b)}</div>
        ${S.waits.filter(w => w.bot === b.id).map(w => `<div class="dk-ask" data-e data-card="${w.id}" data-size="compact"></div>`).join('')}
        <div class="dk-sess-composer" data-e data-composer="${b.id}"></div>
        <div class="dk-strip" role="group" aria-label="Switch session">${S.bots.map(x => x.id === b.id
          ? `<button class="ui-orb-btn dk-strip-bot" data-act="close-card" aria-current="true" tabindex="0" aria-label="${esc(x.name)}, open; close the session" data-tip="${esc(clip(x.name, 18))}" data-tip-pos="top" data-e>${ui().html.orb(x, { size: 18, render: 36 })}</button>`   /* the live orb sits in the head; the switcher shows a copy inside its selection ring */
          : `<button class="ui-orb-btn dk-strip-bot" data-act="session" data-id="${x.id}" data-bot-label="${x.id}" tabindex="-1" aria-label="${esc(botLabel(x))}" data-tip="${esc(clip(x.name, 18))}" data-tip-pos="top">${slot(x)}</button>`).join('')}</div>`;
    },

    'run:min': () => `${pillBtn(`Show the dock, run ${S.run.stopped ? 'stopped' : 'in progress'}, ${fmtDur(S.run.elapsed)}`)}${ladderLine()}<span class="dk-time" data-k="run:time" data-run-time>${fmtDur(S.run.elapsed)}</span><span data-k="run:cost" data-run-cost>${costHTML()}</span>${pillAtt()}`,
    'run:norm': () => `${ladderLine()}
      <button class="dk-run-open" data-act="expand" aria-label="Show run details" aria-expanded="false"><span class="dk-run-title" data-k="run:title">${esc(S.run.title)}</span><span class="dk-run-model" data-k="run:model">${runSub()}</span></button>
      <span class="dk-time" data-k="run:time" data-run-time aria-label="Elapsed">${fmtDur(S.run.elapsed)}</span>
      <span class="dk-cost"><span data-k="run:cost" data-run-cost>${costHTML()}</span><span data-k="run:meter" data-run-meter>${meterHTML()}</span></span>
      ${stopBtn()}`,
    'run:exp': () => `<div class="dk-runx-head"><div><div class="dk-run-title" data-k="run:title">${esc(S.run.title)}</div><div class="dk-run-model" data-k="run:model">${runSub()}</div></div>${stopBtn()}</div>
      <div class="dk-ladderx">${ladderList()}</div>
      <hr class="dk-rule" data-e><div class="dk-runx-spend"><span class="dk-time" data-k="run:time" data-run-time>${fmtDur(S.run.elapsed)}</span><span data-k="run:cost" data-run-cost>${costHTML()}</span><span data-k="run:meter" data-run-meter>${meterHTML()}</span>
        <span class="dk-runx-more" data-e>${esc(S.run.tokens)} tokens, ${S.run.trips} round trips, step ${S.run.step}</span></div>
      <div class="dk-settings" data-e>` +
        ui().html.setRow({ label: 'Governed', hint: S.run.governed ? 'The ladder picks the model' : `Stays on ${S.run.model}`, for: 'dk-sw-governed', control: ui().html.switch({ id: 'dk-sw-governed', checked: S.run.governed }) }) +
        ui().html.setRow({ label: 'Sandbox network', for: 'dk-sw-network', control: ui().html.switch({ id: 'dk-sw-network', checked: S.run.network }) }) + '</div>',

    'wait:min': () => {
      const n = S.waits.length;
      return n ? `${pillBtn('Show the dock, ' + needLabel(n))}<span class="dk-ui" data-e>${needLabel(n)}</span><span class="dk-att" data-k="att:pill">${ui().html.dot('attention')}</span>`
        : `${pillBtn('Show the dock, nothing needs you')}<span class="dk-dim dk-ui" data-e>All clear</span>`;
    },
    'wait:norm': () => S.waits.length ? '<div class="dk-cards" data-cards="mini"></div>' : emptyWait(),
    'wait:exp': () => S.waits.length ? '<div class="dk-cards" data-cards="compact"></div>' : emptyWait(),

    'sched:min': () => {
      const s = S.sched.find(x => !x.paused); const b = s && botById(s.bot);
      return s ? `${pillBtn(`Show the dock, next scheduled run: ${b.name}, ${s.next}`)}<span class="dk-mini-orb" data-k="s:orb:${s.id}">${miniOrb(b, 16)}</span><span data-k="s:bot:${s.id}">${esc(b.name)}</span><span class="dk-sched-when" data-k="s:next:${s.id}"><b>${esc(s.next)}</b></span>${pillAtt()}`
        : `${pillBtn('Show the dock, no scheduled runs')}<span class="dk-dim dk-ui" data-e>Nothing scheduled</span>`;
    },
    'sched:norm': () => `<ul class="dk-sched">${S.sched.filter(s => !s.paused).slice(0, 2).map(s => { const b = botById(s.bot); return `<li class="dk-sched-row">
        <span class="dk-mini-orb" data-k="s:orb:${s.id}">${miniOrb(b, 18)}</span><span class="dk-sched-bot" data-k="s:bot:${s.id}">${esc(b.name)}</span>
        <button class="dk-sched-what" data-act="expand" data-k="s:what:${s.id}" aria-label="${esc(s.what)}, ${esc(s.when)}; show all scheduled runs">${esc(s.what)}</button>
        <span class="dk-sched-when" data-k="s:next:${s.id}"><b>${esc(s.next)}</b></span></li>`; }).join('') || `<li>${ui().html.empty({ title: 'Nothing scheduled', text: 'Bots you schedule show their next run here.' })}</li>`}</ul>`,
    'sched:exp': () => `<div class="dk-sched-head" data-e>Scheduled runs<span>${S.sched.length} in total</span></div><ul class="dk-sched">${S.sched.map(s => { const b = botById(s.bot); return `<li class="dk-sched-row"${s.paused ? ' data-paused' : ''}>
        <span class="dk-mini-orb" data-k="s:orb:${s.id}">${miniOrb(b, 18)}</span><span class="dk-sched-bot" data-k="s:bot:${s.id}">${esc(b.name)}</span>
        <span class="dk-sched-what" data-k="s:what:${s.id}">${esc(s.what)}<span class="dk-sub dk-mono"> ${esc(s.when)}</span></span>
        <span class="dk-sched-end"><span class="dk-sched-when" data-k="s:next:${s.id}">${s.paused ? 'Paused' : `<b>${esc(s.next)}</b>`}</span>
        <span class="dk-sched-acts">${btn('Run now', 'sched-run', { size: 's', attrs: { 'data-id': s.id, 'aria-label': `Run ${s.what} now` } })}${btn(s.paused ? 'Resume' : 'Pause', 'sched-pause', { size: 's', attrs: { 'data-id': s.id, 'aria-pressed': String(s.paused), 'aria-label': `${s.paused ? 'Resume' : 'Pause'} ${s.what}` } })}</span></span></li>`; }).join('')}</ul>`,

    'ctx:min': () => `${pillBtn(`Show the dock, context ${ctxPct()}% used`)}<span class="dk-ctx-num" data-k="c:num">${ctxPct()}%</span>${pillAtt()}`,
    'ctx:norm': () => `<span class="dk-ctx-num" data-k="c:num">${ctxPct()}%</span><span class="dk-ctx-dots" data-k="c:bar">${ui().html.measure({ variant: 'row', total: S.ctx.total, parts: S.ctx.parts, dots: 24 })}</span><span class="dk-ctx-of" data-k="c:of">${kfmt(S.ctx.used)} / ${kfmt(S.ctx.total)}</span>
      ${btn('Details', 'expand', { attrs: { 'data-e': true } })}`,
    'ctx:exp': () => `<div class="dk-ctxx-head"><span class="dk-ctx-num" data-k="c:num">${ctxPct()}%</span><span class="dk-ctx-of" data-k="c:of">${kfmt(S.ctx.used)} / ${kfmt(S.ctx.total)}</span></div>
      <span class="dk-ctx-grid" data-k="c:bar">${ui().html.measure({ variant: 'grid', total: S.ctx.total, parts: S.ctx.parts, cols: 20 })}</span>
      <div class="dk-ctx-legend" data-e>${ui().html.legend(S.ctx.parts, kfmt)}</div>
      <div class="dk-ctx-acts" data-e>${btn('Open the context panel', 'open-context')}</div>`,

    'edit:edit': () => `<div class="dk-edit-head" data-e><div><h2 id="dk-edit-h">Dock pages</h2><p>Drag to reorder. Hidden pages stay reachable in the app.</p></div>${btn('Done', 'done', { variant: 'primary' })}</div>
      <ul class="dk-tiles" aria-label="Pages in order">${S.pages.map((p, i) => tileHTML(p, i)).join('')}</ul>
      <div class="dk-edit-foot" data-e>${btn('Turn off the dock', 'dock-off', { variant: 'ghost' })}<p>${esc(keyHint())}</p></div>`
  };
  const sessState = b => { const s = st(b); return `${dotFor(b)}${s.key === 'idle' ? '' : `<span class="dk-card-word">${esc(s.word)}</span>`}`; };
  function paintSession(b, log) {
    const v = curView && curView.dataset.view === 'bots:card' && S.card === b.id ? curView : null; if (!v) return;
    const el = v.querySelector('.dk-card-state');
    if (el) { el.innerHTML = sessState(b); st(b).attention ? el.setAttribute('data-tone', 'attention') : el.removeAttribute('data-tone'); }
    const lg = log && v.querySelector('.dk-sess-log');
    if (lg) { const end = lg.scrollHeight - lg.scrollTop - lg.clientHeight < 24; lg.innerHTML = logHTML(b); if (end) lg.scrollTop = lg.scrollHeight; retarget(false); emitDock(); }
  }
  /* a session's last messages, drawn as the Bots tab draws them (HX.ui.html.entry; yours as request bubbles) */
  const threadOf = id => { const d = D(); return (d.botThreads && d.botThreads[id]) || []; };
  function logHTML(b) {
    let msgs = threadOf(b.id).filter(m => m.text);
    if (!msgs.length && LAST[b.id]) msgs = [{ who: b.id, t: LAST[b.id][0], text: LAST[b.id][1] }];
    if (!msgs.length) return `<p class="dk-sess-empty">Nothing from ${esc(b.name)} yet. Say what you need below.</p>`;
    const groups = [];
    for (const m of msgs.slice(-LOG_N)) {
      const body = m.who === 'you' ? ui().html.request(m.text) : `<p>${esc(m.text)}</p>`;
      const g = groups[groups.length - 1];
      if (g && g.who === m.who) { g.body += body; g.t = m.t || g.t; } else groups.push({ who: m.who, t: m.t, body });
    }
    return groups.map(g => {
      const you = g.who === 'you', name = you ? 'You' : (botById(g.who) || b).name;
      return ui().html.entry({ kind: you ? 'user' : 'bot', who: esc(name), callno: g.t ? [g.t] : [], label: name + (g.t ? ', ' + g.t : ''), body: g.body });
    }).join('');
  }
  function keyHint() {
    const k = HXr && typeof HXr.keys === 'function' ? HXr.keys('mod+J') : '';
    return k ? `${k} brings it back` : 'Alt and the arrow keys move a page';
  }
  function stopBtn() {
    return ui().html.iconButton({ icon: 'stop', label: S.run.stopped ? 'Run stopped' : 'Stop run', disabled: S.run.stopped, class: 'dk-stop', tipPos: 'top', attrs: { 'data-act': 'stop', 'data-k': 'run:stop' } });
  }
  const ctxPct = () => Math.round(S.ctx.used / (S.ctx.total || 1) * 100);
  function tileHTML(p, i) {
    const name = PAGE_NAME[p.id], first = i === 0, last = i === S.pages.length - 1;
    const onCount = shownPages().length;
    let glyph = '';
    if (p.id === 'bots') glyph = S.bots.slice(0, 6).map(b => `<i style="background:${esc(b.color)}"></i>`).join('');
    if (p.id === 'run') glyph = ui().html.ladder({ stations: S.run.ladder, current: S.run.current, ground: 'var(--dock-bg)' });
    if (p.id === 'wait') glyph = (S.waits.length ? ui().html.dot('attention') : '') + `<span class="dk-tile-sub">${S.waits.length}</span>`;
    if (p.id === 'sched') glyph = `<span class="dk-tile-sub">${S.sched.length} runs</span>`;
    if (p.id === 'ctx') glyph = `<span class="dk-tile-sub">${ctxPct()}%</span>`;
    const dot = !p.on ? '<i class="dk-tile-dot" data-off></i>' : `<i class="dk-tile-dot"${p.id === S.page ? ' aria-current="true"' : ''} data-k="dot:${p.id}"></i>`;
    return `<li class="dk-tile" data-tile="${p.id}"${p.on ? '' : ' data-off'}><span class="dk-tile-o" data-e aria-hidden="true"></span>
      <span class="dk-tile-name" data-e>${esc(name)}</span><span class="dk-tile-glyph" aria-hidden="true" data-e>${glyph}</span>
      <span class="dk-tile-foot">${dot}${btn(p.on ? 'Shown' : 'Hidden', 'page-toggle', { variant: 'ghost', size: 's', class: 'dk-tile-show', attrs: { 'data-id': p.id, 'aria-pressed': String(p.on), 'aria-label': `Show ${name} in the dock`, 'aria-disabled': p.on && onCount === 1 ? 'true' : null, 'data-e': true } })}</span>
      <span class="dk-tile-move">${ui().html.iconButton({ icon: 'back', label: `Move ${name} left`, size: 's', disabled: first, attrs: { 'data-act': 'page-left', 'data-id': p.id } })}${ui().html.iconButton({ icon: 'forward', label: `Move ${name} right`, size: 's', disabled: last, attrs: { 'data-act': 'page-right', 'data-id': p.id } })}</span></li>`;
  }
  /* after a view renders: key the ladder's stations, mark the roster's text as entering, put the cards in place */
  function finish(el, key) {
    $$('.ui-ladder .ui-ladder__st', el).forEach((s, i) => { if (!s.closest('.dk-tile')) s.dataset.k = 'run:t' + i; });
    if (key === 'bots:exp') for (const r of $$('.ui-row', el)) { const tx = r.querySelector('.ui-row__text'); if (tx) tx.setAttribute('data-e', ''); const sub = r.querySelector('.ui-row__sub'); if (sub && r.dataset.id) sub.dataset.botPhrase = r.dataset.id; }
    fillCards(el);
    syncRoving();
  }
  /* KEYMAP.md §8, roving tabindex: each region (the bot row, the grid, a session's switcher, the queue at rest) is one
     Tab stop and the arrows move real focus inside it, so a screen reader announces each orb by its name. The row and
     the grid share one index (S.rowIdx: the bots, then "+"), so Up from the row lands on the same bot in the grid. */
  function syncRoving() {
    if (!root) return;
    S.rowIdx = clamp(S.rowIdx, 0, S.bots.length);
    for (const box of $$('.dk-row', root)) $$('.dk-bot, .dk-add', box).forEach((el, k) => { el.tabIndex = k === S.rowIdx ? 0 : -1; });
    for (const box of $$('.dk-roster', root)) $$('.ui-row', box).forEach((el, k) => { el.tabIndex = k === S.rowIdx ? 0 : -1; });
    for (const box of $$('.dk-strip', root)) {
      const items = $$('.dk-strip-bot', box), on = items.filter(x => x.tabIndex === 0);
      const keep = on.find(x => x === document.activeElement) || items.find(x => x.getAttribute('aria-current') === 'true') || items[0];
      items.forEach(x => { x.tabIndex = x === keep ? 0 : -1; });
    }
    for (const box of $$('.dk-v-wait-norm .dk-cards', root)) {
      const items = $$('.cd-mini', box), keep = items.find(x => x === document.activeElement) || items.find(x => x.tabIndex === 0) || items[0];
      items.forEach(x => { x.tabIndex = x === keep ? 0 : -1; });
    }
  }
  /* move focus to items[j] (clamped), making it the region's one tab stop */
  function rove(items, i, j) {
    if (!items.length) return i;
    j = clamp(j, 0, items.length - 1);
    items.forEach((el, k) => { el.tabIndex = k === j ? 0 : -1; });
    items[j].focus({ preventScroll: true });
    return j;
  }
  /* a card element is shared by the views that show it (the compact approval sits in nina's card and in the
     expanded needs-you view), so every view that becomes visible takes its cards back */
  function fillCards(el) {
    if (!el) return;
    for (const slotEl of $$('[data-cards]', el)) {
      const want = S.waits.map(w => cardFor(w, slotEl.dataset.cards));
      if (want.length !== slotEl.children.length || want.some((c, i) => slotEl.children[i] !== c)) slotEl.replaceChildren(...want);
    }
    for (const slotEl of $$('[data-card]', el)) {
      const w = S.waits.find(x => x.id === slotEl.dataset.card);
      if (w && slotEl.firstElementChild !== cardFor(w, slotEl.dataset.size)) slotEl.replaceChildren(cardFor(w, slotEl.dataset.size));
    }
    for (const slotEl of $$('[data-composer]', el)) {
      const c = composerFor(slotEl.dataset.composer);
      if (c && slotEl.firstElementChild !== c) slotEl.replaceChildren(c);
    }
    const log = el.querySelector('.dk-sess-log'); if (log) log.scrollTop = log.scrollHeight;
  }
  /* one library composer per bot, kept across renders so a draft survives; what you send lands in the bot's thread */
  const composerEls = new Map();
  function composerFor(id) {
    const b = botById(id); if (!b) return null;
    let c = composerEls.get(id);
    if (!c) {
      /* the library's compact composer: one row, mic and send in its corner; with `bot` the mic talks to this bot
         (alt+V, a tap toggles, a hold talks while held, Esc stops) and the bot's orbs here listen while you talk */
      c = ui().composer({ placeholder: `Message ${b.name}`, label: `Message ${b.name}`, attach: false, bot: b,
        orbs: () => [av(id), ...$$(`.dk-strip-bot[aria-current="true"] orb-avatar`, root)].filter(Boolean) });
      c.classList.add('dk-composer');
      c.input.removeAttribute('data-hx-focus');     /* the shell's composer region is the tab's, not the dock's */
      c.addEventListener('ui:send', ev => sendTo(id, ev.detail.text));
      /* when you stop talking, the orb takes the bot's current state (it may have changed meanwhile) */
      c.addEventListener('ui:dictate', ev => { if (!(ev.detail && ev.detail.value)) setTimeout(() => { const x = botById(id); if (x) refreshBot(x); }, 0); });
      composerEls.set(id, c);
    }
    return c;
  }
  const clock = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function sendTo(id, text) {
    const b = botById(id); if (!b || !text) return;
    const d = D(); d.botThreads = d.botThreads || {};
    const th = d.botThreads[id] = d.botThreads[id] || [];
    if (!th.some(m => m.text) && LAST[id]) th.push({ who: id, t: LAST[id][0], text: LAST[id][1] });
    const m = { who: 'you', t: clock(), text, via: 'dock' };
    th.push(m);
    emit('hx:bot-message', { id, message: m, source: 'dock' });
    paintSession(b, true);
    const o = av(id);
    if (o && !(composerEls.get(id) || {}).listening) { o.setAttribute('reaction', 'listening'); setTimeout(() => { if (botById(id)) refreshBot(botById(id)); }, 1800); }
    announce(`Sent to ${b.name}`);
  }

  function viewEl(key) { return root.querySelector(`.dk-view[data-view="${key}"]:not(.is-ghost)`); }
  function renderView(key) {
    const el = viewEl(key); if (!el || !V[key]) return;
    el.innerHTML = V[key]();
    finish(el, key);
  }
  function renderAll() { for (const k of Object.keys(V)) if (k !== 'bots:card' || S.card) renderView(k); }
  function renderMins() { for (const p of PAGE_IDS) renderView(p + ':min'); }

  function viewKey() {
    if (S.mode === 'edit') return 'edit:edit';
    if (S.mode === 'minimal' || S.mode === 'off') return S.page + ':min';
    if (S.mode === 'expanded') return S.page === 'bots' && S.card ? 'bots:card' : S.page + ':exp';
    return S.page + ':norm';
  }

  /* ------------------------------------------------------------------ build */
  const VIEW_CLASS = {
    'bots:min': 'dk-v-min', 'bots:norm': 'dk-v-bots-norm', 'bots:exp': 'dk-v-bots-exp', 'bots:card': 'dk-v-bots-card',
    'run:min': 'dk-v-min', 'run:norm': 'dk-v-run-norm', 'run:exp': 'dk-v-run-exp',
    'wait:min': 'dk-v-min', 'wait:norm': 'dk-v-wait-norm', 'wait:exp': 'dk-v-wait-exp',
    'sched:min': 'dk-v-min', 'sched:norm': 'dk-v-sched-norm', 'sched:exp': 'dk-v-sched-exp',
    'ctx:min': 'dk-v-min', 'ctx:norm': 'dk-v-ctx-norm', 'ctx:exp': 'dk-v-ctx-exp',
    'edit:edit': 'dk-v-edit'
  };
  function build(slotEl) {
    root = document.createElement('div');
    root.className = 'dk';
    root.dataset.ground = 'dock';          /* the library's dock ground re-derives every role for black */
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Dock');
    const views = p => Object.keys(VIEW_CLASS).filter(k => k.startsWith(p + ':')).map(k =>
      `<div class="dk-view ${VIEW_CLASS[k]}" data-view="${k}"${k === 'bots:card' ? ' role="group" aria-labelledby="dk-card-name"' : ''} hidden></div>`).join('');
    root.innerHTML = `<svg class="dk-shape" aria-hidden="true" focusable="false"><path/></svg>
      <div class="dk-stage">
        ${PAGE_IDS.map(p => `<section class="dk-page" id="dk-p-${p}" data-page="${p}" role="tabpanel" aria-labelledby="dk-tab-${p}" hidden>${views(p)}</section>`).join('')}
        <section class="dk-page" id="dk-p-edit" data-page="edit" role="group" aria-labelledby="dk-edit-h" hidden>${views('edit')}</section>
        <div class="dk-foot">
          ${ui().html.iconButton({ icon: 'sliders', label: 'Arrange dock pages', tip: 'Arrange pages', size: 's', tipPos: 'top', class: 'dk-foot-btn', attrs: { 'data-act': 'customise' } })}
          <div class="dk-dots"></div>
          ${ui().html.iconButton({ icon: 'chevron-down', label: 'Minimise the dock', tip: 'Minimise', size: 's', tipPos: 'top', class: 'dk-foot-btn dk-down', attrs: { 'data-act': 'down' } })}
        </div>
        <span class="ui-sr" id="dk-bot-hint">Click or Enter opens its session here. Click it again, or Esc, to close. Double-click or ${isMac ? 'Command' : 'Control'}+Enter opens the full chat in the Bots tab.</span>
      </div>`;
    slotEl.appendChild(root);
    shapeEl = root.querySelector('.dk-shape');
    pathEl = shapeEl.querySelector('path');
    stageEl = root.querySelector('.dk-stage');
    footEl = root.querySelector('.dk-foot');
    dotsEl = root.querySelector('.dk-dots');
    downBtn = root.querySelector('.dk-down');
    for (const p of [...PAGE_IDS, 'edit']) pageEls[p] = root.querySelector(`#dk-p-${p}`);
    for (const b of S.bots) orbs.set(b.id, makeOrb(b));
  }

  function renderDots() {
    dotsEl.innerHTML = ui().html.pages({ interactive: true, current: S.page, label: 'Dock pages',
      pages: shownPages().map(p => ({ id: p, label: PAGE_NAME[p], attention: p === 'wait' && S.waits.length > 0 })) });
    for (const d of $$('.ui-pages__dot', dotsEl)) {
      d.id = 'dk-tab-' + d.dataset.value;
      d.setAttribute('aria-controls', 'dk-p-' + d.dataset.value);
      d.setAttribute('data-tip-pos', 'top');
      const i = d.querySelector('i'); if (i) i.dataset.k = 'dot:' + d.dataset.value;
    }
    for (const p of PAGE_IDS) if (pageEls[p]) pageEls[p].setAttribute('aria-labelledby', `dk-tab-${p}`);
  }
  function updateDots() {
    for (const d of $$('.ui-pages__dot', dotsEl)) {
      const id = d.dataset.value, cur = id === S.page, att = id === 'wait' && S.waits.length > 0;
      d.setAttribute('aria-selected', String(cur));
      d.tabIndex = cur ? 0 : -1;
      att ? d.setAttribute('data-attention', '') : d.removeAttribute('data-attention');
      d.setAttribute('aria-label', PAGE_NAME[id] + (att ? ', needs you' : ''));
    }
  }
  function flipDots(fn) {
    const sel = '.dk-dots .ui-pages__dot > i[data-k]';
    const first = new Map($$(sel, root).map(el => [el.dataset.k, el.getBoundingClientRect()]));
    fn();
    if (reduce) return;
    for (const el of $$(sel, root)) {
      const F = first.get(el.dataset.k); if (!F) continue;
      el.style.transform = '';
      const L = el.getBoundingClientRect(), dx = F.left - L.left;
      if (Math.abs(dx) < .5) continue;
      const prev = anims.get(el.dataset.k);
      const an = { el, x: spring(dx, K_DOT, 1, .05), y: spring(0, K_DOT, 1, .05), s: spring(1, K_DOT, 1, .0008), at: 0 };
      an.x.t = 0;
      if (prev) an.x.v = prev.x.v;
      anims.set(el.dataset.k, an);
      paintAnim(an);
    }
    kick();
  }
  /* the foot shows in the normal and expanded dock only; the pill offers restore and nothing else (owner, v10).
     Its right button is Minimise in the normal dock and Collapse in an expanded one. */
  function syncFoot() {
    const on = S.mode === 'normal' || S.mode === 'expanded';
    footEl.classList.toggle('is-off', !on);
    footEl.inert = !on;
    dotsEl.style.visibility = shownPages().length > 1 ? '' : 'hidden';
    const exp = S.mode === 'expanded';
    const label = exp ? 'Collapse the dock' : 'Minimise the dock';
    if (downBtn.getAttribute('aria-label') !== label) { downBtn.setAttribute('aria-label', label); downBtn.dataset.tip = exp ? 'Collapse' : 'Minimise'; }
  }

  /* ------------------------------------------------------------------ geometry + springs */
  let slabW, slabH, sinkS, dotS;
  let baseW = 0, baseH = 0, magE = 0, magLift = 0, magItems = [], magPX = null, magOn = false;
  const anims = new Map();      /* key -> { el, x, y, s, at } */
  const slides = new Map();     /* page id -> spring */
  let raf = 0, lastT = 0, timeScale = 1;

  function geom(w, h) {
    const R = Math.min(R_TOP, h / 2, w / 2);
    const F = clamp(Math.min(FLARE, h - R), 0, FLARE);
    return { R, Fw: F };
  }
  /* the slab as one path: concave flare out of the edge, side, rounded top, side, flare back into the edge.
     In svg space the slab body spans x ∈ [F, F + w]. */
  /* the library draws the same continuous corner as every other surface (HX.ui.squircle, Figma smoothing); the
     minimised pill is a pill in a pill: R = h / 2 with round ends, its first and last orb on the centres of the end caps */
  function slabPath(w, h, g) {
    const pill = S.mode === 'minimal' || S.mode === 'off';
    return ui().shape.slab(w, h, pill ? Math.min(h / 2, w / 2) : g.R, g.Fw, pill ? { round: true } : undefined);
  }
  /* centring: the dock rides the shell's animated --hx-center-x (left: var(...)), so it moves on the very
     curve the composer uses; without it, hx:layout.centerX is set as --dk-cx and a CSS transition runs */
  let useVar = false;
  const cxNow = () => root.getBoundingClientRect().left;
  const shellVar = () => !!getComputedStyle(root).getPropertyValue('--hx-center-x').trim();
  function anchor() { const r = stageEl.getBoundingClientRect(); return { x: r.left, y: r.top }; }
  function relRect(el, a) { const r = el.getBoundingClientRect(); return { l: r.left - a.x, b: a.y - r.bottom, w: r.width, h: r.height }; }

  function kick() { if (!raf && mounted) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0;
    const dt = Math.min(.05, Math.max(0, (now - lastT) / 1000)) * timeScale;
    lastT = now;
    const magBusy = stepMag(dt);
    slabW.t = baseW + magE;
    slabH.t = (S.mode === 'off' ? 0 : baseH) + magLift;
    const springs = [slabW, slabH, sinkS, dotS, ...slides.values()];
    if (reduce) for (const s of springs) snapS(s);      /* reduced motion: a size changes at once; nothing slides */
    else {
      const n = Math.max(1, Math.ceil(dt / .008)), h = dt / n;
      for (let i = 0; i < n; i++) {
        for (const s of springs) stepS(s, h);
        for (const a of anims.values()) if (now >= a.at) { stepS(a.x, h); stepS(a.y, h); stepS(a.s, h); }
      }
    }
    let busy = magBusy;
    for (const s of springs) { if (atRest(s)) snapS(s); else busy = true; }
    if (flushEnter(now)) busy = true;
    for (const [k, a] of anims) {
      if (now >= a.at && atRest(a.x) && atRest(a.y) && atRest(a.s)) { a.el.style.transform = ''; anims.delete(k); }
      else { busy = true; paintAnim(a); }
    }
    for (const [p, s] of slides) if (atRest(s) && s.t === 0) { pageEls[p].style.translate = ''; slides.delete(p); }
    paint();
    if (busy) raf = requestAnimationFrame(frame);
    else settled();
  }
  function paintAnim(a) { a.el.style.transform = `translate(${a.x.x.toFixed(2)}px,${a.y.x.toFixed(2)}px) scale(${a.s.x.toFixed(4)})`; }
  function paint() {
    const w = Math.max(0, slabW.x), h = Math.max(0, slabH.x);
    if (h < .5 || w < 1) { pathEl.setAttribute('d', ''); }
    else {
      const g = geom(w, h);
      shapeEl.setAttribute('width', (w + 2 * g.Fw).toFixed(2));
      shapeEl.setAttribute('height', h.toFixed(2));
      shapeEl.style.transform = `translate3d(${(-w / 2 - g.Fw).toFixed(2)}px,0,0)`;
      pathEl.setAttribute('d', slabPath(w, h, g));
    }
    const sink = Math.abs(sinkS.x) > .01 ? sinkS.x : 0;
    stageEl.style.transform = sink ? `translate3d(0,${sink.toFixed(2)}px,0)` : '';
    footEl.style.width = `${w.toFixed(2)}px`;
    for (const [p, s] of slides) pageEls[p].style.translate = `${s.x.toFixed(2)}px 0`;
    /* while anything travels, the content is held inside the slab (16px of headroom for the orbs' paint), so the black
       shape and what it carries never part; at rest nothing is clipped */
    const moving = !reduce && h > .5 && (anims.size > 0 || slides.size > 0 || pending.length > 0 || !atRest(slabW) || !atRest(slabH) || !!stageEl.querySelector('.dk-view.is-leaving'));
    const clip = moving ? `polygon(${(-w / 2).toFixed(1)}px ${(-(h + sink + 16)).toFixed(1)}px, ${(w / 2).toFixed(1)}px ${(-(h + sink + 16)).toFixed(1)}px, ${(w / 2).toFixed(1)}px 4px, ${(-w / 2).toFixed(1)}px 4px)` : '';
    if (stageEl.style.clipPath !== clip) stageEl.style.clipPath = clip;
    paintMag();
  }
  function settled() {
    tidy();
    if (S.mode === 'off' && !root.classList.contains('is-gone')) {
      root.classList.add('is-gone');
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
    }
  }

  /* ------------------------------------------------------------------ magnification (macOS-style) */
  function cacheMag() {
    const keep = new Map(magItems.map(it => [it.el, it.m])), keepG = new Map(magItems.map(it => [it.el, it.g]));
    for (const it of magItems) it.el.style.transform = '';
    magItems = [];
    if (curView && curView.dataset.view === 'bots:norm' && S.mode === 'normal') {
      const vw = curView.offsetWidth;
      for (const el of $$('.dk-bot, .dk-add', curView)) {
        magItems.push({ el, c: -vw / 2 + el.offsetLeft + el.offsetWidth / 2, w: el.offsetWidth, hgt: el.offsetHeight, max: el.classList.contains('dk-add') ? MAG_ADD : MAG, m: keep.get(el) || 1, g: keepG.get(el) || 1, off: 0 });
      }
    }
  }
  function stepMag(dt) {
    if (!magItems.length) { magE = 0; magLift = 0; return false; }
    const growOn = S.grow && S.mode === 'normal' && S.page === 'bots' && !drag.on;
    /* magnification (the row's sizes follow the pointer) is motion: only with motion allowed */
    const active = growOn && !reduce && magOn && magPX != null;
    const k = reduce ? 1 : dt > 0 ? 1 - Math.exp(-dt * 20) : 1;
    const kg = reduce ? 1 : dt > 0 ? 1 - Math.exp(-dt * 32) : 1;          /* ~100ms, no overshoot */
    const act = document.activeElement;
    const focused = growOn && act && curView && curView.contains(act) && act.matches(':focus-visible') ? act : null;
    const hovered = growOn && reduce && magOn ? lastItem : null;
    let busy = false, E = 0, lift = 0;
    for (const it of magItems) {
      const tgt = active ? 1 + (it.max - 1) * Math.exp(-Math.pow((magPX - it.c) / SIG, 2)) : 1;
      it.m += (tgt - it.m) * k;
      if (Math.abs(tgt - it.m) < .0015) it.m = tgt; else busy = true;
      const gt = it.el === focused || it.el === hovered ? (it.max === MAG_ADD ? GROW_ADD : GROW) : 1;
      it.g += (gt - it.g) * kg;
      if (Math.abs(gt - it.g) < .0015) it.g = gt; else busy = true;
      E += (it.m - 1) * it.w;
      lift = Math.max(lift, (it.m - 1) * it.hgt);
    }
    magE = E; magLift = lift * .5;
    return busy;
  }
  function paintMag() {
    let acc = 0;
    for (const it of magItems) {
      const e = (it.m - 1) * it.w, off = acc + e / 2 - magE / 2;
      acc += e; it.off = off;
      const sc = Math.max(it.m, it.g);         /* a lone grow scales in place and never moves a neighbour */
      it.el.style.transform = (sc === 1 && Math.abs(off) < .01) ? '' : `translate3d(${off.toFixed(2)}px,0,0) scale(${sc.toFixed(4)})`;
    }
  }
  function resetMag() {
    magOn = false; magPX = null;
    for (const it of magItems) { it.m = 1; it.g = 1; it.off = 0; it.el.style.transform = ''; }
    magE = 0; magLift = 0;
  }

  /* ------------------------------------------------------------------ tooltip: HX.ui.tooltip answers [data-tip] */
  const hideTip = () => { try { ui().tooltip.hide(); } catch (e) { /* none */ } };

  /* ------------------------------------------------------------------ the morph engine */
  function snapKeys(a, clear) {
    const m = new Map();
    const els = $$('[data-k]', root).filter(el => !el.closest('.is-leaving') && rendered(el));
    if (clear) for (const el of els) el.style.transform = '';
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      m.set(el.dataset.k, { el, x: r.left + r.width / 2 - a.x, y: r.top + r.height / 2 - a.y, w: r.width, h: r.height });
    }
    return m;
  }
  function showView(key) {
    const p = key.split(':')[0];
    for (const [id, sec] of Object.entries(pageEls)) {
      if (id === p) { cancelOut(sec); sec.hidden = false; }
      else if (!sec.classList.contains('is-out')) sec.hidden = true;
    }
    let target = null;
    for (const v of pageEls[p].querySelectorAll(':scope > .dk-view')) {
      if (v.dataset.view === key && !v.classList.contains('is-ghost')) { cancelLeave(v); v.hidden = false; target = v; }
      else if (!v.classList.contains('is-leaving')) v.hidden = true;
    }
    return target;
  }
  function leave(view, rect, last) {
    if (!view || !rect || reduce) { if (view && view.classList.contains('is-ghost')) view.remove(); return; }
    const sec = view.parentElement;
    view.hidden = false;
    view.classList.add('is-leaving');
    Object.assign(view.style, { left: `calc(50% + ${rect.l.toFixed(1)}px)`, bottom: `${rect.b.toFixed(1)}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    for (const el of view.querySelectorAll('[data-k]')) if (last.has(el.dataset.k)) el.classList.add('is-handed');
    if (sec !== pageEls[curView ? curView.dataset.view.split(':')[0] : S.page]) { sec.hidden = false; sec.classList.add('is-out'); }
    const an = view.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: 'cubic-bezier(0,0,.2,1)', fill: 'forwards' });
    an.playbackRate = timeScale;
    view._leave = an;
    an.onfinish = () => finishLeave(view);
  }
  function finishLeave(view) {
    if (view._leave) { try { view._leave.cancel(); } catch (e) { /* gone */ } view._leave = null; }
    if (view.classList.contains('is-ghost')) { view.remove(); }
    else {
      view.classList.remove('is-leaving');
      view.style.left = view.style.bottom = view.style.width = view.style.height = '';
      for (const el of view.querySelectorAll('.is-handed')) el.classList.remove('is-handed');
      if (view !== curView) view.hidden = true;
    }
    const sec = view.parentElement;
    if (sec && sec.classList.contains('is-out') && !sec.querySelector('.is-leaving') && !slides.has(sec.dataset.page) && !sec._fade) {
      sec.classList.remove('is-out');
      if (!curView || curView.parentElement !== sec) sec.hidden = true;
    }
  }
  function cancelLeave(view) { if (view.classList.contains('is-leaving')) finishLeave(view); }
  function cancelOut(sec) {
    if (sec._fade) { try { sec._fade.cancel(); } catch (e) { /* gone */ } sec._fade = null; }
    sec.classList.remove('is-out');
    sec.inert = false;
    sec.style.opacity = '';
    slides.delete(sec.dataset.page);
    sec.style.translate = '';
  }
  /* once motion settles, any section that is neither current nor leaving is put away */
  function tidy() {
    const curSec = curView && curView.parentElement;
    for (const [id, sec] of Object.entries(pageEls)) {
      if (sec === curSec || sec.querySelector('.is-leaving') || (sec._fade && sec._fade.playState === 'running')) continue;
      if (!sec.hidden || sec.classList.contains('is-out')) {
        sec.hidden = true; sec.classList.remove('is-out'); sec.inert = false; sec.style.translate = ''; slides.delete(id);
      }
    }
  }
  function ghostOf(view, a) {
    const g = view.cloneNode(true);
    for (const o of g.querySelectorAll('orb-avatar, hx-card')) o.remove();
    g.removeAttribute('id'); g.removeAttribute('aria-labelledby');
    for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
    g.classList.add('is-ghost', 'is-leaving');
    g.setAttribute('aria-hidden', 'true');
    g.inert = true;
    const rect = relRect(view, a);
    view.parentElement.insertBefore(g, view);
    return { g, rect };
  }
  function playFlip(first, last, opts) {
    const now = performance.now();
    let i = 0;
    for (const [k, L] of last) {
      const F = first.get(k);
      const prev = anims.get(k);
      if (!F || reduce) { if (prev) anims.delete(k); continue; }
      const dx = F.x - L.x, dy = F.y - L.y, s = L.w > 0 ? F.w / L.w : 1;
      if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(s - 1) < .01) { if (prev) anims.delete(k); continue; }
      const a = { el: L.el, x: spring(dx, K_FLIP, 1, .08), y: spring(dy, K_FLIP, 1, .08), s: spring(s, K_FLIP, 1, .0008), at: now + (opts.stagger ? Math.min(i * opts.stagger, 140) : 0) };
      a.x.t = 0; a.y.t = 0; a.s.t = 1;
      if (prev) { a.x.v = prev.x.v; a.y.v = prev.y.v; a.s.v = prev.s.v; if (prev.el !== a.el) prev.el.style.transform = ''; }
      anims.set(k, a);
      paintAnim(a);
      i++;
    }
    for (const k of [...anims.keys()]) if (!last.has(k)) { const a = anims.get(k); if (a.el.isConnected && !a.el.closest('.is-leaving')) a.el.style.transform = ''; anims.delete(k); }
  }
  /* entrances wait until the growing slab has reached them, so nothing ever shows outside the slab */
  const pending = [];
  function enter(list, a) {
    const now = performance.now();
    list.forEach((el, i) => {
      if (reduce) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'linear', fill: 'backwards' }); return; }
      const r = el.getBoundingClientRect();
      const old = pending.findIndex(q => q.el === el); if (old >= 0) pending.splice(old, 1);
      el.style.opacity = '0';
      pending.push({ el, i, t0: now, needH: a.y - r.top - 2, needW: 2 * Math.max(Math.abs(r.left - a.x), Math.abs(r.right - a.x)) - 4 });
    });
    kick();
  }
  function flushEnter(now) {
    for (let j = pending.length - 1; j >= 0; j--) {
      const q = pending[j];
      const okH = slabH.x >= q.needH || atRest(slabH);
      const okW = slabW.x >= q.needW || atRest(slabW);
      if (!(okH && okW) && now - q.t0 < 700 / timeScale) continue;
      pending.splice(j, 1);
      if (!q.el.isConnected) continue;
      const an = q.el.animate([{ opacity: 0, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], { duration: 200, delay: Math.min(q.i * 12, 72), easing: EASE, fill: 'backwards' });
      an.playbackRate = timeScale;
      q.el.style.opacity = '';
    }
    return pending.length > 0;
  }
  /* morph: measure → apply → measure → spring the difference */
  function morph(apply, opts = {}) {
    const a = anchor();
    const hadFocus = root.contains(document.activeElement);
    const typing = [...composerEls.values()].find(c => c.contains(document.activeElement));
    const first = snapKeys(a, false);
    const oldView = curView;
    const oldRect = oldView && rendered(oldView) ? relRect(oldView, a) : null;
    const ghost = opts.ghost && oldView && oldRect && !reduce ? ghostOf(oldView, a) : null;
    hideTip();
    resetMag();
    apply();
    root.dataset.mode = S.mode;
    updateDots();
    const nv = showView(viewKey());
    if (opts.render) for (const k of opts.render) renderView(k);
    fillCards(nv);
    syncRoving();
    curView = nv;
    relocateLive();
    setOrbLife();
    const last = snapKeys(a, true);
    if (ghost) leave(ghost.g, ghost.rect, last);
    if (oldView && oldView !== nv) leave(oldView, oldRect, last);
    playFlip(first, last, opts);
    const list = [];
    if (nv && (nv !== oldView || opts.ghost)) list.push(...nv.querySelectorAll('[data-e]'));
    for (const [k, L] of last) if (!first.has(k) && !list.includes(L.el) && !L.el.closest('[data-e]')) list.push(L.el);
    retarget(false);
    enter(list, a);
    if (opts.outside) { /* focus stays where the outside click put it */ }
    else if (typing && typing.isConnected && rendered(typing) && !opts.focus) typing.focus();
    else fixFocus(opts, hadFocus);
    markFocus();
    emitDock();
  }
  function fixFocus(opts, hadFocus) {
    const act = document.activeElement;
    if (opts.focus === 'composer') { const c = composerEls.get(S.card); if (c && rendered(c)) { c.focus(); return; } }
    if (opts.focus) {
      const el = opts.focus === 'default' ? defaultTarget() : typeof opts.focus === 'string' ? (curView && curView.querySelector(opts.focus)) || root.querySelector(opts.focus) : opts.focus;
      if (el && rendered(el)) { el.focus({ preventScroll: true }); return; }
    }
    if (hadFocus && (!root.contains(act) || !rendered(act) || act.closest('.is-leaving'))) {
      /* the focused thing went away (an answered card, say): the view's first control, else the page's tab */
      const el = (curView && curView.querySelector('button:not([disabled]):not([tabindex="-1"])')) || root.querySelector(`#dk-tab-${S.page}`);
      if (el) el.focus({ preventScroll: true });
    }
  }
  function retarget(snap) {
    const v = curView;
    if (v !== watched && viewRO) { if (watched) viewRO.unobserve(watched); if (v) viewRO.observe(v); watched = v; }
    baseW = v ? v.offsetWidth : 0;
    baseH = v ? v.offsetHeight : 0;
    sinkS.t = S.mode === 'off' ? baseH + 14 : 0;
    cacheMag();
    syncFoot();
    slabW.t = baseW + magE;
    slabH.t = (S.mode === 'off' ? 0 : baseH) + magLift;
    markFocus();
    if (snap || reduce) { snapS(slabW); snapS(slabH); snapS(sinkS); snapS(dotS); }
    paint();               /* the slab answers in the same frame as its content (no frame with one and not the other) */
    kick();
    emitDock();
  }
  /* The height the shell keeps free above the window edge (--hx-dock-space): the slab measured from the view it wraps
     (the foot is inside it), plus the most the row can lift it while the bots grow under the pointer, so the slab at
     its tallest still ends below the composer and the composer never moves under the pointer. Sent whenever it
     changes: after a morph, a resize, a font load, or the view's own size changing (a ResizeObserver on the view). */
  let watched = null, sent = '';
  const viewRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (mounted && curView && (curView.offsetHeight !== baseH || curView.offsetWidth !== baseW)) retarget(false);
  }) : null;
  function headroom() {
    if (!(S.grow && S.mode === 'normal' && S.page === 'bots') || reduce) return 0;
    let lift = 0;
    for (const it of magItems) lift = Math.max(lift, (it.max - 1) * it.hgt * .5);
    return lift;
  }
  function reserveH() { return S.mode === 'off' ? 0 : Math.ceil(baseH + headroom()); }
  function emitDock() {
    const h = reserveH(), key = S.mode + '|' + S.page + '|' + Math.round(baseW) + '|' + h;
    if (key === sent) return;
    sent = key;
    emit('hx:dock', { mode: S.mode, page: S.page, width: Math.round(baseW), height: h, rest: Math.round(S.mode === 'off' ? 0 : baseH) });
  }

  /* ------------------------------------------------------------------ modes */
  function setMode(mode, opts = {}) {
    if (!mounted) return;
    if (mode === 'off') return setOn(false);
    if (S.mode === 'off') { S.restore = mode; return setOn(true); }
    if (mode === S.mode && !opts.card && !opts.force) return;
    const from = S.mode;
    morph(() => {
      if (opts.card) {
        if (S.mode !== 'expanded' || !S.card || S.page !== 'bots') S.cardFrom = S.mode === 'expanded' && S.page === 'bots' ? 'expanded' : 'normal';
        S.card = opts.card;
        if (S.page !== 'bots') { if (!shownPages().includes('bots')) { const bp = S.pages.find(x => x.id === 'bots'); if (bp) bp.on = true; renderDots(); } S.page = 'bots'; }
      }
      else if (mode !== 'expanded' || from === 'expanded') S.card = null;
      S.mode = mode;
    }, { ...opts, render: opts.card ? ['bots:card'] : opts.render, stagger: opts.stagger != null ? opts.stagger : (mode === 'expanded' && S.page === 'bots' && !opts.card) || from === 'expanded' && S.page === 'bots' ? 9 : 0 });
    if (mode === 'minimal' || mode === 'normal') savePrefs();
    if (mode === 'minimal') announce('Dock minimised');
  }
  function setOn(on) {
    const my = ++offSeq;
    if (!on) {
      if (S.mode === 'off') return;
      S.restore = S.mode === 'minimal' ? 'minimal' : 'normal';
      const sink = () => {
        if (my !== offSeq) return;
        hideTip(); resetMag();
        S.mode = 'off'; root.dataset.mode = 'off';
        setOrbLife(); retarget(false); emitDock(); savePrefs();
      };
      if (S.mode !== 'minimal') { morph(() => { S.mode = 'minimal'; S.card = null; }); setTimeout(sink, reduce ? 0 : 190 / timeScale); }
      else sink();
    } else {
      if (S.mode !== 'off') return;
      root.classList.remove('is-gone'); root.inert = false; root.removeAttribute('aria-hidden');
      S.mode = 'minimal'; root.dataset.mode = 'minimal';
      retarget(false); emitDock();
      if (S.restore !== 'minimal') setTimeout(() => { if (my === offSeq && S.mode === 'minimal') setMode(S.restore === 'minimal' ? 'minimal' : 'normal'); }, reduce ? 0 : 200 / timeScale);
    }
  }
  /* one click (or Enter) opens the bot's session; the same orb again closes it; another orb switches */
  function openCard(id, kbd, focusSel) {
    if (!botById(id) || S.mode === 'off' || S.mode === 'edit') return;
    if (S.mode === 'expanded' && S.card === id && S.page === 'bots') return closeCard(kbd);
    S.rowIdx = Math.max(0, S.bots.findIndex(b => b.id === id));
    setMode('expanded', { card: id, focus: focusSel || 'composer' });
    const b = botById(id); if (b) announce(`Session with ${b.name}`);
  }
  function closeCard(kbd) {
    const id = S.card;
    const back = S.cardFrom === 'expanded' ? 'expanded' : 'normal';
    morph(() => { S.card = null; S.mode = back; }, { focus: kbd ? `[data-id="${id}"]` : null, stagger: 0 });
  }
  function goPage(id, opts = {}) {
    if (!mounted || S.mode === 'edit' || S.mode === 'off' || id === S.page || !shownPages().includes(id)) return;
    const order = shownPages();
    const dir = opts.dir || (order.indexOf(id) > order.indexOf(S.page) ? 1 : -1);
    const from = S.page, outSec = pageEls[from], inSec = pageEls[id];
    const back = slides.get(id) ? { x: slides.get(id).x, v: slides.get(id).v } : null;
    hideTip(); resetMag();
    if (S.mode === 'expanded' && S.card) { S.card = null; S.mode = 'normal'; root.dataset.mode = 'normal'; }
    lookRow(null);
    const wOut = outSec.offsetWidth;
    S.page = id;
    cancelOut(inSec);
    const nv = showView(viewKey());
    fillCards(nv);
    syncRoving();
    curView = nv;
    relocateLive();
    setOrbLife();
    const wIn = inSec.offsetWidth;
    outSec.hidden = false;
    outSec.classList.add('is-out');
    outSec.inert = true;
    if (outSec._fade) outSec._fade.cancel();
    if (reduce) {
      outSec.hidden = true; outSec.classList.remove('is-out'); outSec.inert = false;
      inSec.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'linear' });
    } else {
      const dist = Math.min(40, (wOut + wIn) / 16 + 16);     /* a short travel inside the slab, never a lurch */
      const so = slides.get(from) || spring(0, K_SLIDE, 1, .1); so.t = -dir * dist; slides.set(from, so);
      const si = spring(back ? back.x : dir * dist, K_SLIDE, 1, .1); si.t = 0; si.v = back ? back.v : 0; slides.set(id, si);
      inSec.style.translate = `${si.x}px 0`;
      const fo = outSec.animate([{ opacity: getComputedStyle(outSec).opacity }, { opacity: 0 }], { duration: 140, easing: 'linear', fill: 'forwards' });
      fo.playbackRate = timeScale;
      outSec._fade = fo;
      fo.onfinish = () => {
        outSec._fade = null;
        try { fo.cancel(); } catch (e) { /* gone */ }
        if (S.page !== from) { outSec.hidden = true; outSec.classList.remove('is-out'); outSec.inert = false; slides.delete(from); outSec.style.translate = ''; }
      };
      const fi = inSec.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 50, easing: EASE, fill: 'backwards' });
      fi.playbackRate = timeScale;
    }
    flipDots(updateDots);
    retarget(false);
    if (opts.focusDot) { const d = dotsEl.querySelector(`#dk-tab-${id}`); if (d) d.focus({ preventScroll: true }); }
    else if (opts.focusFirst && curView) { const b = curView.querySelector('button:not([disabled]):not([tabindex="-1"])'); if (b) b.focus({ preventScroll: true }); }
    markFocus();
    emitDock();
  }
  function stepPage(delta, opts = {}) {
    const order = shownPages();
    const i = order.indexOf(S.page);
    const j = clamp(i + delta, 0, order.length - 1);
    if (j !== i) goPage(order[j], { ...opts, dir: Math.sign(delta) });
  }
  function up(kbd) {
    if (S.mode === 'minimal') setMode('normal', { focus: kbd ? curFocusTarget() : null });
    else if (S.mode === 'normal') setMode('expanded', { focus: kbd ? 'default' : null });
  }
  function down(kbd) {
    if (S.mode === 'expanded') S.card ? closeCard(kbd) : setMode('normal', { focus: kbd ? 'default' : null });
    else if (S.mode === 'normal') setMode('minimal', { focus: kbd ? '.dk-pillbtn' : null });
    else if (S.mode === 'edit') setMode('normal');
  }
  function curFocusTarget() { return `#dk-tab-${S.page}`; }

  /* ------------------------------------------------------------------ cards: HX.ui.card on the dock ground */
  const cardEls = new Map();               /* `${wait id}:${size}` -> <hx-card>, kept across re-renders */
  function cardFor(w, size) {
    const k = w.id + ':' + size;
    let el = cardEls.get(k);
    if (!el) {
      el = ui().card(w.kind, w.data, { size, ground: 'dock' });
      el.dataset.wait = w.id;
      el.dataset.k = 'card:' + k;
      cardEls.set(k, el);
    }
    return el;
  }
  function onCardAction(e) {
    const d = e.detail || {}, el = d.card;
    if (!el || !el.dataset.wait || !root.contains(el)) return;
    if (d.action === 'open') {                     /* a mini row opens the compact card in the expanded dock */
      e.preventDefault();
      if (S.page !== 'wait') goPage('wait');
      setMode('expanded', { focus: 'default' });
    }
  }
  function onCardState(e) {
    const d = e.detail || {}, el = d.card;
    if (!el || !el.dataset.wait || !root.contains(el)) return;
    const out = d.state === 'approved' ? 'approved' : d.state === 'denied' ? 'denied' : d.state === 'answered' ? ((d.data && d.data.answer) || 'answered') : null;
    if (out) setTimeout(() => resolveWait(el.dataset.wait, out), reduce ? 200 : 900);   /* let the receipt show first */
  }

  /* ------------------------------------------------------------------ actions */
  function resolveWait(id, outcome, from) {
    const w = S.waits.find(x => x.id === id); if (!w) return;
    const b = w.bot && botById(w.bot);
    const renders = ['wait:norm', 'wait:exp', 'wait:min', 'edit:edit'];
    if (S.card) renders.push('bots:card');
    morph(() => {
      S.waits = S.waits.filter(x => x !== w);
      for (const k of [...cardEls.keys()]) if (k.startsWith(id + ':')) { cardEls.get(k).remove(); cardEls.delete(k); }
      if (b) { b.attention = null; if (outcome === 'approved') b.state = 'working'; else if (outcome === 'denied') b.state = 'idle'; }
      for (const k of renders) renderView(k);
      renderMins();
      if (b) refreshBot(b);
    });
    if (!from) {                    /* decided here: tell the owners; decided elsewhere: they know, so no echo */
      if (w.kind === 'approval') emit('hx:approval', { id: w.id, bot: w.bot, decision: outcome, source: 'dock' });
      else emit('hx:blank-answer', { id: w.id, option: outcome, source: 'dock' });
      if (b) emit('hx:bot-state', { id: b.id, state: b.state, attention: null, source: 'dock' });
    }
    emit('hx:attention', { source: 'dock', count: S.waits.length });
  }
  function stopRun() {
    if (S.run.stopped) return;
    morph(() => { S.run.stopped = true; renderView('run:norm'); renderView('run:exp'); renderView('run:min'); }, { ghost: true });
    emit('hx:run-stop', { source: 'dock' });
    announce('Run stopped');
  }
  function toggleSetting(key, on) {
    S.run[key] = on;
    const hint = root.querySelector('label[for="dk-sw-governed"] small');
    if (key === 'governed' && hint) hint.textContent = S.run.governed ? 'The ladder picks the model' : `Stays on ${S.run.model}`;
    emit('hx:setting', { key: key === 'governed' ? 'governance' : 'sandbox.network', value: key === 'governed' ? (S.run.governed ? 'governed' : 'ungoverned') : S.run.network, source: 'dock' });
  }
  function schedAction(act, id) {
    const s = S.sched.find(x => x.id === id); if (!s) return;
    if (act === 'sched-run') { emit('hx:schedule-run', { id, bot: s.bot, source: 'dock' }); announce(`${botById(s.bot).name} started ${s.what}`); return; }
    s.paused = !s.paused;
    morph(() => { renderView('sched:exp'); renderView('sched:norm'); renderView('sched:min'); }, { ghost: true, focus: `[data-act="sched-pause"][data-id="${id}"]` });
    emit('hx:schedule-pause', { id, paused: s.paused, source: 'dock' });
  }
  /* arrange */
  function movePage(id, delta) {
    const i = S.pages.findIndex(p => p.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= S.pages.length) return;
    const ul = curView.querySelector('.dk-tiles');
    const before = new Map($$('.dk-tile', ul).map(t => [t.dataset.tile, t.getBoundingClientRect().left]));
    const [p] = S.pages.splice(i, 1); S.pages.splice(j, 0, p);
    renderView('edit:edit');
    tileFlip(before);
    const btn = curView.querySelector(`[data-act="${delta < 0 ? 'page-left' : 'page-right'}"][data-id="${id}"]`) || curView.querySelector(`[data-tile="${id}"] .dk-tile-show`);
    if (btn) btn.focus({ preventScroll: true });
    renderDots(); syncFoot();
    savePrefs();
    announce(`${PAGE_NAME[id]} moved to position ${j + 1}`);
  }
  function tileFlip(before, skip) {
    if (reduce) return;
    for (const t of $$('.dk-tile', curView)) {
      if (t === skip) continue;
      const x0 = before.get(t.dataset.tile); if (x0 == null) continue;
      const dx = x0 - t.getBoundingClientRect().left; if (Math.abs(dx) < 1) continue;
      t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 240 / timeScale, easing: EASE });
    }
  }
  function togglePage(id) {
    const p = S.pages.find(x => x.id === id); if (!p) return;
    if (p.on && shownPages().length === 1) return;
    morph(() => {
      p.on = !p.on;
      if (!p.on && S.page === id) S.page = shownPages()[0];
      renderView('edit:edit');
      renderDots();
    }, { focus: `[data-act="page-toggle"][data-id="${id}"]` });
    savePrefs();
  }
  function dragTile(e, tile) {
    const ul = tile.parentElement, id = tile.dataset.tile, x0 = e.clientX;
    let base = x0, moved = false;
    try { tile.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    const onMove = ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return;
      moved = true;
      tile.classList.add('is-drag');
      tile.style.transform = `translateX(${ev.clientX - base}px)`;
      const tiles = $$('.dk-tile', ul), idx = tiles.indexOf(tile);
      const r = tile.getBoundingClientRect(), mid = r.left + r.width / 2;
      let to = idx;
      tiles.forEach((t, k) => {
        if (t === tile) return;
        const q = t.getBoundingClientRect(), c = q.left + q.width / 2;
        if (k > idx && mid > c) to = Math.max(to, k);
        if (k < idx && mid < c) to = Math.min(to, k);
      });
      if (to === idx) return;
      const before = new Map(tiles.map(t => [t.dataset.tile, t.getBoundingClientRect().left]));
      tile.style.transform = '';
      const rest0 = tile.getBoundingClientRect().left;
      if (to > idx) tiles[to].after(tile); else tiles[to].before(tile);
      const [p] = S.pages.splice(S.pages.findIndex(x => x.id === id), 1);
      S.pages.splice(to, 0, p);
      base += tile.getBoundingClientRect().left - rest0;
      tile.style.transform = `translateX(${ev.clientX - base}px)`;
      tileFlip(before, tile);
    };
    const onUp = () => {
      tile.removeEventListener('pointermove', onMove);
      tile.removeEventListener('pointerup', onUp);
      tile.removeEventListener('pointercancel', onUp);
      tile.classList.remove('is-drag');
      if (!moved) {
        const pg = S.pages.find(x => x.id === id);
        if (pg && pg.on) morph(() => { S.page = id; S.mode = 'normal'; });
        return;
      }
      const cur = tile.style.transform;
      tile.style.transform = '';
      if (!reduce && cur) tile.animate([{ transform: cur }, { transform: 'none' }], { duration: 200 / timeScale, easing: EASE });
      $$('.dk-tile', ul).forEach((t, k) => {
        const l = t.querySelector('[data-act="page-left"]'), rr = t.querySelector('[data-act="page-right"]');
        if (l) l.disabled = k === 0;
        if (rr) rr.disabled = k === S.pages.length - 1;
      });
      renderDots(); syncFoot(); savePrefs();
      announce(`${PAGE_NAME[id]} moved to position ${S.pages.findIndex(x => x.id === id) + 1}`);
    };
    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', onUp);
    tile.addEventListener('pointercancel', onUp);
  }

  /* ------------------------------------------------------------------ input */
  /* every orb in the dock answers: a poke (softer under reduced motion), never a jump to the card */
  function pokeBot(id, force = 1) {
    const orb = av(id);
    if (orb && orb.isConnected && typeof orb.poke === 'function') orb.poke(reduce ? Math.min(force, .35) : force);
  }
  /* a double-click opens the full chat. The first click already opened the session, so the second lands on whatever
     the dock (or the page) shows there now: for half a second, a press near the first click is the double-click's
     and nothing else sees it (it can never deny a card or close the session by accident). */
  let dbl = null;
  function armDouble(id, e) { dbl = e.detail >= 1 ? { id, x: e.clientX, y: e.clientY, until: performance.now() + 450, done: false } : null; }
  function onDoubleGuard(e) {
    if (!dbl) return;
    if (performance.now() > dbl.until) { dbl = null; return; }
    if (Math.hypot(e.clientX - dbl.x, e.clientY - dbl.y) > 10) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.type === 'click' && !dbl.done) { dbl.done = true; openBotInTab(dbl.id); }
  }
  function onClick(e) {
    const po = e.target.closest('.dk-mini-orb');
    if (po && root.contains(po) && !e.target.closest('button')) { const o = po.querySelector('orb-avatar'); if (o && o.poke) o.poke(reduce ? .35 : 1); return; }
    const head = e.target.closest('.dk-card-head .dk-orb');
    if (head && root.contains(head) && S.card) { pokeBot(S.card, .5); closeCard(false); return; }   /* the same orb again */
    const pg = e.target.closest('.ui-pages__dot');
    if (pg && root.contains(pg)) { goPage(pg.dataset.value); return; }
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t) || t.closest('.is-leaving')) return;
    if (t.getAttribute('aria-disabled') === 'true') return;
    const act = t.dataset.act, id = t.dataset.id, kbd = e.detail === 0;
    switch (act) {
      case 'session':
        /* the poke is the click's feedback; its job is the session (owner, v10) */
        if (!kbd) armDouble(id, e);
        /* Enter in a session's switcher switches and keeps you in the switcher, on the newly open bot */
        openCard(id, kbd, kbd && t.classList.contains('dk-strip-bot') ? '.dk-strip-bot[aria-current="true"]' : null);
        setTimeout(() => pokeBot(id, .6), reduce ? 0 : 120);
        break;
      case 'close-card': closeCard(true); break;
      case 'new-bot':
        emit('hx:new-bot', { source: 'dock' });
        if (HXr && HXr.setState) HXr.setState({ tab: 'bots' });
        break;
      case 'open-chat': openBotInTab(id); break;
      case 'restore': setMode('normal', { focus: kbd ? curFocusTarget() : null }); break;
      case 'down': down(kbd); break;
      case 'minimise': setMode('minimal', { focus: kbd ? '.dk-pillbtn' : null }); break;
      case 'customise': setMode('edit', { focus: '[data-act="done"]' }); break;
      case 'done': setMode('normal', { focus: kbd ? '[data-act="customise"]' : null }); break;
      case 'expand': setMode('expanded', { focus: kbd ? 'default' : null }); break;
      case 'dot': goPage(id); break;
      case 'stop': stopRun(); break;
      case 'sched-run': case 'sched-pause': schedAction(act, id); break;
      case 'open-context': emit('hx:open-panel', { panel: 'context', source: 'dock' }); break;
      case 'page-left': movePage(id, -1); break;
      case 'page-right': movePage(id, 1); break;
      case 'page-toggle': togglePage(id); break;
      case 'dock-off':
        if (HXr && HXr.setState) HXr.setState({ dock: 'off' });
        else setOn(false);
        break;
    }
  }
  function onKey(e) {
    const t = e.target;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.defaultPrevented) return;
    /* the shell's mod+G "go to" is waiting for its second key (1-9, D, Esc...): that key is the shell's, not the dock's */
    const goto = document.getElementById('hx-goto'); if (goto && !goto.hidden) return;
    /* KEYMAP.md §8: Esc anywhere in a session (its composer included) closes it and gives the orb back its focus */
    if (e.key === 'Escape' && S.card && S.mode === 'expanded' && t.closest && t.closest('.dk-v-bots-card')) {
      e.preventDefault(); e.stopPropagation(); closeCard(true); return;
    }
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    const plain = !mod && !e.altKey && !e.shiftKey;
    /* mod+Enter on an orb (row, roster or switcher): the full chat in the Bots tab, as a double-click */
    const orbBtn = t.closest && t.closest('[data-act="session"][data-id]');
    if (orbBtn && mod && e.key === 'Enter' && !e.altKey && !e.shiftKey) { e.preventDefault(); openBotInTab(orbBtn.dataset.id); return; }
    /* KEYMAP.md §8: [ ] and PageUp / PageDown change the dock page (mod+[ ] stay the shell's back / forward) */
    if (plain && (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.key === 'PageUp' || e.key === 'PageDown')) {
      e.preventDefault();
      const d = e.code === 'BracketLeft' || e.key === 'PageUp' ? -1 : 1;
      const o = shownPages(), i = o.indexOf(S.page);
      if (i + d < 0 || i + d >= o.length) nudge(d); else stepPage(d, { focusFirst: true });
      return;
    }
    /* 1–9: bot n */
    if (plain && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); focusBot(+e.code.slice(5)); return; }
    const nav = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && plain;
    const near = sel => t.closest && t.closest(sel);
    const inRow = near('.dk-row'), inTabs = near('.dk-dots'), inStrip = near('.dk-strip'), inGrid = near('.dk-roster');
    const step = (i, n) => e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    /* the queue at rest (Needs you): Up / Down between its rows, Enter expands (the card's own action) */
    const mini = near('.dk-v-wait-norm .cd-mini');
    if (mini && nav && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      e.preventDefault();
      const items = $$('.cd-mini', mini.closest('.dk-cards')).filter(rendered), i = items.indexOf(mini);
      rove(items, i, step(i, items.length));
      return;
    }
    if (near('hx-card')) { if (nav) e.preventDefault(); return; }   /* a card owns its keys (KEYMAP.md §6); arrows never scroll */
    const tile = near('.dk-tile');
    if (tile && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); movePage(tile.dataset.tile, e.key === 'ArrowLeft' ? -1 : 1); return; }
    /* the bot row: Left / Right / Home / End between the orbs and "+"; Up goes into the grid on the same bot; Down
       minimises (the arrows never change pages: that is [ ] and PageUp / PageDown) */
    if (inRow && nav) {
      e.preventDefault();
      if (e.key === 'ArrowUp') { up(true); return; }
      if (e.key === 'ArrowDown') { down(true); return; }
      const items = $$('.dk-bot, .dk-add', inRow), i = items.indexOf(near('.dk-bot, .dk-add'));
      S.rowIdx = rove(items, i, step(i, items.length));
      markFocus(); kick();
      return;
    }
    /* a session's switcher: Left / Right / Home / End; Enter switches (on the open bot it closes the session) */
    if (inStrip && nav) {
      e.preventDefault();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
      const items = $$('.dk-strip-bot', inStrip), i = items.indexOf(near('.dk-strip-bot'));
      rove(items, i, step(i, items.length));
      return;
    }
    /* the grid: all four arrows in 2D; Left / Right wrap by rows; Down from the last row goes back to the bot row */
    if (inGrid && nav) {
      e.preventDefault();
      const items = $$('.ui-row', inGrid), i = items.indexOf(near('.ui-row'));
      const top0 = items[0].offsetTop, cols = Math.max(1, items.findIndex(x => x.offsetTop !== top0) > 0 ? items.findIndex(x => x.offsetTop !== top0) : items.length);
      let j = i;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') j = step(i, items.length);
      else if (e.key === 'ArrowUp') j = i - cols >= 0 ? i - cols : i;
      else if (Math.floor(i / cols) === Math.floor((items.length - 1) / cols)) { S.rowIdx = i; setMode('normal', { focus: 'default' }); return; }
      else j = Math.min(i + cols, items.length - 1);
      S.rowIdx = rove(items, i, j);
      markFocus();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowRight':
        /* inside the page tablist the arrows move between pages, as tabs do; elsewhere they move nothing (and never
           scroll the page) */
        if (!inTabs) { if (nav && !near('.dk-sess-log')) e.preventDefault(); return; }
        e.preventDefault(); stepPage(e.key === 'ArrowLeft' ? -1 : 1, { focusDot: true }); break;
      case 'Home': case 'End':
        if (!inTabs) { if (nav && !near('.dk-sess-log')) e.preventDefault(); return; }
        e.preventDefault(); { const o = shownPages(); goPage(e.key === 'Home' ? o[0] : o[o.length - 1], { focusDot: true }); } break;
      case 'ArrowUp': case 'ArrowDown':
        if (near('.dk-sess-log')) return;              /* the log scrolls itself */
        e.preventDefault();
        if (!plain || S.card) return;                   /* in a session the arrows move nothing; Esc closes it */
        e.key === 'ArrowUp' ? up(true) : down(true); break;
      case 'Escape':
        /* KEYMAP.md §8: close the card, then collapse an expanded dock, then give focus back */
        e.preventDefault(); e.stopPropagation();
        if (S.mode === 'expanded' && S.card) closeCard(true);
        else if (S.mode === 'expanded' || S.mode === 'edit') setMode('normal', { focus: 'default' });
        else returnFocus();
        break;
    }
  }
  const drag = { x: 0, on: false, timer: 0, lock: 0, pid: null, sx: 0, sy: 0, axis: null, hist: [] };
  const canDrag = () => S.mode === 'normal' || S.mode === 'minimal' || (S.mode === 'expanded' && !S.card);
  /* the page follows the finger inside the slab's open lanes: ~34px toward a neighbour, ~18px (stiffer) past the
     first or last page, so content never leaves the slab; it fades a little as the swipe nears its commit point */
  const follow = (x, lim) => Math.sign(x) * lim * (1 - 1 / (Math.abs(x) * .6 / lim + 1));
  function dragTo(x) {
    const o = shownPages(), i = o.indexOf(S.page);
    const free = (x > 0 && i > 0) || (x < 0 && i < o.length - 1);
    const eff = follow(x, free ? 34 : 18);
    pageEls[S.page].style.opacity = free ? String(1 - Math.min(.35, Math.abs(x) / 200)) : '';
    let s = slides.get(S.page);
    if (!s) { s = spring(0, K_SLIDE, 1, .1); slides.set(S.page, s); }
    s.x = eff; s.t = eff; s.v = 0;
    if (!drag.on) { drag.on = true; hideTip(); resetMag(); }
    kick();
  }
  function dragRelease(vel) {
    if (!drag.on) return;
    const o = shownPages(), i = o.indexOf(S.page), dir = drag.x < 0 ? 1 : -1, j = i + dir;
    const commit = (Math.abs(drag.x) > 64 || Math.abs(vel) > .45) && j >= 0 && j < o.length;
    drag.on = false;
    if (commit) { drag.lock = performance.now() + 420; goPage(o[j], { dir }); }
    else {
      const s = slides.get(S.page); if (s) s.t = 0;
      const sec = pageEls[S.page], op = sec.style.opacity;
      sec.style.opacity = '';
      if (op && !reduce) sec.animate([{ opacity: op }, { opacity: 1 }], { duration: 160, easing: EASE });
    }
    drag.x = 0;
    kick();
  }
  /* an arrow at the first or last page answers with a short rubber-band nudge */
  function nudge(dir) {
    if (reduce) return;
    let s = slides.get(S.page);
    if (!s) { s = spring(0, K_SLIDE, 1, .1); slides.set(S.page, s); }
    s.v = -dir * 520; s.t = 0; kick();
  }
  function onTouchDown(e) {
    if (e.pointerType === 'mouse' || !canDrag() || e.target.closest('[data-ui="hold"], hx-card, .dk-tile')) return;
    drag.pid = e.pointerId; drag.sx = e.clientX; drag.sy = e.clientY; drag.axis = null; drag.hist = [[performance.now(), 0]];
  }
  function onTouchMove(e) {
    if (e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.axis && Math.hypot(dx, dy) > 8) {
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'x') { try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } }
    }
    if (drag.axis === 'x') { drag.x = dx; drag.hist.push([performance.now(), dx]); if (drag.hist.length > 6) drag.hist.shift(); dragTo(dx); }
  }
  function onTouchUp(e) {
    if (e.pointerId !== drag.pid) return;
    const dy = e.clientY - drag.sy;
    if (drag.axis === 'x') {
      const [a, b] = [drag.hist[0], drag.hist[drag.hist.length - 1]];
      dragRelease(b && a && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0);
    } else if (drag.axis === 'y' && Math.abs(dy) > 30) { dy < 0 ? up() : down(); }
    drag.pid = null; drag.axis = null;
  }
  let wheelX = 0, wheelY = 0, wheelT = 0, wheelLock = 0;
  function onWheel(e) {
    if (S.mode === 'off') return;
    if (e.target.closest && e.target.closest('.dk-sess-log, .ui-composer__input')) return;   /* they scroll themselves */
    const now = performance.now();
    if (now - wheelT > 220) { wheelX = 0; wheelY = 0; }
    wheelT = now;
    const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
    if (ax > ay || e.shiftKey) {
      /* a horizontal trackpad swipe drags the page; release (no wheel for 140ms) commits or springs back */
      e.preventDefault();
      if (now < drag.lock || !canDrag()) return;
      drag.x -= e.shiftKey && !ax ? e.deltaY : e.deltaX;
      dragTo(drag.x);
      clearTimeout(drag.timer);
      drag.timer = setTimeout(() => dragRelease(0), 140);
    } else if (ay) {
      if (now - S.hoverT < 300) return;      /* scrolling that drifts onto the dock passes by */
      e.preventDefault();
      if (now < wheelLock) return;
      wheelY += e.deltaY;
      if (wheelY < -60) { up(); wheelLock = now + 480; wheelY = 0; }
      else if (wheelY > 60) { down(); wheelLock = now + 480; wheelY = 0; }
    }
  }
  let lastItem = null;
  /* DESIGN-SYSTEM.md 13: a hovered or focused live orb turns to listening, then returns to its state */
  function listenOrb(id, on) {
    const o = av(id), b = botById(id); if (!o || !b) return;
    const r = on ? 'listening' : st(b).reaction;
    if (o.getAttribute('reaction') !== r) o.setAttribute('reaction', r);
  }
  function onPointerMove(e) {
    const t = e.target instanceof Element ? e.target : null;
    const inDock = !!(t && root.contains(t) && !root.classList.contains('is-gone'));
    if (inDock !== S.hover) { S.hover = inDock; if (inDock) S.hoverT = performance.now(); setOrbLife(); }
    const inRow = inDock && !!t.closest('.dk-v-bots-norm') && S.mode === 'normal';
    magOn = inRow;
    magPX = inRow ? e.clientX - cxNow() : null;
    inRow ? lookRow(e.clientX, e.clientY) : lookRow(null);
    const item = inRow ? t.closest('.dk-bot, .dk-add') : null;
    if (item !== lastItem) {
      if (lastItem && lastItem.classList.contains('dk-bot')) listenOrb(lastItem.dataset.id, false);
      lastItem = item;
      const o = item && item.classList.contains('dk-bot') && av(item.dataset.id);
      if (o) { listenOrb(item.dataset.id, true); if (o.blink) o.blink(); }
      kick();
    }
    if (inRow || magE > 0 || magItems.some(x => x.m !== 1)) kick();
  }
  function onFocusIn(e) {
    const el = e.target;
    if (!S.focusIn) { S.focusIn = true; cameFrom = e.relatedTarget && !root.contains(e.relatedTarget) ? e.relatedTarget : cameFrom; }
    if (el.classList && el.classList.contains('dk-bot')) listenOrb(el.dataset.id, true);
    kick();                                    /* a focused orb grows (when grow is on) */
  }
  function onFocusOut(e) {
    if (e.target.classList && e.target.classList.contains('dk-bot') && e.target !== lastItem) listenOrb(e.target.dataset.id, false);
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) S.focusIn = false;
    kick();
  }
  /* a click outside the dock returns it to rest (owner, v12): a session, the grid, an expanded page, the arrange
     view all go back to the normal row. The pill stays a pill and an off dock stays off (both are choices). The click
     is never intercepted: the dock acts after it has reached its target (so nothing moves under the pointer
     mid-click) and leaves focus where the click put it. A press that starts inside and ends outside (a drag) is
     inside; so is a press in a layer the dock opened (a library menu or popover anchored in the dock) or a tooltip.
     A session's typed text stays in its composer for the next time. */
  let outsidePress = false;
  function insideDock(t) {
    if (!(t instanceof Element)) return false;
    if (root.contains(t) || t.closest('.ui-tip')) return true;
    const layer = ui().popover.current;
    return !!(layer && layer.contains(t) && root.querySelector('[aria-expanded="true"]'));
  }
  function onDocDown(e) {
    outsidePress = !!mounted && (S.mode === 'expanded' || S.mode === 'edit') && !insideDock(e.target);
  }
  function onDocUp() {
    if (!outsidePress) return;
    outsidePress = false;
    setTimeout(() => { if (S.mode === 'expanded' || S.mode === 'edit') setMode('normal', { outside: true }); }, 0);
  }
  function onPointerDown(e) {
    onTouchDown(e);
    const tile = e.target.closest('.dk-tile');
    if (tile && !e.target.closest('button') && e.button === 0) dragTile(e, tile);
  }

  /* ------------------------------------------------------------------ fitting the column */
  /* the bot row keeps 40px orbs at a 54px pitch (LAYOUT.md §6) while the column allows it, then shrinks */
  function fitRow() {
    const vw = innerWidth;
    const avail = Math.min(S.colWidth || vw, vw) - 24;
    const n = S.bots.length, pad = vw <= 520 ? 10 : 16;
    const gapOf = o => Math.max(6, Math.round(o * 14 / 40));
    let o = 40;
    while (o > 18 && 2 * pad + n * o + n * gapOf(o) + 28 > avail) o--;
    root.style.setProperty('--dock-orb', o);
    root.style.setProperty('--dock-gap', gapOf(o) + 'px');
    root.style.setProperty('--dock-maxw', Math.max(300, avail) + 'px');
    /* the room around the centre line: a view never grows past the ground on either side (flares included), so on a
       phone, where the centre line sits left of the window's middle (the details strip), nothing runs off the edge */
    const L = (window.HX && HX.layout) || {}, cx = typeof L.centerX === 'number' ? L.centerX : cxNow();
    const left = typeof L.viewLeft === 'number' ? L.viewLeft : 0, right = typeof L.viewRight === 'number' ? L.viewRight : vw;
    const room = Math.floor(2 * (Math.min(cx - left, right - cx) - FLARE - 2));
    if (room > 0) root.style.setProperty('--dock-room', room + 'px');
    /* the live orbs carry their own --o (set when they move into a slot): re-read it, or an orb sized while the window
       was small stays small in a full-size slot (the artifact viewer mounts its frame small and then grows it) */
    if (mounted) relocateLive();
  }
  function onLayout(arg) {
    const d = detailOf(arg);
    useVar = shellVar();
    root.classList.toggle('is-self-centred', !useVar);
    if (!useVar && typeof d.centerX === 'number') {
      const snap = !layoutSeen || d.animate === false;
      if (snap) root.classList.add('is-snap');
      root.style.setProperty('--dk-cx', d.centerX + 'px');
      if (snap) { void root.offsetWidth; root.classList.remove('is-snap'); }
    }
    layoutSeen = true;
    if (d.colWidth) S.colWidth = d.colWidth;
    fitRow();
    retarget(false);
  }
  function onResize() {
    fitRow(); retarget(true);
  }

  /* ------------------------------------------------------------------ live data from the bus */
  function changedHas(d, k) {
    const ch = d.changed;
    if (!ch) return true;
    if (Array.isArray(ch)) return ch.includes(k);
    if (typeof ch === 'string') return ch === k;
    return typeof ch === 'object' ? k in ch : true;
  }
  /* HX.state.orbGrow: true or false; undefined (an older shell) means on */
  function readGrow(st) {
    const on = (st || (HXr && HXr.state) || {}).orbGrow !== false;
    if (on === S.grow && root.hasAttribute('data-grow') === on) return;
    S.grow = on;
    root.toggleAttribute('data-grow', on);
    kick();
    if (mounted) emitDock();   /* the hover headroom comes and goes with the setting */
  }
  function onState(arg) {
    const d = detailOf(arg);
    const st = d.state || (HXr && HXr.state) || {};
    if (changedHas(d, 'orbGrow')) readGrow(st);
    if (changedHas(d, 'dock') && st.dock) {
      if (st.dock === 'off' && S.mode !== 'off') setOn(false);
      else if (st.dock !== 'off' && S.mode === 'off') setOn(true);
    }
  }
  function onAttention(arg) {
    const d = detailOf(arg);
    if (!d.source || d.source === 'dock') return;
    S.ext[d.source] = +d.count || 0;
    morph(() => renderMins());
  }
  function onBotState(arg) {
    const d = detailOf(arg);
    if (d.source === 'dock') return;
    const b = botById(d.id); if (!b) return;
    if (d.state && d.state !== 'paused') b.state = d.state;
    if ('paused' in d) b.paused = !!d.paused;
    if ('attention' in d) b.attention = d.attention;
    refreshBot(b);
    paintSession(b, false);
  }
  /* hx:bot-message from the Bots tab: a message typed there, or a bot's reply. The thread is shared (HX.data.botThreads),
     so it is usually there already; an open session shows it at once */
  function onBotMessage(arg) {
    const d = detailOf(arg);
    if (d.source === 'dock' || !d.id || !d.message) return;
    const b = botById(d.id); if (!b) return;
    const D0 = D(); D0.botThreads = D0.botThreads || {};
    const th = D0.botThreads[d.id] = D0.botThreads[d.id] || [], m = d.message;
    if (!th.includes(m) && !th.some(x => x.who === m.who && x.t === m.t && x.text === m.text)) th.push({ who: m.who, t: m.t, text: m.text, via: m.via || d.source });
    paintSession(b, true);
  }
  function onApproval(arg) {
    const d = detailOf(arg);
    if (d.source === 'dock') return;
    const w = S.waits.find(x => x.id === d.id || (d.bot && x.bot === d.bot && x.kind === 'approval'));
    if (w) resolveWait(w.id, d.decision || 'approved', d.source || 'elsewhere');
  }

  /* a theme change: re-read the radius, let every orb re-resolve its colours, re-measure (fonts may change) */
  function onTheme() {
    readRadius();
    for (const o of $$('orb-avatar', root)) { const e = o.getAttribute('eye-color'); if (e) o.setAttribute('eye-color', e); const c = o.getAttribute('color'); if (c) o.setAttribute('color', c); }
    fitRow(); retarget(false); paint();
  }

  /* KEYMAP.md: the shell owns every global key (mod+G 1–9, mod+shift+J); the dock offers these hooks */
  function openBotInTab(id) {
    emit('hx:bot-select', { id, from: 'dock', source: 'dock' });
    if (HXr && HXr.setState) HXr.setState({ tab: 'bots' });
    if (S.card) closeCard(false);              /* the full chat has it now; the dock goes back to the row */
  }
  function focusBot(n) {
    const b = S.bots[n - 1]; if (!b || S.mode === 'off') return;
    const go = () => {
      const btn = curView && curView.querySelector(`.dk-bot[data-id="${b.id}"]`);
      if (!btn) return;
      const items = $$('.dk-bot, .dk-add', curView);
      items.forEach(el => { el.tabIndex = el === btn ? 0 : -1; });
      S.rowIdx = items.indexOf(btn);
      btn.focus({ preventScroll: true });
      markFocus();
    };
    if (S.mode === 'expanded' && S.page === 'bots' && !S.card && curView) {     /* in the grid: its bot n */
      const items = $$('.dk-roster .ui-row', curView), j = S.bots.indexOf(b);
      if (items[j]) { S.rowIdx = rove(items, j, j); markFocus(); return; }
    }
    if (S.page !== 'bots') goPage('bots');
    if (S.mode !== 'normal') setMode('normal');
    go();
  }
  /* the element the shell's region focus lands on: the roving bot on the bots page, else the page's first control */
  function defaultTarget() {
    if (!curView) return null;
    if (curView.dataset.view === 'bots:card') { const c = composerEls.get(S.card); if (c && c.input) return c.input; }
    return curView.querySelector('.dk-bot[tabindex="0"], .dk-add[tabindex="0"]') || curView.querySelector('.dk-roster .ui-row[tabindex="0"]') || curView.querySelector('.dk-roster .ui-row, button:not([disabled]):not([tabindex="-1"])');
  }
  function markFocus() {
    for (const el of $$('[data-hx-focus="dock"]', root)) if (el !== defaultTarget()) el.removeAttribute('data-hx-focus');
    const d = defaultTarget(); if (d) d.setAttribute('data-hx-focus', 'dock');
  }
  let cameFrom = null;
  function returnFocus() {
    const to = cameFrom && cameFrom.isConnected && !root.contains(cameFrom) ? cameFrom : [...document.querySelectorAll('[data-hx-focus="composer"]')].find(n => !root.contains(n) && rendered(n));
    if (to && typeof to.focus === 'function') to.focus({ preventScroll: true }); else if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
  }
  function focusDock() {
    const b = defaultTarget();
    if (b) b.focus({ preventScroll: true });
  }
  /* ------------------------------------------------------------------ mount */
  function mount(slotEl, hx) {
    if (mounted) return;
    HXr = hx || window.HX || null;
    if (!window.HX || !window.HX.ui || !window.HX.ui.version) throw new Error('[dock] needs components/components.js (design-system/MIGRATION.md §0) loaded before dock.js');
    if (!window.HX.cards) throw new Error('[dock] needs the card layer (cards.js) loaded before dock.js');
    slotEl = slotEl || document.getElementById('hx-dock') || document.body;
    initData();
    readRadius();
    build(slotEl);
    slabW = spring(0, K_SLAB, 1, .05); slabH = spring(0, K_SLAB, 1, .05);
    sinkS = spring(0, K_SINK, 1, .05);
    dotS = spring(0, K_DOT, 1, .05);
    useVar = shellVar();
    root.classList.toggle('is-self-centred', !useVar);
    const startOff = HXr && HXr.state && HXr.state.dock === 'off';
    S.mode = startOff ? 'off' : (S.restore === 'minimal' ? 'minimal' : 'normal');
    root.dataset.mode = S.mode;
    readGrow();
    renderAll();
    renderDots();
    fitRow();
    curView = showView(viewKey());
    mounted = true;
    relocateLive();
    setOrbLife();
    retarget(true);
    if (startOff) { snapS(sinkS); settled(); }
    paint();

    for (const ty of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) document.addEventListener(ty, onDoubleGuard, true);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('hx:card-action', onCardAction);
    root.addEventListener('hx:card-state', onCardState);
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'dk-sw-governed') toggleSetting('governed', t.checked);
      if (t.id === 'dk-sw-network') toggleSetting('network', t.checked);
    });
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('pointermove', onTouchMove);
    root.addEventListener('pointerup', onTouchUp);
    root.addEventListener('pointercancel', onTouchUp);
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('pointerup', onDocUp, true);
    document.addEventListener('pointercancel', () => { outsidePress = false; }, true);
    addEventListener('resize', onResize);
    addEventListener('hx:theme', onTheme);   /* theme.js emits on window before HX exists */
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { fitRow(); retarget(false); });
    RMQ.addEventListener && RMQ.addEventListener('change', ev => {
      reduce = ev.matches;
      if (reduce) { for (const a of anims.values()) a.el.style.transform = ''; anims.clear(); resetMag(); lookRow(null); retarget(true); }
    });
    if (HXr && HXr.on) {
      HXr.on('hx:layout', onLayout);
      HXr.on('hx:state', onState);
      HXr.on('hx:attention', onAttention);
      HXr.on('hx:bot-state', onBotState);
      HXr.on('hx:approval', onApproval);
      HXr.on('hx:bot-message', onBotMessage);
      HXr.on('hx:theme', onTheme);
      HXr.on('hx:nav', a => {
        const d = detailOf(a);
        if (d.region !== 'dock' || !curView) return;
        const all = $$('.dk-bot, button:not([disabled])', curView).filter(rendered);
        const el = d.action === 'last' ? all[all.length - 1] : all[0];
        if (el) el.focus({ preventScroll: true });
      });
    }
    setInterval(() => {
      if (!S.run || S.run.stopped || document.hidden) return;
      S.run.elapsed += 1;
      S.run.cost = Math.min(S.run.cap, S.run.cost + .0004);
      for (const el of $$('[data-run-time]', root)) el.textContent = fmtDur(S.run.elapsed);
      for (const el of $$('[data-run-cost]', root)) el.innerHTML = costHTML();
      for (const el of $$('[data-run-meter]', root)) el.innerHTML = meterHTML();
    }, 1000);
    emitDock();
  }

  /* ------------------------------------------------------------------ public */
  window.hxDock = {
    mount,
    setMode: m => setMode(m),
    setOn,
    goPage: id => goPage(id),
    focus: focusDock,
    /* KEYMAP.md §3: the n-th bot (1-based) as the dock shows them */
    botAt: n => { const b = S.bots[(+n || 0) - 1]; return b ? b.id : null; },
    openSession: id => openCard(id, false),
    closeSession: () => closeCard(false),
    openCard: id => openCard(id, false),         /* v8 names, kept */
    closeCard: () => closeCard(false),
    get state() { return { mode: S.mode, page: S.page, card: S.card, pages: S.pages.map(p => ({ ...p })), waits: S.waits.length, hover: !!S.hover, focusIn: !!S.focusIn }; },
    timeScale(f) { timeScale = clamp(+f || 1, .02, 4); },
    hover(x) { magOn = x != null; magPX = x == null ? null : x - cxNow(); S.hover = x != null; kick(); }
  };
  const api = { mount };
  const register = () => { if (window.HX && typeof window.HX.register === 'function') { window.HX.register('dock', api); return true; } return false; };
  if (!register()) document.addEventListener('DOMContentLoaded', register, { once: true });
})();
