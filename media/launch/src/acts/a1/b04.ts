/* B04, the room: you ask once (7.467 to 9.600 s, bars 4.3 to 5.3).

   The orbs land in the room's head stack (B03's flights, kai first on the beat), each on top of the one before; the
   room "release" opens around them: its plate grows out from behind the stack (T8, travel), the name and the members
   rise beside it, the head's actions follow, and the composer rises from the bottom edge (arrive 30 f) with its four
   member chips. The cursor arcs in from the lower right and clicks into the composer on beat 15; the line types (K2,
   28 cps, no caret while typing) and "@kai" becomes a mention chip as the handle completes: the "@" folds into kai's
   orb, the capsule opens behind the name, and the stack's kai hops at being named while the others look at him. The
   cursor goes to the send button and presses on beat 17 (the button dips to .96); on that frame the line lifts out of
   the composer and travels up into the thread as your request (travel 20 f), its call number "You 14:02" arriving
   under it, and the composer is empty again. The presence entry "kai thinking" rises at the thread's tail (the
   product's --dur-2, 6 px, --ease). The camera eases back to rest and lands on 9.600 with every part at rest: the seam
   S1 state, B04's key frame. */
import type { ActCtx } from '../context';
import type { FilmOrb } from '../../engine/orb';
import { blink, eyes, glance } from '../../motion/orb-moves';
import { boxOf } from '../../motion/carry';
import { arrive, travel, ui } from '../../motion/ease';
import { a1state } from './state';
import { SEAM, a1css, centre, kfCursor, poolTo, tmap, vis, zoomOf, sampleAll } from './util';
import { glanceBy, hop, land, nudge, poseNow, quick } from './orbs';
import { LAND_POSE, STACK_ORDER } from './b03';

const f = (n: number): number => n / 60;

