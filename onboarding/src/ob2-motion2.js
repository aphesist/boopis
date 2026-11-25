/* Onboarding revision 2, batch 2's clips: the speaker reacting while you answer, the bots coming alive, the team
   assembling into the sidebar, Try it, the goal tiles, and the step-to-step transitions. Same rules as ob2-motion.js:
   every property a pure function of t; orb2's and the logo's own calls fired once as the clock passes their cue. */
(function () {
  const S = window.SCREENS, SP = window.OB2S, O2 = window.OB2, OB = window.OB;
  const { E, D, R, p, lerp, $, $$, set, enter, press, shimmer, mount, calls } = window.OB2M;
  const I = window.V7.I;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /* orb2's lookAt, capped (as boopis's capLook): the target is pulled toward the orb so the head turns at most about 0.5 rad.
     orb2 turns the head by 1.25 atan(d / a) with a = max(250, 1.65 w) and clamps at 1.18 rad; near the clamp the body's
     silhouette leans so far that it deforms (the owner's silhouette bug), so onboarding never asks for more than 0.42 a. */
  function look(o, x, y) {
    if (x === undefined) { o.lookAt(); return; }
    const r = o.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, a = Math.max(250, 1.65 * r.width) * 0.42;
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, a / d);
    o.lookAt(cx + dx * k, cy + dy * k);
  }
  /* orb2's turntable spin, on a round body only: on a flat body (squircle, flower, ...) a full turn kinks the outline (ORBS.md's
     silhouette defect) until the owner's geometric fix lands; a flat body shows its interest with its curious emote instead */
  const turn = (o) => { if (o.getAttribute('shape') === 'circle') o.spin('turntable'); else o.emote('curious'); };
  const ctr = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  /* a tween over keys [{t, v: {...}, dur, ease}]: each key starts from wherever the previous one is at that moment */
  function tween(v0, keys) {
    keys = keys.slice().sort((a, b) => a.t - b.t);
    let prev = null; const at0 = (k, t) => { const out = {}; for (const f in k.to) out[f] = k.from[f] + (k.to[f] - k.from[f]) * k.e((t - k.t) / k.dur); return out; };
    for (const k of keys) { k.e = typeof k.ease === 'function' ? k.ease : E[k.ease || 'spring']; k.dur = k.dur || 420; const base = prev ? at0(prev, k.t) : v0; k.from = { ...base }; k.to = { ...base, ...k.v }; prev = k; }
    return (t) => { let k = null; for (const x of keys) { if (t >= x.t) k = x; else break; } return k ? at0(k, t) : { ...v0 }; };
  }
  /* the head pose that looks from the speaker at a point (page px): eyes and head together, capped as the poses are */
  function poseTo(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const yaw = clamp(dx / 500 * 34, -34, 34), pitch = clamp(-dy / 360 * 18, -18, 12);
    return { posev: { x: clamp(dx / 500 * 0.2, -0.2, 0.2), y: dy > 40 ? 0.04 : dy < -40 ? -0.03 : 0, yaw, pitch, roll: yaw * 0.1 }, look: [clamp(dx / 380, -1, 1), clamp(-dy / 260, -1, 1)] };
  }
  /* lift an element out of its page into a floating layer (so it can travel between pages): returns {el, at(x, y, s)} */
  function lift(el, host) {
    const [cx, cy] = ctr(el); const fl = document.createElement('div');
    fl.className = 'ob2-fly'; fl.style.cssText = `position:absolute;left:0;top:0;z-index:20;transform-origin:0 0;pointer-events:none`;
    const r = el.getBoundingClientRect(); const w = r.width, h = r.height;
    fl.appendChild(el); el.style.position = 'absolute'; el.style.left = `${-w / 2}px`; el.style.top = `${-h / 2}px`; el.style.margin = '0';
    host.appendChild(fl);
    return { el: fl, c0: [cx, cy], at(x, y, s = 1) { fl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})`; } };
  }
  /* a page swap inside one window: the old page's parts go (120 ms), then the new page's parts come (entries are the clip's) */
  const partsOf = (win) => [...win.querySelectorAll('.main > *, .drag .title-pill, .ob3-pre > *, :scope > .ob-skip')];   /* revision 3: a setup page's parts too */
  function swapper(A, B, t0, vis = true) {
    const pa = partsOf(A), pb = partsOf(B);
    /* a part that is the same on both pages (the pill, the dock, "Not now") stays put: it is never faded out and back in */
    const same = new Set(); pa.forEach((a) => { const m = pb.find((b) => !same.has(b) && b.outerHTML === a.outerHTML); if (m) { same.add(a); same.add(m); } });
    return (t) => {
      const gone = t >= t0 + 120;
      if (vis) { A.style.visibility = gone ? 'hidden' : 'visible'; B.style.visibility = gone ? 'visible' : 'hidden'; }
      if (t >= t0 && !gone) pa.forEach((e) => { if (!same.has(e)) e.style.opacity = String(1 - p(t, t0, 120, E.out)); });
      if (gone) pb.forEach((e) => { if (!same.has(e)) e.style.opacity = String(p(t, t0 + 120, D.d2)); });
      return pb;
    };
  }
  const stack = (root, html) => { const d = document.createElement('div'); d.innerHTML = html; const w = d.firstElementChild; w.style.position = 'absolute'; w.style.left = '0'; w.style.top = '0'; w.style.visibility = 'hidden'; root.appendChild(w); O2.orbRules(w); window.V7.eyes(w); window.V7.paint(w); return w; };
  const collapse = (el, t, t0, h0) => { if (!el) return; const k = p(t, t0, D.d3, E.spring); if (R) { set(el, { display: t >= t0 ? 'none' : '' }); return; } set(el, { height: `${lerp(h0, 0, k)}px`, opacity: String(1 - p(t, t0, D.d2, E.out)), overflow: 'hidden', marginTop: k >= 1 ? '0px' : '', marginBottom: k >= 1 ? '0px' : '' }); };
  const addTo = (parent, html) => { const d = document.createElement('div'); d.innerHTML = html; const e = d.firstElementChild; parent.appendChild(e); window.V7.paint(e); return e; };
  const hov = (el, on) => { if (el) el.classList.toggle('hov', on); };

  /* ---------- O-M2: the speaker reacts while you answer (O-S03, the model, in the Session tab's setup conversation) ---------- */
  function listen() {
    const root = mount(S.obS03({ theme: 'dark' }));
    const th = $('.thread', root), sp = $('.ob-spk', root);
    const says = $$('.ob-say', th), card = $('.qcard', th);
    const rows = $$('.optrow', card), btn = $('.btn.primary', card);
    const ub = addTo(th, OB.you('Use Claude')); const rc = addTo(th, OB.rcpt('Connected: Claude, your subscription. Starts on Claude Opus.'));
    const s3 = addTo(th, `<div class="b agent sq ob-say" style="margin-top:16px">One thing boopis does differently: I read what you write before you send it, and mark what I’d otherwise ask you later.</div>`);
    const s4 = addTo(th, `<div class="b agent sq ob-say">Watch the composer. Open a mark to answer it.</div>`);
    const h0 = card.offsetHeight;
    const me = ctr(sp);
    const at = (el, ex = {}) => ({ ...poseTo(me, ctr(el)), dur: 420, ...ex });
    const ph = $('.composer .ph', root);
    const cues = [
      { t: 0, pose: 'you', dur: 1 },
      { t: 150, bob: 0.07 }, { t: 620, bob: 0.06 },
      { t: 1100, ...at(card) },
      { t: 1700, ...at(rows[1]) }, { t: 2350, ...at(rows[2]), blink: true }, { t: 3000, ...at(rows[0]) },
      { t: 3500, ...at(btn) },
      { t: 3930, nod: true },
      { t: 4080, hop: 0.18, morph: 'happy', pose: 'you', dur: 380 },
      { t: 4420, ...at(rc), eyes: true }, { t: 4560, blink: true },
      { t: 5050, morph: null },
      { t: 5200, pose: 'you', dur: 380, bob: 0.07 }, { t: 5700, bob: 0.06, pose: 'downLeft', dur: 420 },
      { t: 6200, pose: 'downRight', dur: 600, ease: 'inout' },
      { t: 6900, pose: 'down', dur: 420 },
      { t: 7350, morph: 'listening', pose: 'tiltLeft', dur: 420 },
      { t: 7500, look: [-0.6, -1] }, { t: 7800, look: [-0.25, -1] }, { t: 8100, look: [0.1, -1] }, { t: 8400, look: [0.45, -1] },
      { t: 8800, morph: null, pose: 'you', dur: 420, blink: true }
    ];
    const dir = SP.director(sp, cues, { reduced: R });
    const DRAFT = 'refactor the billing helpers'; const T0 = 7450;
    return { dur: 9600, at(t) {
      dir.at(t);
      enter(says[0], t, 150); enter(says[1], t, 620); enter(card, t, 1050);
      hov(rows[1], t >= 1700 && t < 2350); hov(rows[2], t >= 2350 && t < 3000); hov(rows[0], t >= 3000 && t < 3500);
      if (btn) btn.style.filter = t >= 3500 && t < 4100 ? 'brightness(0.92)' : '';
      press(btn, t, 3880);
      if (t >= 4080) collapse(card, t, 4080, h0);
      enter(ub, t, 4160); enter(rc, t, 4300); enter(s3, t, 5200); enter(s4, t, 5700);
      const n = t < T0 ? 0 : Math.min(DRAFT.length, Math.floor((t - T0) / 40));
      if (ph) { ph.textContent = n ? DRAFT.slice(0, n) : 'Choose a model first'; ph.classList.toggle('typed', n > 0); }
    } };
  }

  /* ---------- O-M3: the bots come alive (O-B02 -> O-B03): the eyes become the boopis bot, it takes its place, the team wakes ---------- */
  function alive() {
    const root = mount(S.obB02({ theme: 'dark' }));
    const A = $('.win', root); A.style.position = 'absolute';
    const B = stack(root, S.obB03({ theme: 'dark', asleep: '1' }));
    const hero = $('.ob2-hero', A), bot = $('orb-avatar', hero);
    bot.setAttribute('reaction', 'sleeping');
    /* the speaker sits where the orb is, then drops into it */
    hero.insertAdjacentHTML('beforeend', SP.spk(96, { pose: 'you', style: 'position:absolute' }));
    const sp = $('.ob-spk', hero);
    /* boopis travels from the hero to the sidebar's main slot; B's own main orb stays hidden (one boopis the whole time) */
    const slot = $('.sb-main orb-avatar', B); const slotName = $('.sb-main .nm', B);
    const target = ctr(slot); slot.style.visibility = 'hidden';
    const fly = lift(bot, root); const [hx, hy] = fly.c0;
    const S44 = 44 / 120;
    const path = tween({ x: hx, y: hy, s: 1 }, [{ t: 4150, v: { x: target[0], y: target[1], s: S44 }, dur: 640, ease: 'travel' }]);
    const jobs = $$('.ob-job', B); const orbs = Object.fromEntries(jobs.map((j) => [j.dataset.n, $('orb-avatar', j)]));
    const centreOf = (n) => n === 'boopis' ? target : ctr(orbs[n]);
    const you = [870, 900];
    const L = (o, n) => () => { const c = n === 'you' ? you : centreOf(n); look(o, c[0], c[1]); };
    const sw = swapper(A, B, 4000);
    const cue = calls([
      [1750, () => { bot.setAttribute('reaction', 'idle'); bot.emote && bot.emote('wake'); }],
      [2050, () => { bot.setAttribute('reaction', 'happy'); bot.poke(0.6, { react: false }); }],
      [2950, () => bot.setAttribute('reaction', 'idle')],
      [3150, () => bot.blink()], [3300, () => look(bot, 870, 700)], [3700, () => look(bot)],
      [4700, () => bot.poke(0.35, { react: false })],
      /* in the sidebar it takes the sidebar's fixed 3/4 angle and moves only through its states */
      [4640, () => { look(bot); bot.setAttribute('gaze', O2.SIDE_GAZE); bot.setAttribute('idle-motion', 'off'); }],

      [5000, () => { orbs.kai.setAttribute('reaction', 'idle'); orbs.kai.emote('wake'); }], [5450, L(orbs.kai, 'boopis')],
      [5700, () => { orbs.kai.setAttribute('reaction', 'happy'); orbs.kai.poke(0.5, { react: false }); }], [6350, () => orbs.kai.setAttribute('reaction', 'idle')],

      [5800, () => { orbs.moss.setAttribute('reaction', 'idle'); orbs.moss.emote('wake'); }], [6150, L(orbs.moss, 'kai')], [6250, L(orbs.kai, 'moss')],
      [6600, () => turn(orbs.moss)], [7200, L(orbs.moss, 'boopis')],
      [6800, () => { orbs.iris.setAttribute('reaction', 'idle'); orbs.iris.emote('doubletake'); }],
      [7250, L(orbs.iris, 'moss')], [7350, L(orbs.moss, 'iris')],
      [7550, () => { orbs.iris.setAttribute('reaction', 'happy'); orbs.iris.poke(0.5, { react: false }); }], [8200, () => orbs.iris.setAttribute('reaction', 'idle')],
      [8000, L(orbs.kai, 'iris')], [8050, L(orbs.iris, 'boopis')], [8100, L(orbs.moss, 'kai')],
      [8800, () => [orbs.kai, orbs.moss, orbs.iris].forEach((o) => look(o, you[0], you[1]))],
      [9000, () => orbs.kai.blink()], [9080, () => orbs.moss.blink()], [9160, () => orbs.iris.blink()],
      [9300, () => ['kai', 'moss', 'iris'].forEach((n, i) => setTimeout(() => { orbs[n].setAttribute('reaction', 'happy'); orbs[n].poke(0.45, { react: false }); }, i * 90))],
      [10200, () => ['kai', 'moss', 'iris'].forEach((n) => orbs[n].setAttribute('reaction', 'idle'))]
    ]);
    const dir = SP.director(sp, [
      { t: 0, pose: 'you', dur: 1 }, { t: 600, blink: true }, { t: 820, blink: true },
      { t: 1100, posev: { y: 0.18, pitch: -10 }, dur: 380, look: [0, -0.4] }
    ], { reduced: R });
    return { dur: 10800, at(t) {
      cue(t); dir.at(t);
      const pb = sw(t);
      /* A: the words, then the eyes drop in: the speaker shrinks to half and falls into the orb, which grows round it */
      [$('.ob-h', A), $('.ob-lede', A)].forEach((e, i) => enter(e, t, i * 60));
      enter($('.ob-acts', A), t, 2000, D.d2, 4, 1, 'translateX(-50%)'); enter($('.ob-skip', A), t, 2000, D.d2, 0);
      press($('.ob-acts .btn.primary', A), t, 3900);
      const ks = R ? (t >= 1300 ? 1 : 0) : p(t, 1100, 380, E.spring);
      sp.style.transform = `scale(${lerp(1, 0.35, ks).toFixed(4)})`;
      /* the eyes fade only once the body is round them: white on the white body (ink on ink in light), so never two faces */
      sp.style.opacity = R ? String(t < 1250 ? 1 - p(t, 1100, 90) : 0) : String(t < 1320 ? 1 : 1 - E.lin((t - 1320) / 110));
      const kb = R ? E.lin((t - 1340) / 150) : p(t, 1300, 380, E.spring);
      /* the body is opaque from its first frame (a cross-fade would show its eyes and the speaker's at once) */
      bot.style.opacity = R ? String(kb) : (t >= 1300 ? '1' : '0');
      bot.style.transform = R ? '' : `scale(${lerp(0.45, 1, kb).toFixed(4)})`;
      /* the shared element: the boopis bot travels into the sidebar (reduced motion: a dip, then it is there) */
      if (R) { const q = t < 4150 ? [hx, hy, 1] : [target[0], target[1], S44]; fly.at(q[0], q[1], q[2]); fly.el.style.opacity = String(t < 4000 ? 1 : t < 4150 ? 1 - p(t, 4000, 90) : p(t, 4150, 90)); }
      else { const q = path(t); fly.at(q.x, q.y, q.s); }
      if (slotName) slotName.style.opacity = String(p(t, 4600, D.d2));
      /* B: its words, then the three bots asleep, each chip as it wakes */
      const nb = $('.ob2-nobots', A); if (nb) nb.style.opacity = String(1 - p(t, 3900, D.d2));
      [$('.ob-h', B), $('.ob-lede', B)].forEach((e, i) => enter(e, t, 4150 + i * 60));
      jobs.forEach((j, i) => { enter($('orb-avatar', j), t, 4400 + i * 80, D.d2, 0, 0.98); enter($('.chip', j), t, [5600, 6300, 7300][i], D.d2, 4); });
      enter($('.ob-acts', B), t, 8800, D.d2, 4, 1, 'translateX(-50%)'); enter($('.ob-skip', B), t, 8800, D.d2, 0);
    } };
  }

  /* ---------- O-M4: the team assembles in the sidebar (O-B09 -> O-B10): each bot is made, looks round, and flies to its row ---------- */
  function assemble() {
    const root = mount(S.obB09({ theme: 'dark' }));
    const win = $('.win', root);
    const th = $('.thread', root); const card = $('.thread .qcard', root);
    const rowsBox = $('.ob2-rows', win);
    const NEW = ['kai', 'moss', 'iris'];
    const rows = NEW.map((n) => { const r = addTo(rowsBox, `<div class="sb-row sq ob2-row" data-n="${n}">${O2.orb(n, 28, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm ell">${n}</span><span class="act ell">${O2.TEAM_ACT[n]}</span></div></div>`); O2.orbRules(r); window.V7.eyes(r); return r; });
    const ub = addTo(th, OB.you('Keep these rules'));
    const act = addTo(th, `<div class="activity">${window.V7.orb('boopis', 16, { state: 'working', surface: 'var(--bg-2)' })}<span class="shimmer"></span></div>`);
    const sys = addTo(th, `<div class="sysline act">${I('check')}Built at 09:47: 3 bots, 1 room, 1 routine (paused)<span class="btn tint">Undo</span></div>`);
    const fin = addTo(th, `<div class="b agent sq" style="margin-top:6px">kai, moss and iris are ready. They’re in your sidebar, under me.</div>`);
    O2.orbRules(th); window.V7.eyes(win);
    const h0 = card.offsetHeight;
    const main = $('.sb-main orb-avatar', win);
    const PH = [['Making kai', 1500], ['Making moss', 2900], ['Making iris', 4300], ['Seating the crew', 5700], ['Adding the routine, paused', 6300]];
    /* the newborn: a 44 px orb of its own (made where the work happens, above the composer), which lands on its row and gives way to
       the row's orb at the same size and the same gaze */
    const born = NEW.map((n, i) => { const e = addTo(root, `<span class="ob2-born" style="position:absolute;left:0;top:0;z-index:20">${O2.orb(n, 44, { surface: 'var(--bg-2)', state: 'happy' })}</span>`); O2.orbRules(e); window.V7.eyes(e); return e; });
    const BIRTH = [870, 430];
    const rowOrb = rows.map((r) => $('orb-avatar', r));
    rows.forEach((r) => { r.style.height = '0px'; r.style.overflow = 'hidden'; r.style.opacity = '0'; });
    const plans = NEW.map((n, i) => {
      const t0 = PH[i][1] + 120, tf = t0 + 900, tl = tf + 900;   /* it lands at tf + 640 and rests on its row while its eyes settle */
      return { t0, tf, tl, path: null };
    });
    const ro = rowOrb.map(() => null);
    const cue = calls([
      ...NEW.flatMap((n, i) => { const P = plans[i]; const b = $('orb-avatar', born[i]);
        const landed = () => ctr(rowOrb[i]);
        return [
          [P.t0 + 380, () => { b.setAttribute('reaction', 'idle'); look(b, ...ctr(main)); }],
          [P.t0 + 600, () => b.blink()],
          [P.tf - 200, () => turn(b)],                                                     /* the turn (0.72 s) ends before it lands */
          [P.tf + 540, () => { look(b); b.setAttribute('gaze', O2.SIDE_GAZE); }],         /* it settles on the sidebar's angle as it arrives */
          [P.tl, () => rowOrb[i].setAttribute('reaction', 'happy')],                       /* in the sidebar: states only */
          [P.tl + 900, () => rowOrb[i].setAttribute('reaction', 'idle')]
        ]; }),
      [6900, () => main.setAttribute('reaction', 'happy')],
      [7900, () => main.setAttribute('reaction', 'idle')]
    ]);
    return { dur: 8600, at(t) {
      cue(t);
      press($('.chip.on', card), t, 400);
      if (t >= 500) collapse(card, t, 500, h0);
      enter(ub, t, 560);
      enter(act, t, 1200);
      const cur = PH.filter(([, t0]) => t >= t0).pop(); const sp = $('.shimmer', act);
      if (cur && sp) { sp.textContent = cur[0]; }
      shimmer(t);
      if (t >= 6800) act.style.opacity = String(1 - p(t, 6800, D.d2));
      enter(sys, t, 6900); enter(fin, t, 7200);
      NEW.forEach((n, i) => {
        const P = plans[i], b = born[i];
        /* the row opens as the bot takes off (height 0 -> 44, 200 ms spring), its words after it lands */
        const kr = p(t, P.tf, D.d2, E.spring);
        set(rows[i], { height: `${lerp(0, 44, kr).toFixed(2)}px`, opacity: '1' });
        const words = $('.col', rows[i]); words.style.opacity = String(p(t, P.tl, D.d2));
        if (!P.path && t >= P.tf - 1) { const [lx, ly] = [ctr(rowOrb[i])[0], ctr(rowOrb[i])[1]]; P.end = [lx, ly]; }
        const end = P.end || [0, 0];
        /* born: from scale .3, a spring (300 ms), then it flies (600 ms, spring) along a small arc to its row, 44 -> 28 */
        let x = BIRTH[0], y = BIRTH[1], s = R ? 1 : lerp(0.3, 1, p(t, P.t0, D.d3, E.spring));
        if (t >= P.tf) { const k = R ? (t >= P.tf + 150 ? 1 : 0) : E.travel((t - P.tf) / 640); x = lerp(BIRTH[0], end[0], k); y = lerp(BIRTH[1], end[1], k) - (R ? 0 : Math.sin(Math.PI * Math.min(1, k)) * 60); s = lerp(1, 28 / 44, k); }
        const vis = t >= P.t0 && t < P.tl;
        b.style.opacity = R ? String(vis ? Math.min(p(t, P.t0, 90), t >= P.tf ? 1 - p(t, P.tf, 90) : 1) : 0) : String(vis ? Math.min(1, (t - P.t0) / 120) : 0);
        b.style.transform = `translate(${(x - 22).toFixed(2)}px, ${(y - 22).toFixed(2)}px) scale(${s.toFixed(4)})`; b.style.transformOrigin = '22px 22px';
        rowOrb[i].style.visibility = t >= P.tl ? 'visible' : 'hidden';
        if (R && t >= P.tf + 150 && t < P.tl) { rowOrb[i].style.visibility = 'visible'; }
      });
    } };
  }

  /* ---------- O-M5: Try it (O-S04), the speaker watching the composer, reacting to the reading ---------- */
  function tryit() {
    const root = mount(S.obS04({ theme: 'dark', phase: 'ask' }));
    const sp = $('.ob-spk', root);
    const ph = $('.composer .ph', root);
    const rc = $$('.ob-rcpt', root); const sent = rc[rc.length - 1];
    const ask = $('.thread .qcard', root);
    const tmp = document.createElement('div'); tmp.innerHTML = S.obS04({ theme: 'dark', phase: 'open' });
    const menu = [...tmp.querySelectorAll('.menu')].pop(); $('.win', root).appendChild(menu); window.V7.paint(menu);
    const under = $('.composer-under', root);
    const DRAFT = 'refactor the billing helpers and ship it';
    const A = [9, 28], B = [33, 40];
    const T0 = 700, CPS = 25, PAUSE = 450;
    const charAt = (t) => { const d = t - T0; if (d < 0) return 0; const n1 = Math.floor((d / 1000) * CPS); if (n1 <= 28) return Math.min(28, n1); const d2 = d - (28 / CPS) * 1000 - PAUSE; return d2 < 0 ? 28 : Math.min(40, 28 + Math.floor((d2 / 1000) * CPS)); };
    const doneAt = (n) => n <= 28 ? T0 + (n / CPS) * 1000 : T0 + (28 / CPS) * 1000 + PAUSE + ((n - 28) / CPS) * 1000;
    const tA = doneAt(28) + 250, tB = doneAt(40) + 250;
    const T_HOVER = tB + 900, T_OPEN = T_HOVER + 400, T_PICK = T_OPEN + 1300, T_ASK = T_PICK + 700, T_KEEP = T_ASK + 1500;
    const markHtml = (txt, t, t0, state) => { const k = R ? (t >= t0 ? 1 : 0) : p(t, t0, 180, E.sharp); return `<span class="mk2" data-state="${state}" style="--p:${(k * 100).toFixed(2)}%">${txt}</span>`; };
    const me = ctr(sp);
    /* the eyes follow the caret across the composer: x from -0.7 (its start) to 0.7 */
    const caretLook = []; for (let tt = T0 + 200; tt < doneAt(40); tt += 300) { const n = charAt(tt); caretLook.push({ t: tt, look: [-0.7 + 1.4 * (n / 40), -1] }); }
    const cues = [
      { t: 0, pose: 'down', dur: 1 },
      { t: T0, morph: 'listening', pose: 'tiltLeft', dur: 420 }, ...caretLook,
      { t: tA + 40, blink: true, bob: 0.06 },                           /* the first reading lands: it noticed */
      { t: tB + 40, morph: null, ...poseTo(me, [300 + 510 + 300, 760]), dur: 380, bob: 0.07 },
      { t: T_OPEN + 60, ...poseTo(me, [ctr(menu)[0], 650]), dur: 420 },
      { t: T_PICK + 40, nod: true, look: [0.3, -1] },
      { t: T_ASK + 60, ...poseTo(me, [870, 300]), dur: 420 },
      { t: T_KEEP + 60, morph: 'happy', hop: 0.2, pose: 'you', dur: 380 },
      { t: T_KEEP + 1100, morph: null }
    ];
    const dir = SP.director(sp, cues, { reduced: R });
    return { dur: T_KEEP + 1500, at(t) {
      dir.at(t);
      const n = charAt(t); const s = DRAFT.slice(0, n);
      const st = t >= T_PICK ? 'chosen' : t >= T_OPEN ? 'open' : t >= T_HOVER ? 'hover' : 'shown';
      let h = '';
      if (t >= tA && n >= 28) h = s.slice(0, A[0]) + markHtml(s.slice(A[0], A[1]), t, tA, 'shown') + s.slice(A[1], B[0]) + (t >= tB && n >= 40 ? markHtml(s.slice(B[0]), t, tB, st) : s.slice(B[0]));
      else h = s;
      const caret = t < T_OPEN && Math.floor(t / 530) % 2 === 0 ? '<span style="display:inline-block;width:1.5px;height:1em;background:var(--focus);vertical-align:-2px;margin-left:1px"></span>' : '';
      ph.innerHTML = (n ? h : '<span style="color:var(--text-quiet)">Message</span>') + caret;
      ph.classList.toggle('typed', n > 0);
      const send = $('.composer .ib.inv', root); const want = n > 0 ? 'arrowup' : 'waveform'; if (send && send.dataset.g !== want) { send.dataset.g = want; send.innerHTML = I(want); }
      if (under) under.style.opacity = String(p(t, tA, D.d2));
      if (t < T_OPEN) menu.style.opacity = '0';
      else if (t < T_PICK) { const k = p(t, T_OPEN, D.pop); set(menu, { opacity: String(k), transform: R ? '' : `translateY(${lerp(4, 0, k)}px) scale(${lerp(0.98, 1, k)})`, transformOrigin: '50% 100%' }); }
      else menu.style.opacity = String(1 - p(t, T_PICK, D.out));
      if (sent) enter(sent, t, T_PICK + 200);
      enter(ask, t, T_ASK);
      press($('.chip.on', ask), t, T_KEEP);
      if (t >= T_KEEP + 150) { const w = $('.word', ask); if (w) w.textContent = 'kept on'; const rowc = $('.row:last-child', ask); if (rowc) rowc.style.opacity = String(1 - p(t, T_KEEP + 150, D.out)); }
    } };
  }

  /* ---------- O-M7: the goal tiles (O-B04): the bots orbit the heading, watch the pointer's tile, and fly into the ones you pick ---------- */
  function goals() {
    const root = mount(S.obB04({ theme: 'dark', picks: 'none' }));
    const win = $('.win', root);
    const tiles = $$('.ob-gt', win); const byName = Object.fromEntries(tiles.map((e) => [e.dataset.goal, e]));
    const orbit = Object.fromEntries($$('.ob2-orbit', win).map((e) => [e.dataset.n, e]));
    const ob = Object.fromEntries(Object.entries(orbit).map(([n, e]) => [n, $('orb-avatar', e)]));
    Object.values(ob).forEach((o) => o.removeAttribute('gaze'));
    /* the picks: Code and reviews (kai), then Research and writing (iris); each bot leaves its orbit for the tile's disc */
    const PICK = [['Code and reviews', 'kai', 4200], ['Research and writing', 'iris', 6400]];
    const HOV = [['Videos and posts', 1700], ['Code and reviews', 2700], ['Research and writing', 5300], ['Data and reports', 7600]];
    const trips = PICK.map(([g, n, t0]) => {
      const tile = byName[g]; const disc = $('.ob-gt-i', tile);
      const from = ctr(ob[n]), to = ctr(disc); const s0 = +ob[n].getAttribute('size');
      const e = lift(ob[n], root); return { g, n, t0, tile, disc, from, to, s1: 28 / s0, fly: e };
    });
    const centre = (g) => ctr(byName[g]);
    const allLook = (g) => () => { const c = centre(g); Object.values(ob).forEach((o) => look(o, c[0], c[1])); };
    const cue = calls([
      ...HOV.map(([g, t]) => [t + 60, allLook(g)]),
      ...trips.flatMap((T) => [[T.t0 - 40, () => turn(ob[T.n])], [T.t0 + 560, () => { ob[T.n].setAttribute('reaction', 'happy'); ob[T.n].poke(0.4, { react: false }); }], [T.t0 + 1300, () => { ob[T.n].setAttribute('reaction', 'idle'); look(ob[T.n], 870, 560); }]]),
      [8400, () => Object.values(ob).forEach((o) => look(o, 870, 700))]
    ]);
    /* the orbit: each bot drifts round a small ellipse (8 x 5 px, 4.2 to 5.4 s), out of phase (onboarding scene motion) */
    const PER = { kai: [4200, 0], moss: [5400, 1.7], iris: [4800, 3.1] };
    return { dur: 9600, at(t) {
      cue(t);
      [$('.ob-h', win), $('.ob-lede', win)].forEach((e, i) => enter(e, t, i * 60));
      tiles.forEach((e, i) => enter(e, t, 200 + i * 40, D.d2, 4, 0.98));
      enter($('.ob-acts', win), t, 600, D.d2, 4, 1, 'translateX(-50%)'); enter($('.ob-skip', win), t, 600, D.d2, 0);
      const drift = (n) => { if (R) return [0, 0]; const [per, ph] = PER[n]; const a = (t / per) * Math.PI * 2 + ph; return [Math.cos(a) * 4, Math.sin(a) * 2.5]; };
      const entryOf = (i) => p(t, 300 + i * 80, D.d2);
      Object.entries(orbit).forEach(([n, e], i) => { enter(e, t, 300 + i * 80, D.d2, 0, 0.98); const [dx, dy] = drift(n); if (!R) e.style.transform += ` translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`; });
      tiles.forEach((e) => { const h = HOV.filter(([, t0]) => t >= t0).pop(); e.classList.toggle('hov', !!h && h[0] === e.dataset.goal && !trips.some((T) => T.g === e.dataset.goal && t >= T.t0)); });
      trips.forEach((T) => {
        const k = R ? (t >= T.t0 + 150 ? 1 : 0) : E.travel(clamp((t - T.t0) / 660, 0, 1));
        /* until its trip a lifted bot keeps its orbit's entry and drift; the drift hands over to the flight */
        const oi = Object.keys(orbit).indexOf(T.n); const [dx, dy] = drift(T.n);
        const x = lerp(T.from[0] + dx, T.to[0], k), y = lerp(T.from[1] + dy, T.to[1], k) - (R ? 0 : Math.sin(Math.PI * k) * 40);
        T.fly.at(x, y, lerp(1, T.s1, k));
        T.fly.el.style.opacity = String(R ? (t < T.t0 ? entryOf(oi) : t < T.t0 + 150 ? 1 - p(t, T.t0, 90) : p(t, T.t0 + 150, 90)) : entryOf(oi));
        /* the tile takes the bot's colour as it lands (120 ms), the icon's disc goes as the bot arrives */
        const on = t >= T.t0 + 560;   /* as it lands (the flight is 660 ms on the travel ease: 95% there at 560) */
        if (on && !T.tile.classList.contains('on')) { T.tile.classList.add('on'); T.tile.style.setProperty('--bot', window.V7.LOOKS[T.n].color); window.V7.paint(T.tile); }
        T.disc.style.opacity = String(1 - p(t, T.t0 + 200, D.hover));
        if (T.tile.classList.contains('on')) T.tile.style.opacity = '1';
      });
      press($('.ob-acts .btn.primary', win), t, 9000);
    } };
  }

  /* ---------- O-M6a and O-M6b: step to step. One speaker the whole way: it travels from page to page and into the canvas ---------- */
  function stepsChain(screens, plan) {
    /* screens: [[builder, opts]]; plan: per step i>0 {t0, speaker: {pose, ...}}; the floating speaker is the first screen's */
    const root = mount(screens[0][0]({ theme: 'dark', ...screens[0][1] }));
    const wins = [$('.win', root)]; wins[0].style.position = 'absolute';
    screens.slice(1).forEach(([b, o]) => wins.push(stack(root, b({ theme: 'dark', ...o }))));
    const sp0 = $('.ob-spk', wins[0]); const size0 = +sp0.dataset.size;
    const targets = wins.map((w) => { const s = $('.ob-spk', w); const c = ctr(s); return { c, s: +s.dataset.size / size0, el: s }; });
    wins.slice(1).forEach((w, i) => { targets[i + 1].el.style.visibility = 'hidden'; });
    const fly = lift(sp0, root);
    const path = tween({ x: targets[0].c[0], y: targets[0].c[1], s: 1 }, plan.map((P, i) => ({ t: P.t0 + 40, v: { x: targets[i + 1].c[0], y: targets[i + 1].c[1], s: targets[i + 1].s }, dur: P.dur || 640, ease: 'travel' })));
    const fades = plan.map((P, i) => swapper(wins[i], wins[i + 1], P.t0, false));
    /* one window shown at a time: the one whose page is current (a chain of swaps must not let a later page cover an earlier one) */
    const swaps = [(t) => { const idx = plan.filter((P) => t >= P.t0 + 120).length; wins.forEach((w, i) => { w.style.visibility = i === idx ? 'visible' : 'hidden'; }); fades.forEach((f) => f(t)); }];
    return { root, wins, fly, path, swaps, targets, sp: sp0 };
  }
  function stepsA() {
    const C = stepsChain([[S.obS01, {}], [S.obS02, {}], [S.obS03, {}]], [{ t0: 2600 }, { t0: 5600 }]);
    const [A, B, Cw] = C.wins;
    const card = $('.card', B), sayC = $$('.ob-say', Cw), qc = $('.qcard', Cw);
    const me = C.targets[2].c;
    const dir = SP.director(C.sp, [
      { t: 0, pose: 'you', dur: 1 }, { t: 900, pose: 'downLeft', dur: 380 }, { t: 1500, pose: 'down', dur: 380, look: [0, -1] },
      { t: 2550, hop: 0.12 },                                                          /* off it goes */
      { t: 2700, pose: 'down', dur: 420 }, { t: 3200, bob: 0.05 },
      { t: 3700, pose: 'downLeft', dur: 380 }, { t: 4200, pose: 'downRight', dur: 600, ease: 'inout' },
      { t: 5500, nod: true },
      { t: 5650, pose: 'you', dur: 420 },
      { t: 5900, bob: 0.07 }, { t: 6380, bob: 0.06 },
      { t: 6900, ...poseTo(me, [870, 520]), dur: 420 }, { t: 7600, blink: true }, { t: 8000, pose: 'you', dur: 420 }
    ], { reduced: R });
    return { dur: 8800, at(t) {
      dir.at(t);
      C.swaps.forEach((s) => s(t));
      const q = C.path(t);
      if (R) { const i = t < 2720 ? 0 : t < 5720 ? 1 : 2; const tg = C.targets[i]; C.fly.at(tg.c[0], tg.c[1], tg.s); const d = [2600, 5600].map((x) => (t >= x && t < x + 120 ? 1 - p(t, x, 90) : t >= x + 120 && t < x + 300 ? p(t, x + 120, 90) : 1)); C.fly.el.style.opacity = String(Math.min(...d)); }
      else C.fly.at(q.x, q.y, q.s);
      press($('.ob-acts .btn.primary', A), t, 2500);
      /* B: the words and the card, staggered */
      /* B's words come once the speaker has passed above them (it crosses the heading's line about 400 ms into its travel) */
      [$('.ob-h', B), $('.ob-lede', B)].forEach((e, i) => enter(e, t, 3120 + i * 60)); enter(card, t, 3240, D.d2, 4, 0.98);
      enter($('.ob-acts', B), t, 3300, D.d2, 4, 1, 'translateX(-50%)');
      press($('.ob-acts .btn.primary', B), t, 5500);
      /* C: the setup conversation; the composer and the pill come in, then each line with a bob */
      enter($('.sep', Cw), t, 5720); enter(sayC[0], t, 5900); enter(sayC[1], t, 6380); enter(qc, t, 6850, D.d2, 4, 0.98);
    } };
  }
  function stepsB() {
    /* Try it answered (O-S04, keep it on) -> the canvas (O-S05): the speaker travels from the stage into S41's mark;
       then a folder is added -> how careful (O-S06) -> the first task (O-S07): it stays, looking where each step needs it */
    const C = stepsChain([[S.obS04, { phase: 'ask' }], [S.obS05, {}], [S.obS06, {}], [S.obS07, {}]], [{ t0: 1400, dur: 680 }, { t0: 4200 }, { t0: 7000 }]);
    const [A, B, Cw, Dw] = C.wins;
    const dir = SP.director(C.sp, [
      { t: 0, pose: 'down', dur: 1 }, { t: 600, morph: 'happy', hop: 0.14, pose: 'you', dur: 380 }, { t: 1300, morph: null },
      { t: 1420, pose: 'down', dur: 300 }, { t: 2100, pose: 'you', dur: 420, bob: 0.06 },
      { t: 3200, ...poseTo(C.targets[1].c, ctr($('.btn.primary', B))), dur: 420 },
      { t: 4150, nod: true }, { t: 4300, pose: 'down', dur: 420 },
      { t: 5200, ...poseTo(C.targets[2].c, ctr($('.qcard .optrow.on', Cw))), dur: 420 }, { t: 5900, blink: true },
      { t: 6950, nod: true },
      { t: 7150, pose: 'you', dur: 420, bob: 0.05 },
      { t: 8000, morph: 'listening', pose: 'down', dur: 420 }, { t: 9300, morph: null, pose: 'you', dur: 420 }
    ], { reduced: R });
    return { dur: 10000, at(t) {
      dir.at(t);
      C.swaps.forEach((s) => s(t));
      const q = C.path(t);
      if (R) { const xs = [1400, 4200, 7000]; const i = xs.filter((x) => t >= x + 120).length; const tg = C.targets[i]; C.fly.at(tg.c[0], tg.c[1], tg.s); const d = xs.map((x) => (t >= x && t < x + 120 ? 1 - p(t, x, 90) : t >= x + 120 && t < x + 300 ? p(t, x + 120, 90) : 1)); C.fly.el.style.opacity = String(Math.min(...d)); }
      else C.fly.at(q.x, q.y, q.s);
      press($('.chip.on', A), t, 500);
      /* the canvas: its words and buttons; the dock rises from below (the slab 12 px, 300 ms spring) */
      [[B, 1520], [Cw, 4320], [Dw, 7120]].forEach(([W, t0]) => {
        const ns = $('.ns', W); [...ns.children].forEach((e, i) => { if (!e.matches('.ns-mark')) enter(e, t, t0 + i * 50); });
        const dk = $('.dock', W); if (dk && W === B) { const k = p(t, t0 + 100, D.d3, E.spring); dk.style.opacity = String(k); dk.style.translate = R ? '' : `0 ${lerp(12, 0, k).toFixed(2)}px`; }
      });
      press($('.btn.primary', B), t, 4100);
      press($('.qcard .btn.primary', Cw), t, 6900);
      /* the first task: the draft types itself, the speaker watches it */
      const ph = $('.composer .ph', Dw); const DR = 'Find why the tests fail on CI and fix it'; const n = t < 8000 ? 0 : Math.min(DR.length, Math.floor((t - 8000) / 40));
      if (ph && t >= 7120) { ph.textContent = n ? DR.slice(0, n) : 'What should change? @ files, $ skills, / commands'; ph.classList.toggle('typed', n > 0); }
    } };
  }

  Object.assign(window.CLIPS, { listen, alive, assemble, tryit, goals, stepsA, stepsB });
  window.OB2M2 = { look, turn, ctr, tween, poseTo, lift, partsOf, swapper, stack, collapse, addTo, hov, stepsChain };
})();
