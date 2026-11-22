/* B11 to B13: the breath, the terminal, the open room.

   B11  The film's one slow move, 4 beats, no cut: a spline through the whole window at 13.2 (the cursor clicks Bots in
        the tabs pill there: the thumb slides, the session gives way to the room, the right panel slides away under the
        window's edge) and on past the window's edges to the desk: the terminal behind on the left, the nameless app in
        front at the lower right. As the camera leaves them, the session's words squeeze into the look's bars, each a few
        frames before it would fall under 28 px. The lamp cools and opens wide; the ground moves at the look's depth.
   B12  The camera eases onto the terminal on the camera spring; the window slides back and out of focus; the terminal,
        clear of it, comes in front. The prompt shows, the command types with a person's rhythm, the caret rests, and
        Enter lands on 15.1, the drop.
   B13  On the drop the frame snaps wide (16 f, motion blur): the terminal settles on its seam rect and the window comes
        forward until its main area is the open room at 2.6x beside it, its frame and sidebar masked away to that plate;
        the room scrolls its old thread up and away. Each block prints on its half-beat and lands in the room on the same
        frame; vox's reply and kai's gather into the live huddle; done; the prompt returns; a last drift lands the act
        camera at rest on 32.000 (SEAMS S3). */
import type { ActCtx } from '../context';
import { boxOf } from '../../motion/carry';
import { arrive, depart, snap, travel, ui, uiSpring } from '../../motion/ease';
import { springDuration, springEase } from '../../motion/spring';
import { at } from '../../motion/beats';
import { h } from '../../../look/src/stage';
import { cursor as lookCursor } from '../../../look/src/scenes/parts';
import { CMD, type Stage3 } from './build';
import { X } from './layout';
import { REST, declareMotion, viewFor, type Rect, type Track, type View } from './rig';
import { sessionBars, type Prep } from './session';
import { charSpans, lineIn, lineOut, rhythm, typeChars } from './text';

export interface DeskPrep {
  bots: [number, number]; seg: [number, number, number];
  thumbDx: number;
  oldBottom: number;
  roomY: number;
  entries: HTMLElement[]; huddle: HTMLElement;
  vox: { orb: HTMLElement; text: HTMLElement; call: HTMLElement; entry: HTMLElement };
  hv: { orb: HTMLElement; text: HTMLElement; head: HTMLElement; d: { orb: [number, number]; text: [number, number] } };
  kaiMsg: HTMLElement; hCall: HTMLElement[]; hHead: HTMLElement;
  cmdChars: HTMLElement[]; caret: HTMLElement;
}

type Drift = Track<{ z: number; dx: number; dy: number }>;

