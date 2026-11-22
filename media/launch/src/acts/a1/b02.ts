/* B02, the promise (2.667 to 5.067 s, bars 2.2 to 3.2.5).

   The four real sign-in buttons (ui.signinButton at 2.4x, the app's order: ChatGPT, GitHub, Claude, xAI) fan out of
   the point the dive came through, each from 60% scale on the settle spring, 3 f apart (U4), the last landing on beat
   6; they start inside kai's eye, so the fan is already moving when the window becomes the frame. Each label arrives
   once its button is large enough to read, 9 f after the button. "Bring the plans you already pay for" rises (K1) and
   lands on beat 6.5, the selection sweeps in behind "already"; the line holds and leaves on depart at 4.933. The
   camera breathes in. B03 turns the shells into cards. */
import type { ActCtx } from '../context';
import { arrive } from '../../motion/ease';
import { a1state } from './state';
import { SETTLE, centre, k1, k1Exit, k1Start, selSweep, settle, tmap, vis, wordUnits, zoomOf, sampleAll } from './util';

const f = (n: number): number => n / 60;

export async function b02(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B02')) return;
  const s = await a1state(ctx);
  const { film, stage, g, cam } = ctx;
  const T = tmap(ctx, 'B02'), t = T.t, d = T.d;
  const kf = s.kf.b02!, m = s.m;
  const line = kf.querySelector<HTMLElement>('.film-line');
  const btns = [...kf.querySelectorAll<HTMLElement>('.ui-sso')];
  const z = btns[0] ? zoomOf(btns[0], stage) : 2.4;
  const O = s.origin ?? centre(m.col!);
  film.mark('B02 the promise', T.start);
  sampleAll(film, T.start, T.end);

  /* the key frame shows from the dive's start (inside the eye) until its last lab mark has landed in a card (B03) */
  const from = s.diveStart ?? T.start;
  vis(film, kf, (x) => x >= from - 1e-9 && x < (s.kf2End ?? T.end) - 1e-9);
  film.onRender((x) => { const want = x < 9.6 ? '2' : ''; if (kf.style.zIndex !== want) kf.style.zIndex = want; }, -9);

  /* the fan (U4): the last button lands on beat 6 */
  const dur = T.k === 1 ? SETTLE : d(SETTLE), ease = T.k === 1 ? settle : arrive;
  const land = t(g.beat(6));
  btns.forEach((b, i) => {
    b.style.zIndex = String(10 - i);               /* ChatGPT on top of the stack in the eye, first out */
    const c = centre(m.btn[i]!);
    const st = land - dur - (btns.length - 1 - i) * d(f(3));
    film.tl.fromTo(b, { x: (O[0] - c[0]) / z, y: (O[1] - c[1]) / z, scale: 0.6 }, { x: 0, y: 0, scale: 1, duration: dur, ease, immediateRender: true, data: { role: 'ui' } }, st);
    /* the labels wipe on down the column once the promise has landed, one a sixteenth: the eye reads the line, then
       the four plans in order (a moving edge, not a fade) */
    const label = b.querySelector<HTMLElement>('.ui-sso__label');
    if (label) film.tl.fromTo(label, { clipPath: 'inset(0% 100% 0% 0%)', x: -8 / z }, { clipPath: 'inset(0% 0% 0% 0%)', x: 0, duration: d(f(12)), ease: arrive, immediateRender: true, data: { role: 'ui' } }, t(g.beat(6.75 + i * 0.25)));
  });

  /* the promise rises */
  if (line) {
    const units = wordUnits(line);
    /* a slower K1 (22 f, 5 f apart): its first word comes up as the window opens, its last lands on beat 6.5 */
    const landed = k1(film, units, k1Start(t(g.beat(6.5)), units.length, d(22 / 60), d(5 / 60)), { dur: d(22 / 60), stagger: d(5 / 60) });
    const sel = line.querySelector<HTMLElement>('.sel');
    if (sel) selSweep(film, sel, landed + d(f(3)));
    k1Exit(film, units, t(4.933), d(12 / 60));
  }

  /* the camera moves with the motion and holds while you read: it eases in toward the column while the buttons fan out
     and the promise rises, and is still for the read (a slow drift over this much type measures as a cross-fade: every
     edge brightens and darkens in a straight line); B03 moves it on with the cards */
  const settleAt = t(g.beat(6));
  cam.to({ zoom: 1.045, y: stage.height / 2 + (O[1] - stage.height / 2) * 0.3 }, { at: T.start, dur: settleAt - T.start, ease: arrive });
  /* a punch-in on the downbeat of bar 3, mid-read: short and fast, so it reads as a move, never as a drift */
  const punch = t(g.beat(8));
  cam.to({ zoom: 1.075 }, { at: punch, dur: d(f(16)), ease: arrive });
  s.camFree = punch + d(f(16));
}
