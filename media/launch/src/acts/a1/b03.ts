/* B03, the cast (5.067 to 7.467 s, bars 3.2.5 to 4.3).

   T8: each sign-in button's shell resizes into a cast card (travel 32 f, 4 f apart, top to bottom): the shell is one
   opaque card stock box whose bounds, corners and edge light interpolate from the button's to the card's. The label
   slides 24 px left and blurs out by 40% of the move; the lab's mark leaves the button and travels, untouched, into the
   card's plan line (scaled, never recoloured or reshaped); a circular mask opens on the bot's orb, asleep; the name,
   role and plan line rise 4 f after the container. "Make each one a bot in boopis" rises and lands on beat 11.

   The eyes open card by card on sixteenths (nina, moss, kai, vox), asleep to awake on the character spring, each orb
   glancing at the next as it wakes; vox blinks on beat 12.5; then all four look up and left, to where they are going.
   T1 out: each card collapses into its orb (the text slides under the orb and is masked, the corners pull in), and the
   orbs leave on arcs (travel 30 f, 3 f apart, in the room's order kai, nina, moss, vox) for the room's head stack;
   kai lands on beat 14 (B04's first frame), each landing on top of the one before. At each landing the orb is handed
   to the stack's own orb in the same pose and place, so the room's head owns it from then on. */
import type { ActCtx } from '../context';
import type { OrbPose } from '../../engine/orb';
import { blink, glance } from '../../motion/orb-moves';
import { arrive, depart, travel, ui } from '../../motion/ease';
import { a1state } from './state';
import { a1css, between, centre, k1, k1Exit, k1Start, poolTo, selSweep, tmap, vis, wordUnits, sampleAll } from './util';
import { bounce, poseNow, quick, spring, wake } from './orbs';

const f = (n: number): number => n / 60;
/** the pose every orb flies in and lands in: looking up and left, where the room's head is */
export const LAND_POSE: Partial<OrbPose> = { eyes: 'pill', eyesTo: '', eyesMix: 0, yaw: -14, pitch: 10, roll: 0, blink: 0, squash: 0, scale: 1, dx: 0, dy: 0 };
export const STACK_ORDER = ['kai', 'nina', 'moss', 'vox'];

