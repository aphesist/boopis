/* Onboarding revision 2: the speaker (owner pick O04 A, pushed further): the boopis logomark, the "oo" mark of
   DESIGN-SYSTEM.md 20.1, as a living head. ONBOARDING ONLY (C02: onboarding may have its own animation).
   Two layers:
   - the EYES are the shipped <boopis-logo mark> with its own idle switched off (gaze="off", blink="off"): the speaker's
     director calls its own look(x, y), blink() and morph(state), so the eye shapes, the blink envelope and the morphs are
     the element's own, never redrawn;
   - the HEAD is a wrapper the eyes sit in. It travels, turns (rotateY in perspective: the pair compresses toward the
     side it turns to, the far eye smaller, as Grok-Bot's characters turn), nods (rotateX), tilts (roll), bobs, hops,
     squashes and breathes. There is no body: the head is only ever seen through what the eyes do.
   Every amplitude is in units of W, the pair's width (hero: type size 96, W = 111 px; stage: 44, W = 51 px).
   Stills always show the speaker at rest in a named pose (the sweep rule): no breath, no hop, no blink, no morph in flight. */
(function () {
  const W = (size) => size * 1.1556;   /* the pair's width at a type size (the element is 1.1556 em wide: 111 px at 96, 51 px at 44) */
  /* named poses for stills and for a director's targets: head travel (W), yaw, pitch, roll (deg), the eyes' look(x, y) */
  const POSES = {
    rest: { x: 0, y: 0, yaw: 0, pitch: 0, roll: 0, look: null },
    you: { x: 0, y: 0, yaw: 0, pitch: -4, roll: 0, look: [0, -0.15] },                      /* at the person, a touch down */
    down: { x: 0, y: 0.04, yaw: 0, pitch: -16, roll: 0, look: [0, -1] },                     /* at a card or the composer below */
    downLeft: { x: -0.06, y: 0.04, yaw: -14, pitch: -14, roll: -3, look: [-0.6, -0.9] },
    downRight: { x: 0.06, y: 0.04, yaw: 14, pitch: -14, roll: 3, look: [0.6, -0.9] },
    left: { x: -0.2, y: 0, yaw: -34, pitch: 0, roll: -2, look: [-1, 0] },
    right: { x: 0.2, y: 0, yaw: 34, pitch: 0, roll: 2, look: [1, 0] },
    upLeft: { x: -0.12, y: -0.04, yaw: -20, pitch: 12, roll: -5, look: [-0.8, 0.8] },     /* thinking: Grok's working look */
    upRight: { x: 0.12, y: -0.04, yaw: 20, pitch: 12, roll: 5, look: [0.8, 0.8] },
    tiltLeft: { x: 0, y: 0, yaw: -6, pitch: -6, roll: -9, look: [-0.3, -0.5] },              /* listening, head cocked */
    tiltRight: { x: 0, y: 0, yaw: 6, pitch: -6, roll: 9, look: [0.3, -0.5] },
    turnLeft: { x: -0.3, y: 0, yaw: -60, pitch: 0, roll: -3, look: [-1, 0.1] },            /* a full turn to look at a thing */
    turnRight: { x: 0.3, y: 0, yaw: 60, pitch: 0, roll: 3, look: [1, 0.1] }
  };
  /* markup: the speaker at a type size, in a pose and a state, at rest (stills) or live (clips set data-live) */
  function spk(size, o = {}) {
    const p = Object.assign({}, POSES[o.pose || 'rest'], o.posev || {});
    const w = W(size);
    const tf = headTf(p, w, 1, 1);
    const look = p.look ? ` data-look-x="${p.look[0]}" data-look-y="${p.look[1]}"` : '';
    const st = o.state && o.state !== 'idle' ? ` state="${o.state}"` : '';
    return `<span class="ob-spk${o.cls ? ' ' + o.cls : ''}" data-size="${size}" style="--spk:${size}px;--spk-w:${w.toFixed(1)}px${o.style ? ';' + o.style : ''}"><span class="ob-spk-h" style="transform:${tf}"><boopis-logo mark gaze="off" blink="off"${st}${look} label="boopis" style="font-size:${size}px;color:var(--text-strong)"></boopis-logo></span></span>`;
  }
  function headTf(p, w, sx = 1, sy = 1) {
    const persp = (w * 5.2).toFixed(0);
    return `translate(${(p.x * w).toFixed(2)}px, ${(p.y * w).toFixed(2)}px) perspective(${persp}px) rotateY(${(p.yaw || 0).toFixed(2)}deg) rotateX(${(p.pitch || 0).toFixed(2)}deg) rotate(${(p.roll || 0).toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  }
  /* settle every speaker's eyes in a still: look(x, y) to the pose's gaze (the element eases there, then rests) */
  function settle(root = document) {
    root.querySelectorAll('.ob-spk boopis-logo[data-look-x]').forEach((e) => { if (e.look) e.look(+e.dataset.lookX, +e.dataset.lookY); });
  }

  /* ---------- the director, for the clips: cues on a clip clock, evaluated as a pure function of t ---------- */
  const bez = (x1, y1, x2, y2) => (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, t = x; for (let i = 0; i < 28; i++) { t = (lo + hi) / 2; const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3; if (cx < x) lo = t; else hi = t; } return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3; };
  const EASE = {
    spring: bez(0.22, 1, 0.36, 1),        /* --spring: head travel and turns */
    sharp: bez(0.165, 0.84, 0.44, 1),     /* --ease-sharp */
    turn: bez(0.45, 0, 0.2, 1),           /* NEW, onboarding only: a full turn (accelerates out of rest, lands soft) */
    inout: bez(0.37, 0, 0.63, 1),         /* sine in-out: breath, scanning sweeps */
    out: bez(0, 0, 0.58, 1)
  };
  const CH = ['x', 'y', 'yaw', 'pitch', 'roll'];
  /* a clip's speaker: el = the .ob-spk. cues: [{t, pose | posev, dur, ease, look, blink, morph, bob, hop, nod, shake, stretch}] */
  function director(el, cues, o = {}) {
    const head = el.querySelector('.ob-spk-h'), eyes = el.querySelector('boopis-logo');
    const w = +el.style.getPropertyValue('--spk-w').replace('px', '') || W(+el.dataset.size || 96);
    const reduced = !!o.reduced;
    cues = cues.slice().sort((a, b) => a.t - b.t);
    const fired = new Set();
    const segs = {};
    CH.forEach((c) => { segs[c] = []; });
    let cur = Object.assign({}, POSES.rest, o.from || {});
    for (const q of cues) {
      if (!q.pose && !q.posev) continue;
      const p = Object.assign({}, q.pose ? POSES[q.pose] : {}, q.posev || {});
      for (const c of CH) if (p[c] !== undefined) segs[c].push({ t0: q.t + (c === 'x' || c === 'yaw' ? (q.lag ?? 60) : (q.lag ?? 60)), dur: q.dur || 420, to: p[c], ease: EASE[q.ease || 'spring'] });
    }
    /* each segment starts from wherever the previous one is at its start (a cue may interrupt one in flight) */
    for (const c of CH) {
      let prev = null; const v0 = (o.from && o.from[c] !== undefined) ? o.from[c] : 0;
      segs[c].sort((a, b) => a.t0 - b.t0);
      for (const s of segs[c]) { s.from = prev ? prev.from + (prev.to - prev.from) * prev.ease((s.t0 - prev.t0) / prev.dur) : v0; prev = s; }
    }
    const val = (c, t) => {
      let s = null; for (const x of segs[c]) { if (t >= x.t0) s = x; else break; }
      if (!s) return (o.from && o.from[c] !== undefined) ? o.from[c] : 0;
      return s.from + (s.to - s.from) * s.ease((t - s.t0) / s.dur);
    };
    /* additive moves (in W, or deg): a bob (a nod of the whole head), a hop, a stretch (waking), a nod, a shake */
    const bobs = cues.filter((q) => q.bob), hops = cues.filter((q) => q.hop), stretches = cues.filter((q) => q.stretch), nods = cues.filter((q) => q.nod), shakes = cues.filter((q) => q.shake);
    function add(t) {
      let y = 0, sx = 1, sy = 1, pitch = 0, yaw = 0;
      for (const q of bobs) {           /* bob: up 140 ms ease-out, down 200 ms spring, landing squash 160 ms */
        const u = t - q.t, a = (q.bob === true ? 0.07 : q.bob);
        if (u < 0 || u > 500) continue;
        if (u < 140) { const k = EASE.out(u / 140); y -= a * k; sy *= 1 + 0.035 * k; sx *= 1 - 0.025 * k; }
        else if (u < 340) { const k = EASE.spring((u - 140) / 200); y -= a * (1 - k); sy *= 1 + 0.035 * (1 - k); sx *= 1 - 0.025 * (1 - k); }
        else { const k = (u - 340) / 160; const s = Math.sin(Math.PI * k) * (1 - k * 0.3); sy *= 1 - 0.04 * s; sx *= 1 + 0.03 * s; }
      }
      for (const q of hops) {           /* hop: anticipation squash 90, up 170 ease-out, down 190 ease-in, land squash 180 */
        const u = t - q.t, a = (q.hop === true ? 0.22 : q.hop);
        if (u < 0 || u > 640) continue;
        if (u < 90) { const k = Math.sin((u / 90) * Math.PI / 2); sy *= 1 - 0.06 * k; sx *= 1 + 0.04 * k; }
        else if (u < 260) { const k = EASE.out((u - 90) / 170); y -= a * k; sy *= 1 - 0.06 * (1 - k) + 0.05 * Math.sin(k * Math.PI); sx *= 1 + 0.04 * (1 - k) - 0.035 * Math.sin(k * Math.PI); }
        else if (u < 450) { const k = (u - 260) / 190; y -= a * (1 - k * k); }
        else { const k = (u - 450) / 190; const s = Math.sin(Math.PI * Math.min(1, k)) * (1 - k * 0.4); sy *= 1 - 0.07 * s; sx *= 1 + 0.05 * s; }
      }
      for (const q of stretches) {      /* waking: a long stretch up (380 ms) and a springy settle (520 ms) */
        const u = t - q.t; if (u < 0 || u > 900) continue;
        const k = u < 380 ? EASE.inout(u / 380) : 1 - EASE.spring((u - 380) / 520);
        sy *= 1 + 0.09 * k; sx *= 1 - 0.06 * k; y -= 0.05 * k;
      }
      for (const q of nods) {           /* a yes: two nods, 12 deg then 7, 520 ms */
        const u = t - q.t; if (u < 0 || u > 520) continue;
        pitch -= Math.sin((u / 520) * Math.PI * 2) * (u < 260 ? 12 : 7) * (u < 260 ? 1 : 1);
      }
      for (const q of shakes) {         /* a no or a doubt: a damped shake, 3 swings, 10 deg, 560 ms */
        const u = t - q.t; if (u < 0 || u > 560) continue;
        yaw += Math.sin((u / 560) * Math.PI * 3) * 10 * (1 - u / 560);
      }
      if (o.breath !== false && !reduced && (+el.dataset.size || 96) > 44) {   /* no breath at 44 and under (ORBS.md T4: small things hold still) */
         const b = Math.sin((t / 3600) * Math.PI * 2); sy *= 1 + 0.012 * b; sx *= 1 + 0.006 * b; }
      return { y, sx, sy, pitch, yaw };
    }
    /* reduced motion: the head never moves; a change of gaze or state is a DIP, never a cross-fade (a cross-fade shows both
       pairs of eyes at once): the eyes fade out (90 ms), change while hidden for 220 ms (the element's own 150 ms cross-fade,
       unseen), and fade back in (90 ms). It reads as one slow blink. Blinks are the element's (off under reduced motion). */
    const DIP_OUT = 90, DIP_HOLD = 220, DIP_IN = 90;
    const dips = reduced ? cues.filter((q) => q.look !== undefined || q.morph !== undefined || (q.pose && q.eyes !== false)).map((q) => q.t) : [];
    const dipAt = (t) => { let o = 1; for (const t0 of dips) { const u = t - t0; if (u < 0 || u > DIP_OUT + DIP_HOLD + DIP_IN) continue; o = Math.min(o, u < DIP_OUT ? 1 - EASE.out(u / DIP_OUT) : u < DIP_OUT + DIP_HOLD ? 0 : EASE.out((u - DIP_OUT - DIP_HOLD) / DIP_IN)); } return o; };
    function at(t) {
      const p = {}; CH.forEach((c) => { p[c] = reduced ? 0 : val(c, t); });
      const a = reduced ? { y: 0, sx: 1, sy: 1, pitch: 0, yaw: 0 } : add(t);
      p.y += a.y; p.pitch += a.pitch; p.yaw += a.yaw;
      head.style.transform = headTf(p, w, a.sx, a.sy);
      if (reduced) head.style.opacity = String(dipAt(t));
      /* the eyes' own calls, fired once when the clip's clock passes them (under reduced motion, at the bottom of the dip) */
      cues.forEach((q, i) => {
        const tq = q.t + (reduced && dips.includes(q.t) ? DIP_OUT : 0);
        if (t < tq || fired.has(i)) return; fired.add(i);
        if (!eyes) return;
        if (q.look !== undefined) { if (q.look) eyes.look(q.look[0], q.look[1]); else eyes.look(); }
        else if (q.pose && POSES[q.pose] && q.eyes !== false) { const l = POSES[q.pose].look; if (l) eyes.look(l[0], l[1]); else eyes.look(); }
        if (q.blink && !reduced) eyes.blink();
        if (q.morph !== undefined) eyes.morph(q.morph || null);
      });
    }
    return { at, el, eyes, head };
  }
  window.OB2S = { spk, settle, director, POSES, W, EASE, bez, headTf };
})();
