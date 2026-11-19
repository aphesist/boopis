/* hypotaxis v6 · bots tab (owner: bots agent). Built on the shared library (components/components.js, HX.ui) per
   design-system/MIGRATION.md §4; keyboard per KEYMAP.md §3, §4, §5, §7, §9. The shell is the design authority.
   Bots keeps only what is its own: the presence header, the new-bot form (stage, name, pickers, suggestions), the
   cron preview, its layout, and the orbs' liveliness and play (owner, v7).
   Registers:  bots-list → #hx-list-bots, bots → #hx-view-bots
   Listens:    hx:bot-select {id}, hx:new-bot, hx:bot-settings {open}, hx:nav {action}, hx:state, hx:tab, hx:theme,
               hx:card-action {action}
   Emits:      hx:attention {source:'bots', tab:'bots', count, ids}, hx:bot-select {id, from}, hx:bot-state {id, state, attention},
               hx:bot-created {bot}, hx:bot-archived {id}, hx:view-inset {tab:'bots', right}, hx:title {tab:'bots', title}
   Provides:   HX.provide('bot-settings'), HX.provide('stop')
   Exposes:    HX.bots = { list(), get(id), open(id), newBot(seed), settings(id, section), toggleSettings() },
               HX.botNames = { pick({avoid}), available(), taken(name), exhausted(), ready() } */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ helpers */
  const hx = () => window.HX || null;
  const UI = () => (window.HX && window.HX.ui) || null;
  /* drawn corners (DESIGN-SYSTEM.md §8): the bots' own surfaces take the library's continuous corner */
  if (UI() && UI().squircle) UI().squircle.auto('.bt-sugg, .bt-opt');
  const data = () => (hx() && hx().data) || window.HX_DATA || {};
  const det = a => (a instanceof Event ? a.detail : a) || {};
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const later = (fn, ms) => setTimeout(fn, reduced() ? Math.min(ms, 300) : ms);
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const isField = n => !!n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
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
    if (kids) for (const c of [].concat(kids)) if (c != null) n.append(c);
    return n;
  }
  const frag = h => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
  const emit = (t, d) => { const H = hx(); if (H && H.emit) H.emit(t, d); };
  const toast = t => { const u = UI(); if (u && u.toast) u.toast(t); else emit('hx:toast', { text: t }); };
  /* orb methods exist only once <orb-avatar> is defined */
  const oc = (o, m, ...a) => { if (o && typeof o[m] === 'function') { try { return o[m](...a); } catch (e) { /* not upgraded yet */ } } };

  /* ------------------------------------------------------------------ vocabulary (bots' own data) */
  const ACTIVITY = {
    kai: 'drafting the changelog for 2.4',
    terra: 'planning migration 0042',
    vox: 'collecting merged PRs since 2.3',
    moss: 'rerunning invoice.test.ts, 7 of 20'
  };
  /* swatches and the default draft colour are orb colours: bot data, not interface colour */
  const SWATCHES = [
    ['#efece6', 'Bone'], ['#a6a6ab', 'Pewter'], ['#1c1c24', 'Ink'], ['#c4834a', 'Clay'],
    ['#f23b5a', 'Rose'], ['#f5a337', 'Amber'], ['#2fd26a', 'Green'], ['#4fc9a8', 'Mint'],
    ['#3b82f6', 'Blue'], ['#6d5cf0', 'Indigo'], ['#9b5cf6', 'Violet'], ['#f472b6', 'Pink']
  ];
  const DRAFT_COLOR = '#3b82f6';
  const SHAPES = ['circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond', 'cloud', 'clover', 'flower', 'star'];
  const EYES = ['pill', 'tall', 'circle', 'wide', 'squint', 'square', 'grid', 'matrix', 'bars', 'arc', 'rest', 'plus', 'heart', 'circle wide'];
  const MODELS = ['opus 5.5', 'sonnet 5.5', 'haiku 4.5', 'qwen3-coder'];
  const CRON_PRESETS = [['', 'Only when asked'], ['0 * * * *', 'Hourly'], ['0 2 * * *', 'Every night'], ['0 9 * * 1-5', 'Weekday mornings']];
  const CHANNELS = [['app', 'This app', 'always on'], ['slack', 'Slack', '#billing-alerts'], ['telegram', 'Telegram', '@enzo'], ['email', 'Email', 'enzo@hypotaxis.dev']];
  const APPROVALS = [
    ['deploys', 'Deploying anywhere'], ['push', 'Pushing to protected branches'], ['network', 'Reaching the network'],
    ['spend', 'Spending past the run cap'], ['people', 'Messaging people'], ['outside', 'Writing outside its workspace']
  ];
  const CRON_DEFAULT = { sol: '0 2 * * *', hex: '0 9 * * 1', nimbus: '*/30 * * * *', moss: '0 */4 * * *', kai: '0 18 * * 1-5', vox: '0 10 * * 5' };
  const SPENT = { nina: '0.02', kai: '0.11', moss: '0.24', terra: '0.07', vox: '0.05', atlas: '0.09' };
  const REPLY = {
    atlas: ['I’ll read it line by line and flag anything that changes behaviour.', 'Review is up: two nits, nothing blocking. Notes are on the PR.'],
    nina: ['I’ll stage it first and compare before anything touches production.', 'Staged. Everything matches; production is waiting for your approval.'],
    kai: ['Noted. I’ll fold it into the changelog draft.', 'Changelog updated. Three entries moved under `fixed`.'],
    hex: ['Waking up. I’ll scan the diff for secrets and unsafe calls.', 'No secrets, no new network calls. One dependency is two majors behind.']
  };

  /* ------------------------------------------------------------------ cron in plain words */
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function cronWords(c) {
    c = (c || '').trim();
    if (!c) return 'only when asked';
    const p = c.split(/\s+/);
    if (p.length !== 5) return 'not a schedule yet: use five fields, minute hour day month weekday (0 9 * * 1-5 is weekdays at 09:00)';
    const [mi, h, dom, mon, dow] = p, hh = n => String(n).padStart(2, '0');
    if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'every ' + mi.slice(2) + ' minutes';
    if (/^\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return mi === '0' ? 'every hour' : 'every hour at :' + hh(mi);
    if (/^\d+$/.test(mi) && /^\*\/\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') return 'every ' + h.slice(2) + ' hours';
    if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mon === '*') {
      const t = hh(h) + ':' + hh(mi);
      if (dow === '*') return 'every day at ' + t;
      if (dow === '1-5') return 'weekdays at ' + t;
      if (dow === '0,6' || dow === '6,0') return 'weekends at ' + t;
      if (/^[0-6]$/.test(dow)) return DAYS[+dow] + 's at ' + t;
    }
    return 'custom: ' + c;
  }
  const cronValid = c => !/^not a/.test(cronWords(c));

  /* ------------------------------------------------------------------ model */
  const S = {
    bots: [], threads: {}, sel: null, view: 'bot', listRoot: null, listWrap: null, rowsEl: null, viewRoot: null, rows: new Map(),
    room: null, presence: null, composer: null, sheet: null, transient: null, typing: false, follow: null, draft: null, draftRow: null,
    runs: new Map()
  };

  /* ------------------------------------------------------------------ names (HX.botNames)
     The curated list lives in data/bot-names.json (read once, same origin). Availability is derived, never stored:
     the list minus the names of the bots that exist now, case-insensitive, so a name is taken while its bot exists
     (picked or typed) and comes back when the bot is archived. When every name is in use, pick() returns a list
     name with the lowest free number (nova-2) and exhausted() says so. Until the file has loaded (or where it cannot,
     a page opened from disk) a short seed of the same names stands in. */
  const NAME_SEED = ['nova', 'lyra', 'orion', 'wren', 'juniper', 'ember', 'onyx', 'tide', 'fern', 'zephyr', 'pip', 'aster', 'rowan', 'cobalt', 'lumen'];
  const names = { list: null, loading: null };
  function loadNames() {
    if (names.loading) return names.loading;
    try {
      names.loading = fetch(new URL('data/bot-names.json', document.baseURI)).then(r => r.ok ? r.json() : null)
        .then(j => { if (j && Array.isArray(j.names) && j.names.length) names.list = [...new Set(j.names.map(n => String(n).trim().toLowerCase()).filter(Boolean))]; })
        .catch(() => {});
    } catch (e) { names.loading = Promise.resolve(); }
    return names.loading;
  }
  const namePool = () => names.list || NAME_SEED;
  function namesInUse() {
    const list = S.bots.length ? S.bots : (data().bots || []);
    const used = new Set();
    for (const b of list) { if (b.name) used.add(String(b.name).toLowerCase()); if (b.id) used.add(String(b.id).toLowerCase()); }
    return used;
  }
  const botNames = {
    available() { const used = namesInUse(); return namePool().filter(n => !used.has(n)); },
    taken(name) { return namesInUse().has(String(name || '').trim().toLowerCase()); },
    exhausted() { return !botNames.available().length; },
    /* a random free name; avoid (a string or a list) keeps a reroll from landing on what is already in the field */
    pick(opts) {
      const avoid = new Set([].concat((opts && opts.avoid) || []).map(s => String(s).toLowerCase()));
      const free = botNames.available(), fresh = free.filter(n => !avoid.has(n));
      const from = fresh.length ? fresh : free;
      if (from.length) return from[Math.floor(Math.random() * from.length)];
      const used = namesInUse(), pool = namePool(), base = pool[Math.floor(Math.random() * pool.length)];
      let n = 2; while (used.has(base + '-' + n) || avoid.has(base + '-' + n)) n++;
      return base + '-' + n;
    },
    ready: () => loadNames()
  };
  loadNames();
  if (window.HX) window.HX.botNames = botNames;   /* again in register(), once the shell's HX exists */

  /* ------------------------------------------------------------------ long names
     Where the space is fixed (list rows, bylines, the sheet, the button) a name is one line with an ellipsis; the
     header wraps to two lines. A name that does not fit shows whole in the library's tooltip; the accessible name and
     hx:title always carry it whole. Checked after each render and on resize, one frame later. */
  let clipRaf = 0;
  function tipIfClipped(host, textEl, full) {
    if (!host || !textEl || !textEl.isConnected) return;
    if (host.hasAttribute('data-tip') && !host.hasAttribute('data-tip-auto')) return;   /* the rail's own tip */
    const clipped = textEl.scrollWidth > textEl.clientWidth + 1 || textEl.scrollHeight > textEl.clientHeight + 1;
    if (clipped) { host.setAttribute('data-tip', full); host.setAttribute('data-tip-auto', ''); }
    else if (host.hasAttribute('data-tip-auto')) { host.removeAttribute('data-tip'); host.removeAttribute('data-tip-auto'); }
  }
  function checkClips() {
    if (clipRaf) return;
    clipRaf = requestAnimationFrame(() => {
      clipRaf = 0;
      if (!railOn()) for (const [id, r] of S.rows) { const b = bot(id); if (b) tipIfClipped(r.btn, r.li.querySelector('.ui-row__title'), b.name); }
      if (S.draftRow && !railOn()) tipIfClipped(S.draftRow.btn, S.draftRow.name, S.draftRow.name.textContent);
      const root = S.viewRoot; if (!root) return;
      for (const n of root.querySelectorAll('.bt-p-name, .bt-who-name, .bt-sh-name')) tipIfClipped(n, n, n.textContent);
      for (const gl of root.querySelectorAll('.bt-go-label, .bt-arch-label')) tipIfClipped(gl.closest('button'), gl, gl.textContent);
    });
  }
  let clipObs = null;
  const watchClips = n => { if (!n || !window.ResizeObserver) return; if (!clipObs) clipObs = new ResizeObserver(() => checkClips()); clipObs.observe(n); };
  function initModel() {
    if (S.bots.length) return;
    const d = data();
    S.bots = (d.bots || []).map(b => ({
      ...b,
      state: b.state || 'idle',
      activity: ACTIVITY[b.id] || '',
      spent: SPENT[b.id] || '0.00',
      cfg: {
        instructions: '', gov: b.id === 'noct' ? 'ungoverned' : 'governed', model: 'sonnet 5.5', cap: '0.60',
        cron: CRON_DEFAULT[b.id] || '',
        channels: { app: true, slack: ['nina', 'noct', 'hex'].includes(b.id), telegram: b.id === 'noct', email: b.id === 'nimbus' },
        approvals: { deploys: true, push: true, network: b.id !== 'nimbus', spend: true, people: true, outside: true },
        workspace: ['hex', 'moss', 'terra'].includes(b.id) ? 'sandbox' : 'worktree'
      }
    }));
    /* the threads are shared with the dock: HX.data.botThreads, live */
    d.botThreads = d.botThreads || {};
    S.threads = d.botThreads;
    S.sel = (S.bots.find(b => b.attention) || S.bots[0] || {}).id || null;
  }
  const bot = id => S.bots.find(b => b.id === id);
  const thread = id => { const d = data(); d.botThreads = d.botThreads || {}; S.threads = d.botThreads; return (S.threads[id] = S.threads[id] || []); };
  const pending = () => S.bots.filter(b => b.attention);
  /* the one state map (HX.ui.botState); a transient reaction (listening, thinking, speaking) overlays it */
  const stateOf = (b, transient) => UI().botState(transient && !b.attention ? { ...b, state: transient } : b);

  function announceAttention() {
    const p = pending();
    emit('hx:attention', { source: 'bots', tab: 'bots', count: p.length, ids: p.map(b => b.id) });
  }
  function setBotState(id, state, extra) {
    const b = bot(id); if (!b) return;
    b.state = state;
    if (extra && 'activity' in extra) b.activity = extra.activity;
    updateRow(id);
    if (id === S.sel) refreshPresence();
    emit('hx:bot-state', { id, state, attention: b.attention || null, source: 'bots' });
  }

  /* ================================================================== ORBS
     Drawn by the library (HX.ui.orb: one wrapper, the state map, light eyes on dark bodies). Owner, v7: reduced
     motion reduces and never freezes; HX.ui.liven / HX.ui.glance keep orbs over 16px live, lower the jelly and
     give small glances under reduced motion. Every live orb answers: click pokes (orb2 escalates on repeats),
     hover looks at the pointer and listens, double-click plays an emote. */
  function liven(o, size) {
    if (!o) return o;
    UI().liven(o, { size });   /* the library's rule: live above 16px, lowered jelly and small glances under reduced motion */
    o.dataset.base = o.getAttribute('reaction') || 'idle';
    play(o);
    return o;
  }
  /* an orb wrapper from the library, alive */
  function orbEl(b, size, opts) {
    const w = UI().orb(b, Object.assign({ size }, opts || {}));
    liven(w.querySelector('orb-avatar'), size);
    return w;
  }
  const orbHTML = (b, size, opts) => UI().html.orb(b, Object.assign({ size }, opts || {}));
  const livenIn = root => { for (const o of root.querySelectorAll('orb-avatar:not(.is-live)')) liven(o, +o.getAttribute('size') || 20); return root; };
  /* a hovered orb keeps listening and takes the new state when the pointer leaves */
  function setReact(o, r) {
    if (!o) return;
    o.dataset.base = r;
    if (!o._hover && o.getAttribute('reaction') !== r) o.setAttribute('reaction', r);
  }
  const EMOTES = ['curious', 'winkswap', 'doubletake', 'shapeshift', 'calibrate'];
  const EMOTES_CALM = ['curious', 'winkswap', 'slowblink', 'calibrate'];
  function play(o) {
    if (o.classList.contains('is-live')) return;
    o.classList.add('is-live');
    o.setAttribute('aria-hidden', 'true');
    o.addEventListener('click', () => oc(o, 'poke', reduced() ? .5 : .9));
    o.addEventListener('dblclick', e => { e.preventDefault(); const l = reduced() ? EMOTES_CALM : EMOTES; oc(o, 'emote', l[Math.floor(Math.random() * l.length)]); });
    o.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch') return;
      o._hover = true;
      const base = o.dataset.base || 'idle';
      if (base === 'idle' || base === 'happy' || base === 'done' || base === 'sleeping') { if (base === 'sleeping') oc(o, 'wakeUp'); o.setAttribute('reaction', 'listening'); }
      oc(o, 'lookAt', e.clientX, e.clientY);
    });
    o.addEventListener('pointermove', e => { if (o._hover) oc(o, 'lookAt', e.clientX, e.clientY); }, { passive: true });
    o.addEventListener('pointerleave', () => {
      o._hover = false;
      if (o.getAttribute('reaction') !== (o.dataset.base || 'idle')) o.setAttribute('reaction', o.dataset.base || 'idle');
      oc(o, 'lookAt');
    });
  }
  /* the orbs you look at (header, preview, settings) sit in a library orb button: Enter or Space pokes, quietly */
  function orbButton(b, size, label, opts) {
    const w = orbEl(b, size, opts);
    const btn = el('button', { class: 'ui-orb-btn bt-orb-btn', type: 'button', 'aria-label': label }, w);
    const o = w.querySelector('orb-avatar');
    btn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); oc(o, 'poke', reduced() ? .5 : .9); } });
    btn.addEventListener('focus', () => { if (!o._hover && (o.dataset.base || 'idle') === 'idle') o.setAttribute('reaction', 'listening'); });
    btn.addEventListener('blur', () => { if (!o._hover) o.setAttribute('reaction', o.dataset.base || 'idle'); });
    btn.orb = o;
    return btn;
  }
  /* the one orb you look at (the room's presence, the new-bot preview) is the library's lead orb: it always gets a
     small step under reduced motion (owner: the presence orb is always alive) */
  function leadOrb() {
    const U = UI(); if (!U || !U.glance || typeof U.glance.lead !== 'function' || leadOrb.done) return;
    leadOrb.done = true;
    U.glance.lead(() => S.view === 'new' ? S.newPane && S.newPane.querySelector('.bt-stage orb-avatar') : S.presence, { skip: o => o._hover || o._held });
  }
  /* orb2 resolves var() colours once per attribute change: re-read them when the theme changes */
  function repaintOrbs() {
    for (const root of [S.viewRoot, S.listWrap]) {
      if (!root) continue;
      for (const o of root.querySelectorAll('orb-avatar')) for (const a of ['color', 'eye-color']) { const v = o.getAttribute(a); if (v) o.setAttribute(a, v); }
    }
  }
  /* Gentle looking, for the presence orb and the new-bot preview. Every target (the pointer, a control in use, a new
     message) is pulled toward the orb by k and clamped to a small turn (about 20 degrees): orb2 aims its face at
     exactly the point it is given, and a full-angle look at a control 170px below a 128px preview pushed the face
     past the body's rim, so the eyes clipped and the silhouette tipped on every tile the pointer crossed; how far
     depends on where the shape puts its face (diamond, star, triangle, drop worst). One pointermove listener serves
     every follower; a follower whose orb is gone is skipped and can be disposed. */
  const FOLLOWERS = new Set();
  let followPt = null, followRaf = 0;
  addEventListener('pointermove', e => {
    followPt = { x: e.clientX, y: e.clientY };
    if (!followRaf) followRaf = requestAnimationFrame(() => { followRaf = 0; for (const f of FOLLOWERS) f.track(); });
  }, { passive: true });
  function gentleFollow(getOrb, k) {
    let rest = 0, held = false, holdT = 0;
    const aim = (o, px, py) => {
      const r = o.getBoundingClientRect(); if (!r.width) return;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let vx = (px - cx) * k, vy = (py - cy) * k;
      const max = 0.3 * Math.max(250, r.width * 1.65), len = Math.hypot(vx, vy);
      if (len > max) { vx *= max / len; vy *= max / len; }
      oc(o, 'lookAt', cx + vx, cy + vy);
    };
    const f = {
      track() {
        const o = getOrb(); if (!o || !o.isConnected || held || o._hover || o._faceOn || !followPt) return;
        aim(o, followPt.x, followPt.y);
        clearTimeout(rest); rest = setTimeout(() => { const q = getOrb(); if (q && !held && !q._faceOn) oc(q, 'lookAt'); }, 1600);
      },
      hold(px, py) { const o = getOrb(); if (!o || o._faceOn) return; held = true; o._held = true; clearTimeout(rest); aim(o, px, py); },
      release() { held = false; const o = getOrb(); if (o) o._held = false; if (o && !o._faceOn) oc(o, 'lookAt'); },
      glance(px, py, ms) { const o = getOrb(); if (!o || held || o._faceOn) return; o._held = true; aim(o, px, py); clearTimeout(rest); rest = setTimeout(() => { o._held = false; oc(o, 'lookAt'); }, ms || 1100); },
      /* face the viewer while the body changes, so the outline blends face-on and the eyes stay inside it */
      faceOn(ms) {
        const o = getOrb(); if (!o) return;
        o._faceOn = true; clearTimeout(holdT); clearTimeout(rest);
        const r = o.getBoundingClientRect(); oc(o, 'lookAt', r.left + r.width / 2, r.top + r.height / 2);
        holdT = setTimeout(() => { o._faceOn = false; oc(o, 'lookAt'); }, ms || 520);
      },
      dispose() { FOLLOWERS.delete(f); clearTimeout(rest); clearTimeout(holdT); }
    };
    FOLLOWERS.add(f);
    return f;
  }

  /* ================================================================== SIDEBAR LIST (KEYMAP §4)
     HX.ui.row in a [data-ui="rows"] list (↑ ↓, Home, End from the library; j k and Esc here). Enter or a click opens
     the bot and focus stays in the list. A draft row sits on top, current, while a bot is being made. */
  const railOn = () => { const H = hx(); return !!(H && H.state && H.state.left === 'rail'); };
  function mountList(root) {
    initModel();
    if (S.listWrap && S.listWrap.parentNode) S.listWrap.remove();
    S.listRoot = root; S.rows.clear(); S.draftRow = null;
    if (root) root.dataset.rail = 'ok';
    const wrap = el('nav', { class: 'bt-list', 'aria-label': 'Bots' });
    const ul = el('ul', { class: 'ui-rows bt-rows', 'data-ui': 'rows' });
    for (const b of S.bots) ul.append(makeRow(b));
    wrap.append(ul);
    (root || document.body).append(wrap);
    UI().hydrate(ul);
    ul.addEventListener('keydown', listKeys);
    ul.addEventListener('ui:select', e => { const id = e.detail && e.detail.value; if (id === '__draft') { e.preventDefault(); const n = S.newPane && S.newPane.querySelector('.bt-name'); if (n) n.focus(); return; } if (id && bot(id)) { e.preventDefault(); openBot(id); emit('hx:bot-select', { id, from: 'bots-list' }); } });
    S.listWrap = wrap; S.rowsEl = ul;
    watchClips(wrap); checkClips();
    syncListVisibility();
    syncRail();
    markSelected();
  }
  function listKeys(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'j' || k === 'k') {
      e.preventDefault();
      e.target.dispatchEvent(new KeyboardEvent('keydown', { key: k === 'j' ? 'ArrowDown' : 'ArrowUp', bubbles: true }));
    } else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); focusConversation(); }
  }
  function rowHTML(b) {
    const s = UI().botState(b), rail = railOn();
    return UI().html.row({
      title: b.name, sub: b.role, value: b.id,
      end: UI().html.stateWord(b), endTone: s.attention ? 'attention' : null,
      lead: orbHTML(b, rail ? 24 : 20, { flag: true, state: b.state }),
      current: S.view === 'bot' && b.id === S.sel,
      attrs: { 'aria-label': UI().botLabel(b), 'data-tip': rail ? b.name : null, 'data-tip-pos': 'right', 'data-tip-state': rail && s.key !== 'idle' ? s.word : null, 'data-tip-tone': rail && s.attention ? 'attention' : null }
    });
  }
  function makeRow(b) {
    const li = frag(rowHTML(b));
    livenIn(li);
    const btn = li.querySelector('.ui-row');
    btn.addEventListener('pointerenter', () => { if (!reduced()) oc(btn.querySelector('orb-avatar'), 'blink'); });
    S.rows.set(b.id, { li, btn });
    checkClips();
    return li;
  }
  /* rows are re-rendered from the library on change; the live orb is carried over so it never restarts */
  function updateRow(id) {
    const b = bot(id), r = S.rows.get(id); if (!b || !r) return;
    const oldOrb = r.li.querySelector('orb-avatar');
    const focused = r.li.contains(document.activeElement);
    const li = frag(rowHTML(b));
    const newWrap = li.querySelector('.ui-orb'), oldWrap = r.li.querySelector('.ui-orb');
    if (oldOrb && newWrap) {
      const flag = newWrap.querySelector('.ui-dot--flag');
      oldWrap.replaceChildren(oldOrb); if (flag) oldWrap.append(flag);
      oldWrap.setAttribute('style', newWrap.getAttribute('style'));
      newWrap.replaceWith(oldWrap);
      setReact(oldOrb, UI().botState(b).reaction);
      const size = newWrap.querySelector('orb-avatar').getAttribute('size'); if (oldOrb.getAttribute('size') !== size) oldOrb.setAttribute('size', size);
    } else livenIn(li);
    const btn = li.querySelector('.ui-row');
    btn.tabIndex = r.btn.tabIndex;
    btn.addEventListener('pointerenter', () => { if (!reduced()) oc(btn.querySelector('orb-avatar'), 'blink'); });
    r.li.replaceWith(li);
    S.rows.set(id, { li, btn });
    checkClips();
    if (focused) btn.focus({ preventScroll: true });
  }
  function showDraftRow(on) {
    if (!S.rowsEl) return;
    if (!on) { if (S.draftRow) { S.draftRow.li.remove(); S.draftRow = null; syncRoving(); } return; }
    const d = S.draft || { color: DRAFT_COLOR, shape: 'circle', eyes: 'pill', name: '' };
    if (!S.draftRow) {
      const li = frag(UI().html.row({ title: 'New bot', sub: 'Draft', value: '__draft', current: true, class: 'bt-row--draft', lead: orbHTML({ ...d, name: 'New bot' }, railOn() ? 24 : 20), attrs: { 'data-tip-pos': 'right' } }));
      livenIn(li);
      S.rowsEl.prepend(li);
      S.draftRow = { li, o: li.querySelector('orb-avatar'), name: li.querySelector('.ui-row__title'), btn: li.querySelector('.ui-row') };
    }
    paintDraftRow(); syncRoving();
  }
  function paintDraftRow() {
    const r = S.draftRow, d = S.draft; if (!r || !d) return;
    paintOrb(r.o, d);
    const n = d.name.trim() || 'New bot';
    r.name.textContent = n;
    r.btn.setAttribute('aria-label', n + ', draft');
    if (railOn()) { r.btn.setAttribute('data-tip', n); r.btn.removeAttribute('data-tip-auto'); } else { r.btn.removeAttribute('data-tip'); r.btn.removeAttribute('data-tip-auto'); checkClips(); }
  }
  function markSelected() {
    for (const [id, r] of S.rows) {
      const on = S.view === 'bot' && id === S.sel;
      if (on) r.btn.setAttribute('aria-current', 'true'); else r.btn.removeAttribute('aria-current');
    }
    showDraftRow(S.view === 'new');
    syncRoving();
  }
  /* one tab stop per list: the current row */
  function syncRoving() {
    if (!S.rowsEl) return;
    const rows = [...S.rowsEl.querySelectorAll('.ui-row')];
    const cur = rows.find(r => r.getAttribute('aria-current')) || rows[0];
    /* KEYMAP §3: the list region's default target is the current row */
    rows.forEach(r => { if (r === cur) r.setAttribute('data-hx-focus', 'list'); else r.removeAttribute('data-hx-focus'); });
    if (rows.some(r => r === document.activeElement)) return;
    rows.forEach(r => { r.tabIndex = r === cur ? 0 : -1; });
  }
  function syncListVisibility() {
    const H = hx(); if (!S.listWrap || !S.listRoot || S.listRoot.id === 'hx-list-bots') return;
    S.listWrap.hidden = !!(H && H.state && H.state.tab && H.state.tab !== 'bots');
  }
  /* rail: orbs 24 centred in 40px rows, names and states in tooltips */
  let lastRail = null;
  function syncRail() {
    if (!S.listWrap) return;
    const rail = railOn();
    S.listWrap.classList.toggle('is-rail', rail);
    if (rail === lastRail) return;
    lastRail = rail;
    for (const id of S.rows.keys()) updateRow(id);
    if (S.draftRow) { S.draftRow.o.setAttribute('size', rail ? '24' : '20'); S.draftRow.o.closest('.ui-orb').style.setProperty('--o', rail ? 24 : 20); paintDraftRow(); }
  }

  /* ================================================================== VIEW */
  function mountView(root) {
    initModel();
    S.viewRoot = root;
    root.textContent = '';
    root.classList.add('bt-view');
    const room = el('section', { class: 'bt-room', 'aria-label': 'Bot conversation' });
    const nb = el('section', { class: 'bt-new', 'aria-label': 'New bot', hidden: true });
    const sheet = el('aside', { class: 'ui-panel bt-sheet', 'data-hx-panel': '', 'aria-label': 'Bot settings', hidden: true });
    root.append(room, nb, sheet);
    S.room = room; S.newPane = nb; S.sheet = sheet;
    watchClips(root);
    buildRoom();
    if (S.view === 'new') openNew(); else openBot(S.sel);
    /* the new-bot view is ours to close: Esc leaves it for the bot you came from */
    nb.addEventListener('keydown', e => { if (e.key === 'Escape' && S.bots.length && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); openBot(S.sel); focusConversation(); } });
  }

  /* ------------------------------------------------------------------ room */
  function buildRoom() {
    const scroll = el('div', { class: 'bt-scroll' });
    const col = el('div', { class: 'bt-col' });
    const presence = el('header', { class: 'bt-presence' });
    const log = el('div', { class: 'bt-log', role: 'log', 'aria-label': 'Messages' });
    col.append(presence, log);
    scroll.append(col);
    const zone = el('div', { class: 'bt-composer-zone' });
    S.room.append(scroll, zone);
    S.scroll = scroll; S.presenceEl = presence; S.log = log; S.zone = zone;
    log.addEventListener('keydown', turnKeys);
    log.addEventListener('focusin', e => { const t = e.target.closest('[data-hx-turn]'); if (t) rove(t); });
    buildComposer(zone);
    const measure = () => S.viewRoot && S.viewRoot.style.setProperty('--bt-composer-h', zone.offsetHeight + 'px');
    if (window.ResizeObserver) new ResizeObserver(measure).observe(zone);
    measure();
    S.follow = gentleFollow(() => S.presence, .45);
  }

  function openBot(id) {
    initModel();
    const b = bot(id) || S.bots[0]; if (!b) return;
    S.sel = b.id; S.view = 'bot'; S.transient = null;
    const H = hx(); if (H && H.state && H.state.tab !== 'bots' && H.setState) H.setState({ tab: 'bots' });
    markSelected();
    if (!S.room) return;
    S.room.hidden = false; S.newPane.hidden = true;
    renderPresence(b);
    renderThread(b);
    paintComposer(b);
    if (S.composer) S.composer.setRunning(S.runs.has(b.id));
    emit('hx:title', { tab: 'bots', title: b.name });
    if (S.sheetOpen && S.sheetFor !== b.id) openSettings(b.id, null, { keepFocus: true });
  }

  /* header: orb 40 in the margin (lively, a quiet button), name 16/600, role 12 quiet, state; settings on the right */
  function renderPresence(b) {
    const p = S.presenceEl; p.textContent = '';
    const ob = orbButton(b, 40, b.name, { motion: 'lively', state: b.state });
    S.presence = ob.orb;
    const name = el('h1', { class: 'bt-p-name', text: b.name });
    const line = el('p', { class: 'bt-p-line' });
    const acts = el('div', { class: 'bt-p-actions' });
    p.append(el('div', { class: 'bt-p-orb' }, ob), el('div', { class: 'bt-p-text' }, [name, line]), acts);
    S.pLine = line; S.pActs = acts;
    acts.append(UI().iconButton({ icon: 'gear', label: 'Bot settings', keys: 'mod+I', action: 'settings' }));
    acts.firstElementChild.addEventListener('click', () => toggleSettings());
    refreshPresence();
    checkClips();
  }
  function refreshPresence() {
    const b = bot(S.sel); if (!b || !S.pLine) return;
    const s = stateOf(b, S.transient);
    if (S.presence) setReact(S.presence, s.reaction);
    const line = S.pLine; line.textContent = '';
    line.append(el('span', { class: 'bt-p-role', text: b.role }));
    if (s.key !== 'idle') {
      const st = el('span', { class: 'bt-p-state' });
      if (s.attention) st.insertAdjacentHTML('beforeend', UI().html.dot('attention'));
      else if (s.busy) st.insertAdjacentHTML('beforeend', UI().html.dot('run'));
      st.insertAdjacentHTML('beforeend', '<span class="ui-state"' + (s.tone !== 'none' ? ' data-tone="' + s.tone + '"' : '') + '>' + esc(s.busy && b.activity && !S.transient ? b.activity : s.word) + '</span>');
      line.append(st);
    }
    if (b.cfg.cron) line.append(el('button', { class: 'bt-p-sched ui-mono', type: 'button', 'data-tip': 'Schedule', onclick: () => openSettings(b.id, 'schedule') },
      [el('span', { html: UI().icon('clock') }), el('span', { text: cronValid(b.cfg.cron) ? cronWords(b.cfg.cron) : 'schedule incomplete' })]));
    paintToolbar(b);
  }

  /* ------------------------------------------------------------------ thread (KEYMAP §3, §5)
     Every entry is a turn: HX.ui.entry with data-hx-turn and a roving tabindex. Consecutive messages from one
     speaker share an entry. */
  function renderThread(b) {
    const log = S.log; log.textContent = '';
    const msgs = thread(b.id);
    if (!msgs.length) {
      const e = UI().empty({ title: 'Nothing here yet', text: 'Ask ' + b.name + ' something, or give it a schedule so it works on its own.' });
      const ideas = el('div', { class: 'bt-ideas' }, ideasFor(b).map(t => { const btn = UI().button({ label: t }); btn.addEventListener('click', () => setDraft(t)); return btn; }));
      e.append(ideas); e.classList.add('bt-empty');
      log.append(e);
    } else {
      let prev = null, entry = null;
      for (const m of msgs) { entry = renderMsg(b, m, prev, entry); prev = m; }
    }
    syncTurns();
    requestAnimationFrame(() => { S.scroll.scrollTop = S.scroll.scrollHeight; });
  }
  function ideasFor(b) {
    const r = (b.role || '').toLowerCase();
    if (r.includes('review')) return ['Review the open PRs on billing-api', 'What changed since yesterday?'];
    if (r.includes('night')) return ['Prep tomorrow’s digest', 'What did you do last night?'];
    if (r.includes('inbox')) return ['Triage today’s email', 'Draft a reply to the Stripe thread'];
    if (r.includes('migration')) return ['Plan the cents migration', 'Dry run 0042 on a copy'];
    if (r.includes('test')) return ['Find flaky tests from this week', 'Rerun invoice.test.ts 20 times'];
    if (r.includes('release') || r.includes('changelog')) return ['Draft notes for 2.4', 'What shipped this week?'];
    return ['What are you working on?', 'Summarise yesterday'];
  }
  const paras = t => '<div class="ui-prose">' + String(t || '').split(/\n{2,}/).map(p => '<p>' + UI().html.inline(p) + '</p>').join('') + '</div>';
  function msgContent(b, m) {
    if (m.card) return renderCard(b, m);
    if (m.who === 'you') return frag(UI().html.request(m.text));
    return frag(paras(m.text));
  }
  function renderMsg(b, m, prev, prevEntry) {
    const node = msgContent(b, m);
    m._el = node;
    if (prev && prev.who === m.who && prevEntry && prevEntry.isConnected) {
      prevEntry.querySelector('.ui-entry__body').append(node);
      prevEntry._msgs.push(m);
      return prevEntry;
    }
    const you = m.who === 'you', who = you ? null : (bot(m.who) || b);
    const entry = frag(UI().html.entry({
      kind: you ? 'user' : 'bot',
      who: you ? esc('You') : orbHTML(who, 20, { state: 'idle' }) + '<span class="bt-who-name">' + esc(who.name) + '</span>',
      callno: m.t ? [m.t] : [],
      label: (you ? 'You' : who.name) + (m.t ? ', ' + m.t : '')
    }));
    entry.querySelector('.ui-entry__body').append(node);
    entry.setAttribute('data-hx-turn', ''); entry.tabIndex = -1;
    entry._msgs = [m]; entry._who = m.who;
    livenIn(entry);
    S.log.append(entry);
    checkClips();
    return entry;
  }
  function appendMsg(id, m) {
    const list = thread(id), prev = list[list.length - 1];
    list.push(m);
    if (id !== S.sel || S.view !== 'bot') return null;
    const empty = S.log.querySelector('.bt-empty'); if (empty) empty.remove();
    const lastEntry = S.log.lastElementChild && S.log.lastElementChild.matches('[data-hx-turn]') ? S.log.lastElementChild : null;
    renderMsg(bot(id), m, prev, lastEntry);
    syncTurns();
    const node = m._el;
    if (node && S.follow && !S.typing) requestAnimationFrame(() => { const r = node.getBoundingClientRect(); S.follow.glance(r.left + Math.min(r.width, 160) / 2, r.top + 12, 1200); });
    if (!reduced() && node) node.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
    S.scroll.scrollTo({ top: S.scroll.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
    return node;
  }
  /* roving tabindex across turns: the focused (or latest) turn is the one tab stop */
  const turns = () => S.log ? [...S.log.querySelectorAll('[data-hx-turn]')] : [];
  function syncTurns() {
    const t = turns(); if (!t.length) return;
    if (t.some(x => x === document.activeElement)) return;
    t.forEach((x, i) => { x.tabIndex = i === t.length - 1 ? 0 : -1; });
  }
  function rove(t) { turns().forEach(x => { x.tabIndex = x === t ? 0 : -1; }); }
  function focusTurn(t) { if (!t) return; rove(t); t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
  function focusConversation() {
    const t = turns();
    if (t.length) focusTurn(t[t.length - 1]);
    else { const b = S.presenceEl && S.presenceEl.querySelector('.bt-orb-btn'); if (b) b.focus(); }
  }
  function turnText(t) {
    return (t._msgs || []).map(m => m.card ? '> ' + ((m.data && m.data.title) || m.card) : m.text).join('\n\n');
  }
  function turnKeys(e) {
    const t = e.target.closest('[data-hx-turn]');
    if (!t || e.target !== t || e.altKey || e.ctrlKey || e.metaKey) return;
    const list = turns(), i = list.indexOf(t), k = e.key;
    const go = n => { e.preventDefault(); focusTurn(list[Math.max(0, Math.min(list.length - 1, n))]); };
    if (k === 'ArrowDown' || k === 'j') return go(i + 1);
    if (k === 'ArrowUp' || k === 'k') return go(i - 1);
    if (k === 'Home') return go(0);
    if (k === 'End' || (k === 'G' && e.shiftKey)) return go(list.length - 1);
    if (k === 'c') {
      e.preventDefault();
      const who = t._who === 'you' ? 'You' : t._who, md = '**' + who + '**\n\n' + turnText(t);
      try { navigator.clipboard.writeText(md).catch(() => {}); } catch (err) { /* clipboard blocked */ }
      toast('Copied');
      return;
    }
    if (k === 'e' && t._who === 'you') {
      e.preventDefault();
      const last = t._msgs[t._msgs.length - 1];
      if (S.composer) { S.composer.setValue(last.text); S.composer.focus(); }
    }
  }

  /* ------------------------------------------------------------------ approval: the card layer only */
  function renderCard(b, m) {
    if (m.resolved) return resolvedLine(m);
    const card = UI().card(m.card, { ...m.data, from: b.id, source: 'bots', bot: b.id }, { size: 'inline' });
    card.addEventListener('hx:card-action', e => { const a = det(e).action; if (a) resolveCard(b.id, m, a); });
    return el('div', { class: 'bt-cardslot' }, card);
  }
  function resolvedLine(m) {
    const ok = m.resolved === 'approved';
    return el('div', { class: 'bt-resolved' }, [
      el('span', { class: 'bt-resolved-ico' + (ok ? ' is-ok' : ''), html: UI().icon(ok ? 'check' : 'close') }),
      el('span', { text: (ok ? 'You approved: ' : 'You denied: ') + ((m.data && m.data.title) || 'the request') }),
      el('time', { class: 'ui-mono', text: m.resolvedAt })
    ]);
  }
  /* an approval decided here or in the dock: one outcome for both. Here, the dock hears hx:approval {id, bot,
     decision, source:'bots'}; from the dock (opts.remote), the card in this tab is moved to the same state. */
  function resolveCard(id, m, action, opts) {
    if (m.resolved) return;
    const a = String(action).toLowerCase();
    const ok = /approv|allow|yes|confirm/.test(a);
    if (!ok && !/deny|reject|no|cancel/.test(a)) return;
    m.resolved = ok ? 'approved' : 'denied'; m.resolvedAt = now();
    const b = bot(id); b.attention = null;
    const card = m._el && m._el.querySelector && m._el.querySelector('hx-card');
    if (opts && opts.remote) { if (card && typeof card.update === 'function' && card.state !== m.resolved) card.update({ state: m.resolved }); }
    else emit('hx:approval', { id: (m.data && m.data.id) || null, bot: id, decision: m.resolved, source: 'bots' });
    announceAttention();
    if (ok) {
      setBotState(id, 'working', { activity: 'deploying billing/cents to staging' });
      later(() => streamMsg(id, 'Deployed to staging. The dry run matched all 200 invoices to the cent. Should I schedule production for tonight?', () => {
        setBotState(id, 'happy', { activity: '' });
        later(() => { if (bot(id).state === 'happy') setBotState(id, 'idle'); }, 5000);
      }), 3200);
    } else {
      setBotState(id, 'idle', { activity: '' });
      later(() => streamMsg(id, 'Holding. Nothing was deployed; the branch stays on billing/cents until you say otherwise.'), 700);
    }
  }

  /* ------------------------------------------------------------------ composer: the library's (KEYMAP §7)
     The bot's chips go in its chips slot: Governed (alt+G toggles governance), and its channels (opens settings). */
  function buildComposer(host) {
    /* the library's composer talks (MIGRATION §8): the mic shows the open bot's orb listening, and while you talk the
       presence orb (and every .ui-orb[data-bot] of that bot) takes orb2's listening reaction */
    const c = UI().composer({ placeholder: 'Message', label: 'Message', attach: true, spend: { spent: '$0.00', cap: '$0.60' }, bot: bot(S.sel) || null, orbs: () => [S.presence] });
    c.classList.add('bt-composer');
    host.append(c);
    const input = c.input;
    input.setAttribute('data-hx-focus', 'composer');
    c.addEventListener('ui:send', e => { send(e.detail.text); });
    c.addEventListener('ui:stop', () => stopRun());
    input.addEventListener('input', () => typingChanged(c.value));
    input.addEventListener('focus', () => typingChanged(c.value));
    input.addEventListener('blur', () => { S.typing = false; settleTransient(); });
    input.addEventListener('keydown', e => {
      const code = e.code;
      /* ↑ in an empty composer: edit your last message */
      if (e.key === 'ArrowUp' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !c.value.trim()) {
        const last = [...thread(S.sel)].reverse().find(m => m.who === 'you');
        if (last) { e.preventDefault(); c.setValue(last.text); c.focus(); }
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (code === 'KeyG') { e.preventDefault(); const b = bot(S.sel); if (b) { b.cfg.gov = b.cfg.gov === 'governed' ? 'ungoverned' : 'governed'; refreshPresence(); if (S.sheetOpen) openSettings(b.id, null, { keepFocus: true }); } return; }
        if (code === 'KeyM') { e.preventDefault(); openModelMenu(); return; }
        if (code === 'KeyA') { e.preventDefault(); if (c.attach) c.attach.click(); return; }
      }
    });
    S.composer = c;
  }
  function openModelMenu() {
    const b = bot(S.sel), c = S.composer; if (!b || !c) return;
    const anchor = c.chips.querySelector('[data-value="model"]') || c.input;
    const items = [{ label: 'Governed', desc: 'Starts cheap, climbs the ladder', value: 'governed', checked: b.cfg.gov === 'governed' }]
      .concat(MODELS.map(m => ({ label: m, mono: true, value: m, model: m, checked: b.cfg.gov !== 'governed' && b.cfg.model === m })));   /* brand marks in the selection menu (owner) */
    UI().menu.open(anchor, items, {
      label: 'Model', place: 'above',
      onClose: () => setTimeout(() => { const f = document.activeElement; if (!f || f === document.body || !f.isConnected || f.closest('.ui-menu')) c.focus(); }, 0),
      onSelect: v => {
        if (v === 'governed') b.cfg.gov = 'governed'; else { b.cfg.gov = 'ungoverned'; b.cfg.model = v; }
        refreshPresence(); if (S.sheetOpen) openSettings(b.id, null, { keepFocus: true });
        setTimeout(() => c.focus(), 0);
      }
    });
  }
  function setDraft(t) { const c = S.composer; if (!c) return; c.setValue(t); c.focus(); typingChanged(t); }
  function paintComposer(b) {
    const c = S.composer; if (!c) return;
    if (typeof c.setBot === 'function' && c._bot !== b.id) { c.setBot(b); c._bot = b.id; }
    if (!c.listening) c.input.setAttribute('data-placeholder', 'Message ' + b.name);
    c.input.setAttribute('aria-label', 'Message ' + b.name);
    paintToolbar(b);
  }
  function paintToolbar(b) {
    const c = S.composer; if (!c) return;
    const gov = b.cfg.gov === 'governed';
    const chans = CHANNELS.filter(([k]) => b.cfg.channels[k] && k !== 'app').map(([, n]) => n);
    const U = UI();
    /* rebuild the chips only when what they say changes (an open menu may be anchored to one) */
    const sig = [b.id, gov, b.cfg.model, chans.join(',')].join('|');
    if (gov) c.setSpend('$' + b.spent, '$' + b.cfg.cap);
    { const capEl = c.querySelector('.ui-capacity'); if (capEl) capEl.hidden = !gov; }
    if (c._chipSig === sig) return;
    c._chipSig = sig;
    /* Governed is a toggle (off reads struck through); an ungoverned bot also shows its one model, which opens the picker */
    const gchip = U.chip({ label: 'Governed', icon: 'ladder', pressed: gov, value: gov ? 'model' : 'governed', tip: 'Governance', attrs: { 'data-kbd': 'alt+G' } });
    gchip.addEventListener('ui:change', e => { e.preventDefault(); b.cfg.gov = gov ? 'ungoverned' : 'governed'; refreshPresence(); if (S.sheetOpen) openSettings(b.id, null, { keepFocus: true }); });
    const kids = [gchip];
    if (!gov) { const mc = U.chip({ model: b.cfg.model, haspopup: 'menu', value: 'model', tip: 'Model', attrs: { 'data-kbd': 'alt+M' } }); mc.addEventListener('click', openModelMenu); kids.push(mc); }
    if (chans.length) { const ch = U.chip({ label: 'Also on ' + chans.join(', '), tip: 'Channels' }); ch.addEventListener('click', () => openSettings(b.id, 'channels')); kids.push(ch); }
    c.chips.replaceChildren(...kids);
  }
  function typingChanged(text) {
    const has = !!(text && String(text).trim());
    S.typing = has;
    if (has) {
      if (S.transient !== 'listening' && !S.runs.has(S.sel)) { S.transient = 'listening'; refreshPresence(); }
      const inp = S.composer && S.composer.input;
      if (inp && S.follow) {
        let r = inp.getBoundingClientRect();
        const sel = getSelection(); if (sel.rangeCount && inp.contains(sel.anchorNode)) { const rr = sel.getRangeAt(0).getBoundingClientRect(); if (rr.width || rr.left) r = { left: rr.left, top: rr.top, width: 0, height: rr.height || r.height }; }
        S.follow.hold(r.left + r.width / 2, r.top + r.height / 2);
      }
    } else settleTransient();
  }
  function settleTransient() {
    if (S.transient === 'listening') { S.transient = null; refreshPresence(); }
    if (S.follow) S.follow.release();
  }

  /* a run: the bot thinking, replying and working on what you asked. One run per bot, so bots keep working while you
     switch; mod+. or Esc in the composer stops the open bot's run. A message can come from this tab or from the dock
     (hx:bot-message): either way it is in HX.data.botThreads and the reply goes to the same thread. */
  function send(text) {
    const b = bot(S.sel); if (!b) return;
    S.typing = false; if (S.follow) S.follow.release();
    const m = { who: 'you', t: now(), text, via: 'bots' };
    appendMsg(b.id, m);
    emit('hx:bot-message', { id: b.id, message: { who: m.who, t: m.t, text: m.text, via: 'bots' }, source: 'bots' });
    respond(b.id, text);
  }
  function respond(id) {
    const b = bot(id); if (!b) return;
    stopRun(true, id);
    const run = { id, timers: [] };
    S.runs.set(id, run);
    const alive = () => S.runs.get(id) === run;
    const at = (fn, ms) => run.timers.push(later(() => { if (alive()) fn(); }, ms));
    if (id === S.sel) { S.transient = 'thinking'; refreshPresence(); if (S.composer) S.composer.setRunning(true); }
    else setBotState(id, 'thinking');
    const pair = REPLY[id] || ['On it. I’ll keep this inside ' + (b.cfg.workspace === 'sandbox' ? 'my sandbox' : 'my worktree') + ' and report back here.', 'Done. Notes are above; nothing needed your approval.'];
    at(() => {
      if (id === S.sel) S.transient = null;
      streamMsg(id, pair[0], () => {
        if (!alive()) return;
        setBotState(id, 'working', { activity: '' });
        at(() => streamMsg(id, pair[1], () => {
          if (!alive()) return;
          endRun(run);
          setBotState(id, 'happy', { activity: '' });
          later(() => { if (bot(id) && bot(id).state === 'happy') setBotState(id, 'idle'); }, 4200);
        }, run), 4200);
      }, run);
    }, 1300);
  }
  function endRun(run) {
    if (S.runs.get(run.id) !== run) return;
    for (const t of run.timers) clearTimeout(t);
    S.runs.delete(run.id);
    if (run.id === S.sel && S.composer) S.composer.setRunning(false);
  }
  function stopRun(quiet, id) {
    id = id || S.sel;
    const run = S.runs.get(id); if (!run) return false;
    endRun(run);
    if (id === S.sel && S.transient && S.transient !== 'listening') S.transient = null;
    const b = bot(id);
    if (b && BUSY_STATES.has(b.state)) setBotState(id, 'idle', { activity: '' }); else if (id === S.sel) refreshPresence();
    if (!quiet) toast('Stopped ' + (b ? b.name : 'the bot'));
    return true;
  }
  const BUSY_STATES = new Set(['working', 'thinking', 'speaking', 'compute']);
  /* stream a bot message word by word while its orb speaks; when it is whole, tell the dock */
  function streamMsg(id, text, done, run) {
    const m = { who: id, t: now(), text: '' };
    const node = appendMsg(id, m);
    const words = text.split(/(\s+)/);
    let i = 0;
    if (node) S.log.setAttribute('aria-busy', 'true');
    if (id === S.sel) { S.transient = 'speaking'; refreshPresence(); }
    const finish = () => {
      m.text = text; if (node && node.isConnected) node.innerHTML = frag(paras(text)).innerHTML;
      if (node) S.log.removeAttribute('aria-busy');
      if (id === S.sel && S.transient === 'speaking') { S.transient = null; refreshPresence(); }
      emit('hx:bot-message', { id, message: { who: id, t: m.t, text }, source: 'bots' });
    };
    const step = () => {
      if (run && S.runs.get(id) !== run) { finish(); return; }
      if (i >= words.length || reduced()) { finish(); if (done) done(); return; }
      i += 2; m.text = words.slice(0, i).join('');
      if (node && node.isConnected) node.innerHTML = frag(paras(m.text)).innerHTML;
      setTimeout(step, 38);
    };
    step();
  }
  /* a message sent from the dock: it is already in the shared thread; show it here if the bot is open, then reply */
  function onBotMessage(a) {
    const d = det(a); if (d.source === 'bots' || !d.id || !d.message) return;
    const b = bot(d.id); if (!b) return;
    const list = thread(d.id);
    if (!list.includes(d.message)) list.push(d.message);
    if (S.view === 'bot' && S.sel === d.id && S.log) renderThread(b);
    if (d.message.who === 'you') respond(d.id);
  }

  /* ================================================================== NEW BOT (bots' own form; library controls) */
  function openNew(seed) {
    initModel();
    S.view = 'new';
    const H = hx(); if (H && H.state && H.state.tab !== 'bots' && H.setState) H.setState({ tab: 'bots' });
    if (!S.room) { markSelected(); return; }
    closeSettings(true);
    S.room.hidden = true; S.newPane.hidden = false;
    buildNew(seed);
    markSelected();
    emit('hx:title', { tab: 'bots', title: 'New bot' });
  }
  function buildNew(seed) {
    const U = UI();
    const pane = S.newPane; pane.textContent = '';
    const d = S.draft = { name: '', role: '', color: DRAFT_COLOR, shape: 'circle', eyes: 'pill', tab: 'colour', ...(seed || {}) };
    /* calm, not lively: orb2's lively idle swings the head up to about 72 degrees (rim peeks, sky gazes); on a narrow,
       pointy or low-faced body (triangle, drop, star, diamond, tall) that tips the whole silhouette and takes the face
       past its edge, so the eyes vanish and pop back: the owner's "flickers and flashes, depending on the shape". Calm
       glances (about 22 degrees), blinks and eye morphs keep the preview alive; under reduced motion it is the glance lead. */
    const pv = orbButton({ ...d, name: 'Preview' }, 128, 'Preview of the new bot', { motion: 'calm' });
    const preview = pv.orb;
    preview.setAttribute('shadow', '');
    if (S.newFollow) S.newFollow.dispose();
    const follow = S.newFollow = gentleFollow(() => preview, .55);

    const noteId = 'bt-name-note-' + Math.random().toString(36).slice(2, 7);
    const nameIn = el('input', { class: 'bt-name', type: 'text', maxlength: '24', placeholder: 'Name your bot', 'aria-label': 'Name', 'aria-describedby': noteId, 'aria-keyshortcuts': 'Alt+R', autocomplete: 'off', spellcheck: 'false', value: d.name, 'data-hx-focus': 'messages' });
    /* Surprise me: the library's icon button with its dice glyph */
    const dice = U.iconButton({ icon: 'dice', label: 'Surprise me with a name', tip: 'Surprise me', keys: 'alt+R', size: 's' });
    dice.classList.add('bt-dice');
    const note = el('p', { class: 'bt-name-note', id: noteId });
    const TABS = [['colour', 'Colour'], ['shape', 'Shape'], ['eyes', 'Eyes']];
    const rowId = 'bt-pick-' + Math.random().toString(36).slice(2, 7);
    const tabs = U.segmented({ mode: 'tabs', label: 'Appearance', value: d.tab, options: TABS.map(([value, label]) => ({ value, label })), controls: { colour: rowId, shape: rowId, eyes: rowId } });
    const row = el('div', { class: 'bt-pick', role: 'tabpanel', id: rowId });
    const roleField = U.field({ kind: 'textarea', label: 'What it does', placeholder: 'For example: reviews every pull request before I merge', value: d.role, raised: true });
    const roleIn = roleField.querySelector('textarea');
    const go = U.button({ label: 'Create bot', variant: 'primary', disabled: true });
    go.classList.add('bt-go');
    const back = S.bots.length ? U.iconButton({ icon: 'close', label: 'Close new bot', keys: 'esc' }) : null;
    if (back) { back.classList.add('bt-new-close'); back.addEventListener('click', () => { openBot(S.sel); focusConversation(); }); }

    const form = el('div', { class: 'bt-new-form' }, [
      el('div', { class: 'bt-stage' }, pv),
      el('div', { class: 'bt-name-row' }, [nameIn, dice]),
      note,
      el('div', { class: 'bt-appearance' }, [tabs, row]),
      el('div', { class: 'bt-new-field' }, roleField),
      el('div', { class: 'bt-go-row' }, go)
    ]);
    const sugg = data().botSuggestions || [];
    const suggest = sugg.length ? el('section', { class: 'bt-suggest', 'aria-label': 'Suggestions' }, [
      el('h2', { class: 'ui-group__head bt-suggest-h', text: 'Or start from one of these' }),
      el('div', { class: 'bt-suggest-row' }, sugg.map(s => {
        const btn = el('button', { class: 'bt-sugg', type: 'button' }, [orbEl({ shape: s.shape, color: s.color, eyes: 'pill', name: s.name }, 32), el('span', { class: 'bt-sugg-text' }, [el('span', { class: 'bt-sugg-name', text: cap(s.name) }), el('span', { class: 'bt-sugg-desc', text: s.desc })])]);
        btn.addEventListener('click', () => {
          const reshape = s.shape !== d.shape;
          Object.assign(d, { name: s.name.replace(/\s+/g, '-'), role: s.desc, shape: s.shape, color: s.color });
          if (reshape) follow.faceOn(560);
          nameIn.value = d.name; roleIn.value = d.role; roleIn.dispatchEvent(new Event('input')); apply('all'); oc(preview, 'poke', reshape ? .5 : .9, { react: !reshape });
        });
        return btn;
      }))
    ]) : null;
    pane.append(el('div', { class: 'bt-new-scroll' }, [el('div', { class: 'bt-new-col' }, [back, form, suggest])]));

    tabs.addEventListener('ui:change', e => { d.tab = e.detail.value; paintRow(); });
    /* The tiles are built when the tab changes, never on a choice: rebuilding 15 orb canvases (each with its 3D body)
       on every click cost 45-90ms in WebKitGTK, right as the morph started, so its first frames dropped and the
       change read as a jump. A choice now moves the selection; a new colour repaints the tiles in place. */
    function syncRow() {
      const cur = d.tab === 'colour' ? d.color : d.tab === 'shape' ? d.shape : d.eyes;
      for (const b of row.querySelectorAll('.bt-opt')) { const on = b.dataset.val === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    }
    function recolourRow() {
      if (d.tab === 'colour') return;
      for (const o of row.querySelectorAll('.bt-opt orb-avatar')) paintOrbColour(o, d.color);
    }
    function paintRow() {
      row.textContent = ''; row.dataset.kind = d.tab;
      row.setAttribute('aria-label', cap(d.tab));
      const opts = d.tab === 'colour' ? SWATCHES : d.tab === 'shape' ? (window.OrbAvatar && OrbAvatar.bodyShapes ? OrbAvatar.bodyShapes.filter(s => SHAPES.includes(s)) : SHAPES) : EYES;
      const group = el('div', { class: 'bt-opts', role: 'radiogroup', 'aria-label': cap(d.tab) });
      for (const o of opts) {
        const val = d.tab === 'colour' ? o[0] : o;
        const lab = d.tab === 'colour' ? o[1] : cap(o);
        const on = (d.tab === 'colour' ? d.color : d.tab === 'shape' ? d.shape : d.eyes) === val;
        /* the picker tiles are the one place orbs stay still: 28px, many at once, a choice not a creature */
        const inner = d.tab === 'colour'
          ? el('span', { class: 'bt-swatch', style: '--c:' + val })
          : U.orb(d.tab === 'shape' ? { ...d, shape: val, eyes: 'pill', name: lab } : { ...d, shape: 'circle', eyes: val, name: lab }, { size: 28, still: true });
        group.append(el('button', {
          class: 'bt-opt', type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': lab, 'data-tip': lab, 'data-val': val, tabindex: on ? '0' : '-1',
          onclick: () => choose(val)
        }, inner));
      }
      group.addEventListener('keydown', e => {
        const items = [...group.children], i = items.indexOf(document.activeElement);
        if (i < 0) return;
        let j = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
        if (e.key === 'Home') j = 0;
        if (e.key === 'End') j = items.length - 1;
        if (j >= 0) { e.preventDefault(); items[j].focus(); items[j].click(); }
      });
      row.append(group);
    }
    function choose(val) {
      if (d.tab === 'colour') { d.color = val; apply('color'); oc(preview, 'blink'); }
      if (d.tab === 'shape' && val !== d.shape) { follow.faceOn(560); d.shape = val; apply('shape'); oc(preview, 'poke', .5, { react: false }); }
      if (d.tab === 'eyes') { d.eyes = val; apply('eyes'); }
      syncRow();
      const sel = row.querySelector('[aria-checked="true"]'); if (sel && sel !== document.activeElement) sel.focus({ preventScroll: true });
    }
    function apply(what) {
      if (what === 'color' || what === 'all') paintOrb(preview, d);
      if (what === 'shape' || what === 'all') preview.setAttribute('shape', d.shape);
      if (what === 'eyes' || what === 'all') { if (typeof preview.morphEyes === 'function') preview.morphEyes(d.eyes); else preview.setAttribute('eye-shape', d.eyes); }
      if (what === 'color' || what === 'all') recolourRow();
      if (what === 'all') syncRow();
      paintGo(); paintDraftRow();
    }
    /* the caption under the preview is the button: it names the bot as you type or roll (an empty name gets one
       from the list on create, so the button is never disabled for want of a name) */
    const goLabel = el('span', { class: 'bt-go-label' }); go.querySelector('span').replaceChildren(goLabel);
    function paintGo() {
      const n = d.name.trim();
      go.disabled = false;
      goLabel.textContent = n ? 'Create ' + n : 'Create bot';
      if (n) go.setAttribute('data-tip', 'Create ' + n); else go.removeAttribute('data-tip');
      pv.setAttribute('aria-label', n ? 'Preview of ' + n : 'Preview of the new bot');
      paintNote();
      checkClips();
    }
    /* what the name will turn into: a name in use gets a number on create; a rolled name past the end of the list
       has one already (say why) */
    let rolledOut = false;
    function paintNote() {
      const n = d.name.trim();
      let t = '';
      if (n && botNames.taken(n)) { let k = 2; while (bot(idBase(n) + '-' + k)) k++; t = 'There is already a bot called ' + n + '. This one will be ' + idBase(n) + '-' + k + '.'; }
      else if (rolledOut && n) t = 'Every name in the list is taken, so this one has a number.';
      if (note.textContent !== t) note.textContent = t;
    }
    function roll() {
      const name = botNames.pick({ avoid: d.name });
      rolledOut = botNames.exhausted();
      d.name = name; nameIn.value = name;
      paintGo(); paintDraftRow();
      oc(preview, 'blink');
      const U2 = UI(); if (U2 && U2.announce) U2.announce('Name: ' + name + (rolledOut ? '. Every name in the list is taken, so it has a number.' : ''));
    }
    dice.addEventListener('click', () => roll());
    form.addEventListener('focusin', e => {
      if (pv.contains(e.target)) { follow.release(); return; }
      const r = e.target.getBoundingClientRect(); follow.hold(r.left + r.width / 2, r.top + r.height / 2);
      if (e.target === nameIn || e.target === roleIn) setReact(preview, 'listening');
    });
    form.addEventListener('focusout', () => { follow.release(); if (preview.dataset.base === 'listening') setReact(preview, 'idle'); });
    nameIn.addEventListener('input', () => { rolledOut = false; d.name = nameIn.value.replace(/\s+/g, '-').toLowerCase(); if (d.name !== nameIn.value) { const p = nameIn.selectionStart; nameIn.value = d.name; nameIn.setSelectionRange(p, p); } paintGo(); paintDraftRow(); });
    nameIn.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); create(); return; }
      /* alt+R rolls a name (KEYMAP: free in the app and in browsers; e.code, since ⌥R types ® on a Mac) */
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR') { e.preventDefault(); e.stopPropagation(); roll(); }
    });
    roleIn.addEventListener('input', () => { d.role = roleIn.value; });
    go.addEventListener('click', () => create());

    function create() {
      if (!d.name.trim()) { d.name = botNames.pick(); rolledOut = botNames.exhausted(); nameIn.value = d.name; paintDraftRow(); }
      let base = idBase(d.name), id = base, n = 2;
      while (bot(id)) id = base + '-' + n++;
      const role = shortRole(d.role);
      const nb = {
        id, name: id, role, shape: d.shape, color: d.color, eyes: d.eyes, state: 'happy', activity: '', spent: '0.00',
        cfg: { instructions: d.role.trim(), gov: 'governed', model: 'sonnet 5.5', cap: '0.60', cron: '', channels: { app: true, slack: false, telegram: false, email: false }, approvals: { deploys: true, push: true, network: true, spend: true, people: true, outside: true }, workspace: 'worktree' }
      };
      S.bots.push(nb);
      if (S.rowsEl) S.rowsEl.append(makeRow(nb));
      emit('hx:bot-created', { bot: { id, name: id, role, shape: d.shape, color: d.color, eyes: d.eyes, state: 'idle' } });
      setReact(preview, 'done');
      go.disabled = true;
      later(() => {
        openBot(id);
        emit('hx:bot-select', { id, from: 'bots-new' });
        if (S.composer) S.composer.focus();
        streamMsg(id, 'Hi, I’m ' + id + '. ' + (nb.cfg.instructions ? 'My brief: “' + nb.cfg.instructions.replace(/\s+/g, ' ') + '”' : 'Tell me what you need.') + ' I ask before deploying, pushing or spending past my cap. Open settings to give me a schedule or more channels.', () => {
          later(() => { if (bot(id).state === 'happy') setBotState(id, 'idle'); }, 3000);
        });
      }, 900);
    }
    paintRow(); paintGo();
    if (!seed) later(() => nameIn.focus({ preventScroll: true }), 60);
  }
  /* repaint an orb from bot data; only what changed is written, so orb2 morphs instead of restarting anything.
     Dark bodies take the library's light eyes (the same rule as HX.ui.orb). */
  const eyeColourCache = new Map();
  function paintOrbColour(o, color) {
    if (!o || !color) return;
    if (!eyeColourCache.has(color)) eyeColourCache.set(color, UI().orb({ color, shape: 'circle' }, { size: 20 }).querySelector('orb-avatar').getAttribute('eye-color'));
    const eye = eyeColourCache.get(color);
    if (o.getAttribute('color') !== color) o.setAttribute('color', color);
    if (eye) { if (o.getAttribute('eye-color') !== eye) o.setAttribute('eye-color', eye); } else if (o.hasAttribute('eye-color')) o.removeAttribute('eye-color');
  }
  function paintOrb(o, d) {
    if (!o) return;
    paintOrbColour(o, d.color);
    if (o.getAttribute('shape') !== d.shape) o.setAttribute('shape', d.shape);
    if (o.getAttribute('eye-shape') !== d.eyes) o.setAttribute('eye-shape', d.eyes);
  }
  const idBase = n => String(n || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'bot';
  const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
  function shortRole(t) {
    const first = (String(t || '').trim().split(/[.,;:\n]/)[0] || '').trim();
    if (!first) return 'teammate';
    let out = '';
    for (const w of first.split(/\s+/)) { if ((out + ' ' + w).trim().length > 28) break; out = (out + ' ' + w).trim(); }
    return lowerFirst(out || first.slice(0, 28));
  }

  /* ================================================================== SETTINGS SHEET (KEYMAP §9)
     A .ui-panel inside the view, flush right, --right-w wide, with the library's concave corner and sections.
     ↑ ↓ move between section headers, Enter or Space opens or closes one, Esc goes back to the conversation
     (the shell; the sheet stays open), mod+I or the close button closes it. */
  function toggleSettings() { if (S.sheetOpen) { closeSettings(); focusConversation(); } else openSettings(S.sel); return true; }
  function openSettings(id, focusSection, opts) {
    const U = UI();
    const b = bot(id || S.sel); if (!b || !S.sheet) return;
    if (S.view !== 'bot' || S.sel !== b.id) openBot(b.id);
    if (!S.sheetOpen) S.sheetReturn = document.activeElement;
    S.sheetOpen = true; S.sheetFor = b.id;
    const sh = S.sheet; sh.textContent = ''; sh.hidden = false;
    sh.setAttribute('aria-label', 'Settings for ' + b.name);
    emit('hx:view-inset', { source: 'bots', tab: 'bots', right: sh.offsetWidth });
    const c = b.cfg;
    const changed = () => { updateRow(b.id); refreshPresence(); };

    const close = U.iconButton({ icon: 'close', label: 'Close bot settings', keys: 'mod+I' });
    close.addEventListener('click', () => { closeSettings(); focusConversation(); });
    const head = el('header', { class: 'ui-panel__head' }, [el('h2', { class: 'ui-panel__title', text: 'Bot settings' }), close]);
    const body = el('div', { class: 'ui-panel__body' });
    const sec = (name, label, meta, kids) => {
      const s = U.section({ label, meta: meta ? esc(meta) : '', open: true, name });
      s.querySelector('.ui-sec__body').append(...kids.filter(Boolean));
      return s;
    };
    const hint = text => el('p', { class: 'ui-field__hint', text });

    /* role and instructions */
    const roleF = U.field({ label: 'Role, shown under its name', value: b.role });
    roleF.querySelector('input').addEventListener('input', e => { b.role = e.target.value; changed(); });
    const instrF = U.field({ kind: 'textarea', label: 'Instructions', placeholder: 'How it should work, what to avoid, who to tell', value: c.instructions });
    instrF.querySelector('textarea').addEventListener('input', e => { c.instructions = e.target.value; });

    /* model and governance */
    const modelBox = el('div', { class: 'bt-model' });
    const paintModel = () => {
      modelBox.textContent = '';
      if (c.gov === 'governed') {
        const g = data().governance || { ladder: [] };
        modelBox.append(U.ladder({ stations: g.ladder, current: 0, variant: 'list', label: 'Escalation ladder' }));
        const capId = 'bt-cap-' + b.id;
        const row = frag(U.html.setRow({ label: 'Cap per run', hint: 'Dollars per run', for: capId, control: '<input class="ui-input ui-input--mono bt-cap" id="' + capId + '" inputmode="decimal" value="' + esc(c.cap) + '">' }));
        row.querySelector('input').addEventListener('input', e => { c.cap = e.target.value; paintToolbar(b); });
        modelBox.append(row);
      } else {
        const f = U.field({ kind: 'select', label: 'Model', options: MODELS, value: c.model, hint: 'Runs every step on this model, with no escalation and no cap.' });
        f.querySelector('select').addEventListener('change', e => { c.model = e.target.value; changed(); });
        modelBox.append(f);
      }
    };
    const gov = U.segmented({ mode: 'radio', label: 'Governance', value: c.gov, options: [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }], fill: true });
    gov.addEventListener('ui:change', e => { c.gov = e.detail.value; paintModel(); changed(); });
    paintModel();

    /* schedule */
    const presets = U.chipGroup({ label: 'Schedule', value: CRON_PRESETS.some(([v]) => v === c.cron.trim()) ? c.cron.trim() : null, options: CRON_PRESETS.map(([value, label]) => ({ value, label })) });
    if (!presets.querySelector('[tabindex="0"]')) { const f = presets.querySelector('[role="radio"]'); if (f) f.tabIndex = 0; }
    const cronF = U.field({ label: 'Cron', mono: true, value: c.cron, placeholder: '0 9 * * 1-5', hint: cap(cronWords(c.cron)) });
    const cronIn = cronF.querySelector('input'), cronHint = cronF.querySelector('.ui-field__hint');
    const paintCron = () => {
      cronHint.textContent = cap(cronWords(c.cron));
      if (cronValid(c.cron)) { cronHint.removeAttribute('data-tone'); cronIn.removeAttribute('aria-invalid'); } else { cronHint.setAttribute('data-tone', 'attention'); cronIn.setAttribute('aria-invalid', 'true'); }
    };
    presets.addEventListener('ui:change', e => { c.cron = e.detail.value || ''; cronIn.value = c.cron; paintCron(); changed(); });
    cronIn.addEventListener('input', () => {
      c.cron = cronIn.value; paintCron(); changed();
      const radios = [...presets.querySelectorAll('[role="radio"]')];
      radios.forEach(x => { const on = x.dataset.value === c.cron.trim(); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
      if (!radios.some(x => x.tabIndex === 0) && radios[0]) radios[0].tabIndex = 0;
    });

    /* switches in setting rows */
    const switchRow = (key, label, hintText, on, locked, onChange) => {
      const id = 'bt-sw-' + b.id + '-' + key;
      const row = frag(U.html.setRow({ label, hint: hintText, for: id, control: U.html.switch({ id, checked: on, disabled: locked }) }));
      U.hydrate(row);
      row.querySelector('input').addEventListener('change', e => onChange(e.target.checked));
      return row;
    };
    const chans = el('div', { class: 'ui-set' }, CHANNELS.map(([k, n, h]) => switchRow('ch-' + k, n, h, c.channels[k], k === 'app', v => { c.channels[k] = v; changed(); })));
    const appr = el('div', { class: 'ui-set' }, APPROVALS.map(([k, n]) => switchRow('ap-' + k, n, null, c.approvals[k], false, v => { c.approvals[k] = v; })));

    /* workspace */
    const wsHint = hint('');
    const paintWs = () => { wsHint.textContent = c.workspace === 'worktree' ? 'Its own git worktree; changes reach you as a branch.' : 'An isolated bubblewrap sandbox with the network off; nothing leaves it without approval.'; };
    const ws = U.segmented({ mode: 'radio', label: 'Workspace', value: c.workspace, options: [{ value: 'worktree', label: 'Worktree' }, { value: 'sandbox', label: 'Sandbox' }], fill: true });
    ws.addEventListener('ui:change', e => { c.workspace = e.detail.value; paintWs(); });
    paintWs();

    const who = el('div', { class: 'bt-sh-who' }, [orbButton(b, 28, b.name, { state: b.state }), el('span', { class: 'bt-sh-name', text: b.name }), el('span', { class: 'bt-sh-role', text: b.role })]);
    checkClips();
    body.append(
      who,
      sec('role', 'Role and instructions', null, [roleF, instrF]),
      sec('model', 'Model', c.gov === 'governed' ? 'governed' : c.model, [hint('Governed starts cheap and climbs the ladder only when a step fails.'), gov, modelBox]),
      sec('schedule', 'Schedule', c.cron ? (cronValid(c.cron) ? cronWords(c.cron) : 'incomplete') : null, [hint('When it runs without being asked.'), presets, cronF]),
      sec('channels', 'Channels', null, [hint('Where you can reach it, and where it reports.'), chans]),
      sec('approvals', 'Ask me before', null, [hint('It pauses and sends you an approval card.'), appr]),
      sec('workspace', 'Workspace', c.workspace, [ws, wsHint])
    );
    const heads = [...body.querySelectorAll('.ui-sec__head')];
    if (heads[0]) heads[0].setAttribute('data-hx-focus', 'panel');
    body.addEventListener('keydown', e => {
      const h = e.target.closest('.ui-sec__head'); if (!h || e.target !== h || e.altKey || e.ctrlKey || e.metaKey) return;
      const i = heads.indexOf(h);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = heads[(i + (e.key === 'ArrowDown' ? 1 : heads.length - 1)) % heads.length]; n.focus(); n.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Home') { e.preventDefault(); heads[0].focus(); }
      if (e.key === 'End') { e.preventDefault(); heads[heads.length - 1].focus(); }
    });

    const archive = U.button({ label: 'Archive ' + b.name });
    const archLabel = el('span', { class: 'bt-arch-label', text: 'Archive ' + b.name }); archive.querySelector('span').replaceChildren(archLabel);
    archive.addEventListener('click', () => {
      if (archive.hasAttribute('data-armed')) { archiveBot(b.id); return; }
      archive.setAttribute('data-armed', ''); archLabel.textContent = 'Click again to archive'; checkClips();
      setTimeout(() => { if (archive.isConnected) { archive.removeAttribute('data-armed'); archLabel.textContent = 'Archive ' + b.name; checkClips(); } }, 4000);
    });
    const done = U.button({ label: 'Done', variant: 'primary' });
    done.addEventListener('click', () => { closeSettings(); focusConversation(); });
    const foot = el('footer', { class: 'ui-panel__foot' }, [archive, done]);
    sh.append(el('span', { class: 'ui-concave bt-sheet-corner', 'data-at': 'tr', 'aria-hidden': 'true' }), head, body, foot);
    requestAnimationFrame(() => {
      sh.classList.add('is-open');
      if (opts && opts.keepFocus) return;
      const target = focusSection && body.querySelector('[data-name="' + focusSection + '"]');
      if (target) { target.scrollIntoView({ block: 'start' }); target.setAttribute('data-flash', ''); setTimeout(() => target.removeAttribute('data-flash'), 1300); (target.querySelector('.ui-sec__body input, .ui-sec__body button, .ui-sec__body select, .ui-sec__body textarea') || target.querySelector('.ui-sec__head')).focus({ preventScroll: true }); }
      else if (heads[0]) heads[0].focus({ preventScroll: true });
    });
  }
  function closeSettings(instant) {
    if (!S.sheet || !S.sheetOpen) return;
    S.sheetOpen = false;
    S.sheet.classList.remove('is-open');
    emit('hx:view-inset', { source: 'bots', tab: 'bots', right: 0 });
    const done = () => { if (!S.sheetOpen) S.sheet.hidden = true; };
    if (instant || reduced()) done(); else setTimeout(done, 300);
  }
  function archiveBot(id) {
    const i = S.bots.findIndex(b => b.id === id); if (i < 0 || S.bots.length < 2) return;
    const [gone] = S.bots.splice(i, 1);
    const r = S.rows.get(id); if (r) r.li.remove(); S.rows.delete(id);
    if (gone.attention) announceAttention();
    emit('hx:bot-archived', { id });
    closeSettings(true);
    openBot(S.bots[Math.min(i, S.bots.length - 1)].id);
    toast('Archived ' + gone.name);
    focusConversation();
  }

  /* ================================================================== bus */
  let wired = false;
  function wire() {
    const H = hx(); if (!H || wired || !H.on) return;
    wired = true;
    H.on('hx:bot-select', a => { const d = det(a); if (d.from && String(d.from).startsWith('bots')) return; if (d.id && bot(d.id)) openBot(d.id); });
    H.on('hx:new-bot', () => openNew());
    H.on('hx:bot-settings', a => { const d = det(a); if (d.open && !S.sheetOpen) openSettings(S.sel); });
    H.on('hx:nav', a => {
      const d = det(a); if (!H.state || H.state.tab !== 'bots' || S.view !== 'bot') return;
      if (d.region && d.region !== 'messages') return;
      const t = turns(); if (!t.length) return;
      focusTurn(d.action === 'last' ? t[t.length - 1] : t[0]);
    });
    H.on('hx:bot-message', onBotMessage);
    /* the dock approved or denied: the same card here, the same state */
    H.on('hx:approval', a => {
      const d = det(a); if (d.source === 'bots' || !d.bot) return;
      const m = thread(d.bot).find(x => x.card === 'approval' && !x.resolved);
      if (m) resolveCard(d.bot, m, d.decision || 'approved', { remote: true });
    });
    /* a bot's state set elsewhere (the dock): follow it without echoing it back */
    H.on('hx:bot-state', a => {
      const d = det(a); if (d.source === 'bots' || !d.id) return;
      const b = bot(d.id); if (!b) return;
      const hadAttn = !!b.attention;
      if (d.state && d.state !== 'paused') b.state = d.state;
      if ('attention' in d) b.attention = d.attention || null;
      updateRow(b.id);
      if (b.id === S.sel) refreshPresence();
      if (hadAttn !== !!b.attention) announceAttention();
    });
    H.on('hx:card-action', a => {
      const d = det(a); if (d.source !== 'bots' || !d.bot) return;
      const b = bot(d.bot); if (!b) return;
      const m = thread(b.id).find(x => x.card && !x.resolved); if (m) resolveCard(b.id, m, d.action);
    });
    const onState = () => { syncListVisibility(); syncRail(); };
    H.on('hx:state', onState); H.on('hx:tab', onState);
    H.on('hx:theme', () => requestAnimationFrame(repaintOrbs));
    if (typeof H.provide === 'function') {
      H.provide('bot-settings', d => { if (!H.state || H.state.tab !== 'bots' || S.view !== 'bot') return false; if (d && d.toggle) return toggleSettings(); openSettings(S.sel); return true; });
      H.provide('stop', d => (d && d.tab === 'bots') ? stopRun() : false);
    }
    setTimeout(announceAttention, 0);
  }

  const api = {
    list: () => S.bots.map(({ id, name, role, shape, color, eyes, state, attention }) => ({ id, name, role, shape, color, eyes, state, attention: attention || null })),
    get: id => bot(id), open: id => openBot(id), newBot: seed => openNew(seed), settings: (id, sec) => openSettings(id, sec), toggleSettings
  };
  function register() {
    const H = hx(); if (!H || !H.register) return false;
    initModel();
    leadOrb();
    H.bots = api; H.botNames = botNames;
    H.register('bots-list', { mount(root) { wire(); mountList(root); } });
    H.register('bots', { mount(root) { wire(); mountView(root); } });
    wire();
    return true;
  }
  if (!register()) document.addEventListener('DOMContentLoaded', register, { once: true });
})();
