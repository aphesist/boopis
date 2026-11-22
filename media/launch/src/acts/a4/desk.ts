/* B14 to B16 on one set: nina's session in the dock and the other app on the desktop, built from the art director's
   key frames b14 and b15 (look/src/scenes/desk.ts), which sit on top of each other in the world, right of and below the
   desk A3 hands over (S3). Nothing is redrawn: b15's dock slab, its head, your request, nina's reply and her approval
   card, and b15's other app are the set; b14's older messages (bars), its compact composer, its film line, its typed
   field and its cursor are moved into it. The film then plays the product's own states on it:

     B14  the closed dock (its orbs at 40 x 2.6) opens into nina's session on the dock's springs (critically damped,
          omega 22): one click, a poke, the slab's outline grows up, nina's orb travels to the session head; the other
          app's field types "nina, go ahead with staging" (K2)
     B15  the message lands in both places on one frame; nina's reply streams in both; her approval card rises (300 ms
          on --ease), her face turns to needs with the flag; the lamp warms red
     B16  the camera pushes in until Hold to approve fills 60% of the frame; the cursor presses; the product's own fill
          (Bayer 4x4 on a 3 px grid, holdEase, exactly 60 frames); a smash cut on the downbeat to the receipt

   The rows of both columns (the session's log and the other app's list) are the product's: a new entry grows in at its
   own height (220 ms, 6 px rise), an old one files away under the head (it slides up behind the row's edge), the card
   rises at --dur-3. Heights are measured once at build; every frame is a pure function of the timeline. */
import type { ActCtx } from '../context';
import { swapOrbs, type SwappedOrb } from '../../engine/look';
import { FilmOrb } from '../../engine/orb';
import { ui } from '../../engine/kit';
import { blink, eyes, glance } from '../../motion/orb-moves';
import { springEase, springDuration } from '../../motion/spring';
import { travel } from '../../motion/ease';
import { typeOn } from '../../motion/type';
import { DOCK, dockEase, dockDur, holdEase, lerp, onlyIn, screenCursor, screenLayer, uiEase, type ScreenCursor } from './util';
import { lineUnits, softRise, lineExit } from './type';

const SCALE = 2.6;                 /* the dock session's kit zoom (b14, b15) */
const GAP = 16, PAD = 16;          /* the session column's gap and padding, real px */
const NINA = '#f23b5a';

export interface DeskSet {
  DX: number; DY: number;
  box: HTMLElement;                 /* b15's key frame box: the set */
  slab: HTMLElement;
  headOrb: SwappedOrb;              /* nina at the session head */
  /** world rect of the hold button and the head orb's world centre, as B15 leaves the set */
  hold: { x: number; y: number; w: number; h: number };
  head: { x: number; y: number; size: number };
  cursor: ScreenCursor;
  /** the medium shot after the smash cut (B16 to B17): the camera there */
  medium: { x: number; y: number; zoom: number };
  hideFrom: number[];               /* set by B18: when the desktop has left the frame */
}

const sets = new WeakMap<ActCtx, Promise<DeskSet>>();
export const deskSet = (ctx: ActCtx): Promise<DeskSet> => {
  let s = sets.get(ctx);
  if (!s) { s = buildSet(ctx); sets.set(ctx, s); }
  return s;
};

interface Row { el: HTMLElement; body: HTMLElement; h: number; grow: { v: number }; file: { v: number } }
const row = (child: HTMLElement): Row => {
  const el = document.createElement('div');
  el.className = 'a4-row';
  el.style.cssText = 'overflow:clip;position:relative;flex:none';
  child.replaceWith(el);
  el.appendChild(child);
  return { el, body: child, h: 0, grow: { v: 1, __name: 'row-grow' } as { v: number }, file: { v: 0, __name: 'row-file' } as { v: number } };
};
const kOf = (r: Row): number => r.grow.v * (1 - r.file.v);

