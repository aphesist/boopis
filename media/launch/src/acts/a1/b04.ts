/* B04, the room: you ask once (7.467 to 9.600 s, bars 4.3 to 5.3).

   The orbs land in the room's head stack (B03's flights, kai first on the beat), each on top of the one before and
   nudging it; each is a character from its landing. The room "release" builds out of the stack, its parts overlapping
   by a few frames: the plate grows out from behind the stack (T8), the name and the members rise beside it, the head's
   actions follow, and the composer rises from the bottom edge (arrive 30 f) with its four member chips while the cursor
   arcs in (34 f) and clicks into it on beat 15. The line types (K2, 28 cps) and "@kai" becomes the mention chip as the
   handle completes: the "@" folds into kai's orb, the capsule opens behind the name (the kit's own chip, on the text's
   baseline), and the stack's kai hops at being named while the others look at him; they read along. The cursor goes to
   the send button and presses on beat 17 in the product's order: the cursor dips, the button squeezes to .96, and on
   the frame it bottoms out the line lifts out of the composer and travels up into the thread as your request, its call
   number "You 14:02" arriving under it; the button greys once the field is empty and the placeholder comes back. The
   presence entry "kai thinking" rises at the thread's tail (the product's --dur-2, 6 px, --ease). The camera leans to
   the composer while you type, follows the request up and lands at rest on 9.600 with every part at rest: the seam S1
   state, B04's key frame. */
import type { ActCtx } from '../context';
import type { FilmOrb } from '../../engine/orb';
import { eyes } from '../../motion/orb-moves';
import { character, type Character } from '../../motion/character';
import { boxOf } from '../../motion/carry';
import { arrive, travel, ui } from '../../motion/ease';
import { a1state } from './state';
import { SEAM, a1css, centre, chain, f, kfCursor, poolTo, tmap, vis, zoomOf } from './util';
import { hop, land, nudge, poseNow } from './orbs';
import { LAND_POSE, STACK_ORDER } from './b03';

