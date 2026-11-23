/* B03, the cast (5.067 to 7.467 s, bars 3.2.5 to 4.3).

   T8: each sign-in button's shell resizes into a cast card (travel 32 f, 4 f apart, top to bottom): the shell is one
   opaque card-stock box whose bounds, corners, hairline and shadow (the look's tokens) interpolate from the button's to
   the card's. The label slides 24 px left and blurs out by 40% of the move; the lab's mark leaves the button and lands,
   untouched, in the card's plan line before the card's words rise (critique A1-07: it never crosses them); a circular
   mask opens on the bot's orb, asleep; the name, role and plan line rise (K1, unmasked) as the card lands. "Make each
   one a bot in boopis" rises after the promise has left and lands on beat 11.

   Each orb has a character from the moment it wakes: the eyes open card by card on sixteenths (nina, moss, kai, vox),
   asleep to awake with a stretch, each orb looking at the next as it wakes, and the others turning to vox, who wakes
   last and blinks on beat 12.5; a bounce ripples down the column, then all four look up and left, to where they are
   going. The line leaves before they go (A1-12). T1 out: each card collapses into its orb (the words slide under the orb
   and are masked by the shell's edge as it pulls in) and the orbs leave on arcs (travel 30 f, 3 f apart, in the room's
   order kai, nina, moss, vox) for the room's head stack; kai lands on beat 14 (B04's first frame), each landing on top
   of the one before. At each landing the orb is handed to the stack's own orb in the same pose and place (both
   characters' idles are at rest on that frame), so the room's head owns it from then on. */
import type { ActCtx } from '../context';
import type { OrbPose } from '../../engine/orb';
import { eyes } from '../../motion/orb-moves';
import { character, type Character } from '../../motion/character';
import { arrive, depart, travel, ui } from '../../motion/ease';
import { a1state } from './state';
import { a1css, between, centre, chain, f, k1, k1Exit, k1Start, poolTo, selSweep, tmap, vis, wordUnits } from './util';
import { bounce, poseNow } from './orbs';

/** the pose every orb flies in and lands in: looking up and left, where the room's head is */
export const LAND_POSE: Partial<OrbPose> = { eyes: 'pill', eyesTo: '', eyesMix: 0, eyesVia: '', eyesViaMix: 0, yaw: -14, pitch: 10, roll: 0, blink: 0, squash: 0, scale: 1, dx: 0, dy: 0 };
export const STACK_ORDER = ['kai', 'nina', 'moss', 'vox'];

/* the shell: card stock whose hairline is the product's line mixed from --text (the button's --line-strong to the
   card's --hair), and whose shadow is the look's --card-shadow on a layer of its own that rises with the card */
const SHELL_CSS = `
.a1-shell { position: absolute; box-sizing: border-box; background: var(--bg-3); pointer-events: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) var(--a1-line, 7.5%), transparent); }
.a1-shell::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: var(--card-shadow); opacity: var(--a1-drop, 1); z-index: -1; }
.a1-pltext { font-style: normal; display: inline-block; }
`;
/** a token's share of --text, as the product mixes its lines (`color-mix(in srgb, var(--text) 26%, transparent)`) */
function mixPct(token: string, fallback: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token);
  const m = /var\(--text\)\s+([\d.]+)%/.exec(v);
  return (m ? Number(m[1]) : fallback) + '%';
}

