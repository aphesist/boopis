/* B01, the hook (0.000 to 2.667 s, bars 1.1 to 2.2).

   Frame 0 is the thumbnail: "[Claude] Claude and [ChatGPT] GPT" set over kai and nina, who look at each other on the
   lit table; the camera pushes 2% a second throughout. Beat 1: "Same group chat" rises (K1) and lands on beat 2, the
   orbs glance up at it as it comes, then the selection sweeps in behind "Same" and its caret lands. Beat 2: kai talks
   to nina (orb2's speaking face, a lean, a dip before the first word). Beat 3: nina answers and is pleased with
   herself. Beat 4: both turn to camera. Beat 4.25: the dive (T2): the camera falls into kai's left eye on snap with
   motion blur (24 f); the eye is a window, and what it looks onto is B02, drawn inside the eye's outline and scaled so
   that the eye covering the frame IS B02 at rest: the eye's dark interior becomes B02's ground, and the sign-in
   buttons are already riding out of its centre. Nothing fades: the eye is one opaque outline at every frame. */
import type { ActCtx } from '../context';
import { ptsToD, type OrbPose, type Pt } from '../../engine/orb';
import { blink, eyes, glance } from '../../motion/orb-moves';
import { boxOf } from '../../motion/carry';
import { linear, snap, travel } from '../../motion/ease';
import { a1state } from './state';
import { centre, k1, k1Start, poolTo, poolVars, selSweep, setVars, tmap, vis, wordUnits, sampleAll } from './util';
import { quick, speak, spring } from './orbs';