/* the shell: card stock whose edge light and drop shadow are numbers GSAP can move (token colours, mixed in CSS) */
const SHELL_CSS = `
.a1-shell { position: absolute; box-sizing: border-box; background: var(--bg-3); pointer-events: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) var(--a1-line, 7.5%), transparent),
    inset 0 1px 0 color-mix(in srgb, var(--text) var(--a1-edge, 9%), transparent),
    0 24px 60px rgba(0, 0, 0, var(--a1-drop, .35)); }
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
  sampleAll(film, T.start, T.end);
  const cards = [...kf.querySelectorAll<HTMLElement>('.castcard')];
  const line = kf.querySelector<HTMLElement>('.film-line');
  const btns = kf2 ? [...kf2.querySelectorAll<HTMLElement>('.ui-sso')] : [];
  /* the buttons' zoom from the boxes measured at rest (the fan's transform is on them by now) */
  const bz = btns[0] && m.btn[0] && btns[0].offsetWidth ? m.btn[0].w / btns[0].offsetWidth : 2.4;
  const names = cards.map((c) => c.querySelector('orb-avatar, .film-orb-holder') ? [...orbs.values()].find((o) => c.contains(o.holder))?.name ?? '' : '');
  const lineStrong = mixPct('--line-strong', 26), hair = mixPct('--hair', 7.5), edge = mixPct('--plate-edge', 9);
  const btnRadius = btns[0] ? parseFloat(getComputedStyle(btns[0]).borderTopLeftRadius) * bz : 28.8;
  const cardRadius = cards[0] ? parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius) : 24;
  const dropTo = 0.35;

  /* the key frame shows from the first shell until the last orb has landed in the stack */
  const morph = (i: number): number => T.start + i * d(f(4));
  const MORPH = d(f(32));

  /* flights, in the room's order; kai lands on B04's first frame */
  const FLY = d(f(30)), stagger = d(f(3));
  const firstLand = s.kf.b04 ? beatEnd(ctx) : T.end;
  const flight: Record<string, number> = {};
  STACK_ORDER.forEach((n, j) => { flight[n] = firstLand - FLY + j * stagger; s.landAt[n] = firstLand + j * stagger; });
  s.flightStart = flight['kai'];
  const lastLand = Math.max(...Object.values(s.landAt));
  vis(film, kf, between(T.start, s.kf.b04 ? lastLand : T.end + 1));
  film.onRender((x) => { const want = x >= (s.flightStart ?? 99) - f(4) && x < 9.6 ? '3' : ''; if (kf.style.zIndex !== want) kf.style.zIndex = want; }, -9);

  let kf2End = 0;
  const wakeAt = [t(g.beat(11)), t(g.beat(11.25)), t(g.beat(11.5)), t(g.beat(11.75))];

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
    film.tl.fromTo(shell, { left: B.x, top: B.y, width: B.w, height: B.h, borderRadius: btnRadius, '--a1-line': lineStrong, '--a1-edge': '0%', '--a1-drop': 0 },
      { left: C.x, top: C.y, width: C.w, height: C.h, borderRadius: cardRadius, '--a1-line': hair, '--a1-edge': edge, '--a1-drop': dropTo, duration: MORPH, ease: travel, immediateRender: true, data: { role: 'carry' } }, at);
    /* the card's contents ride with the shell (its left edge and its middle) */
    film.tl.fromTo(card, { x: B.x - C.x, y: B.y + B.h / 2 - (C.y + C.h / 2) }, { x: 0, y: 0, duration: MORPH, ease: travel, immediateRender: true, data: { role: 'carry' } }, at);

    /* the button gives up its shell on the same frame (its label and mark stay, and leave on their own) */
    const btn = btns[i];
    if (btn) {
      film.onRender((x) => {
        const on = x >= at - 1e-9;
        const v = on ? 'transparent' : '';
        if (btn.style.getPropertyValue('--sso-fill') !== v) { btn.style.setProperty('--sso-fill', v); btn.style.setProperty('--sso-line', v); }
      }, -9);
      const label = btn.querySelector<HTMLElement>('.ui-sso__label');
      if (label) film.tl.fromTo(label, { x: 0, filter: 'blur(0px)', opacity: 1 }, { x: -24 / bz, filter: 'blur(8px)', opacity: 0, duration: d(f(13)), ease: depart, immediateRender: false, data: { role: 'ui' } }, at);
      /* the mark travels into the plan line, scaled to its size there, and is handed to the card's own mark on landing */
      const logo = btn.querySelector<HTMLElement>('.ui-sso__logo');
      const LB = m.logo[i];
      if (logo && LB) {
        const [lx, ly] = centre(LB), [mx, my] = centre(MB);
        const landMark = at + d(f(2)) + d(f(34));
        logo.style.transformOrigin = '50% 50%';
        film.tl.fromTo(logo, { x: 0, y: 0, scale: 1 }, { x: (mx - lx) / bz, y: (my - ly) / bz, scale: MB.w / LB.w, duration: d(f(34)), ease: travel, immediateRender: false, data: { role: 'carry' } }, at + d(f(2)));
        vis(film, logo, (x) => x < landMark - 1e-9);
        vis(film, mark, (x) => x >= landMark - 1e-9, { after: true });
        kf2End = Math.max(kf2End, landMark + f(1));
      }
    }

    /* ── the orb: uncovered by a circular mask, asleep ── */
    film.tl.fromTo(orbWrap, { clipPath: 'circle(0px at 50% 50%)' }, { clipPath: 'circle(' + Math.round(OB.w * 0.75) + 'px at 50% 50%)', duration: d(f(20)), ease: arrive, immediateRender: true, data: { role: 'reveal' } }, at + d(f(8)));

    /* ── the words rise 4 f after the container ── */
    [nm, rl, plText].forEach((u, j) => film.tl.fromTo(u, { y: 16, opacity: 0, filter: 'blur(4px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: d(f(18)), ease: arrive, immediateRender: true, data: { role: 'type' } }, at + MORPH + d(f(4)) - d(f(18)) + j * d(f(3))));

    /* ── the faces ── */
    if (so) {
      const o = so.orb, idx = i;
      poseNow(o, { eyes: 'rest', eyesTo: '', eyesMix: 0, yaw: 0, pitch: -14, roll: idx % 2 ? -5 : 5 });
      /* asleep: a slow breath */
      const wk = wakeAt[idx] ?? wakeAt[3]!;
      const breathFrom = at + d(f(8)), period = 0.42, n = Math.max(1, Math.floor((wk - breathFrom) / period));
      film.tl.fromTo(o.pose, { scale: 1 }, { scale: 1.018, duration: (wk - breathFrom) / n / 2, ease: travel, yoyo: true, repeat: 2 * n - 1, immediateRender: false, data: { role: 'orb', blur: false } }, breathFrom);
      /* awake, glancing at the next one (pitch: up is positive) */
      const look: [number, number][] = [[2, -17], [0, 15], [-2, -17], [6, 17]];
      wake(film, o, wk, look[idx]![0], look[idx]![1]);
      if (idx === 1) glance(film, o, wakeAt[2]! + f(2), 2, -17);      /* moss turns from nina to kai as kai wakes */
    }

    /* ── T1 out: the card collapses into its orb ── */
    if (s.kf.b04 && so) {
      const fs = flight[name] ?? T.end;
      const cs = fs - d(f(18)), CD = d(f(18));
      const [ocx, ocy] = centre(OB);
      film.tl.fromTo(shell, { left: C.x, top: C.y, width: C.w, height: C.h, '--a1-drop': dropTo, '--a1-line': hair }, { left: ocx, top: ocy, width: 0, height: 0, '--a1-drop': 0, '--a1-line': '0%', duration: CD, ease: travel, immediateRender: false, data: { role: 'carry' } }, cs);
      vis(film, shell, (x) => x >= at - 1e-9 && x < fs - 1e-9);
      /* the words slide under the orb, masked at its centre and by the shell's edge as it pulls in */
      const q = { k: 0, __name: 'a1-collapse' };
      film.tl.fromTo(q, { k: 0 }, { k: 1, duration: CD, ease: travel, immediateRender: false, data: { role: 'carry' } }, cs);
      film.onRender(() => {
        const k = q.k;
        if (k <= 0) { if (text.style.clipPath) { text.style.clipPath = ''; text.style.transform = ''; } return; }
        const tx = -70 * k, left = TB.x + tx, right = left + TB.w;
        const shellRight = C.x + C.w + (ocx - (C.x + C.w)) * k;
        const L = Math.max(0, ocx - left), R = Math.max(0, right - shellRight);
        text.style.transform = 'translateX(' + tx.toFixed(2) + 'px)';
        text.style.clipPath = 'inset(0px ' + Math.min(TB.w, R).toFixed(2) + 'px 0px ' + Math.min(TB.w, L).toFixed(2) + 'px)';
      });

      /* the flight: anticipation, a stretch along the arc, at rest in the landing pose on arrival */
      const o = so.orb;
      const slotI = STACK_ORDER.indexOf(name);
      const slot = m.slot[slotI];
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
        quick(film, o, fs - f(4), 4, { squash: 0.07 });
        film.tl.to(o.pose, { squash: -0.06, duration: d(f(12)), ease: travel, immediateRender: false, data: { role: 'orb' } }, fs);
        film.tl.to(o.pose, { squash: 0, duration: d(f(18)), ease: travel, immediateRender: false, data: { role: 'orb' } }, fs + d(f(12)));
        vis(film, orbWrap, (x) => x < (s.landAt[name] ?? 99) - 1e-9);
      }
    }
  });
  s.kf2End = kf2End || T.start;

  /* the room's order of flights also decides who looks first: all four look up and left before they go */
  STACK_ORDER.forEach((n, j) => {
    const so = orbs.get(n);
    if (!so) return;
    spring(film, so.orb, t(6.56) + j * f(2), { yaw: LAND_POSE.yaw!, pitch: LAND_POSE.pitch! });
  });
  /* all awake: a ripple down the column, one bounce each */
  ['nina', 'moss', 'kai', 'vox'].forEach((n, j) => { const o = orbs.get(n)?.orb; if (o) bounce(film, o, t(6.4) + j * d(f(3)), o.size * 0.13); });
  const vox = orbs.get('vox')?.orb, nina = orbs.get('nina')?.orb;
  if (vox) blink(film, vox, t(g.beat(12.5)));
  if (nina) blink(film, nina, t(6.25));
  /* the others turn to vox as he wakes last */
  for (const n of ['nina', 'moss', 'kai']) { const o = orbs.get(n)?.orb; if (o) glance(film, o, wakeAt[3]! + f(3 + STACK_ORDER.indexOf(n) * 2), 3, -18); }

  /* the line: "Make each one a bot in boopis" lands on beat 11, leaves before B04 */
  if (line) {
    const units = wordUnits(line);
    const landed = k1(film, units, k1Start(t(g.beat(11)), units.length, d(20 / 60), d(4 / 60)), { dur: d(20 / 60), stagger: d(4 / 60) });
    const sel = line.querySelector<HTMLElement>('.sel');
    if (sel) selSweep(film, sel, landed + d(f(3)));
    k1Exit(film, line, t(7.267), d(12 / 60));
  }

  /* the lamp follows the cards; the camera keeps breathing in */
  if (s.ground && s.pool.b02 && s.pool.b03) poolTo(film, s.ground, s.pool.b02, s.pool.b03, T.start, d(0.8));
  const camFrom = s.camFree ?? T.start, zoomFrom = s.camZoomFrom ?? camFrom;
  cam.drift({ zoom: 1.12 }, { at: zoomFrom, dur: (s.flightStart ?? T.end) - zoomFrom });
  cam.drift({ y: ctx.stage.height / 2 }, { at: camFrom, dur: (s.flightStart ?? T.end) - camFrom });
  s.camFree = s.flightStart ?? T.end;
  void ui;
}

/** B04's first frame on this edit's clock (kai lands on it) */
function beatEnd(ctx: ActCtx): number { return ctx.win('B04').start; }
