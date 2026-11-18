/* hypotaxis v6 · cards (owner: cards agent)
   HX.cards.create(kind, data, opts) -> <hx-card>     el.update(patch)     el.state
   HX.cards.queue(items, opts)       -> .cd-queue      q.add(item)
   Events (bubble from the card, cancelable): 'hx:card-action' {kind, action, data, state, value, card}
     preventDefault() keeps the card where it is, so the host can drive state with el.update({state}).
   'hx:card-state' {kind, state, prev, data, card} after every state change.
   HX.emit('hx:attention', {source: 'cards', count}) whenever the number of cards waiting on the user changes.
   Kinds: approval, ship, blank, teammate, escalation, error, schedule, connector.
   Sizes: inline (in the measure, up to 520px), compact (dock, side panel, up to 360px), mini (one row);
   blank also has popover (the expanded blank).
   opts: { size, state, ground: 'chrome' | 'dock', holdMs, holdFill: 'dots' | 'solid', layer, enter }
   The card layer of the shared library (HX.ui.card points here). Shared parts come from HX.ui
   (components/components.js): buttons, the hold to approve, stamps, dots, code chips, orbs, the ladder, page dots,
   the blank mark and the one popover layer. What stays here is the card itself: kinds, sizes, states, receipts,
   announcements, the queue and the height animation (the owner's exception).
   Keys (KEYMAP §6): hold Space or Enter twice on Hold to approve; x denies while focus is in an approval; d opens the
   diff from a ship card; 1-9 pick a blank option; Esc closes the popover. Every item waiting on the user marks its
   focusable element with data-hx-attention, so F8 / shift+F8 can find it.
   No colour, font or radius lives here: everything visual is a token in tokens.css. */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- HX, minimal when the shell is absent */
  function stubHX() {
    const bus = new EventTarget();
    const wraps = new Map();
    return {
      state: { tab: 'session', left: 'open', right: 'closed', dock: 'on', theme: 'dark' },
      on(type, fn) { const w = (e) => fn(e.detail, e); wraps.set(type + '\u0000' + fn, w); bus.addEventListener(type, w); },
      off(type, fn) { const k = type + '\u0000' + fn, w = wraps.get(k); if (w) { bus.removeEventListener(type, w); wraps.delete(k); } },
      emit(type, detail) { bus.dispatchEvent(new CustomEvent(type, { detail })); },
      register() {},
      setState(patch) { Object.assign(this.state, patch); this.emit('hx:state', { state: this.state, changed: patch }); },
      cards: null,
      data: window.HX_DATA,
      stub: true
    };
  }
  if (!window.HX) window.HX = stubHX();
  const hx = () => window.HX;
  const U = () => {
    const ui = window.HX && window.HX.ui;
    if (!ui || !ui.html) throw new Error('hx cards: load components/components.js before cards.js');
    return ui;
  };
  const DATA = () => (window.HX && window.HX.data) || window.HX_DATA || {};

  /* ---------------------------------------------------------------- small helpers */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  /* inline code in data strings: `money.ts` -> the library's code chip */
  const fmt = (s) => U().html.inline(s);
  const code = (s) => U().html.code(s);
  const mono = (s) => '<span class="cd-mono">' + esc(s) + '</span>';
  const cap = (s) => { s = String(s == null ? '' : s); return s.charAt(0).toUpperCase() + s.slice(1); };
  /* 'a · b · c' -> ['a', 'b', 'c']: the parts are set apart with space, never joined with dots */
  const parts = (s) => (Array.isArray(s) ? s : String(s == null ? '' : s).split(/\s+·\s+/)).map((x) => String(x).trim()).filter(Boolean);
  const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => RMQ.matches;
  const clock = (t) => { const d = new Date(t || Date.now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  let uid = 0;
  const nid = () => 'cd' + (++uid).toString(36);
  const bot = (id) => (DATA().bots || []).find((b) => b.id === id || b.name === id);
  const check = () => U().icon('check', { class: 'cd-ico' });

  /* ---------------------------------------------------------------- motion from the tokens */
  const tok = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  const ms = (name, fallback) => { const v = tok(name, ''); const n = parseFloat(v); return isNaN(n) ? fallback : (/ms$/.test(v) ? n : n * 1000); };
  /* preset: 'settle' = layout travel (--dur-3, --spring); 'fade' = menus and fades (--dur-2, --ease); 'quick' = hover scale (--dur-1, --ease) */
  function motion(preset) {
    if (preset === 'settle') return { duration: ms('--dur-3', 300), easing: tok('--spring', 'ease-out') };
    if (preset === 'quick') return { duration: ms('--dur-1', 150), easing: tok('--ease', 'ease-out') };
    return { duration: ms('--dur-2', 200), easing: tok('--ease', 'ease-out') };
  }
  const stripMotion = (kf) => kf.map((k) => { const o = Object.assign({}, k); delete o.transform; delete o.translate; delete o.scale; return o; });
  function animate(el, kf, o) {
    o = o || {};
    if (!el || !el.animate) return null;
    const m = motion(o.preset || 'fade');
    const rm = reduced();
    return el.animate(rm ? stripMotion(kf) : kf, {
      duration: rm ? Math.min(m.duration, 120) : (o.duration || m.duration),
      easing: o.easing || m.easing,
      delay: rm ? 0 : (o.delay || 0),
      fill: o.fill || 'none'
    });
  }

  /* ---------------------------------------------------------------- shared fragments */
  function orb(id, size) {
    const b = bot(id);
    return b ? U().html.orb(b, { size }) : '';
  }
  /* who asks: a bot by name (sans, as authored), or the nameless agent by its model (mono) */
  const whoHTML = (d) => { const b = d.from && bot(d.from); return b ? esc(b.name) : (d.model ? mono(d.model) : ''); };
  const whoText = (d) => { const b = d.from && bot(d.from); return b ? b.name : (d.model || ''); };
  function sentenceHTML(d, verb) {
    const w = whoHTML(d);
    return w ? w + ' ' + (verb ? esc(verb) + ' ' : '') + fmt(d.title) : fmt(cap(d.title));
  }
  const sentenceText = (d, verb) => { const w = whoText(d); return w ? w + ' ' + (verb ? verb + ' ' : '') + d.title : cap(d.title); };
  /* the head: title, and in its corner the stamp of what you owe (filled in by _applyState) */
  const headrow = (c, html) => '<div class="cd-headrow"><p class="cd-lead" id="' + c.id + '-t">' + html + '</p><span class="ui-stamp" data-stamp></span></div>';
  const quote = (q) => (q ? '<p class="cd-quote">“' + fmt(q) + '”</p>' : '');
  const breath = () => U().html.dot('run');
  function well(lines) {
    lines = (lines || []).filter(Boolean);
    if (!lines.length) return '';
    return '<div class="cd-well">' + lines.map((l, i) => {
      const p = parts(l);
      return '<div class="cd-well__line' + (i === 0 ? ' cd-well__line--first' : '') + '">' + p.map((x, j) => '<span' + (i === 0 && j === 0 ? ' class="cd-well__strong"' : '') + '>' + fmt(x) + '</span>').join('') + '</div>';
    }).join('') + '</div>';
  }
  /* the library's buttons: variant 'primary' | 'ghost' | (secondary), o: {size: 's', disabled, keys} */
  const btn = (action, label, variant, o) => U().html.button(Object.assign({ label, action, variant: variant || undefined }, o || {}));
  const actions = (html) => '<div class="cd-actions">' + html + '</div>';
  const at = (word, c) => esc(word) + ' at ' + mono(c.at);
  const receipt = (html, icon) => '<p class="cd-receipt">' + (icon ? check() : '') + '<span>' + html + '</span></p>';
  const foot = (left, right) => '<div class="cd-foot">' + (left || '') + (right || '') + '</div>';
  const meta = (items) => { items = items.filter(Boolean); return items.length ? '<div class="cd-meta">' + items.join('') + '</div>' : ''; };
  /* a queue's position: the library's still page dots */
  function qdots(q) {
    if (!q || q.total < 2) return '';
    const pages = [];
    for (let i = 0; i < q.total; i++) pages.push({ id: String(i) });
    return U().html.pages({ pages, current: String(q.index), label: 'Request ' + (q.index + 1) + ' of ' + q.total });
  }
  /* one row: what it is, the attention dot when it owes something (named for screen readers), a short meta */
  function mini(ctx, o) {
    const owe = ctx.owe;
    return '<button type="button" class="cd-mini" data-action="open" aria-labelledby="' + ctx.id + '-t' + (owe ? ' ' + ctx.id + '-o' : '') + (o.meta ? ' ' + ctx.id + '-m' : '') + '">' + (o.lead || '') +
      '<span class="cd-mini__text" id="' + ctx.id + '-t">' + o.text + '</span>' +
      (owe ? U().html.dot('attention') + '<span class="ui-sr" id="' + ctx.id + '-o">, ' + esc(owe) + '</span>' : '') +
      (o.meta ? '<span class="cd-mini__meta" id="' + ctx.id + '-m">' + o.meta + '</span>' : '') + '</button>';
  }
  const miniOrb = (d) => (d.from ? orb(d.from, 16) : '');

  /* ---------------------------------------------------------------- expiry: 'expires in 9 min' stays live */
  function expiryText(left, short) {
    if (left <= 0) return short ? 'now' : 'Expires now';
    const s = Math.ceil(left / 1000);
    const v = s >= 90 ? Math.ceil(s / 60) + ' min' : s + ' s';
    return short ? v : 'Expires in ' + v;
  }

  /* ================================================================ kinds
     tone: what the card owes the user. red = an approval, a blank or a failure (the stamp); pulse = running;
     ink = done; ring = closed without effect; none = nothing owed. Hosts can read data-tone. */
  const KINDS = {};

  /* ---------------- approval: a bot or the agent wants to do something sensitive */
  KINDS.approval = {
    states: ['pending', 'holding', 'approved', 'denied', 'expired'],
    initial: 'pending',
    quiet: { 'pending>holding': 1, 'holding>pending': 1 },
    tone: (c) => ({ pending: 'red', holding: 'red', approved: 'ink', denied: 'ring', expired: 'ring' })[c.s],
    stamp: () => 'needs you',
    resolved: (c) => c.s === 'approved' || c.s === 'denied' || c.s === 'expired',
    say: (c) => ({ approved: 'Approved: ', denied: 'Denied: ', expired: 'Expired, nothing ran: ' })[c.s] + c.plain,
    text: (c) => sentenceText(c.d, 'wants to'),
    render(c) {
      const d = c.d, live = c.s === 'pending' || c.s === 'holding';
      const metaParts = parts(d.meta).map((p) => /^expires in /i.test(p) ? '<span data-countdown>' + esc(cap(p)) + '</span>' : '<span>' + fmt(p) + '</span>');
      let f;
      if (live) f = foot(meta([qdots(c.q)].concat(metaParts)), actions(btn('deny', 'Deny', null, { keys: 'x' }) + holdHTML(c)));
      else if (c.s === 'approved') f = foot(receipt(at('Approved', c), true));
      else if (c.s === 'denied') f = foot(receipt(at('Denied', c)));
      else f = foot(receipt(at('Expired', c) + ', nothing ran'), actions(btn('ask-again', 'Ask again')));
      return {
        side: d.from ? orb(d.from, c.size === 'compact' ? 20 : 24) : '',
        head: headrow(c, sentenceHTML(d, 'wants to')) + quote(d.quote),
        body: well(d.item),
        foot: f
      };
    },
    mini: (c) => mini(c, { lead: miniOrb(c.d), text: sentenceHTML(c.d, 'wants to'), meta: (c.s === 'pending' || c.s === 'holding') ? '<span data-countdown="short"></span>' : esc(cap(c.s)) }),
    act(card, a) {
      if (a === 'deny') card._setState('denied');
      else if (a === 'approve') card._setState('approved');
      else if (a === 'ask-again') { card._expiresAt = 0; card._armExpiry(true); card._setState('pending'); }
    }
  };
  /* the library's hold to approve (1000ms, the dot field), wired in _hydrate */
  const holdHTML = (c) => U().html.hold({ hintId: c.id + '-hint', fill: c.card._opts.holdFill, attrs: { 'data-hold': true } });

  /* ---------------- ship result */
  KINDS.ship = {
    states: ['passed', 'failed', 'rolled-back'],
    initial: 'passed',
    tone: (c) => ({ passed: 'ink', failed: 'red', 'rolled-back': 'ring' })[c.s],
    stamp: () => 'failed',
    resolved: (c) => c.s === 'rolled-back',
    say: (c) => c.plain,
    text: (c) => ({ passed: cap(c.d.title || 'ready to ship'), failed: 'Not shipped', 'rolled-back': 'Rolled back' })[c.s],
    render(c) {
      const d = c.d, files = d.files || [];
      const max = c.size === 'compact' ? 3 : 6;
      const add = d.add != null ? d.add : files.reduce((n, f) => n + (f[1] || 0), 0);
      const del = d.del != null ? d.del : files.reduce((n, f) => n + (f[2] || 0), 0);
      let body = '';
      if (c.s === 'passed') {
        const rb = d.rolledBack || 0;
        body = '<p class="cd-text">' + esc(d.passed) + ' tests passed.' + (rb
          ? ' <button type="button" class="cd-token" data-action="rollback-detail" aria-expanded="' + (d.showRollback ? 'true' : 'false') + '">' +
            rb + (rb === 1 ? ' edit was' : ' edits were') + ' rolled back</button> on the way.' : '') + '</p>' +
          (d.showRollback && d.rollbackNote ? '<p class="cd-note">' + fmt(d.rollbackNote) + '</p>' : '') +
          filesHTML(files, max);
      } else if (c.s === 'failed') {
        const fails = d.failures || [];
        body = '<p class="cd-text">' + (fails.length === 1 ? '1 test failed' : fails.length + ' tests failed') + ', so nothing was pushed.</p>' +
          (fails.length ? '<div class="cd-well cd-out">' + fails.map((x) => '<div class="cd-out__hit">' + fmt(x) + '</div>').join('') + '</div>' : '');
      } else {
        body = '<p class="cd-text">The gate failed after the last edit, so ' + code(d.branch) + ' is back where it started.</p>' + filesHTML(files, max);
      }
      const left = meta([code(d.branch), c.s !== 'failed' && files.length ? '<span>' + files.length + ' files</span><span>+' + add + ' −' + del + '</span>' : '']);
      const right = c.s === 'passed' ? actions(btn('view-diff', 'View diff', null, { keys: 'd' }) + btn('open-pr', 'Open PR', 'primary'))
        : c.s === 'failed' ? actions(btn('view-output', 'View output') + btn('retry', 'Fix and retry', 'primary'))
          : actions(btn('view-diff', 'View diff', null, { keys: 'd' }) + btn('retry', 'Try again', 'primary'));
      return { head: headrow(c, esc(this.text(c))) + quote(d.quote), body, foot: foot(left, right) };
    },
    mini(c) {
      const d = c.d, files = d.files || [];
      const add = d.add != null ? d.add : files.reduce((n, f) => n + f[1], 0), del = d.del != null ? d.del : files.reduce((n, f) => n + f[2], 0);
      return mini(c, { text: esc(this.text(c)), meta: c.s === 'failed' ? esc((d.failures || []).length + ' failed') : '+' + add + ' −' + del });
    },
    act(card, a) {
      if (a === 'rollback-detail') card.update({ showRollback: !card._d.showRollback });
    }
  };
  function filesHTML(files, max) {
    if (!files.length) return '';
    const rows = files.slice(0, max).map((f) => {
      const path = String(f[0]), cut = path.lastIndexOf('/') + 1;
      return '<div class="cd-file" role="row"><span class="cd-file__path" role="cell"><span class="cd-file__dir">' + esc(path.slice(0, cut)) + '</span>' + esc(path.slice(cut)) + '</span>' +
        '<span class="cd-file__n" role="cell">+' + f[1] + '</span><span class="cd-file__n cd-file__n--del" role="cell">−' + f[2] + '</span>' +
        '<span class="cd-diffdots" role="cell" aria-hidden="true">' + diffdots(f[1], f[2]) + '</span></div>';
    });
    if (files.length > max) rows.push('<div class="cd-file cd-file--more" role="row"><span role="cell">' + (files.length - max) + ' more ' + (files.length - max === 1 ? 'file' : 'files') + '</span><span role="cell"></span><span role="cell"></span><span role="cell"></span></div>');
    return '<div class="cd-well cd-files" role="table" aria-label="Changed files">' + rows.join('') + '</div>';
  }
  function diffdots(a, d) {
    const t = a + d, filled = Math.min(5, t), na = t ? Math.round(filled * a / t) : 0;
    let s = '';
    for (let i = 0; i < 5; i++) s += '<i' + (i < na ? ' data-d="add"' : i < filled ? ' data-d="del"' : '') + '></i>';
    return s;
  }

  /* ---------------- blank: an open question the agent left in its answer */
  KINDS.blank = {
    states: ['open', 'answered'],
    initial: 'open',
    tone: (c) => (c.s === 'open' ? 'red' : 'none'),
    stamp: () => 'waiting for you',
    attention: (c) => c.s === 'open' && c.size !== 'popover',
    resolved: () => false,
    say: (c) => (c.s === 'answered' ? 'Answered: ' + c.d.answer : 'Open question: ' + c.d.question),
    text: (c) => c.d.question,
    /* the library's blank mark, made live: it opens the popover */
    inline(c) {
      const a = c.s === 'answered' ? c.d.answer : '';
      return U().html.blank({ answer: a }).replace('<button type="button" class="ui-blank"', '<button type="button" class="ui-blank cd-blank" data-action="open-blank" id="' + c.id + '-t"');
    },
    render(c) {
      const d = c.d, opts = d.options || [];
      const chosen = c.s === 'answered' ? d.answer : null;
      const custom = chosen != null && opts.indexOf(chosen) < 0 ? chosen : '';
      const body = '<div class="cd-opts" role="radiogroup" aria-labelledby="' + c.id + '-t">' + opts.map((o, i) =>
        '<button type="button" class="cd-opt" role="radio" data-opt="' + i + '" aria-checked="' + (chosen === o) + '"' + (i < 9 ? ' aria-keyshortcuts="' + (i + 1) + '"' : '') + ' tabindex="-1">' +
        '<span class="cd-opt__ring" aria-hidden="true"></span><span>' + fmt(o) + '</span>' + (i < 9 ? '<span class="cd-opt__key" aria-hidden="true">' + (i + 1) + '</span>' : '') + '</button>').join('') + '</div>' +
        '<label class="cd-free"' + (custom ? ' data-on' : '') + '><span class="cd-opt__ring" aria-hidden="true"></span><span class="ui-sr">Your own answer</span>' +
        '<input type="text" autocomplete="off" spellcheck="false" placeholder="Or write your own" value="' + esc(custom) + '"></label>';
      const right = c.size === 'popover' ? actions(btn('later', 'Later', 'ghost') + btn('answer', 'Answer', 'primary', { disabled: !chosen }))
        : actions(btn('answer', c.s === 'answered' ? 'Change answer' : 'Answer', 'primary', { disabled: !chosen }));
      const left = c.s === 'answered' && c.size !== 'popover' ? receipt(at('Answered', c)) : '';
      /* under the sentence it came from, the popover needs only the short form of the question */
      return { head: headrow(c, '<span class="cd-raw">' + fmt(c.size === 'popover' && d.short ? d.short : d.question) + '</span>'), body, foot: foot(left, right) };
    },
    mini: (c) => mini(c, { text: '<span class="cd-raw">' + fmt(c.d.short || c.d.question) + '</span>', meta: c.s === 'answered' ? '<span class="cd-raw">' + esc(c.d.answer) + '</span>' : 'Answer' }),
    act(card, a, x) {
      if (a === 'open-blank') return openBlank(card);
      if (a === 'answer' && x.value) {
        if (card._src) { const src = card._src; closeBlank(card); src.update({ state: 'answered', answer: x.value }); }
        else card.update({ state: 'answered', answer: x.value });
      }
      if (a === 'later' && card._src) closeBlank(card);
    }
  };

  /* ---------------- teammate request or hand-off, from a named bot */
  KINDS.teammate = {
    states: ['pending', 'accepted', 'declined'],
    initial: 'pending',
    tone: (c) => ({ pending: 'none', accepted: 'ink', declined: 'ring' })[c.s],
    resolved: (c) => c.s !== 'pending',
    orb: (c) => ({ pending: 'listening', accepted: 'happy', declined: 'idle' })[c.s],
    say: (c) => cap(c.s) + ': ' + c.plain,
    text: (c) => sentenceText(c.d),
    render(c) {
      const d = c.d;
      const f = c.s === 'pending' ? foot(meta(parts(d.meta).map((p) => '<span>' + fmt(p) + '</span>')), actions(btn('decline', 'Decline') + btn('accept', 'Accept', 'primary')))
        : foot(receipt(at(cap(c.s), c), c.s === 'accepted'));
      return { side: orb(d.from, c.size === 'compact' ? 20 : 24), head: headrow(c, sentenceHTML(d)) + quote(d.quote), body: well(d.item), foot: f };
    },
    mini: (c) => mini(c, { lead: miniOrb(c.d), text: sentenceHTML(c.d), meta: esc(c.s === 'pending' ? parts(c.d.meta)[0] || '' : cap(c.s)) }),
    act(card, a) {
      if (a === 'accept') card._setState('accepted');
      if (a === 'decline') card._setState('declined');
    }
  };

  /* ---------------- escalation: the governance ladder moved the session to a stronger model */
  KINDS.escalation = {
    states: ['escalated', 'capped'],
    initial: 'escalated',
    tone: (c) => (c.s === 'capped' ? 'red' : 'none'),
    stamp: () => 'needs you',
    resolved: () => false,
    say: (c) => this_text(c),
    text: (c) => this_text(c),
    ladder(c) {
      const L = c.d.ladder || [], cur = c.d.current != null ? c.d.current : L.findIndex((x) => x[0] === c.d.to);
      return { L, cur };
    },
    stations(c, ground) {
      const { L, cur } = this.ladder(c);
      return U().html.ladder({ stations: L, current: cur, ground: ground || 'var(--cd-surface)' });
    },
    whatHTML: (c) => (c.s === 'capped' ? 'Stopped at the ' + mono(c.d.cap) + ' cap' : 'Moved up to ' + mono(c.d.to)),
    why: (c) => (c.s === 'capped' ? 'The next step needs ' + (c.d.next || 'opus 5.5') : cap(c.d.reason)),
    inline(c) {
      const d = c.d;
      const end = c.s === 'capped'
        ? actions(btn('stop', 'Stop here', null, { size: 's' }) + btn('raise', 'Raise cap to ' + (d.raiseTo || '$1.00'), 'primary', { size: 's' }))
        : '<span class="cd-rule__meta">' + esc(d.spent) + ' of ' + esc(d.cap) + '</span>';
      return '<div class="cd-rule" role="note" aria-labelledby="' + c.id + '-t">' + this.stations(c, 'var(--bg-2)') +
        '<span class="cd-rule__what"><span id="' + c.id + '-t">' + this.whatHTML(c) + '</span><span class="ui-stamp" data-stamp></span></span>' +
        '<span class="cd-rule__why">' + fmt(this.why(c)) + '</span>' +
        '<span class="cd-rule__line" aria-hidden="true"></span>' + end + '</div>';
    },
    render(c) {
      const d = c.d, { L, cur } = this.ladder(c);
      const steps = U().html.ladder({ stations: L.map((x) => [x[0], cap(x[1])]), current: cur, variant: 'list', ground: 'var(--cd-surface)' });
      const f = c.s === 'capped' ? foot(meta(['<span>' + esc(d.spent) + ' of ' + esc(d.cap) + '</span>']), actions(btn('stop', 'Stop here') + btn('raise', 'Raise to ' + (d.raiseTo || '$1.00'), 'primary')))
        : foot(meta(['<span>' + esc(d.spent) + ' of ' + esc(d.cap) + ' spent</span>']));
      return { head: headrow(c, this.whatHTML(c)) + '<p class="cd-quote">' + fmt(this.why(c)) + '</p>', body: steps, foot: f };
    },
    mini(c) {
      return mini(c, { lead: this.stations(c), text: c.s === 'capped' ? 'Stopped at ' + mono(c.d.cap) : 'On ' + mono(c.d.to), meta: c.s === 'capped' ? 'Raise cap' : 'from ' + esc(c.d.from) });
    },
    act(card, a) {
      if (a === 'raise') card.update({ state: 'escalated', cap: card._d.raiseTo || '$1.00' });
    }
  };
  function this_text(c) { return c.s === 'capped' ? 'Stopped at the ' + c.d.cap + ' cap' : 'Moved up to ' + c.d.to; }

  /* ---------------- error: a gate failed */
  KINDS.error = {
    states: ['failed', 'retrying', 'passed'],
    initial: 'failed',
    tone: (c) => ({ failed: 'red', retrying: 'pulse', passed: 'ink' })[c.s],
    stamp: () => 'failed',
    resolved: (c) => c.s === 'passed',
    say: (c) => c.plain,
    text: (c) => ({ failed: c.d.gate + ' failed', retrying: 'Retrying ' + c.d.gate + ' on ' + c.d.retryWith, passed: c.d.gate + ' passes' })[c.s],
    leadHTML: (c) => ({ failed: mono(c.d.gate) + ' failed', retrying: 'Retrying ' + mono(c.d.gate) + ' on ' + mono(c.d.retryWith), passed: mono(c.d.gate) + ' passes' })[c.s],
    render(c) {
      const d = c.d;
      const out = (d.output || []).length ? '<div class="cd-well cd-out">' + d.output.map((l) => '<div' + (/FAIL/.test(l) ? ' class="cd-out__hit"' : '') + '>' + esc(l) + '</div>').join('') + '</div>' : '';
      const f = c.s === 'failed' ? foot('', actions(btn('view-output', 'View output') + btn('retry', 'Retry on ' + d.retryWith, 'primary')))
        : c.s === 'retrying' ? foot('<p class="cd-receipt">' + breath() + '<span>Running on ' + mono(d.retryWith) + '</span></p>', actions(btn('stop', 'Stop')))
          : foot(receipt(at('Passed on retry', c), true), actions(btn('view-output', 'View output')));
      return { head: headrow(c, this.leadHTML(c)) + (d.test ? '<p class="cd-quote cd-mono">' + fmt(d.test) + '</p>' : ''), body: out + (d.note ? '<p class="cd-note">' + fmt(d.note) + '</p>' : ''), foot: f };
    },
    mini(c) { return mini(c, { text: this.leadHTML(c), meta: c.s === 'failed' ? 'Retry' : c.s === 'retrying' ? breath() : esc(c.at) }); },
    act(card, a) {
      if (a === 'retry') card._setState('retrying');
      if (a === 'stop') card._setState('failed');
    }
  };

  /* ---------------- schedule: a bot asks to run on a timer */
  KINDS.schedule = {
    states: ['pending', 'scheduled', 'dismissed'],
    initial: 'pending',
    tone: (c) => ({ pending: 'none', scheduled: 'ink', dismissed: 'ring' })[c.s],
    resolved: (c) => c.s !== 'pending',
    orb: (c) => ({ pending: 'idle', scheduled: 'happy', dismissed: 'idle' })[c.s],
    say: (c) => (c.s === 'scheduled' ? 'Scheduled: ' : c.s === 'dismissed' ? 'Not scheduled: ' : '') + c.plain,
    text: (c) => sentenceText(c.d, 'wants to'),
    render(c) {
      const d = c.d, days = d.days || [1, 1, 1, 1, 1, 0, 0], L = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], N = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const on = N.filter((_, i) => days[i]);
      const week = '<div class="cd-week" role="img" aria-label="Runs on ' + esc(on.join(', ')) + '">' + L.map((l) => '<b aria-hidden="true">' + l + '</b>').join('') + days.map((x) => '<i' + (x ? ' data-on' : '') + '></i>').join('') + '</div>';
      const body = '<div class="cd-sched">' + week + '<div class="cd-sched__when"><span class="cd-sched__time">' + esc(d.time) + (d.cron ? code(d.cron) : '') + '</span><span class="cd-dim">' + esc(cap(d.when)) + '</span></div></div>';
      const f = c.s === 'pending' ? foot(meta(parts(d.meta).map((p) => '<span>' + fmt(p) + '</span>')), actions(btn('dismiss', 'Not now', 'ghost') + btn('schedule', 'Schedule it', 'primary')))
        : c.s === 'scheduled' ? foot(receipt('Scheduled, first run ' + esc(d.next || ''), true), actions(btn('edit', 'Edit')))
          : foot(receipt('Not scheduled'), actions(btn('undo-dismiss', 'Schedule it')));
      return { side: orb(d.from, c.size === 'compact' ? 20 : 24), head: headrow(c, sentenceHTML(d, 'wants to')) + quote(d.quote), body, foot: f };
    },
    mini: (c) => mini(c, { lead: miniOrb(c.d), text: sentenceHTML(c.d, 'wants to'), meta: esc(c.d.time) }),
    act(card, a) {
      if (a === 'schedule' || a === 'undo-dismiss') card._setState('scheduled');
      if (a === 'dismiss') card._setState('dismissed');
    }
  };

  /* ---------------- connector sign-in (owes nothing until it fails: no stamp while it simply needs a sign-in) */
  KINDS.connector = {
    states: ['needed', 'waiting', 'connected', 'failed'],
    initial: 'needed',
    tone: (c) => ({ needed: 'none', waiting: 'pulse', connected: 'ink', failed: 'red' })[c.s],
    stamp: () => 'failed',
    resolved: (c) => c.s === 'connected',
    say: (c) => c.plain,
    text(c) {
      const n = cap(c.d.name);
      return { needed: n + ' needs you to sign in', waiting: 'Waiting for ' + n + ' in your browser', connected: n + ' is connected', failed: n + ' sign-in did not finish' }[c.s];
    },
    render(c) {
      const d = c.d, n = cap(d.name);
      const text = {
        needed: 'Sign in once to give this session its ' + d.tools + ' ' + n + ' tools.',
        waiting: 'Finish signing in on ' + (d.host || n) + '. This card updates when it’s done.',
        connected: d.tools + ' tools ready' + (d.scopes ? ': ' + d.scopes.join(', ') : '') + '.',
        failed: 'The browser closed before ' + n + ' sent a token. Try again, or sign in later from Connectors.'
      }[c.s];
      const note = c.s === 'needed' || c.s === 'waiting' ? '<p class="cd-note">Opens ' + esc(d.host || n) + ' in your browser. The token stays on this machine.</p>' : '';
      const f = c.s === 'needed' ? foot('', actions(btn('later', 'Not now', 'ghost') + btn('sign-in', 'Sign in', 'primary')))
        : c.s === 'waiting' ? foot('<p class="cd-receipt">' + breath() + '<span>Waiting for the browser</span></p>', actions(btn('cancel', 'Cancel')))
          : c.s === 'connected' ? foot(receipt(at('Connected', c), true))
            : foot('', actions(btn('later', 'Not now', 'ghost') + btn('sign-in', 'Try again', 'primary')));
      return { side: '<span class="cd-tile" aria-hidden="true">' + esc(n.slice(0, 1)) + '</span>', head: headrow(c, esc(this.text(c))), body: '<p class="cd-text">' + esc(text) + '</p>' + note, foot: f };
    },
    mini(c) { return mini(c, { lead: '<span class="cd-tile" aria-hidden="true">' + esc(cap(c.d.name).slice(0, 1)) + '</span>', text: esc(this.text(c)), meta: c.s === 'needed' || c.s === 'failed' ? 'Sign in' : c.s === 'waiting' ? breath() : esc(c.at) }); },
    act(card, a) {
      if (a === 'sign-in') card._setState('waiting');
      if (a === 'cancel') card._setState('needed');
    }
  };

  /* ================================================================ the element */
  const LIVE = new Set();
  const QUEUES = new Set();
  let lastAttn = -1, attnQueued = false;
  function emitAttention() {
    if (attnQueued) return;
    attnQueued = true;
    queueMicrotask(() => {
      attnQueued = false;
      let n = 0;
      for (const c of LIVE) if (c._attn()) n++;
      for (const q of QUEUES) if (q.isConnected) n += q._waiting();
      if (n !== lastAttn) { lastAttn = n; const H = hx(); if (H && H.emit) H.emit('hx:attention', { source: 'cards', count: n }); }
    });
  }

  class HxCard extends HTMLElement {
    connectedCallback() {
      if (!this._kind) return;
      LIVE.add(this);
      if (this._kind === 'approval') { this._tick(); this._timer = this._timer || setInterval(() => this._tick(), 1000); }
      if (this._state === 'holding' && typeof this._d.progress === 'number') requestAnimationFrame(() => { const h = this._holdBtn(); if (h && h._hold) h._hold.show(this._d.progress); });
      emitAttention();
    }
    disconnectedCallback() {
      LIVE.delete(this);
      clearInterval(this._timer); this._timer = 0;
      const h = this._holdBtn(); if (h && h._hold && h.dataset.state !== 'done') h._hold.reset();
      emitAttention();
    }
    get kind() { return this._kind; }
    get state() { return this._state; }
    get data() { return this._d; }
    get size() { return this._size; }

    _init(kind, d, opts) {
      /* the modules' own shapes: bots.js passes {bot: id}; the dock's waits carry {bot, lines, cost} */
      if (!d.from && d.bot && bot(d.bot)) d.from = d.bot;
      if (!d.item && Array.isArray(d.lines)) d.item = d.lines;
      if (d.cost && kind === 'approval') { d.meta = parts(d.meta).concat(parts(d.cost)); delete d.cost; }
      if (kind === 'ship' && !Array.isArray(d.files)) {
        /* a count only (data.js conversation.ship): use the session's change list when it matches */
        const ch = DATA().changes;
        d.files = Array.isArray(ch) && ch.length && (d.files == null || +d.files === ch.length) ? ch.map((x) => x.slice()) : [];
      }
      this._kind = kind; this._d = d; this._opts = opts; this._K = KINDS[kind];
      this._size = opts.size || 'inline';
      if (kind !== 'blank' && this._size === 'popover') this._size = 'compact';
      this._id = nid(); this._sig = {};
      this._state = opts.state || d.state || this._K.initial;
      delete d.state;
      if (this._K.states.indexOf(this._state) < 0) this._state = this._K.initial;
      this._at = d.decidedAt || Date.now();
      this.dataset.kind = kind; this.dataset.size = this._size;
      if (opts.ground) this.dataset.ground = opts.ground;
      this._inlineOnly = this._size === 'inline' && !!this._K.inline;
      if (this._size === 'mini') {
        this.innerHTML = '<div data-r="row"></div>';
      } else if (this._inlineOnly) {
        this.innerHTML = kind === 'blank' ? '<span data-r="row"></span>' : '<div data-r="row"></div>';
      } else {
        this.innerHTML = '<div class="cd-side" data-r="side"></div><div class="cd-main"><div data-r="head"></div><div data-r="body"></div><div data-r="foot"></div></div>';
        if (this._size === 'popover') { this.setAttribute('role', 'dialog'); this.setAttribute('aria-modal', 'true'); }
        else this.setAttribute('role', 'article');
        this.setAttribute('aria-labelledby', this._id + '-t');
      }
      const live = document.createElement('span');
      live.className = 'ui-sr'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
      this.append(live); this._live = live;
      this._regions = {};
      for (const r of this.querySelectorAll('[data-r]')) this._regions[r.dataset.r] = r;
      if (kind === 'approval') this._armExpiry(false);
      this.addEventListener('click', (e) => this._onClick(e));
      this.addEventListener('keydown', (e) => this._onKey(e));
      this._render(false);
      if (opts.enter) animate(this, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { preset: 'settle' });
    }

    _ctx() {
      const K = this._K;
      const c = { d: this._d, s: this._state, size: this._size, id: this._id, at: clock(this._at), q: this._opts.queue, card: this };
      try { c.plain = K.text ? String(K.text(c)).replace(/`/g, '') : ''; } catch (e) { c.plain = ''; }
      c.tone = K.tone(c) || 'none';
      /* what the card owes the user, in the stamp's words; nothing inside the popover (its question sits right above) */
      c.owe = c.tone === 'red' && this._size !== 'popover' ? (K.stamp ? K.stamp(c) : 'needs you') : '';
      return c;
    }

    update(patch) {
      patch = Object.assign({}, patch || {});
      const next = patch.state;
      delete patch.state;
      Object.assign(this._d, patch);
      if (next && next !== this._state && this._K.states.indexOf(next) >= 0) return this._setState(next);
      this._render(true);
      return this;
    }

    _setState(next) {
      const prev = this._state;
      if (prev === next) return this;
      this._state = next;
      const quiet = this._K.quiet && this._K.quiet[prev + '>' + next];
      if (!quiet) {
        this._at = Date.now();
        if (this._kind === 'approval' && (next === 'pending' || next === 'holding')) {
          if (this._expiresAt && this._expiresAt <= Date.now() + 1000) this._expiresAt = 0;
          this._armExpiry(false);
        }
        this._render(true);
        if (this._K.say) this._announce(this._K.say(this._ctx()));
      } else {
        this.dataset.state = next;
      }
      this.dispatchEvent(new CustomEvent('hx:card-state', { bubbles: true, composed: true, detail: { kind: this._kind, state: next, prev, data: this._d, card: this } }));
      emitAttention();
      return this;
    }

    _announce(text) {
      if (!text || !this._live) return;
      this._live.textContent = '';
      setTimeout(() => { if (this._live) this._live.textContent = text; }, 30);
    }

    _attn() {
      if (this._size === 'popover') return false;
      const c = { d: this._d, s: this._state, size: this._size };
      if (this._K.attention) return this._K.attention(c);
      return this._K.tone(c) === 'red';
    }

    _render(anim) {
      const K = this._K, c = this._ctx();
      const out = this._size === 'mini' ? { row: K.mini(c) } : this._inlineOnly ? { row: K.inline.call(K, c) } : K.render.call(K, c);
      const motionOn = anim && this.isConnected;
      const h0 = motionOn ? this.getBoundingClientRect().height : 0;
      let changed = false;
      const focusIn = this.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focusIn && (focusIn.dataset.action || (focusIn.hasAttribute('data-hold') ? 'hold' : focusIn.dataset.opt != null ? 'opt' + focusIn.dataset.opt : focusIn.tagName));
      for (const name in this._regions) {
        const el = this._regions[name], html = out[name] || '';
        if (this._sig[name] === html) continue;
        changed = true;
        if (motionOn && this._sig[name] && el.offsetParent) swapRegion(el, html); else el.innerHTML = html;
        this._sig[name] = html;
      }
      if (this._regions.side) this.toggleAttribute('data-side', !!out.side);
      this._applyState(c, motionOn);
      this._hydrate(c);
      if (focusIn && !this.contains(focusIn)) this._restoreFocus(focusKey);
      if (motionOn && changed && this._size !== 'mini' && !(this._inlineOnly && this._kind === 'blank')) this._flipHeight(h0);
    }

    _restoreFocus(key) {
      /* never a button inside a fading ghost: those are inert copies of what just left */
      const live = (sel) => Array.from(this.querySelectorAll(sel)).find((x) => !x.closest('.cd-ghost') && !x.disabled) || null;
      let t = null;
      if (key === 'hold') t = live('[data-hold]');
      else if (key && key.indexOf('opt') === 0) t = live('[data-opt="' + key.slice(3) + '"]');
      else if (key) t = live('[data-action="' + key + '"]');
      t = t || live('.cd-foot button') || live('.cd-mini, .cd-blank') || live('button');
      if (t) t.focus({ preventScroll: true });
      else { this.tabIndex = -1; this.focus({ preventScroll: true }); }
    }

    _applyState(c, motionOn) {
      const K = this._K;
      this.dataset.state = this._state;
      const tone = c.tone, owe = c.owe;
      const prevTone = this.dataset.tone;
      this.dataset.tone = tone;
      /* the stamp in the card's corner (one-line rows carry the dot and the same words, from the template) */
      for (const s of this.querySelectorAll('[data-stamp]')) {
        if (s.closest('.cd-ghost')) continue;
        if (s.textContent !== owe) {
          s.textContent = owe;
          if (motionOn && owe && prevTone !== tone) animate(s, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { preset: 'quick' });
        }
      }
      /* KEYMAP §3: the focusable element of an item that waits on the user carries data-hx-attention (F8 finds it) */
      for (const a of this.querySelectorAll('[data-hx-attention]')) a.removeAttribute('data-hx-attention');
      if (owe || (this._kind === 'blank' && this._state === 'open' && this._size !== 'popover')) {
        const live = (sel) => Array.from(this.querySelectorAll(sel)).find((x) => !x.closest('.cd-ghost') && !x.disabled);
        const t = live('[data-hold]') || live('.cd-blank') || live('.cd-mini') || live('.ui-btn--primary') || live('.cd-foot button, .cd-rule button');
        if (t) t.setAttribute('data-hx-attention', '');
      }
      this.toggleAttribute('data-resolved', !!(K.resolved && K.resolved(c)));
      this.toggleAttribute('aria-busy', tone === 'pulse');
      if (K.orb) {
        const r = K.orb(c);
        for (const o of this.querySelectorAll('orb-avatar')) if (o.getAttribute('reaction') !== r) o.setAttribute('reaction', r);
      }
    }

    _holdBtn() { return Array.from(this.querySelectorAll('[data-hold]')).find((x) => !x.closest('.cd-ghost')) || null; }

    _hydrate() {
      const hold = this._holdBtn();
      if (hold && !hold._cdWired) {
        hold._cdWired = true;
        U().hold.wire(hold, { announce: (t) => this._announce(t) });
        /* the library's commit is the card's approve; a host that cancels the action leaves the button armed */
        hold.addEventListener('ui:commit', (e) => { if (!this._act('approve')) e.preventDefault(); });
        /* holding is a card state too: follow the button's data-state */
        new MutationObserver(() => {
          const st = hold.dataset.state;
          if (st === 'holding' && this._state === 'pending') this._setState('holding');
          else if (st === 'idle' && this._state === 'holding') this._setState('pending');
        }).observe(hold, { attributes: true, attributeFilter: ['data-state'] });
      }
      if (hold && this._state === 'holding' && typeof this._d.progress === 'number' && this.isConnected) hold._hold.show(this._d.progress);
      if (this._kind === 'blank' && (this._size === 'popover' || this._size === 'compact')) wireOptions(this);
      this._tick();
    }

    /* the owner's rule: a card that changes state grows or shrinks over --dur-3 on --spring, so the
       conversation under it never jumps. Under reduced motion --dur-3 is 1ms and it snaps. */
    _flipHeight(h0) {
      const h1 = this.getBoundingClientRect().height;
      if (Math.abs(h1 - h0) < 1 || reduced()) return;
      if (this._hAnim) this._hAnim.cancel();
      const m = motion('settle');
      this.style.overflow = 'clip';
      const a = this.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], m);
      this._hAnim = a;
      const done = () => { if (this._hAnim === a) { this.style.overflow = ''; this._hAnim = null; } };
      a.onfinish = done; a.oncancel = done;
    }

    _armExpiry(force) {
      if (this._expiresAt && !force) return;
      const d = this._d;
      if (d.expiresAt) { this._expiresAt = +d.expiresAt; return; }
      const m = /expires in (\d+(?:\.\d+)?)\s*(min|s)/i.exec(parts(d.meta).join(' '));
      if (m) this._expiresAt = Date.now() + (+m[1]) * (m[2] === 'min' ? 60000 : 1000);
    }

    _tick() {
      if (this._kind !== 'approval' || !this._expiresAt) return;
      const live = this._state === 'pending' || this._state === 'holding';
      if (!live) return;
      const left = this._expiresAt - Date.now();
      for (const s of this.querySelectorAll('[data-countdown]')) {
        const t = expiryText(left, s.dataset.countdown === 'short');
        if (s.textContent !== t) s.textContent = t;
      }
      if (left <= 0 && this.isConnected) { const h = this._holdBtn(); if (h && h._hold) h._hold.reset(); this._setState('expired'); }
    }

    _onClick(e) {
      const b = e.target.closest('[data-action]');
      if (!b || b.closest('hx-card') !== this || b.disabled) return;
      let value;
      if (b.dataset.action === 'answer') value = blankValue(this);
      this._act(b.dataset.action, { value, el: b });
    }

    /* KEYMAP §6: x denies while focus is in an approval; d opens the diff from a ship card (never while typing) */
    _onKey(e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const live = this._state === 'pending' || this._state === 'holding';
      if (e.code === 'KeyX' && this._kind === 'approval' && live && this._size !== 'mini') {
        e.preventDefault();
        const h = this._holdBtn(); if (h && h._hold) h._hold.reset();
        this._act('deny');
      } else if (e.code === 'KeyD' && this._kind === 'ship' && this.querySelector('[data-action="view-diff"]')) {
        e.preventDefault();
        this._act('view-diff');
      }
    }

    _act(action, x) {
      x = x || {};
      const detail = { kind: this._kind, action, data: this._d, state: this._state, value: x.value, card: this };
      const ok = this.dispatchEvent(new CustomEvent('hx:card-action', { bubbles: true, composed: true, cancelable: true, detail }));
      if (ok && this._K.act) this._K.act(this, action, x);
      return ok;
    }
  }
  if (!customElements.get('hx-card')) customElements.define('hx-card', HxCard);


  /* swap one region's content in place: the old content fades out first, then the new one settles in */
  function swapRegion(el, html) {
    if (el.childNodes.length) {
      const g = el.cloneNode(true);
      g.removeAttribute('data-r'); g.removeAttribute('id');
      for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
      g.classList.add('cd-ghost'); g.setAttribute('aria-hidden', 'true'); g.inert = true;
      g.style.cssText += ';position:absolute;margin:0;pointer-events:none;left:' + el.offsetLeft + 'px;top:' + el.offsetTop + 'px;width:' + el.offsetWidth + 'px';
      el.parentNode.appendChild(g);
      const a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 1 : 90, easing: tok('--ease', 'ease-out'), fill: 'forwards' });
      a.onfinish = () => g.remove();
    }
    el.innerHTML = html;
    if (html) animate(el, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { preset: 'fade', delay: 70, fill: 'backwards' });
  }

  /* ================================================================ the expanded blank */
  function wireOptions(card) {
    const group = card.querySelector('.cd-opts');
    if (!group || group._wired) return;
    group._wired = true;
    const opts = Array.from(group.querySelectorAll('.cd-opt'));
    const free = card.querySelector('.cd-free'), input = free && free.querySelector('input');
    const answer = card.querySelector('[data-action="answer"]');
    const checked = () => opts.findIndex((o) => o.getAttribute('aria-checked') === 'true');
    function select(i, focus) {
      opts.forEach((o, j) => { o.setAttribute('aria-checked', String(i === j)); o.tabIndex = (i === j || (i < 0 && j === 0)) ? 0 : -1; });
      if (free) free.toggleAttribute('data-on', i < 0 && !!(input && input.value.trim()));
      if (i >= 0 && opts[i]) {
        const ring = opts[i].querySelector('.cd-opt__ring');
        animate(ring, [{ transform: 'scale(.5)' }, { transform: 'scale(1)' }], { preset: 'quick' });
        if (focus) opts[i].focus();
      }
      if (answer) answer.disabled = !(i >= 0 || (input && input.value.trim()));
    }
    select(checked(), false);
    opts.forEach((o, i) => {
      o.addEventListener('click', () => { if (input) input.value = ''; select(i, false); });
      o.addEventListener('dblclick', () => { select(i, false); card._act('answer', { value: blankValue(card) }); });
    });
    group.addEventListener('keydown', (e) => {
      const i = Math.max(0, opts.indexOf(document.activeElement));
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (i === opts.length - 1 && input) { select(-1); input.focus(); } else select((i + 1) % opts.length, true); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); select((i - 1 + opts.length) % opts.length, true); }
      else if (e.key === 'Enter' && checked() >= 0) { e.preventDefault(); card._act('answer', { value: blankValue(card) }); }
    });
    card.addEventListener('keydown', (e) => {
      if (e.target === input) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= opts.length && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (input) input.value = ''; select(n - 1, true); }
    });
    if (input) {
      input.addEventListener('input', () => { if (input.value.trim()) select(-1); else select(checked()); if (free) free.toggleAttribute('data-on', !!input.value.trim()); if (answer) answer.disabled = !input.value.trim() && checked() < 0; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); card._act('answer', { value: input.value.trim() }); }
        if (e.key === 'ArrowUp') { e.preventDefault(); select(opts.length - 1, true); }
      });
    }
  }
  function blankValue(card) {
    const input = card.querySelector('.cd-free input');
    if (input && input.value.trim()) return input.value.trim();
    const o = card.querySelector('.cd-opt[aria-checked="true"]');
    return o ? card._d.options[+o.dataset.opt] : null;
  }

  /* the expanded blank is a card that brings its own surface; the library's one layer places it below the gap,
     closes it on Esc or an outside press, loops Tab inside and returns focus to the gap */
  function openBlank(src) {
    const trigger = src.querySelector('.cd-blank');
    const pop = create('blank', src._d, { size: 'popover', state: src._state });
    pop._src = src;
    pop.setAttribute('data-layer', '');
    const layer = src._opts.layer && document.querySelector(src._opts.layer);
    const node = U().layer.open(trigger, pop, { place: 'below', layer: layer || undefined, onClose: () => { if (src._pop === pop) src._pop = null; } });
    if (!node) return null; /* the same gap again: the layer closed it */
    src._pop = pop;
    const first = pop.querySelector('.cd-opt[aria-checked="true"]') || pop.querySelector('.cd-opt');
    if (first) { first.tabIndex = 0; first.focus({ preventScroll: true }); }
    return pop;
  }
  function closeBlank(pop) {
    if (pop && pop.isConnected) U().layer.close();
  }

  /* ================================================================ queue: one decision at a time, the next one peeks */
  function queue(items, opts) {
    opts = opts || {};
    const size = opts.size || 'compact';
    const root = document.createElement('div');
    root.className = 'cd-queue';
    root.dataset.size = size;
    if (opts.ground) root.dataset.ground = opts.ground;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', opts.label || 'Approval requests');
    root.innerHTML = '<div class="cd-queue__stage"><div class="cd-queue__peek" aria-hidden="true"></div><div class="cd-queue__peek" aria-hidden="true"></div></div>';
    const stage = root.firstChild, peeks = stage.querySelectorAll('.cd-queue__peek');
    const list = items.slice();
    let idx = 0, cur = null, busy = false;
    const tally = {};
    function peekState(animateIt) {
      const rest = list.length - idx - 1;
      peeks[0].hidden = rest < 1; peeks[1].hidden = rest < 2;
      stage.style.setProperty('--cd-peek', (rest >= 2 ? 14 : rest === 1 ? 7 : 0) + 'px');
      if (!animateIt) for (const p of peeks) { p.style.transition = 'none'; void p.offsetWidth; p.style.transition = ''; }
    }
    function mount(i, enter) {
      const it = list[i];
      const card = create(it.kind || 'approval', Object.assign({}, it.data || it), Object.assign({}, opts, { size, queue: { index: i, total: list.length }, enter: false }));
      stage.appendChild(card);
      cur = card;
      if (enter) animate(card, [{ opacity: 0, transform: 'translateY(10px) scale(.96)' }, { opacity: 1, transform: 'none' }], { preset: 'settle' });
      return card;
    }
    function settle(card) {
      const s = card.state;
      if (s === 'approved' || s === 'denied' || s === 'expired') {
        tally[s] = (tally[s] || 0) + 1;
        setTimeout(() => promote(card), reduced() ? 300 : 900);
      }
    }
    function promote(old) {
      if (busy || old !== cur) return;
      busy = true;
      const hadFocus = old.contains(document.activeElement);
      const h0 = root.getBoundingClientRect().height;
      old.style.position = 'absolute'; old.style.left = '0'; old.style.right = '0'; old.style.top = '0'; old.style.zIndex = '4';
      const out = animate(old, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { preset: 'fade', duration: 160, fill: 'forwards' });
      idx++;
      if (idx < list.length) {
        const next = mount(idx, true);
        peekState(true);
        next._announce('Request ' + (idx + 1) + ' of ' + list.length + ': ' + next._ctx().plain);
        if (hadFocus) { const h = next.querySelector('[data-hold]') || next.querySelector('.ui-btn--primary') || next.querySelector('button'); if (h) h.focus({ preventScroll: true }); }
      } else {
        cur = null;
        peekState(true);
        const n = list.length, a = tally.approved || 0, dn = tally.denied || 0, ex = tally.expired || 0;
        const done = document.createElement('div');
        done.className = 'cd-queue__done'; done.setAttribute('role', 'status'); done.tabIndex = -1;
        done.innerHTML = check() + '<span>' + n + ' decided: ' + [a ? a + ' approved' : '', dn ? dn + ' denied' : '', ex ? ex + ' expired' : ''].filter(Boolean).join(', ') + '</span>';
        stage.appendChild(done);
        animate(done, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { preset: 'fade' });
        if (hadFocus) done.focus({ preventScroll: true });
        root.dispatchEvent(new CustomEvent('hx:queue-empty', { bubbles: true, detail: { tally: Object.assign({}, tally) } }));
      }
      const fin = () => { old.remove(); busy = false; emitAttention(); };
      if (out) out.onfinish = fin; else fin();
      /* the queue keeps the cards' rule: its height follows the next card on --dur-3 / --spring */
      const h1 = root.getBoundingClientRect().height;
      if (!reduced() && Math.abs(h1 - h0) > 1) root.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], motion('settle'));
      emitAttention();
    }
    root.addEventListener('hx:card-state', (e) => { if (e.detail.card === cur) settle(cur); });
    root._waiting = () => Math.max(0, list.length - idx - 1);
    root.add = (item) => { list.push(item); if (!cur && idx >= list.length - 1) { const d = stage.querySelector('.cd-queue__done'); if (d) d.remove(); mount(idx, true); } peekState(true); emitAttention(); return root; };
    Object.defineProperty(root, 'current', { get: () => cur });
    QUEUES.add(root);
    if (list.length) mount(0, false);
    peekState(false);
    return root;
  }

  /* ================================================================ public API */
  function create(kind, data, opts) {
    if (!KINDS[kind]) throw new Error('hx cards: unknown kind "' + kind + '"');
    const el = document.createElement('hx-card');
    el._init(kind, Object.assign({}, data || {}), opts || {});
    return el;
  }
  const api = {
    create,
    queue,
    kinds: Object.keys(KINDS),
    states: (kind) => (KINDS[kind] ? KINDS[kind].states.slice() : []),
    sizes: ['inline', 'compact', 'mini'],
    openBlank: (card) => openBlank(card),
    closeBlank: () => U().layer.close(),
    version: '6.1.0'
  };
  window.HX.cards = api;
  /* if the shell replaces window.HX after this file ran, hand the API over */
  document.addEventListener('DOMContentLoaded', () => { if (window.HX && !window.HX.cards) window.HX.cards = api; });
})();
