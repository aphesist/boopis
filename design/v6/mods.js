/* boopis v6 · mods (proposal for the owner's review; MODS.md §3)
   A stand-in for the mod host: it holds what a mod draws and puts each surface where MODS.md §3 says it lands.
   Nothing here runs a real mod. The mods below are SAMPLES with SAMPLE DATA, written to look like real ones; every
   tree goes through HX.ui.modView (components/mod-view.js), so a mod's elements are drawn by the library.

   Surfaces (all through HX.mods):
     openPane / closePane   a pane: a tab in the details panel (wide windows) or inline above the composer (narrow)
     band                   one collapsible row per mod above the composer
     status                 the line under the composer, prefixed with the mod's name; the composer rises 22px when the first one
                            appears and settles back when the last one clears (a FLIP on transform, never a layout animation)
     place                  a row in the conversation, from the mod (its glyph and name in the call-number margin)
     toast                  the app's notice, attributed to the mod; one at a time, queued in order, with a "+N" count while others wait
     ask                    a `choice` form with origin {kind: 'mod', plugin}, in the conversation and in the dock's queue
     proposeTheme           "Apply <mod>'s colours?" with Keep and Reject, a card of the card layer. While it is open the whole app
                            previews the colours (theme.js preview); Keep commits them; Reject, Esc, closing the card or leaving
                            its screen restores the previous theme at once
   The default mock is unchanged; ?mods=1 turns this on (see demo()).

   Hooks it needs in the other files: session.js (slots, placeRow, refreshRight, decoratePanel), cards.js (the `mod` origin,
   the `theme` form kind, a swatch strip), index.html (the three tags). Nothing in dock.js: the dock's queue gets the
   form through the DOM here, because dock.js is off limits (the dock's own count does not include it). */
