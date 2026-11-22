/* Act 2's beats. Each builder writes master times through `tm` (a cut-down replays it in its own window). */
import type { ActCtx } from '../context';
import { BOTS, h, sharpenOrbs } from '../../../look/src/stage';
import { T, botEntry, huddle, mdCtx, youEntry } from '../../../look/src/scenes/parts';
import { ui as ui_ } from '@boopis/ui';
import { swapOrbs } from '../../engine/look';
import { presence } from '../../../look/src/scenes/room';
import { like } from '../../../look/src/scenes/parts';
import { blink, eyes, glance } from '../../motion/orb-moves';
import type { FilmOrb } from '../../engine/orb';
import { a2state, type Placed } from './state';
import { entry } from './room';
import { exit, line, rise, split, swap } from './lines';
import { linear } from '../../motion/ease';
import { fly } from './fly';
import { kfCursor } from './cursor';
import { CAM, DUR, arrive, attrFrom, box, camSpring, depart, leaveOut, riseIn, tmap, travel, ui, uiSpring, vis, within, drift } from './util';

const F = (n: number): number => n / 60;

/* ───────── the presence entry's states, as the room draws them (ui.presence, the art director's `presence`) ───────── */
const P2 = (): HTMLElement => presence([
  { id: 'moss', bot: like(BOTS.moss), status: 'tool', doing: 'in the terminal', compute: true },
  { id: 'nina', bot: like(BOTS.nina), status: 'tool', doing: 'reading a file' }
]);
const P3 = (): HTMLElement => presence([{ id: 'moss', bot: like(BOTS.moss), status: 'tool', doing: 'in the terminal', compute: true }]);
const P4 = (): HTMLElement => presence([{ id: 'kai', bot: like(BOTS.kai), status: 'thinking' }]);

const orbOf = (p: Placed, name: string): FilmOrb => {
  for (const [k, v] of p.orbs) if (k === name || k.startsWith(name + '#') || v.name === name) return v.orb;
  throw new Error('a2: no orb ' + name);
};
/** a speaking face for a moment (orb2's speaking: bars that talk, a small bob), then back to its idle eyes */
function speak(ctx: ActCtx, o: FilmOrb, at: number, dur: number, rest = 'pill'): void {
  const film = ctx.film;
  eyes(film, o, at, 'bars', { dur: F(8), ease: ui });
  const n = Math.max(2, Math.round(dur / 0.22));
  for (let i = 0; i < n; i++) {
    const t = at + F(4) + i * (dur - F(12)) / n;
    film.tl.fromTo(o.pose, { scale: 1, squash: 0 }, { scale: 1.035, squash: 0.03, duration: F(5), ease: ui, immediateRender: false, data: { role: 'orb' } }, t);
    film.tl.fromTo(o.pose, { scale: 1.035, squash: 0.03 }, { scale: 1, squash: 0, duration: F(7), ease: ui, immediateRender: false, data: { role: 'orb' } }, t + F(5));
  }
  eyes(film, o, at + dur, rest, { dur: 0.38 });
}

/* ═════════ B05 They hand work on · 9.600 to 12.267 ═════════
   +0 kai's reply takes the presence entry's place, landing whole (its blocks rise 6 px in turn), his orb speaking; the
   camera follows the thread down (camera spring, 5 f lag), the head and your request scroll under the line's band.
   +1 the line rises (lands +2.25). +2 the presence returns below the reply: moss's orb, nina's 60 ms later, growing in;
   moss glances at her. The cursor, done, slides out of frame. */