const f = (n: number): number => n / 60;

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
  sampleAll(film, T.start, T.end);

  /* the lamp of B01's key frame, on the film's ground */
  if (s.ground && s.pool.b01) setVars(s.ground, poolVars(s.pool.b01, 0.4));

  /* the dive's group: B01's key frame scales about kai's eye */
  const G = document.createElement('div');
  G.className = 'a1-dive';
  G.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0';
  kf.before(G);
  G.appendChild(kf);
  kf.style.visibility = '';
  const swap = T.end;
  /* with the dive, B01 is gone once the window has become B02; without it (the 6 s bumper) it stays, and its orbs are
     handed on: the bumper's B18 pushes into nina from this frame */
  if (dive) vis(film, G, (x) => x < swap - 1e-9);
  else {
    vis(film, G, () => true, { until: swap, after: true });
    ctx.carry.orbs = new Map([...(ctx.carry.orbs ?? []), ...orbs]);
  }

  /* measured before any tween: kai's centre, the eye the camera falls into */
  const kc = centre(boxOf(kaiS.holder, stage));
  const divePose: OrbPose = { ...kai.pose, yaw: 5, pitch: 3, roll: 0, eyes: 'pill', eyesTo: '', eyesMix: 0, blink: 0, squash: 0, scale: 1, dx: 0, dy: 0 };
  const eyeOf = (pose: OrbPose): Pt[] => {
    const geo = kai.geometry(pose);
    let best = geo.eyes[0]!, bx = -Infinity;
    for (const e of geo.eyes) { const cx = e.pts.reduce((a, p) => a + p[0], 0) / e.pts.length; if (cx > bx) { bx = cx; best = e; } }
    const sx = pose.scale * (1 + pose.squash * 0.5), sy = pose.scale * (1 - pose.squash), r = (pose.roll * Math.PI) / 180;
    const c = Math.cos(r), sn = Math.sin(r);
    return best.pts.map(([x, y]) => { const X = x * sx, Y = y * sy; return [kc[0] + pose.dx + X * c - Y * sn, kc[1] + pose.dy + X * sn + Y * c] as Pt; });
  };

  /* ── life before the dive ── */
  /* the idle float (orb2's own): a few px, out of phase */
  film.tl.fromTo(kai.pose, { dy: 0 }, { dy: -kai.size * 0.016, duration: d(0.55), ease: travel, yoyo: true, repeat: 3, immediateRender: false, data: { role: 'orb', blur: false } }, t(0));
  film.tl.fromTo(nina.pose, { dy: 0 }, { dy: -nina.size * 0.016, duration: d(0.5), ease: travel, yoyo: true, repeat: 3, immediateRender: false, data: { role: 'orb', blur: false } }, t(0.1));
  /* they perk up at each other before a word is said */
  blink(film, kai, t(0.16));
  quick(film, nina, t(0.24), 5, { squash: 0.09 });
  film.tl.to(nina.pose, { squash: -0.13, duration: d(f(7)), ease: travel, immediateRender: false, data: { role: 'orb' } }, t(0.24) + f(5));
  spring(film, nina, t(0.24) + f(12), { squash: 0 });
  spring(film, nina, t(0.24) + f(5), { roll: -6 });
  spring(film, nina, t(0.62), { roll: 0 });
  quick(film, kai, t(0.4), 5, { squash: 0.07 });
  film.tl.to(kai.pose, { squash: -0.1, duration: d(f(7)), ease: travel, immediateRender: false, data: { role: 'orb' } }, t(0.4) + f(5));
  spring(film, kai, t(0.4) + f(12), { squash: 0 });

  /* beat 1: "Same group chat" rises, landing on beat 2; the orbs glance up at it as it comes */
  const units = l2 ? wordUnits(l2) : [];
  const land2 = t(g.beat(2));
  const landed = k1(film, units, k1Start(land2, units.length, d(20 / 60), d(4 / 60)), { dur: d(20 / 60), stagger: d(4 / 60) });
  const sel = l2?.querySelector<HTMLElement>('.sel');
  if (sel) selSweep(film, sel, landed + f(4));
  glance(film, kai, t(0.62), 9, 13);
  glance(film, nina, t(0.68), -8, 13);

  /* beat 2: kai talks to nina; she listens (round, attentive eyes) */
  glance(film, kai, t(0.98), 20, 1);
  glance(film, nina, t(1.0), -20, 1);
  speak(film, kai, t(g.beat(2)), d(0.4), 1);
  eyes(film, nina, t(1.14), 'circle', { dur: 0.12 });
  /* beat 3: nina answers, and is pleased with herself; kai listens */
  eyes(film, nina, t(g.beat(3)) - 0.13, 'pill', { dur: 0.1 });
  speak(film, nina, t(g.beat(3)), d(0.38), -1, 'arc');
  eyes(film, kai, t(1.66), 'circle', { dur: 0.12 });
  eyes(film, kai, t(2.0), 'pill', { dur: 0.14 });
  /* beat 4: both turn to camera (gaze well under the .30 / .20 rad cap) */
  spring(film, kai, t(g.beat(4)), { yaw: divePose.yaw, pitch: divePose.pitch });
  spring(film, nina, t(g.beat(4)) + f(2), { yaw: -5, pitch: 3 });
  eyes(film, nina, t(g.beat(4)) + f(2), 'pill', { dur: 0.16 });
  blink(film, nina, t(g.beat(4)) + f(10));

  if (!dive) {
    /* a cut without B02 (the 6 s bumper): the beat ends on the turn to camera, the push still going */
    film.tl.fromTo(cam.state, { lz: 0 }, { lz: Math.log(1.06), duration: T.end - T.start, ease: linear, immediateRender: false, data: { linear: true, blur: false, role: 'camera' } }, T.start);
    return;
  }

  /* ── the dive (T2) ── */
  const kf2 = s.kf.b02!;
  const O = s.origin ?? centre(s.m.col!);
  s.origin = O;
  const eye0 = eyeOf(divePose);
  const E: [number, number] = [eye0.reduce((a, p) => a + p[0], 0) / eye0.length, eye0.reduce((a, p) => a + p[1], 0) / eye0.length];
  /* Z: the smallest scale at which the eye, scaled about its centre onto O, covers the whole frame with room to spare */
  const inside = (x: number, y: number, poly: Pt[]): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const probes: [number, number][] = [];
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]] as const) probes.push([O[0] + (u * W - O[0]) * 1.08, O[1] + (v * H - O[1]) * 1.08]);
  let Z = 20;
  while (Z < 4000 && !probes.every(([x, y]) => inside(E[0] + (x - O[0]) / Z, E[1] + (y - O[1]) / Z, eye0))) Z *= 1.02;
  Z *= 1.1;
  const lnZ = Math.log(Z);
  const dStart = swap - f(24);
  s.diveStart = dStart;

  /* the window's own ground: B02's lamp on a box wide enough to fill the eye at any scale (the film's ground takes over
     at the swap, drawing the same ellipse on the same pixels) */
  kf2.style.overflow = 'visible';
  kf2.style.transformOrigin = '0 0';
  const pg = document.createElement('div');
  pg.className = 'ground a1-portal-ground';
  pg.style.inset = '-400%';
  setVars(pg, poolVars(s.pool.b02!, 4));
  kf2.prepend(pg);
  vis(film, pg, (x) => x >= dStart - 1e-9 && x < swap - 1e-9);

  const p = { k: 0, __name: 'a1-dive' };
  film.tl.fromTo(p, { k: 0 }, { k: 1, duration: f(24), ease: snap, immediateRender: false, data: { role: 'camera', samples: 32 } }, dStart);
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
    /* the window is the eye as kai's pose draws it now, in B02's coordinates */
    const local = eyeOf(kai.pose).map(([ex, ey]) => [O[0] + Z * (ex - E[0]), O[1] + Z * (ey - E[1])] as Pt);
    kf2.style.clipPath = 'path("' + ptsToD(local) + '")';
  }, -5);

  /* the camera: the push, then back to rest under the dive, so B02 begins at rest exactly where the window lands */
  /* a constant push (craft bible 3: linear only for motion that never starts or stops on screen: it is moving on frame
     0 and the dive takes it over) */
  film.tl.fromTo(cam.state, { lz: 0 }, { lz: Math.log(1.06), duration: dStart - T.start, ease: linear, immediateRender: false, data: { linear: true, blur: false, role: 'camera' } }, T.start);
  cam.to({ x: W / 2, y: H / 2, zoom: 1, roll: 0 }, { at: dStart, dur: f(24), ease: snap });
  /* the ground takes B02's lamp under the window's cover */
  if (s.ground && s.pool.b01 && s.pool.b02) poolTo(film, s.ground, s.pool.b01, s.pool.b02, swap - f(1), f(1));
  film.mark('B01 dive into kai\'s eye', dStart);
}