async function buildSet(ctx: ActCtx): Promise<DeskSet> {
  const { film, stage, g } = ctx;
  const V = ctx.variant === 'vertical';
  const DX = V ? 60 : 760, DY = V ? 2000 : 1180;
  const kf14 = await ctx.keyFrame('b14', { x: DX, y: DY, swapOrbs: false });
  const kf15 = await ctx.keyFrame('b15', { x: DX, y: DY, swapOrbs: false });
  const host = stage.root.getBoundingClientRect().width / stage.width;
  const rel = (el: Element, to: Element): { x: number; y: number; w: number; h: number } => {
    const a = el.getBoundingClientRect(), b = to.getBoundingClientRect();
    return { x: (a.left - b.left) / host, y: (a.top - b.top) / host, w: a.width / host, h: a.height / host };
  };

  /* ── the session slab: b15's, with b14's older messages and composer moved in ── */
  const isSlab = (e: Element): boolean => (e as HTMLElement).style.background.includes('dock-bg');
  const slab = [...kf15.children].find(isSlab) as HTMLElement;
  const slab14 = [...kf14.children].find(isSlab) as HTMLElement;
  const film15 = slab.querySelector<HTMLElement>('.ui-film')!;
  /* the session's column (head, log, composer) inside the zoomed box */
  const inner = film15.firstElementChild as HTMLElement;
  const inner14 = slab14.querySelector<HTMLElement>('.ui-film')!.firstElementChild as HTMLElement;
  const [head, you, reply, card] = [...inner.children] as HTMLElement[];
  const [, bars1, bars2, composer] = [...inner14.children] as HTMLElement[];
  inner.insertBefore(bars1!, you!); inner.insertBefore(bars2!, you!); inner.appendChild(composer!);
  slab14.style.display = 'none';
  const orbs15 = swapOrbs(film, kf15);
  const headOrb = orbs15.get('nina')!;
  /* nina idle until the card asks: the product's resting face, looking out a little */
  Object.assign(headOrb.orb.pose, { eyes: 'pill', eyesTo: '', eyesMix: 0, yaw: 6, pitch: 4 });
  const flag = head!.querySelector<HTMLElement>('.ui-dot--flag');
  const rows = [head!, bars1!, bars2!, you!, reply!, card!, composer!].map(row);
  const [rHead, rB1, rB2, rYou, rReply, rCard, rComp] = rows as [Row, Row, Row, Row, Row, Row, Row];
  inner.style.gap = '0px';
  const realW = parseFloat(film15.style.width) || film15.getBoundingClientRect().width / host / SCALE;
  const zr = film15.getBoundingClientRect().width / realW;      /* real px -> client px */
  for (const r of rows) r.h = r.el.getBoundingClientRect().height / zr;
  const slabBox = rel(slab, kf15);
  const headC = rel(headOrb.holder, slab);
  const holdEl = card!.querySelector<HTMLElement>('.ui-hold')!;
  const holdIn = rel(holdEl, rCard.el);
  const denyEl = card!.querySelector<HTMLElement>('.ui-btn:not(.ui-hold)');
  void denyEl;

  /* ── the other app: b15's plate, b14's older messages (bars) moved in at the top ── */
  const app = kf15.querySelector<HTMLElement>('.app2')!;
  const app14 = kf14.querySelector<HTMLElement>('.app2')!;
  const field = app.querySelector<HTMLElement>('.app2__field')!;
  const msgs15 = [...app.querySelectorAll<HTMLElement>('.app2__msg')];
  const old = [...app14.querySelectorAll<HTMLElement>('.app2__msg')];
  for (const m of old) app.insertBefore(m, msgs15[0] ?? field);
  app14.style.display = 'none';
  let aYouEl: HTMLElement, aReplyEl: HTMLElement, aNeedsEl: HTMLElement;
  if (msgs15.length >= 3) [aYouEl, aReplyEl, aNeedsEl] = msgs15 as [HTMLElement, HTMLElement, HTMLElement];
  else {
    /* the 9:16 key frame lists only the last row; the two before it are the same element with the thread's words */
    aNeedsEl = msgs15[0]!;
    aYouEl = aNeedsEl.cloneNode(true) as HTMLElement; aYouEl.textContent = 'nina, go ahead with staging'; aYouEl.dataset['you'] = '';
    aReplyEl = aNeedsEl.cloneNode(true) as HTMLElement; aReplyEl.textContent = 'Ready. Deploying needs your approval.';
    app.insertBefore(aYouEl, aNeedsEl); app.insertBefore(aReplyEl, aNeedsEl);
  }
  const aRows = [...old, aYouEl, aReplyEl, aNeedsEl].map(row);
  const aOld = aRows.slice(0, old.length), [aYou, aReply, aNeeds] = aRows.slice(old.length) as [Row, Row, Row];
  app.style.gap = '0px'; app.style.overflow = 'clip';
  for (const r of aRows) r.h = r.el.getBoundingClientRect().height / host;
  field.textContent = '';
  const typed = document.createElement('span');
  typed.className = 'a4-typed';
  typed.style.display = 'inline-block';
  typed.textContent = 'nina, go ahead with staging';
  field.appendChild(typed);
  delete field.dataset['empty'];
  const fieldBox = rel(field, kf15);

  /* ── the closed dock: the roster at the slab's foot (the product's dock: orbs 40 at 2.6x, the "+") ── */
  const dockH = Math.round(66 * SCALE), dockW = Math.round(330 * SCALE);
  const dockRow = document.createElement('div');
  dockRow.className = 'a4-dock';
  dockRow.style.cssText = 'position:absolute;left:0;bottom:0;height:' + dockH + 'px;display:flex;align-items:center;justify-content:center;gap:' + Math.round(14 * SCALE) + 'px';
  const roster = [['kai', 'circle', '#4fc9a8'], ['nina', 'triangle', NINA], ['moss', 'squircle', '#2fd26a'], ['vox', 'circle', '#6d5cf0']] as const;
  const dockOrbs = roster.map(([name, shape, color], i) => {
    const o = new FilmOrb({ shape, color }, 104, { eyes: 'pill', yaw: [10, 6, -4, -10][i]!, pitch: 6 });
    const hold = document.createElement('span');
    hold.className = 'film-orb-holder a4-dock-orb';
    hold.style.cssText = 'display:inline-block;position:relative;width:104px;height:104px;line-height:0;flex:none';
    hold.appendChild(o.el);
    dockRow.appendChild(hold);
    film.onRender(() => o.render());
    return { name, orb: o, hold };
  });
  const plus = document.createElement('span');
  plus.style.cssText = 'display:inline-flex;width:' + Math.round(18 * SCALE) + 'px;height:' + Math.round(18 * SCALE) + 'px;color:var(--ink-on-dock);opacity:.7;flex:none';
  plus.innerHTML = ui.icon('plus');
  const psvg = plus.querySelector('svg'); if (psvg) { psvg.style.width = '100%'; psvg.style.height = '100%'; }
  dockRow.appendChild(plus);
  slab.appendChild(dockRow);
  const ninaDock = dockOrbs[1]!;
  /* the dock's nina and the session head's nina are one orb: the same pose, every frame */
  film.onRender(() => { Object.assign(ninaDock.orb.pose, headOrb.orb.pose); }, -1);
  /* where nina's dock slot sits, from the slab's centre (the row is centred, so this holds at any slab width) */
  const slotDX = (() => { const r = rel(ninaDock.hold, dockRow), rw = rel(dockRow, dockRow); return r.x + r.w / 2 - rw.w / 2; })();

  /* ── geometry: the slab's foot, its open width and centre ── */
  const Wopen = slabBox.w, leftOpen = slabBox.x, cx = leftOpen + Wopen / 2;
  const Yb14 = V ? 1220 : 1080, Yb15 = V ? slabBox.y + slabBox.h : 1080;
  const ybK = { v: 0, __name: 'slab-foot' };
  const open = { v: 0, __name: 'dock-open' }, carry = { v: 0, __name: 'nina-carry' }, hide = { v: 0, __name: 'composer-away' };
  const contentH = (): number => {
    let s = PAD * 2;
    rows.forEach((r, i) => { const k = kOf(r); s += r.h * k + (i ? GAP * k : 0); });
    return s * SCALE;
  };
  const Vof = (): number => {
    const vOpen = contentH() - hide.v * (GAP + rComp.h) * SCALE;
    return lerp(dockH, vOpen, open.v);
  };
  slab.style.bottom = 'auto'; slab.style.overflow = 'clip'; slab.style.borderRadius = '40px 40px 0 0';
  const outer = film15.parentElement as HTMLElement;
  film.onRender(() => {
    rows.forEach((r, i) => {
      const k = kOf(r);
      r.el.style.height = (r.h * k).toFixed(3) + 'px';
      r.el.style.marginTop = i ? (GAP * k).toFixed(3) + 'px' : '0px';
      r.el.style.display = k <= 0.0005 ? 'none' : '';
      r.body.style.transform = r.file.v > 0 ? 'translateY(' + (-r.file.v * r.h).toFixed(3) + 'px)' : r.grow.v < 1 ? 'translateY(' + ((1 - r.grow.v) * 6).toFixed(3) + 'px)' : '';
    });
    const v = Vof(), w = lerp(dockW, Wopen, open.v), left = cx - w / 2, yb = lerp(Yb14, Yb15, ybK.v);
    slab.style.left = left.toFixed(3) + 'px'; slab.style.width = w.toFixed(3) + 'px';
    slab.style.top = (yb - v).toFixed(3) + 'px'; slab.style.height = v.toFixed(3) + 'px';
    outer.style.left = (leftOpen - left).toFixed(3) + 'px';
    dockRow.style.width = w.toFixed(3) + 'px';
    /* nina's carry from her dock slot to the session head (the dock's FLIP spring), on a slight arc */
    const sx = w / 2 + slotDX, sy = v - dockH / 2;
    const hx = headC.x + headC.w / 2 + (leftOpen - left), hy = headC.y + headC.h / 2;
    const k = carry.v, bend = Math.sin(Math.PI * Math.min(1, k)) * 0.12 * Math.hypot(hx - sx, hy - sy);
    const dx = hx - sx, dy = hy - sy, d = Math.hypot(dx, dy) || 1;
    ninaDock.hold.style.transform = 'translate(' + (dx * k + (-dy / d) * bend).toFixed(3) + 'px,' + (dy * k + (dx / d) * bend).toFixed(3) + 'px)';
  });
  /* the app's rows, the same way */
  film.onRender(() => {
    aRows.forEach((r, i) => {
      const k = kOf(r);
      r.el.style.height = (r.h * k).toFixed(3) + 'px';
      r.el.style.marginTop = i ? (16 * k).toFixed(3) + 'px' : '0px';
      r.el.style.display = k <= 0.0005 ? 'none' : '';
      r.body.style.transform = r.file.v > 0 ? 'translateY(' + (-r.file.v * (r.h + 16)).toFixed(3) + 'px)' : r.grow.v < 1 ? 'translateY(' + ((1 - r.grow.v) * 6).toFixed(3) + 'px)' : '';
    });
  });
  for (const r of [rYou, rReply, rCard]) r.grow.v = 0;
  for (const r of [aYou, aReply, aNeeds]) r.grow.v = 0;

  /* B15's final layout, from the measured rows: where the card's hold button and the head orb will be */
  const vOpen15 = SCALE * (PAD * 2 + rHead.h + GAP + rYou.h + GAP + rReply.h + GAP + rCard.h);
  const top15 = Yb15 - vOpen15;
  const cardTop15 = top15 + SCALE * (PAD + rHead.h + GAP + rYou.h + GAP + rReply.h + GAP);
  const hold = { x: DX + leftOpen + holdIn.x - (slabBox.x - leftOpen), y: DY + cardTop15 + holdIn.y, w: holdIn.w, h: holdIn.h };
  hold.x = DX + rel(holdEl, kf15).x;      /* x does not depend on the column */
  const headW = { x: DX + leftOpen + headC.x + headC.w / 2, y: DY + top15 + headC.y + headC.h / 2, size: headC.w };

  /* the cursor: the art director's arrow from b14, in the frame's own layer, off frame at first */
  const scr = screenLayer(film, stage);
  const cur = screenCursor(film, scr.el, kf14.querySelector<HTMLElement>('.cursor')!, ctx.cam, V ? [1180, 2100] : [2060, 1260]);
  const medium = V ? { x: DX + 540, y: DY + 1000, zoom: 1.04 } : { x: DX + 900, y: DY + 600, zoom: 1.06 };

  const set: DeskSet & { _: Record<string, unknown> } = {
    DX, DY, box: kf15, slab, headOrb, hold, head: headW, cursor: cur, medium, hideFrom: [],
    _: { kf14, rows, aRows, rB1, rB2, rYou, rReply, rCard, rComp, aOld, aYou, aReply, aNeeds, open, carry, hide, ybK, dockOrbs, ninaDock, plus, flag, typed, field, fieldBox, holdEl, card, reply, aReplyEl, aNeedsEl, head: rHead, slotDX, dockH, Yb14, cx }
  };
  void g;
  return set;
}