export function prepDesk(ctx: ActCtx, S: Stage3): DeskPrep {
  const wb = (el: Element): [number, number, number, number] => { const b = boxOf(el, ctx.stage); return [b.x, b.y, b.w, b.h]; };
  /* the tabs pill: the Bots segment's centre (window-local px: the window is at identity while it builds) */
  const segs = [...S.tabs.querySelectorAll<HTMLElement>(':scope > span')];
  const sb = wb(segs[1]!);
  const thumbDx = segs[1]!.offsetLeft - segs[0]!.offsetLeft;
  /* the open room: where its old thread ends, where the run's entries go (scroll coordinates, the viewport's px) */
  const vp = wb(S.viewport);
  const rows = [...S.oldRoom.querySelectorAll<HTMLElement>(':scope > div > div')];
  const oldBottom = Math.max(...rows.map((r) => { const b = wb(r); return b[1] + b[3] - vp[1]; }));
  const target = S.L.b13.room[1] - S.L.mainBots[1];
  const gap = 140;
  const roomY = target + oldBottom + gap;
  S.room.style.top = roomY + 'px';
  /* the room's entries and the huddle; vox's own entry sits exactly where the huddle will be */
  const roomLog = S.room.querySelector<HTMLElement>('.room-log')!;
  const entries = [...roomLog.children] as HTMLElement[];
  const huddle = roomLog.querySelector<HTMLElement>('.bt-huddle-entry')!;
  const hb = wb(huddle), rb = wb(S.room);
  S.voxEntry.style.top = (roomY + hb[1] - rb[1]) + 'px';
  const ve = S.voxEntry.querySelector<HTMLElement>('.ui-entry')!;
  const vox = {
    entry: ve,
    orb: ve.querySelector<HTMLElement>('.film-orb-holder')!,
    text: ve.querySelector<HTMLElement>('.ui-entry__body')!,
    call: ve.querySelector<HTMLElement>('.ui-callno')!
  };
  const msgs = [...huddle.querySelectorAll<HTMLElement>('.bt-hmsg')];
  const vm = msgs[0]!, km = msgs[1]!;
  const vmHead = vm.querySelector<HTMLElement>('.bt-hmsg__head')!;
  const hv = {
    orb: vmHead.querySelector<HTMLElement>('.film-orb-holder')!,
    text: vm.querySelector<HTMLElement>(':scope > :not(header)')!,
    head: vmHead,
    d: { orb: [0, 0] as [number, number], text: [0, 0] as [number, number] }
  };
  const oA = wb(vox.orb), oB = wb(hv.orb);
  /* (transforms inside the kit's zoom box are in the product's px) */
  hv.d.orb = [(oA[0] - oB[0]) / X, (oA[1] - oB[1]) / X];
  /* the reply's text: from its line in vox's entry to its line in the huddle (first lines aligned) */
  const firstLine = (el: HTMLElement): [number, number] => { const r = document.createRange(); r.selectNodeContents(el); const q = r.getClientRects()[0]; const k = ctx.stage.root.getBoundingClientRect().width / ctx.stage.width; return q ? [q.left / k, q.top / k] : [0, 0]; };
  const fa = firstLine(vox.text), fb = firstLine(hv.text);
  hv.d.text = [(fa[0] - fb[0]) / X, (fa[1] - fb[1]) / X];
  const hCallEl = huddle.querySelector<HTMLElement>('.ui-callno')!;
  const hCall = [...hCallEl.children] as HTMLElement[];
  const hHead = huddle.querySelector<HTMLElement>('.ui-entry__body > .ui-disclosure')!;
  /* the terminal's command line: the characters to type, a caret after them */
  const cmd = S.termLines[0]!.querySelector<HTMLElement>('.a3-cmd')!;
  const cmdChars = S.v ? wrapCommand(cmd) : charSpans(cmd, CMD);
  const caret = h('span', 'a3-caret');
  cmd.after(caret);
  return { bots: [sb[0] + sb[2] / 2, sb[1] + sb[3] / 2], seg: sb.slice(0, 3) as [number, number, number], thumbDx, oldBottom, roomY, entries, huddle, vox, hv, kaiMsg: km, hCall, hHead, cmdChars, caret };
}

/* 9:16: the command breaks after "release" and continues indented, as the key frame sets it */
function wrapCommand(cmd: HTMLElement): HTMLElement[] {
  const i = CMD.indexOf(' "');
  const a = charSpans(cmd, CMD.slice(0, i));
  const br = document.createElement('span');
  br.textContent = '\n  ';
  br.className = 'a3-brk';
  cmd.appendChild(br);
  const holder = document.createElement('span');
  cmd.appendChild(holder);
  const b = charSpans(holder, CMD.slice(i + 1));
  return [...a, br, ...b];
}

/** the view that puts local rect L on screen rect S at time t, under the act camera's drift then */
function viewAt(ctx: ActCtx, drift: Drift, t: number, L: Rect, S: [number, number, number]): View {
  const d = drift.valueAt(t), C = [ctx.film.width / 2, ctx.film.height / 2] as const;
  const x = C[0] + (S[0] - C[0] - d.dx) / d.z, y = C[1] + (S[1] - C[1] - d.dy) / d.z;
  return viewFor(ctx.film, L, [x, y, S[2] / d.z]);
}

