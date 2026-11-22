/* B08 To your own session · 17.867 to 20.000.
   +0 to +1 the camera pulls back (travel 32 f) from the folded line to the whole boopis window: the room is the window's
   own main area (its plate grows into it, its words become bars as they pass the size anyone could read), and the
   window's chrome, its plate, shadow and top light arrive with the scale. The room settles from its film scale (3x) into
   the window's (2.6x, the session's), so the composer lands where the session's will be.
   +1 to +2.5 the cursor arcs to the tabs pill and clicks Session: the thumb slides (--dur-slide), the room's log slides
   48 px out to the left behind its edge, the sidebar's list changes, and the composer stays where it is and morphs
   (T1, --dur-3): the member chips fold away, the attach button and the Governed chip arrive, its ends travel in.
   +3 to +4 the camera pushes into the composer (travel 32 f) and lands at rest on B09's composition, the window giving
   way to the session's plate on the ground; the composer's bars become words again. Its element crosses S2. */
import type { ActCtx } from '../context';
import { SEAMS } from '../seams';
import { appWindow, sessionComposer } from '../../../look/src/scenes/parts';
import { filmUI, h } from '../../../look/src/stage';
import { swapOrbs } from '../../engine/look';
import { a2state } from './state';
import { runsOf, bars } from './bars';
import { kfCursor } from './cursor';
import { DUR, S2, arrive, box, depart, riseIn, styleFrom, tmap, travel, ui, vis, visFrom, within, drift } from './util';

const F = (n: number): number => n / 60;
type R = [number, number, number, number];

