/* Onboarding revision 2, the clips. Each clip builds its screens with the same builders as the stills, then sets every
   animated property as a pure function of the clip time t (ms). The speaker's head is the director's (ob2-speaker.js); its
   eyes are <boopis-logo>'s own (look, blink, morph); the bots are orb2's own behaviours (react, wakeUp, sleep, blink, poke,
   spin, emote, lookAt, gaze), called at their cue times. rec2.cjs runs the page on a virtual clock at 60 fps, so the
   element's and orb2's own motion advance in lockstep with these timelines. */
(function () {
  const S = window.SCREENS, SP = window.OB2S, O2 = window.OB2;
  /* travel (NEW, onboarding only): a speaker or a bot going from one place to another. --spring starts at full speed (a jump in
     the first frame at 60 fps); travel eases out of rest and lands as softly */
  const E = { travel: SP.bez(0.32, 0, 0.12, 1), sharp: SP.bez(0.165, 0.84, 0.44, 1), spring: SP.bez(0.22, 1, 0.36, 1), out: SP.bez(0, 0, 0.58, 1), turn: SP.EASE.turn, inout: SP.EASE.inout, lin: (x) => Math.max(0, Math.min(1, x)) };
  const D = { press: 50, hover: 120, out: 100, pop: 100, d2: 200, d3: 300, hold: 1000, phrase: 800, shimmer: 2200 };
  const R = new URLSearchParams(location.search).has('reduced');
  const p = (t, t0, dur, ease = E.sharp) => R ? E.lin((t - t0) / 150) : ease((t - t0) / dur);
  const lerp = (a, b, k) => a + (b - a) * k;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const set = (el, st) => { if (el) for (const k in st) el.style[k] = st[k]; };
  /* page words and cards: opacity and 4 px up, scale .98 (the kit's entry); reduced: opacity only, 150 ms */
  const enter = (el, t, t0, dur = D.d2, dy = 4, sc = 1, base = '') => { if (!el) return; const k = p(t, t0, dur); if (R) { dy = 0; sc = 1; } set(el, { opacity: String(k), transform: `${base} translateY(${lerp(dy, 0, k).toFixed(2)}px) scale(${lerp(sc, 1, k).toFixed(4)})` }); };
  const press = (el, t, t0, base = '') => { if (!el || R) return; const k = t < t0 ? 0 : t < t0 + D.press ? (t - t0) / D.press : t < t0 + 2 * D.press ? 1 - (t - t0 - D.press) / D.press : 0; el.style.transform = `${base} scale(${1 - 0.04 * k})`; };
  const shimmer = (t) => R ? null : $$('.shimmer').forEach((el) => { const ph = Math.floor(((t % D.shimmer) / D.shimmer) * 60) / 60; el.style.backgroundPosition = `${200 - 400 * ph}% 0`; });
  const host = () => document.getElementById('r');
  const mount = (html) => { host().innerHTML = html; O2.orbRules(host()); window.V7.eyes(); window.V7.paint(); return host(); };
  /* a cue list fired once as the clock passes each one (orb2's and the logo's own calls) */
  function calls(list) { const done = new Set(); return (t) => list.forEach((c, i) => { if (t >= c[0] && !done.has(i)) { done.add(i); try { c[1](); } catch (e) { console.error(e); } } }); }
  /* where an element's centre is, for orb2's lookAt (viewport px) */
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  /* ---------- O-M1: the speaker wakes up and looks around (O-S01, the Session tab's first open) ---------- */
  function wake() {
    const root = mount(S.obS01({ theme: 'dark', pose: 'rest', state: 'sleeping' }));
    const page = $('.ob-page', root);
    const h = $('.ob-h', page), l = $('.ob-lede', page), a = $('.ob-acts', page), skip = $('.ob-skip', page);
    const btn = $('.ob-acts .btn.primary', page);
    const el = $('.ob-spk', page);
    /* the director's cues (ONBOARDING.md, the motion spec: the wake-up) */
    const dir = SP.director(el, [
      { t: 0, posev: { pitch: -10, y: 0.05, roll: -3 }, dur: 1 },                       /* asleep: the head dropped and tilted */
      { t: 1200, morph: null, stretch: true, pose: 'rest', dur: 620, ease: 'spring', eyes: false }, /* wakes: eyes open, a stretch */
      { t: 1560, blink: true }, { t: 1770, blink: true },                                /* a double blink: clearing its eyes */
      { t: 2150, pose: 'left', dur: 420, blink: true },                                  /* looks around: left (the sidebar) */
      { t: 2900, pose: 'right', dur: 560, ease: 'turn' },                                 /* a long sweep right */
      { t: 3550, pose: 'upLeft', dur: 380 },                                              /* up, curious */
      { t: 4050, pose: 'turnLeft', dur: 520, ease: 'turn', blink: true },                 /* a full turn to the Sessions / Bots switch */
      { t: 4800, pose: 'you', dur: 460, hop: 0.14, morph: 'happy' },                      /* finds you: a hop and happy eyes */
      { t: 5750, morph: null },
      { t: 5050, bob: 0.05 }, { t: 5330, bob: 0.04 },                                     /* speaks the heading: a bob per line */
      { t: 6000, pose: 'downLeft', dur: 380 },                                            /* reads the lede with you, left to right */
      { t: 6500, pose: 'downRight', dur: 640, ease: 'inout' },
      { t: 7300, posev: { x: 0, y: 0.05, yaw: 0, pitch: -18, roll: 0 }, look: [0, -1], dur: 420 }, /* at the button */
      { t: 8100, pose: 'you', dur: 420, blink: true },
      { t: 8700, pose: 'upRight', dur: 420 },
      { t: 9300, pose: 'you', dur: 420 }, { t: 9420, blink: true }, { t: 9630, blink: true }
    ], { reduced: R, from: { pitch: -10, y: 0.05, roll: -3 } });
    return { dur: 10400, at(t) {
      dir.at(t);
      enter(h, t, 5000); enter(l, t, 5060);
      enter(a, t, 5300, D.d2, 4, 1, 'translateX(-50%)');
      enter(skip, t, 5300, D.d2, 0);
      shimmer(t);
    } };
  }

  window.CLIPS = { wake };
  window.OB2M = { E, D, R, p, lerp, $, $$, set, enter, press, shimmer, mount, calls, centre };
})();