export async function b04(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B04')) return;
  const s = await a1state(ctx);
  const { film, stage, g, cam } = ctx;
  const T = tmap(ctx, 'B04'), t = T.t, d = T.d;
  const kf = s.kf.b04!, m = s.m, orbs = s.orbs.b04!;
  const W = stage.width, H = stage.height;
  film.mark('B04 the room', T.start);
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
  const emptyH = input.offsetHeight;
  input.appendChild(typed);
  input.dataset['empty'] = 'false';
  const typedH = input.offsetHeight;
  /* the field keeps one height from its placeholder to the typed line (critique A1-15: it snapped on the first key) */
  if (Math.abs(typedH - emptyH) > 0.5) input.style.minHeight = Math.max(typedH, emptyH) + 'px';
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

  /* ── the stack: each orb is the B03 orb that landed there, in the same pose, and a character from its landing ── */
  const stack = STACK_ORDER.map((n) => orbs.get(n)!);
  const cs: Character[] = [];
  stack.forEach((so, j) => {
    const L = s.landAt[so.name] ?? T.start + j * f(3);
    poseNow(so.orb, LAND_POSE);
    cs.push(character(film, so.orb, { seed: 41 + j * 13, from: L }));
    vis(film, so.holder, (x) => x >= L - 1e-9, { after: true });
    land(film, so.orb, L, 0.1);
    const prev = stack[j - 1];
    if (prev) nudge(film, prev.orb, L, -prev.orb.size * 0.035);
  });
  const [kai] = stack.map((x) => x.orb) as [FilmOrb];
  const [kaiC, ninaC, mossC, voxC] = cs as [Character, Character, Character, Character];

  /* ── the plate grows out from behind the stack (T8) ── */
  const [scx, scy] = m.slot.length ? [(m.slot[0]!.x + m.slot[m.slot.length - 1]!.x + m.slot[m.slot.length - 1]!.w) / 2, centre(m.slot[0]!)[1]] : centre(plateBox);
  const plateAt = t(7.5), PLATE = d(f(30));
  film.tl.fromTo(plate, { left: scx, top: scy, width: 0, height: 0 }, { left: plateBox.x, top: plateBox.y, width: plateBox.w, height: plateBox.h, duration: PLATE, ease: arrive, immediateRender: true, data: { role: 'carry' } }, plateAt);

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
    /* in from just past the lower right edge, on an arc over 34 f, arriving 4 f before the click (critique A1-03) */
    c.from(W + 40, H + 60);
    c.move(clickX, clickY, typeAt - f(8) - d(f(34)), d(f(34)), 0.16);
    c.press(typeAt - f(4));
    /* to the send button over 30 f, arriving 4 f before the press; after it, just off the button, inside the frame */
    c.move(sxc - tip.x - 6, syc - tip.y - 4, sendHit - f(8) - d(f(30)), d(f(30)), 0.12);
    c.press(sendHit - f(4));
    c.move(Math.min(curRest.x, W - 60), curRest.y, sendHit + d(f(6)), d(f(20)), 0.2);
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
  /* the orb grows in its holder (a transform: the kit's .ui-orb box, which sets the chip's baseline, is never touched) */
  const chipHolder = chipOrbEl.querySelector<HTMLElement>('.film-orb-holder') ?? chipOrbEl;
  chipHolder.style.transformOrigin = '50% 50%';
  film.tl.fromTo(chipHolder, { scale: 0 }, { scale: 1, duration: CHIP, ease: arrive, immediateRender: true, data: { role: 'ui' } }, chipAt);
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
    /* the send button wakes with the first key and greys only once the field is empty (the product's order) */
    const up = Math.min(1, Math.max(0, (x - typeAt) / f(8))), down = Math.min(1, Math.max(0, (x - (lift + d(f(9)))) / f(8)));
    const k = ui(up) * (1 - ui(down));
    send.style.opacity = (0.35 + 0.65 * k).toFixed(4);
  });
  input.classList.add('a1-input');
  /* the press: the button squeezes to .96 as the cursor dips, and lets go on the frame the line lifts */
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

  /* ── the stack acts (looks are the characters' queues: each takes over from the one before, never a fight) ── */
  cs.forEach((c, j) => c.look(t(7.74) + j * f(2), 18, 2));                 /* to "release" as it rises */
  cs.forEach((c, j) => c.look(typeAt + f(2) + j * f(2), 10, -16));         /* down to the composer */
  const hopAt = chipAt + f(8);
  hop(film, kai, hopAt, kai.size * 0.07);                                   /* named */
  eyes(film, kai, hopAt - f(4), 'circle', { dur: 0.14 });
  eyes(film, kai, hopAt + 0.38, 'pill', { dur: 0.14 });
  [ninaC, mossC, voxC].forEach((c, j) => c.look(chipAt + f(6) + j * f(2), -24, 1));   /* the others look at him */
  /* they read along as the line types, their gaze following it to the right */
  cs.forEach((c, j) => c.look(t(8.5) + j * f(2), 4, -16));
  cs.forEach((c, j) => c.look(t(8.74) + j * f(2), 14, -15));
  mossC.blink(t(8.46));
  ninaC.blink(t(8.82));
  /* they follow your request up into the thread; kai turns to thinking with his presence */
  cs.forEach((c, j) => c.look(lift - f(4) + j * f(2), j === 0 ? -8 : -20, j === 0 ? 12 : -2));
  eyes(film, kai, presAt + f(2), 'squint', { dur: 0.18 });
  chain(film, kai, 'squash', presAt, 0, [[4, 0.04, ui], [14, 0, travel]]);
  void kaiC;
  const presOrb = [...orbs.values()].find((o) => presence.contains(o.holder))?.orb;
  if (presOrb) character(film, presOrb, { seed: 97, from: presAt }).look(presAt + f(6), -10, 12);

  /* ── the lamp opens on the room; the camera eases back to rest and lands on the seam ── */
  if (s.ground && s.pool.b03 && s.pool.b04) poolTo(film, s.ground, s.pool.b03, s.pool.b04, plateAt, d(0.7));
  const camFrom = s.camFree ?? T.start;
  const leanY = H / 2 + (centre(compBox)[1] - H / 2) * 0.16;
  cam.to({ x: W / 2, y: H / 2, zoom: 1.0 }, { at: camFrom, dur: compLand - camFrom, ease: travel });
  cam.to({ y: leanY, zoom: 1.05 }, { at: typeAt - f(6), dur: lift - typeAt + f(2), ease: arrive });
  cam.to({ x: W / 2, y: H / 2, zoom: 1, roll: 0 }, { at: lift + f(2), dur: T.end - lift - f(2), ease: travel });
  s.camFree = T.end;
}
