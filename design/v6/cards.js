/* boopis v6 · cards (owner: cards agent)
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
  /* a model wherever one appears: its provider's mark beside its name (components/model-mark.js), mono, from the tokens */
  const model = (m, size) => U().html.model(m, { size: size || 14, class: 'cd-mono', mono: false });
  /* a route ('qwen3-coder → sonnet 5.5') asks as the model it ended on: one mark, one name, in every slot and row
     (the route itself is the session's call number) */
  const asker = (m) => U().modelMark.last(m) || String(m || '');

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
  /* ---------------------------------------------------------------- origin: who is asking, one slot for every card
     (FORMS.md §4a). {kind: 'teammate', ids, via} | {kind: 'agent', model} | {kind: 'plugin'|'hermes'|'host'} |
     {kind: 'mcp', server, trust}. Older data ({from}, {bot}, {model}) is read as an origin. The slot draws:
     one teammate: its live orb, name and colour as the card's accent; several: stacked orbs (3, then +N) with every
     name on hover, focus and for screen readers; relayed: "nina, via atlas"; the agent: its model's provider mark and name;
     system sources: a quiet glyph and a label; an MCP server: its initial, name and trust. */
  const SYSTEM = { plugin: ['ladder', 'Governance'], hermes: ['spark', 'Hermes'], host: ['gear', 'boopis'] };
  function originOf(d) {
    const o = d.origin;
    if (o && o.kind) {
      if (o.kind === 'teammate') {
        const ids = (o.ids || (o.id ? [o.id] : [])).filter((x) => bot(x));
        return ids.length ? { kind: 'teammate', ids, via: o.via && bot(o.via) ? o.via : null } : null;
      }
      return o.kind === 'agent' ? Object.assign({}, o, { model: asker(o.model), route: o.model }) : o;
    }
    if (d.from && bot(d.from)) return { kind: 'teammate', ids: [d.from], via: d.via && bot(d.via) ? d.via : null };
    if (d.model) return { kind: 'agent', model: asker(d.model), route: d.model };
    return null;
  }
  const namesText = (ids) => { const n = ids.map((x) => bot(x).name); return n.length < 3 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
  function originText(o) {
    if (!o) return '';
    if (o.kind === 'teammate') return namesText(o.ids) + (o.via ? ', via ' + bot(o.via).name : '');
    if (o.kind === 'agent') return o.model;
    if (o.kind === 'mcp') return o.server + ' MCP server' + (o.trust ? ', ' + o.trust : '');
    if (o.kind === 'mod') return o.plugin + ' mod';
    return (SYSTEM[o.kind] || ['', o.kind])[1];
  }
  /* the visual alone: an orb, a stack, a glyph, a server's initial, or the agent's model mark (its provider's logo;
     a route draws its marks inline with the names instead) */
  /* still: drawn in an aria-hidden slot (a row's lead), so nothing in it takes focus */
  function originVisual(o, size, max, still) {
    if (!o) return '';
    if (o.kind === 'teammate') {
      if (o.ids.length === 1) return U().html.orb(bot(o.ids[0]), { size });
      const cap = Math.max(1, Math.min(max || 3, o.ids.length > (max || 3) ? (max || 3) - 1 : o.ids.length));
      const shown = o.ids.slice(0, cap), more = o.ids.length - shown.length;
      return '<span class="cd-stack" style="--s:' + size + 'px"' + (more && !still ? ' tabindex="0"' : '') + ' data-tip="' + esc(namesText(o.ids)) + '" role="img" aria-label="' + esc(namesText(o.ids)) + '">' +
        shown.map((id) => '<span class="cd-stack__one">' + U().html.orb(bot(id), { size }) + '</span>').join('') +
        (more ? '<span class="cd-stack__more" aria-hidden="true">+' + more + '</span>' : '') + '</span>';
    }
    if (o.kind === 'agent') return U().html.modelMark(o.model, { size: 16, class: 'cd-glyph' });
    if (o.kind === 'mod') return U().icon('mod', { class: 'cd-glyph' });
    if (o.kind === 'mcp') return '<span class="cd-tile" style="--cd-orb:' + size + 'px" aria-hidden="true">' + esc(String(o.server || '?').slice(0, 1).toUpperCase()) + '</span>';
    const g = SYSTEM[o.kind];
    return g ? U().icon(g[0], { class: 'cd-glyph' }) : '';
  }
  /* the names of an origin as one unit that never overflows (fitted by fitCard): the asker first, keeping the most
     room; then the others ("and kai", "and 2 others", chosen by measuring); then the relay or the server's kind
     (", via atlas"), which gives way first. One line, ellipses where cut, the whole text on hover and focus and
     always whole for screen readers. */
  const restOf = (n) => n.length === 2 ? ' and ' + n[1] : n.length === 3 ? ', ' + n[1] + ' and ' + n[2] : ' and ' + (n.length - 1) + ' others';
  function namesUnit(o, bare) {
    let first = '', rest = '', via = '', many = null, mono = false;
    if (o.kind === 'teammate') {
      const n = o.ids.map((x) => bot(x).name);
      first = n[0];
      if (n.length > 1) { many = n; rest = restOf(n); }
      if (o.via) via = ', via ' + bot(o.via).name;
    } else if (o.kind === 'agent') { first = o.model; mono = true; }
    else if (o.kind === 'mcp') { first = o.server; via = bare ? '' : ' MCP server' + (o.trust ? ', ' + o.trust : ''); }
    else if (o.kind === 'mod') { first = o.plugin; via = bare ? '' : ' mod'; }
    else first = (SYSTEM[o.kind] || ['', o.kind])[1];
    const vis = '<span class="cd-names__first' + (mono ? ' cd-mono' : '') + '">' + esc(first) + '</span>' +
      (many ? '<span class="cd-names__rest">' + esc(rest) + '</span>' : '') + (via ? '<span class="cd-names__via">' + esc(via) + '</span>' : '');
    /* several names or a relay: the drawn form may be shortened and is split into parts, so screen readers get one
       whole sentence instead ("nina, via atlas") */
    const whole = many || via;
    return '<span class="cd-names" data-full="' + esc(originText(o)) + '"' + (many ? ' data-names="' + esc(JSON.stringify(many)) + '"' : '') + '>' +
      (whole ? '<span class="cd-names__vis" aria-hidden="true">' + vis + '</span><span class="ui-sr">' + esc(originText(o)) + '</span>' : vis) + '</span>';
  }
  /* the byline above a card's title */
  const byline = (c) => (c.origin ? '<div class="cd-by" data-origin="' + (c.origin.kind === 'teammate' ? (c.origin.ids.length > 1 ? 'joint' : c.origin.via ? 'relay' : 'teammate') : c.origin.kind) + '">' +
    originVisual(c.origin, c.size === 'compact' || c.size === 'popover' ? 18 : 20) + '<span class="cd-by__label">' + namesUnit(c.origin) + '</span></div>' : '');
  /* one teammate lends its colour to the card as a restrained accent (a ring and a 5% tint); a nearly black orb
     is mixed toward the ink so the ring still shows on dark grounds */
  function accentOf(o) {
    if (!o || o.kind !== 'teammate' || o.ids.length !== 1) return '';
    const col = String(bot(o.ids[0]).color || '');
    const m = /^#?([0-9a-f]{6})$/i.exec(col);
    if (!m) return col;
    const n = parseInt(m[1], 16), lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L < 0.06 ? 'color-mix(in srgb, ' + col + ' 45%, var(--text))' : col;
  }
  /* titles are the request itself; who asks is the byline (screen readers hear both: "nina, Deploy to staging") */
  const sentenceHTML = (d) => fmt(cap(d.title));
  const sentenceText = (d) => { const w = originText(originOf(d)); return (w ? w + ': ' : '') + cap(d.title); };
  /* the head: the byline, the title, and in its corner the stamp of what you owe (filled in by _applyState) */
  const headrow = (c, html) => '<div class="cd-headrow"><div class="cd-headmain">' + byline(c) + '<p class="cd-lead" id="' + c.id + '-t">' + html + '</p></div><span class="ui-stamp" data-stamp></span></div>';
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
  /* one row: who (the origin's visual and name), what, the attention dot when it owes something, a short meta */
  function mini(ctx, o) {
    const owe = ctx.owe, or = ctx.origin;
    const lead = o.lead != null ? o.lead : originVisual(or, 16, 2, true);
    /* the who: at most half the line, more when the request is short (fitCard); an MCP server by its name alone */
    const who = or && o.who !== false ? '<span class="cd-mini__who">' + namesUnit(or, true) + '</span> ' : '';
    return '<button type="button" class="cd-mini" data-action="open" aria-labelledby="' + ctx.id + '-t' + (owe ? ' ' + ctx.id + '-o' : '') + (o.meta ? ' ' + ctx.id + '-m' : '') + '">' +
      '<span class="cd-mini__lead" aria-hidden="true">' + lead + '</span>' +
      '<span class="cd-mini__text" id="' + ctx.id + '-t">' + who + '<span class="cd-mini__what">' + o.text + '</span></span>' +
      '<span class="cd-mini__status"><span class="cd-mini__dot">' + (owe ? U().html.dot('attention') : '') + '</span>' +
      (owe ? '<span class="ui-sr" id="' + ctx.id + '-o">, ' + esc(owe) + '</span>' : '') +
      '<span class="cd-mini__meta"' + (o.meta ? ' id="' + ctx.id + '-m"' : '') + '>' + (o.meta || '') + '</span></span></button>';
  }


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
    text: (c) => sentenceText(c.d),
    render(c) {
      const d = c.d, live = c.s === 'pending' || c.s === 'holding';
      const metaParts = parts(d.meta).map((p) => /^expires in /i.test(p) ? '<span data-countdown>' + esc(cap(p)) + '</span>' : '<span>' + fmt(p) + '</span>');
      let f;
      if (live) f = foot(meta([qdots(c.q)].concat(metaParts)), actions(btn('deny', 'Deny', null, { keys: 'x' }) + holdHTML(c)));
      else if (c.s === 'approved') f = foot(receipt(at('Approved', c), true));
      else if (c.s === 'denied') f = foot(receipt(at('Denied', c)));
      else f = foot(receipt(at('Expired', c) + ', nothing ran'), actions(btn('ask-again', 'Ask again')));
      return {
        head: headrow(c, sentenceHTML(d)) + quote(d.quote),
        body: well(d.item),
        foot: f
      };
    },
    mini: (c) => mini(c, { text: sentenceHTML(c.d), meta: (c.s === 'pending' || c.s === 'holding') ? '<span data-countdown="short"></span>' : esc(cap(c.s)) }),
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
      return { head: headrow(c, sentenceHTML(d)) + quote(d.quote), body: well(d.item), foot: f };
    },
    mini: (c) => mini(c, { text: sentenceHTML(c.d), meta: esc(c.s === 'pending' ? parts(c.d.meta)[0] || '' : cap(c.s)) }),
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
    whatHTML: (c, size) => (c.s === 'capped' ? 'Stopped at the ' + mono(c.d.cap) + ' cap' : 'Moved up to ' + model(c.d.to, size)),
    whyHTML: (c) => (c.s === 'capped' ? 'The next step needs ' + model(c.d.next || 'opus 5.5') : fmt(cap(c.d.reason))),
    inline(c) {
      const d = c.d;
      const end = c.s === 'capped'
        ? actions(btn('stop', 'Stop here', null, { size: 's' }) + btn('raise', 'Raise cap to ' + (d.raiseTo || '$1.00'), 'primary', { size: 's' }))
        : '<span class="cd-rule__meta">' + esc(d.spent) + ' of ' + esc(d.cap) + '</span>';
      return '<div class="cd-rule" role="note" aria-labelledby="' + c.id + '-t">' + this.stations(c, 'var(--bg-2)') +
        '<span class="cd-rule__what"><span id="' + c.id + '-t">' + this.whatHTML(c, 14) + '</span><span class="ui-stamp" data-stamp></span></span>' +
        '<span class="cd-rule__why">' + this.whyHTML(c) + '</span>' +
        '<span class="cd-rule__line" aria-hidden="true"></span>' + end + '</div>';
    },
    render(c) {
      const d = c.d, { L, cur } = this.ladder(c);
      const steps = U().html.ladder({ stations: L.map((x) => [x[0], cap(x[1])]), current: cur, variant: 'list', ground: 'var(--cd-surface)' });
      const f = c.s === 'capped' ? foot(meta(['<span>' + esc(d.spent) + ' of ' + esc(d.cap) + '</span>']), actions(btn('stop', 'Stop here') + btn('raise', 'Raise to ' + (d.raiseTo || '$1.00'), 'primary')))
        : foot(meta(['<span>' + esc(d.spent) + ' of ' + esc(d.cap) + ' spent</span>']));
      return { head: headrow(c, this.whatHTML(c, 16)) + '<p class="cd-quote">' + this.whyHTML(c) + '</p>', body: steps, foot: f };
    },
    mini(c) {
      return mini(c, { who: false, lead: U().icon('ladder', { class: 'cd-glyph' }), text: c.s === 'capped' ? 'Stopped at ' + mono(c.d.cap) : 'On ' + model(c.d.to), meta: c.s === 'capped' ? 'Raise cap' : 'from ' + esc(c.d.from) });
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
    leadHTML: (c) => ({ failed: mono(c.d.gate) + ' failed', retrying: 'Retrying ' + mono(c.d.gate) + ' on ' + model(c.d.retryWith, 16), passed: mono(c.d.gate) + ' passes' })[c.s],
    render(c) {
      const d = c.d;
      const out = (d.output || []).length ? '<div class="cd-well cd-out">' + d.output.map((l) => '<div' + (/FAIL/.test(l) ? ' class="cd-out__hit"' : '') + '>' + esc(l) + '</div>').join('') + '</div>' : '';
      const f = c.s === 'failed' ? foot('', actions(btn('view-output', 'View output') + btn('retry', 'Retry on ' + d.retryWith, 'primary')))
        : c.s === 'retrying' ? foot('<p class="cd-receipt">' + breath() + '<span>Running on ' + model(d.retryWith) + '</span></p>', actions(btn('stop', 'Stop')))
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
    text: (c) => sentenceText(c.d),
    render(c) {
      const d = c.d, days = d.days || [1, 1, 1, 1, 1, 0, 0], L = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], N = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const on = N.filter((_, i) => days[i]);
      const week = '<div class="cd-week" role="img" aria-label="Runs on ' + esc(on.join(', ')) + '">' + L.map((l) => '<b aria-hidden="true">' + l + '</b>').join('') + days.map((x) => '<i' + (x ? ' data-on' : '') + '></i>').join('') + '</div>';
      const body = '<div class="cd-sched">' + week + '<div class="cd-sched__when"><span class="cd-sched__time">' + esc(d.time) + (d.cron ? code(d.cron) : '') + '</span><span class="cd-dim">' + esc(cap(d.when)) + '</span></div></div>';
      const f = c.s === 'pending' ? foot(meta(parts(d.meta).map((p) => '<span>' + fmt(p) + '</span>')), actions(btn('dismiss', 'Not now', 'ghost') + btn('schedule', 'Schedule it', 'primary')))
        : c.s === 'scheduled' ? foot(receipt('Scheduled, first run ' + esc(d.next || ''), true), actions(btn('edit', 'Edit')))
          : foot(receipt('Not scheduled'), actions(btn('undo-dismiss', 'Schedule it')));
      return { head: headrow(c, sentenceHTML(d)) + quote(d.quote), body, foot: f };
    },
    mini: (c) => mini(c, { text: sentenceHTML(c.d), meta: esc(c.d.time) }),
    act(card, a) {
      if (a === 'schedule' || a === 'undo-dismiss') card._setState('scheduled');
      if (a === 'dismiss') card._setState('dismissed');
    }
  };

  /* ---------------- connector sign-in (owes nothing until it fails: no stamp while it simply needs a sign-in) */
  KINDS.connector = {
    origin: (c) => ({ kind: 'mcp', server: c.d.name, trust: c.d.trust }),
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
      return { head: headrow(c, esc(this.text(c))), body: '<p class="cd-text">' + esc(text) + '</p>' + note, foot: f };
    },
    mini(c) { return mini(c, { who: false, text: esc(this.text(c)), meta: c.s === 'needed' || c.s === 'failed' ? 'Sign in' : c.s === 'waiting' ? breath() : esc(c.at) }); },
    act(card, a) {
      if (a === 'sign-in') card._setState('waiting');
      if (a === 'cancel') card._setState('needed');
    }
  };

  /* ---------------- form: one schema-driven card for everything that needs the user (FORMS.md)
     data: {id, kind, title, why, effect, origin, schema: {properties, required}, submit: {label, hold}, cancel:
     {label} | false, expires, diff, plan, contents, pinned, env}. The schema is MCP elicitation's (string, number,
     integer, boolean, enum with enumNames, title, description, default, format, minimum/maximum, minLength/maxLength,
     pattern) plus x-secret, x-multi, x-other, x-preview, x-picker, x-upload, x-signin, x-multiline and x-error.
     A kind is a template (stamp, submit label, receipts), never a new component. */
  const FORM_KINDS = {
    credential: { stamp: 'needs you', submit: 'Save key', busy: 'Saving to your keychain', done: (f) => f.receipt || 'Saved to your keychain' + (f.provider ? '. The ' + f.provider + ' provider is connected' : '') },
    question: { stamp: 'waiting for you', submit: 'Answer', busy: 'Sending your answer', done: (f, v) => 'Answered: ' + v },
    approval: { stamp: 'needs you', submit: 'Hold to approve', hold: true, cancel: 'Deny', busy: 'Approving', done: () => 'Approved', cancelled: 'Denied' },
    permission: { stamp: 'needs you', submit: 'Allow once', busy: 'Writing the rule', done: (f, v, raw) => (PERMISSION[raw] || [])[1] || 'Answered' },
    signin: { stamp: 'needs you', submit: null, busy: 'Waiting for your browser', done: (f) => 'Signed in' + (f.provider ? ' to ' + f.provider : '') },
    setup: { stamp: 'needs you', submit: 'Write config', busy: 'Writing the config', done: (f) => 'Wrote ' + (f.file || 'the config') },
    connector: { stamp: 'needs you', submit: 'Install', hold: true, busy: 'Installing', done: (f) => 'Installed ' + (f.name || 'the connector') },
    choice: { stamp: 'waiting for you', submit: 'Use this', busy: 'Saving', done: (f, v) => 'Chose ' + v },
    plan: { stamp: 'needs you', submit: 'Approve plan', cancel: 'Reject', busy: 'Starting the work', done: () => 'Plan approved', cancelled: 'Plan rejected' },
    feedback: { stamp: '', submit: 'Send', cancel: false, busy: 'Saving', done: () => 'Thanks. Stored for you only' },
    /* a mod's colours (MODS.md §3): not owed, so no stamp; Keep applies them, Reject leaves the theme as it is */
    theme: { stamp: '', submit: 'Keep', cancel: 'Reject', busy: 'Applying', done: (f) => f.receipt || 'Kept', cancelled: 'Rejected' }
  };
  /* permission scopes, Claude Code's order: once, this session, always (written to the project), deny */
  const PERMISSION = {
    once: ['Allow once', 'Allowed once'],
    session: ['Allow for this session', 'Allowed for this session'],
    always: ['Always allow in this project', 'Always allowed in this project'],
    deny: ['Deny', 'Denied']
  };
  const formT = (d) => FORM_KINDS[d.kind] || FORM_KINDS.question;
  const props = (d) => Object.entries((d.schema && d.schema.properties) || {});
  const isReq = (d, name) => ((d.schema && d.schema.required) || []).indexOf(name) >= 0;
  const holdForm = (d) => !!((d.submit && d.submit.hold) != null ? d.submit.hold : formT(d).hold);
  const optLabel = (p, v) => { const i = (p.enum || []).indexOf(v); return i >= 0 && p.enumNames ? p.enumNames[i] : String(v); };

  /* the mock pickers (the app's own pickers in the product): home-relative paths, models, repos, hosts, teammates, branches */
  function pickerItems(kind) {
    const D = DATA();
    if (kind === 'teammate') return (D.bots || []).map((b) => ({ value: b.id, label: b.name, desc: b.role, lead: U().html.orb(b, { size: 16 }) }));
    if (kind === 'model') {
      /* the ladder, then the other providers you have connected: each model leads with its brand mark (the model menu) */
      const ladder = ((D.governance && D.governance.ladder) || []).map((x) => ({ value: x[0], label: x[0], desc: x[1], mono: true, model: x[0] }));
      const more = [['gpt-5-codex', 'your OpenAI key'], ['gemini-2.5-pro', 'your Google account'], ['deepseek-v3.2', 'OpenRouter'], ['ollama/billing-tuned:7b', 'on this Mac']]
        .map((x) => ({ value: x[0], label: x[0].replace(/^ollama\//, ''), desc: x[1], mono: true, model: x[0] }));
      return [{ title: 'Ladder' }].concat(ladder, ['-', { title: 'Other models' }], more);
    }
    if (kind === 'folder') return ['~/code/billing-api', '~/code/marketing-site', '~/code/bethunter', '~/notes'].map((x) => ({ value: x, label: x, mono: true, icon: 'folder' }));
    if (kind === 'file') return ['~/code/billing-api/.env.example', '~/code/billing-api/package.json', '~/Downloads/invoices-sample.csv'].map((x) => ({ value: x, label: x, mono: true, icon: 'file' }));
    if (kind === 'repo') return ['acme/billing-api', 'acme/marketing-site', 'acme/bethunter'].map((x) => ({ value: x, label: x, mono: true }));
    if (kind === 'host') return ['api.openai.com', 'api.example.com', 'registry.npmjs.org'].map((x) => ({ value: x, label: x, mono: true }));
    if (kind === 'branch') return ['cents/proration', 'main', 'develop'].map((x) => ({ value: x, label: x, mono: true, icon: 'fork' }));
    return [];
  }
  const PICK_ICON = { folder: 'folder', file: 'file', branch: 'fork', repo: 'fork', host: 'at', teammate: 'bots' };
  /* the picker's lead: a teammate's orb, a model's brand mark (the picker is the one place brand colour shows), else a glyph */
  const pickLead = (kind, v, b) => b ? U().html.orb(b, { size: 16 })
    : kind === 'model' ? U().html.modelMark(v || '', { size: 16, color: 'brand', label: false, class: 'cd-glyph' })
      : U().icon(PICK_ICON[kind] || 'more', { class: 'cd-glyph' });

  function fieldHTML(c, name, p) {
    const d = c.d, id = c.id + '-f-' + name, req = isReq(d, name);
    const label = esc(p.title || cap(name)) + (req ? '' : ' <span class="cd-opt-label">(optional)</span>');
    const hint = p.description ? '<p class="ui-field__hint" id="' + id + '-h">' + fmt(p.description) + '</p>' : '';
    const err = '<p class="ui-field__hint cd-err" data-tone="attention" id="' + id + '-e" hidden></p>';
    const desc = 'aria-describedby="' + (p.description ? id + '-h ' : '') + id + '-e"';
    const wrap = (inner, cls) => '<div class="ui-field cd-field' + (cls ? ' ' + cls : '') + '" data-field="' + esc(name) + '">' + inner + '</div>';
    if (p['x-secret']) {
      return wrap('<label class="ui-field__label" for="' + id + '">' + label + '</label>' +
        '<div class="cd-secret"><input type="password" class="ui-input ui-input--mono" id="' + id + '" data-secret="' + esc(name) + '" autocomplete="off" spellcheck="false" autocapitalize="off"' +
        (p.placeholder ? ' placeholder="' + esc(p.placeholder) + '"' : '') + ' ' + desc + (req ? ' aria-required="true"' : '') + '>' +
        btn('paste', 'Paste', null, { attrs: { 'aria-label': 'Paste ' + (p.title || name) + ' from the clipboard' } }) + '</div>' + hint + err +
        '<p class="cd-saved" hidden>' + check() + '<span></span></p>', 'cd-field--secret');
    }
    if (p['x-signin']) {
      const s = p['x-signin'];
      return wrap('<div class="cd-signin">' + U().html.button({ label: 'Sign in with ' + (s.provider || 'the provider'), variant: 'primary', action: 'signin', attrs: { 'data-field': name } }) +
        '<span class="cd-note">' + esc(s.flow === 'device' ? 'Shows a code to enter on ' + (s.host || 'the provider’s site') + '.' : 'Opens ' + (s.host || s.provider) + ' in your browser.') + '</span></div>' + err, 'cd-field--signin');
    }
    if (p['x-picker']) {
      const v = c.card._vals[name] != null ? c.card._vals[name] : p.default;
      const kind = p['x-picker'], b = kind === 'teammate' && v ? bot(v) : null;
      return wrap('<span class="ui-field__label" id="' + id + '-l">' + label + '</span>' +
        '<button type="button" class="ui-input cd-picker" id="' + id + '" data-picker="' + esc(kind) + '" data-name="' + esc(name) + '" aria-haspopup="menu" aria-expanded="false" aria-labelledby="' + id + '-l ' + id + '-v" ' + desc + '>' +
        pickLead(kind, v, b) +
        '<span class="cd-picker__v' + (kind === 'teammate' ? '' : ' cd-mono') + '" id="' + id + '-v">' + esc(v ? (b ? b.name : v) : 'Choose…') + '</span>' + U().icon('chevron-down', { size: 's' }) + '</button>' + hint + err);
    }
    if (p['x-upload']) {
      return wrap('<span class="ui-field__label" id="' + id + '-l">' + label + '</span>' +
        '<div class="ui-input cd-drop" data-drop="' + esc(name) + '" role="group" aria-labelledby="' + id + '-l" ' + desc + '>' +
        btn('choose-file', 'Choose a file', null, { size: 's', attrs: { 'aria-describedby': id + '-l' } }) + '<span class="cd-drop__hint">or drop it here</span>' +
        '<input type="file" hidden tabindex="-1" aria-hidden="true"></div>' + hint + err);
    }
    if (p.enum) {
      const multi = !!p['x-multi'], prev = p['x-preview'];
      const cur = c.card._vals[name] != null ? c.card._vals[name] : (p.default != null ? p.default : (multi ? [] : null));
      const on = (v) => multi ? (cur || []).indexOf(v) >= 0 : cur === v;
      const rows = p.enum.map((v, i) => '<button type="button" class="cd-opt" role="' + (multi ? 'checkbox' : 'radio') + '" data-v="' + esc(v) + '" data-i="' + i + '" aria-checked="' + on(v) + '"' +
        (i < 9 ? ' aria-keyshortcuts="' + (i + 1) + '"' : '') + ' tabindex="' + (multi || on(v) || (cur == null && i === 0) ? '0' : '-1') + '">' +
        '<span class="cd-opt__ring" aria-hidden="true">' + (multi ? check() : '') + '</span><span class="cd-opt__text">' + fmt(optLabel(p, v)) + '</span>' +
        (i < 9 ? '<span class="cd-opt__key" aria-hidden="true">' + (i + 1) + '</span>' : '') + '</button>').join('') +
        (p['x-other'] ? '<label class="cd-free" data-other' + (typeof cur === 'string' && p.enum.indexOf(cur) < 0 && cur ? ' data-on' : '') + '><span class="cd-opt__ring" aria-hidden="true"></span><span class="ui-sr">Other: your own answer</span>' +
          '<input type="text" autocomplete="off" spellcheck="false" placeholder="Other" value="' + esc(typeof cur === 'string' && p.enum.indexOf(cur) < 0 ? cur : '') + '"></label>' : '');
      const group = '<div class="cd-opts" role="' + (multi ? 'group' : 'radiogroup') + '" id="' + id + '" aria-labelledby="' + id + '-l" ' + desc + ' data-group="' + esc(name) + '">' + rows + '</div>';
      const preview = prev ? '<div class="cd-preview" aria-live="polite" data-preview-for="' + esc(name) + '"></div>' : '';
      return wrap('<span class="ui-field__label" id="' + id + '-l">' + label + '</span>' + (prev ? '<div class="cd-pick">' + group + preview + '</div>' : group) + hint + err, prev ? 'cd-field--preview' : '');
    }
    if (p.type === 'boolean') {
      const v = c.card._vals[name] != null ? c.card._vals[name] : !!p.default;
      return wrap(U().html.setRow({ label: p.title || cap(name), hint: p.description, for: id, control: U().html.switch({ id, checked: v }) }), 'cd-field--switch');
    }
    const num = p.type === 'number' || p.type === 'integer';
    const v = c.card._vals[name] != null ? c.card._vals[name] : (p.default != null ? p.default : '');
    const type = num ? 'number' : p.format === 'email' ? 'email' : p.format === 'uri' ? 'url' : 'text';
    const common = 'class="ui-input' + (num || p['x-mono'] ? ' ui-input--mono' : '') + '" id="' + id + '" data-name="' + esc(name) + '" autocomplete="off" ' + desc + (req ? ' aria-required="true"' : '') +
      (p.placeholder ? ' placeholder="' + esc(p.placeholder) + '"' : '') + (num && p.minimum != null ? ' min="' + p.minimum + '"' : '') + (num && p.maximum != null ? ' max="' + p.maximum + '"' : '') + (num && p.type === 'integer' ? ' step="1"' : '');
    const control = p['x-multiline'] ? '<textarea ' + common + ' rows="3">' + esc(v) + '</textarea>' : '<input type="' + type + '" ' + common + ' value="' + esc(v) + '">';
    return wrap('<label class="ui-field__label" for="' + id + '">' + label + '</label>' + control + hint + err);
  }

  /* what the form shows before its fields: a config diff (setup), a plan (plan), a connector's contents and hash */
  function formExtras(d) {
    let h = '';
    if (d.diff) {
      const lines = String(d.diff).split('\n');
      h += '<div class="cd-well cd-diff" role="region" aria-label="' + esc('Changes to ' + (d.file || 'the config')) + '">' + (d.file ? '<div class="cd-diff__file">' + esc(d.file) + '</div>' : '') +
        lines.map((l) => '<div class="cd-diff__l"' + (/^\+/.test(l) ? ' data-d="add"' : /^-/.test(l) ? ' data-d="del"' : '') + '><span aria-hidden="true">' + esc(l.charAt(0) === '+' || l.charAt(0) === '-' ? l.charAt(0) : ' ') + '</span>' +
          '<span class="ui-sr">' + (/^\+/.test(l) ? 'added: ' : /^-/.test(l) ? 'removed: ' : '') + '</span>' + esc(l.replace(/^[+\- ]/, '')) + '</div>').join('') + '</div>';
    }
    if (d.swatches) h += '<div class="cd-well cd-swatches" role="group" aria-label="Colours">' + d.swatches.map((x) => '<span class="cd-swatch"><i style="background:' + esc(x[1]) + '" aria-hidden="true"></i><span>' + esc(x[0]) + '</span></span>').join('') +
      (d.preview ? '<span class="cd-live" role="status"><i aria-hidden="true"></i><span>Previewing</span></span>' : '') + '</div>';
    if (d.plan) h += '<ol class="cd-plan">' + d.plan.map((x) => '<li>' + fmt(x) + '</li>').join('') + '</ol>';
    if (d.contents) h += '<div class="cd-well cd-contents">' + d.contents.map((x) => '<div class="cd-well__line"><span class="cd-well__strong">' + esc(x[0]) + '</span><span>' + fmt(x[1] || '') + '</span></div>').join('') +
      (d.pinned ? '<div class="cd-well__line cd-pinned"><span>Pinned</span><span class="cd-mono">' + esc(d.pinned) + '</span></div>' : '') + '</div>';
    return h;
  }
  /* the answer, said back in the receipt (secrets never: they are "provided") */
  function answerText(card) {
    const d = card._d;
    for (const [name, p] of props(d)) {
      if (p['x-secret'] || p['x-signin']) continue;
      const v = card._vals[name];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (Array.isArray(v)) return v.map((x) => optLabel(p, x)).join(', ');
      if (p['x-picker'] === 'teammate' && bot(v)) return bot(v).name;
      if (p.type === 'boolean') return (p.title || name) + (v ? ' on' : ' off');
      if (p['x-upload']) return v.name;
      return p.enum ? optLabel(p, v) : String(v);
    }
    return '';
  }
  const LIVE_FORM = ['open', 'invalid', 'holding'];

  KINDS.form = {
    states: ['open', 'invalid', 'holding', 'submitting', 'done', 'deferred', 'expired', 'cancelled'],
    initial: 'open',
    quiet: { 'open>holding': 1, 'holding>open': 1, 'open>invalid': 1, 'invalid>open': 1, 'invalid>holding': 1, 'holding>invalid': 1 },
    tone: (c) => (LIVE_FORM.indexOf(c.s) >= 0 ? (formT(c.d).stamp ? 'red' : 'none') : c.s === 'submitting' ? 'pulse' : c.s === 'done' ? 'ink' : 'ring'),
    stamp: (c) => formT(c.d).stamp || 'needs you',
    resolved: (c) => ['done', 'expired', 'cancelled'].indexOf(c.s) >= 0,
    say: (c) => ({ done: 'Done: ', deferred: 'Later: ', expired: 'Expired: ', cancelled: 'Cancelled: ', submitting: '', open: 'Open: ' })[c.s] + c.plain + (c.s === 'done' && c.d.receiptText ? (/[.?!]$/.test(c.plain) ? ' ' : '. ') + c.d.receiptText : ''),
    text: (c) => sentenceText(c.d),
    receiptHTML(c) {
      const d = c.d, t = formT(d), who = c.origin ? originText(c.origin) : 'The agent';
      if (c.s === 'done') return d.receiptText || (typeof t.done === 'function' ? t.done(d, '', '') : t.done);
      if (c.s === 'deferred') return d.deferredText || 'Later. It waits in the dock';
      if (c.s === 'expired') return 'Expired, nothing was saved';
      if (c.s === 'cancelled') return d.cancelledText || ((t.cancelled || 'Cancelled') + '. ' + cap(who) + ' continues without it');
      return '';
    },
    render(c) {
      const d = c.d, t = formT(d);
      if (['done', 'deferred', 'expired', 'cancelled'].indexOf(c.s) >= 0) {
        const act = c.s === 'deferred' ? btn('reopen', 'Open', 'ghost', { size: 's' }) : c.s === 'expired' ? btn('reopen', 'Ask again', 'ghost', { size: 's' }) : '';
        return { head: '<div class="cd-collapsed"><span class="cd-mini__lead" aria-hidden="true">' + originVisual(c.origin, 16, 2, true) + '</span><p class="cd-collapsed__text" id="' + c.id + '-t">' + (c.s === 'done' ? check() : '') +
          '<span class="cd-collapsed__what">' + fmt(cap(d.title)) + '</span><span class="cd-collapsed__how">' + esc(this.receiptHTML(c)) + '</span></p>' +
          '<span class="cd-mono cd-collapsed__at">' + esc(c.at) + '</span>' + act + '</div>' };
      }
      const fields = props(d).map(([name, p]) => fieldHTML(c, name, p)).join('');
      const body = '<form class="cd-form" novalidate aria-labelledby="' + c.id + '-t">' + (d.why ? '<p class="cd-text">' + fmt(d.why) + '</p>' : '') + formExtras(d) + fields +
        (d.effect ? '<p class="cd-effect">' + fmt(d.effect) + '</p>' : '') + '</form>';
      let f;
      if (c.s === 'submitting') f = foot('<p class="cd-receipt">' + breath() + '<span>' + esc(d.busyText || t.busy || 'Saving') + '</span></p>', d.kind === 'signin' ? actions(btn('cancel', 'Cancel')) : '');
      else {
        const submitLabel = (d.submit && d.submit.label) || (d.kind === 'permission' ? (PERMISSION[c.card._vals.scope || 'once'] || PERMISSION.once)[0] : t.submit);
        const cancel = d.cancel === false || t.cancel === false ? '' : btn('cancel', (d.cancel && d.cancel.label) || t.cancel || 'Cancel', null, { keys: 'x' });
        const submit = d.kind === 'signin' ? '' : holdForm(d) ? holdHTML(c) : btn('submit', submitLabel, 'primary', { keys: 'enter' });
        f = foot(meta([d.expires ? '<span data-countdown>' + esc(cap(d.expires)) + '</span>' : '']), actions(btn('defer', 'Later', 'ghost', { keys: 'escape' }) + cancel + submit));
      }
      return { head: headrow(c, sentenceHTML(d)), body, foot: f };
    },
    mini(c) {
      const live = LIVE_FORM.indexOf(c.s) >= 0;
      return mini(c, { text: sentenceHTML(c.d), meta: live ? (c.d.expires ? '<span data-countdown="short"></span>' : esc(cap(formT(c.d).submit || 'Open'))) : esc(this.receiptHTML(c)) });
    },
    act(card, a, x) {
      if (a === 'submit') card._submitForm();
      else if (a === 'approve') card._submitForm(true);
      else if (a === 'cancel') { card._dropSecrets(); if (card._state === 'submitting' && card._d.kind === 'signin') card._setState('open'); else card._setState('cancelled'); }
      else if (a === 'defer') { card._dropSecrets(); card._setState('deferred'); }
      else if (a === 'reopen') { if (card._state === 'expired') { card._expiresAt = 0; card._armExpiry(true); } card._setState('open'); }
      else if (a === 'signin') card._signin(x && x.el);
      else if (a === 'paste') card._paste(x && x.el);
      else if (a === 'choose-file') { const f = x.el.closest('.cd-drop').querySelector('input[type=file]'); if (f) f.click(); }
      else if (a === 'remove-file') card._setFile(x.el.closest('.cd-drop').dataset.drop, null);
    }
  };

  /* the mock host behind forms: HX.forms. In the product, the plugin and the host answer these calls
     (form.opened, form.submit, secret_set, the OAuth flow); here they resolve after a short delay. */
  const FORMS_OPEN = new Map();
  const forms = {
    open(form) { if (!form.id) form.id = 'form-' + (++uid).toString(36); FORMS_OPEN.set(form.id, form); const H = hx(); if (H && H.emit) H.emit('hx:form', { type: 'opened', form }); return form.id; },
    get: (id) => FORMS_OPEN.get(id),
    list: () => Array.from(FORMS_OPEN.values()),
    resolve(id, status) { FORMS_OPEN.delete(id); const H = hx(); if (H && H.emit) H.emit('hx:form', { type: 'resolved', form_id: id, status }); },
    /* secrets go from the field to the host's store and never into events, the transcript or the ledger */
    secretSet(ref, value) { value = null; return Promise.resolve({ saved: true, ref }); },
    submit(form, payload) { return new Promise((res) => setTimeout(() => res({ ok: true }), reduced() ? 50 : 700)); },
    signin(provider) { return new Promise((res) => setTimeout(() => res({ ok: true }), reduced() ? 50 : 1600)); }
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
      if (this._kind === 'approval' || this._kind === 'form') { this._tick(); this._timer = this._timer || setInterval(() => this._tick(), 1000); }
      if (this._state === 'holding' && typeof this._d.progress === 'number') requestAnimationFrame(() => { const h = this._holdBtn(); if (h && h._hold) h._hold.show(this._d.progress); });
      primeOrbs(this);
      if (fitRO) fitRO.observe(this);
      emitAttention();
    }
    disconnectedCallback() {
      LIVE.delete(this);
      if (fitRO) { fitRO.unobserve(this); this._fitW = 0; }
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
      this._vals = {}; this._sec = {};
      if (kind === 'form') { if (!d.id) d.id = 'form-' + nid(); if (!FORMS_OPEN.has(d.id)) forms.open(d); }
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
      if (kind === 'approval' || kind === 'form') this._armExpiry(false);
      this.addEventListener('click', (e) => this._onClick(e));
      this.addEventListener('keydown', (e) => this._onKey(e));
      this._render(false);
      if (opts.enter) animate(this, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { preset: 'settle' });
    }

    _ctx() {
      const K = this._K;
      const c = { d: this._d, s: this._state, size: this._size, id: this._id, at: clock(this._at), q: this._opts.queue, card: this };
      c.origin = originOf(this._d) || (K.origin ? K.origin(c) : null);
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
        if ((this._kind === 'approval' && (next === 'pending' || next === 'holding')) || (this._kind === 'form' && next === 'open')) {
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
      if (!this._syncing && this._d.id && !quiet) syncSiblings(this, next);
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
      if (changed && this.isConnected) { primeOrbs(this); fitCard(this); }
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
      /* the origin's accent: one teammate's colour as a ring and a tint (data, not a literal) */
      const acc = accentOf(c.origin);
      if (acc) { this.style.setProperty('--cd-accent', acc); this.dataset.accent = ''; }
      else { this.style.removeProperty('--cd-accent'); delete this.dataset.accent; }
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
        const t = (this._kind === 'form' ? live('.cd-form .ui-input, .cd-form .cd-opt[tabindex="0"], .cd-form .ui-switch, .cd-form [data-action="signin"]') : null) ||
          live('[data-hold]') || live('.cd-blank') || live('.cd-mini') || live('.ui-btn--primary') || live('.cd-foot button, .cd-rule button');
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
        hold.addEventListener('ui:commit', (e) => {
          if (this._kind === 'form') { if (!this._submitForm(true)) e.preventDefault(); return; }
          if (!this._act('approve')) e.preventDefault();
        });
        /* holding is a card state too: follow the button's data-state */
        new MutationObserver(() => {
          const st = hold.dataset.state;
          if (st === 'holding' && (this._state === 'pending' || this._state === 'open' || this._state === 'invalid')) this._setState('holding');
          else if (st === 'idle' && this._state === 'holding') this._setState(this._kind === 'form' ? 'open' : 'pending');
        }).observe(hold, { attributes: true, attributeFilter: ['data-state'] });
      }
      if (hold && this._state === 'holding' && typeof this._d.progress === 'number' && this.isConnected) hold._hold.show(this._d.progress);
      if (this._kind === 'blank' && (this._size === 'popover' || this._size === 'compact')) wireOptions(this);
      if (this._kind === 'form') wireForm(this);
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
      const m = /expires in (\d+(?:\.\d+)?)\s*(min|s)/i.exec(parts(d.meta).concat(parts(d.expires)).join(' '));
      if (m) this._expiresAt = Date.now() + (+m[1]) * (m[2] === 'min' ? 60000 : 1000);
    }

    _tick() {
      if ((this._kind !== 'approval' && this._kind !== 'form') || !this._expiresAt) return;
      const live = this._kind === 'form' ? LIVE_FORM.indexOf(this._state) >= 0 : this._state === 'pending' || this._state === 'holding';
      if (!live) return;
      const left = this._expiresAt - Date.now();
      for (const s of this.querySelectorAll('[data-countdown]')) {
        const t = expiryText(left, s.dataset.countdown === 'short');
        if (s.textContent !== t) s.textContent = t;
      }
      if (left <= 0 && this.isConnected) { const h = this._holdBtn(); if (h && h._hold) h._hold.reset(); if (this._kind === 'form') this._dropSecrets(); this._setState('expired'); }
    }

    _onClick(e) {
      const b = e.target.closest('[data-action]');
      if (!b || b.closest('hx-card') !== this || b.disabled) return;
      let value;
      if (b.dataset.action === 'answer') value = blankValue(this);
      if (this._kind === 'form' && b.dataset.action === 'submit') { this._submitForm(false); return; }
      if (this._kind === 'form' && ['paste', 'choose-file', 'remove-file', 'signin'].indexOf(b.dataset.action) >= 0) { this._K.act(this, b.dataset.action, { el: b }); return; }
      this._act(b.dataset.action, { value, el: b });
    }

    /* KEYMAP §6: x denies while focus is in an approval; d opens the diff from a ship card (never while typing) */
    _onKey(e) {
      if (e.defaultPrevented) return;
      if (this._kind === 'form' && this._size !== 'mini' && LIVE_FORM.indexOf(this._state) >= 0 && this._formKey(e)) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
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

    /* KEYMAP §6, forms: Esc defers; Enter submits (from a field or an option; a hold form asks for the hold);
       mod+Enter submits from long text; x cancels and 1-9 pick an option when focus is not in a text field */
    _formKey(e) {
      const t = e.target, d = this._d;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.type !== 'checkbox';
      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); this._act('defer'); return true; }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        const mod = e.ctrlKey || e.metaKey;
        if (t.tagName === 'TEXTAREA' && !mod) return false;
        if (!mod && t.tagName === 'BUTTON' && !t.classList.contains('cd-opt')) return false;
        if (t.closest && t.closest('.cd-foot, .ui-hold')) return false;
        e.preventDefault(); this._submitForm(false); return true;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing) return false;
      if (e.code === 'KeyX' && d.cancel !== false && formT(d).cancel !== false) { e.preventDefault(); this._dropSecrets(); this._act('cancel'); return true; }
      const n = /^Digit([1-9])$/.exec(e.code);
      if (n) {
        const group = (t.closest && t.closest('.cd-opts')) || this.querySelector('.cd-form .cd-opts');
        const row = group && group.querySelectorAll('.cd-opt')[+n[1] - 1];
        if (row) { e.preventDefault(); row.click(); row.focus(); return true; }
      }
      return false;
    }

    _field(name) { return Array.from(this.querySelectorAll('.cd-field')).find((f) => f.dataset.field === name && !f.closest('.cd-ghost')); }

    _validate() {
      const d = this._d, errs = [];
      for (const [name, p] of props(d)) {
        const req = isReq(d, name), title = p.title || cap(name);
        let v = p['x-secret'] ? this._sec[name] : this._vals[name], msg = '';
        const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
        if (p['x-signin']) { if (req && !(v && v.signedIn)) msg = 'Sign in to ' + (p['x-signin'].provider || 'continue') + ' first'; }
        else if (empty) { if (req) msg = p.enum || p['x-picker'] ? 'Choose ' + title.toLowerCase() : p['x-upload'] ? 'Add a file' : 'Enter ' + title.toLowerCase(); }
        else if (p.type === 'number' || p.type === 'integer') {
          const num = Number(v);
          if (!isFinite(num) || String(v).trim() === '') msg = 'Enter a number';
          else if (p.type === 'integer' && !Number.isInteger(num)) msg = 'Use a whole number';
          else if ((p.minimum != null && num < p.minimum) || (p.maximum != null && num > p.maximum)) msg = 'Use a number from ' + (p.minimum != null ? p.minimum : '−∞') + ' to ' + (p.maximum != null ? p.maximum : '∞');
        } else if (typeof v === 'string') {
          const sv = v.trim();
          if (p.minLength && sv.length < p.minLength) msg = p['x-error'] || title + ' is too short: it needs at least ' + p.minLength + ' characters';
          else if (p.maxLength && sv.length > p.maxLength) msg = title + ' is too long: keep it under ' + p.maxLength + ' characters';
          else if (p.pattern && !new RegExp(p.pattern).test(sv)) msg = p['x-error'] || 'That doesn’t look like ' + title.toLowerCase();
          else if (p.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sv)) msg = 'Enter an email address, like name@example.com';
          else if (p.format === 'uri' && !/^https?:\/\/\S+$/.test(sv)) msg = 'Enter a full address, starting with https://';
        }
        if (msg) errs.push({ name, title, msg });
      }
      return errs;
    }

    /* paint errors in place (no focus move): used while the user fixes fields */
    _paintErrors(errs) {
      for (const f of this.querySelectorAll('.cd-field')) {
        if (f.closest('.cd-ghost')) continue;
        const e = errs.find((x) => x.name === f.dataset.field), out = f.querySelector('.cd-err');
        const ctl = f.querySelector('.ui-input, .cd-opts, .ui-switch, [data-action="signin"]');
        if (out) { out.textContent = e ? e.msg : ''; out.hidden = !e; }
        if (ctl) { if (e) ctl.setAttribute('aria-invalid', 'true'); else ctl.removeAttribute('aria-invalid'); }
      }
      if (errs.length && this._state !== 'invalid' && LIVE_FORM.indexOf(this._state) >= 0) this._setState('invalid');
      else if (!errs.length && this._state === 'invalid') this._setState('open');
    }

    /* show errors on submit: paint them, say the first one, and move focus to it */
    _showErrors(errs) {
      this._paintErrors(errs);
      if (errs.length) {
        this._announce((errs.length === 1 ? 'Check ' + errs[0].title + ': ' : 'Check ' + errs.length + ' fields. ' + errs[0].title + ': ') + errs[0].msg);
        const f = this._field(errs[0].name), ctl = f && f.querySelector('.ui-input, .cd-opt[tabindex="0"], .cd-opt, .ui-switch, [data-action="signin"], .cd-drop .ui-btn');
        if (ctl) ctl.focus({ preventScroll: false });
      }
    }

    _dropSecrets() {
      for (const k in this._sec) this._sec[k] = null;
      this._sec = {};
      for (const i of this.querySelectorAll('input[data-secret]')) i.value = '';
    }

    /* submit: validate, hand secrets to the host (never to the agent), send the rest, then collapse to a receipt */
    _submitForm(viaHold) {
      const d = this._d;
      if (LIVE_FORM.indexOf(this._state) < 0) return false;
      const errs = this._validate();
      this._showErrors(errs);
      if (errs.length) { const h = this._holdBtn(); if (h && h._hold) h._hold.reset(); return false; }
      if (holdForm(d) && !viaHold) {
        const h = this._holdBtn(); if (h) h.focus();
        this._announce('Hold the space bar, or press enter twice, to ' + String((d.submit && d.submit.label) || formT(d).submit).toLowerCase());
        return false;
      }
      const values = {}, secrets = {}, pending = [];
      for (const [name, p] of props(d)) {
        if (p['x-secret']) {
          /* the key is stored in the keychain and read through Hermes's secret source: no environment variable */
          const ref = 'secret://' + (d.scope || 'local') + '/' + (p['x-ref'] || name);
          pending.push(forms.secretSet(ref, this._sec[name]));
          secrets[name] = { saved: true, ref };
        } else if (this._vals[name] !== undefined) values[name] = this._vals[name];
      }
      this._dropSecrets();
      const payload = { form_id: d.id, kind: d.kind, values, secrets };
      const ok = this.dispatchEvent(new CustomEvent('hx:card-action', { bubbles: true, composed: true, cancelable: true, detail: { kind: 'form', action: 'submit', value: payload, data: d, state: this._state, card: this } }));
      if (!ok) return false;
      const raw = d.kind === 'permission' ? (this._vals.scope || 'once') : '';
      const t = formT(d), ans = answerText(this);
      d.receiptText = typeof t.done === 'function' ? t.done(d, ans, raw) : t.done;
      this._setState('submitting');
      Promise.all(pending).then(() => forms.submit(d, payload)).then(() => {
        if (this._state !== 'submitting') return;
        this._setState('done');
        forms.resolve(d.id, 'submitted');
      });
      return true;
    }

    _signin(el) {
      const d = this._d, name = el && el.dataset.field;
      const p = name && d.schema.properties[name], provider = p && p['x-signin'] && p['x-signin'].provider;
      d.busyText = 'Waiting for ' + ((p && p['x-signin'].host) || provider || 'the provider') + ' in your browser';
      this._setState('submitting');
      forms.signin(provider).then(() => {
        if (this._state !== 'submitting') return;
        if (name) this._vals[name] = { signedIn: true };
        const t = formT(d);
        d.receiptText = typeof t.done === 'function' ? t.done(d, '', '') : t.done;
        this._setState('done');
        forms.resolve(d.id, 'submitted');
      });
    }

    _paste(el) {
      const input = el && el.closest('.cd-secret') && el.closest('.cd-secret').querySelector('input[data-secret]');
      if (!input) return;
      const done = (t) => { input.value = String(t || '').trim(); this._sec[input.dataset.secret] = input.value; input.dispatchEvent(new Event('input')); input.focus(); };
      const ask = () => { input.focus(); this._announce('Press ' + (/Mac/.test(navigator.platform) ? 'command V' : 'control V') + ' to paste'); };
      try { if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(done, ask); else ask(); } catch (_) { ask(); }
    }

    _setFile(name, file) {
      this._vals[name] = file ? { name: file.name, size: file.size } : undefined;
      const f = this._field(name), drop = f && f.querySelector('.cd-drop');
      if (!drop) return;
      const input = drop.querySelector('input[type=file]');
      drop.innerHTML = '';
      if (file) {
        const kb = file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : (file.size / 1048576).toFixed(1) + ' MB';
        drop.insertAdjacentHTML('beforeend', '<span class="cd-filechip">' + U().icon('file', { class: 'cd-glyph' }) + '<span class="cd-filechip__name">' + esc(file.name) + '</span><span class="cd-mono">' + kb + '</span></span>' +
          U().html.button({ label: 'Remove', variant: 'ghost', size: 's', action: 'remove-file', attrs: { 'aria-label': 'Remove ' + file.name } }));
        this._announce('Added ' + file.name);
      } else {
        drop.insertAdjacentHTML('beforeend', U().html.button({ label: 'Choose a file', size: 's', action: 'choose-file' }) + '<span class="cd-drop__hint">or drop it here</span>');
      }
      if (input) drop.appendChild(input);
      if (this._state === 'invalid') this._paintErrors(this._validate());
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

  /* orb2 draws only the orbs on screen, so an orb sized while off screen (low in a long thread, or in a full-page
     capture) stays blank until it scrolls in. Prime each live orb with one still frame, through orb2's public
     static attribute set and cleared at once: it draws now, and animates as usual when it becomes visible.
     Orbs already static (16px and under) draw themselves. */
  function primeOrbs(root) {
    const go = () => {
      for (const o of (root || document).querySelectorAll('orb-avatar')) {
        if (o._cdPrimed || o.hasAttribute('static') || !o.isConnected || !o.clientWidth) continue;
        o._cdPrimed = true;
        o.setAttribute('static', '');
        o.removeAttribute('static');
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 400);
  }

  /* ---------------------------------------------------------------- long names: measured, never overflowing
     A name never makes a card wider or pushes a column. In a one-row card the who takes at most half the line, or
     whatever the request leaves; several names take the longest form that still leaves the asker about five em
     ("kai, iris and nina", then "kai and 2 others"; "chief of staff… and kai" when the asker is the long one); a relay
     gives way before the asker. Whatever is cut is whole on hover and focus (the row, or the byline, which becomes
     focusable only then) and always whole in the accessible name. Refitted when a card's width or the theme changes. */
  const FIT_MIN_EM = 5;
  const others = (k) => ' and ' + k + ' other' + (k > 1 ? 's' : '');
  const cut = (el) => !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  function fitNames(unit) {
    let names = null;
    try { names = JSON.parse(unit.dataset.names); } catch (e) { return false; }
    const first = unit.querySelector('.cd-names__first'), rest = unit.querySelector('.cd-names__rest');
    if (!names || !first || !rest) return false;
    /* the last form is the asker alone: the stacked orbs beside it still count everyone, and the full names are on
       hover, on focus and in the accessible name (a "+N" here would contradict the stack's own +N) */
    const n = names.length, forms = (n <= 3 ? [restOf(names)] : []).concat([others(n - 1), '']);
    /* the asker's floor is set (fitCard), so a form fits when what follows it is not cut */
    let i = 0;
    for (; i < forms.length; i++) { rest.textContent = forms[i]; if (!cut(rest)) break; }
    if (i === forms.length) rest.textContent = forms[--i];
    return i > 0;
  }
  function fitCard(card) {
    if (!card.isConnected || !card.clientWidth) return;
    for (const text of card.querySelectorAll('.cd-mini__text')) {
      const who = text.querySelector('.cd-mini__who'), what = text.querySelector('.cd-mini__what');
      if (!who || !what || !text.clientWidth) continue;
      const fs = parseFloat(getComputedStyle(text).fontSize) || 13, avail = text.clientWidth;
      const room = Math.max(avail * 0.5, avail - what.getBoundingClientRect().width - fs * 0.3);
      who.style.setProperty('--cd-who-max', Math.floor(room) + 'px');
    }
    for (const unit of card.querySelectorAll('.cd-names')) {
      /* floors from each part's own width and the room there is: the asker keeps up to five em (at least 60% of a
         relayed line), the relay up to six of what is left, so a short name never leaves a gap and the two always fit */
      const em = parseFloat(getComputedStyle(unit).fontSize) || 12;
      const first = unit.querySelector('.cd-names__first'), via = unit.querySelector('.cd-names__via'), rest = unit.querySelector('.cd-names__rest');
      if (first) first.style.minWidth = '';
      if (via) via.style.minWidth = '';
      if (rest && unit.dataset.names) { try { rest.textContent = restOf(JSON.parse(unit.dataset.names)); } catch (e) { /* keep */ } }
      const room = unit.clientWidth;
      const ff = first ? Math.min(first.scrollWidth, em * FIT_MIN_EM, room * (via ? 0.6 : 1)) : 0;
      if (first) first.style.minWidth = ff + 'px';
      if (via) via.style.minWidth = Math.max(0, Math.min(via.scrollWidth, em * 6, room - ff - (rest ? rest.scrollWidth : 0))) + 'px';
      const shorter = unit.dataset.names ? fitNames(unit) : false;
      const host = unit.closest('.cd-mini') || unit.closest('.cd-by__label');
      if (!host) continue;
      const clipped = shorter || [...unit.querySelectorAll('.cd-names__first, .cd-names__rest, .cd-names__via')].some(cut);
      if (clipped) { host.setAttribute('data-tip', unit.dataset.full); if (host.tagName !== 'BUTTON') host.tabIndex = 0; }
      else { host.removeAttribute('data-tip'); if (host.tagName !== 'BUTTON') host.removeAttribute('tabindex'); }
    }
  }
  const fitRO = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    for (const e of entries) { const w = Math.round(e.contentRect.width); if (e.target._fitW !== w) { e.target._fitW = w; fitCard(e.target); } }
  }) : null;
  const refitAll = () => requestAnimationFrame(() => { for (const c of LIVE) fitCard(c); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitAll);
  addEventListener('hx:theme', refitAll);
  { const H = hx(); if (H && H.on) H.on('hx:theme', refitAll); }

  /* one id, one answer: every card with the same kind and id (the conversation, the dock, the Bots section, team
     chat) takes the state the user gave in any one of them, with the same receipt. Values of secret fields are never
     copied: only the receipt and the non-secret answer travel. */
  const SHARED = ['answer', 'answered', 'decidedAt', 'receipt', 'progressNote'];
  function syncSiblings(src, state) {
    for (const c of LIVE) {
      if (c === src || c._kind !== src._kind || !c._d || c._d.id !== src._d.id || c._state === state) continue;
      if ((state === 'holding' || state === 'pending') && (src._K.quiet || {})[(c._state) + '>' + state]) continue;
      if (state === 'holding') continue;
      c._syncing = true;
      for (const k of SHARED) if (src._d[k] !== undefined) c._d[k] = src._d[k];
      if (src._vals) c._vals = Object.assign({}, src._vals);
      c._at = src._at;
      try { c._setState(state); } finally { c._syncing = false; }
    }
  }


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
  /* a form's fields: values live in card._vals (secrets in card._sec until they are handed to the host) */
  function wireForm(card) {
    const form = Array.from(card.querySelectorAll('.cd-form')).find((f) => !f.closest('.cd-ghost'));
    if (!form || form._wired) return;
    form._wired = true;
    const d = card._d;
    form.addEventListener('submit', (e) => { e.preventDefault(); card._submitForm(false); });
    const clearErr = () => { if (card._state === 'invalid') card._paintErrors(card._validate()); };
    for (const i of form.querySelectorAll('input[data-name], textarea[data-name]')) {
      i.addEventListener('input', () => { card._vals[i.dataset.name] = i.value; if (i.getAttribute('aria-invalid')) clearErr(i.dataset.name); });
    }
    for (const i of form.querySelectorAll('input[data-secret]')) {
      i.addEventListener('input', () => { card._sec[i.dataset.secret] = i.value; if (i.getAttribute('aria-invalid')) clearErr(i.dataset.secret); });
      /* paste-friendly: trim what was pasted and check it at once */
      i.addEventListener('paste', () => setTimeout(() => { i.value = i.value.trim(); card._sec[i.dataset.secret] = i.value; const e = card._validate().filter((x) => x.name === i.dataset.secret); if (e.length) card._showErrors(e); else clearErr(); }, 0));
    }
    for (const sw of form.querySelectorAll('.cd-field--switch input[role="switch"]')) {
      const name = sw.closest('.cd-field').dataset.field;
      card._vals[name] = sw.checked;
      sw.addEventListener('change', () => { card._vals[name] = sw.checked; });
    }
    for (const g of form.querySelectorAll('.cd-opts[data-group]')) {
      const name = g.dataset.group, p = d.schema.properties[name], multi = !!p['x-multi'];
      const rows = Array.from(g.querySelectorAll('.cd-opt'));
      const other = g.querySelector('[data-other] input'), otherRow = g.querySelector('[data-other]');
      const pv = form.querySelector('.cd-preview[data-preview-for="' + name + '"]');
      const showPreview = (v) => {
        if (!pv) return;
        const i = p.enum.indexOf(v), x = i >= 0 && p['x-preview'] ? p['x-preview'][i] : null;
        pv.innerHTML = x ? (x.code != null ? '<pre class="cd-out">' + esc(x.code) + '</pre>' : '<p class="cd-text">' + fmt(x.text || '') + '</p>') + (x.note ? '<p class="cd-note">' + fmt(x.note) + '</p>' : '') : '<p class="cd-note">' + (v ? 'No preview for this answer.' : 'Pick an answer to preview it.') + '</p>';
      };
      const sync = () => {
        const v = card._vals[name];
        rows.forEach((r) => { const on = multi ? (v || []).indexOf(r.dataset.v) >= 0 : v === r.dataset.v; r.setAttribute('aria-checked', String(on)); if (!multi) r.tabIndex = on ? 0 : -1; });
        if (!multi && !rows.some((r) => r.tabIndex === 0)) rows[0].tabIndex = 0;
        if (otherRow) otherRow.toggleAttribute('data-on', !multi && typeof v === 'string' && v !== '' && p.enum.indexOf(v) < 0);
        if (d.kind === 'permission' && name === 'scope') {
          const lbl = card.querySelector('.cd-foot [data-action="submit"] span');
          if (lbl) lbl.textContent = (PERMISSION[v] || PERMISSION.once)[0];
        }
      };
      rows.forEach((r) => {
        r.addEventListener('click', () => {
          const v = r.dataset.v;
          if (multi) { const cur = (card._vals[name] || []).slice(), k = cur.indexOf(v); if (k >= 0) cur.splice(k, 1); else cur.push(v); card._vals[name] = cur; }
          else { card._vals[name] = v; if (other) other.value = ''; }
          sync(); showPreview(multi ? null : v);
          if (r.getAttribute('aria-checked') === 'true') animate(r.querySelector('.cd-opt__ring'), [{ transform: 'scale(.5)' }, { transform: 'scale(1)' }], { preset: 'quick' });
          clearErr(name);
        });
        r.addEventListener('focus', () => showPreview(multi ? null : r.dataset.v));
      });
      g.addEventListener('keydown', (e) => {
        const i = rows.indexOf(document.activeElement);
        if (i < 0) return;
        const dlt = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!dlt) return;
        e.preventDefault();
        if (dlt > 0 && i === rows.length - 1 && other) { other.focus(); return; }
        const nx = rows[(i + dlt + rows.length) % rows.length];
        if (!multi) nx.click();
        nx.focus();
      });
      if (other) {
        other.addEventListener('input', () => { card._vals[name] = other.value.trim() ? other.value : (p.enum.indexOf(card._vals[name]) >= 0 ? card._vals[name] : null); sync(); clearErr(name); });
        other.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); rows[rows.length - 1].focus(); } });
      }
      if (card._vals[name] === undefined && p.default != null) card._vals[name] = p.default;
      sync(); showPreview(multi ? null : card._vals[name]);
    }
    for (const pk of form.querySelectorAll('.cd-picker')) {
      const name = pk.dataset.name, kind = pk.dataset.picker, p = d.schema.properties[name];
      if (card._vals[name] === undefined && p.default != null) card._vals[name] = p.default;
      pk.addEventListener('click', () => {
        const items = pickerItems(kind).map((x) => (x && x.value != null ? Object.assign({}, x, { checked: card._vals[name] === x.value }) : x));
        U().menu.open(pk, items, { label: p.title || cap(name), onSelect: (v) => {
          card._vals[name] = v;
          const b = kind === 'teammate' ? bot(v) : null;
          pk.querySelector('.cd-picker__v').textContent = b ? b.name : v;
          const lead = pk.firstElementChild;
          if (lead && (b || kind === 'model')) lead.outerHTML = pickLead(kind, v, b);
          clearErr(name);
        } });
      });
    }
    for (const drop of form.querySelectorAll('.cd-drop')) {
      const name = drop.dataset.drop;
      drop.addEventListener('change', (e) => { if (e.target.type === 'file' && e.target.files[0]) card._setFile(name, e.target.files[0]); });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.dataset.over = ''; });
      drop.addEventListener('dragleave', () => { delete drop.dataset.over; });
      drop.addEventListener('drop', (e) => { e.preventDefault(); delete drop.dataset.over; const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) card._setFile(name, f); });
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
    forms,
    primeOrbs,
    version: '6.2.0'
  };
  window.HX.cards = api;
  window.HX.forms = forms;
  /* if the shell replaces window.HX after this file ran, hand the API over */
  document.addEventListener('DOMContentLoaded', () => { if (window.HX && !window.HX.cards) window.HX.cards = api; });
})();