(function () {
  'use strict';
  const HX = window.HX;
  if (!HX || !HX.ui || !HX.ui.modView) return;
  const ui = HX.ui, mv = ui.modView, h = mv.h, esc = ui.esc;
  const query = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); } })();
  const DOCK_MQ = window.matchMedia('(min-width: 1200px)');     /* the width at which the details panel pushes the work instead of overlaying it */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const now = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  if (ui.squircle) ui.squircle.auto('.mod-band, .mod-inline, .mod-tab, .mv-code, .mod-swatches');

  /* ───────────── the host ───────────── */
  const S = { panes: [], rows: [], status: new Map(), active: 'details', slots: null, scroll: {}, previewing: null, placement: query.get('placement') || 'auto' };
  const HANDLERS = new Map();
  const bind = (plugin, name, fn) => { const id = plugin + ':' + name; HANDLERS.set(id, fn); return id; };
  const dispatcher = (plugin) => (ev) => { const fn = HANDLERS.get(ev.id); if (fn) fn(ev.value, ev); };
  const docked = (p) => (S.placement === 'dock' ? true : S.placement === 'inline' ? false : DOCK_MQ.matches);
  const paneById = (id) => S.panes.find((p) => p.id === id);

  /* a pane: {id, plugin, title, render(): tree}. `placement` is decided by the window, as MODS.md §3 says */
  function openPane(p) {
    let q = paneById(p.id);
    if (!q) { q = Object.assign({ open: true }, p); S.panes.push(q); } else Object.assign(q, p);
    if (docked(q)) {
      S.active = q.id;
      if (HX.state.right !== 'open') HX.setState({ right: 'open' });
      HX.session && HX.session.refreshRight && HX.session.refreshRight();
    } else {
      for (const o of S.panes) if (!docked(o)) o.collapsed = o !== q;     /* inline panes fold into one open at a time, so the composer keeps the screen */
      drawBand();
    }
    return q;
  }
  function closePane(id) {
    S.panes = S.panes.filter((p) => p.id !== id);
    if (S.active === id) S.active = 'details';
    drawBand();
    HX.session && HX.session.refreshRight && HX.session.refreshRight();
  }
  /* a mod asked to redraw: the same tree, redrawn where it is shown, keeping focus */
  function invalidate(plugin) {
    for (const p of S.panes) if (!plugin || p.plugin === plugin) for (const r of [p.root, p.iroot]) if (r && r.isConnected) mv.update(r, p.render());
    for (const r of S.rows) if (!plugin || r.plugin === plugin) if (r.root && r.root.isConnected) mv.update(r.root, r.render(!r.open));
    drawStatus();
  }

  /* ───────────── pane: a tab in the details panel ───────────── */
  function paneBody(p, inline) {
    const wrap = el('div', inline ? 'mod-inline__body' : 'mod-pane__body');
    const root = mv(p.render(), { surface: inline ? 'inset' : 'frame', dispatch: dispatcher(p.plugin), label: p.title, onInvalid: (r) => console.warn('[mods] ' + p.plugin + ': pane skipped, ' + r) });
    if (!root) { wrap.append(el('p', 'mod-note', 'This pane can’t be drawn. ' + p.plugin + ' sent a tree the renderer refused.')); return wrap; }
    if (inline) p.iroot = root; else p.root = root;
    wrap.append(root);
    return wrap;
  }
  function paneHead(p, inline) {
    const head = el('div', inline ? 'mod-inline__head' : 'mod-pane__head');
    head.insertAdjacentHTML('beforeend', ui.html.mod(p.plugin));
    const close = ui.iconButton({ icon: 'close', label: 'Close ' + p.title, size: 's' });
    close.addEventListener('click', () => closePane(p.id));
    if (inline) {
      const t = el('span', 'mod-inline__title', p.title);
      const tog = ui.iconButton({ icon: 'chevron', label: (p.collapsed ? 'Expand ' : 'Collapse ') + p.title, size: 's', expanded: !p.collapsed, tip: false });
      tog.classList.add('mod-chev');
      tog.addEventListener('click', () => { p.collapsed = !p.collapsed; drawBand(); });
      head.append(t, tog, close);
    } else head.append(close);
    return head;
  }
  function tabs(list) {
    const bar = el('div', 'mod-tabs'); bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Session details and mod panes');
    const mk = (id, labelHTML, name, aria) => {
      const b = el('button', 'mod-tab'); b.type = 'button'; b.id = 'mod-tab-' + id; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(S.active === id)); b.tabIndex = S.active === id ? 0 : -1; if (aria) b.setAttribute('aria-label', aria);
      b.innerHTML = labelHTML; b.dataset.id = id; if (name) b.setAttribute('data-tip', name);
      return b;
    };
    bar.append(mk('details', '<span>Details</span>', null, 'Session details'));
    for (const p of list) bar.append(mk(p.id, ui.html.mod(p.title), p.plugin + ' mod', p.title + ', ' + p.plugin + ' mod'));
    const go = (id, focus) => { S.active = id; HX.session.refreshRight(); if (focus) requestAnimationFrame(() => { const t = document.getElementById('mod-tab-' + id); if (t) t.focus(); }); };
    bar.addEventListener('click', (e) => { const b = e.target.closest('.mod-tab'); if (b) go(b.dataset.id, false); });
    bar.addEventListener('keydown', (e) => {
      const ids = ['details'].concat(list.map((p) => p.id)), i = ids.indexOf(S.active);
      const j = e.key === 'ArrowRight' ? (i + 1) % ids.length : e.key === 'ArrowLeft' ? (i - 1 + ids.length) % ids.length : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : -1;
      if (j >= 0) { e.preventDefault(); go(ids[j], true); }
    });
    return bar;
  }
  /* called by session.js on every redraw of the details panel; null leaves the panel as it was */
  function decoratePanel(pnl) {
    const list = S.panes.filter(docked);
    if (!list.length) return null;
    if (S.active !== 'details' && !list.some((p) => p.id === S.active)) S.active = 'details';
    const head = pnl.querySelector('.ui-panel__head'), body = pnl.querySelector('.ui-panel__body');
    const bar = tabs(list);
    head.classList.add('mod-head'); head.replaceChildren(bar);
    /* the strip scrolls when the tabs do not fit: the open tab is kept in view and the cut edge fades */
    const more = () => { bar.toggleAttribute('data-more', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2); };
    bar.addEventListener('scroll', more, { passive: true });
    requestAnimationFrame(() => { const t = bar.querySelector('[aria-selected="true"]'); if (t) { const l = t.offsetLeft - bar.offsetLeft; if (l + t.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = l + t.offsetWidth - bar.clientWidth + 12; } more(); });
    body.setAttribute('role', 'tabpanel'); body.setAttribute('aria-labelledby', 'mod-tab-' + S.active);
    body.addEventListener('scroll', () => { S.scroll[S.active] = body.scrollTop; }, { passive: true });
    if (S.active !== 'details') {
      const p = paneById(S.active);
      pnl.setAttribute('aria-label', p.title + ', ' + p.plugin + ' mod');
      const pane = el('div', 'mod-pane');
      pane.append(paneHead(p, false), paneBody(p, false));
      body.replaceChildren(pane);
    }
    requestAnimationFrame(() => { body.scrollTop = S.scroll[S.active] || 0; });
    return pnl;
  }

  /* ───────────── the band above the composer, and inline panes on narrow windows ───────────── */
  /* a row: {plugin, render(collapsed): tree}. One collapsible row per mod. */
  function setBand(r) {
    let q = S.rows.find((x) => x.plugin === r.plugin);
    if (!q) { q = Object.assign({ open: false }, r); S.rows.push(q); } else Object.assign(q, r);
    drawBand();
  }
  function rowEl(r) {
    const row = el('div', 'mod-row'); row.dataset.open = String(r.open);
    const who = el('span', 'mod-row__who'); who.innerHTML = ui.html.mod(r.plugin);
    who.setAttribute('data-tip', r.plugin + ' mod');
    const body = el('div', 'mod-row__body');
    r.root = mv(r.render(!r.open), { surface: 'inset', dispatch: dispatcher(r.plugin), onInvalid: (x) => console.warn('[mods] ' + r.plugin + ': band skipped, ' + x) });
    if (r.root) body.append(r.root);
    const tog = ui.iconButton({ icon: 'chevron', label: (r.open ? 'Collapse ' : 'Expand ') + r.plugin, size: 's', expanded: r.open, tip: false });
    tog.classList.add('mod-chev');
    tog.addEventListener('click', () => { r.open = !r.open; if (r.open && !DOCK_MQ.matches) for (const p of S.panes) p.collapsed = true; drawBand(); requestAnimationFrame(() => { const b = S.slots && S.slots.band.querySelector('[data-row="' + r.plugin + '"] .mod-chev'); if (b) b.focus(); }); });
    row.dataset.row = r.plugin;
    row.append(who, body, tog);
    row.setAttribute('role', 'group'); row.setAttribute('aria-label', r.plugin + ' mod');
    return row;
  }
  function drawBand() {
    const slot = S.slots && S.slots.band; if (!slot) return;
    const kids = [];
    const inl = S.panes.filter((p) => !docked(p));
    inl.forEach((p, i) => {
      if (p.collapsed == null) p.collapsed = i < inl.length - 1;
      const sec = el('section', 'mod-inline'); sec.dataset.open = String(!p.collapsed);
      sec.setAttribute('aria-label', p.title + ', ' + p.plugin + ' mod');
      sec.append(paneHead(p, true));
      if (!p.collapsed) sec.append(paneBody(p, true));
      kids.push(sec);
    });
    if (S.rows.length) {
      const band = el('div', 'mod-band'); band.setAttribute('role', 'region'); band.setAttribute('aria-label', 'Mods');
      for (const r of S.rows) band.append(rowEl(r));
      kids.push(band);
    }
    slot.replaceChildren(...kids);
  }

  /* ───────────── the status line under the composer ───────────── */
  const RMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tokMs = (name, d) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(), n = parseFloat(v); return isNaN(n) ? d : /ms$/.test(v) ? n : n * 1000; };
  const tokStr = (name, d) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || d;
  /* the composer host holds [band][composer][status]; its bottom is fixed, so a status line appearing (22px) lifts the composer
     and the band by 22px in one layout step. FLIP: measure, let the layout change, then animate the transform from the old
     place to the new one (compositor only, no layout per frame), on --dur-3 and --spring. Cleared: the same in reverse.
     Reduced motion: no travel, a short crossfade from a ghost of where the composer was. */
  let flipAnims = [];
  function riseComposer(mutate) {
    const slots = S.slots, host = slots && slots.status && slots.status.parentNode, comp = slots && slots.band && slots.band.nextElementSibling;
    if (!host || !comp || !host.isConnected || !comp.getBoundingClientRect().height || !comp.animate) { mutate(); return; }
    const first = comp.getBoundingClientRect(), hadBand = !!slots.band.childElementCount, topFirst = hadBand ? slots.band.getBoundingClientRect().top : first.top;
    const before = slots.status.cloneNode(true);                 /* what the status line said, kept for the fade-out when it clears */
    const hadStatus = !!slots.status.childElementCount;
    flipAnims.forEach((a) => a.cancel()); flipAnims = [];
    mutate();
    const last = comp.getBoundingClientRect(), dy = first.top - last.top;
    if (Math.abs(dy) < 1) return;
    const movers = [comp].concat(slots.band.childElementCount ? [slots.band] : []);
    const fade = tokMs('--dur-2', 200) > 1 ? tokMs('--dur-2', 200) : 120;
    if (RMQ.matches) {
      /* a short crossfade: a ghost of the old place fades out while the real one fades in (a copy, so no ids and no focus) */
      const ghost = document.createElement('div'); ghost.className = 'mod-ghost'; ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      const copy = (n) => { const c = n.cloneNode(true); for (const x of c.querySelectorAll('[id]')) x.removeAttribute('id'); c.removeAttribute('id'); const src = n.querySelectorAll('textarea'); c.querySelectorAll('textarea').forEach((t, i) => { t.value = src[i].value; }); return c; };
      if (hadBand) ghost.append(copy(slots.band)); ghost.append(copy(comp));
      ghost.style.top = (topFirst - host.getBoundingClientRect().top) + 'px';
      host.append(ghost);
      const out = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: tokStr('--ease', 'ease-out'), fill: 'forwards' });
      out.onfinish = () => ghost.remove();
      for (const m of movers) flipAnims.push(m.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: tokStr('--ease', 'ease-out') }));
    } else {
      const o = { duration: tokMs('--dur-3', 300), easing: tokStr('--spring', 'cubic-bezier(.22, 1, .36, 1)') };
      for (const m of movers) flipAnims.push(m.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }], o));
    }
    /* the line itself: in, it fades in as the composer leaves its place; out, a copy fades in the vacated place */
    if (!hadStatus && slots.status.childElementCount) slots.status.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: tokStr('--ease', 'ease-out'), delay: RMQ.matches ? 0 : 60, fill: 'backwards' });
    if (hadStatus && !slots.status.childElementCount && !RMQ.matches) {
      before.className = slots.status.className + ' mod-status--ghost'; before.setAttribute('aria-hidden', 'true');
      host.append(before);
      before.animate([{ opacity: 1 }, { opacity: 0 }], { duration: tokMs('--dur-out', 120) > 1 ? tokMs('--dur-out', 120) : 120, easing: tokStr('--ease', 'ease-out'), fill: 'forwards' }).onfinish = () => before.remove();
    }
  }
  function setStatus(plugin, text) {
    const had = S.status.size > 0;
    if (text == null || text === '') S.status.delete(plugin); else S.status.set(plugin, text);
    if (had !== S.status.size > 0) riseComposer(drawStatus); else drawStatus();
  }
  function drawStatus() {
    const slot = S.slots && S.slots.status; if (!slot) return;
    slot.setAttribute('role', 'region'); slot.setAttribute('aria-label', 'Mod status');
    slot.replaceChildren(...Array.from(S.status, ([plugin, text]) => {
      const i = el('span', 'mod-status__i');
      i.append(el('span', 'mod-status__n', plugin), document.createTextNode(' '), el('span', 'mod-status__t', text));
      return i;
    }));
  }

  /* ───────────── placed rows: from the mod, never from the agent ───────────── */
  function place(plugin, tree, o) {
    o = o || {};
    const t = o.time || now();
    const art = ui.entry({ kind: 'mod', who: ui.html.mod(plugin), callno: [t], label: plugin + ' mod, ' + t, body: '' });
    art.setAttribute('data-mod-row', plugin);
    const root = mv(tree, { surface: 'ground', dispatch: dispatcher(plugin), onInvalid: (x) => console.warn('[mods] ' + plugin + ': row skipped, ' + x) });
    if (!root) return null;
    art.querySelector('.ui-entry__body').append(root);
    HX.session.placeRow(art, { quiet: true });
    return art;
  }
  /* a card in the conversation, at the point the mod raised it: no margin text, the card's own byline names the mod */
  function placeCard(card) {
    const art = ui.entry({ kind: 'mod', callno: [], body: '' });
    art.setAttribute('data-mod-card', '');
    art.querySelector('.ui-entry__body').append(card);
    HX.session.placeRow(art, { quiet: true });
    return art;
  }

  /* ───────────── toast: the app's notice, attributed; one at a time, queued ─────────────
     A mod's toasts wait in order: the next appears as the previous one has faded, and while others wait the toast carries a
     quiet "+N". Dismissing one (its close button, Esc inside it, or its action) shows the next at once. */
  const TQ = { wait: [], cur: null, node: null, watch: null, timer: 0 };
  const moreText = () => (TQ.wait.length ? '+' + TQ.wait.length : '');
  function paintMore() {
    const n = TQ.node && TQ.node.querySelector('.mod-toast'); if (!n) return;
    let m = n.querySelector('.mod-toast__more');
    if (!TQ.wait.length) { if (m) m.remove(); } else {
      if (!m) { m = el('span', 'mod-toast__more'); n.append(m); }
      m.textContent = moreText(); m.setAttribute('data-tip', TQ.wait.length + ' more waiting'); m.setAttribute('aria-label', TQ.wait.length + ' more waiting');
    }
    TQ.node.setAttribute('aria-label', TQ.cur.plugin + ' mod: ' + TQ.cur.text + (TQ.wait.length ? ', ' + TQ.wait.length + ' more waiting' : ''));
  }
  function showNextToast() {
    clearTimeout(TQ.timer);
    const t = TQ.wait.shift(); if (!t) { TQ.cur = null; return; }
    TQ.cur = t;
    const o = Object.assign({}, t.o);
    if (o.action) { const go = o.action.onClick; o.action = Object.assign({}, o.action, { onClick: () => { t.gone = true; go && go(); setTimeout(showNextToast, 0); } }); }
    const node = ui.toast(t.text, o); TQ.node = node;
    const first = node.firstElementChild;
    if (first && first.tagName === 'SPAN') { first.className = 'mod-toast'; first.innerHTML = '<span class="mod-toast__who">' + ui.html.mod(t.plugin) + '</span><span class="mod-toast__t">' + esc(t.text) + '</span>'; }
    const x = ui.iconButton({ icon: 'close', label: 'Dismiss', size: 's', tip: false }); x.classList.add('mod-toast__x');
    x.addEventListener('click', () => dismissToast());
    node.append(x);
    node.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismissToast(); } };
    paintMore();
    /* it fades by itself (the library's timer): when it has, the next one comes */
    if (TQ.watch) TQ.watch.disconnect();
    TQ.watch = new MutationObserver(() => {
      if (node.classList.contains('is-in') || TQ.cur !== t || t.gone) return;
      t.gone = true; TQ.watch.disconnect();
      TQ.timer = setTimeout(showNextToast, Math.max(1, tokMs('--dur-2', 200)));      /* after the fade (1ms under reduced motion) */
    });
    TQ.watch.observe(node, { attributes: true, attributeFilter: ['class'] });
  }
  function dismissToast() {
    if (!TQ.cur) return;
    TQ.cur.gone = true; if (TQ.watch) TQ.watch.disconnect();
    if (TQ.wait.length) showNextToast(); else { TQ.cur = null; ui.toast.hide(); }
  }
  function toast(plugin, text, o) {
    TQ.wait.push({ plugin, text, o: o || {} });
    if (!TQ.cur || TQ.cur.gone && !TQ.timer) { if (!TQ.cur) showNextToast(); }
    else paintMore();
    return TQ.node;
  }

  /* ───────────── $.ui.ask: a choice form with a mod origin, in the conversation and in the dock ───────────── */
  const asks = new Map();
  function ask(plugin, q) {
    const data = {
      id: q.id || 'mod-ask-' + plugin, kind: 'choice', title: q.title, why: q.why, origin: { kind: 'mod', plugin },
      schema: { properties: { choice: { type: 'string', title: q.field || 'Choice', enum: q.options, default: q.options[0] } }, required: ['choice'] },
      submit: { label: q.submit || 'Use this' }
    };
    asks.set(data.id, data);
    const card = ui.card('form', data, { size: 'inline' });
    placeCard(card);
    if (q.queue !== false) watchDock();
    return card;
  }
  /* the dock's queue, through the DOM: every .dk-cards slot gets the mod's form as its last card (dock.js is off limits;
     in the product the form is a FormWait in the dock's own list, so its count and its dot include it) */
  let dockWatch = null; const dockCards = new Map();
  function watchDock() {
    if (dockWatch) { fillDock(); return; }
    const root = document.getElementById('hx-dock'); if (!root) return;
    dockWatch = new MutationObserver(() => fillDock());
    dockWatch.observe(root, { childList: true, subtree: true });
    fillDock();
  }
  function fillDock() {
    const root = document.getElementById('hx-dock'); if (!root) return;
    for (const slot of root.querySelectorAll('.dk-cards[data-cards]')) {
      for (const [id, data] of asks) {
        const size = slot.dataset.cards, key = id + ':' + size;
        let card = dockCards.get(key);
        if (!card) { card = ui.card('form', Object.assign({}, data), { size, ground: 'dock' }); dockCards.set(key, card); }
        if (card.parentNode !== slot) slot.append(card);
      }
    }
  }

  /* ───────────── $.theme.set: "Apply <mod>'s colours?" with a live preview ─────────────
     While the card is open and on screen, the whole app previews the colours through theme.js (HX_THEME.preview: the one theme
     mechanism, never saved). Keep commits them; Reject, Esc (Later), the card leaving the screen (removed, or its view hidden) or
     another theme chosen restores the previous theme at once. One preview at a time: the card opened last holds it. */
  const THEME_CARDS = new Set();
  let themeSeq = 0;
  const LIVE_STATES = ['open', 'invalid', 'holding', 'submitting'];
  /* on screen: in the page, rendered, and not in a view the shell has set aside (inert or hidden: another tab, a closed pane).
     Scrolled out of the window still counts as shown, so reading the conversation never drops the preview. */
  const onScreen = (c) => { if (!c.isConnected || c.closest('[inert], [hidden]')) return false; const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== 'hidden'; };
  let hideWatch = null, hideQueued = false;
  const recheck = () => { hideQueued = false; for (const c of THEME_CARDS) c._mp.visible = onScreen(c); reconcilePreview(); };
  const queueRecheck = () => { if (!hideQueued) { hideQueued = true; requestAnimationFrame(recheck); } };
  function previewOwner() { let o = null; for (const c of THEME_CARDS) if (c._mp.visible && !c._mp.paused && LIVE_STATES.indexOf(c._state) >= 0) o = c; return o; }
  function reconcilePreview() {
    const T = window.HX_THEME; if (!T || !T.preview) return;
    const o = previewOwner();
    for (const c of THEME_CARDS) c.toggleAttribute('data-previewing', c === o);
    if (o) { if (S.previewing !== o) { S.previewing = o; T.preview({ colors: o._mp.colors }); } }
    else if (S.previewing) { S.previewing = null; T.endPreview(false); }
  }
  /* theme.js ended a preview itself (another theme chosen, a colour edited, reset, import): no card previews until it is reopened */
  window.addEventListener('hx:theme-preview', (e) => {
    const o = S.previewing;
    if (e.detail && e.detail.previewing === false && o && !o._mp.ending) { o._mp.paused = true; S.previewing = null; for (const c of THEME_CARDS) c.removeAttribute('data-previewing'); }
  });
  function proposeTheme(plugin, t) {
    const data = {
      id: 'mod-theme-' + plugin + '-' + (++themeSeq), kind: 'theme', title: 'Apply ' + plugin + '’s colours?', origin: { kind: 'mod', plugin },
      why: t.why, swatches: t.swatches, preview: true, schema: { properties: {} }, submit: { label: 'Keep' }, cancel: { label: 'Reject' }, receipt: 'Kept ' + plugin + '’s colours. Undo in Settings, Appearance',
      cancelledText: 'Rejected. The theme is back as it was', deferredText: 'Later. The theme stays as it was'
    };
    const card = ui.card('form', data, { size: 'inline' });
    card._mp = { colors: t.colors || {}, visible: false, paused: false, ending: false };
    THEME_CARDS.add(card);
    card.addEventListener('hx:card-state', (e) => {
      const st = e.detail.state, T = window.HX_THEME;
      if (st === 'open') card._mp.paused = false;                                          /* reopened: it previews again */
      if (st === 'done') {
        card._mp.ending = true;
        if (S.previewing === card && T && T.endPreview) { S.previewing = null; T.endPreview(true); }      /* Keep: the previewed colours are the theme now */
        else if (T && t.colors) T.set({ colors: t.colors });
        card._mp.ending = false; THEME_CARDS.delete(card); card.removeAttribute('data-previewing');
      }
      reconcilePreview();
    });
    /* leaving the screen: removed from the page, or its view hidden (another tab, another session) */
    const io = new IntersectionObserver((rows) => {
      const shown = onScreen(card);
      if (shown && !card._mp.visible) card._mp.paused = false;
      card._mp.visible = shown; reconcilePreview();
      if (!card.isConnected) { io.disconnect(); THEME_CARDS.delete(card); reconcilePreview(); }
    });
    placeCard(card);
    io.observe(card);
    if (!hideWatch) { hideWatch = new MutationObserver(queueRecheck); hideWatch.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['inert', 'hidden', 'aria-hidden'] }); }
    return card;
  }
  /* navigating away ends a preview at once, without waiting for the observers */
  for (const ev of ['hx:tab', 'hx:session-select', 'hx:new-session', 'hx:nav']) if (HX.on) HX.on(ev, queueRecheck);
  window.addEventListener('pagehide', () => { if (S.previewing && window.HX_THEME) window.HX_THEME.endPreview(false); });

  /* ───────────── the samples ───────────── */
  /* SAMPLE MODS with SAMPLE DATA. They look like real ones: a token chart (Svg and Box bars), a test runner (Code, a
     button, a select) and a todo list (Input, Select, state). The names are made up. */
  const sample = {};
  const T = h.Text, B = h.Box;
  const sampleNote = () => T({ dimColor: true, size: 'xs' }, 'Sample data from a sample mod');

  /* — token-meter: a chart pane — */
  function usageTree() {
    const turns = [[6.1, 1.2], [9.4, 2.0], [4.2, 0.9], [11.8, 3.1], [7.7, 1.5], [14.2, 3.6], [5.0, 1.1], [12.4, 2.8]];
    const max = 18, H = 84, bw = 12, gap = 21, x0 = 20;
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 112" role="img">' +
      '<line x1="0" y1="' + H + '.5" x2="300" y2="' + H + '.5" stroke="subtle" stroke-width="1"/>' +
      '<line x1="0" y1="42.5" x2="300" y2="42.5" stroke="subtle" stroke-width="1" stroke-dasharray="2 4" opacity=".5"/>';
    turns.forEach(([inp, out], i) => {
      const x = x0 + i * (bw * 2 + gap - 11), hi = Math.round(inp / max * H), ho = Math.round(out / max * H);
      svg += '<rect x="' + x + '" y="' + (H - hi) + '" width="' + bw + '" height="' + hi + '" rx="2" fill="claude"/>' +
        '<rect x="' + (x + bw + 2) + '" y="' + (H - ho) + '" width="' + bw + '" height="' + ho + '" rx="2" fill="#7aa2f7"/>' +
        '<text x="' + (x + bw) + '" y="104" text-anchor="middle" font-size="11">' + (i + 1) + '</text>';
    });
    svg += '</svg>';
    const legend = (color, label) => B({ gap: 1, alignItems: 'center' }, B({ width: 1, height: 1, backgroundColor: color }), T({ size: 'xs', color: 'subtle' }, label));
    const model = (name, tokens, pct) => B({ gap: 2, alignItems: 'center' },
      T({ mono: true, size: 'xs', wrap: 'truncate' }, name),
      B({ flexGrow: 1, height: 0.5, backgroundColor: 'surface-2' }, B({ width: pct + '%', height: 0.5, backgroundColor: 'claude' })),
      T({ mono: true, tabular: true, size: 'xs', color: 'subtle' }, tokens));
    return B({ flexDirection: 'column', gap: 3 },
      B({ justifyContent: 'space-between', alignItems: 'baseline' }, T({ bold: true }, 'This session'), T({ mono: true, tabular: true, size: 'xs', color: 'subtle' }, '48.2k tokens')),
      B({ flexDirection: 'column', gap: 1 },
        { type: 'Svg', props: { svg, label: 'Tokens per turn, input and output, turns 1 to 8' }, children: [] },
        B({ gap: 3 }, legend('claude', 'input'), legend('#7aa2f7', 'output'), T({ size: 'xs', color: 'subtle' }, 'per turn, k tokens'))),
      B({ flexDirection: 'column', gap: 1 },
        T({ size: 'xs', weight: 500, color: 'subtle' }, 'By model'),
        model('qwen3-coder', '31.2k', 65), model('haiku 4.5', '9.8k', 20), model('sonnet 5.5', '7.2k', 15)),
      sampleNote());
  }

  /* — test-runner: a pane, a band row, a placed row, a toast and a question — */
  const TR = { running: false, filter: 'all', runs: 1, failing: 2, total: 29, secs: 4.18 };
  const TR_OUT = [' PASS  money.test.ts', ' PASS  prorate.test.ts (5000 runs)', ' FAIL  invoice.test.ts  › rounds per line item', ' FAIL  invoice.test.ts  › keeps the cents of a credit', ' PASS  cents.test.ts', ' PASS  api.test.ts'];
  function testsTree() {
    const shown = TR.filter === 'failing' ? TR_OUT.filter((l) => /FAIL/.test(l)) : TR_OUT;
    const rerun = bind('test-runner', 'rerun', () => { if (TR.running) return; TR.running = true; invalidate('test-runner'); setTimeout(() => { TR.running = false; TR.runs++; TR.failing = Math.max(0, TR.failing - 1); invalidate('test-runner'); }, 1100); });
    const pick = bind('test-runner', 'filter', (v) => { TR.filter = v; invalidate('test-runner'); });
    return B({ flexDirection: 'column', gap: 3 },
      B({ justifyContent: 'space-between', alignItems: 'center', gap: 2 },
        B({ flexDirection: 'column' },
          T({ bold: true }, TR.running ? 'Running tests' : TR.total + ' tests, ' + TR.failing + ' failing'),
          B({ gap: 2 }, T({ mono: true, size: 'xs', color: 'subtle' }, 'npm test'), T({ mono: true, tabular: true, size: 'xs', color: 'subtle' }, TR.secs.toFixed(2) + ' s'))),
        { type: 'Button', props: { onPress: rerun, label: TR.running ? 'Running' : 'Re-run', disabled: TR.running, hotkey: 'mod+r' }, children: [] }),
      B({ alignItems: 'center', gap: 2 },
        { type: 'Select', props: { options: [{ label: 'All tests', value: 'all' }, { label: 'Failing only', value: 'failing' }], value: TR.filter, onSelect: pick, label: 'Show' }, children: [] },
        T({ size: 'xs', color: 'subtle' }, shown.length + ' shown')),
      { type: 'Code', props: { source: shown.join('\n'), path: 'npm test -- billing', wrap: true }, children: [] },
      { type: 'Markdown', props: { text: 'Both failures are in `invoice.test.ts`. The credit case rounds before it sums, so it looks like the same bug as the proration drift. [Open the run](https://ci.example.com/runs/4182)' }, children: [] },
      sampleNote());
  }
  function testBand(collapsed) {
    const rerun = bind('test-runner', 'rerun', () => { if (TR.running) return; TR.running = true; invalidate('test-runner'); setTimeout(() => { TR.running = false; TR.failing = Math.max(0, TR.failing - 1); invalidate('test-runner'); }, 1100); });
    const line = B({ alignItems: 'center', gap: 2, flexGrow: 1, justifyContent: 'space-between' },
      T({ wrap: 'truncate', color: TR.failing ? 'text' : 'success' }, TR.running ? 'Running tests' : TR.failing ? TR.total + ' tests, ' + TR.failing + ' failing' : TR.total + ' tests passing'),
      TR.running ? B({ role: 'progressbar', dots: 8, progress: null, label: 'Running tests' }) : null,
      { type: 'Button', props: { onPress: rerun, label: TR.running ? 'Running' : 'Re-run', disabled: TR.running, plain: true }, children: [] });
    if (collapsed) return line;
    return B({ flexDirection: 'column', gap: 2, flexGrow: 1 }, line,
      B({ flexDirection: 'column', gap: 1 }, T({ mono: true, size: 'xs', color: 'subtle' }, 'invoice.test.ts › rounds per line item'), T({ mono: true, size: 'xs', color: 'subtle' }, 'invoice.test.ts › keeps the cents of a credit')),
      sampleNote());
  }
  function testPlaced() {
    return B({ flexDirection: 'column', gap: 2 },
      T({ bold: true }, 'Tests ran: 29 run, 2 failing'),
      { type: 'Code', props: { source: TR_OUT.filter((l) => /FAIL/.test(l)).join('\n'), path: 'invoice.test.ts', wrap: true }, children: [] },
      B({ gap: 2, alignItems: 'center' },
        { type: 'Button', props: { onPress: bind('test-runner', 'rerun', () => {}), label: 'Re-run failing' }, children: [] },
        { type: 'Link', props: { href: 'https://ci.example.com/runs/4182', label: 'Open the run' }, children: [] }),
      sampleNote());
  }

  /* — docs-indexer: a progress line in the band. Progress is dots (F18): filled in proportion when the share is known,
       one dot travelling while it is only scanning. ?indexing=scan shows the second form. — */
  const DI = { pct: 62, done: 184, total: 296, scan: query.get('indexing') === 'scan' };
  function indexBand(collapsed) {
    const dots = B({ role: 'progressbar', dots: 8, progress: DI.scan ? null : DI.pct, label: DI.scan ? 'Indexing docs, scanning' : 'Indexing docs, ' + DI.pct + '%' });
    const line = B({ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexGrow: 1 }, T({ wrap: 'truncate' }, DI.scan ? 'Scanning docs' : 'Indexing docs'),
      B({ alignItems: 'center', gap: 2, flexShrink: 0 }, dots, DI.scan ? null : T({ mono: true, tabular: true, size: 'xs', color: 'subtle', wrap: 'nowrap' }, DI.pct + '%')));
    if (collapsed) return line;
    return B({ flexDirection: 'column', gap: 1, flexGrow: 1 }, line,
      T({ size: 'xs', color: 'subtle' }, DI.scan ? 'Counting files. The share is not known yet.' : DI.done + ' of ' + DI.total + ' files read. Reading docs/api next.'), sampleNote());
  }

  /* — todo-list: Input and Select, with state — */
  const TD = { items: [{ t: 'Round once per invoice', done: true }, { t: 'Property test for half-cents', done: false }, { t: 'Draft the PR description', done: false }, { t: 'Ask atlas for a review', done: false }], filter: 'all' };
  function todoTree() {
    const add = bind('todo-list', 'add', (v) => { v = String(v || '').trim(); if (!v) return; TD.items.unshift({ t: v, done: false }); invalidate('todo-list'); });
    const pick = bind('todo-list', 'filter', (v) => { TD.filter = v; invalidate('todo-list'); });
    const open = TD.items.filter((i) => !i.done).length;
    const list = TD.items.map((it, i) => ({ it, i })).filter(({ it }) => TD.filter === 'all' || (TD.filter === 'open' ? !it.done : it.done));
    return B({ flexDirection: 'column', gap: 3 },
      { type: 'Input', props: { placeholder: 'Add a todo', submitLabel: 'Add', onSubmit: add, label: 'New todo' }, children: [] },
      B({ alignItems: 'center', justifyContent: 'space-between', gap: 2 },
        { type: 'Select', props: { options: [{ label: 'All', value: 'all' }, { label: 'Open', value: 'open' }, { label: 'Done', value: 'done' }], value: TD.filter, onSelect: pick, label: 'Show' }, children: [] },
        T({ mono: true, tabular: true, size: 'xs', color: 'subtle' }, open + ' open')),
      B({ flexDirection: 'column', gap: 1 }, ...list.map(({ it, i }) => B({ alignItems: 'center', gap: 2 },
        { type: 'Button', props: { onPress: bind('todo-list', 'toggle' + i, () => { it.done = !it.done; invalidate('todo-list'); }), label: '', icon: it.done ? 'check' : null, variant: it.done ? 'primary' : 'secondary', pressed: it.done, 'aria-label': (it.done ? 'Mark open: ' : 'Mark done: ') + it.t }, children: [] },
        T({ dimColor: it.done, strikethrough: it.done }, it.t)))),
      sampleNote());
  }

  /* — dusk: the colours it offers (a ramp generated from its anchors; these are the results) — */
  const DUSK = {
    why: 'It changes the surfaces, the text and the accent. The whole app shows them now. Keep them to use them, or reject them to go back.',
    swatches: [['ground', '#201e31'], ['raised', '#2b2840'], ['text', '#e7e4f2'], ['quiet', '#9692b4'], ['accent', '#b8a4f0']],
    colors: { '--bg-0': '#14121f', '--bg-1': '#1a1828', '--bg-2': '#201e31', '--bg-3': '#2b2840', '--bg-4': '#373354', '--chip': '#2a2740', '--text': '#e7e4f2', '--text-strong': '#ffffff', '--text-dim': '#aaa6c4', '--text-quiet': '#9692b4', '--text-faint': '#5d5979', '--icon': '#b4b0cf', '--brass': '#b8a4f0' }
  };

  /* ───────────── wiring ───────────── */
  function mount(slots) {
    S.slots = slots; drawBand(); drawStatus();
    DOCK_MQ.addEventListener('change', () => { drawBand(); HX.session.refreshRight(); });
  }
  const api = {
    openPane, closePane, invalidate, setBand, setStatus, place, placeCard, toast, ask, proposeTheme, decoratePanel,
    panes: () => S.panes.map((p) => ({ id: p.id, plugin: p.plugin, title: p.title })),
    sample: { usageTree, testsTree, todoTree, testBand, indexBand, testPlaced, DUSK },
    get state() { return S; }
  };
  HX.mods = api;

  /* ───────────── ?mods=1 ───────────── */
  function demo() {
    const q = (k) => query.get(k);
    const want = q('pane') || 'usage';
    const PANES = { usage: { id: 'usage', plugin: 'token-meter', title: 'Token usage', render: usageTree }, tests: { id: 'tests', plugin: 'test-runner', title: 'Tests', render: testsTree }, todos: { id: 'todos', plugin: 'todo-list', title: 'Todos', render: todoTree } };
    const cur = PANES[want] ? want : 'usage';
    ['usage', 'tests'].concat(q('todos') || want === 'todos' ? ['todos'] : []).forEach((k) => openPane(PANES[k]));
    S.active = cur;
    for (const p of S.panes) p.collapsed = p.id !== cur;      /* on a narrow window the pane asked for is the open one */
    setBand({ plugin: 'docs-indexer', render: indexBand, open: q('band') === 'open' });
    setBand({ plugin: 'test-runner', render: testBand, open: q('band') === 'open' });
    setStatus('token-meter', '12.4k tokens this turn');
    setStatus('test-runner', TR.failing + ' failing');
    place('token-meter', T({ color: 'subtle' }, 'This turn used ', T({ mono: true, tabular: true, color: 'text' }, '12.4k tokens'), ' of the 200k window'), { time: '14:05' });
    place('test-runner', testPlaced(), { time: '14:12' });
    ask('test-runner', { title: 'Which tests should I re-run?', why: 'The run finished with two failures. Pick how much to run again.', field: 'Run', options: ['The 2 failing tests', 'The billing suite, 29 tests', 'Everything, 142 tests'], submit: 'Run tests' });
    if (q('theme') || q('all')) proposeTheme('dusk', DUSK);
    /* ?toast=1 one toast; ?toast=3 (and ?all=1) three, so the second and third wait behind the first as "+2" */
    const nToast = q('toast') ? Math.max(1, parseInt(q('toast'), 10) || 1) : q('all') ? 3 : 0;
    const TOASTS = [['test-runner', '2 tests still failing', { action: { label: 'View', onClick: () => { S.active = 'tests'; HX.session.refreshRight(); } } }], ['docs-indexer', 'Indexed 296 files'], ['token-meter', 'Context is at 78%']];
    if (nToast) setTimeout(() => TOASTS.slice(0, nToast).forEach((t) => toast(t[0], t[1], t[2])), 900);
    if (q('fold')) { for (const p of S.panes) p.collapsed = true; drawBand(); }      /* narrow screenshots: the panes folded, so the conversation shows */
    HX.session.refreshRight();
  }
  const start = () => {
    mount(HX.session.slots);
    if (query.get('mods')) setTimeout(demo, 60);
  };
  if (HX.session && HX.session.slots) start();
  else HX.on('hx:session-ready', (d) => { if (!S.slots) { HX.session = HX.session || {}; start(); } });
})();