type Priv = DeskSet & { _: Record<string, any> };   // eslint-disable-line @typescript-eslint/no-explicit-any

/* ───────── B14: same thread, from your other apps ───────── */
export async function b14(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B14')) return;
  const { film, g, cam } = ctx;
  const V = ctx.variant === 'vertical';
  const w = ctx.win('B14'), b = (n: number): number => w.start + g.beats(n);
  const s = (await deskSet(ctx)) as Priv;
  const _ = s._;
  film.mark('B14', w.start);

  /* S3: the desk A3 handed over stays on until the glide has taken it out of the frame */
  const desk = ctx.carry.desk;
  if (desk) for (const el of new Set([desk.terminal, desk.window, desk.app, desk.dock].filter(Boolean) as HTMLElement[])) onlyIn(film, el, -Infinity, b(2), { from: w.start });
  onlyIn(film, _.kf14, b(0), b(7));
  onlyIn(film, s.box, b(0), Infinity);

  /* the camera: half a beat at rest, then it glides right and down to the dock and the app (camera spring) */
  const C = { x: s.DX + (V ? 540 : 960), y: s.DY + (V ? 960 : 540) };
  const glide = springDuration('camera');
  cam.to({ x: C.x, y: C.y, zoom: 1 }, { at: b(1.5) - glide, dur: glide, ease: springEase('camera') });
  /* as the cursor goes to the other app, the camera leans in on it for the typing; on send it settles back, so the
     message is seen landing in boopis (camera spring). No slow drift: over this much type it crawls the frame sub-pixel,
     which reads as a dissolve */
  const lean = g.f(22);
  /* (in 9:16 a small push only: the line above must stay inside the safe band, y 220 and down) */
  cam.to({ x: C.x + (V ? 0 : 110), y: C.y + (V ? 0 : 24), zoom: V ? 1.025 : 1.08 }, { at: b(2.5) + g.f(4), dur: lean, ease: travel });
  if (ctx.has('B15')) cam.to({ x: C.x, y: C.y, zoom: 1 }, { at: ctx.win('B15').start, dur: lean, ease: travel });

  /* the film line rises (K1), "Same" in the selection; it leaves before B15's line comes */
  const line = _.kf14.querySelector('.film-line') as HTMLElement;
  softRise(film, lineUnits(line), b(1.5));
  lineExit(film, line, ctx.win('B15').start + g.beats(1.6));

  /* the cursor comes in from the lower right to nina's orb in the dock, clicks; then to the other app's field */
  const ninaAim: [number, number] = [s.DX + _.cx + _.slotDX + 8, s.DY + _.Yb14 - _.dockH / 2 + 12];
  const click = b(2);
  s.cursor.move({ world: ninaAim }, { at: b(1.5) - g.f(14), dur: click - g.f(10) - (b(1.5) - g.f(14)), arc: 0.1 });
  s.cursor.press(click - g.f(4));
  const fb = _.fieldBox as { x: number; y: number; w: number; h: number };
  const fieldAim: [number, number] = [s.DX + fb.x + fb.w * 0.84, s.DY + fb.y + fb.h * 0.42];
  s.cursor.move({ world: fieldAim }, { at: b(2.5), dur: g.f(20), arc: 0.14 });
  s.cursor.press(b(3.125) - g.f(4));

  /* the dock answers the click: a poke, the slab grows up on its springs, the roster leaves, nina travels to the head */
  const pose = s.headOrb.orb.pose;
  film.tl.fromTo(pose, { squash: 0 }, { squash: 0.16, duration: g.f(4), ease: uiEase, immediateRender: false, data: { role: 'orb' } }, click);
  film.tl.to(pose, { squash: 0, duration: springDuration('character'), ease: springEase('character'), immediateRender: false, data: { role: 'orb' } }, click + g.f(4));
  film.tl.fromTo(_.open, { v: 0 }, { v: 1, duration: dockDur, ease: dockEase, data: { role: 'ui' } }, click);
  film.tl.fromTo(_.carry, { v: 0 }, { v: 1, duration: dockDur, ease: springEase(DOCK), data: { role: 'ui' } }, click + g.f(2));
  onlyIn(film, _.ninaDock.hold, -Infinity, click + g.f(2) + dockDur);
  onlyIn(film, s.headOrb.holder, click + g.f(2) + dockDur, Infinity);
  for (const d of _.dockOrbs as { name: string; hold: HTMLElement; orb: FilmOrb }[]) {
    if (d.name === 'nina') continue;
    film.tl.fromTo(d.hold, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.8, duration: 0.12, ease: uiEase, immediateRender: false, data: { role: 'ui' } }, click);
  }
  film.tl.fromTo(_.plus, { opacity: 0.7, scale: 1 }, { opacity: 0, scale: 0.8, duration: 0.12, ease: uiEase, immediateRender: false, data: { role: 'ui' } }, click);
  /* the roster turns to the cursor as it comes in (the product's dock looks toward the pointer, clamped) */
  (_.dockOrbs as { orb: FilmOrb }[]).forEach((d, i) => glance(film, d.orb, b(1.5) - g.f(10) + i * g.f(2), 16 - i * 4, -8));
  /* the session's own content enters (220 ms, the product's entrance), the head's words first */
  const nameEl = (_.head.body as HTMLElement).lastElementChild as HTMLElement;
  const enter = (el: HTMLElement, at: number): void => { film.tl.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.22, ease: uiEase, data: { role: 'ui' } }, at); };
  enter(nameEl, click + g.f(9));      /* her name as her orb comes home (the spring is 80% there), so it never passes over it */
  enter(_.rB1.body, click + g.f(5)); enter(_.rB2.body, click + g.f(7)); enter(_.rComp.body, click + g.f(9));

  /* nina looks at you once she has landed, and blinks */
  glance(film, s.headOrb.orb, click + g.f(14), 4, 2);
  blink(film, s.headOrb.orb, b(3.6));

  /* K2: the message types in the other app's field (30 cps, a soft leading edge) */
  typeOn(film, _.typed, { at: b(3.15), cps: 30 });

}

