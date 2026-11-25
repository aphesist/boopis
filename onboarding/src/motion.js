/* Onboarding motion previews (the clips O-M1 to O-M5). Each clip builds its screens from the same builders as the stills,
   then sets every animated property as a pure function of the clip time t (ms), with v7's motion tokens. The recorder (rec.cjs)
   runs the page on a virtual clock, so the orbs' and the logo's own motion (requestAnimationFrame, performance.now) and these
   timelines advance in lockstep, one 30 fps frame at a time: no dropped frames, no strobing. */
(function () {
  const S = window.SCREENS, OB = window.OB;
  /* the tokens (tokens.v7.json) */
  const bez = (x1, y1, x2, y2) => (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, t = x; for (let i = 0; i < 30; i++) { t = (lo + hi) / 2; const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3; if (cx < x) lo = t; else hi = t; } return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3; };
  const E = { sharp: bez(0.165, 0.84, 0.44, 1), spring: bez(0.22, 1, 0.36, 1), out: bez(0, 0, 0.58, 1), lin: (x) => Math.max(0, Math.min(1, x)) };
  const D = { press: 50, hover: 120, out: 100, pop: 100, d2: 200, d3: 300, hold: 1000, markIn: 180, markOut: 120, phrase: 800, shimmer: 2200, hero: 600 };
  /* reduced motion (9.2): nothing travels or scales; what changes cross-fades in 150 ms; the sweep stops; the orbs and the logo reduce themselves */
  const R = new URLSearchParams(location.search).has('reduced');
  const p = (t, t0, dur, ease = E.sharp) => R ? E.lin((t - t0) / 150) : ease((t - t0) / dur);
  const lerp = (a, b, k) => a + (b - a) * k;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const set = (el, st) => { if (el) for (const k in st) el.style[k] = st[k]; };
  /* enter: opacity 0 -> 1 with a small travel (4 px) and scale .98, the kit's popover and card entry */
  const enter = (el, t, t0, dur = D.d2, dy = 4, sc = 0.98) => { if (!el) return; const k = p(t, t0, dur); if (R) { dy = 0; sc = 1; } set(el, { opacity: String(k), transform: `translateY(${lerp(dy, 0, k)}px) scale(${lerp(sc, 1, k)})` }); };
  const fade = (el, t, t0, dur, from, to, ease = E.sharp) => { if (el) el.style.opacity = String(lerp(from, to, p(t, t0, dur, ease))); };
  const press = (el, t, t0) => { if (!el || R) return; const k = t < t0 ? 0 : t < t0 + D.press ? (t - t0) / D.press : t < t0 + 2 * D.press ? 1 - (t - t0 - D.press) / D.press : 0; el.style.transform = `scale(${1 - 0.04 * k})`; };
  /* the status phrase's sweep (board 08 C): 2.2 s, steps(60), moving the highlight from 200% to -200% */
  const shimmer = (t) => R ? null : $$('.shimmer').forEach((el) => { const ph = Math.floor(((t % D.shimmer) / D.shimmer) * 60) / 60; el.style.backgroundPosition = `${200 - 400 * ph}% 0`; });
  /* hold to allow: the fill sweeps left to right over the hold (1 s), then the chip is pressed */
  const holdFill = (el, t, t0) => { if (!el) return; const k = Math.max(0, Math.min(1, (t - t0) / D.hold)); el.style.backgroundImage = k > 0 && k < 1 ? `linear-gradient(90deg, var(--accent) ${k * 100}%, transparent ${k * 100}%)` : 'none'; if (k > 0 && k < 1) el.style.color = 'var(--text-on-light)'; };
  const collapse = (el, t, t0, h0) => { if (!el) return; const k = p(t, t0, D.d3, E.spring); if (R) { set(el, { display: k > 0 ? 'none' : '' }); return; } set(el, { height: `${lerp(h0, 0, k)}px`, opacity: String(1 - p(t, t0, D.d2, E.out)), overflow: 'hidden', marginTop: k >= 1 ? '0px' : '' }); };
  const host = () => document.getElementById('r');
  const mount = (html) => { host().innerHTML = html; window.V7.eyes(); window.V7.paint(); return host(); };
  const orbState = (el, st) => { if (el && el.getAttribute('reaction') !== st) el.setAttribute('reaction', st); };

  /* ---------- O-M1: the intro, O01 -> O02 -> O03 ---------- */
  function m1() {
    const o = { theme: 'dark' };
    const root = mount(S.obIntro({ ...o, step: 1 }));
    const win = $('.win', root);
    const tmp = document.createElement('div'); tmp.innerHTML = S.obIntro({ ...o, step: 2 }) + S.obIntro({ ...o, step: 3 });
    const pages = [$('.ob-page', win), ...$$('.ob-page', tmp)];
    pages.slice(1).forEach((pg) => win.appendChild(pg));
    window.V7.eyes(win); window.V7.paint(win);
    const [p1, p2, p3] = pages;
    /* the intro's hero: the wordmark (64), its letters fade, its eyes travel to the centre at 1.5x and become the mark A */
    const hero = $('.ob-hero', p1); const mk = $('boopis-logo', hero); mk.setAttribute('still', '');
    const word = document.createElement('boopis-logo'); word.setAttribute('still', ''); word.style.cssText = 'font-size:64px;color:var(--text-strong);position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)';
    hero.appendChild(word);
    /* the eye pair inside the wordmark, measured from the element (Libre Franklin metrics): 26.4 px left of the word's centre */
    const EYE_DX = -26.4, EYE_DY = 1;
    return { dur: 12400, at(t) {
      /* one set of eyes the whole time: the mark A sits on the wordmark's "oo" (whose own eyes are hidden), the letters fade,
         and the mark travels to the centre and grows to the hero size; nothing is swapped, so there is never a second pair */
      const sr = word.shadowRoot;
      if (sr) { sr.querySelectorAll('path.e').forEach((e) => { e.style.opacity = '0'; }); sr.querySelectorAll('.y > .L, .y > .R').forEach((g) => { g.style.opacity = String(1 - p(t, 1200, D.d2)); }); }
      word.style.opacity = String(p(t, 0, D.d2, E.out));
      mk.style.position = 'absolute'; mk.style.left = '50%'; mk.style.top = '50%';
      const k = R ? (t >= 1400 ? 1 : 0) : p(t, 1400, D.hero, E.spring);
      const s0 = 64 / 96;
      if (R) { mk.style.transform = t < 1400 ? `translate(-50%,-50%) translate(${EYE_DX}px, ${EYE_DY}px) scale(${s0})` : 'translate(-50%,-50%)'; mk.style.opacity = String(t < 1400 ? Math.min(1, t / 150) : Math.min(1, p(t, 1400, 150))); }
      else { mk.style.transform = `translate(-50%,-50%) translate(${lerp(EYE_DX, 0, k)}px, ${lerp(EYE_DY, 0, k)}px) scale(${lerp(s0, 1, k)})`; mk.style.opacity = String(p(t, 0, D.d2, E.out)); }
      if (t >= 2000 && mk.hasAttribute('still')) mk.removeAttribute('still');
      /* O01's words: after the eyes settle */
      [$('.ob-h', p1), $('.ob-lede', p1)].forEach((el, i) => enter(el, t, 2100 + i * 60));
      const acts1 = $('.ob-acts', p1); enter(acts1, t, 2300); if (acts1 && t > 2300) acts1.style.transform += ' translateX(-50%)';
      enter($('.ob-skip', p1), t, 2300, D.d2, 0, 1);
      press($('.ob-acts .btn.primary', p1), t, 5000);
      /* to O02: the page cross-fades (200 ms); the scene's cards enter staggered; the bots wake */
      if (t >= 5100) { p1.style.opacity = String(1 - p(t, 5100, D.d2)); }
      p2.style.opacity = t < 5100 ? '0' : String(p(t, 5100, D.d2));
      $$('.ob-card', p2).forEach((c, i) => enter(c, t, 5200 + i * 60));
      $$('.ob-card:nth-child(2) orb-avatar', p2).forEach((ob, i) => { if (ob.getAttribute('size') === '44') orbState(ob, t < 5700 + i * 150 ? 'sleeping' : 'idle'); });
      press($('.ob-acts .btn.primary', p2), t, 8200);
      /* to O03: the ask, held to allow, then its receipt and the recorded line */
      if (t >= 8300) p2.style.opacity = String(1 - p(t, 8300, D.d2));
      p3.style.opacity = t < 8300 ? '0' : String(p(t, 8300, D.d2));
      const card = $('.qcard', p3), sys = $('.sysline', p3);
      enter(card, t, 8400); fade(sys, t, 10500, D.d2, 0, 1);
      const chip = $('.qcard .chip.on', p3); holdFill(chip, t, 9100);
      const stamp = $('.qcard .stamp', p3);
      if (stamp && t >= 10100) { stamp.innerHTML = '<span class="word">allowed once</span>'; }
      if (chip && t >= 10100) { chip.parentElement.style.opacity = String(1 - p(t, 10100, D.out)); }
      shimmer(t);
    } };
  }

  /* ---------- O-M2: the bots come alive, O11 -> O12 ---------- */
  function m2() {
    const o = { theme: 'dark' };
    const root = mount(S.obBots({ ...o, step: 1 }));
    const main = $('.main', root);
    const tmp = document.createElement('div'); tmp.innerHTML = S.obBots({ ...o, step: 2 });
    const p2 = $('.ob-page', tmp); main.insertBefore(p2, $('.ob-skip', main)); window.V7.eyes(main); window.V7.paint(main);
    const p1 = $('.ob-page', main);
    const hero = $('.ob-hero', p1); const bot = $('orb-avatar', hero);
    const mk = document.createElement('boopis-logo'); mk.setAttribute('mark', ''); mk.style.cssText = 'font-size:96px;color:var(--text-strong);position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)'; hero.appendChild(mk);
    const jobs = $$('.ob-job', p2);
    return { dur: 7600, at(t) {
      [$('.ob-h', p1), $('.ob-lede', p1)].forEach((el, i) => enter(el, t, 0 + i * 60));
      /* the eyes drop into the orb: the mark falls 12 px and fades (150 ms) while the orb grows from .6 (300 ms, spring) */
      const k = p(t, 900, 150, E.sharp);
      set(mk, { opacity: String(1 - k), transform: `translate(-50%,-50%) translateY(${lerp(0, 12, k)}px)` });
      const kb = p(t, 1050, D.d3, E.spring);
      set(bot, { opacity: String(Math.min(1, kb * 1.4)), transform: `scale(${lerp(0.6, 1, kb)})` });
      orbState(bot, t < 1350 ? 'idle' : t < 2550 ? 'happy' : 'idle');
      const a1 = $('.ob-acts', p1); enter(a1, t, 1300); if (a1) a1.style.transform += ' translateX(-50%)';
      press($('.ob-acts .btn.primary', p1), t, 3000);
      if (t >= 3100) p1.style.opacity = String(1 - p(t, 3100, D.d2));
      p2.style.opacity = t < 3100 ? '0' : String(p(t, 3100, D.d2));
      jobs.forEach((j, i) => {
        const ob = $('orb-avatar', j), chip = $('.chip', j);
        enter(ob, t, 3200 + i * 80, D.d2, 0, 0.98);
        const wake = 3900 + i * 500;
        orbState(ob, t < wake ? 'sleeping' : t < wake + 800 ? 'happy' : 'idle');
        enter(chip, t, wake + 100, D.hover);
      });
      const a2 = $('.ob-acts', p2); if (a2) a2.style.transform = 'translateX(-50%)';
    } };
  }

  /* ---------- O-M3: Try it, in the real composer ---------- */
  function m3() {
    const root = mount(S.obTry({ theme: 'dark', phase: 'ask' }));
    const ph = $('.composer .ph', root);
    const rc = $$('.ob-rcpt', root); const sent = rc[rc.length - 1];
    const ask = $('.thread .qcard', root);
    const tmp = document.createElement('div'); tmp.innerHTML = S.obTry({ theme: 'dark', phase: 'open' });
    const menu = [...tmp.querySelectorAll('.menu')].pop(); $('.main', root).appendChild(menu); window.V7.paint(menu);
    const under = $('.composer-under', root);
    const DRAFT = 'refactor the billing helpers and ship it';
    const A = [9, 28], B = [33, 40];
    /* typing at 25 characters a second, with the person's pause after "helpers" (the debounce fires on real pauses) */
    const T0 = 500, CPS = 25, PAUSE = 450;
    const charAt = (t) => { const d = t - T0; if (d < 0) return 0; const n1 = Math.floor((d / 1000) * CPS); if (n1 <= 28) return Math.min(28, n1); const d2 = d - (28 / CPS) * 1000 - PAUSE; return d2 < 0 ? 28 : Math.min(40, 28 + Math.floor((d2 / 1000) * CPS)); };
    const doneAt = (n) => n <= 28 ? T0 + (n / CPS) * 1000 : T0 + (28 / CPS) * 1000 + PAUSE + ((n - 28) / CPS) * 1000;
    const tA = doneAt(28) + 250, tB = doneAt(40) + 250;
    const T_HOVER = tB + 900, T_OPEN = T_HOVER + 400, T_PICK = T_OPEN + 1300, T_ASK = T_PICK + 700, T_KEEP = T_ASK + 1500;
    const markHtml = (txt, t, t0, state) => { const k = p(t, t0, D.markIn, E.sharp); return `<span class="mk2" data-state="${state}" style="--p:${(k * 100).toFixed(2)}%">${txt}</span>`; };
    return { dur: T_KEEP + 1400, at(t) {
      const n = charAt(t); const s = DRAFT.slice(0, n);
      const st = t >= T_PICK ? 'chosen' : t >= T_OPEN ? 'open' : t >= T_HOVER ? 'hover' : 'shown';
      let h = '';
      if (t >= tA && n >= 28) h = s.slice(0, A[0]) + markHtml(s.slice(A[0], A[1]), t, tA, 'shown') + s.slice(A[1], B[0]) + (t >= tB && n >= 40 ? markHtml(s.slice(B[0]), t, tB, st) : s.slice(B[0]));
      else h = s;
      const caret = t < T_OPEN && Math.floor(t / 530) % 2 === 0 ? '<span style="display:inline-block;width:1.5px;height:1em;background:var(--focus);vertical-align:-2px;margin-left:1px"></span>' : '';
      ph.innerHTML = (n ? h : '<span style="color:var(--text-quiet)">Message</span>') + caret;
      ph.classList.toggle('typed', n > 0);
      const send = $('.composer .ib.inv', root); const want = n > 0 ? 'arrowup' : 'waveform'; if (send && send.dataset.g !== want) { send.dataset.g = want; send.innerHTML = window.V7.I(want); }
      /* the line under the composer changes once the first reading arrives */
      if (under) under.style.opacity = String(p(t, tA, D.d2));
      /* the reading's menu: 100 ms from scale .98 and 4 px toward its anchor (below it) */
      if (t < T_OPEN) menu.style.opacity = '0';
      else if (t < T_PICK) { const k = p(t, T_OPEN, D.pop); set(menu, { opacity: String(k), transform: `translateY(${lerp(4, 0, k)}px) scale(${lerp(0.98, 1, k)})`, transformOrigin: '50% 100%' }); }
      else menu.style.opacity = String(1 - p(t, T_PICK, D.out));
      const row = $('.mi.hov', menu); if (row) row.style.transform = `scale(${t >= T_PICK - 2 * D.press && t < T_PICK ? 0.98 : 1})`;
      if (sent) enter(sent, t, T_PICK + 200);
      enter(ask, t, T_ASK);
      press($('.chip.on', ask), t, T_KEEP);
      if (t >= T_KEEP + 150) { const w = $('.word', ask); if (w) w.textContent = 'kept on'; const rowc = $('.row:last-child', ask); if (rowc) rowc.style.opacity = String(1 - p(t, T_KEEP + 150, D.out)); }
    } };
  }

  /* ---------- O-M4: a step answered, then the new session's mark looking at the composer ---------- */
  function m4() {
    const root = mount(S.obModels({ theme: 'dark' }));
    const win = $('.win', root);
    const card = $('.thread .qcard', root), th = $('.thread', root);
    const ub = document.createElement('div'); ub.className = 'b user sq'; ub.textContent = 'Use Claude'; th.appendChild(ub);
    const r1 = document.createElement('div'); r1.innerHTML = OB.rcpt('Connected: Claude, your subscription. Starts on Claude Opus.'); const rcp = r1.firstChild; th.appendChild(rcp);
    const s1 = document.createElement('div'); s1.innerHTML = OB.say('One thing boopis does differently: I read what you write before you send it, and mark what I’d otherwise ask you later.', true, ' style="margin-top:16px"'); const sb = s1.firstChild; th.appendChild(sb);
    window.V7.paint(th);
    const h0 = card.offsetHeight;
    /* part 2: the new session (O10), its mark looking at the composer while you type */
    const tmp = document.createElement('div'); tmp.innerHTML = S.obFirst({ theme: 'dark' }); const win2 = $('.win', tmp);
    win2.style.cssText += ';position:absolute;left:0;top:0;opacity:0'; root.appendChild(win2); window.V7.eyes(win2); window.V7.paint(win2);
    const ph = $('.composer .ph', win2); const logo = $('.ns-mark boopis-logo', win2); logo.removeAttribute('data-look');
    const DRAFT = 'Find why the tests fail on CI and fix it'; const T1 = 4200, TK = T1 + 900, CPS = 25;
    let looking = false;
    return { dur: 10400, at(t) {
      press($('.qcard .btn.primary', root), t, 600);
      if (t >= 700) collapse(card, t, 700, h0);
      enter(ub, t, 760); if (t < 760) ub.style.opacity = '0';
      enter(rcp, t, 900); enter(sb, t, 1100);
      /* the branch: the window cross-fades to the new session (200 ms) */
      win2.style.opacity = String(p(t, T1, D.d2));
      const d = t - TK; const n = d < 0 ? 0 : Math.min(DRAFT.length, Math.floor((d / 1000) * CPS));
      const last = TK + (DRAFT.length / CPS) * 1000;
      ph.textContent = n ? DRAFT.slice(0, n) : 'What should change? @ files, $ skills, / commands'; ph.classList.toggle('typed', n > 0);
      const send = $('.composer .ib.inv', win2); const g = n > 0 ? 'arrowup' : 'waveform'; if (send && send.dataset.g !== g) { send.dataset.g = g; send.innerHTML = window.V7.I(g); }
      /* first keystroke: look(0, -1) and hold; 1.2 s after the last keystroke, look() lets go */
      const want = n > 0 && t < last + 1200;
      if (want !== looking && logo.look) { looking = want; if (want) logo.look(0, -1); else logo.look(); }
    } };
  }

  /* ---------- O-M5: build, the bots arrive in the rail and the dock ---------- */
  function m5() {
    const root = mount(S.obBRules({ theme: 'dark' }));
    const win = $('.win', root);
    const th = $('.thread', root); const card = $('.thread .qcard', root);
    const rail = $('.side.rail', root); const dockEl = $('.dock', root);
    const NEW = ['kai', 'moss', 'iris'];
    const tiles = NEW.map((n) => { const s = document.createElement('span'); s.className = 'tile sq'; s.style.cssText = 'width:54px;height:54px;opacity:0'; s.innerHTML = window.V7.orb(n, 36, { surface: 'var(--bg-1)' }); rail.insertBefore(s, $('.foot-ctl', rail)); return s; });
    const ub = document.createElement('div'); ub.className = 'b user sq'; ub.textContent = 'Keep these rules'; th.appendChild(ub);
    const act = document.createElement('div'); act.className = 'activity'; act.innerHTML = `${window.V7.orb('boopis', 16, { state: 'working', surface: 'var(--bg-2)' })}<span class="shimmer"></span>`; th.appendChild(act);
    const sys = document.createElement('div'); sys.className = 'sysline'; sys.innerHTML = `${window.V7.I('check')}Built at 09:47: 3 bots, 1 room, 1 routine (paused)`; th.appendChild(sys);
    window.V7.eyes(win); window.V7.paint(win);
    const h0 = card.offsetHeight;
    const PH = [['Making kai', 1500], ['Making moss', 2400], ['Making iris', 3300], ['Seating the crew', 4200], ['Adding the routine, paused', 5100]];
    /* the dock: built once with all four orbs; a new orb's slot opens (width 0 -> 40 and the gap) as the slab grows */
    { const tmp = document.createElement('div'); tmp.innerHTML = OB.dockOf(['boopis', ...NEW]); const nd = tmp.firstChild; dockEl.parentNode.insertBefore(nd, dockEl); dockEl.parentNode.removeChild(dockEl); window.V7.eyes(nd); }
    const dock = $('.dock', win); const svg = $('svg.slab', dock); const slots = $$('.dk-in > span', dock).slice(1, 4);
    const slab = (w) => { const F = 30; dock.style.width = w + 'px'; svg.setAttribute('viewBox', `0 0 ${w + 2 * F} 72`); svg.setAttribute('width', w + 2 * F); $('path', svg).setAttribute('d', window.SQ.slabPath(w, 72, 30, F)); };
    return { dur: 7800, at(t) {
      press($('.chip.on', card), t, 400);
      if (t >= 500) collapse(card, t, 500, h0);
      enter(ub, t, 560); if (t < 560) ub.style.opacity = '0';
      enter(act, t, 1200);
      const cur = PH.filter(([, t0]) => t >= t0).pop(); const sp = $('.shimmer', act);
      if (cur) { const k = p(t, cur[1], D.d2); sp.textContent = cur[0]; sp.style.opacity = String(Math.min(1, 0.001 + k)); }
      shimmer(t);
      if (t >= 6000) act.style.opacity = String(1 - p(t, 6000, D.d2));
      enter(sys, t, 6100);
      /* each new bot: its rail tile and its dock orb arrive with its phrase (200 ms, spring; the orb happy, then idle) */
      let w = 162;
      NEW.forEach((n, i) => { const t0 = PH[i][1]; const k = p(t, t0, D.d2, E.spring);
        set(tiles[i], { opacity: String(k), transform: `scale(${lerp(0.98, 1, k)})` }); orbState($('orb-avatar', tiles[i]), t < t0 ? 'sleeping' : t < t0 + 800 ? 'happy' : 'idle');
        const sl = slots[i]; set(sl, { width: `${lerp(0, 40, k)}px`, marginLeft: `${lerp(-14, 0, k)}px`, opacity: String(k), transform: `scale(${lerp(0.98, 1, k)})`, display: 'inline-block', flex: 'none' });
        orbState($('orb-avatar', sl), t < t0 ? 'sleeping' : t < t0 + 800 ? 'happy' : 'idle');
        w += lerp(0, 54, k); });
      slab(w);
    } };
  }

  window.CLIPS = { m1, m2, m3, m4, m5 };
})();