export async function b03(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B03')) return;
  const s = await a1state(ctx);
  const { film, g, cam } = ctx;
  const T = tmap(ctx, 'B03'), t = T.t, d = T.d;
  const kf = s.kf.b03!, m = s.m, orbs = s.orbs.b03!;
  const kf2 = s.kf.b02;
  a1css(SHELL_CSS);
  film.mark('B03 the cast', T.start);
  const cards = [...kf.querySelectorAll<HTMLElement>('.castcard')];
  const line = kf.querySelector<HTMLElement>('.film-line');
  const btns = kf2 ? [...kf2.querySelectorAll<HTMLElement>('.ui-sso')] : [];
  /* the buttons' zoom from the boxes measured at rest (the fan's transform is on them by now) */
  const bz = btns[0] && m.btn[0] && btns[0].offsetWidth ? m.btn[0].w / btns[0].offsetWidth : 2.4;
  const names = cards.map((c) => [...orbs.values()].find((o) => c.contains(o.holder))?.name ?? '');
  const lineStrong = mixPct('--line-strong', 26), hair = mixPct('--hair', 7.5);
  const btnRadius = btns[0] ? parseFloat(getComputedStyle(btns[0]).borderTopLeftRadius) * bz : 28.8;
  const cardRadius = cards[0] ? parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius) : 24;

  const morph = (i: number): number => T.start + i * d(f(4));
  const MORPH = d(f(32));

  /* flights, in the room's order; kai lands on B04's first frame */
  const FLY = d(f(30)), stagger = d(f(3));
  const firstLand = s.kf.b04 ? ctx.win('B04').start : T.end;
  const flight: Record<string, number> = {};
  STACK_ORDER.forEach((n, j) => { flight[n] = firstLand - FLY + j * stagger; s.landAt[n] = firstLand + j * stagger; });
  s.flightStart = flight['kai'];
  const lastLand = Math.max(...Object.values(s.landAt));
  vis(film, kf, between(T.start, s.kf.b04 ? lastLand : T.end + 1));
  film.onRender((x) => { const want = x >= (s.flightStart ?? 99) - f(4) && x < 9.6 ? '3' : ''; if (kf.style.zIndex !== want) kf.style.zIndex = want; }, -9);

  let kf2End = 0;
  const wakeAt = [t(g.beat(11)), t(g.beat(11.25)), t(g.beat(11.5)), t(g.beat(11.75))];
  const chars = new Map<string, Character>();

  cards.forEach((card, i) => {
    const name = names[i] ?? '';
    const so = orbs.get(name);
    const orbWrap = card.querySelector<HTMLElement>('.orb')!;
    const text = card.querySelector<HTMLElement>('.nm')!.parentElement!;
    const nm = card.querySelector<HTMLElement>('.nm')!, rl = card.querySelector<HTMLElement>('.rl')!, pl = card.querySelector<HTMLElement>('.pl')!;
    const mark = pl.querySelector<HTMLElement>(':scope > span')!;
    /* the plan line's words in their own unit (an <em>: the card's CSS sizes every span in .pl as a 29 px mark box) */
    const tn = [...pl.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
    const plText = document.createElement('em');
    plText.className = 'a1-pltext';
    if (tn) { plText.textContent = tn.textContent; tn.replaceWith(plText); }
    orbWrap.style.zIndex = '1';
    const C = m.card[i]!, B = m.btn[i] ?? C, OB = m.orb[i]!, TB = m.text[i]!, MB = m.mark[i]!;
    const at = morph(i);

    /* ── the shell (T8) ── */
    const shell = document.createElement('div');
    shell.className = 'a1-shell';
    card.before(shell);
    card.style.background = 'transparent';
    card.style.boxShadow = 'none';
    film.tl.fromTo(shell, { left: B.x, top: B.y, width: B.w, height: B.h, borderRadius: btnRadius, '--a1-line': lineStrong, '--a1-drop': 0 },
      { left: C.x, top: C.y, width: C.w, height: C.h, borderRadius: cardRadius, '--a1-line': hair, '--a1-drop': 1, duration: MORPH, ease: travel, immediateRender: true, data: { role: 'carry' } }, at);
    /* the card's contents ride with the shell (its left edge and its middle) */
    film.tl.fromTo(card, { x: B.x - C.x, y: B.y + B.h / 2 - (C.y + C.h / 2) }, { x: 0, y: 0, duration: MORPH, ease: travel, immediateRender: true, data: { role: 'carry' } }, at);

    /* the button gives up its shell on the same frame (its label and mark stay, and leave on their own) */
    const btn = btns[i];
    let markLand = at + d(f(24));
    if (btn) {
      film.onRender((x) => {
        const on = x >= at - 1e-9;
        const v = on ? 'transparent' : '';
        if (btn.style.getPropertyValue('--sso-fill') !== v) { btn.style.setProperty('--sso-fill', v); btn.style.setProperty('--sso-line', v); }
      }, -9);
      film.cut(at);
      const label = btn.querySelector<HTMLElement>('.ui-sso__label');
      if (label) film.tl.fromTo(label, { x: 0, filter: 'blur(0px)', opacity: 1 }, { x: -24 / bz, filter: 'blur(8px)', opacity: 0, duration: d(f(13)), ease: depart, immediateRender: false, data: { role: 'ui' } }, at);
      /* the mark travels into the plan line, scaled to its size there, and lands before the card's words rise; on
         landing it is handed to the card's own mark */
      const logo = btn.querySelector<HTMLElement>('.ui-sso__logo');
      const LB = m.logo[i];
      if (logo && LB) {
        const [lx, ly] = centre(LB), [mx, my] = centre(MB);
        logo.style.transformOrigin = '50% 50%';
        film.tl.fromTo(logo, { x: 0, y: 0, scale: 1 }, { x: (mx - lx) / bz, y: (my - ly) / bz, scale: MB.w / LB.w, duration: d(f(24)), ease: travel, immediateRender: false, data: { role: 'carry' } }, at);
        vis(film, logo, (x) => x < markLand - 1e-9);
        vis(film, mark, (x) => x >= markLand - 1e-9, { after: true });
        film.cut(markLand);
        kf2End = Math.max(kf2End, markLand + f(1));
      }
    }

    /* ── the orb: uncovered by a circular mask, asleep ── */
    film.tl.fromTo(orbWrap, { clipPath: 'circle(0px at 50% 50%)' }, { clipPath: 'circle(' + Math.round(OB.w * 0.75) + 'px at 50% 50%)', duration: d(f(20)), ease: arrive, immediateRender: true, data: { role: 'reveal' } }, at + d(f(8)));

    /* ── the words rise (K1, unmasked) once the mark has passed them: the card lands, its words 4 to 10 f after ── */
    [nm, rl, plText].forEach((u, j) => film.tl.fromTo(u, { y: 18, opacity: 0, filter: 'blur(5px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: d(f(20)), ease: arrive, immediateRender: true, data: { role: 'type' } }, markLand - d(f(6)) + j * d(f(3))));

    /* ── the face: asleep, then a character from the moment it wakes ── */
    if (so) {
      const o = so.orb;
      poseNow(o, { eyes: 'rest', eyesTo: '', eyesMix: 0, yaw: 0, pitch: -14, roll: i % 2 ? -5 : 5 });
      const wk = wakeAt[i] ?? wakeAt[3]!;
      const c = character(film, o, { seed: 11 + i * 7, from: wk, to: s.landAt[name] ?? T.end, float: o.size * 0.015 });
      chars.set(name, c);
      /* asleep: a slow breath, ending at rest on the wake */
      const breathFrom = at + d(f(8)), period = 0.42, n = Math.max(1, Math.floor((wk - breathFrom) / period));
      film.tl.fromTo(o.pose, { scale: 1 }, { scale: 1.018, duration: (wk - breathFrom) / n / 2, ease: travel, yoyo: true, repeat: 2 * n - 1, immediateRender: false, data: { role: 'orb', blur: false } }, breathFrom);
      /* awake: the eyes open, a stretch up, the head comes up level */
      eyes(film, o, wk, 'pill', { dur: 0.16 });
      chain(film, o, 'squash', wk, 0, [[6, -0.08, ui], ['char', 0]]);
      chain(film, o, 'roll', wk, i % 2 ? -5 : 5, [['char', 0]]);
    }

    /* ── T1 out: the card collapses into its orb ── */
    if (s.kf.b04 && so) {
      const fs = flight[name] ?? T.end;
      const cs = fs - d(f(18)), CD = d(f(18));
      const [ocx, ocy] = centre(OB);
      film.tl.fromTo(shell, { left: C.x, top: C.y, width: C.w, height: C.h, '--a1-drop': 1, '--a1-line': hair }, { left: ocx, top: ocy, width: 0, height: 0, '--a1-drop': 0, '--a1-line': '0%', duration: CD, ease: travel, immediateRender: false, data: { role: 'carry' } }, cs);
      vis(film, shell, (x) => x >= at - 1e-9 && x < fs - 1e-9);
      /* the words slide a little toward the orb, masked by the shell's edge as it pulls in and at the orb's centre */
      const q = { k: 0, __name: 'a1-collapse' };
      film.tl.fromTo(q, { k: 0 }, { k: 1, duration: CD, ease: travel, immediateRender: false, data: { role: 'carry' } }, cs);
      film.onRender(() => {
        const k = q.k;
        if (k <= 0) { if (text.style.clipPath) { text.style.clipPath = ''; text.style.transform = ''; } return; }
        const tx = -40 * k, left = TB.x + tx, right = left + TB.w;
        const shellRight = C.x + C.w + (ocx - (C.x + C.w)) * k;
        const L = Math.max(0, ocx - left), R = Math.max(0, right - shellRight);
        text.style.transform = 'translateX(' + tx.toFixed(2) + 'px)';
        text.style.clipPath = 'inset(0px ' + Math.min(TB.w, R).toFixed(2) + 'px 0px ' + Math.min(TB.w, L).toFixed(2) + 'px)';
      });

      /* the flight: anticipation, a stretch along the arc, at rest in the landing pose on arrival */
      const o = so.orb;
      const slot = m.slot[STACK_ORDER.indexOf(name)];
      if (slot) {
        const [sx, sy] = centre(slot);
        const scaleTo = slot.w / OB.w;
        const dx = sx - ocx, dy = sy - ocy, dist = Math.hypot(dx, dy), bend = 0.16 * dist;
        const nx = -dy / dist, ny = dx / dist;
        const p = { k: 0, z: 0, __name: 'a1-flight' };
        film.tl.fromTo(p, { k: 0, z: 0 }, { k: 1, z: 1, duration: FLY, ease: travel, immediateRender: false, data: { role: 'carry' } }, fs);
        film.onRender(() => {
          const k = p.k;
          if (k <= 0) { if (orbWrap.style.transform) orbWrap.style.transform = ''; return; }
          const w = Math.sin(Math.PI * k) * bend * (ny < 0 ? 1 : -1);
          const x = dx * k + nx * w, y = dy * k + ny * w, sc = 1 + (scaleTo - 1) * p.z;
          orbWrap.style.transform = 'translate(' + x.toFixed(3) + 'px,' + y.toFixed(3) + 'px) scale(' + sc.toFixed(5) + ')';
        });
        chain(film, o, 'squash', fs - f(4), 0, [[4, 0.07, ui], [d(12) * 1, -0.06], [d(14) * 1, 0]]);
        vis(film, orbWrap, (x) => x < (s.landAt[name] ?? 99) - 1e-9);
        film.cut(s.landAt[name] ?? T.end);
      }
    }
  });
  s.kf2End = kf2End || T.start;

  /* ── the looks: each looks at the next as it wakes (pitch: up is positive), the others turn to vox, vox blinks ── */
  const look = (n: string, at: number, yaw: number, pitch: number): void => { chars.get(n)?.look(at, yaw, pitch); };
  look('nina', wakeAt[0]! + f(2), 2, -17);        /* down at moss */
  look('moss', wakeAt[1]! + f(2), 0, 15);         /* up at nina */
  look('moss', wakeAt[2]! + f(2), 2, -17);        /* then down at kai as he wakes */
  look('kai', wakeAt[2]! + f(2), -2, -17);        /* down at vox */
  look('vox', wakeAt[3]! + f(2), 6, 17);          /* up at them all */
  ['nina', 'moss', 'kai'].forEach((n, j) => look(n, wakeAt[3]! + f(4 + j * 2), 3, -18));
  chars.get('vox')?.blink(t(g.beat(12.5)));
  chars.get('nina')?.blink(t(6.25));
  /* all awake: a ripple down the column, one bounce each; then they look up and left, to where they are going */
  ['nina', 'moss', 'kai', 'vox'].forEach((n, j) => { const o = orbs.get(n)?.orb; if (o) bounce(film, o, t(6.4) + j * d(f(3)), o.size * 0.13); });
  STACK_ORDER.forEach((n, j) => look(n, t(6.56) + j * f(2), LAND_POSE.yaw!, LAND_POSE.pitch!));

  /* the line: "Make each one a bot in boopis" rises after the promise has left, lands on beat 11, leaves before the orbs
     go up to the room's head */
  if (line) {
    const units = wordUnits(line);
    const start = Math.max(k1Start(t(g.beat(11)), units.length, d(20 / 60), d(4 / 60)), (s.line2Out ?? 0) + f(4));
    const landed = k1(film, units, start, { dur: d(20 / 60), stagger: d(4 / 60) });
    const sel = line.querySelector<HTMLElement>('.sel');
    if (sel) selSweep(film, sel, landed + d(f(3)));
    k1Exit(film, units, t(6.9), d(12 / 60));
  }

  /* the light follows the cards; the camera moves on with them, keeping the line's headroom, then leans toward the
     faces as they wake and again with their ripple, short moves that follow the subject, with a slow drift between */
  if (s.ground && s.pool.b02 && s.pool.b03) poolTo(film, s.ground, s.pool.b02, s.pool.b03, T.start, d(0.8));
  const W = ctx.stage.width, H = ctx.stage.height;
  const lineTop = m.line3 ?? 96;
  const camY = (zz: number): number => Math.min(H / 2, lineTop + (0.425 * H) / zz);
  const camFrom = Math.max(s.camFree ?? 0, T.start), camTo = T.start + MORPH + d(f(12));
  cam.to({ zoom: 1.085, y: camY(1.085) }, { at: camFrom, dur: camTo - camFrom, ease: arrive });
  const faceX = m.orb[0] ? W / 2 + (centre(m.orb[0])[0] - W / 2) * 0.12 : W / 2;
  cam.to({ x: faceX, zoom: 1.09, y: camY(1.09) }, { at: wakeAt[0]!, dur: d(f(22)), ease: arrive });
  cam.drift({ zoom: 1.094, y: camY(1.094) }, { at: wakeAt[0]! + d(f(22)), dur: t(6.4) - wakeAt[0]! - d(f(22)) });
  cam.to({ x: (faceX + W / 2) / 2, zoom: 1.1, y: camY(1.1) }, { at: t(6.4), dur: d(f(18)), ease: arrive });
  s.camFree = t(6.4) + d(f(18));
}