/* ───────── B15: nothing ships until you hold ───────── */
export async function b15(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B15')) return;
  const { film, g } = ctx;
  const V = ctx.variant === 'vertical';
  const w = ctx.win('B15'), b = (n: number): number => w.start + g.beats(n);
  const s = (await deskSet(ctx)) as Priv;
  const _ = s._;
  film.mark('B15', w.start);
  const grow = (r: Row, at: number, dur = 0.22): void => { film.tl.fromTo(r.grow, { v: 0 }, { v: 1, duration: dur, ease: uiEase, data: { role: 'ui' } }, at); };
  const file = (r: Row, at: number, dur = 0.3): void => { film.tl.fromTo(r.file, { v: 0 }, { v: 1, duration: dur, ease: travel, data: { role: 'ui' } }, at); };

  /* send: the field's words leave it, and on the same frame the message is yours in the dock session and in the app */
  onlyIn(film, _.typed, -Infinity, b(0));            /* the field clears on send, as the product's does */
  grow(_.rYou, b(0)); grow(_.aYou, b(0));
  file(_.rB1, b(0));
  /* nina's reply streams in both places, the same words in sync (a bot's own chat streams) */
  const replyP = _.reply as HTMLElement, appReply = _.aReplyEl as HTMLElement;
  grow(_.rReply, b(0.5), 0.18); grow(_.aReply, b(0.5), 0.18);
  file(_.rB2, b(0.5));
  const cps = 'Ready. Deploying needs your approval.'.length / g.beats(1.25);
  typeOn(film, replyP, { at: b(0.5), cps });
  typeOn(film, appReply, { at: b(0.5), cps });
  if (V) { file(_.aOld[0], b(0)); file(_.aYou, b(0.5)); file(_.aReply, b(2)); }
  else for (const r of _.aOld as Row[]) file(r, b(2));
  /* her approval card rises (--dur-3 on --ease); the composer goes below the frame; her face turns to needs; the flag */
  grow(_.rCard, b(2), 0.3);
  film.tl.fromTo(_.hide, { v: 0 }, { v: 1, duration: 0.3, ease: uiEase, data: { role: 'ui' } }, b(2));
  if (V) film.tl.fromTo(_.ybK, { v: 0 }, { v: 1, duration: 0.3, ease: uiEase, data: { role: 'ui' } }, b(2));
  grow(_.aNeeds, b(2));
  const o = s.headOrb.orb;
  glance(film, o, b(0.4), 10, 3);
  eyes(film, o, b(2), 'wide', { dur: 0.3 });
  glance(film, o, b(2), 0, 0);
  if (_.flag) {
    film.tl.fromTo(_.flag, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: springEase('settle'), data: { role: 'ui' } }, b(2) + g.f(4));
    onlyIn(film, _.flag, -Infinity, ctx.win('B16').start + g.beats(3));
  }
  /* the line swaps: "Nothing ships until you hold", "hold" in the selection */
  const line = s.box.querySelector('.film-line') as HTMLElement;
  softRise(film, lineUnits(line), b(2));
  onlyIn(film, line, -Infinity, ctx.win('B16').start + g.beats(3));
  /* the camera holds still on the card (a breath before the push): a slow drift here would crawl the whole frame's text */
}

