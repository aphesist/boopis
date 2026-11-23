/* Onboarding revision 3, the clips: the same rules as revision 2 (every property a pure function of t; the logo's and orb2's own
   calls fired once as the clock passes their cue; rec3.cjs runs the page on a virtual clock at 60 fps). Revision 2's
   choreography is kept where the step is the same; what is new is the setup before the app, the app assembling round the
   speaker, and the hand-off (the oo mark becoming the boopis bot, the tab switching, boopis greeting in its chat). */
(function () {
  const S = window.SCREENS, SP = window.OB2S, O2 = window.OB2, OB = window.OB, O3 = window.OB3;
  const { E, D, R, p, lerp, $, $$, set, enter, press, shimmer, mount, calls } = window.OB2M;
  const { look, turn, ctr, tween, poseTo, lift, swapper, stack, collapse, addTo, hov, stepsChain } = window.OB2M2;
  const I = window.V7.I;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const typeInto = (ph, text, t, t0, cps, idle) => { if (!ph) return; const n = t < t0 ? 0 : Math.min(text.length, Math.floor((t - t0) / 1000 * cps)); ph.textContent = n ? text.slice(0, n) : idle; ph.classList.toggle('typed', n > 0); };
  /* reduced motion: a thing that would travel dips out at its old place and in at its new one (out 90, in 90 after 60 hidden) */
  const dip = (t, xs) => Math.min(1, ...xs.map((x) => (t >= x && t < x + 90 ? 1 - p(t, x, 90) : t >= x + 90 && t < x + 150 ? 0 : t >= x + 150 && t < x + 240 ? p(t, x + 150, 90) : 1)));

  /* ---------- O-M1: the speaker wakes and looks around (O-P01, the setup's first page) ---------- */
  function wake() {
    const root = mount(S.o3P01({ theme: 'dark', pose: 'rest', state: 'sleeping' }));
    const page = $('.ob-page', root);
    const h = $('.ob-h', page), l = $('.ob-lede', page), a = $('.ob-acts', page), skip = $('.ob-skip', root);
    const el = $('.ob-spk', page);
    const dir = SP.director(el, [
      { t: 0, posev: { pitch: -10, y: 0.05, roll: -3 }, dur: 1 },
      { t: 1200, morph: null, stretch: true, pose: 'rest', dur: 620, ease: 'spring', eyes: false },
      { t: 1560, blink: true }, { t: 1770, blink: true },
      { t: 2150, pose: 'left', dur: 420, blink: true },
      { t: 2900, pose: 'right', dur: 560, ease: 'turn' },
      { t: 3550, pose: 'upLeft', dur: 380 },
      { t: 4050, pose: 'turnRight', dur: 520, ease: 'turn', blink: true },          /* a full turn: the window is empty, it checks */
      { t: 4800, pose: 'you', dur: 460, hop: 0.14, morph: 'happy' },
      { t: 5750, morph: null },
      { t: 5050, bob: 0.05 }, { t: 5330, bob: 0.04 },
      { t: 6000, pose: 'downLeft', dur: 380 },
      { t: 6500, pose: 'downRight', dur: 640, ease: 'inout' },
      { t: 7300, posev: { x: 0, y: 0.05, yaw: 0, pitch: -18, roll: 0 }, look: [0, -1], dur: 420 },
      { t: 8100, pose: 'you', dur: 420, blink: true },
      { t: 8700, pose: 'upRight', dur: 420 },
      { t: 9300, pose: 'you', dur: 420 }, { t: 9420, blink: true }, { t: 9630, blink: true }
    ], { reduced: R, from: { pitch: -10, y: 0.05, roll: -3 } });
    return { dur: 10400, at(t) {
      dir.at(t);
      enter(h, t, 5000); enter(l, t, 5060);
      enter(a, t, 5300, D.d2, 4, 1, 'translateX(-50%)');
      enter(skip, t, 5300, D.d2, 0);
    } };
  }

  /* ---------- O-M6a: hello -> the engine settings -> the model, one speaker travelling between the setup pages ---------- */
  function stepsA() {
    const C = stepsChain([[S.o3P01, {}], [S.o3P02, {}], [S.o3P03, {}]], [{ t0: 2600 }, { t0: 5600 }]);
    const [A, B, Cw] = C.wins;
    const dir = SP.director(C.sp, [
      { t: 0, pose: 'you', dur: 1 }, { t: 900, pose: 'downLeft', dur: 380 }, { t: 1500, pose: 'down', dur: 380, look: [0, -1] },
      { t: 2550, hop: 0.12 },
      { t: 2700, pose: 'down', dur: 420 }, { t: 3200, bob: 0.05 },
      { t: 3700, pose: 'downLeft', dur: 380 }, { t: 4200, pose: 'downRight', dur: 600, ease: 'inout' },
      { t: 5500, nod: true },
      { t: 5650, pose: 'you', dur: 420 },
      { t: 5900, bob: 0.07 }, { t: 6380, bob: 0.06 },
      { t: 6900, pose: 'down', dur: 420 }, { t: 7600, blink: true }, { t: 8000, pose: 'you', dur: 420 }
    ], { reduced: R });
    return { dur: 8800, at(t) {
      dir.at(t);
      C.swaps.forEach((s) => s(t));
      if (R) { const i = t < 2720 ? 0 : t < 5720 ? 1 : 2; const tg = C.targets[i]; C.fly.at(tg.c[0], tg.c[1], tg.s); C.fly.el.style.opacity = String(dip(t, [2600, 5600])); }
      else { const q = C.path(t); C.fly.at(q.x, q.y, q.s); }
      press($('.ob-acts .btn.primary', A), t, 2500);
      /* B's words come once the speaker has passed above them */
      [$('.ob-h', B), $('.ob-lede', B)].forEach((e, i) => enter(e, t, 3120 + i * 60)); enter($('.card', B), t, 3240, D.d2, 4, 0.98);
      enter($('.ob-acts', B), t, 3300, D.d2, 4, 1, 'translateX(-50%)');
      press($('.ob-acts .btn.primary', B), t, 5500);
      [$('.ob-h', Cw), $('.ob-lede', Cw)].forEach((e, i) => enter(e, t, 5900 + i * 60)); enter($('.qcard', Cw), t, 6380, D.d2, 4, 0.98);
      enter($('.ob-acts', Cw), t, 6850, D.d2, 4, 1, 'translateX(-50%)');
    } };
  }

  /* ---------- O-M2: the speaker reacts while you choose the model (O-P03) ---------- */
  function listen() {
    const root = mount(S.o3P03({ theme: 'dark' }));
    const page = $('.ob-page', root), sp = $('.ob-spk', root);
    const card = $('.qcard', page), rows = $$('.optrow', card), acts = $('.ob-acts', page), btn = $('.btn.primary', acts);
    const rc = addTo(page, `<div class="ob2-rcpts ob3-rc ob3-lrc">${OB.rcpt('Connected: Claude, your subscription. Starts on Claude Opus.')}</div>`);
    rc.style.position = 'absolute'; rc.style.left = '0'; rc.style.right = '0'; rc.style.top = `${card.offsetTop + card.offsetHeight}px`;
    const me = ctr(sp);
    const at = (el, ex = {}) => ({ ...poseTo(me, ctr(el)), dur: 420, ...ex });
    const dir = SP.director(sp, [
      { t: 0, pose: 'you', dur: 1 },
      { t: 150, bob: 0.07 }, { t: 620, bob: 0.06 },
      { t: 1100, ...at(card) },
      { t: 1700, ...at(rows[1]) }, { t: 2350, ...at(rows[2]), blink: true }, { t: 3000, ...at(rows[0]) },
      { t: 3500, ...at(btn) },
      { t: 3930, nod: true },
      { t: 4080, hop: 0.18, morph: 'happy', pose: 'you', dur: 380 },
      { t: 4600, ...at(rc), eyes: true }, { t: 4760, blink: true },
      { t: 5250, morph: null },
      { t: 5400, pose: 'you', dur: 380, bob: 0.07 },
      { t: 6300, pose: 'upLeft', dur: 420 }, { t: 7200, pose: 'you', dur: 420, blink: true },
      { t: 8200, pose: 'down', dur: 420 }, { t: 9000, pose: 'you', dur: 420 }
    ], { reduced: R });
    return { dur: 9600, at(t) {
      dir.at(t);
      enter($('.ob-h', page), t, 0, 1); enter($('.ob-lede', page), t, 0, 1);
      hov(rows[1], t >= 1700 && t < 2350); hov(rows[2], t >= 2350 && t < 3000); hov(rows[0], t >= 3000 && t < 3500);
      if (btn) btn.style.filter = t >= 3500 && t < 4100 ? 'brightness(0.92)' : '';
      press(btn, t, 3880);
      /* answered: the actions give way to the receipt (the page moves on to Try it next, O-M6b's start) */
      if (t >= 4080) acts.style.opacity = String(1 - p(t, 4080, D.out, E.out));
      enter(rc, t, 4300);
      rows.forEach((r, i) => { if (i) r.style.opacity = String(t >= 4080 ? 1 - 0.6 * p(t, 4080, D.d2) : 1); });
    } };
  }

  /* ---------- O-M5: Try it (O-P04): the draft types itself, the reading marks it, a mark is answered, keep it on ---------- */
  function tryit() {
    const root = mount(S.o3P04({ theme: 'dark', phase: 'shown' }));
    const page = $('.ob-page', root), sp = $('.ob-spk', root);
    const ask = stack(root, S.o3P04({ theme: 'dark', phase: 'ask' }));
    const A = $('.win', root);
    const tmp = document.createElement('div'); tmp.innerHTML = S.o3P04({ theme: 'dark', phase: 'open' });
    const menu = tmp.querySelector('.ob3-menu'); $('.ob3-tryscene', A).appendChild(menu); window.V7.paint(menu);
    const ph = $('.composer .ph', A), under = $('.composer-under', A);
    const DRAFT = 'refactor the billing helpers and ship it';
    const MA = [9, 28], MB = [33, 40];
    const T0 = 700, CPS = 25, PAUSE = 450;
    const charAt = (t) => { const d = t - T0; if (d < 0) return 0; const n1 = Math.floor((d / 1000) * CPS); if (n1 <= 28) return Math.min(28, n1); const d2 = d - (28 / CPS) * 1000 - PAUSE; return d2 < 0 ? 28 : Math.min(40, 28 + Math.floor((d2 / 1000) * CPS)); };
    const doneAt = (n) => n <= 28 ? T0 + (n / CPS) * 1000 : T0 + (28 / CPS) * 1000 + PAUSE + ((n - 28) / CPS) * 1000;
    const tA = doneAt(28) + 250, tB = doneAt(40) + 250;
    const T_HOVER = tB + 900, T_OPEN = T_HOVER + 400, T_PICK = T_OPEN + 1300, T_ASK = T_PICK + 900, T_KEEP = T_ASK + 1500;
    const markHtml = (txt, t, t0, state) => { const k = R ? (t >= t0 ? 1 : 0) : p(t, t0, 180, E.sharp); return `<span class="mk2" data-state="${state}" style="--p:${(k * 100).toFixed(2)}%">${txt}</span>`; };
    const me = ctr(sp);
    const caretLook = []; for (let tt = T0 + 200; tt < doneAt(40); tt += 300) { const n = charAt(tt); caretLook.push({ t: tt, look: [-0.7 + 1.4 * (n / 40), -1] }); }
    const compC = ctr($('.composer', A));
    /* the page's words hand over to the ask (the same page, its heading, lede and actions change; the composer stays) */
    const swapIn = [$('.ob-h', ask), $('.ob-lede', ask), $('.ob-acts', ask)];
    const swapOut = [$('.ob-h', A), $('.ob-lede', A), $('.ob-acts', A)];
    swapIn.forEach((e) => { e.style.visibility = 'visible'; e.style.opacity = '0'; });
    const askC = $('.composer', ask).parentElement.parentElement; askC.style.visibility = 'hidden';
    const dir = SP.director(sp, [
      { t: 0, pose: 'down', dur: 1 },
      { t: T0, morph: 'listening', pose: 'tiltLeft', dur: 420 }, ...caretLook,
      { t: tA + 40, blink: true, bob: 0.06 },
      { t: tB + 40, morph: null, ...poseTo(me, [compC[0] + 150, compC[1]]), dur: 380, bob: 0.07 },
      { t: T_OPEN + 60, ...poseTo(me, [compC[0] + 150, compC[1] - 120]), dur: 420 },
      { t: T_PICK + 40, nod: true, look: [0.3, -1] },
      { t: T_ASK + 60, pose: 'you', dur: 420 },
      { t: T_KEEP + 60, morph: 'happy', hop: 0.2, pose: 'you', dur: 380 },
      { t: T_KEEP + 1100, morph: null }
    ], { reduced: R });
    return { dur: T_KEEP + 1500, at(t) {
      dir.at(t);
      const n = charAt(t); const s = DRAFT.slice(0, n);
      const st = t >= T_PICK ? 'chosen' : t >= T_OPEN ? 'open' : t >= T_HOVER ? 'hover' : 'shown';
      let h = s;
      if (t >= tA && n >= 28) h = s.slice(0, MA[0]) + markHtml(s.slice(MA[0], MA[1]), t, tA, 'shown') + s.slice(MA[1], MB[0]) + (t >= tB && n >= 40 ? markHtml(s.slice(MB[0]), t, tB, st) : s.slice(MB[0]));
      const caret = t < T_OPEN && Math.floor(t / 530) % 2 === 0 ? '<span style="display:inline-block;width:1.5px;height:1em;background:var(--focus);vertical-align:-2px;margin-left:1px"></span>' : '';
      ph.innerHTML = (n ? h : '<span style="color:var(--text-quiet)">Message</span>') + caret;
      ph.classList.toggle('typed', n > 0);
      const send = $('.composer .ib.inv', A); const want = n > 0 ? 'arrowup' : 'waveform'; if (send && send.dataset.g !== want) { send.dataset.g = want; send.innerHTML = I(want); }
      if (under) { under.style.opacity = String(p(t, tA, D.d2)); const last = under.lastElementChild; if (last) last.textContent = t >= T_PICK + 200 ? 'Sent with it: open a pull request' : 'Nothing is sent'; }
      if (t >= T_OPEN && !menu.dataset.placed) { menu.dataset.placed = '1'; O3.place(A); }
      if (t < T_OPEN) menu.style.opacity = '0';
      else if (t < T_PICK) { const k = p(t, T_OPEN, D.pop); set(menu, { opacity: String(k), transform: R ? '' : `translateY(${lerp(4, 0, k)}px) scale(${lerp(0.98, 1, k)})`, transformOrigin: '50% 100%' }); }
      else menu.style.opacity = String(1 - p(t, T_PICK, D.out));
      enter($('.ob-acts', A), t, 300, D.d2, 4, 1, 'translateX(-50%)');
      if (t >= T_ASK) { swapOut.forEach((e) => { e.style.opacity = String(1 - p(t, T_ASK, 120, E.out)); }); }
      if (t >= T_ASK + 120) { swapOut.forEach((e) => { e.style.visibility = 'hidden'; }); enter(swapIn[0], t, T_ASK + 120); enter(swapIn[1], t, T_ASK + 180); enter(swapIn[2], t, T_ASK + 240, D.d2, 4, 1, 'translateX(-50%)'); }
      press($('.btn.primary', swapIn[2]), t, T_KEEP);
    } };
  }

  /* ---------- O-M6b: Try it answered -> the app opens round the speaker (Sessions) -> the folder, the worktree, how careful, ready ---------- */
  function stepsB() {
    const T = [1400, 4000, 6400, 8800];
    const C = stepsChain([[S.o3P04, { phase: 'ask' }], [S.o3S01, {}], [S.o3S02, {}], [S.o3S03, {}], [S.o3S04, {}]], T.map((t0, i) => ({ t0, dur: i ? 640 : 680 })));
    const [A, B, Cw, Dw, Ew] = C.wins;
    const dir = SP.director(C.sp, [
      { t: 0, pose: 'you', dur: 1 }, { t: 500, morph: 'happy', hop: 0.14 }, { t: 1250, morph: null },
      { t: 1420, pose: 'down', dur: 300 }, { t: 2150, pose: 'you', dur: 420, bob: 0.06 },
      { t: 3000, ...poseTo(C.targets[1].c, ctr($('.btn.primary', B))), dur: 420 },
      { t: 3950, nod: true }, { t: 4100, pose: 'down', dur: 420 },
      { t: 5000, ...poseTo(C.targets[2].c, ctr($('.qcard .optrow.on', Cw))), dur: 420 }, { t: 5600, blink: true },
      { t: 6350, nod: true }, { t: 6500, pose: 'down', dur: 420 },
      { t: 7400, ...poseTo(C.targets[3].c, ctr($('.qcard .optrow.on', Dw))), dur: 420 }, { t: 8000, blink: true },
      { t: 8750, nod: true },
      { t: 8950, pose: 'you', dur: 420, bob: 0.05 }, { t: 9600, morph: 'happy', hop: 0.12 }, { t: 10400, morph: null }
    ], { reduced: R });
    /* the app's own chrome assembles round the speaker as it travels: the sidebar from the left, the title pill and the composer */
    const side = $('.side', B), drag = $('.drag', B), comp = $('.main > div:last-child', B);
    return { dur: 11200, at(t) {
      dir.at(t);
      C.swaps.forEach((s) => s(t));
      if (R) { const i = T.filter((x) => t >= x + 120).length; const tg = C.targets[i]; C.fly.at(tg.c[0], tg.c[1], tg.s); C.fly.el.style.opacity = String(dip(t, T)); }
      else { const q = C.path(t); C.fly.at(q.x, q.y, q.s); }
      press($('.btn.primary', A), t, 1300);
      if (t >= T[0] + 120) {
        const k = p(t, T[0] + 140, D.d3, E.travel);
        set(side, { opacity: String(p(t, T[0] + 140, D.d2)), transform: R ? '' : `translateX(${lerp(-16, 0, k).toFixed(2)}px)` });
        drag.style.opacity = String(p(t, T[0] + 260, D.d2));
        set(comp, { opacity: String(p(t, T[0] + 320, D.d2)), translate: R ? '' : `0 ${lerp(8, 0, p(t, T[0] + 320, D.d3, E.travel)).toFixed(2)}px` });
      }
      [[B, T[0] + 520], [Cw, T[1] + 120], [Dw, T[2] + 120], [Ew, T[3] + 120]].forEach(([W, t0]) => {
        const ns = $('.ns', W); [...ns.children].forEach((e, i) => { if (!e.matches('.ns-mark')) enter(e, t, t0 + i * 50); });
      });
      press($('.btn.primary', B), t, 3900);
      press($('.qcard .btn.primary', Cw), t, 6300);
      press($('.qcard .btn.primary', Dw), t, 8700);
    } };
  }

  /* ---------- O-M8: THE HAND-OFF. Mark A says one more thing, morphs into the boopis bot, the tab switches to Bots by itself
     (Later visible until it does), and boopis greets you in its own chat ---------- */
  function handoff() {
    const root = mount(S.o3S04({ theme: 'dark' }));
    const A = $('.win', root); A.style.position = 'absolute';
    const H = stack(root, S.o3H01({ theme: 'dark' }));
    const B = stack(root, S.o3B01({ theme: 'dark' }));
    const T_H = 900, T_MORPH = 2900, T_TAB = 4200;
    /* one speaker: A's mark is lifted into the floating layer; H's mark is hidden (it travels to H's spot as the words re-centre) */
    const spA = $('.ob-spk', A), spH = $('.ob-spk', H); const cA = ctr(spA), cH = ctr(spH); spH.style.visibility = 'hidden';
    const fly = lift(spA, root);
    const spath = tween({ x: cA[0], y: cA[1] }, [{ t: T_H + 40, v: { x: cH[0], y: cH[1] }, dur: 640, ease: 'travel' }]);
    /* the boopis bot: B's own chat-head orb, lifted; it is born where the mark is, then travels to the chat's head */
    const headOrb = $('.ob3-ch-orb orb-avatar', B); const cB = ctr(headOrb);
    headOrb.setAttribute('reaction', 'sleeping'); headOrb.setAttribute('gaze', '0 -4');
    const ofly = lift(headOrb, root);
    const opath = tween({ x: cH[0], y: cH[1] }, [{ t: T_TAB + 60, v: { x: cB[0], y: cB[1] }, dur: 680, ease: 'travel' }]);
    /* the sidebar: H's stays on screen while its switch slides to Bots and its list empties; then B's (identical by then) takes
       over and boopis appears in its main slot, at the sidebar's fixed pose */
    const sideH = $('.side', H), sideB = $('.side', B), seg = $('.seg', sideH), segS = seg.children[0], segB = seg.children[1];
    const listH = $('.side > .s.dim', H) || [...sideH.children][1];
    const slot = $('.sb-main', sideB); slot.style.opacity = '0';
    const pill = document.createElement('span'); pill.className = 'ob3-segpill';
    const r0 = segS.getBoundingClientRect(), r1 = segB.getBoundingClientRect(), rs = seg.getBoundingClientRect();
    pill.style.cssText = `position:absolute;top:${r0.top - rs.top}px;left:0;height:${r0.height}px;border-radius:var(--r-pill);background:var(--seg-on);box-shadow:var(--seg-on-sh);z-index:0`;
    seg.style.position = 'relative'; seg.insertBefore(pill, seg.firstChild); [segS, segB].forEach((e) => { e.style.position = 'relative'; e.style.zIndex = '1'; e.classList.remove('on'); e.style.background = 'transparent'; e.style.boxShadow = 'none'; });
    const segPos = (k) => { pill.style.transform = `translateX(${lerp(r0.left - rs.left, r1.left - rs.left, k).toFixed(2)}px)`; pill.style.width = `${lerp(r0.width, r1.width, k).toFixed(2)}px`; segS.style.color = k < 0.5 ? 'var(--text)' : 'var(--text-dim)'; segB.style.color = k < 0.5 ? 'var(--text-dim)' : 'var(--text)'; };
    const swAH = swapper(A, H, T_H, false), swHB = swapper(H, B, T_TAB, false);
    const cd = $('.ob3-auto .s', H);
    const thB = $('.thread', B); const head = $('.ob3-chathead', B); const hName = [$('.nm', head), $('.xs', head)];
    const lines = [$('.sep', thB), ...$$('.thread > .b.agent', B)], card = $('.thread > .ob-ch', B);
    const optA = card && $('.opt', card);
    const me = cH;
    const segC = ctr(segB);
    const dir = SP.director(spA, [
      { t: 0, pose: 'you', dur: 1 },
      { t: T_H + 300, bob: 0.07 }, { t: T_H + 760, bob: 0.05 },
      { t: 1950, ...poseTo(me, segC), dur: 520, ease: 'turn', blink: true },           /* it looks over at the Bots tab */
      { t: 2550, pose: 'you', dur: 420 },
      { t: T_MORPH, posev: { y: 0.18, pitch: -10 }, dur: 380, look: [0, -0.4] }           /* the eyes drop into the body */
    ], { reduced: R });
    const cue = calls([
      [T_MORPH + 600, () => { headOrb.setAttribute('reaction', 'idle'); headOrb.emote && headOrb.emote('wake'); }],
      [T_MORPH + 900, () => { headOrb.setAttribute('reaction', 'happy'); headOrb.poke(0.5, { react: false }); }],
      [T_TAB - 100, () => { headOrb.setAttribute('reaction', 'idle'); headOrb.blink(); }],
      [T_TAB + 760, () => { headOrb.setAttribute('reaction', 'happy'); headOrb.poke(0.45, { react: false }); }],
      [T_TAB + 1700, () => headOrb.setAttribute('reaction', 'idle')],
      [5900, () => headOrb.blink()],
      [6700, () => { const c = ctr(card); look(headOrb, c[0], c[1]); }],
      [8100, () => { const c = ctr(optA); look(headOrb, c[0], c[1]); }],
      [9000, () => look(headOrb, 870, 900)], [9300, () => headOrb.blink()]
    ]);
    const W51 = SP.W(44);
    return { dur: 10000, at(t) {
      cue(t); dir.at(t);
      /* windows: one shown at a time; H's sidebar stays until B's matches it */
      const idx = t < T_H + 120 ? 0 : t < T_TAB + 120 ? 1 : 2;
      [A, H, B].forEach((w, i) => { w.style.visibility = i === idx ? 'visible' : 'hidden'; });
      swAH(t); swHB(t);
      const sideSwap = T_TAB + 320;
      sideH.style.visibility = idx >= 1 && t < sideSwap ? 'visible' : ''; sideB.style.visibility = t >= sideSwap ? 'visible' : 'hidden';
      segPos(R ? (t >= T_TAB ? 1 : 0) : p(t, T_TAB, D.d2, E.sharp));
      if (listH) listH.style.opacity = String(1 - p(t, T_TAB, D.out, E.out));
      slot.style.opacity = String(p(t, T_TAB + 900, D.d2));
      /* H: its words; the countdown; Later visible until the tab switches */
      ['.ns-h', '.ob3-nss', '.ob3-auto'].forEach((s, i) => enter($(s, H), t, T_H + 160 + i * 60));
      if (cd) cd.textContent = `Opening Bots in ${t < T_H + 1300 ? 3 : t < T_H + 2300 ? 2 : 1} s`;
      /* the speaker: travels to H's spot; then shrinks into the bot, the bot opaque round it from its first frame */
      if (R) { fly.at(t < T_H + 120 ? cA[0] : cH[0], t < T_H + 120 ? cA[1] : cH[1], 1); fly.el.style.opacity = String(Math.min(dip(t, [T_H]), t < T_MORPH ? 1 : 1 - p(t, T_MORPH, 90))); }
      else { const q = spath(t); const ks = p(t, T_MORPH, 380, E.spring); fly.at(q.x, q.y, lerp(1, 0.35, ks)); fly.el.style.opacity = String(t < T_MORPH + 220 ? 1 : 1 - E.lin((t - T_MORPH - 220) / 110)); }
      /* the bot: born at the mark (from .45, 380 spring), then travels to the chat's head as the tab switches */
      const kb = R ? E.lin((t - T_MORPH - 240) / 90) : p(t, T_MORPH + 200, 380, E.spring);
      const born = t >= T_MORPH + (R ? 240 : 200);
      if (R) { const q = t < T_TAB + 150 ? cH : cB; ofly.at(q[0], q[1], 1); ofly.el.style.opacity = String(born ? Math.min(kb, dip(t, [T_TAB])) : 0); }
      else { const q = opath(t); ofly.at(q.x, q.y + (t < T_TAB ? 0.18 * W51 * 0 : 0), lerp(0.45, 1, kb)); ofly.el.style.opacity = born ? '1' : '0'; }
      /* B: boopis's chat: its name, then its lines, each landing with a blink; the choice card; a row under the pointer */
      hName.forEach((e, i) => enter(e, t, T_TAB + 700 + i * 60));
      lines.forEach((e, i) => enter(e, t, [5100, 5400, 6000][i] || 6000));
      enter(card, t, 6600, D.d2, 4, 0.98);
      hov(optA, t >= 8000);
    } };
  }

  /* ---------- O-M3: what bots are (O-B02): three bots in boopis's chat wake one by one, look at each other and at boopis ---------- */
  function alive() {
    const root = mount(S.o3B02({ theme: 'dark', asleep: '1' }));
    const win = $('.win', root); const th = $('.thread', win);
    const ub = $('.b.user', th), says = $$('.thread > .b.agent', win), card = $('.ob3-team', win);
    const orbs = Object.fromEntries($$('.ob3-tm', card).map((j) => [j.dataset.n, $('orb-avatar', j)]));
    const chips = Object.fromEntries($$('.ob3-tm', card).map((j) => [j.dataset.n, $('.chip', j)]));
    const main = ctr($('.sb-main orb-avatar', win)); const you = [870, 900];
    const L = (o, n) => () => { const c = n === 'you' ? you : n === 'boopis' ? main : ctr(orbs[n]); look(o, c[0], c[1]); };
    const cue = calls([
      [2000, () => { orbs.kai.setAttribute('reaction', 'idle'); orbs.kai.emote('wake'); }], [2450, L(orbs.kai, 'boopis')],
      [2700, () => { orbs.kai.setAttribute('reaction', 'happy'); orbs.kai.poke(0.5, { react: false }); }], [3350, () => orbs.kai.setAttribute('reaction', 'idle')],
      [2800, () => { orbs.moss.setAttribute('reaction', 'idle'); orbs.moss.emote('wake'); }], [3150, L(orbs.moss, 'kai')], [3250, L(orbs.kai, 'moss')],
      [3600, () => turn(orbs.moss)], [4200, L(orbs.moss, 'boopis')],
      [3800, () => { orbs.iris.setAttribute('reaction', 'idle'); orbs.iris.emote('doubletake'); }],
      [4250, L(orbs.iris, 'moss')], [4350, L(orbs.moss, 'iris')],
      [4550, () => { orbs.iris.setAttribute('reaction', 'happy'); orbs.iris.poke(0.5, { react: false }); }], [5200, () => orbs.iris.setAttribute('reaction', 'idle')],
      [5000, L(orbs.kai, 'iris')], [5050, L(orbs.iris, 'kai')], [5100, L(orbs.moss, 'kai')],
      [5800, () => ['kai', 'moss', 'iris'].forEach((n) => L(orbs[n], 'you')())],
      [6000, () => orbs.kai.blink()], [6080, () => orbs.moss.blink()], [6160, () => orbs.iris.blink()],
      [6300, () => ['kai', 'moss', 'iris'].forEach((n, i) => setTimeout(() => { orbs[n].setAttribute('reaction', 'happy'); orbs[n].poke(0.45, { react: false }); }, i * 90))],
      [7200, () => ['kai', 'moss', 'iris'].forEach((n) => orbs[n].setAttribute('reaction', 'idle'))],
      [7600, L(orbs.kai, 'moss')], [7700, L(orbs.iris, 'boopis')], [8300, () => ['kai', 'moss', 'iris'].forEach((n) => L(orbs[n], 'you')())]
    ]);
    return { dur: 9200, at(t) {
      cue(t);
      enter($('.sep', th), t, 0, 1); enter(ub, t, 100); enter(says[0], t, 500); enter(says[1], t, 1000);
      enter(card, t, 1300, D.d2, 4, 0.98);
      Object.entries(chips).forEach(([n, c], i) => enter(c, t, [2600, 3300, 4300][i], D.d2, 4));
      enter($('.ob-foot', card), t, 6500);
    } };
  }

  /* ---------- O-M7: the goal tiles in boopis's chat (O-B03): the free bots watch the tile under the pointer; a pick sends one in ---------- */
  function goals() {
    const root = mount(S.o3B03({ theme: 'dark', picks: 'none' }));
    const win = $('.win', root);
    const card = $('.ob3-goals', win), tiles = $$('.ob-gt', card); const byName = Object.fromEntries(tiles.map((e) => [e.dataset.goal, e]));
    const free = Object.fromEntries($$('.ob3-free', card).map((e) => [e.dataset.n, $('orb-avatar', e)]));
    Object.values(free).forEach((o) => o.removeAttribute('gaze'));
    const next = $('.ob-foot .chip', card), count = $('.ob-foot .xs', card);
    const PICK = [['Code and reviews', 'kai', 3600], ['Research and writing', 'iris', 5800]];
    const HOV = [['Videos and posts', 1500], ['Code and reviews', 2400], ['Research and writing', 4700], ['Data and reports', 7000]];
    const trips = PICK.map(([g, n, t0]) => { const tile = byName[g]; const disc = $('.ob-gt-i', tile); const from = ctr(free[n]), to = ctr(disc); const e = lift(free[n], root); return { g, n, t0, tile, disc, from, to, s1: 28 / 24, fly: e }; });
    const allLook = (g) => () => { const c = ctr(byName[g]); Object.values(free).forEach((o) => look(o, c[0], c[1])); };
    const cue = calls([
      ...HOV.map(([g, t]) => [t + 60, allLook(g)]),
      ...trips.flatMap((T) => [[T.t0 - 40, () => turn(free[T.n])], [T.t0 + 560, () => { free[T.n].setAttribute('reaction', 'happy'); free[T.n].poke(0.4, { react: false }); }], [T.t0 + 1300, () => { free[T.n].setAttribute('reaction', 'idle'); look(free[T.n], 870, 860); }]]),
      [8200, () => Object.values(free).forEach((o) => look(o, 870, 860))]
    ]);
    return { dur: 9000, at(t) {
      cue(t);
      enter($('.sep', win), t, 0, 1); enter($('.b.user', win), t, 80); enter($('.thread > .b.agent', win), t, 400);
      enter(card, t, 800, D.d2, 4, 0.98);
      tiles.forEach((e) => { const h = HOV.filter(([, t0]) => t >= t0).pop(); e.classList.toggle('hov', !!h && h[0] === e.dataset.goal && !trips.some((T) => T.g === e.dataset.goal && t >= T.t0)); });
      let picked = 0;
      trips.forEach((T) => {
        const k = R ? (t >= T.t0 + 150 ? 1 : 0) : E.travel(clamp((t - T.t0) / 660, 0, 1));
        const x = lerp(T.from[0], T.to[0], k), y = lerp(T.from[1], T.to[1], k) - (R ? 0 : Math.sin(Math.PI * k) * 40);
        T.fly.at(x, y, lerp(1, T.s1, k));
        T.fly.el.style.opacity = String(R ? (t < T.t0 ? p(t, 800, D.d2) : t < T.t0 + 150 ? 1 - p(t, T.t0, 90) : p(t, T.t0 + 150, 90)) : p(t, 800, D.d2));
        const on = t >= T.t0 + 560;
        if (on) picked++;
        if (on && !T.tile.classList.contains('on')) { T.tile.classList.add('on'); T.tile.style.setProperty('--bot', window.V7.LOOKS[T.n].color); window.V7.paint(T.tile); }
        T.disc.style.opacity = String(1 - p(t, T.t0 + 200, D.hover));
      });
      next.classList.toggle('on', picked > 0); count.textContent = `${picked} of 3`;
      press(next, t, 8400);
    } };
  }

  /* ---------- O-M4: the team assembles in the sidebar (O-B07 -> O-B08): each bot is made, looks round, flies to its row ---------- */
  function assemble() {
    const root = mount(S.o3B07({ theme: 'dark' }));
    const win = $('.win', root);
    const th = $('.thread', root); const card = $('.thread .qcard', root);
    const rowsBox = $('.ob2-rows', win);
    const NEW = O3.TEAM3;
    /* the rows' orbs hold the sidebar's fixed pose from the start: the newborn settles on it before it lands */
    const rows = NEW.map((n) => { const r = addTo(rowsBox, `<div class="sb-row sq ob2-row" data-n="${n}">${O3.sideOrb(n, 28, { surface: 'var(--bg-1)' })}<div class="col grow"><span class="nm ell">${n}</span><span class="act ell">${O2.TEAM_ACT[n]}</span></div></div>`); O2.orbRules(r); window.V7.eyes(r); return r; });
    const ub = addTo(th, OB.you('Keep these rules'));
    const act = addTo(th, `<div class="activity">${window.V7.orb('boopis', 16, { state: 'working', surface: 'var(--bg-2)' })}<span class="shimmer"></span></div>`);
    const sys = addTo(th, `<div class="sysline act">${I('check')}Built at 09:47: 3 bots, 1 room, 1 routine (paused)<span class="btn tint">Undo</span></div>`);
    const fin = addTo(th, `<div class="b agent sq" style="margin-top:6px">kai, moss and iris are ready. They’re in your sidebar, under me.</div>`);
    O2.orbRules(th); window.V7.eyes(win);
    const h0 = card.offsetHeight;
    const main = $('.sb-main orb-avatar', win);
    const PH = [['Making kai', 1500], ['Making moss', 2900], ['Making iris', 4300], ['Seating the crew', 5700], ['Adding the routine, paused', 6300]];
    const born = NEW.map((n) => { const e = addTo(root, `<span class="ob2-born" style="position:absolute;left:0;top:0;z-index:20">${O2.orb(n, 44, { surface: 'var(--bg-2)', state: 'happy' })}</span>`); O2.orbRules(e); window.V7.eyes(e); return e; });
    const BIRTH = [870, 430];
    const rowOrb = rows.map((r) => $('orb-avatar', r));
    rows.forEach((r) => { r.style.height = '0px'; r.style.overflow = 'hidden'; r.style.opacity = '0'; });
    const plans = NEW.map((n, i) => { const t0 = PH[i][1] + 120, tf = t0 + 900, tl = tf + 900; return { t0, tf, tl }; });
    const cue = calls([
      ...NEW.flatMap((n, i) => { const P = plans[i]; const b = $('orb-avatar', born[i]);
        return [
          [P.t0 + 380, () => { b.setAttribute('reaction', 'idle'); look(b, ...ctr(main)); }],
          [P.t0 + 600, () => b.blink()],
          [P.tf - 200, () => turn(b)],
          [P.tf + 540, () => { look(b); b.setAttribute('gaze', O3.SIDE_POSE); }],
          [P.tl, () => rowOrb[i].setAttribute('reaction', 'happy')],
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
      const cur = PH.filter(([, t0]) => t >= t0).pop(); const spn = $('.shimmer', act);
      if (cur && spn) spn.textContent = cur[0];
      shimmer(t);
      if (t >= 6800) act.style.opacity = String(1 - p(t, 6800, D.d2));
      enter(sys, t, 6900); enter(fin, t, 7200);
      NEW.forEach((n, i) => {
        const P = plans[i], b = born[i];
        const kr = p(t, P.tf, D.d2, E.spring);
        set(rows[i], { height: `${lerp(0, 44, kr).toFixed(2)}px`, opacity: '1' });
        $('.col', rows[i]).style.opacity = String(p(t, P.tl, D.d2));
        if (!P.end && t >= P.tf - 1) P.end = ctr(rowOrb[i]);
        const end = P.end || [0, 0];
        let x = BIRTH[0], y = BIRTH[1], s = R ? 1 : lerp(0.3, 1, p(t, P.t0, D.d3, E.spring));
        if (t >= P.tf) { const k = R ? (t >= P.tf + 150 ? 1 : 0) : E.travel((t - P.tf) / 640); x = lerp(BIRTH[0], end[0], k); y = lerp(BIRTH[1], end[1], k) - (R ? 0 : Math.sin(Math.PI * Math.min(1, k)) * 60); s = lerp(1, 28 / 44, k); }
        const vis = t >= P.t0 && t < P.tl;
        b.style.opacity = R ? String(vis ? Math.min(p(t, P.t0, 90), t >= P.tf ? 1 - p(t, P.tf, 90) : 1) : 0) : String(vis ? Math.min(1, (t - P.t0) / 120) : 0);
        b.style.transform = `translate(${(x - 22).toFixed(2)}px, ${(y - 22).toFixed(2)}px) scale(${s.toFixed(4)})`; b.style.transformOrigin = '22px 22px';
        rowOrb[i].style.visibility = t >= P.tl || (R && t >= P.tf + 150) ? 'visible' : 'hidden';
      });
    } };
  }

  window.CLIPS3 = { wake, stepsA, listen, tryit, stepsB, handoff, alive, goals, assemble };
  /* revision 3's clips take revision 2's names in this page (rec3.cjs and qa3.cjs look them up in window.CLIPS) */
  Object.assign(window.CLIPS, window.CLIPS3);
})();
