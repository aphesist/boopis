/* B01, the hook (0.000 to 2.667 s, bars 1.1 to 2.2).

   Frame 0 is the thumbnail: "[Claude] Claude and [ChatGPT] GPT" set over kai and nina, who look at each other on the
   lit paper; the camera pushes 2.6% a second throughout. Each orb has a character (motion/character.ts): an idle that
   never freezes, a gaze queue whose looks take over from one another, orb2's own speaking face. They perk up at each
   other; "Same group chat" rises (K1) and lands on beat 2 while they glance up at it, then the selection sweeps in
   behind "Same" and its caret lands. Beat 2: kai talks to nina (orb2's speaking face, a lean with a dip before the
   first word) while she listens with round eyes. Beat 3: nina answers and ends pleased with herself. Beat 4: both turn
   to camera.

   Beat 4.25, the dive (T2, 24 f on snap, planned motion blur): the camera falls into kai's left eye, and the eye opens
   onto B02. On the light ground B02 is paper and the eye is near-black ink, so the eye cannot simply become the next
   scene's ground: a light opening grows out of the eye's centre instead, in the eye's own outline, while the camera
   falls in. Through it B02 is drawn at the scale that makes the eye filling the frame exactly B02 at rest (the sign-in
   buttons already fanning out of its centre); the ring of ink that is left sweeps outward past the frame's edges as
   both grow. Nothing fades: the frame goes paper, mint body, a dark ring opening onto paper, paper, every step a moving
   edge. The swap to B02's own key frame lands on 2.2 (2.667 s), on identical pixels. */
import type { ActCtx } from '../context';
import { ptsToD, type OrbPose, type Pt } from '../../engine/orb';
import { eyes } from '../../motion/orb-moves';
import { character } from '../../motion/character';
import { boxOf } from '../../motion/carry';
import { linear, snap } from '../../motion/ease';
import { a1state } from './state';
import { centre, f, k1, k1Start, poolTo, poolVars, selSweep, setVars, tmap, vis, wordUnits } from './util';
import { lean, perk } from './orbs';

const smooth = (x: number): number => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };

export async function b01(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B01')) return;
  const s = await a1state(ctx);
  const { film, stage, g, cam } = ctx;
  const T = tmap(ctx, 'B01'), t = T.t, d = T.d;
  const kf = s.kf.b01!, orbs = s.orbs.b01!;
  const kaiS = orbs.get('kai')!, ninaS = orbs.get('nina')!;
  const kai = kaiS.orb, nina = ninaS.orb;
  const [, l2] = [...kf.querySelectorAll<HTMLElement>('.film-line')];
  const dive = ctx.has('B02') && !!s.kf.b02 && !!s.m.col;
  const W = stage.width, H = stage.height;
  film.mark('B01 the hook', T.start);

  /* the light of B01's key frame, on the film's ground */
  if (s.ground && s.pool.b01) setVars(s.ground, poolVars(s.pool.b01, 0.4));

  /* the dive's group: B01's key frame scales about kai's eye */
  const G = document.createElement('div');
  G.className = 'a1-dive';
  G.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0';
  kf.before(G);
  G.appendChild(kf);
  kf.style.visibility = '';
  const swap = T.end;
  /* with the dive, B01 is gone once the opening has become B02; without it (the 6 s bumper) it stays, and its orbs are
     handed on: the bumper's B18 pushes into nina from this frame */
  if (dive) vis(film, G, (x) => x < swap - 1e-9);
  else {
    vis(film, G, () => true, { until: swap, after: true });
    ctx.carry.orbs = new Map([...(ctx.carry.orbs ?? []), ...orbs]);
  }

  /* measured before any tween: kai's centre and the eye the camera falls into */
  const kc = centre(boxOf(kaiS.holder, stage));
  const divePose: OrbPose = { ...kai.pose, yaw: 5, pitch: 3, roll: 0, eyes: 'pill', eyesTo: '', eyesMix: 0, eyesVia: '', eyesViaMix: 0, speak: 0, blink: 0, squash: 0, scale: 1, dx: 0, dy: 0 };
  /** kai's left eye (the one on the frame's right) in world px, as a pose draws it */
  const eyeOf = (pose: OrbPose): Pt[] => {
    const geo = kai.geometry(pose);
    let best = geo.eyes[0]!, bx = -Infinity;
    for (const e of geo.eyes) { const cx = e.pts.reduce((a, p) => a + p[0], 0) / e.pts.length; if (cx > bx) { bx = cx; best = e; } }
    const sx = pose.scale * (1 + pose.squash * 0.5), sy = pose.scale * (1 - pose.squash), r = (pose.roll * Math.PI) / 180;
    const c = Math.cos(r), sn = Math.sin(r);
    return best.pts.map(([x, y]) => { const X = x * sx, Y = y * sy; return [kc[0] + pose.dx + X * c - Y * sn, kc[1] + pose.dy + X * sn + Y * c] as Pt; });
  };

  /* ── the characters ── */
  const kaiC = character(film, kai, { seed: 3, from: T.start });
  const ninaC = character(film, nina, { seed: 5, from: T.start });

  /* they perk up at each other before a word is said */
  perk(film, kai, t(0.12), 0.09);
  perk(film, nina, t(0.3), 0.12);
  kaiC.blink(t(0.5));

  /* beat 1: "Same group chat" rises, landing on beat 2; the orbs glance up at it as it comes */
  const units = l2 ? wordUnits(l2) : [];
  const land2 = t(g.beat(2));
  const landed = k1(film, units, k1Start(land2, units.length, d(20 / 60), d(4 / 60)), { dur: d(20 / 60), stagger: d(4 / 60) });
  const sel = l2?.querySelector<HTMLElement>('.sel');
  if (sel) selSweep(film, sel, landed + f(4));
  kaiC.look(t(0.62), 9, 13);
  ninaC.look(t(0.68), -8, 13);

  /* beat 2: kai talks to nina; she listens with round, attentive eyes */
  kaiC.look(t(0.98), 20, 1);
  ninaC.look(t(1.0), -20, 1);
  const k0 = t(g.beat(2)), k1e = t(1.47);
  kaiC.speak(k0, k1e);
  lean(film, kai, k0, k1e, 1);
  eyes(film, nina, t(1.12), 'circle', { dur: 0.14 });
  eyes(film, nina, t(1.44), 'pill', { dur: 0.12 });
  /* beat 3: nina answers, and is pleased with herself; kai listens */
  const n0 = t(g.beat(3)), n1 = t(1.98);
  ninaC.speak(n0, n1);
  lean(film, nina, n0, n1, -1);
  eyes(film, nina, t(1.92), 'arc', { dur: 0.16 });
  eyes(film, kai, t(1.66), 'circle', { dur: 0.14 });
  eyes(film, kai, t(2.0), 'pill', { dur: 0.13 });
  /* beat 4: both turn to camera (gaze well under the .30 / .20 rad cap) */
  kaiC.look(t(g.beat(4)), divePose.yaw, divePose.pitch);
  ninaC.look(t(g.beat(4)) + f(2), -5, 3);
  eyes(film, nina, t(g.beat(4)) + f(2), 'pill', { dur: 0.16 });
  ninaC.blink(t(g.beat(4)) + f(10));

  /* a constant push (craft bible 3: linear only for motion that never starts or stops on screen: it is moving on frame
     0, and the dive takes it over) */
  const pushEnd = dive ? swap - f(24) : T.end;
  film.tl.fromTo(cam.state, { lz: 0 }, { lz: Math.log(1.06), duration: pushEnd - T.start, ease: linear, immediateRender: false, data: { linear: true, blur: false, role: 'camera' } }, T.start);
  if (!dive) return;

  /* ── the dive (T2): the eye opens onto B02 ── */
  const kf2 = s.kf.b02!;
  const O = s.origin ?? centre(s.m.col!);
  s.origin = O;
  const dStart = swap - f(24);
  s.diveStart = dStart;
  kaiC.hold(dStart, swap + 1);
  const eye0 = eyeOf(divePose);
  const cen = (p: Pt[]): [number, number] => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
  const E = cen(eye0);
  /* the opening: the eye's own outline scaled about its centre, from nothing (at 42% of the dive) to 96% of the eye
     (at 94%); the ink that is left is a ring that sweeps out past the frame's edges as the camera falls in */
  const H_END = 0.96, K_OPEN = 0.42, K_FULL = 0.94;
  const hole = (k: number): number => H_END * smooth((k - K_OPEN) / (K_FULL - K_OPEN));
  const scaled = (p: Pt[], h: number): Pt[] => { const c = cen(p); return p.map(([x, y]) => [c[0] + h * (x - c[0]), c[1] + h * (y - c[1])] as Pt); };
  /* Z: the smallest scale at which the full opening, scaled about the eye's centre onto O, covers the frame with room */
  const inside = (x: number, y: number, poly: Pt[]): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const opening = scaled(eye0, H_END);
  const probes: [number, number][] = [];
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]] as const) probes.push([O[0] + (u * W - O[0]) * 1.06, O[1] + (v * H - O[1]) * 1.06]);
  let Z = 20;
  while (Z < 4000 && !probes.every(([x, y]) => inside(E[0] + (x - O[0]) / Z, E[1] + (y - O[1]) / Z, opening))) Z *= 1.02;
  Z *= 1.04;
  const lnZ = Math.log(Z);

  /* the opening's own ground: B02's light on a box wide enough to fill the eye at any scale (the film's ground takes
     over at the swap, drawing the same ellipse on the same pixels) */
  kf2.style.overflow = 'visible';
  kf2.style.transformOrigin = '0 0';
  const pg = document.createElement('div');
  pg.className = 'ground a1-portal-ground';
  pg.style.inset = '-400%';
  setVars(pg, poolVars(s.pool.b02!, 4));
  kf2.prepend(pg);
  vis(film, pg, (x) => x >= dStart - 1e-9 && x < swap - 1e-9);

  const p = { k: 0, __name: 'a1-dive' };
  film.tl.fromTo(p, { k: 0 }, { k: 1, duration: f(24), ease: snap, immediateRender: false, data: { role: 'camera' } }, dStart);
  film.onRender((x) => {
    if (x < dStart - 1e-9 || x >= swap - 1e-9) {
      if (G.style.transform) G.style.transform = '';
      if (kf2.style.transform) kf2.style.transform = '';
      if (kf2.style.clipPath) kf2.style.clipPath = '';
      return;
    }
    const k = p.k, S = Math.exp(lnZ * k);
    const Px = E[0] + (O[0] - E[0]) * k, Py = E[1] + (O[1] - E[1]) * k;
    G.style.transform = 'translate(' + Px.toFixed(3) + 'px,' + Py.toFixed(3) + 'px) scale(' + S.toFixed(6) + ') translate(' + (-E[0]).toFixed(3) + 'px,' + (-E[1]).toFixed(3) + 'px)';
    kf2.style.transform = 'translate(' + Px.toFixed(3) + 'px,' + Py.toFixed(3) + 'px) scale(' + (S / Z).toFixed(8) + ') translate(' + (-O[0]).toFixed(3) + 'px,' + (-O[1]).toFixed(3) + 'px)';
    /* the opening, in B02's coordinates: kai's eye as drawn now, scaled about its centre by the opening's size */
    const h = hole(k);
    const local = scaled(eyeOf(kai.drawn()), Math.max(h, 1e-3)).map(([ex, ey]) => [O[0] + Z * (ex - E[0]), O[1] + Z * (ey - E[1])] as Pt);
    kf2.style.clipPath = h <= 1e-3 ? 'inset(50%)' : 'path("' + ptsToD(local) + '")';
  }, -3);

  /* the camera: the push, then back to rest under the dive, so B02 begins at rest exactly where the opening lands */
  cam.to({ x: W / 2, y: H / 2, zoom: 1, roll: 0 }, { at: dStart, dur: f(24), ease: snap });
  /* the ground takes B02's light under the opening's cover; the swap lands on identical pixels */
  if (s.ground && s.pool.b01 && s.pool.b02) poolTo(film, s.ground, s.pool.b01, s.pool.b02, swap - f(1), f(1));
  film.cut(swap);
  film.mark('B01 dive into kai\'s eye', dStart);
}
