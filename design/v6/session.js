/* hypotaxis v6 · session tab (owner: session agent)
   Built on the shared library (components/components.js, HX.ui): every button, row, chip, menu, popover, toast,
   tooltip, entry, ladder, measure, section and the composer itself come from it. What stays here is the session's
   own: its layout, its data, the feedforward reading, the inline diff, the terminal well and the keyboard of its
   regions (KEYMAP.md §3, §4, §5, §7, §9).
   Registers: `session` (#hx-view-session), `session-list` (#hx-list-session), `session-right` (#hx-right).
   Exposes: HX.session {select, newSession, openPanel}; HX.composer.create (an alias of HX.ui.composer, one release).
   Emits: hx:attention {source:'session', count, tab}, hx:session-select {id, from:'list'}, hx:title, hx:governance.
   Provides: HX.provide('stop'), HX.provide('find'). Listens: hx:state, hx:open-panel, hx:new-session,
   hx:session-select, hx:nav. Every colour, family, radius and size is a token. */
(function () {
  'use strict';

  /* ───────────── helpers ───────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach((c) => c != null && c !== '' && n.append(c));
    return n;
  }
  const frag = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const U = () => window.HX.ui;
  /* drawn corners (DESIGN-SYSTEM.md §8): the session's own surfaces take the library's continuous corner */
  if (window.HX && window.HX.ui && window.HX.ui.squircle) window.HX.ui.squircle.auto('.ss-diff, .ssr-file, .ssr-term');
  const now = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  /* data strings joined with " · " never reach the screen as dots (F22): their parts sit apart */
  const parts = (s) => String(s).split(/\s+·\s+/).map((x) => x.trim()).filter(Boolean);
  const partsEl = (s, cls) => el('span', { class: 'ss-parts' + (cls ? ' ' + cls : '') }, parts(s).map((p) => el('span', { text: p })));
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) { /* blocked on file:// */ }
    U().toast('Copied');
  }

  /* ───────────── shared state ───────────── */
  const D = () => (window.HX && HX.data) || window.HX_DATA || {};
  function emit(type, detail) { const H = window.HX; if (H && H.emit) H.emit(type, detail); }
  function on(type, fn) { const H = window.HX; if (H && H.on) H.on(type, (d) => fn(d instanceof Event ? d.detail : d)); }

  const G = { governed: true, smart: true, model: 'sonnet 5.5', cap: '$0.60', subs: new Set() };
  function setG(patch) {
    Object.assign(G, patch);
    G.subs.forEach((f) => f());
    emit('hx:governance', { governed: G.governed, smart: G.smart, model: G.model, cap: G.cap });
  }
  const LADDER_MODELS = ['qwen3-coder', 'haiku 4.5', 'sonnet 5.5', 'opus 5.5'];
  const spent = () => (D().governance || {}).spent || '$0.00';

  const CTX = { subs: new Set(), parts: null, total: 200000 };
  function ctxInit() { if (CTX.parts) return; const c = D().context || { total: 200000, parts: [] }; CTX.parts = c.parts.map((p) => p.slice()); CTX.total = c.total; }
  const ctxUsed = () => (ctxInit(), CTX.parts.reduce((a, p) => a + p[1], 0));
  function ctxBump(part, by) { ctxInit(); const p = CTX.parts.find((x) => x[0] === part); if (p) p[1] = Math.max(0, p[1] + by); CTX.subs.forEach((f) => f()); }
  const k = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  const pct = () => Math.round(ctxUsed() / CTX.total * 100);

  function setAttention(count) { emit('hx:attention', { source: 'session', count, tab: 'session' }); }

  /* ───────────── feedforward: how the agent reads decision words in the composer ───────────── */
  const DECISIONS = {
    verb: {
      re: /\b(refactor|rewrite|fix|review|migrate)\b/i, title: 'Read as',
      options: [
        { value: 'refactor', label: 'refactor', desc: 'Same behaviour, new structure', assume: '>refactor' },
        { value: 'rewrite', label: 'rewrite', desc: 'Behaviour may change; I will list how', assume: '>rewrite' },
        { value: 'fix', label: 'fix', desc: 'The smallest change that makes it right', assume: '>fix, smallest change' },
        { value: 'review', label: 'review only', desc: 'Read and comment, no edits', assume: '>review, no edits' }
      ],
      guess: (t) => (/review/i.test(t) ? 'review' : /fix/i.test(t) ? 'fix' : /rewrite/i.test(t) ? 'rewrite' : 'refactor')
    },
    path: { re: /\b(?:src|lib|app|packages|tests?)\/[\w\-./]*[\w]/, title: 'Scope', options: null, guess: (t) => t },
    tests: {
      re: /\b(run (?:the )?tests|run tests|test it)\b/i, title: 'Run',
      options: [
        { value: 'all', label: 'npm test', mono: true, desc: 'The whole suite, the gate for this repo', assume: '>npm test' },
        { value: 'scoped', label: 'npm test -- billing', mono: true, desc: 'Only the billing tests, faster', assume: '>npm test -- billing' },
        { value: 'none', label: 'Skip tests', desc: 'No test run; the PR will say so', assume: '>no test run' }
      ],
      guess: () => 'all'
    },
    pr: {
      re: /\b(open a (?:PR|pull request)|draft a PR|push (?:it|a branch))\b/i, title: 'When done',
      options: [
        { value: 'draft', label: 'Draft a PR', desc: 'You mark it ready', assume: '>draft a PR' },
        { value: 'ready', label: 'Open a ready PR', desc: 'Asks atlas for a review', assume: '>ready PR' },
        { value: 'branch', label: 'Push the branch only', desc: 'No PR yet', assume: '>push branch, no PR' }
      ],
      guess: (t) => (/push/i.test(t) ? 'branch' : 'draft')
    },
    cost: {
      re: /\b(cheap(?:ly)?|balanced|thorough(?:ly)?)\b/i, title: 'Spend',
      options: [
        { value: 'cheap', label: 'Cheap', desc: 'Start on qwen3-coder, climb on failure', start: 'qwen' },
        { value: 'balanced', label: 'Balanced', desc: 'Start on haiku 4.5', start: 'haiku' },
        { value: 'thorough', label: 'Thorough', desc: 'Start on sonnet 5.5', start: 'sonnet' }
      ],
      guess: (t) => (/balanced/i.test(t) ? 'balanced' : /thorough/i.test(t) ? 'thorough' : 'cheap')
    }
  };
  const pathOptions = (t) => {
    const p = t.split('/'), o = [{ value: t, label: t, mono: true, desc: 'Only this folder', assume: '>' + t }];
    if (p.length > 1) o.push({ value: p[0], label: p[0], mono: true, desc: 'The whole ' + p[0] + ' tree', assume: '>' + p[0] });
    o.push({ value: t + '+tests', label: t + ' and its tests', mono: true, desc: 'Tests may change too', assume: '>' + t + ' + tests' });
    return o;
  };
  const optionsFor = (kind, text) => (kind === 'path' ? pathOptions(text) : DECISIONS[kind].options);
  function costAssume(costVal) {
    if (!G.governed) return '>ungoverned, pinned to ' + G.model;
    if (!G.smart) return '>governed starts on ' + G.model.split(' ')[0];
    return '>governed starts on ' + (DECISIONS.cost.options.find((x) => x.value === costVal) || DECISIONS.cost.options[0]).start;
  }

  /* a reading of a request: words that are decisions, what each is taken to mean, which ones were confirmed */
  function makeReader() {
    const readings = new Map(); /* "kind|text" -> {value, confirmed, dropped} */
    function hits(text) {
      const out = [];
      for (const kind in DECISIONS) {
        const re = new RegExp(DECISIONS[kind].re.source, 'gi'); let m;
        while ((m = re.exec(text))) {
          if (out.some((h) => m.index < h.end && m.index + m[0].length > h.start)) continue;
          out.push({ kind, start: m.index, end: m.index + m[0].length, text: m[0] });
          if (kind === 'cost' || kind === 'verb') break;
        }
      }
      return out.sort((a, b) => a.start - b.start);
    }
    function reading(kind, text) {
      const key = kind + '|' + text.toLowerCase();
      if (!readings.has(key)) readings.set(key, { value: DECISIONS[kind].guess(text), confirmed: false, dropped: false });
      return readings.get(key);
    }
    return {
      reading,
      clear: () => readings.clear(),
      marks: (text) => hits(text).filter((h) => !reading(h.kind, h.text).dropped).map((h) => ({ text: h.text, kind: h.kind, confirmed: reading(h.kind, h.text).confirmed })),
      /* the assumptions, as items for the composer's row: each points back to the word it reads */
      items(text) {
        const out = []; let cost = null, costHit = null;
        const hs = hits(text);
        hs.forEach((h) => {
          const r = reading(h.kind, h.text); if (r.dropped) return;
          if (h.kind === 'cost') { cost = r.value; costHit = h; return; }
          const o = optionsFor(h.kind, h.text).find((x) => x.value === r.value);
          if (o && !out.some((x) => x.label === o.assume)) out.push({ label: o.assume, kind: h.kind, text: h.text });
        });
        if (hs.length || !G.governed || !G.smart) out.push({ label: costAssume(cost), kind: costHit ? 'cost' : 'governance', text: costHit ? costHit.text : '' });
        return out;
      }
    };
  }

  /* ───────────── the composer: the library's, with the session's chips, reading and keys ───────────── */
  function sessionComposer(opts) {
    const reader = makeReader();
    const gov = U().chip({ label: 'Governed', icon: 'ladder', pressed: G.governed });
    const smart = U().chip({ label: 'Smart', icon: 'spark', pressed: G.smart });
    /* the model chip carries the provider's mark (mono), through the library's one primitive */
    const model = U().chip({ model: G.model, haspopup: 'menu', expanded: false });
    const c = U().composer({
      placeholder: 'Describe the change', label: 'Message the coding agent', value: opts.draft || '',
      chips: [gov, smart, model], spend: { spent: spent(), cap: G.cap },
      hint: (t) => (t ? reader.items(t) : []), feedforward: (t) => reader.marks(t)
    });
    gov.setAttribute('aria-keyshortcuts', 'Alt+G'); smart.setAttribute('aria-keyshortcuts', 'Alt+S'); model.setAttribute('aria-keyshortcuts', 'Alt+M');
    function sync() {
      gov.setAttribute('aria-pressed', String(G.governed)); gov.querySelector('span').textContent = G.governed ? 'Governed' : 'Ungoverned';
      gov.setAttribute('data-tip', G.governed ? 'Climbs the model ladder, stops at ' + G.cap : 'Pinned to ' + G.model + ', no cap'); gov.setAttribute('data-kbd', 'alt+G');
      gov.setAttribute('aria-label', G.governed ? 'Governed: starts cheap, climbs the model ladder on failure, stops at the cost cap' : 'Ungoverned: one pinned model, no cost cap');
      smart.setAttribute('aria-pressed', String(G.smart)); smart.setAttribute('data-tip', G.smart ? 'Picks the model for each message' : 'You pick the model'); smart.setAttribute('data-kbd', 'alt+S');
      if (G.smart && model.contains(document.activeElement)) c.focus();   /* never drop focus with the chip */
      model.hidden = G.smart; model.querySelector('span').textContent = G.model; if (U().modelMark) U().modelMark.swap(model, G.model); model.setAttribute('aria-label', 'Model: ' + G.model); model.setAttribute('data-tip', 'Model'); model.setAttribute('data-kbd', 'alt+M');
      c.setSpend(spent(), G.governed ? G.cap : null);
      c.refresh();
    }
    gov.addEventListener('ui:change', (e) => { e.preventDefault(); setG({ governed: !G.governed }); c.flashHint(); });
    smart.addEventListener('ui:change', (e) => { e.preventDefault(); setG({ smart: !G.smart }); c.flashHint(); });
    function openModel() {
      U().menu.open(model, [{ title: 'Model' }].concat(LADDER_MODELS.map((m) => ({ label: m, value: m, mono: true, model: m, checked: m === G.model }))), { place: 'above', label: 'Model', onSelect: (v) => { setG({ model: v }); c.flashHint(); } });
    }
    model.addEventListener('click', openModel);
    G.subs.add(sync);

    /* a dashed word, or an assumption: what it is read as */
    function openReading(anchor, kind, text) {
      if (kind === 'governance' || !text) { U().menu.open(anchor, [{ title: 'Governance' }, { label: 'Governed', value: 'on', checked: G.governed, desc: 'Start cheap, climb on failure' }, { label: 'Ungoverned', value: 'off', checked: !G.governed, desc: 'One pinned model, no cap' }], { place: 'above', onSelect: (v) => setG({ governed: v === 'on' }) }); return; }
      const r = reader.reading(kind, text);
      const items = [{ title: DECISIONS[kind].title + ' "' + text + '"' }].concat(optionsFor(kind, text).map((o) => ({ label: o.label, value: o.value, desc: o.desc, mono: o.mono, checked: o.value === r.value })), [{ foot: 'Dashed: my guess. Solid: your choice.' }]);
      U().menu.open(anchor, items, { place: 'above', label: 'How to read ' + text, onSelect: (v) => { r.value = v; r.confirmed = true; c.refresh(); c.flashHint(); requestAnimationFrame(() => c.focus()); } });
    }
    c.addEventListener('ui:decision', (e) => openReading(e.detail.el, e.detail.kind, e.detail.text));
    c.addEventListener('ui:assumption', (e) => openReading(e.detail.el, e.detail.item.kind, e.detail.item.text));
    c.addEventListener('ui:assumption-drop', (e) => { const it = e.detail.item; if (it.kind === 'governance') return; if (it.text) reader.reading(it.kind, it.text).dropped = true; U().announce('Dropped ' + it.label); });

    /* attach */
    if (c.attach) c.attach.addEventListener('click', () => {
      const bots = (D().bots || []).slice(0, 3);
      U().menu.open(c.attach, [
        { label: 'Attach a file', value: 'file', icon: 'file' }, { label: 'Add a folder to context', value: 'folder', icon: 'folder' }, '-',
        ...bots.map((b) => ({ label: 'Ask ' + b.name, value: '@' + b.name, desc: cap1(b.role), icon: 'at' })), '-',
        { label: 'Commands', value: '/', icon: 'slash' }
      ], { place: 'above', label: 'Attach', onSelect: (v) => {
        requestAnimationFrame(() => {
          if (v === 'file') { c.addFile('invoices-sample.csv'); c.focus(); }
          else if (v === 'folder') { c.addFile('src/billing/fixtures'); c.focus(); }
          else c.insert((c.value && !/\s$/.test(c.value) ? ' ' : '') + v + (v === '/' ? '' : ' '));
        });
      } });
    });
    /* dictation, mocked */
    c.addEventListener('ui:dictate', (e) => {
      clearTimeout(c._dict);
      if (e.detail.value) c._dict = setTimeout(() => { if (c.mic.getAttribute('aria-pressed') === 'true') { c.mic.click(); c.insert((c.value && !/\s$/.test(c.value) ? ' ' : '') + 'and update the changelog'); } }, 2200);
    });
    /* KEYMAP §7: alt+G, alt+S, alt+M (alt+A and the rest are the library's) */
    c.addEventListener('keydown', (e) => {
      if (!e.altKey || modKey(e) || e.shiftKey) return;
      if (e.code === 'KeyG') { e.preventDefault(); gov.click(); }
      else if (e.code === 'KeyS') { e.preventDefault(); smart.click(); }
      else if (e.code === 'KeyM') { e.preventDefault(); if (G.smart) setG({ smart: false }); requestAnimationFrame(openModel); }
    });
    c.addEventListener('ui:send', () => { reader.clear(); });
    sync();
    return c;
  }

  /* HX.composer.create: the old entry point, kept for one release; the composer itself is HX.ui.composer */
  function legacyCreate(opts) {
    opts = opts || {};
    const c = U().composer({ placeholder: opts.placeholder, label: opts.label, value: opts.draft || '', attach: opts.attach !== false });
    c.addEventListener('ui:send', (e) => { if (opts.onSend && opts.onSend(e.detail.text, {}) === false) e.preventDefault(); });
    c.addEventListener('ui:stop', () => { opts.onStop && opts.onStop(); c.setRunning(false); });
    if (opts.autofocus) requestAnimationFrame(() => c.focus());
    return { el: c, input: c.input, getText: () => c.value, setText: (t) => c.setValue(t), focus: () => c.focus(), clear: () => c.setValue(''), setRunning: (v) => c.setRunning(v), place() {}, destroy: () => c.remove() };
  }

  /* ───────────── conversation content ───────────── */
  const STEPS = [
    { title: 'Read 9 files in src/billing', meta: ['qwen3-coder'], time: '0:18' },
    { title: 'Moved the proration helpers to integer cents', meta: ['qwen3-coder'], time: '0:52' },
    { title: 'npm test -- billing', mono: true, meta: ['1 failed', 'invoice.test.ts, rounds per line item'], time: '0:21', kind: 'fail' },
    { title: 'Rolled back invoice.ts and escalated to sonnet 5.5', meta: ['Governance, after a failed gate'], time: '0:09', kind: 'escalate' },
    { title: 'Rounded once per invoice and added the property test', meta: ['sonnet 5.5'], time: '1:58' },
    { title: 'npm test', mono: true, meta: ['142 passed'], time: '0:04' }
  ];
  /* the blank's options as the phrase that fills the gap, and the sentence each one rewrites the question into */
  const BLANK = {
    short: 'Keep the old name prorate?',
    options: ['as a deprecated alias', 'for one release', 'removed now'],
    from: { 'keep as deprecated alias': 'as a deprecated alias', 'keep for one release': 'for one release', 'remove it now': 'removed now' },
    sentence: {
      'as a deprecated alias': ['Keeping `prorate`', 'that forwards to `prorateCents`.', "+/** @deprecated use prorateCents */\n+export const prorate = prorateCents;"],
      'for one release': ['Keeping `prorate`', ', then removing it. The changelog says so.', "+/** @deprecated removed in the next minor */\n+export const prorate = prorateCents;"],
      'removed now': ['`prorate` is', '. The public API exports only `prorateCents`.', null]
    }
  };
  function diffFiles(answer) {
    const s = BLANK.sentence[answer] || BLANK.sentence['as a deprecated alias'], alias = s[2];
    return [
      { path: 'src/billing/money.ts', add: 41, del: 0, hunks: [['@@ -0,0 +1,7 @@', [
        "+export type Cents = number & { readonly __brand: 'Cents' };", '+', '+export const toCents = (amount: number): Cents =>', '+  Math.round(amount * 100) as Cents;', '+',
        '+export const roundHalfAway = (x: number): Cents =>', '+  (Math.sign(x) * Math.round(Math.abs(x))) as Cents;']]] },
      { path: 'src/billing/prorate.ts', add: 27, del: 44, hunks: [['@@ -12,10 +12,12 @@ export function', [
        ' export function prorateCents(total: Cents, used: number, days: number): Cents {', '-  const daily = amount / days;', '-  return Math.round(daily * used * 100) / 100;',
        '+  return roundHalfAway((total * used) / days);', ' }'].concat(alias ? alias.split('\n') : ['-export const prorate = prorateCents;'])]] },
      { path: 'src/billing/invoice.ts', add: 9, del: 27, hunks: [['@@ -84,7 +84,4 @@ function total', [
        '   const lines = invoice.lines.map(toCents);', '-  const parts = lines.map((l) => Math.round(l / periods) * periods);', '-  return parts.reduce((a, b) => a + b, 0) / 100;',
        '+  return fromCents(prorateCents(sum(lines), used, days));']]] },
      { path: 'src/billing/prorate.test.ts', add: 19, del: 0, hunks: [['@@ -40,0 +41,6 @@', [
        '+test.prop([fc.integer({ min: 1, max: 10_000_00 }), fc.array(fc.nat(31))])(', "+  'splitting a window never changes the total',", '+  (total, cuts) => {', '+    expect(sumSplits(total, cuts)).toBe(total);', '+  }', '+);']]] }
    ];
  }
  const splitPath = (p) => { const i = p.lastIndexOf('/') + 1; return [p.slice(0, i), p.slice(i)]; };
  const counts = (add, del) => el('span', { class: 'ss-n ui-mono' }, [el('span', { class: 'ss-add', text: '+' + add }), el('span', { class: 'ss-del', text: '−' + del })]);
  const chevron = () => frag(U().icon('chevron', { class: 'ss-chev' }));
  function renderDiff(files, openFirst, bare) {
    const wrap = el('div', { class: 'ss-diff' + (bare ? ' ss-diff--bare' : '') });
    files.forEach((f, i) => {
      const [dir, base] = splitPath(f.path), open = !!(openFirst && i === 0);
      const file = el('div', { class: 'ss-diff-file', 'data-open': String(open) });
      const head = el('button', { class: 'ss-diff-head', type: 'button', 'aria-expanded': String(open) }, [chevron(), el('span', { class: 'ss-path ui-mono' }, [el('span', { class: 'ss-dir', text: dir }), base]), counts(f.add, f.del)]);
      head.addEventListener('click', () => { const o = file.dataset.open !== 'true'; file.dataset.open = String(o); head.setAttribute('aria-expanded', String(o)); });
      const body = el('div', { class: 'ss-diff-body ui-mono', role: 'region', 'aria-label': 'Diff of ' + f.path });
      f.hunks.forEach(([h, lines]) => {
        body.append(el('div', { class: 'ss-dl hunk', text: h }));
        let n = +((h.match(/\+(\d+)/) || [0, 1])[1]);
        lines.forEach((l) => {
          const s = l[0];
          body.append(el('div', { class: 'ss-dl ' + (s === '+' ? 'add' : s === '-' ? 'del' : '') }, [el('span', { class: 'ln', text: s === '-' ? '' : String(n++) }), el('span', { class: 'sg', text: s === ' ' ? '' : s }), el('span', { text: l.slice(1) })]));
        });
      });
      file.append(head, body); wrap.append(file);
    });
    return wrap;
  }

  /* other sessions: one exchange each */
  const HISTORIES = {
    s2: { user: 'webhooks retry forever when the provider times out. cap retries and make the handlers idempotent.', at: '12:10', model: 'haiku 4.5', time: '1m 50s', cost: '$0.06', steps: 4,
      paras: ['Retries now stop after 5 attempts with exponential backoff. Every handler checks `Idempotency-Key` before it writes, so a repeated delivery returns `200` and changes nothing.'] },
    s3: { user: 'add a csv export for the audit log, filtered by date range.', at: 'Tue', model: 'qwen3-coder', time: '58s', cost: '$0.02', steps: 3,
      paras: ['`GET /audit/export?from=&to=` streams a CSV in pages of 1,000 rows. The date filter uses the existing index on `created_at`.'] },
    s4: { user: 'tighten the pricing page copy, keep the three plans.', at: 'Tue', model: 'sonnet 5.5', time: '41s', cost: '$0.03', steps: 2,
      paras: ['The plan names stay. Each plan now leads with its price and the one limit that decides it, and the comparison table lost two rows nobody asked about.'] },
    s5: { user: 'the ios build fails on the macos vm, find out why.', at: 'Mon', model: 'qwen3-coder → sonnet 5.5', time: '6m 12s', cost: '$0.41', steps: 7,
      paras: ['The VM ships Xcode 16.0 and the project needs 16.1 for the `iOS 18.1` SDK. Pinning the runner image fixes the build; I left the change on a branch.'] }
  };

  /* ───────────── the session view ───────────── */
  const VIEW = { root: null, scroll: null, col: null, composer: null, current: 's1', blank: null, diffOpen: false, runTimer: 0, extra: [] };
  const sessionsState = { list: null, archived: [], subs: new Set() };
  function sessions() { if (!sessionsState.list) sessionsState.list = (D().sessions || []).map((s) => Object.assign({}, s, s.id === 's1' ? { running: false } : null)); return sessionsState.list; }
  function changed() { sessionsState.subs.forEach((f) => f()); }

  /* a turn: the library's entry, marked for the keyboard (KEYMAP §3.2): data-hx-turn, roving tabindex, a name */
  function turn(o) {
    const art = U().entry({ kind: o.kind, callno: o.callno, steps: o.steps, label: o.label });
    art.setAttribute('data-hx-turn', ''); art.tabIndex = -1;
    const body = art.querySelector('.ui-entry__body'), callno = art.querySelector('.ui-callno');
    (o.body || []).forEach((n) => body.append(n));
    if (o.copy) callno.append(el('span', { class: 'ss-acts' }, U().iconButton({ icon: 'copy', label: o.kind === 'user' ? 'Copy message' : 'Copy answer', size: 's', keys: 'C' })));
    art._md = o.md; art._kind = o.kind; art._text = o.text;
    const cp = callno.querySelector('.ss-acts button'); if (cp) cp.addEventListener('click', () => copyText(art._md()));
    return art;
  }
  function userTurn(text, at) {
    return turn({ kind: 'user', callno: ['You', at], label: 'You, ' + at, body: [U().request(text)], copy: true, md: () => '> ' + text, text });
  }
  const modelLines = (model) => String(model).split(/\s*→\s*/).map((m, i) => (i ? '→ ' : '') + m);
  const modelSay = (model) => String(model).split(/\s*→\s*/).join(' then ');
  function prose(paras, bullets) {
    const p = el('div', { class: 'ui-prose' });
    (paras || []).forEach((t) => p.append(el('p', { html: U().html.inline(t) })));
    if (bullets) p.append(el('ul', {}, bullets.map((b) => el('li', { html: U().html.inline(b) }))));
    return p;
  }
  const mdOf = (node) => node.innerText.replace(/\n{3,}/g, '\n\n');

  /* the blank: the card layer's inline blank, set in the sentence; answering rewrites the sentence around it */
  function blankSentence(q) {
    const p = el('p', { class: 'ss-q' });
    const card = U().card('blank', { question: q.question, short: BLANK.short, options: BLANK.options, answer: VIEW.blank || undefined, state: VIEW.blank ? 'answered' : undefined }, { size: 'inline' });
    const lead = el('span'), tail = el('span');
    function fill() {
      const a = VIEW.blank, s = a && (BLANK.sentence[a] || ['Your answer:', '. I will follow it before the PR.']);
      lead.innerHTML = a ? U().html.inline(s[0]) + ' ' : esc(q.question) + ' ';
      tail.innerHTML = a ? (/^[.,;]/.test(s[1]) ? '' : ' ') + U().html.inline(s[1]) : '';
      requestAnimationFrame(() => { const b = card.querySelector('button'); if (b) b.toggleAttribute('data-hx-attention', !a); });
    }
    card.addEventListener('hx:card-state', (e) => {
      if (e.detail.card !== card || e.detail.state !== 'answered') return;
      const first = !VIEW.blank;
      VIEW.blank = (e.detail.data && e.detail.data.answer) || card._d && card._d.answer;
      fill(); setAttention(0); changed(); RIGHT.refresh && RIGHT.refresh();
      if (first) showShip(true); else if (VIEW.diffOpen) refreshDiff();
    });
    fill();
    p.append(lead, card, tail);
    p._card = card;
    return p;
  }

  function shipData() { const m = (D().conversation || []).find((x) => x.ship); return Object.assign({}, m && m.ship); }
  function buildShip() {
    const holder = el('div', { class: 'ss-ship' });
    const card = U().card('ship', Object.assign(shipData(), { files: (D().changes || []).map((c) => c.slice()) }), { size: 'inline' });
    card.addEventListener('hx:card-action', (e) => {
      const a = e.detail && e.detail.action;
      if (a === 'view-diff') { e.preventDefault(); toggleDiff(e.composedPath()[0].closest && e.composedPath()[0].closest('button')); }
      if (a === 'open-pr') { const t = (D().todos || []).find((x) => x[0] === 'draft PR'); if (t) t[1] = 'done'; RIGHT.refresh && RIGHT.refresh(); }
    });
    holder.append(card, el('div', { class: 'ss-diff-slot' }));
    VIEW.ship = holder;
    return holder;
  }
  function toggleDiff(btn, force) {
    VIEW.diffOpen = force != null ? force : !VIEW.diffOpen;
    btn = btn || (VIEW.ship && VIEW.ship.querySelector('[data-action="view-diff"]'));
    if (btn) { btn.setAttribute('aria-expanded', String(VIEW.diffOpen)); const l = btn.querySelector('span') || btn; l.textContent = VIEW.diffOpen ? 'Hide diff' : 'View diff'; }
    refreshDiff();
    if (VIEW.diffOpen) setTimeout(() => scrollToEl(VIEW.ship.querySelector('.ss-diff-slot'), 96), 60);
  }
  function refreshDiff() { const slot = VIEW.ship && VIEW.ship.querySelector('.ss-diff-slot'); if (slot) slot.replaceChildren(VIEW.diffOpen ? renderDiff(diffFiles(VIEW.blank), true) : ''); }
  function scrollToEl(node, offset) {
    if (!node || !VIEW.scroll) return;
    VIEW.scroll.scrollTo({ top: node.getBoundingClientRect().top - VIEW.scroll.getBoundingClientRect().top + VIEW.scroll.scrollTop - offset, behavior: reduced() ? 'auto' : 'smooth' });
  }
  function showShip(animate) {
    if (!VIEW.reveal || VIEW.reveal.childElementCount) return;
    VIEW.reveal.append(buildShip()); VIEW.reveal.hidden = false;
    if (!animate || reduced()) VIEW.reveal.classList.add('is-in');
    else requestAnimationFrame(() => requestAnimationFrame(() => VIEW.reveal.classList.add('is-in')));
  }

  function assistantTurn(a) {
    const id = 'ss-steps-' + Math.random().toString(36).slice(2, 7);
    const p = prose(a.paragraphs, a.bullets);
    if (a.blank) p.append(blankSentence(a.blank));
    VIEW.reveal = el('div', { class: 'ss-reveal', hidden: true });
    const t = turn({
      kind: 'agent', callno: modelLines(a.model).concat([a.time, a.cost]), steps: { count: a.steps, id },
      label: modelSay(a.model) + ', ' + a.time + ', ' + a.cost, body: [U().steps(STEPS, { id, hidden: true }), p, a.ship ? VIEW.reveal : null].filter(Boolean),
      copy: true, md: () => mdOf(p)
    });
    if (VIEW.blank) showShip(false);
    if (VIEW.diffOpen) refreshDiff();
    return t;
  }
  function historyTurn(h) {
    const p = prose(h.paras);
    return turn({ kind: 'agent', callno: modelLines(h.model).concat([h.time, h.cost, h.steps + ' steps']), label: modelSay(h.model) + ', ' + h.time + ', ' + h.cost, body: [p], copy: true, md: () => mdOf(p) });
  }

  function renderConversation() {
    const col = VIEW.col; col.replaceChildren();
    VIEW.reveal = null; VIEW.ship = null;
    const s = sessions().find((x) => x.id === VIEW.current);
    if (VIEW.current === 's1') {
      (D().conversation || []).forEach((m) => col.append(m.role === 'user' ? userTurn(m.text, '14:01') : assistantTurn(m)));
      VIEW.extra.forEach((t) => col.append(t));
    } else if (HISTORIES[VIEW.current]) {
      const h = HISTORIES[VIEW.current];
      col.append(userTurn(h.user, h.at), historyTurn(h));
    } else {
      col.append(U().empty({ title: 'What should change in ' + (s ? s.project : 'billing-api') + '?', text: 'Words I will act on get a dashed underline as you type. Click one, or press alt and down arrow on it, to change how I read it.' }));
    }
    rove(lastTurn());
    setAttention(VIEW.current === 's1' && !VIEW.blank ? 1 : 0);
  }
  const turns = () => [...VIEW.col.querySelectorAll('[data-hx-turn]')];
  const lastTurn = () => turns().slice(-1)[0];
  function rove(t, focus) {
    turns().forEach((x) => { x.tabIndex = x === t ? 0 : -1; x.toggleAttribute('data-hx-focus', false); });
    if (!t) return;
    t.setAttribute('data-hx-focus', 'messages');
    if (focus) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
  }

  /* KEYMAP §5: the conversation's keys, on a focused turn */
  function onTurnKey(e) {
    const t = e.target.closest && e.target.closest('[data-hx-turn]');
    if (!t || modKey(e) || e.altKey) return;
    /* on the turn itself every key; on a control inside it only the letters (Enter and arrows stay the control's) */
    const self = e.target === t, key = e.key;
    if (!self && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !/^[jkcedbo]$/.test(key))) return;
    const list = turns(), i = list.indexOf(t);
    const go = (n) => { e.preventDefault(); rove(list[Math.max(0, Math.min(list.length - 1, n))], true); };
    if (key === 'ArrowDown' || key === 'j') return go(i + 1);
    if (key === 'ArrowUp' || key === 'k') return go(i - 1);
    if (key === 'Home') return go(0);
    if (key === 'End' || (key === 'G' && e.shiftKey)) return go(list.length - 1);
    if (key === 'Enter' || key === 'o') { const d = t.querySelector('.ui-disclosure'); if (d) { e.preventDefault(); d.click(); } return; }
    if (key === 'c') { e.preventDefault(); copyText(t._md ? t._md() : t.innerText); return; }
    if (key === 'e' && t._kind === 'user') { e.preventDefault(); VIEW.composer.setValue(t._text); VIEW.composer.focus(); return; }
    if (key === 'd') {
      const ship = t.querySelector('.ss-ship');
      if (ship) { e.preventDefault(); toggleDiff(null, true); requestAnimationFrame(() => { const h = ship.querySelector('.ss-diff-head'); h && h.focus(); }); }
      else if (t.querySelector('.ui-entry__body')) { e.preventDefault(); openPanel('changes'); }
      return;
    }
    if (key === 'b') { const b = t.querySelector('hx-card[kind="blank"] button, .ss-q hx-card button'); if (b) { e.preventDefault(); b.click(); } }
  }

  /* find in this conversation (mod+F through the shell's provider) */
  function openFind() {
    if (!VIEW.col || !VIEW.root.closest('.hx-view.is-active, :not(.hx-view)')) return false;
    const field = U().field({ label: 'Find in this conversation', placeholder: 'Words in a message or an answer' });
    const input = field.querySelector('input'), hint = el('p', { class: 'ss-find-count', 'aria-live': 'polite' });
    const box = el('div', { class: 'ss-find' }, [field, hint]);
    let hits = [], at = -1;
    const run = (dir) => {
      const q = input.value.trim().toLowerCase();
      hits = q ? turns().filter((t) => t.innerText.toLowerCase().includes(q)) : [];
      if (!hits.length) { hint.textContent = q ? 'No matches' : ''; return; }
      at = (at + dir + hits.length) % hits.length;
      hint.textContent = (at + 1) + ' of ' + hits.length;
      rove(hits[at]); hits[at].scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    };
    input.addEventListener('input', () => { at = -1; run(1); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.altKey && hits[at]) { U().popover.close(false); hits[at].focus(); } else run(e.shiftKey ? -1 : 1); } });
    U().popover.open(VIEW.findAnchor, box, { label: 'Find in this conversation', align: 'end', onClose: () => { const t = turns().find((x) => x.tabIndex === 0) || lastTurn(); if (t && !VIEW.root.contains(document.activeElement)) t.focus({ preventScroll: true }); } });
    return true;
  }

  /* a new message in this mock: a live call number and steps, then a short answer */
  function runTurn(text) {
    if (VIEW.current !== 's1' && !HISTORIES[VIEW.current]) VIEW.col.replaceChildren();
    const meta = { assume: VIEW.lastAssume || [], governed: G.governed, smart: G.smart, model: G.model };
    const u = userTurn(text, now()); VIEW.col.append(u);
    const start = meta.governed && meta.smart ? (meta.assume.join(' ').match(/starts on (\w+)/) || [0, 'qwen'])[1] : meta.model.split(' ')[0];
    const model = { qwen: 'qwen3-coder', haiku: 'haiku 4.5', sonnet: 'sonnet 5.5', opus: 'opus 5.5' }[start] || meta.model;
    const id = 'ss-steps-' + Math.random().toString(36).slice(2, 7);
    const ol = U().steps([], { id });
    const t = turn({ kind: 'agent', callno: [model, '0s'], steps: { count: 0, id, open: true }, label: model + ', working', body: [ol] });
    t.setAttribute('aria-busy', 'true');
    const disc = t.querySelector('.ui-disclosure'), timeEl = t.querySelector('.ui-callno span');
    disc.querySelector('span').textContent = 'Working'; disc.prepend(frag(U().html.dot('run')));
    VIEW.col.append(t);
    if (VIEW.current === 's1') VIEW.extra.push(u, t);
    const sess = sessions().find((x) => x.id === VIEW.current); if (sess) { sess.running = true; sess.when = 'now'; changed(); }
    VIEW.composer.setRunning(true); VIEW.running = true;
    VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
    const skip = meta.assume.includes('>no test run');
    const steps = [
      { title: 'Read ' + (meta.assume.find((x) => x.startsWith('>src')) || '>src/billing').slice(1), meta: [model], time: '0:06' },
      { title: 'Edited 3 files', meta: [model], time: '0:21' },
      { title: skip ? 'Skipped tests, as asked' : 'npm test', mono: !skip, meta: skip ? null : ['142 passed'], time: '0:05' }
    ];
    let i = 0, secs = 0;
    const tick = setInterval(() => { secs++; timeEl.textContent = secs + 's'; }, 1000);
    const next = () => { if (i < steps.length) { ol.insertAdjacentHTML('beforeend', U().html.steps([steps[i++]]).replace(/^<ol[^>]*>|<\/ol>$/g, '')); VIEW.runTimer = setTimeout(next, 900); return; } finish(false); };
    const finish = (stopped) => {
      clearInterval(tick); clearTimeout(VIEW.runTimer); VIEW.runTimer = 0; VIEW.stopRun = null; VIEW.running = false;
      const total = steps.slice(0, i).reduce((a, st) => a + (+st.time.split(':')[0]) * 60 + (+st.time.split(':')[1]), 0);
      const cost = '$0.0' + (i + 1);
      timeEl.textContent = (total || secs || 1) + 's'; timeEl.after(el('span', { text: cost }));
      disc.replaceChildren(frag(U().icon('chevron')), el('span', { text: (stopped ? 'Stopped after ' : '') + i + ' steps' }));
      disc.setAttribute('aria-expanded', 'false'); ol.hidden = true;
      t.removeAttribute('aria-busy'); t.setAttribute('aria-label', model + ', ' + (total || secs) + 's, ' + cost);
      const p = prose([stopped ? 'Stopped. Nothing was committed; the edits so far are under Changes.' :
        'Done. The helpers in `src/billing` take and return `Cents`. ' + (skip ? 'Tests were skipped.' : 'All 142 tests pass.') + (meta.assume.some((x) => /PR/.test(x)) ? ' The draft PR is ready for you.' : '')]);
      t.querySelector('.ui-entry__body').append(p); t._md = () => mdOf(p);
      t.querySelector('.ui-callno').append(el('span', { class: 'ss-acts' }, U().iconButton({ icon: 'copy', label: 'Copy answer', size: 's', keys: 'C' })));
      t.querySelector('.ss-acts button').addEventListener('click', () => copyText(t._md()));
      if (sess) { sess.running = false; changed(); }
      VIEW.composer.setRunning(false);
      rove(t);
      ctxBump('conversation', 3000);
      VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
      U().announce(stopped ? 'Stopped' : 'Answer ready');
    };
    VIEW.stopRun = () => finish(true);
    VIEW.runTimer = setTimeout(next, 700);
  }

  function selectSession(id, opts) {
    if (VIEW.stopRun) VIEW.stopRun();
    VIEW.current = id;
    if (VIEW.col) { renderConversation(); VIEW.scroll.scrollTop = 0; }
    const s = sessions().find((x) => x.id === id);
    if (!(opts && opts.quiet)) emit('hx:session-select', { id, from: 'list', title: s ? s.title : '', project: s ? s.project : '' });
    emit('hx:title', { title: s ? s.title : '', project: s ? s.project : '', tab: 'session' });
    changed();
    if (opts && opts.focus && VIEW.composer) VIEW.composer.focus();
  }
  function newSession(project) {
    project = project || (sessions().find((s) => s.id === VIEW.current) || {}).project || 'billing-api';
    const id = 'n' + Date.now().toString(36);
    sessions().unshift({ id, project, title: 'New session', when: 'now' });
    selectSession(id, { focus: true });
  }

  function mountView(root) {
    VIEW.root = root;
    root.classList.add('ss-view');
    VIEW.scroll = el('div', { class: 'ss-scroll' });
    VIEW.findAnchor = el('span', { class: 'ss-find-anchor', 'aria-hidden': 'true' });
    VIEW.col = el('div', { class: 'ss-col', role: 'feed', 'aria-label': 'Conversation' });
    VIEW.scroll.append(VIEW.col);
    root.replaceChildren(VIEW.findAnchor, VIEW.scroll);
    VIEW.col.addEventListener('keydown', onTurnKey);
    VIEW.col.addEventListener('focusin', (e) => { const t = e.target.closest('[data-hx-turn]'); if (t && e.target === t) rove(t); });
    renderConversation();
    const c = VIEW.composer = sessionComposer({ draft: D().composerDraft || '' });
    const host = el('div', { class: 'ss-composer' }, c);
    root.append(host);
    c.addEventListener('ui:send', (e) => { VIEW.lastAssume = (c.querySelector('.ui-composer__hint') ? [...c.querySelectorAll('.ui-assume')].map((b) => b.textContent) : []); setTimeout(() => runTurn(e.detail.text), 0); });
    c.addEventListener('ui:stop', () => { VIEW.stopRun && VIEW.stopRun(); });
    c.addEventListener('ui:edit-last', (e) => { const u = turns().filter((t) => t._kind === 'user').pop(); if (u) { e.preventDefault(); c.setValue(u._text); c.focus(); } });
    if (window.ResizeObserver) new ResizeObserver(() => root.style.setProperty('--ss-comp-h', host.offsetHeight + 'px')).observe(host);
    requestAnimationFrame(() => c.focus());
    if (window.HX.provide) {
      HX.provide('stop', (d) => { if ((d && d.tab) !== 'session' || !VIEW.stopRun) return false; VIEW.stopRun(); return true; });
      HX.provide('find', (d) => ((d && d.tab) === 'session' ? openFind() : false));
    }
    on('hx:nav', (d) => {
      if (!d || d.region !== 'messages' || !(window.HX.state || {}).tab === 'session') return;
      const list = turns(); if (!list.length) return;
      rove(d.action === 'last' ? list[list.length - 1] : list[0], true);
    });
    on('hx:new-session', (d) => newSession(d && d.project));
    on('hx:session-select', (d) => { if (d && d.id && d.from !== 'list' && d.id !== VIEW.current && sessions().some((x) => x.id === d.id)) selectSession(d.id, { quiet: true }); });
    emit('hx:title', { title: (sessions()[0] || {}).title, project: (sessions()[0] || {}).project, tab: 'session' });
  }
  function toConversation() { const t = turns().find((x) => x.tabIndex === 0) || lastTurn(); if (t) { rove(t, true); } }

  /* ───────────── session list (KEYMAP §4): library rows grouped by project, actions as sibling buttons ───────────── */
  function mountList(root) {
    root.classList.add('ssl');
    const collapsed = new Set(['__arch']);
    let renaming = null;
    const ib = (icon, label, act) => U().html.iconButton({ icon, label, size: 's', attrs: { 'data-act': act } });
    function rowHTML(s, archived) {
      const isCur = s.id === VIEW.current && !archived, needs = s.id === 's1' && !VIEW.blank && !archived;
      const acts = archived ? ib('unarchive', 'Restore ' + s.title, 'restore')
        : (isCur ? '' : ib('play', 'Resume ' + s.title, 'resume')) + ib('fork', 'Fork ' + s.title, 'fork') + ib('pen', 'Rename ' + s.title, 'rename') + ib('archive', 'Archive ' + s.title, 'archive');
      return U().html.row({
        title: s.title, end: esc(s.running ? 'now' : (s.when || '')), current: isCur, archived, value: s.id, acts,
        lead: archived ? '' : U().html.leadFor({ running: s.running, attention: needs, current: isCur }),
        attrs: { 'data-id': s.id, 'aria-label': s.title + (needs ? ', needs you' : '') + (s.running ? ', running' : '') + (archived ? ', archived' : ''), 'data-hx-focus': isCur ? 'list' : null }
      });
    }
    function draw() {
      const a = document.activeElement, focusId = a && root.contains(a) && a.closest('[data-id]') ? a.closest('[data-id]').dataset.id : null, focusAct = a && a.dataset && a.dataset.act;
      const groups = {};
      sessions().forEach((s) => (groups[s.project] = groups[s.project] || []).push(s));
      root.replaceChildren();
      Object.keys(groups).forEach((p) => root.append(U().group({ label: p, collapsible: true, expanded: !collapsed.has(p), rows: groups[p].map((s) => rowHTML(s, false)).join('') })));
      if (sessionsState.archived.length) root.append(U().group({ label: 'Archived', collapsible: true, expanded: !collapsed.has('__arch'), rows: sessionsState.archived.map((s) => rowHTML(s, true)).join('') }));
      if (!sessions().length) root.append(U().empty({ title: 'No sessions yet', text: 'Start one with New session.' }));
      root.querySelectorAll('.ui-group').forEach((g, i) => { g.dataset.group = Object.keys(groups)[i] || '__arch'; });
      if (renaming) startRename(renaming);
      else if (focusId) { const r = root.querySelector(`[data-id="${focusId}"]`); const t = r && (focusAct && r.closest('li').querySelector(`[data-act="${focusAct}"]`)) || r; if (t) { rove(r); t.focus({ preventScroll: true }); } }
    }
    const rows = () => [...root.querySelectorAll('.ui-row')].filter((r) => r.offsetParent !== null);
    function rove(r) { rows().forEach((x) => { x.tabIndex = x === r ? 0 : -1; }); }
    root.addEventListener('ui:change', (e) => {
      const head = e.target.closest('.ui-group__head'); if (!head) return;
      const name = head.closest('.ui-group').dataset.group;
      if (e.detail.value) collapsed.delete(name); else collapsed.add(name);
    });
    root.addEventListener('ui:select', (e) => { const id = e.detail.value; if (id && sessions().some((s) => s.id === id) && id !== VIEW.current) selectSession(id); });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.closest('li').querySelector('.ui-row').dataset.id;
      ({ resume: () => selectSession(id, { focus: true }), fork: () => fork(id), rename: () => startRename(id), archive: () => archive(id), restore: () => restore(id) })[b.dataset.act]();
    });
    /* ↑ ↓ j k Home End across groups; shift+↑ ↓ between groups; Enter opens and keeps focus; Esc to the conversation */
    root.addEventListener('keydown', (e) => {
      const r = e.target.closest && e.target.closest('.ui-row');
      if (e.key === 'Escape' && !renaming) { e.preventDefault(); e.stopPropagation(); toConversation(); return; }
      if (!r || e.target !== r || modKey(e) || e.altKey) return;
      const list = rows(), i = list.indexOf(r);
      let n = null;
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const groups = [...root.querySelectorAll('.ui-group')], gi = groups.indexOf(r.closest('.ui-group'));
        for (let g = gi + (e.key === 'ArrowDown' ? 1 : -1); g >= 0 && g < groups.length; g += e.key === 'ArrowDown' ? 1 : -1) { const f = groups[g].querySelector('.ui-row'); if (f && f.offsetParent) { n = list.indexOf(f); break; } }
        if (n == null) { e.preventDefault(); e.stopPropagation(); return; }
      } else n = { ArrowDown: i + 1, j: i + 1, ArrowUp: i - 1, k: i - 1, Home: 0, End: list.length - 1 }[e.key];
      if (n == null) return;
      e.preventDefault(); e.stopPropagation();
      const t = list[Math.max(0, Math.min(list.length - 1, n))]; rove(t); t.focus();
    }, true);
    function fork(id) {
      const list = sessions(), i = list.findIndex((s) => s.id === id), s = list[i];
      const n = { id: 'f' + Date.now().toString(36), project: s.project, title: s.title + ' (fork)', when: 'now' };
      list.splice(i + 1, 0, n);
      if (HISTORIES[id]) HISTORIES[n.id] = HISTORIES[id];
      selectSession(n.id);
      U().announce('Forked ' + s.title);
    }
    function startRename(id) {
      renaming = id;
      const r = root.querySelector(`.ui-row[data-id="${id}"]`); if (!r) return;
      const s = sessions().find((x) => x.id === id), li = r.closest('li');
      const input = el('input', { class: 'ui-input ss-rename', type: 'text', value: s.title, 'aria-label': 'Rename session' });
      li.replaceChildren(input); input.focus(); input.select();
      const done = (save) => {
        if (renaming !== id) return; renaming = null;
        if (save && input.value.trim()) { s.title = input.value.trim(); if (id === VIEW.current) emit('hx:title', { title: s.title, project: s.project, tab: 'session' }); }
        draw(); const nr = root.querySelector(`.ui-row[data-id="${id}"]`); if (nr) { rove(nr); nr.focus(); }
      };
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } });
      input.addEventListener('blur', () => done(true));
    }
    function archive(id) {
      const list = sessions(), i = list.findIndex((s) => s.id === id); if (i < 0) return;
      const [s] = list.splice(i, 1); sessionsState.archived.unshift(s);
      if (VIEW.current === id && list.length) selectSession(list[Math.min(i, list.length - 1)].id); else changed();
      const next = rows()[0]; if (next) { rove(next); next.focus(); }
      U().toast('Archived "' + s.title + '"', { action: { label: 'Undo', onClick: () => restore(id) } });
    }
    function restore(id) {
      const i = sessionsState.archived.findIndex((s) => s.id === id); if (i < 0) return;
      const [s] = sessionsState.archived.splice(i, 1); sessions().push(s); changed();
    }
    sessionsState.subs.add(draw);
    draw();
  }

  /* ───────────── right panel (KEYMAP §9) ───────────── */
  const RIGHT = { root: null, open: {}, refresh: null };
  const SECTIONS = ['context', 'tasks', 'changes', 'output', 'governance', 'connectors', 'environment'];
  function openPanel(panel) {
    const H = window.HX;
    if (H && H.setState && H.state && H.state.right !== 'open') H.setState({ right: 'open' });
    RIGHT.open[panel] = true;
    RIGHT.refresh && RIGHT.refresh(panel);
  }
  function mountRight(root) {
    RIGHT.root = root; ctxInit();
    root.classList.add('ssr');
    SECTIONS.forEach((s) => (RIGHT.open[s] = s !== 'environment' && s !== 'connectors'));
    const isOpen = () => window.HX && HX.state && HX.state.right === 'open';
    let last = null;

    function strip() {
      const b = el('button', { class: 'ui-measure-btn', type: 'button', 'aria-label': 'Context ' + pct() + '% used, ' + k(ctxUsed()) + ' of ' + k(CTX.total) + ' tokens. Show session details', 'data-tip': 'Context ' + pct() + '% used', 'data-kbd': 'mod+I', 'aria-keyshortcuts': isMac ? 'Meta+I' : 'Control+I', html: U().html.measure({ used: ctxUsed(), total: CTX.total, dots: 8 }) });
      b.addEventListener('click', () => openPanel('context'));
      return el('div', { class: 'ssr-strip' }, b);
    }
    function section(name, label, meta, body) {
      const s = U().section({ label, meta, open: !!RIGHT.open[name], name });
      s.querySelector('.ui-sec__body').append(...[].concat(body));
      s.querySelector('.ui-sec__head').addEventListener('ui:change', (e) => { RIGHT.open[name] = e.detail.value; });
      return s;
    }
    function contextBody() {
      const compact = U().button({ label: 'Compact conversation' });
      const note = el('p', { class: 'ssr-note', text: RIGHT.note || 'Compacting summarises older turns. Files and project memory stay. It runs on its own at 90%.' });
      if (RIGHT.note) { note.setAttribute('role', 'status'); RIGHT.note = null; }
      compact.addEventListener('click', () => {
        const conv = CTX.parts.find((p) => p[0] === 'conversation'); if (!conv) return;
        const freed = Math.max(0, conv[1] - 5000);
        RIGHT.note = freed ? 'Compacted. Freed ' + k(freed) + ' tokens.' : 'Nothing left to compact.';
        ctxBump('conversation', -freed);
      });
      const legendParts = CTX.parts.map((p) => [cap1(p[0]), p[1]]);
      return [U().measure({ variant: 'grid', total: CTX.total, parts: CTX.parts, label: 'Context' }), U().legend(legendParts, k), el('div', { class: 'ssr-actions' }, compact), note];
    }
    function tasksBody() {
      return el('ul', { class: 'ssr-tasks' }, (D().todos || []).map(([t, s]) => el('li', { class: 'ssr-task', 'data-s': s }, [
        el('span', { class: 'ssr-task-mark', 'aria-hidden': 'true', html: s === 'done' ? U().icon('check') : s === 'doing' ? U().html.dot('run') : '<i></i>' }),
        el('span', { text: cap1(t) }), el('span', { class: 'ui-sr', text: s === 'done' ? ', done' : s === 'doing' ? ', in progress' : ', to do' })
      ])));
    }
    function changesBody() {
      return diffFiles(VIEW.blank).map((f) => {
        const [dir, base] = splitPath(f.path), slot = el('div');
        const b = el('button', { class: 'ssr-file', type: 'button', 'aria-expanded': 'false' }, [el('span', { class: 'ss-path ui-mono' }, [el('span', { class: 'ss-dir', text: dir }), base]), counts(f.add, f.del)]);
        b.addEventListener('click', () => { const o = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(o)); slot.replaceChildren(o ? renderDiff([f], true, true) : ''); });
        return el('div', {}, [b, slot]);
      });
    }
    function outputBody() {
      const lines = D().output || [];
      const term = el('pre', { class: 'ssr-term ui-mono', tabindex: '0', 'aria-label': 'Terminal output' });
      lines.forEach((l, i) => {
        const span = el('span', { class: l.startsWith('$') ? 'cmd' : /FAIL/.test(l) ? 'fail' : '' });
        if (/PASS/.test(l)) { const j = l.indexOf('PASS'); span.append(l.slice(0, j), el('span', { class: 'pass', text: 'PASS' }), l.slice(j + 4)); } else span.textContent = l;
        term.append(span, i < lines.length - 1 ? '\n' : '');
      });
      const copy = U().iconButton({ icon: 'copy', label: 'Copy output', size: 's' });
      copy.addEventListener('click', () => copyText(lines.join('\n')));
      return [el('div', { class: 'ssr-term-wrap' }, [term, copy])];
    }
    function governanceBody() {
      const gv = D().governance || { ladder: [], current: 0 };
      const seg = U().segmented({ mode: 'radio', fill: true, label: 'Governance', value: G.governed ? 'on' : 'off', options: [{ value: 'on', label: 'Governed' }, { value: 'off', label: 'Ungoverned' }] });
      seg.addEventListener('ui:change', (e) => setG({ governed: e.detail.value === 'on' }));
      const ladder = U().ladder({ stations: gv.ladder.map(([m, w]) => [m, cap1(w)]), current: gv.current, variant: 'list', off: !G.governed });
      const capBtn = U().button({ label: 'Change cap', size: 's', variant: 'ghost', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
      capBtn.addEventListener('click', () => U().menu.open(capBtn, [{ title: 'Stop the session at' }].concat(['$0.30', '$0.60', '$1.00', '$2.00'].map((v) => ({ label: v, value: v, mono: true, checked: v === G.cap }))), { align: 'end', onSelect: (v) => setG({ cap: v }) }));
      const capRow = G.governed
        ? el('div', { class: 'ssr-cap' }, [el('span', { class: 'ssr-key', text: 'Spend' }), U().capacity(gv.spent || '$0', G.cap), capBtn])
        : el('p', { class: 'ssr-note', text: 'Ungoverned: every turn runs on ' + G.model + ' with no cost cap. The sandbox still applies.' });
      return [seg, ladder, capRow];
    }
    function connectorsBody() {
      return (D().connectors || []).map((c) => {
        const id = 'ssr-conn-' + c.name;
        let control;
        if (c.state === 'sign in') control = U().html.button({ label: 'Sign in', size: 's', attrs: { id, 'data-conn': c.name } });
        else control = U().html.switch({ id, checked: c.state === 'on' });
        const row = frag(U().html.setRow({ label: cap1(c.name), hint: c.tools + ' tools', for: c.state === 'sign in' ? null : id, control }));
        const sw = row.querySelector('.ui-switch'), sb = row.querySelector('[data-conn]');
        if (sw) { U().hydrate(row); sw.addEventListener('change', () => { c.state = sw.checked ? 'on' : 'off'; draw(); }); }
        if (sb) sb.addEventListener('click', () => { sb.querySelector('span').textContent = 'Connecting'; sb.disabled = true; setTimeout(() => { c.state = 'on'; draw(); }, 900); });
        return row;
      });
    }
    function envBody() {
      const e = D().environment || {};
      const dl = el('dl', { class: 'ssr-env' });
      [['Folder', e.cwd], ['Branch', e.branch], ['Sandbox', e.sandbox], ['Runtime', e.runtime], ['Harness', e.hermes], ['Gate', e.gate]].forEach(([a, b]) => b && dl.append(el('dt', { text: a }), el('dd', {}, partsEl(b, 'ui-mono'))));
      return [dl];
    }
    function panel() {
      const todos = D().todos || [], done = todos.filter((t) => t[1] === 'done').length;
      const ch = D().changes || [], add = ch.reduce((a, c) => a + c[1], 0), del = ch.reduce((a, c) => a + c[2], 0);
      const onN = (D().connectors || []).filter((c) => c.state === 'on').length;
      const out = (D().output || []).join('\n'), passed = (out.match(/(\d+) passed/) || [0, ''])[1];
      const mono = (t) => '<span class="ui-mono">' + esc(t) + '</span>';
      const body = el('div', { class: 'ui-panel__body' }, [
        section('context', 'Context', mono(k(ctxUsed()) + ' / ' + k(CTX.total)), contextBody()),
        section('tasks', 'Tasks', mono(done + ' of ' + todos.length), tasksBody()),
        section('changes', 'Changes', '<span class="ss-n ui-mono"><span class="ss-add">+' + add + '</span><span class="ss-del">−' + del + '</span></span>', changesBody()),
        section('output', 'Output', mono(passed ? passed + ' passed' : 'running'), outputBody()),
        section('governance', 'Governance', mono(G.governed ? 'governed' : 'ungoverned'), governanceBody()),
        section('connectors', 'Connectors', mono(onN + ' on'), connectorsBody()),
        section('environment', 'Environment', mono('sandboxed'), envBody())
      ]);
      const first = body.querySelector('.ui-sec__head'); if (first) first.setAttribute('data-hx-focus', 'panel');
      /* ↑ ↓ between section headers */
      body.addEventListener('keydown', (e) => {
        if (!e.target.classList.contains('ui-sec__head') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || modKey(e)) return;
        const heads = [...body.querySelectorAll('.ui-sec__head')], i = heads.indexOf(e.target);
        const n = heads[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { e.preventDefault(); n.focus(); }
      });
      return el('div', { class: 'ui-panel ssr-panel', role: 'region', 'aria-label': 'Session details' }, [el('div', { class: 'ui-panel__head' }, el('h2', { class: 'ui-panel__title', text: 'Session details' })), body]);
    }
    function draw(flash) {
      const prevBody = root.querySelector('.ui-panel__body'), keepScroll = prevBody ? prevBody.scrollTop : 0;
      const a = document.activeElement, hadFocus = root.contains(a), focusSec = hadFocus && a.closest('[data-name]'), focusHead = hadFocus && a.classList.contains('ui-sec__head');
      const open = isOpen();
      root.replaceChildren(open ? panel() : strip());
      const body = root.querySelector('.ui-panel__body'); if (body) body.scrollTop = keepScroll;
      if (typeof flash === 'string' && open) {
        const sec = root.querySelector(`[data-name="${flash}"]`);
        if (sec) { sec.scrollIntoView({ block: 'nearest' }); sec.setAttribute('data-flash', ''); setTimeout(() => sec.removeAttribute('data-flash'), 1200); }
      } else if (hadFocus) {
        const f = open ? (focusSec && root.querySelector(`[data-name="${focusSec.dataset.name}"] .ui-sec__head`)) || root.querySelector('.ui-sec__head') : root.querySelector('.ui-measure-btn');
        if (f && (focusHead || !open || !focusSec)) f.focus({ preventScroll: true });
      }
      last = open;
    }
    RIGHT.refresh = draw;
    on('hx:state', () => { if (isOpen() !== last) draw(); });
    on('hx:open-panel', (d) => { const p = (d && d.panel) || 'context'; RIGHT.open[p] = true; if (isOpen()) draw(p); else openPanel(p); });
    CTX.subs.add(() => draw());
    G.subs.add(() => { if (isOpen()) draw(); });
    sessionsState.subs.add(() => { if (isOpen()) draw(); });
    draw();
  }

  /* ───────────── registration ───────────── */
  function register() {
    const H = window.HX;
    if (!H.ui || !H.ui.composer) { console.error('[session] needs components/components.js (HX.ui) loaded before session.js'); return; }
    H.composer = { create: legacyCreate };
    H.session = { select: selectSession, newSession, openPanel };
    H.register('session', { mount: (root) => mountView(root) });
    H.register('session-list', { mount: (root) => mountList(root) });
    H.register('session-right', { mount: (root) => mountRight(root) });
  }
  if (window.HX && window.HX.register) register();
  else document.addEventListener('DOMContentLoaded', () => { if (window.HX && window.HX.register) register(); });
})();