/* ═════════════ B11: the breath ═════════════ */
export function b11(ctx: ActCtx, S: Stage3, P: Prep, D: DeskPrep): void {
  const film = ctx.film, L = S.L, w = ctx.win('B11'), f = (n: number): number => n / film.fps;
  film.mark('B11', w.start);
  const t0 = w.start, tm = at('13.2'), t1 = w.end;   /* 25.6, 26.133, 27.733 */
  const R = S.rig, drift = R.drift;
  drift.to(t0, t1, { z: 1, dx: 0, dy: 0 }, travel);

  /* the window: one move through the whole window (at the click) to the desk */
  const mid = viewAt(ctx, drift, tm, L.win, L.b11.mid), end = viewAt(ctx, drift, t1, L.win, L.b11.win);
  S.gw.view.through(t0, tm, t1, mid, end);
  /* its frame opens out of the session plate (the clip travels to the window's edges), then the clip lets go */
  const winW = L.win[2], winH = L.win[3];
  const ins = (top: number, right: number, bottom: number, left: number): string => 'inset(' + top + 'px ' + right + 'px ' + bottom + 'px ' + left + 'px round 30px)';
  const restClip = ins(L.main[1] - L.win[1], winW - (L.main[0] + L.main[2] - L.win[0]), Math.max(0, L.win[1] + winH - (L.main[1] + L.main[3])), L.main[0] - L.win[0]);
  S.win.style.clipPath = restClip;
  film.tl.fromTo(S.win, { clipPath: restClip }, { clipPath: ins(0, 0, 0, 0), duration: f(26), ease: travel, immediateRender: false, data: { role: 'reveal' } }, t0 + f(2));
  film.tl.set(S.win, { immediateRender: false, clipPath: 'none' }, t0 + f(28));

  /* the session's words become bars as the window leaves them behind */
  sessionBars(ctx, P, (t) => S.gw.scale(t, drift), t0 - f(4), tm + 0.3);

  /* the cursor comes in from the lower right on an arc, tracks the Bots segment as the window shrinks under it, and
     clicks on 13.2 (it bottoms out on the beat); then it leaves the way it came */
  const press = tm - f(4);
  const cur = lookCursor(0, 0, 48);
  cur.style.left = '0'; cur.style.top = '0'; cur.style.transformOrigin = '4px 3px';
  ctx.stage.screen.appendChild(cur);
  const cIn = press - f(34), cOut = tm + f(10);
  const startP: [number, number] = S.v ? [1180, 1500] : [2040, 900];
  const endP: [number, number] = S.v ? [1200, 2100] : [2100, 1240];
  const target = (t: number): [number, number] => { const p = S.gw.project(t, D.bots[0] + 14, D.bots[1] + 6, drift); return p; };
  const pressK = { s: 1 };
  film.tl.fromTo(pressK, { s: 1 }, { s: 0.85, duration: f(4), ease: ui, immediateRender: false, data: { role: 'cursor' } }, press);
  film.tl.to(pressK, { s: 1, duration: springDuration('settle'), ease: springEase('settle'), immediateRender: false, data: { role: 'cursor' } }, tm);
  const arc = (a: [number, number], b: [number, number], k: number, bend: number): [number, number] => {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, s = Math.sin(Math.PI * k) * bend * d;
    return [a[0] + dx * k - (dy / d) * s, a[1] + dy * k + (dx / d) * s];
  };
  film.onRender((t) => {
    if (t < cIn || t > cOut + f(30)) { if (cur.style.visibility !== 'hidden') cur.style.visibility = 'hidden'; return; }
    cur.style.visibility = '';
    let p: [number, number];
    if (t <= press - f(5)) p = arc(startP, target(t), travel((t - cIn) / (press - f(5) - cIn)), 0.12);
    else if (t <= cOut) p = target(Math.min(t, press + f(2)));
    else p = arc(target(press + f(2)), endP, depart((t - cOut) / f(30)), -0.08);
    cur.style.transform = 'translate(' + (p[0] - 4).toFixed(2) + 'px,' + (p[1] - 3).toFixed(2) + 'px) scale(' + pressK.s.toFixed(4) + ')';
  }, 3);
  film.motion(cIn, cOut + f(30));

  /* the click: the thumb slides (--dur-slide on --ease), the labels trade ink, the sidebar's rows and the main area's view
     change places (the session leaves left as the room arrives from the right, as the thumb moves right), the right panel
     slides away under the window's edge and the main area grows to the window's edge (--dur-3 on --spring) */
  film.tl.fromTo(S.thumb, { x: 0 }, { x: D.thumbDx, duration: 0.24, ease: ui, immediateRender: true, data: { role: 'ui' } }, tm);
  const labels = [...S.tabs.querySelectorAll<HTMLElement>(':scope > span > i')];
  film.tl.fromTo(labels[0]!, { backgroundColor: '#1a1815', opacity: 0.7 }, { backgroundColor: '#a59d90', opacity: 1, duration: 0.15, ease: ui, immediateRender: true, data: { role: 'ui' } }, tm + f(4));
  film.tl.fromTo(labels[1]!, { backgroundColor: '#a59d90', opacity: 1 }, { backgroundColor: '#1a1815', opacity: 0.7, duration: 0.15, ease: ui, immediateRender: true, data: { role: 'ui' } }, tm + f(6));
  S.sideSession.forEach((r, i) => film.tl.fromTo(r, { x: 0, opacity: 1 }, { x: -40, opacity: 0, duration: 0.12, ease: ui, immediateRender: false, data: { role: 'ui' } }, tm + f(2 * i)));
  S.sideBots.forEach((r, i) => film.tl.fromTo(r, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.2, ease: ui, immediateRender: true, data: { role: 'ui' } }, tm + f(6 + 2 * i)));
  /* the main area: the session's view is pushed out of its clip to the left as the room's arrives from the right, edge to
     edge (a film move joining the product's two views; nothing fades) */
  const sessionView = [...S.sessionClip.children] as HTMLElement[];
  const push = L.main[2];
  const pushAt = tm + f(2), pushDur = 0.4;
  film.tl.fromTo(sessionView, { x: 0 }, { x: -push, duration: pushDur, ease: travel, immediateRender: false, data: { role: 'ui' } }, pushAt);
  film.tl.set(S.sessionClip, { immediateRender: false, visibility: 'hidden' }, pushAt + pushDur);
  film.tl.fromTo([S.oldRoom, S.roomComp], { x: push }, { x: 0, duration: pushDur, ease: travel, immediateRender: true, data: { role: 'ui' } }, pushAt);
  if (S.panelWrap && L.panel) {
    film.tl.to([...S.panelWrap.children], { x: L.panel[2] + 40, duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, pushAt);
    film.tl.fromTo([S.plate, S.viewport], { width: L.main[2] }, { width: L.mainBots[2], duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, pushAt);
    film.tl.fromTo(S.dock, { x: 0 }, { x: (L.mainBots[2] - L.main[2]) / 2, duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, pushAt);
  }

  /* past the window's edges: the terminal behind on the left, the app in front at the lower right */
  const termStart: [number, number, number] = S.v ? [-60, -1000, 1224] : [-1300, 40, 1205];
  S.gt.view.set(0, viewFor(film, L.term, termStart));
  S.gt.view.to(t0 + f(10), t1, viewAt(ctx, drift, t1, L.term, L.b11.term), travel);
  const appStart: [number, number, number] = S.v ? [700, 2250, 700] : [2150, 1020, 660];
  S.ga.view.set(0, viewFor(film, L.app, appStart));
  S.ga.view.to(t0 + f(16), t1, viewAt(ctx, drift, t1, L.app, L.b11.app), travel);
  /* the ground answers at its depth; the lamp opens wide and cool over the desk */
  R.ground.to(t0, t1, { s: 0.82, dx: S.v ? 0 : 40, dy: S.v ? 30 : 12 }, travel);
  R.light.to(t0, t1, { x: 0.5, y: 0.52, w: 1.1, h: 1.1, cool: 1 }, travel);
}

/* ═════════════ B12: from a terminal ═════════════ */
export function b12(ctx: ActCtx, S: Stage3, D: DeskPrep): void {
  const film = ctx.film, L = S.L, w = ctx.win('B12'), f = (n: number): number => n / film.fps;
  film.mark('B12', w.start);
  const t0 = w.start, enter = at('15.1');           /* 27.733, 29.867: Enter is the drop */
  const R = S.rig, drift = R.drift;
  const cam = springDuration('camera'), camE = springEase('camera', cam);
  /* the camera eases onto the terminal; the window slides back and out of focus a little ahead; the app leaves by the
     right edge (it is nearest, it goes fastest) */
  const lag = f(4);
  S.gt.view.to(t0 + lag, t0 + lag + cam, viewAt(ctx, drift, t0 + lag + cam, L.term, L.b12.term), camE);
  S.gw.view.to(t0, t0 + cam, viewAt(ctx, drift, t0 + cam, L.win, L.b12.win), camE);
  S.gw.lens.to(t0, t0 + cam, { blur: 6, dim: 0.8 }, camE);
  S.ga.view.to(t0, t0 + cam, REST(film), camE);
  /* a slow push toward the command while it types (holds keep moving) */
  /* zoomed about the command's start, so the whole line stays in frame as it grows */
  drift.to(t0 + lag + cam, enter, S.v ? { z: 1.07, dx: 34, dy: 22 } : { z: 1.085, dx: 80, dy: 18 }, travel);
  /* the terminal comes in front once the window has slid clear of it (the swap happens where they do not overlap) */
  const tR = (t: number): Rect => S.gt.screenRect(t, L.term, drift), wR = (t: number): Rect => S.gw.screenRect(t, L.win, drift);
  let swap = -1;
  for (let t = t0; t <= enter; t += f(1)) { const a = tR(t), b = wR(t); const apart = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]; if (apart) { swap = t; break; } }
  if (swap < 0) throw new Error('A3 B12: the terminal and the window never part; the terminal cannot come in front unseen');
  film.tl.set(S.gt.el, { immediateRender: false, zIndex: 2 }, swap);
  film.tl.set(S.gw.el, { immediateRender: false, zIndex: 1 }, swap);
  R.ground.to(t0, t0 + lag + cam, { s: 0.9, dx: S.v ? 0 : -60, dy: S.v ? 60 : 10 }, camE);
  R.light.to(t0, t0 + lag + cam, S.v ? { x: 0.5, y: 0.36, w: 0.9, h: 0.96 } : { x: 0.34, y: 0.56, w: 0.9, h: 0.96 }, camE);

  /* the film line rises at the top (K1) and leaves before the drop */
  lineIn(film, S.line12, t0 + f(2));
  lineOut(film, S.line12, at('14.4.5') - f(2));

  /* the prompt shows once the terminal's mono is drawn at 28 px or more; the command types with a person's rhythm; the
     caret only at rest */
  const fs = parseFloat(getComputedStyle(S.termBody).fontSize);
  let promptAt = t0;
  for (let t = t0; t < enter; t += f(1)) if (fs * S.gt.scale(t, drift) >= 28.4) { promptAt = t; break; }
  const prompt = S.termLines[0]!;
  film.tl.fromTo(prompt, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: ui, immediateRender: true, data: { role: 'type' } }, promptAt);
  const typeFrom = promptAt + f(5), typeTo = enter - f(13);
  const chars = D.cmdChars.filter((c) => !c.classList.contains('a3-brk'));
  const typed = chars.map((c) => c.textContent ?? '').join('');
  typeChars(film, chars, rhythm(typed, typeFrom, typeTo, 21));
  /* the caret: at rest after the prompt, hidden while the keys fall, at rest again, then Enter takes it */
  film.tl.fromTo(D.caret, { opacity: 0 }, { opacity: 1, duration: f(3), ease: ui, immediateRender: true, data: { role: 'type' } }, promptAt + f(2));
  film.tl.to(D.caret, { opacity: 0, duration: f(2), ease: ui, immediateRender: false, data: { role: 'type' } }, typeFrom);
  film.tl.to(D.caret, { opacity: 1, duration: f(3), ease: ui, immediateRender: false, data: { role: 'type' } }, typeTo + f(2));
  film.tl.to(D.caret, { opacity: 0, duration: f(3), ease: ui, immediateRender: false, data: { role: 'type' } }, enter);
  for (const l of S.termLines.slice(1)) l.style.opacity = '0';
}