/* ───────── B16: the hold ───────── */
export async function b16(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B16')) return;
  const { film, g, cam } = ctx;
  const V = ctx.variant === 'vertical';
  const w = ctx.win('B16'), b = (n: number): number => w.start + g.beats(n);
  const s = (await deskSet(ctx)) as Priv;
  const _ = s._;
  film.mark('B16', w.start);
  const h = s.hold, hc = { x: h.x + h.w / 2, y: h.y + h.h / 2 };
  /* the push: Hold to approve fills ~60% of the frame (90% in 9:16), on the camera spring */
  const Z = (V ? 0.9 * 1080 : 0.6 * 1920) / h.w;
  const push = g.beats(1);
  cam.to({ x: hc.x, y: hc.y, zoom: Z }, { at: b(0), dur: push, ease: springEase('camera', push) });
  const full = b(3);                                   /* 19.1: complete, and the cut */
  const press = full - 1;                              /* exactly 60 frames of fill before it */
  cam.drift({ x: hc.x + h.w * 0.06, zoom: Z * 1.035 }, { at: b(0) + push, dur: full - b(0) - push });
  /* the cursor arrives, dips 4 f, presses and holds down for the whole second */
  s.cursor.move({ world: [h.x + h.w * 0.62, h.y + h.h * 0.42] }, { at: b(0), dur: b(0.75) - b(0), arc: 0.1 });
  s.cursor.press(press - g.f(4), full);
  onlyIn(film, s.cursor.el, -Infinity, full);

  /* the product's own fill: holdEase over exactly 60 frames, the ordered dot field at the leading edge fusing into the
     bone fill, the label inverting where the fill has passed (components/hold.ts draw()) */
  const btn = _.holdEl as HTMLElement;
  const fx = btn.querySelector<HTMLCanvasElement>('canvas.ui-hold__fx')!;
  const solid = btn.querySelector<HTMLElement>('.ui-hold__solid')!, onLabel = btn.querySelector<HTMLElement>('.ui-hold__label--on')!;
  const Wr = h.w / SCALE, Hr = h.h / SCALE;            /* the button at its real size */
  const R = Z * SCALE * 1.15 * (window.devicePixelRatio || 1);   /* canvas px per real px: sharp at the close-up */
  fx.width = Math.round(Wr * R); fx.height = Math.round(Hr * R);
  const c2 = fx.getContext('2d');
  const bone = getComputedStyle(solid).backgroundColor || '#ece6da';
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const fill = { e: 0, __name: 'hold-fill' };
  film.tl.fromTo(fill, { e: 0 }, { e: 1, duration: 1, ease: holdEase, data: { role: 'ui' } }, press);
  let lastE = -1;
  film.onRender(() => {
    const e = fill.e;
    if (e === lastE) return;
    lastE = e;
    const fr = Math.min(28, Wr * 0.22), P = e * (Wr + fr), sw = Math.max(0, Math.min(Wr, P - fr));
    const clip = e <= 0 ? 'inset(0 100% 0 0)' : 'inset(0 ' + (Wr - sw).toFixed(3) + 'px 0 0)';
    solid.style.clipPath = clip; onLabel.style.clipPath = clip;
    if (!c2) return;
    c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, fx.width, fx.height);
    if (e <= 0 || e >= 1) return;
    c2.setTransform(R, 0, 0, R, 0, 0);
    c2.fillStyle = bone;
    const cell = 3, rowsN = Math.ceil(Hr / cell), c0 = Math.max(0, Math.floor(sw / cell)), c1 = Math.min(Math.ceil(Wr / cell), Math.ceil(P / cell));
    for (let col = c0; col <= c1; col++) {
      const x = col * cell, v = (P - (x + 1)) / fr;
      if (v <= 0) continue;
      for (let r = 0; r < rowsN; r++) if (v > ((BAYER[((r & 3) << 2) | (col & 3)] ?? 0) + 0.5) / 16) { c2.beginPath(); c2.arc(x + 1, r * cell + 1, 1, 0, Math.PI * 2); c2.fill(); }
    }
  });

  /* 19.1, the smash cut (T3) to the medium: the card's receipt "Approved at 14:09", its title and well dimmed (the
     product's resolved card), nina no longer owed anything, the other app's row "Approved" on the same frame */
  film.cut(full);
  cam.to({ x: s.medium.x, y: s.medium.y, zoom: s.medium.zoom }, { at: full - 1 / 600, dur: 1 / 600, ease: travel, blur: false });
  cam.drift({ x: s.medium.x + 14, y: s.medium.y - 6, zoom: s.medium.zoom * 1.03 }, { at: full, dur: ctx.win('B17').start - full });
  const card = _.card as HTMLElement;
  const foot = card.querySelector<HTMLElement>('[data-r="foot"]')!;
  const liveFoot = foot.firstElementChild as HTMLElement;
  const receipt = document.createElement('div');
  receipt.className = 'cd-foot';
  receipt.innerHTML = '<p class="cd-receipt">' + ui.icon('check', { class: 'cd-ico' }) + '<span>Approved at <span class="cd-mono">14:09</span></span></p>';
  receipt.style.display = 'none';
  foot.appendChild(receipt);
  const stamp = card.querySelector<HTMLElement>('.ui-stamp, [class*="stamp"]');
  const needs = _.aNeedsEl as HTMLElement, needsText = needs.textContent ?? '';
  let was: boolean | null = null;
  film.onRender((t) => {
    const done = t >= full - 1e-9;
    if (done === was) return;
    was = done;
    liveFoot.style.display = done ? 'none' : '';
    receipt.style.display = done ? '' : 'none';
    if (done) { card.dataset['state'] = 'approved'; card.dataset['tone'] = 'ink'; card.setAttribute('data-resolved', ''); }
    else { card.dataset['state'] = 'pending'; card.dataset['tone'] = 'red'; card.removeAttribute('data-resolved'); }
    if (stamp) stamp.style.visibility = done ? 'hidden' : '';
    needs.textContent = done ? 'Approved' : needsText;
  }, -5);
  /* nina, relieved: her eyes turn happy just after the cut, with a small hop of the face */
  const o = s.headOrb.orb;
  eyes(film, o, full + g.f(4), 'arc', { dur: 0.38 });
  film.tl.fromTo(o.pose, { squash: 0 }, { squash: -0.1, duration: g.f(5), ease: uiEase, immediateRender: false, data: { role: 'orb' } }, full + g.f(4));
  film.tl.to(o.pose, { squash: 0, duration: springDuration('character'), ease: springEase('character'), immediateRender: false, data: { role: 'orb' } }, full + g.f(9));
  glance(film, o, full + g.f(10), -6, 8);
}