export async function b08(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B08')) return;
  const s = await a2state(ctx);
  const tm = tmap(ctx, 'B08');
  const { film, stage, cam } = ctx;
  const { room, thread, lay } = s;
  const v = lay.v;
  const t8 = tm.t(17.867), tPull = F(32), tWin = t8 + tPull;
  const tClick = tm.t(18.933), tPush = tm.t(19.33), tEnd = tm.t(20.0);
  film.mark('B08', t8);

  /* ── the window's world: B09's composition at world (0, 0), the session at 2.6x (seams.ts S2) ── */
  const seam = SEAMS.find((x) => x.id === 'S2')!;
  const side = v ? seam.vertical : seam.landscape;
  const sessR = side.carries.find((c) => c.handle === 'composer.el')!.rect as R;
  const plateR: R = v ? [-40, 520, 1160, 1500] : [40, -80, 1260, 1240];
  const comp0 = room.at.comp;                        /* the room composer in room px at S1 */
  const sig = 2.6 / lay.X;
  const mainCx = v ? comp0.x + comp0.w / 2 : sessR[0] + sessR[2] / 2;
  const map = { s: sig, tx: mainCx - sig * (comp0.x + comp0.w / 2), ty: sessR[1] + sessR[3] - sig * (comp0.y + comp0.h) };
  const k = 2.6, winW = 1280 * k;
  const kfWin = v ? { x: 24, y: 300, w: 1900, h: 1360 } : { x: 135, y: 76, w: 1650, h: 928 };
  const S8 = winW / kfWin.w, winH = kfWin.h * S8;
  const mainW = winW - 256 * k, mainH = winH - 40 * k;
  const mainX = mainCx - mainW / 2, winX = mainX - 256 * k;
  const mainB = sessR[1] + sessR[3] + 84 * k, mainY = mainB - mainH, winY = mainY - 40 * k;
  const mainR: R = [mainX, mainY, mainW, mainH];
  const W = film.width, H = film.height;
  const zWin = kfWin.w / winW;
  const camWin = { x: winX + (W / 2 - kfWin.x) / zWin, y: winY + (H / 2 - kfWin.y) / zWin, zoom: zWin };

  /* ── the camera: pull back, breathe toward the pill, push into the composer and come to rest on the seam ── */
  cam.to(camWin, { at: t8, dur: tPull, ease: travel });
  cam.drift({ x: camWin.x - 54 / zWin, y: camWin.y - 16 / zWin, zoom: zWin * 1.06 }, { at: tWin, dur: tPush - tWin, ease: drift });
  cam.to({ x: W / 2, y: H / 2, zoom: 1 }, { at: tPush, dur: tEnd - tPush, ease: travel });

  /* ── the room settles into the window: its own map from film scale to the window's, on the camera's curve ── */
  const pull = { k: 0, __name: 'a2-pull' }, push = { k: 0, __name: 'a2-push' };
  film.tl.fromTo(pull, { k: 0 }, { k: 1, duration: tPull, ease: travel, immediateRender: false, data: { role: 'camera' } }, t8);
  film.tl.fromTo(push, { k: 0 }, { k: 1, duration: tEnd - tPush, ease: travel, immediateRender: false, data: { role: 'camera' } }, tPush);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  film.onRender((t) => {
    const p = t < t8 ? 0 : pull.k;
    thread.map.s = lerp(1, map.s, p); thread.map.tx = lerp(0, map.tx, p); thread.map.ty = lerp(0, map.ty, p);
    const m = thread.map;
    const tr = m.s === 1 && m.tx === 0 && m.ty === 0 ? '' : 'translate(' + m.tx.toFixed(3) + 'px,' + m.ty.toFixed(3) + 'px) scale(' + m.s.toFixed(6) + ')';
    if (room.wrap.style.transform !== tr) { room.wrap.style.transform = tr; room.wrap.style.transformOrigin = '0 0'; }
  }, -9);
  /* the log's top edge leaves the line's band for the window's main area (world px) */
  film.tl.fromTo(thread.bandMix, { k: 0, wy: mainY }, { k: 1, wy: mainY, duration: tPull, ease: travel, immediateRender: false, data: { role: 'camera' } }, t8);

  /* ── the window: the art director's B08 key frame, its window behind the room, its dock and cursor in front ── */
  const kf = await ctx.keyFrame('b08', { x: Math.round(winX - kfWin.x * S8), y: Math.round(winY - kfWin.y * S8) });
  const kfX = winX - kfWin.x * S8, kfY = winY - kfWin.y * S8;
  kf.style.left = kfX.toFixed(2) + 'px'; kf.style.top = kfY.toFixed(2) + 'px';
  kf.style.transformOrigin = '0 0'; kf.style.transform = 'scale(' + S8.toFixed(6) + ')';
  kf.style.overflow = 'visible';
  const top = (e: Element): Element => { let x: Element = e; while (x.parentElement && x.parentElement !== ctx.world) x = x.parentElement; return x; };
  const roomTop = top(room.wrap);
  ctx.world.insertBefore(kf, roomTop);
  const upTo = (t: number): boolean => t <= s.end + 1e-9;
  vis(film, kf, within(t8)); vis(film, kf, upTo);
  const win = kf.querySelector<HTMLElement>('.win')!;
  const winMain = win.querySelector<HTMLElement>('.win__main')!;
  for (const c of [...winMain.children]) (c as HTMLElement).style.visibility = 'hidden';
  /* the dock and the cursor stand in front of the room: a box with the key frame's own place and scale */
  const front = h('div', 'a2-front8', '', { position: 'absolute', left: kfX.toFixed(2) + 'px', top: kfY.toFixed(2) + 'px', width: kf.offsetWidth + 'px', height: kf.offsetHeight + 'px', 'transform-origin': '0 0', transform: 'scale(' + S8.toFixed(6) + ')', 'pointer-events': 'none' });
  const after = h('div', 'a2-after', '', { position: 'absolute', left: '0', top: '0' });
  roomTop.after(after);
  after.appendChild(front);
  const kfB = kf.getBoundingClientRect(), kk = stage.root.getBoundingClientRect().width / stage.width;
  const inKf = (e: Element): { x: number; y: number; w: number; h: number } => { const r = e.getBoundingClientRect(); return { x: (r.left - kfB.left) / kk / S8, y: (r.top - kfB.top) / kk / S8, w: r.width / kk / S8, h: r.height / kk / S8 }; };
  const dock = win.querySelector<HTMLElement>('.dock')!;
  const dockB = inKf(dock);
  front.appendChild(dock);
  Object.assign(dock.style, { left: dockB.x + 'px', top: dockB.y + 'px', bottom: 'auto', width: dockB.w + 'px', height: dockB.h + 'px' });
  const cur8 = kf.querySelector<HTMLElement>('.cursor');
  if (cur8) front.appendChild(cur8);
  vis(film, front, within(t8)); vis(film, after, upTo);

  /* ── the plate: one plate of ours in the world from here (the room's own stands down on the same pixels) ── */
  const plate = h('div', 'plate plate--room a2-plate8', '', { position: 'absolute' });
  ctx.world.insertBefore(plate, roomTop);
  const rp = room.plate;
  const pr0 = rp ? { x: rp.offsetLeft, y: rp.offsetTop, w: rp.offsetWidth, h: rp.offsetHeight } : { x: 40, y: -80, w: 1840, h: 1240 };
  const grow = v ? 0 : 1600;
  const roomRect: R = [pr0.x, pr0.y - grow, pr0.w, pr0.h + grow * 2];
  const light: R = [pr0.x, pr0.y, pr0.w, pr0.h];
  if (rp) visFrom(film, rp, room.s1, (t) => t < t8);
  vis(film, plate, within(t8)); vis(film, plate, upTo);
  const winRad = 30 * S8, mainTL = 14 * k;
  film.onRender((t) => {
    if (t < t8) return;
    const m = thread.map, p = pull.k, q = push.k;
    const mr = (r: R): R => [m.tx + m.s * r[0], m.ty + m.s * r[1], m.s * r[2], m.s * r[3]];
    const a = mr(roomRect), L = mr(light);
    let r: R = [lerp(a[0], mainR[0], p), lerp(a[1], mainR[1], p), lerp(a[2], mainR[2], p), lerp(a[3], mainR[3], p)];
    r = [lerp(r[0], plateR[0], q), lerp(r[1], plateR[1], q), lerp(r[2], plateR[2], q), lerp(r[3], plateR[3], q)];
    const rad = (from: number, mid: number, to: number): string => lerp(lerp(from, mid, p), to, q).toFixed(2) + 'px';
    Object.assign(plate.style, {
      left: r[0].toFixed(2) + 'px', top: r[1].toFixed(2) + 'px', width: r[2].toFixed(2) + 'px', height: r[3].toFixed(2) + 'px',
      borderRadius: rad(30, mainTL, 30) + ' ' + rad(30, 0, 30) + ' ' + rad(30, winRad, 30) + ' ' + rad(30, 0, 30),
      /* the room's light rides with the room, then becomes the session plate's own */
      backgroundSize: lerp(L[2], r[2], q).toFixed(2) + 'px ' + lerp(L[3], r[3], q).toFixed(2) + 'px',
      backgroundPosition: lerp(L[0] - r[0], 0, q).toFixed(2) + 'px ' + lerp(L[1] - r[1], 0, q).toFixed(2) + 'px',
      backgroundRepeat: 'no-repeat', backgroundColor: 'var(--bg-2)',
      boxShadow: 'inset 0 1px 0 var(--plate-edge), 0 36px 90px rgba(0,0,0,' + (0.46 * Math.max(1 - p, q)).toFixed(3) + '), 0 3px 9px rgba(0,0,0,' + (0.4 * Math.max(1 - p, q)).toFixed(3) + ')'
    });
  }, -7);
  /* the window gives way to the session's plate on the ground as the camera pushes in: its right edge comes in with the
     plate's, the dock slides away below */
  const winRight = winX + winW, cut = (winRight - (plateR[0] + plateR[2])) / S8;
  film.tl.fromTo(win, { clipPath: 'inset(0px 0px 0px 0px round ' + 30 + 'px)' }, { clipPath: 'inset(0px ' + cut.toFixed(1) + 'px 0px 0px round 30px)', duration: tEnd - tPush, ease: travel, immediateRender: false, data: { role: 'camera' } }, tPush);
  const dockDrop = Math.max(60, (H + 40 - (kfY + dockB.y * S8)) / S8);
  film.tl.fromTo(dock, { y: 0 }, { y: dockDrop, duration: (tEnd - tPush) * 0.8, ease: depart, immediateRender: false, data: { role: 'ui' } }, tPush);

  /* ── the words become bars as the camera passes the size anyone can read ── */
  const hud = s.huddle!;
  const toneOf = (e: HTMLElement): 'q' | 's' | '' => (e.closest('.ui-callno__who, .bt-who-name, .bt-hmsg__name') ? 's' : e.closest('.ui-callno, .bt-hmsg__head') ? 'q' : '');
  const roots = [room.head, room.thread, s.kaiReply?.el, hud.h3.el, room.scroller.querySelector<HTMLElement>('.a2-req'), room.composer].filter((e): e is HTMLElement => !!e);
  const runs = roots.flatMap((r) => runsOf(stage, r, { skip: '.ui-presence .ui-entry__body, .bt-huddle__body, .a2-type, .a2-bar', tone: toneOf, placeholder: true }));
  bars(film, runs, 'text').to('bar', t8 + F(1), { dur: F(7), stagger: F(3) / Math.max(1, runs.length) });

  /* ── the cursor (the key frame's own) arcs in to the tabs pill and clicks Session on 10.1 ── */
  const tabs = win.querySelector<HTMLElement>('.tabs')!;
  const spans = [...tabs.querySelectorAll<HTMLElement>(':scope > span')];
  const sessTab = spans[0]!, botsTab = spans[1]!;
  if (cur8) {
    const c = kfCursor(film, cur8, t8, { x: 1500, y: 1000 });
    c.move(v ? -180 : -24, v ? -12 : -10, tWin - F(2), tClick - F(4) - (tWin - F(2)), { arc: 0.16 });
    c.press(tClick - F(4));
    c.move(v ? 120 : 90, 90, tClick + F(12), F(30), { arc: 0.1 });
  }
  /* the thumb slides from Bots to Session (--dur-slide on --ease) */
  const sb = inKf(sessTab), bb = inKf(botsTab), tb = inKf(tabs);
  const thumb = h('span', 'a2-thumb', '', { position: 'absolute', left: (bb.x - tb.x) + 'px', top: (bb.y - tb.y) + 'px', width: bb.w + 'px', height: bb.h + 'px', 'border-radius': getComputedStyle(botsTab).borderRadius, background: 'var(--selected)', 'z-index': '0' });
  tabs.style.position = 'absolute';
  tabs.prepend(thumb);
  for (const sp of spans) { sp.style.position = 'relative'; sp.style.zIndex = '1'; sp.style.background = 'transparent'; }
  film.tl.fromTo(thumb, { x: 0 }, { x: sb.x - bb.x, duration: DUR.slide, ease: ui, immediateRender: false, data: { role: 'ui' } }, tClick);
  const barOf = (sp: HTMLElement): HTMLElement => sp.querySelector<HTMLElement>('i')!;
  film.tl.fromTo(barOf(sessTab), { backgroundColor: 'var(--text-dim)', opacity: 1 }, { backgroundColor: 'var(--text-on-light)', opacity: 0.7, duration: DUR.slide * 0.6, ease: ui, immediateRender: false, data: { role: 'ui' } }, tClick + DUR.slide * 0.3);
  film.tl.fromTo(barOf(botsTab), { backgroundColor: 'var(--text-on-light)', opacity: 0.7 }, { backgroundColor: 'var(--text-dim)', opacity: 1, duration: DUR.slide * 0.6, ease: ui, immediateRender: false, data: { role: 'ui' } }, tClick + DUR.slide * 0.1);

  /* ── the sidebar's list becomes the session's (the art director's window, Session tab) ── */
  const winSess = appWindow({ x: 0, y: 0, w: kfWin.w, h: kfWin.h, tab: 'session', main: () => undefined, dock: false });
  const sideA = win.querySelector<HTMLElement>('.win__side')!, sideB = winSess.querySelector<HTMLElement>('.win__side')!;
  const listA = [...sideA.children].slice(2, -1) as HTMLElement[], listB = [...sideB.children].slice(2, -1) as HTMLElement[];
  for (const e of listB) sideA.appendChild(e);
  const tSw = tClick + F(2);
  listA.forEach((e, i) => {
    film.tl.fromTo(e, { x: 0, clipPath: 'inset(-20% 0% -20% -20%)' }, { x: -24, clipPath: 'inset(-20% 100% -20% -20%)', duration: DUR.d3 * 0.8, ease: ui, immediateRender: false, data: { role: 'ui' } }, tSw + i * F(2));
  });
  listB.forEach((e, i) => {
    film.tl.fromTo(e, { x: 24, clipPath: 'inset(-20% 100% -20% -20%)' }, { x: 0, clipPath: 'inset(-20% 0% -20% -20%)', duration: DUR.d3, ease: ui, immediateRender: true, data: { role: 'ui' } }, tSw + F(5) + i * F(2));
  });

  /* ── the room's log slides 48 px out to the left behind its edge; the session's thread is empty ── */
  const slide = 48 * lay.X;
  film.tl.fromTo(room.scroller, { x: 0, clipPath: 'inset(-50% 0% -50% -50%)' }, { x: -slide, clipPath: 'inset(-50% 100% -50% -50%)', duration: DUR.d3, ease: ui, immediateRender: false, data: { role: 'ui' } }, tSw);
  vis(film, room.scroller, (t) => t < tSw + DUR.d3);

  /* ── the composer stays where it is and morphs into the session's (T1, --dur-3) ── */
  const sess = filmUI(sessionComposer(), { x: sessR[0], y: sessR[1], width: sessR[2] / 2.6, scale: 2.6 });
  after.appendChild(sess.outer);
  swapOrbs(film, sess.outer);
  const sComp = sess.outer.querySelector<HTMLElement>('.ui-composer')!;
  const sBox = sComp.querySelector<HTMLElement>('.ui-composer__box')!;
  const shell = filmUI('<div class="ui-composer"><div class="ui-composer__box" style="height:' + (sBox.offsetHeight) + 'px"></div></div>', { x: 0, y: sessR[1], width: sessR[2] / 2.6, scale: 2.6 });
  /* the surface goes behind the room composer's own words and actions (they ride on it while it narrows) */
  ctx.world.insertBefore(shell.outer, roomTop);
  /* the room composer's own ends, mapped into the window (where they are when the morph starts) */
  const rBox = room.comp.querySelector<HTMLElement>('.ui-composer__box')!;
  const roomL = map.tx + map.s * comp0.x, roomW = map.s * comp0.w;
  const tM = tClick + F(3), dM = DUR.d3 + F(6);
  const mk = { k: 0, __name: 'a2-morph' };
  film.tl.fromTo(mk, { k: 0 }, { k: 1, duration: dM, ease: ui, immediateRender: false, data: { role: 'ui' } }, tM);
  film.onRender(() => {
    const L = lerp(roomL, sessR[0], mk.k), Wd = lerp(roomW, sessR[2], mk.k);
    shell.outer.style.left = L.toFixed(2) + 'px';
    (shell.inner as HTMLElement).style.width = (Wd / 2.6).toFixed(3) + 'px';
  });
  const tDone = tM + dM;
  vis(film, shell.outer, within(tM, tDone));
  styleFrom(film, rBox, 'background', tM, () => 'transparent');
  styleFrom(film, rBox, 'box-shadow', tM, () => 'none');
  visFrom(film, room.composer, room.s1, (t) => t < tDone);
  /* the session composer: drawn from the morph's start; its surface, words and actions take over at the end */
  vis(film, sess.outer, within(tM));
  /* the composer itself too: act 3 may hide it from S2 with a set whose revert writes 'visible' before it */
  vis(film, sComp, within(tM)); vis(film, sComp, upTo);
  const sInput = sComp.querySelector<HTMLElement>('.ui-composer__input')!;
  const sActs = sComp.querySelector<HTMLElement>('.ui-composer__acts')!;
  const sBar = sComp.querySelector<HTMLElement>('.ui-composer__bar')!;
  const sChips = [...sBar.children].filter((c) => !c.matches('.ui-composer__spacer, .ui-composer__acts')).flatMap((c) => (c.matches('.ui-composer__chips') ? [...c.children] : [c])) as HTMLElement[];
  film.onRender((t) => {
    const done = t >= tDone - 1e-9;
    sBox.style.background = done ? '' : 'transparent';
    sBox.style.boxShadow = done ? '' : 'none';
    sInput.style.visibility = done ? '' : 'hidden';
    sActs.style.visibility = done ? '' : 'hidden';
  });
  /* the room's chips fold away right to left; its field's words and its actions travel with the shell's ends */
  const dl = (sessR[0] - roomL) / map.s / lay.X, dr = (sessR[0] + sessR[2] - roomL - roomW) / map.s / lay.X;
  const dlBar = dl * lay.X;
  const rChips = [...room.comp.querySelectorAll<HTMLElement>('.ui-composer__chips > *')];
  const rChipBars = rChips.flatMap((c) => runs.filter((r) => c.contains(r.el)).flatMap((r) => r.bars));
  /* left to right, each riding the shell's left edge as it comes in */
  rChipBars.forEach((b, i) => film.tl.fromTo(b, { scaleX: 1, x: 0 }, { scaleX: 0, x: dlBar * 0.5, transformOrigin: '0% 50%', duration: F(9), ease: ui, immediateRender: false, data: { role: 'ui' } }, tM + i * F(1.5)));
  const rActs = room.comp.querySelector<HTMLElement>('.ui-composer__acts');
  if (rActs) film.tl.fromTo(rActs, { x: 0 }, { x: dr, duration: dM, ease: ui, immediateRender: false, data: { role: 'ui' } }, tM);
  const rInput = room.comp.querySelector<HTMLElement>('.ui-composer__input')!;
  const rPh = runs.filter((r) => r.el === rInput).flatMap((r) => r.bars);
  const sRuns = runsOf(stage, sess.outer, { skip: '.a2-bar', tone: toneOf, placeholder: true });
  const sPh = sRuns.filter((r) => r.el === sInput).flatMap((r) => r.bars)[0];
  for (const b of rPh) {
    const wTo = sPh ? sPh.offsetWidth / map.s : b.offsetWidth;
    film.tl.fromTo(b, { x: 0, width: b.offsetWidth }, { x: dl * lay.X, width: wTo, duration: dM, ease: ui, immediateRender: false, data: { role: 'ui' } }, tM);
  }
  sChips.forEach((c, i) => riseIn(film, c, tM + dM * 0.45 + i * F(3), { y: 0, scale: 0.6, dur: DUR.d2 }));
  for (const r of sRuns) {
    const chip = sChips.find((c) => c.contains(r.el));
    if (chip) r.bars.forEach((b) => riseIn(film, b, tM + dM * 0.45 + sChips.indexOf(chip) * F(3) + F(2), { y: 0, scale: 0.6, dur: DUR.d2 }));
  }
  /* the session composer's own words are bars until the push brings them back past the size anyone can read; its
     field's bar is the room's, travelled, until the morph is done */
  const phRun = sRuns.find((r) => r.el === sInput);
  const sb2 = bars(film, sRuns, 'bar', { hiddenBefore: new Map(phRun ? [[phRun, tDone]] : []) });
  sb2.to('text', tPush + (tEnd - tPush) * 0.62, { dur: F(9), stagger: F(1) });

  /* the hand-off at S2: the composer is ours, and the plate it sits on */
  s.out = { el: sComp, session: plate };
  void S2; void arrive; void box;
}