export async function b04(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B04')) return;
  const s = await a1state(ctx);
  const { film, stage, g, cam } = ctx;
  const T = tmap(ctx, 'B04'), t = T.t, d = T.d;
  const kf = s.kf.b04!, m = s.m, orbs = s.orbs.b04!;
  const W = stage.width, H = stage.height;
  film.mark('B04 the room', T.start);
  sampleAll(film, T.start, T.end);
  a1css('.a1-input[data-empty="true"]::before { opacity: var(--a1-ph, 1); position: relative; top: var(--a1-phy, 0px); }');

  /* ── the parts (measured before any tween) ── */
  const plate = kf.querySelector<HTMLElement>('.plate--room')!;
  const places = [...kf.querySelectorAll<HTMLElement>(':scope > .ui-place')];
  const colOuter = places[1]!, compOuter = places[2]!;
  const nameEl = kf.querySelector<HTMLElement>('.bt-p-name'), membersEl = kf.querySelector<HTMLElement>('.bt-p-line');
  const actions = [...kf.querySelectorAll<HTMLElement>('.bt-p-actions > *')];
  const request = kf.querySelector<HTMLElement>('.ui-request')!;
  const reqCall = request.closest('.ui-entry')!.querySelector<HTMLElement>('.ui-callno')!;
  const presence = kf.querySelector<HTMLElement>('.ui-presence')!;
  const presParts = [presence.querySelector<HTMLElement>(':scope > .ui-callno'), presence.querySelector<HTMLElement>(':scope > .ui-entry__body')].filter((x): x is HTMLElement => !!x);
  const comp = compOuter.querySelector<HTMLElement>('.ui-composer')!;
  const input = comp.querySelector<HTMLElement>('.ui-composer__input')!;
  const send = comp.querySelector<HTMLElement>('.ui-send')!;
  const chips = [...comp.querySelectorAll<HTMLElement>('.ui-chip')];
  const acts = comp.querySelector<HTMLElement>('.ui-composer__acts');
  const cursorEl = kf.querySelector<HTMLElement>('.cursor');
  const zUI = zoomOf(request, stage);
  const compBox = boxOf(compOuter, stage), inputBox = boxOf(input, stage), sendBox = boxOf(send, stage);
  const plateBox = m.plate ?? boxOf(plate, stage);
  const curRest = cursorEl ? boxOf(cursorEl, stage) : null;
  const reqChip = request.querySelector<HTMLElement>('.ui-mention')!;
  const reqChipBox = boxOf(reqChip, stage);

  /* the typed line, in the composer: the handle "@kai" as typed, the mention chip it becomes, the rest of the ask */
  const typed = document.createElement('span');
  typed.className = 'a1-typed';
  typed.style.cssText = 'position:relative;display:inline';
  const chip = reqChip.cloneNode(true) as HTMLElement;
  chip.removeAttribute('aria-label');
  const handle = document.createElement('span');
  handle.className = 'a1-handle';
  handle.style.cssText = 'position:absolute;left:0;top:0;white-space:pre';
  const chars = (txt: string, into: HTMLElement): HTMLElement[] => [...txt].map((ch) => { const c = document.createElement('span'); c.textContent = ch; c.style.display = 'inline-block'; c.style.whiteSpace = 'pre'; into.appendChild(c); return c; });
  const hChars = chars('@kai', handle);
  const rest = document.createElement('span');
  const rChars = chars(' is it ready to cut?', rest);
  typed.append(chip, rest, handle);
  input.appendChild(typed);
  input.dataset['empty'] = 'false';
  /* measured in place: where the chip's name sits against the typed handle, and the chip against the request's */
  const chipBox = boxOf(chip, stage), chipName = boxOf(chip.querySelector('.ui-mention__name')!, stage), chipOrb = boxOf(chip.querySelector('.ui-orb')!, stage);
  const hb = hChars.map((c) => boxOf(c, stage));
  /* the handle sits on the chip's text line: its "kai" centred on the chip's name */
  const hKai = { x: hb[1]!.x, y: hb[1]!.y, w: hb[3]!.x + hb[3]!.w - hb[1]!.x, h: hb[1]!.h };
  handle.style.top = ((centre(chipName)[1] - centre(hKai)[1]) / zUI).toFixed(3) + 'px';
  const kaiShift = (chipName.x - hKai.x) / zUI;
  const atShift = (centre(chipOrb)[0] - centre(hb[0]!)[0]) / zUI;
  input.dataset['empty'] = 'true';

  /* ── visibility: the key frame from the first flight; its parts arrive on their own ── */
  vis(film, kf, (x) => x >= (s.flightStart ?? T.start) - 1e-9, { after: true });
  colOuter.style.zIndex = '2';   /* your request passes over the composer as it lifts */

  /* ── the stack: each orb is the B03 orb that landed there, in the same pose ── */
  const stack = STACK_ORDER.map((n) => orbs.get(n)!);
  stack.forEach((so, j) => {
    const L = s.landAt[so.name] ?? T.start + j * f(3);
    poseNow(so.orb, LAND_POSE);
    vis(film, so.holder, (x) => x >= L - 1e-9, { after: true });
    land(film, so.orb, L, 0.1);
    const prev = stack[j - 1];
    if (prev) nudge(film, prev.orb, L, -prev.orb.size * 0.035);
  });
  const [kai, nina, moss, vox] = stack.map((x) => x.orb) as [FilmOrb, FilmOrb, FilmOrb, FilmOrb];

  /* ── the plate grows out from behind the stack (T8) ── */
  const [scx, scy] = m.slot.length ? [(m.slot[0]!.x + m.slot[m.slot.length - 1]!.x + m.slot[m.slot.length - 1]!.w) / 2, centre(m.slot[0]!)[1]] : centre(plateBox);
  const plateAt = t(7.5), PLATE = d(f(30));
  film.tl.fromTo(plate, { left: scx, top: scy, width: 0, height: 0 }, { left: plateBox.x, top: plateBox.y, width: plateBox.w, height: plateBox.h, duration: PLATE, ease: arrive, immediateRender: true, data: { role: 'carry' } }, plateAt);

  /* the head's own ground (the product's sticky header is --bg-2) is revealed with the plate, never before it */
  const header = kf.querySelector<HTMLElement>('.room-head');
  if (header) {
    const headBox = boxOf(header, stage), hz = zoomOf(header, stage);
    header.style.background = 'transparent';
    const bg = document.createElement('div');
    bg.className = 'a1-headbg';
    bg.style.cssText = 'position:absolute;inset:0;z-index:-1;background:var(--bg-2);pointer-events:none';
    header.prepend(bg);
    film.onRender((x) => {
      if (x >= plateAt + PLATE - 1e-9) { if (bg.style.clipPath) bg.style.clipPath = ''; return; }
      const L = parseFloat(plate.style.left) || 0, Tp = parseFloat(plate.style.top) || 0, Wp = parseFloat(plate.style.width) || 0, Hp = parseFloat(plate.style.height) || 0;
      const x0 = Math.max(L, headBox.x), y0 = Math.max(Tp, headBox.y), x1 = Math.min(L + Wp, headBox.x + headBox.w), y1 = Math.min(Tp + Hp, headBox.y + headBox.h);
      if (x < plateAt - 1e-9 || x1 <= x0 || y1 <= y0) { bg.style.clipPath = 'inset(50%)'; return; }
      const r = Math.min(30, Wp / 2, Hp / 2) / hz;
      bg.style.clipPath = 'inset(' + ((y0 - headBox.y) / hz).toFixed(2) + 'px ' + ((headBox.x + headBox.w - x1) / hz).toFixed(2) + 'px ' + ((headBox.y + headBox.h - y1) / hz).toFixed(2) + 'px ' + ((x0 - headBox.x) / hz).toFixed(2) + 'px round ' + r.toFixed(2) + 'px)';
    }, 1);
  }

  /* ── the head: the name and members rise beside the stack, its actions follow ── */
  const riseIn = (el: HTMLElement | null, at: number, dy = 10, dx = 0, frames = 22): void => {
    if (el) film.tl.fromTo(el, { x: dx, y: dy, opacity: 0, filter: 'blur(5px)' }, { x: 0, y: 0, opacity: 1, filter: 'blur(0px)', duration: d(f(frames)), ease: arrive, immediateRender: true, data: { role: 'ui' } }, at);
  };
  riseIn(nameEl, t(7.55));
  riseIn(membersEl, t(7.55) + d(f(4)));
  actions.forEach((a, j) => riseIn(a, t(7.68) + j * d(f(3)), 0, -8, 18));

  /* ── the composer rises from the bottom edge and lands on beat 15; its chips and actions after it ── */
  const compLand = t(g.beat(15)), COMP = d(f(30));
  film.tl.fromTo(compOuter, { y: H - compBox.y + 40 }, { y: 0, duration: COMP, ease: arrive, immediateRender: true, data: { role: 'ui' } }, compLand - COMP);
  vis(film, compOuter, (x) => x >= compLand - COMP - 1e-9, { after: true });
  chips.forEach((c, j) => riseIn(c, compLand - COMP + d(f(10)) + j * d(f(2)), 6, 0, 16));
  riseIn(acts, compLand - COMP + d(f(16)), 6, 0, 16);

  /* ── the cursor: in from the lower right, a click into the composer on beat 15 ── */
  const typeAt = compLand;
  const sendHit = t(g.beat(17));
  if (cursorEl && curRest) {
    const tip = { x: 4, y: 4 };   /* the art director's arrow: its tip is 4 px into its box */
    const c = kfCursor(film, cursorEl, { x: curRest.x, y: curRest.y });
    const clickX = inputBox.x + inputBox.w * 0.3 - tip.x, clickY = inputBox.y + inputBox.h * 0.5 - tip.y;
    const [sxc, syc] = centre(sendBox);
    c.from(W + 140, H + 180);
    c.move(clickX, clickY, typeAt - f(4) - d(f(26)), d(f(22)), 0.18);
    c.press(typeAt - f(4));
    c.move(sxc - tip.x - 6, syc - tip.y - 4, t(8.62), d(f(22)), 0.12);
    c.press(sendHit - f(4));
    c.move(curRest.x, curRest.y, sendHit + d(f(6)), d(f(18)), 0.2);
  }

  /* ── typing (K2): the handle, the chip, the rest ── */
  const CPS = 28 / T.k, FADE = f(5);
  const charIn = (el: HTMLElement, at: number): void => { film.tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: FADE, ease: arrive, immediateRender: true, data: { role: 'type', blur: false } }, at); };
  hChars.forEach((c, i) => charIn(c, typeAt + i / CPS));
  const chipAt = typeAt + 4 / CPS + f(2), CHIP = d(f(9));
  const restAt = typeAt + 5 / CPS;
  rChars.forEach((c, i) => charIn(c, restAt + i / CPS));
  const lift = sendHit;
  /* the "@" folds into the orb, the capsule opens behind the name, the typed "kai" slides onto the chip's name */
  const chipOrbEl = chip.querySelector<HTMLElement>('.ui-orb')!, chipNameEl = chip.querySelector<HTMLElement>('.ui-mention__name')!;
  const openFrom = Math.max(0, 100 - (100 * (hb[3]!.x + hb[3]!.w - hb[0]!.x)) / chipBox.w);
  film.tl.fromTo(chip, { clipPath: 'inset(0% ' + openFrom.toFixed(2) + '% 0% 0% round 999px)' }, { clipPath: 'inset(0% 0% 0% 0% round 999px)', duration: CHIP, ease: arrive, immediateRender: true, data: { role: 'ui' } }, chipAt);
  chipOrbEl.style.transformOrigin = '50% 50%';
  chipOrbEl.style.display = 'inline-block';
  film.tl.fromTo(chipOrbEl, { scale: 0 }, { scale: 1, duration: CHIP, ease: arrive, immediateRender: true, data: { role: 'ui' } }, chipAt);
  hChars[0]!.style.transformOrigin = '50% 60%';
  film.tl.fromTo(hChars[0]!, { scale: 1, x: 0 }, { scale: 0, x: atShift, duration: d(f(6)), ease: ui, immediateRender: false, data: { role: 'ui' } }, chipAt);
  hChars.slice(1).forEach((c) => film.tl.fromTo(c, { x: 0 }, { x: kaiShift, duration: CHIP, ease: arrive, immediateRender: false, data: { role: 'ui' } }, chipAt));
  vis(film, chip, (x) => x >= chipAt - 1e-9 && x < lift - 1e-9);
  vis(film, chipNameEl, (x) => x >= chipAt + CHIP - 1e-9, { after: true });
  vis(film, handle, (x) => x < chipAt + CHIP - 1e-9);
  vis(film, typed, (x) => x >= typeAt - 1e-9 && x < lift - 1e-9);
  /* the composer's own state: its placeholder while empty, the send button awake while there is text */
  /* from the seam on, the composer is left as the key frame draws it, before any later act's renderer runs */
  film.onRender((x) => {
    if (x < SEAM - 1e-9) return;
    if (input.dataset['empty'] !== 'true') input.dataset['empty'] = 'true';
    if (send.style.opacity) send.style.opacity = '';
    input.style.removeProperty('--a1-ph'); input.style.removeProperty('--a1-phy');
  }, -11);
  film.onRender((x) => {
    if (x >= SEAM - 1e-9) return;
    /* the placeholder: there until you type; back, rising, once your request has left the composer */
    const back = lift + d(f(9)), ph = x < back ? 1 : arrive(Math.min(1, (x - back) / d(f(12))));
    input.style.setProperty('--a1-ph', ph.toFixed(4));
    input.style.setProperty('--a1-phy', ((1 - ph) * 8).toFixed(2) + 'px');
    const full = x >= typeAt - 1e-9 && x < lift + d(f(9)) - 1e-9;
    input.dataset['empty'] = full ? 'false' : 'true';
    const up = Math.min(1, Math.max(0, (x - typeAt) / f(8))), down = Math.min(1, Math.max(0, (x - lift) / f(8)));
    const k = ui(up) * (1 - ui(down));
    send.style.opacity = (0.35 + 0.65 * k).toFixed(4);
  });
  /* the placeholder comes back once your request has left the composer, rising into place */
  input.classList.add('a1-input');
  film.tl.fromTo(send, { scale: 1 }, { scale: 0.96, duration: f(4), ease: ui, immediateRender: false, data: { role: 'ui' } }, lift - f(4));
  film.tl.fromTo(send, { scale: 0.96 }, { scale: 1, duration: f(10), ease: ui, immediateRender: false, data: { role: 'ui' } }, lift);

  /* ── send: the line lifts into the thread as your request ── */
  const LIFT = d(f(24));
  film.tl.fromTo(request, { x: (chipBox.x - reqChipBox.x) / zUI, y: (chipBox.y - reqChipBox.y) / zUI }, { x: 0, y: 0, duration: LIFT, ease: travel, immediateRender: true, data: { role: 'carry' } }, lift);
  vis(film, request, (x) => x >= lift - 1e-9, { after: true });
  [...reqCall.children].forEach((c, j) => riseIn(c as HTMLElement, lift + LIFT - d(f(8)) + j * d(f(3)), 4, 0, 14));

  /* ── the presence rises at the thread's tail: the product's own --dur-2, 6 px, --ease ── */
  const presAt = lift + d(f(12)), DUR2 = d(0.2);
  presParts.forEach((el, j) => film.tl.fromTo(el, { y: 6 / zUI, opacity: 0 }, { y: 0, opacity: 1, duration: DUR2, ease: ui, immediateRender: true, data: { role: 'ui' } }, presAt + j * d(f(2))));

  /* ── the stack acts ── */
  const cast = [kai, nina, moss, vox];
  cast.forEach((o, j) => glance(film, o, t(7.74) + j * f(2), 18, 2));                   /* to "release" as it rises */
  cast.forEach((o, j) => glance(film, o, typeAt + f(2) + j * f(2), 10, -16));           /* down to the composer */
  hop(film, kai, chipAt + f(2), kai.size * 0.07);                                        /* named */
  eyes(film, kai, chipAt + f(2), 'circle', { dur: 0.12 });
  eyes(film, kai, chipAt + 0.42, 'pill', { dur: 0.14 });
  [nina, moss, vox].forEach((o, j) => glance(film, o, chipAt + f(4) + j * f(2), -24, 1));  /* the others look at him */
  /* they read along as the line types, their gaze following it to the right */
  cast.forEach((o, j) => glance(film, o, t(8.5) + j * f(2), 4, -16));
  cast.forEach((o, j) => glance(film, o, t(8.72) + j * f(2), 14, -15));
  blink(film, moss, t(8.48));
  blink(film, nina, t(8.8));
  /* they follow your request up into the thread; kai turns to thinking with his presence */
  cast.forEach((o, j) => glanceBy(film, o, lift + f(4) + j * f(2), 16, j === 0 ? -8 : -20, j === 0 ? 12 : -2));
  eyes(film, kai, presAt + f(2), 'squint', { dur: 0.16 });
  quick(film, kai, presAt, 4, { squash: 0.04 });
  film.tl.to(kai.pose, { squash: 0, duration: f(12), ease: travel, immediateRender: false, data: { role: 'orb' } }, presAt + f(4));
  const presOrb = [...orbs.values()].find((o) => presence.contains(o.holder))?.orb;
  if (presOrb) glanceBy(film, presOrb, presAt + f(6), 14, -10, 12);

  /* ── the lamp opens on the room; the camera eases back to rest and lands on the seam ── */
  if (s.ground && s.pool.b03 && s.pool.b04) poolTo(film, s.ground, s.pool.b03, s.pool.b04, plateAt, d(0.7));
  const camFrom = s.camFree ?? T.start;
  const leanY = H / 2 + (centre(compBox)[1] - H / 2) * 0.16;
  cam.to({ x: W / 2, y: H / 2, zoom: 1.0 }, { at: camFrom, dur: compLand - camFrom, ease: travel });
  cam.to({ y: leanY, zoom: 1.05 }, { at: typeAt - f(6), dur: lift - typeAt + f(2), ease: travel });
  cam.to({ x: W / 2, y: H / 2, zoom: 1, roll: 0 }, { at: lift + f(2), dur: T.end - lift - f(2), ease: travel });
  s.camFree = T.end;
}
