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
    const label = b.querySelector<HTMLElement>('.ui-sso__label');
    if (label) film.tl.fromTo(label, { opacity: 0, x: -10 / z, filter: 'blur(3px)' }, { opacity: 1, x: 0, filter: 'blur(0px)', duration: d(f(14)), ease: arrive, immediateRender: true, data: { role: 'ui' } }, st + d(f(9)));
  });

  /* the promise rises */
  if (line) {
    const units = wordUnits(line);
    /* a slower K1 (22 f, 5 f apart): its first word comes up as the window opens, its last lands on beat 6.5 */
    const landed = k1(film, units, k1Start(t(g.beat(6.5)), units.length, d(22 / 60), d(5 / 60)), { dur: d(22 / 60), stagger: d(5 / 60) });
    const sel = line.querySelector<HTMLElement>('.sel');
    if (sel) selSweep(film, sel, landed + d(f(3)));
    k1Exit(film, line, t(4.933), d(12 / 60));
  }

  /* the camera breathes in across the promise and the cast in one long move (B03 writes the zoom, which runs on to the
     orbs' flight); here it leans toward the column */
  cam.drift({ y: stage.height / 2 + (O[1] - stage.height / 2) * 0.3 }, { at: T.start, dur: T.end - T.start });
  s.camZoomFrom = T.start;
  s.camFree = T.end;
}