export async function b05(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B05')) return;
  const s = await a2state(ctx);
  const tm = tmap(ctx, 'B05');
  const { film } = ctx;
  const { room, thread, lay } = s;
  const v = lay.v;
  const t0 = tm.t(9.6), follow = t0 + F(5);
  film.mark('B05', t0);

  /* ── the camera follows the thread down: the composer settles a little lower, the log scrolls up ── */
  const camY = v ? 930 : 490;
  ctx.cam.to({ y: camY }, { at: follow, dur: CAM, ease: camSpring });

  /* ── kai's reply, built where the presence entry is ── */
  const reply = entry(ctx, room, botEntry(BOTS.kai, T.kai1[0], T.kai1[1], [...T.kai1[2]]), room.top0);
  s.kaiReply = reply;
  thread.add('kai', reply.el, reply.h);
  vis(film, reply.el, within(t0));
  /* its orb and name are the presence entry's (the same pixels): act 1's stay, ours never draw */
  const who = reply.el.querySelector<HTMLElement>('.ui-callno__who');
  if (who) who.style.visibility = 'hidden';
  /* the presence's state word and its clock leave (--dur-out); the reply's blocks rise in turn (--dur-2, 6 px, 40 ms) */
  const pBody = room.presence.querySelector<HTMLElement>('.ui-entry__body');
  const pClock = room.presence.querySelector<HTMLElement>('.ui-presence__clock');
  if (pBody) leaveOut(film, pBody, t0, { y: -6, dur: F(6) });
  if (pClock) leaveOut(film, pClock, t0, { y: 4, dur: F(6) });
  const blocks = [...reply.el.querySelectorAll<HTMLElement>('.ui-entry__body .ui-md > *, .ui-entry__body > p')];
  const meta = [...reply.el.querySelectorAll<HTMLElement>('.ui-callno > :not(.ui-callno__who)')];
  blocks.forEach((b, i) => riseIn(film, b, t0 + F(4) + i * 0.04));
  meta.forEach((m, i) => riseIn(film, m, t0 + F(7) + i * 0.04));
  /* kai speaks for a moment, glancing at the two he names, then settles */
  const kai = room.kai;
  speak(ctx, kai, t0, 0.9);
  glance(film, kai, t0 + F(6), 22, 2);
  glance(film, kai, t0 + F(52), 6, 4);
  blink(film, kai, t0 + 1.62);

  /* ── the log follows: the reply's top lands under the line ── */
  thread.pin('kai', t0, { dur: 0, world: room.top0 });
  thread.pin('kai', follow, { screen: v ? 640 : 330 });
  /* the scroll edge comes down from above the frame to the line's band, with the scroll */
  film.tl.set(thread.band, { e: -1e4 }, 0);
  film.tl.fromTo(thread.band, { e: -80 }, { e: v ? 545 : 218, duration: CAM, ease: camSpring, immediateRender: false, data: { role: 'camera' } }, follow);

  /* ── the line rises in the ground above the reply (lands +2.25, holds) ── */
  const lineA = line(s.lines, v ? 'They {hand} work<br>to each other' : 'They {hand} work to each other', v ? { y: 300, size: 104 } : { y: 110, align: 'left', x: lay.L + 112 * lay.X, size: 88 });
  s.lineA = lineA;
  rise(film, lineA, tm.t(9.6 + ctx.g.beats(2.25)));

  /* ── +2 the presence returns: its stack grows in, moss first, nina 60 ms later; one sentence under them ── */
  const box = h('div', 'a2-pres', '', { position: 'absolute', left: '0', top: '0' });
  room.scroller.appendChild(box);
  const p2 = entry(ctx, room, P2(), 0), p3 = entry(ctx, room, P3(), 0), p4 = entry(ctx, room, P4(), 0);
  for (const p of [p2, p3, p4]) box.appendChild(p.el);
  s.pres = { box, p2, p3, p4, show3: Infinity, show4: Infinity };
  const pr = s.pres;
  const presAt = tm.t(9.6 + ctx.g.beats(2));
  const pres = thread.add('pres', box, p2.h, { open: false });
  pres.y0 = 0;
  film.tl.set(pres.slot, { v: 1 }, presAt);
  vis(film, box, within(presAt));
  vis(film, p3.el, (t) => t >= pr.show3 - 1e-9); vis(film, p4.el, (t) => t >= pr.show4 - 1e-9);
  for (const p of [p2, p3, p4]) for (const e of p.el.querySelectorAll('[data-enter], [data-leave]')) { e.removeAttribute('data-enter'); e.removeAttribute('data-leave'); }
  const pops = [...p2.el.querySelectorAll<HTMLElement>('.ui-presence__pop')];
  pops.forEach((sl, i) => riseIn(film, sl, presAt + i * 0.06, { y: 0, scale: 0.6, dur: DUR.d2 }));
  const words = p2.el.querySelector<HTMLElement>('.ui-presence__words, .ui-entry__body');
  if (words) riseIn(film, words, presAt + 0.1);
  const clock = p2.el.querySelector<HTMLElement>('.ui-presence__clock');
  if (clock) riseIn(film, clock, presAt + 0.14, { y: 4 });
  const moss = orbOf(p2, 'moss'), nina = orbOf(p2, 'nina');
  glance(film, moss, presAt + 0.16, 24, -2);        /* moss glances at nina as she joins */
  glance(film, nina, presAt + 0.42, -20, 0);
  glance(film, moss, presAt + 0.9, 10, 6);
  glance(film, nina, presAt + 1.05, 8, 8);
  blink(film, moss, presAt + 0.72);
  blink(film, nina, presAt + 1.2);
  glance(film, kai, presAt + 0.05, 14, 18);          /* kai looks down at who took the work */

  /* ── the cursor, done, slides out of frame (A1 parked it off the send button) ── */
  if (room.cursor) {
    s.cursor = kfCursor(film, room.cursor, t0);
    s.cursor.move(v ? 160 : 260, v ? 520 : 300, t0 + F(10), F(24), { ease: depart, arc: 0.1 });
  }

  /* ── the hold breathes: a slow push while the line and the presence stand ── */
  ctx.cam.drift(v ? { zoom: 1.05, y: camY + 64, x: 540 - 12 } : { zoom: 1.055, y: camY + 44, x: 960 - 32 }, { at: follow + CAM, dur: tm.t(12.0) - follow - CAM, ease: drift });
}

/* ═════════ B06 They work it out · 12.267 to 14.933 ═════════
   The line edits itself into "They work it out". +1 nina's reply lands above the presence (which never moves, and drops to
   moss alone): her orb flies from the presence into her entry. +3 moss's reply lands and the two gather into one huddle,
   open while the talk is live (the card's height at --dur-3 on --spring): nina's orb, her "to kai", her time and her words
   travel into her compact message; moss's orb flies in with his; the presence now reads kai, thinking. The camera follows
   the huddle up (16:9: the composer leaves the frame below). +4 kai's compact message lands, his orb flying in; the head
   line edits itself in place. +4.5 the presence leaves. */
