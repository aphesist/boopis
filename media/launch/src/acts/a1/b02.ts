/* B02, the promise (2.667 to 5.067 s, bars 2.2 to 3.2.5).

   The four real sign-in buttons (ui.signinButton, the app's order: ChatGPT, GitHub, Claude, xAI) fan out of the point
   the dive came through, each from 60% scale on the settle spring, 3 f apart (U4). They start inside kai's eye, so the
   fan is well under way when the opening fills the frame (critique A1-11: no empty frame after the dive), and the last
   lands on beat 5.5. The labels write themselves in as the buttons settle (K2: whole characters with a soft leading
   edge, never a clip edge, A1-10), once the buttons are large enough for their words to be read. "Bring the plans you
   already pay for" rises (K1) as the opening fills, lands on beat 6.5, the selection sweeps in behind "already"; the
   line leaves on depart before the cast's line comes (A1-17). The camera eases in with the fan, drifts gently through
   the read, and punches in on the downbeat of bar 3. B03 turns the shells into cards. */
import type { ActCtx } from '../context';
import { arrive } from '../../motion/ease';
import { a1state } from './state';
import { SETTLE, centre, f, k1, k1Exit, k1Start, selSweep, settle, tmap, vis, wordUnits, zoomOf } from './util';

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

  /* the key frame shows from the dive's start (inside the eye) until its last lab mark has landed in a card (B03) */
  const from = s.diveStart ?? T.start;
  vis(film, kf, (x) => x >= from - 1e-9 && x < (s.kf2End ?? T.end) - 1e-9);
  film.onRender((x) => { const want = x < 9.6 ? '2' : ''; if (kf.style.zIndex !== want) kf.style.zIndex = want; }, -9);

  /* the fan (U4): it starts inside the eye; the last button lands on beat 5.5 */
  const dur = T.k === 1 ? SETTLE : d(SETTLE), ease = T.k === 1 ? settle : arrive;
  const land = t(g.beat(5.5));
  const starts: number[] = [];
  btns.forEach((b, i) => {
    b.style.zIndex = String(10 - i);               /* ChatGPT on top of the stack in the eye, first out */
    const c = centre(m.btn[i]!);
    const st = land - dur - (btns.length - 1 - i) * d(f(3));
    starts.push(st);
    film.tl.fromTo(b, { x: (O[0] - c[0]) / z, y: (O[1] - c[1]) / z, scale: 0.6 }, { x: 0, y: 0, scale: 1, duration: dur, ease, immediateRender: true, data: { role: 'ui' } }, st);
  });

  /* the labels write themselves in (K2 at 60 a second, each character over 5 f), one button 3 f after the other, from
     when the opening has filled the frame and the buttons are past 84% of their size (their 34 px words at 28 px and
     more on screen) */
  const typeAt = Math.max(t(2.63), (s.diveStart ?? T.start) + f(22));
  btns.forEach((b, i) => {
    const label = b.querySelector<HTMLElement>('.ui-sso__label');
    if (!label) return;
    const text = label.textContent ?? '';
    label.textContent = '';
    const chars = [...text].map((ch) => { const c = document.createElement('span'); c.textContent = ch; label.appendChild(c); return c; });
    const at0 = Math.max(typeAt + i * d(f(3)), (starts[i] ?? 0) + d(f(9)));
    chars.forEach((c, j) => film.tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: f(5), ease: arrive, immediateRender: true, data: { role: 'type', blur: false } }, at0 + j * d(1 / 60)));
  });

  /* the promise rises as the opening fills, and lands on beat 6.5 */
  if (line) {
    const units = wordUnits(line);
    const landed = k1(film, units, k1Start(t(g.beat(6.5)), units.length, d(22 / 60), d(5 / 60)), { dur: d(22 / 60), stagger: d(5 / 60) });
    const sel = line.querySelector<HTMLElement>('.sel');
    if (sel) selSweep(film, sel, landed + d(f(3)));
    /* it leaves before the cast's line rises (B03 starts its words 4 f after this ends) */
    s.line2Out = k1Exit(film, units, t(4.867), d(12 / 60));
  }

  /* the camera eases in with the fan, drifts gently through the read (under a quarter of a pixel a frame at the frame's
     edge, so resting type never shimmers), and punches in on the downbeat of bar 3, mid-read */
  const H = stage.height;
  const settleAt = t(g.beat(6));
  cam.to({ zoom: 1.04, y: H / 2 + (O[1] - H / 2) * 0.3 }, { at: T.start, dur: settleAt - T.start, ease: arrive });
  const punch = t(g.beat(8));
  cam.drift({ zoom: 1.048 }, { at: settleAt, dur: punch - settleAt });
  cam.to({ zoom: 1.08 }, { at: punch, dur: d(f(16)), ease: arrive });
  cam.drift({ zoom: 1.084 }, { at: punch + d(f(16)), dur: T.end - punch - d(f(16)) });
  s.camFree = T.end;
}