/* ═════════════ B13: live in the open room ═════════════ */
export function b13(ctx: ActCtx, S: Stage3, D: DeskPrep): void {
  const film = ctx.film, L = S.L, w = ctx.win('B13'), f = (n: number): number => n / film.fps;
  film.mark('B13', w.start);
  const enter = w.start, landed = at('15.1.5');       /* 29.867, 30.133 */
  const R = S.rig, drift = R.drift, dur = landed - enter;
  const C = [film.width / 2, film.height / 2] as const;
  /* the snap wide: the terminal onto its seam rect, the window forward until its main area is the room at 2.6x */
  S.gt.view.to(enter, landed, REST(film), snap);
  S.gw.view.to(enter, landed, { cx: C[0] - L.b13.win[0], cy: C[1] - L.b13.win[1], lz: 0 }, snap);
  S.gw.lens.to(enter, landed, { blur: 0, dim: 1 }, snap);
  film.motion(enter, landed, 32);
  /* every plate move of the act asks the renderer for motion blur (the rig draws them, so the timeline cannot tell it) */
  declareMotion(film, S.gw.view.spans(), S.gt.view.spans(), S.ga.view.spans(), S.gw.lens.spans(), R.ground.spans());
  /* then the act camera's last drift: on to rest, landing on the seam */
  /* 16:9 keeps widening to rest on the seam; 9:16, its column of type denser, settles inside the snap and holds while
     the blocks print (a slow drift under that much type reads as a dissolve) */
  if (S.v) drift.to(enter, landed, { z: 1, dx: 0, dy: 0 }, snap);
  else drift.to(landed, w.end, { z: 1, dx: 0, dy: 0 }, travel);
  R.ground.to(enter, w.end, { s: 1, dx: 0, dy: 0 }, travel);
  /* B13's lamp, cool and centred: exactly the light A4 sets on the seam frame (a4.ts lampsOf, B14 +0) */
  R.light.to(enter, w.end, { x: 0.5, y: 0.5, w: 0.9, h: 0.96, cool: 1 }, travel);

  /* the window's frame and sidebar are masked away to the main area; 9:16 also brings the main area's left edge in to
     the room's column (the key frame's plate) */
  const ins = (top: number, right: number, bottom: number, left: number): string => 'inset(' + top + 'px ' + right + 'px ' + bottom + 'px ' + left + 'px round 30px)';
  const plateX = L.b13.plate[0];
  /* (the mask leads the growth, so the sidebar is gone before it would be drawn large) */
  film.tl.fromTo(S.win, { clipPath: ins(0, 0, 0, 0) }, { clipPath: ins(L.main[1] - L.win[1], 0, 0, plateX - L.win[0]), duration: dur * 0.6, ease: travel, immediateRender: false, data: { role: 'reveal' } }, enter);
  if (plateX !== L.mainBots[0]) {
    const dx = plateX - L.mainBots[0], right = L.mainBots[0] + L.mainBots[2];
    film.tl.fromTo([S.plate, S.viewport], { left: L.mainBots[0], width: L.mainBots[2] }, { left: plateX, width: right - plateX, duration: dur, ease: snap, immediateRender: false, data: { role: 'carry' } }, enter);
    film.tl.fromTo(S.scroll, { x: 0 }, { x: -dx, duration: dur, ease: snap, immediateRender: false, data: { role: 'carry' } }, enter);
  }
  /* once its far edges are off the frame, the plate takes the seam's exact rect (SEAMS desk.window) */
  const P = L.b13.plate;
  film.tl.set([S.plate, S.viewport], { immediateRender: false, left: P[0], top: P[1], width: P[2], height: P[3] }, landed + f(6));
  film.tl.set(S.scroll, { immediateRender: false, x: L.mainBots[0] - P[0] }, landed + f(6));
  /* the room's composer and the dock go down with the main area's foot */
  film.tl.to(S.roomComp, { y: 600, duration: dur, ease: snap, immediateRender: false, data: { role: 'carry' } }, enter);
  /* the room scrolls its old thread up and away to make room for the run */
  const scrollBy = -(D.oldBottom + 140);
  film.tl.fromTo(S.oldRoom, { y: 0 }, { y: scrollBy, duration: dur + f(6), ease: snap, immediateRender: false, data: { role: 'ui' } }, enter);
  film.tl.fromTo(S.room, { y: 0 }, { y: scrollBy, duration: dur + f(6), ease: snap, immediateRender: false, data: { role: 'ui' } }, enter);
  film.tl.fromTo(S.voxEntry, { y: 0 }, { y: scrollBy, duration: dur + f(6), ease: snap, immediateRender: false, data: { role: 'ui' } }, enter);

  /* the terminal prints on the half-beats; the room lands each message on the same frame (room replies land whole:
     their parts rise 6 px in turn) */
  const lines = S.termLines;
  const block = (i: number, t: number): void => { lines.slice(i, i + 2).forEach((l, j) => film.tl.fromTo(l, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: f(12), ease: arrive, immediateRender: true, data: { role: 'type' } }, t + f(3 * j))); };
  const tKai = landed, tVox = at('15.2.5'), tKai2 = at('15.3'), tDone = at('15.3.5');   /* 30.133, 30.667, 30.933, 31.2 */
  block(1, tKai); block(3, tVox); block(5, tKai2);
  film.tl.fromTo(lines[7]!, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: f(12), ease: arrive, immediateRender: true, data: { role: 'type' } }, tDone);
  film.tl.fromTo(lines[8]!, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: f(12), ease: arrive, immediateRender: true, data: { role: 'type' } }, tDone + f(4));
  /* the command line commits on Enter (the line stays; the caret has gone); the room: your request, then kai */
  const [you, kai] = D.entries;
  const landEntry = (e: HTMLElement, t: number): void => {
    const parts = [e.querySelector<HTMLElement>('.ui-callno'), e.querySelector<HTMLElement>('.ui-entry__body')].filter((x): x is HTMLElement => !!x);
    parts.forEach((p, j) => film.tl.fromTo(p, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, t + f(3 * j)));
  };
  /* the request lands as soon as the room is drawn at a size its words can be read (a few frames into the snap) */
  let youAt = enter;
  const meta = 11 * X;
  for (let t = enter; t < landed; t += f(1)) if (meta * S.gw.scale(t, drift) >= 28.4) { youAt = t; break; }
  landEntry(you!, youAt);
  landEntry(kai!, tKai);
  /* vox's reply lands whole; on kai's next block the two gather into the live huddle: vox's orb and words travel into
     the huddle's first message, its label line and kai's message arrive in turn */
  landEntry(D.vox.entry, tVox);
  const g0 = tKai2;
  for (const e of [D.huddle.querySelector<HTMLElement>('.ui-callno'), D.hHead, D.hv.head, D.kaiMsg]) if (e) e.style.opacity = '0';
  film.tl.set(D.huddle, { immediateRender: false, visibility: 'hidden' }, 0);
  film.tl.set(D.huddle, { immediateRender: false, visibility: 'visible' }, g0);
  film.tl.set([D.vox.orb, D.vox.text], { immediateRender: false, visibility: 'hidden' }, g0);
  film.tl.fromTo(D.vox.call, { x: 0, y: 0, opacity: 1 }, { x: 8, y: 10, opacity: 0, duration: 0.15, ease: ui, immediateRender: false, data: { role: 'ui' } }, g0);
  film.tl.set(D.vox.entry, { immediateRender: false, visibility: 'hidden' }, g0 + 0.16);
  film.tl.fromTo(D.hv.orb, { x: D.hv.d.orb[0], y: D.hv.d.orb[1] }, { x: 0, y: 0, duration: f(16), ease: travel, immediateRender: false, data: { role: 'carry' } }, g0);
  film.tl.fromTo(D.hv.text, { x: D.hv.d.text[0], y: D.hv.d.text[1] }, { x: 0, y: 0, duration: f(16), ease: travel, immediateRender: false, data: { role: 'carry' } }, g0);
  const hCall = D.huddle.querySelector<HTMLElement>('.ui-callno')!;
  film.tl.fromTo(hCall, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, g0 + f(4));
  film.tl.fromTo(D.hHead, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, g0 + f(6));
  const vHeadParts = [...D.hv.head.children].filter((c) => !c.classList.contains('film-orb-holder')) as HTMLElement[];
  D.hv.head.style.opacity = '1';
  for (const p of vHeadParts) p.style.opacity = '0';
  film.tl.fromTo(vHeadParts, { x: -6, opacity: 0 }, { x: 0, opacity: 1, duration: 0.2, ease: ui, immediateRender: false, data: { role: 'ui' } }, g0 + f(13));
  film.tl.fromTo(D.kaiMsg, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, g0 + f(10));
}