export async function b06(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B06')) return;
  const s = await a2state(ctx);
  const tm = tmap(ctx, 'B06');
  const { film, stage } = ctx;
  const { room, thread, lay } = s;
  const v = lay.v, X = lay.X;
  film.mark('B06', tm.t(12.267));
  const va = <T>(t: number, read: () => T): T => thread.valueAt(t, read);
  const look = (b: { shape: string; color: string }): { shape: string; color: string } => ({ shape: b.shape, color: b.color });
  const pres = s.pres!;

  /* ── the line edits itself (12.0 to 12.8); the scroll edge follows the line's new foot ── */
  const lineB = line(s.lines, 'They {work} it out', v ? { y: 300, size: 104 } : { y: 84, align: 'left', x: lay.L + 112 * X, size: 88 });
  s.lineB = lineB;
  for (const u of lineB.units) film.tl.set(u, { yPercent: 112 }, 0);
  swap(film, stage, s.lineA!, lineB, tm.t(12.0), { land: tm.t(12.8) });
  film.tl.fromTo(thread.band, { e: v ? 545 : 218 }, { e: v ? 440 : 192, duration: 0.5, ease: travel, immediateRender: false, data: { role: 'camera' } }, tm.t(12.05));
  ctx.cam.drift(v ? { zoom: 1.07, x: 540 + 10, y: 1060 } : { zoom: 1.1, x: 960 - 110, y: 534 + 34 }, { at: tm.t(12.0), dur: tm.t(13.867) - tm.t(12.0), ease: drift });

  /* ── the entries this beat lands, stacked in one item of the log: nina's reply, then the huddle of two, then of three ── */
  const hbox = h('div', 'a2-hud', '', { position: 'absolute', left: '0', top: '0' });
  room.scroller.insertBefore(hbox, pres.box);
  const nina = entry(ctx, room, botEntry(BOTS.nina, T.huddle[0]!.text, '14:03', ['kai']), 0);
  const h2 = entry(ctx, room, huddle(T.huddle.slice(0, 2), true), 0);
  const h3 = entry(ctx, room, huddle(T.huddle, true), 0);
  const hf = entry(ctx, room, huddle(T.huddle, false), 0);
  const Hf = hf.h;
  hf.el.remove();
  for (const p of [nina, h2, h3]) hbox.appendChild(p.el);
  s.huddle = { box: hbox, nina, h2, h3, Hf };
  const hud = thread.add('hud', hbox, nina.h, { open: false, before: 'pres' });
  hud.y0 = 0;

  /* measure every part (world px as built: the item boxes sit at log 0) before any tween moves one */
  const B = (e: Element | null): { x: number; y: number; w: number; h: number } => box(e!, stage);
  const c = (b: { x: number; y: number; w: number; h: number }): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
  const q = (p: Placed, sel: string): HTMLElement => p.el.querySelector<HTMLElement>(sel)!;
  const qa = (p: Placed, sel: string): HTMLElement[] => [...p.el.querySelectorAll<HTMLElement>(sel)];
  const holderOf = (o: FilmOrb): HTMLElement => o.el.parentElement as HTMLElement;
  const msgs2 = qa(h2, '.bt-hmsg'), msgs3 = qa(h3, '.bt-hmsg');
  const ninaOrb = orbOf(nina, 'nina');
  const h2NinaOrb = [...h2.orbs.values()].filter((o) => o.name.startsWith('nina'))[1]!.orb;   /* [0] is the stack's */
  const h2MossOrb = [...h2.orbs.values()].filter((o) => o.name.startsWith('moss'))[1]!.orb;
  const h3KaiOrb = [...h3.orbs.values()].filter((o) => o.name.startsWith('kai'))[1]!.orb;
  const p2Nina = orbOf(pres.p2, 'nina'), p3Moss = orbOf(pres.p3, 'moss'), p4Kai = orbOf(pres.p4, 'kai');
  const m = {
    p2Nina: c(B(holderOf(p2Nina))), p3Moss: c(B(holderOf(p3Moss))), p4Kai: c(B(holderOf(p4Kai))),
    ninaOrb: c(B(holderOf(ninaOrb))), h2NinaOrb: c(B(holderOf(h2NinaOrb))), h2MossOrb: c(B(holderOf(h2MossOrb))), h3KaiOrb: c(B(holderOf(h3KaiOrb))),
    ninaTo: B(nina.el.querySelector('.bt-to')), ninaT: B([...nina.el.querySelectorAll('.ui-callno > span')].pop()!), ninaText: B(nina.el.querySelector('.ui-entry__body .ui-md, .ui-entry__body p')),
    h2To: B(msgs2[0]!.querySelector('.bt-hmsg__to')), h2T: B(msgs2[0]!.querySelector('.bt-hmsg__t')), h2Text: B(msgs2[0]!.querySelector('.ui-md'))
  };
  const ninaBot = look(BOTS.nina), mossBot = look(BOTS.moss), kaiBot = look(BOTS.kai);
  const size = 20 * X;

  /* the head line and the time of the huddle of two become the huddle of three's (measured now, before any tween moves
     their entries): words with the same text stay, the others change in place */
  const tkL = tm.t(14.4);
  const labelOf = (p: Placed): HTMLElement => (p.el.querySelector<HTMLElement>('.ui-disclosure > span:last-child') ?? q(p, '.ui-disclosure'));
  const timeOf = (p: Placed): HTMLElement => [...p.el.querySelectorAll<HTMLElement>('.ui-callno > span')].pop()!;
  const toOf = (p: Placed): HTMLElement => p.el.querySelector<HTMLElement>('.ui-callno .bt-to')!;
  /* in the narrow layout the margin is one row after the stack, so "between themselves" moves when the stack grows */
  const pairs: Array<[HTMLElement, HTMLElement]> = [[labelOf(h2), labelOf(h3)], [timeOf(h2), timeOf(h3)], [toOf(h2), toOf(h3)]];
  for (const [ea, eb] of pairs) {
    const la = split(ea), lb = split(eb);
    for (const u of lb.units) film.tl.set(u, { yPercent: 112 }, 0);
    swap(film, stage, la, lb, tkL + F(4), { zoom: X, showB: false, travelDur: F(22), land: tkL + F(34) });
    const end = tkL + F(4) + F(26) + F(22);
    film.onRender((t) => { const vv = t < tkL - 1e-9 ? '' : t < end ? 'visible' : 'hidden'; if (ea.style.visibility !== vv) ea.style.visibility = vv; }, -10);
  }

  /* ═══ +1 (12.8) nina's reply lands above the presence; the presence stays put and drops to moss alone ═══ */
  const tn = tm.t(12.8);
  thread.pin('pres', tn, { dur: 0, world: thread.worldTopAt('pres', tn - 1 / 600) });
  thread.open('hud', tn, DUR.d3, uiSpring);
  vis(film, nina.el, within(tn));
  const flyN = F(22);
  fly(ctx, { look: ninaBot, size, src: p2Nina, srcEl: holderOf(p2Nina), dst: ninaOrb, dstEl: holderOf(ninaOrb),
    from: thread.pointAt('pres', m.p2Nina[0], m.p2Nina[1], tn), to: thread.pointAt('hud', m.ninaOrb[0], m.ninaOrb[1], tn + flyN), at: tn, dur: flyN, arc: -0.2 }, va);
  const nBlocks = qa(nina, '.ui-entry__body .ui-md > *, .ui-entry__body > p'), nMeta = qa(nina, '.ui-callno > :not(.ui-callno__who)'), nName = qa(nina, '.bt-who-name');
  nName.forEach((e) => riseIn(film, e, tn + flyN - F(8)));
  nBlocks.forEach((e, i) => riseIn(film, e, tn + F(10) + i * 0.04));
  nMeta.forEach((e, i) => riseIn(film, e, tn + F(13) + i * 0.04));
  /* the presence: moss's orb stays where it is (p3 draws it in the same place), the words change, moss's name arrives */
  const p2Moss = orbOf(pres.p2, 'moss');
  vis(film, holderOf(p2Moss), (t) => t < tn);
  pres.show3 = tn;
  const p2Words = q(pres.p2, '.ui-presence__words'), p2Clock = pres.p2.el.querySelector<HTMLElement>('.ui-presence__clock');
  leaveOut(film, p2Words, tn, { y: -4 });
  vis(film, pres.p2.el, (t) => t < tn + DUR.out + F(2));
  if (p2Clock) vis(film, p2Clock, (t) => t < tn);
  for (const e of qa(pres.p3, '.ui-presence__name, .ui-presence__words')) riseIn(film, e, tn + DUR.out);
  film.tl.set(p3Moss.pose, { yaw: 10, pitch: 6 }, 0);
  glance(film, p3Moss, tn + F(4), -8, 16);             /* moss watches nina go up */
  glance(film, room.kai, tn + F(10), 4, -14);           /* kai looks down at her landing */
  glance(film, p3Moss, tn + 0.7, 6, 4);
  blink(film, ninaOrb, tn + 0.9);
  glance(film, room.kai, tn + 0.95, 10, 2);

  /* ═══ +3 (13.867) moss's reply lands: the two gather into one huddle; the camera follows it up ═══ */
  const tg = tm.t(13.867);
  if (!v) ctx.cam.to({ y: 160 }, { at: tg + F(2), dur: CAM, ease: camSpring });
  thread.pin('hud', tg, { dur: 0, world: thread.worldTopAt('hud', tg - 1 / 600) });
  thread.height('hud', h2.h, tg, DUR.d3, uiSpring);
  thread.pin('hud', tg + F(2), { screen: v ? 520 : 250 });
  vis(film, nina.el, (t) => t < tg + DUR.out + F(2));
  vis(film, h2.el, within(tg));
  /* nina's own parts go into her compact message: her orb flies, her "to kai", time and words travel, her mono name
     gives way to the message's */
  const fN2 = F(24);
  fly(ctx, { look: ninaBot, size, src: ninaOrb, srcEl: holderOf(ninaOrb), dst: h2NinaOrb, dstEl: holderOf(h2NinaOrb),
    from: thread.pointAt('hud', m.ninaOrb[0], m.ninaOrb[1], tg), to: thread.pointAt('hud', m.h2NinaOrb[0], m.h2NinaOrb[1], tg + fN2), at: tg, dur: fN2, arc: 0.14 }, va);
  for (const e of [...nMeta, ...nBlocks]) vis(film, e, (t) => t < tg);
  nName.forEach((e) => leaveOut(film, e, tg, { y: -4 }));
  const flip = (el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, at: number, dur: number): void => {
    film.tl.fromTo(el, { x: (from.x - to.x) / X, y: (from.y - to.y) / X }, { x: 0, y: 0, duration: dur, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, at);
  };
  const m2 = msgs2[0]!;
  flip(m2.querySelector<HTMLElement>('.bt-hmsg__to')!, m.ninaTo, m.h2To, tg, F(22));
  flip(m2.querySelector<HTMLElement>('.bt-hmsg__t')!, m.ninaT, m.h2T, tg + F(2), F(22));
  flip(m2.querySelector<HTMLElement>('.ui-md')!, m.ninaText, m.h2Text, tg, F(26));
  riseIn(film, m2.querySelector<HTMLElement>('.bt-hmsg__name')!, tg + F(20));
  /* the huddle's own parts arrive around them: the head line, the margin, the spine, moss's message */
  const disc2 = q(h2, '.ui-disclosure');
  riseIn(film, disc2, tg + F(10));
  const margin2 = qa(h2, '.ui-callno > :not(.ui-callno__who)');
  margin2.forEach((e, i) => riseIn(film, e, tg + F(12) + i * 0.04));
  const stack2 = qa(h2, '.bt-stack > *');
  stack2.forEach((e, i) => riseIn(film, e, tg + F(14) + i * 0.08, { y: 0, scale: 0.6 }));
  m2.classList.add('a2-spine');
  film.tl.fromTo(m2, { '--a2-sp': 0 }, { '--a2-sp': 1, duration: F(20), ease: travel, immediateRender: true, data: { role: 'ui' } }, tg + F(10));
  const fM = F(26);
  fly(ctx, { look: mossBot, size, src: p3Moss, srcEl: holderOf(p3Moss), dst: h2MossOrb, dstEl: holderOf(h2MossOrb),
    from: thread.pointAt('pres', m.p3Moss[0], m.p3Moss[1], tg), to: thread.pointAt('hud', m.h2MossOrb[0], m.h2MossOrb[1], tg + fM), at: tg, dur: fM, arc: -0.16 }, va);
  const m2b = msgs2[1]!;
  for (const e of [m2b.querySelector<HTMLElement>('.bt-hmsg__name'), m2b.querySelector<HTMLElement>('.bt-hmsg__to'), m2b.querySelector<HTMLElement>('.bt-hmsg__t')]) if (e) riseIn(film, e, tg + fM - F(10));
  riseIn(film, m2b.querySelector<HTMLElement>('.ui-md')!, tg + fM - F(6));
  /* the presence: moss leaves it (his orb flew), kai is thinking now */
  for (const e of qa(pres.p3, '.ui-presence__name, .ui-presence__words')) leaveOut(film, e, tg, { y: -4 });
  vis(film, pres.p3.el, (t) => t < tg + DUR.out + F(2));
  pres.show4 = tg + F(6);
  riseIn(film, q(pres.p4, '.ui-presence__pop'), tg + F(6), { y: 0, scale: 0.6 });
  for (const e of qa(pres.p4, '.ui-presence__name, .ui-presence__words')) riseIn(film, e, tg + F(10));
  film.tl.set(p4Kai.pose, { yaw: -6, pitch: 16 }, 0);
  glance(film, room.kai, tg + F(8), 6, -12);
  glance(film, p4Kai, tg + 0.35, 14, 20);
  blink(film, h2MossOrb, tg + 0.62);

  /* ═══ +4 (14.4) kai's compact message lands in the huddle; the head line edits itself in place ═══ */
  const tk = tm.t(14.4);
  thread.height('hud', h3.h, tk, DUR.d3, uiSpring);
  vis(film, h2.el, (t) => t < tk);
  vis(film, h3.el, within(tk));
  const fK = F(24);
  fly(ctx, { look: kaiBot, size, src: p4Kai, srcEl: holderOf(p4Kai), dst: h3KaiOrb, dstEl: holderOf(h3KaiOrb),
    from: thread.pointAt('pres', m.p4Kai[0], m.p4Kai[1], tk), to: thread.pointAt('hud', m.h3KaiOrb[0], m.h3KaiOrb[1], tk + fK), at: tk, dur: fK, arc: -0.18 }, va);
  const m3c = msgs3[2]!;
  for (const e of [m3c.querySelector<HTMLElement>('.bt-hmsg__name'), m3c.querySelector<HTMLElement>('.bt-hmsg__to'), m3c.querySelector<HTMLElement>('.bt-hmsg__t')]) if (e) riseIn(film, e, tk + fK - F(10));
  riseIn(film, m3c.querySelector<HTMLElement>('.ui-md')!, tk + fK - F(6));
  msgs3[1]!.classList.add('a2-spine');
  film.tl.fromTo(msgs3[1]!, { '--a2-sp': 0 }, { '--a2-sp': 1, duration: F(18), ease: travel, immediateRender: true, data: { role: 'ui' } }, tk + F(6));
  const stack3 = qa(h3, '.bt-stack > *');
  if (stack3[2]) riseIn(film, stack3[2], tk + fK - F(4), { y: 0, scale: 0.6 });
  glance(film, room.kai, tk + F(6), 2, -10);
  blink(film, h3KaiOrb, tk + 0.55);

  /* ═══ +4.5 (14.667) the presence leaves: its words go, its slot closes ═══ */
  const tl = tm.t(14.667);
  for (const e of qa(pres.p4, '.ui-presence__name, .ui-presence__words, .ui-presence__clock')) leaveOut(film, e, tl, { y: 4 });
  thread.open('pres', tl, DUR.d3, uiSpring, 0);
  vis(film, pres.box, (t) => t < tl + DUR.d3);
}
/* ═════════ B07 The fold (the moment) · 14.933 to 17.867 ═════════
   The camera comes back down to the composer; the cursor clicks into it and the line types (K2), "@nina" becoming a
   mention chip as the handle completes. +2 send: the line lifts into the thread as your request card (it leaves the
   composer as the card's own text, its card the composer's colour) and on the same frame the huddle folds, by the app's
   own rule: its messages become cards and file up under its head line like cards into a drawer, the card's height
   following them. The line sinks away; the camera pushes in (camera spring) until the head line is 44 px tall; the
   composer leaves the frame below. Then the shot holds, drifting. */
export async function b07(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B07')) return;
  const s = await a2state(ctx);
  const tm = tmap(ctx, 'B07');
  const { film, stage } = ctx;
  const { room, thread, lay } = s;
  const v = lay.v, X = lay.X;
  const hud = s.huddle!;
  film.mark('B07', tm.t(14.933));

  /* ── the camera comes back down to the composer (16:9; in 9:16 it never left); the huddle's foot sits above it ── */
  const back = tm.t(14.5);
  const camY = v ? 930 : 490;
  if (!v) ctx.cam.to({ y: camY }, { at: back, dur: F(34), ease: travel });
  /* while you type, the camera leans toward the composer */
  const leanAt = v ? tm.t(14.75) : back + F(34);
  /* 16:9 leans in a slow drift; 9:16 makes one decisive move down to the composer and lets the typing carry the shot (a
     slow even pan of a tall column of text reads as a blend) */
  if (v) ctx.cam.to({ y: 1150, x: 541 }, { at: leanAt, dur: F(30), ease: travel });
  else ctx.cam.drift({ zoom: 1.1, y: camY + 40, x: 960 - 40 }, { at: leanAt, dur: tm.t(16.0) - leanAt, ease: drift });
  if (!v) thread.pin('hud', back, { edge: 'bottom', world: room.at.comp.y - 16, dur: F(34), ease: travel });

  /* ── the cursor comes back, clicks into the field; the line types ── */
  const tip = room.at.cursor ? { x: room.at.cursor.x + room.at.cursor.w * 2 / 26, y: room.at.cursor.y + room.at.cursor.h * 2 / 32 } : { x: 0, y: 0 };
  const inB = room.at.input, sendB = room.at.send;
  const click = { x: inB.x + inB.w * (v ? 0.55 : 0.42), y: inB.y + inB.h * 0.42 };
  const tType = tm.t(14.933), tClick = tm.t(14.86);
  const cur = s.cursor;
  if (cur) {
    cur.move(click.x - tip.x, click.y - tip.y, tm.t(14.3), F(32), { arc: 0.12 });
    cur.press(tClick);
  }
  /* the typed line, laid out where the field's text starts (the field's own font), its chip the markdown's own */
  const comp = room.comp;
  const cbox = comp.querySelector<HTMLElement>('.ui-composer__box') ?? comp;
  const input = comp.querySelector<HTMLElement>('.ui-composer__input')!;
  const send = comp.querySelector<HTMLElement>('.ui-send')!;
  if (getComputedStyle(cbox).position === 'static') cbox.style.position = 'relative';
  const typed = h('div', 'a2-type', ui_.markdown.plain(T.next[0], mdCtx), { left: (input.offsetLeft + 14) + 'px', top: (input.offsetTop + 12) + 'px', font: getComputedStyle(input).font, color: getComputedStyle(input).color });
  cbox.appendChild(typed);
  sharpenOrbs(typed, X);
  swapOrbs(film, typed);
  const chip = typed.querySelector<HTMLElement>('.ui-mention')!;
  /* the rest of the line, character by character */
  const restNode = [...typed.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) as Text;
  const restChars: HTMLElement[] = [];
  if (restNode) {
    const frag = document.createDocumentFragment();
    for (const ch of restNode.textContent ?? '') { const sp = h('span', '', ch === ' ' ? '&nbsp;' : ch.replace(/&/g, '&amp;').replace(/</g, '&lt;')); frag.appendChild(sp); restChars.push(sp); }
    restNode.replaceWith(frag);
  }
  /* the handle as it is typed, before it becomes the chip */
  const handle = h('span', 'a2-type', '', { left: '0px', top: '0px' });
  const handleChars = [...'@nina'].map((ch) => { const sp = h('span', '', ch); handle.appendChild(sp); return sp; });
  typed.appendChild(handle);
  const cps = 30, fade = F(5);
  handleChars.forEach((c, i) => film.tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: fade, ease: arrive, data: { role: 'type', blur: false } }, tType + i / cps));
  const tChip = tType + 5 / cps + F(2);
  film.tl.fromTo(handle, { opacity: 1, x: 0 }, { opacity: 0, x: -3, duration: F(7), ease: ui, immediateRender: false, data: { role: 'ui' } }, tChip);
  film.tl.fromTo(chip, { opacity: 0, scale: 0.88 }, { opacity: 1, scale: 1, duration: DUR.d2, ease: ui, data: { role: 'ui' } }, tChip);
  restChars.forEach((c, i) => film.tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: fade, ease: arrive, data: { role: 'type', blur: false } }, tChip + F(4) + i / cps));
  const typedEnd = tChip + F(4) + restChars.length / cps + fade;
  const tSend = tm.t(16.0);
  vis(film, typed, within(tType, tSend));
  /* the field is empty from the send; its placeholder comes back once the card has left it */
  attrFrom(film, input, 'data-empty', room.s1, (t) => (t >= tType - 1e-9 && t < tSend + F(12) ? 'false' : 'true'));
  attrFrom(film, send, 'disabled', room.s1, (t) => (t >= tType - 1e-9 && t < tSend ? null : ''));
  /* the cursor goes to send and presses it on the beat */
  const sendC = { x: sendB.x + sendB.w * 0.5, y: sendB.y + sendB.h * 0.55 };
  if (cur) {
    cur.move(sendC.x - tip.x, sendC.y - tip.y, Math.min(typedEnd - F(6), tSend - F(4) - F(16)), F(15), { arc: -0.1 });
    cur.press(tSend - F(4));
    cur.move(sendC.x - tip.x + 140, sendC.y - tip.y + 260, tSend + F(10), F(30), { ease: depart, arc: 0.1 });
  }
  film.tl.fromTo(send, { scale: 1 }, { scale: 0.96, duration: DUR.press, ease: ui, immediateRender: false, data: { role: 'ui' } }, tSend - F(2));
  film.tl.fromTo(send, { scale: 0.96 }, { scale: 1, duration: DUR.press * 2, ease: ui, immediateRender: false, data: { role: 'ui' } }, tSend - F(2) + DUR.press);

  /* ═══ +2 (16.0) send: your request card lifts into the thread; the huddle folds; the camera pushes in ═══ */
  const req = entry(ctx, room, youEntry(T.next[0], T.next[1]), 0);
  const rbox = h('div', 'a2-req', '', { position: 'absolute', left: '0', top: '0' });
  room.scroller.appendChild(rbox);
  rbox.appendChild(req.el);
  const reqIt = thread.add('req2', rbox, req.h, { open: false });
  reqIt.y0 = 0;
  /* measured before any tween: the typed chip in the composer, the card's own chip */
  const typedChip = box(chip, stage), cardChip = box(req.el.querySelector('.ui-mention')!, stage);
  const pushZ = v ? 1.15 : 1.133;
  const pushX = v ? lay.L + (540 - 50) / pushZ : lay.L + (960 - 110) / pushZ;
  const pushY = v ? 470 : 263;
  const pushDur = F(44);
  ctx.cam.to({ x: pushX, y: pushY, zoom: pushZ }, { at: tSend, dur: pushDur, ease: travel });
  thread.open('req2', tSend, DUR.d3, uiSpring);
  thread.pin('hud', tSend, { screen: v ? 690 : 293, dur: pushDur, ease: travel });
  vis(film, req.el, within(tSend));
  const bubble = req.el.querySelector<HTMLElement>('.ui-request')!;
  /* the card lifts out of the composer above the room (the log sits under the composer): a stand-in of the card, the
     same markup on the same pixels, flies from the typed line to wherever the real card is on the frame it lands, then
     the real card takes over */
  const bubB = box(bubble, stage);
  const fly0 = { x: typedChip.x - (cardChip.x - bubB.x), y: typedChip.y - (cardChip.y - bubB.y) };
  const stand = h('div', 'ui-place a2-standin', '', { position: 'absolute', left: '0', top: '0', 'transform-origin': '0 0' });
  const standIn = h('div', 'ui-film', '', { '--ui-x': String(X), width: (bubB.w / X) + 'px' });
  standIn.appendChild(bubble.cloneNode(true));
  stand.appendChild(standIn);
  ctx.world.appendChild(stand);
  const liftDur = F(24), tLand = tSend + liftDur;
  const lift = { k: 0, __name: 'a2-lift' };
  film.tl.fromTo(lift, { k: 0 }, { k: 1, duration: liftDur, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, tSend);
  const landAt = thread.pointAt('req2', bubB.x, bubB.y, tLand);
  film.onRender((t) => {
    if (t < tSend - 1e-9 || t >= tLand) return;
    /* toward where the card will be when it lands, then onto where it is (the same pixels on the hand-over frame) */
    const [rx, ry] = thread.point('req2', bubB.x, bubB.y);
    const k = lift.k, k3 = k * k * k;
    stand.style.left = (fly0.x + (landAt[0] - fly0.x) * k + (rx - landAt[0]) * k3).toFixed(2) + 'px';
    stand.style.top = (fly0.y + (landAt[1] - fly0.y) * k + (ry - landAt[1]) * k3).toFixed(2) + 'px';
  }, -5);
  vis(film, stand, within(tSend, tLand));
  vis(film, bubble, (t) => t >= tLand - 1e-9);
  for (const e of req.el.querySelectorAll<HTMLElement>('.ui-callno > *')) riseIn(film, e, tSend + F(8));
  film.tl.fromTo(thread.band, { e: v ? 440 : 192 }, { e: v ? 640 : 236, duration: pushDur, ease: travel, immediateRender: false, data: { role: 'camera' } }, tSend);
  exit(film, s.lineB!, tSend, F(14));

  /* ── the fold: the head stays; the messages become cards and file up under it ── */
  const h3 = hud.h3;
  const body = h3.el.querySelector<HTMLElement>('.bt-huddle__body')!;
  const cards = [...body.querySelectorAll<HTMLElement>('.bt-hmsg')];
  const bodyB = box(body, stage);
  const cardB = cards.map((c) => box(c, stage));
  const ys = cardB.map((b) => b.y - bodyB.y), hs = cardB.map((b) => b.h);
  const H3 = h3.h, Hf = hud.Hf, full = ys[ys.length - 1]! + hs[hs.length - 1]!;
  const o = 9 * X, nC = cards.length;
  const k = { v: 0, __name: 'a2-fold' };
  const foldDur = F(30);
  /* a progress driver (each phase below is eased on travel): constant motion of a number, tagged as such */
  film.tl.fromTo(k, { v: 0 }, { v: 1, duration: foldDur, ease: linear, immediateRender: false, data: { role: 'ui', linear: true } }, tSend);
  const pad = { x: 14 * X, y: 10 * X };
  const backs = cards.map((c) => {
    c.style.isolation = 'isolate';
    c.classList.add('a2-spine');
    const b = h('div', 'a2-card', '', { position: 'absolute', left: -pad.x / X + 'px', right: -pad.x / X + 'px', top: -pad.y / X + 'px', bottom: -pad.y / X + 'px', 'z-index': '-1', 'border-radius': '12px', 'background-color': 'transparent' });
    c.prepend(b);
    return b;
  });
  const lip = h('div', 'a2-lip', '', { position: 'absolute', left: (-pad.x / X - 8) + 'px', right: (-pad.x / X - 8) + 'px', top: '0px', height: '26px', 'z-index': '5', background: 'linear-gradient(rgba(0,0,0,.42), rgba(0,0,0,0))', opacity: '0', 'pointer-events': 'none' });
  body.style.position = 'relative';
  body.prepend(lip);
  const sm = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : travel(x));
  film.onRender((t) => {
    if (t < tSend - 1e-9) {
      for (const c of cards) if (c.style.translate) c.style.translate = '';
      if (body.style.clipPath) body.style.clipPath = '';
      return;
    }
    const kv = k.v, p1 = sm(kv / 0.62), p2 = sm((kv - 0.34) / 0.66);
    let bottom = 0;
    cards.forEach((c, i) => {
      const P1 = (i - (nC - 1)) * o, P2 = -(hs[i]! + nC * o + 12 * X);
      const top = ys[i]! + (P1 - ys[i]!) * p1 + (P2 - P1) * p2;
      const sc = 1 - 0.018 * (nC - 1 - i) * p1;
      c.style.translate = '0px ' + ((top - ys[i]!) / X).toFixed(3) + 'px';
      c.style.scale = sc.toFixed(4);
      c.style.setProperty('--a2-sp', String(1 - p1));
      bottom = Math.max(bottom, top + hs[i]!);
    });
    body.style.clipPath = 'inset(0px -80px -80px -80px)';
    /* the card's height follows its lowest card (the request card below moves up with it) */
    const it = thread.item('hud');
    it.h.v = Hf + (H3 - Hf) * Math.max(0, Math.min(1, bottom / full));
  }, -8);
  backs.forEach((b) => film.tl.fromTo(b, { backgroundColor: 'rgba(35, 33, 30, 0)', boxShadow: '0 0px 0px rgba(0,0,0,0)' }, { backgroundColor: 'rgb(35, 33, 30)', boxShadow: '0 10px 28px rgba(0,0,0,.38)', duration: F(10), ease: ui, immediateRender: false, data: { role: 'ui' } }, tSend));
  film.tl.fromTo(lip, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: F(8), ease: ui, immediateRender: false, data: { role: 'ui' } }, tSend + F(2));
  film.tl.fromTo(lip, { opacity: 1, y: 0 }, { opacity: 0, y: -6, duration: F(10), ease: ui, immediateRender: false, data: { role: 'ui' } }, tSend + foldDur - F(4));
  const chev = h3.el.querySelector<HTMLElement>('.ui-disclosure .ui-icon');
  if (chev) film.tl.fromTo(chev, { rotation: 90 }, { rotation: 0, duration: DUR.d2, ease: ui, immediateRender: false, data: { role: 'ui' } }, tSend);
  /* the orbs that just spoke look at your request as it lands */
  glance(film, room.kai, tSend + F(6), 4, -16);

  /* a cut-down that ends the act here pushes on into nina's orb in the folded stack: it is hers to take */
  if (!ctx.has('B08')) {
    const so = [...h3.orbs.values()].find((o) => o.name.startsWith('nina') && !!o.holder.closest('.bt-stack'));
    if (so) { const m = new Map(ctx.carry.orbs ?? []); m.set('nina', so); ctx.carry.orbs = m; }
  }

  /* ── the hold breathes ── */
  const holdAt = tSend + pushDur;
  ctx.cam.drift(v ? { x: pushX + 22, y: pushY - 60, zoom: pushZ * 1.05 } : { x: pushX + 34, y: pushY - 20, zoom: pushZ * 1.065 }, { at: holdAt, dur: tm.t(17.867) - holdAt, ease: drift });
}
export { b08 } from './window';
