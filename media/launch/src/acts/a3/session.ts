/* B09 and B10: your own session, governed. The request types into the composer A2 handed over and lifts out of it
   into the thread as the request card; the answer starts on GPT-6.2 Sol, its steps rising as the product reveals them
   (8 px, on --spring over --dur-3, a row at a time, its parts 3 f apart); the right panel's Governance section slides
   in from the window's edge and flashes its head once, as the app does; the film line rises above the ladder. Then npm
   test fails (the product's quiet ring, never red), the change rolls back (a strip of added lines folds into the
   originals), the ladder's brass marker travels down to GPT-6.2 Astra while the call number's second line slides out
   from under the first, and the next npm test passes. The UI moves on the product's own curves and durations; the
   camera and the type on the film's. */
import type { ActCtx } from '../context';
import { boxOf } from '../../motion/carry';
import { travel, ui, uiSpring } from '../../motion/ease';
import { springDuration, springEase } from '../../motion/spring';
import { at } from '../../motion/beats';
import type { Stage3 } from './build';
import { X } from './layout';
import { barsFor, charSpans, collapse, lineIn, lineOut, rhythm, roller, typeChars, type Bar } from './text';
import { h } from '../../../look/src/stage';

const REQUEST = 'fix the proration drift in src/billing';
const TOKENS = { strong: '#f6f2ea', dim: '#a59d90', brassSoft: 'rgba(200, 166, 106, 0.14)', brassSoftOff: 'rgba(200, 166, 106, 0)' };

export interface Prep {
  rows: HTMLElement[]; rowY: number[]; rowH: number[]; logY: number;
  req: HTMLElement; reqCall: HTMLElement; reqLift: [number, number];
  agent: HTMLElement; call1: HTMLElement; call2: HTMLElement; call2H: number; disc: HTMLElement;
  chars: HTMLElement[];
  st: HTMLElement[]; names: HTMLElement[]; markerAt: [number, number][]; markerSize: number;
  stripAt: [number, number, number, number];
  composerTop: number;
  /** the words the B11 pull back turns into bars, with the px size each is drawn at (at the group's scale 1) */
  bars: Bar[];
}

/** measure what the beats need, before any tween touches layout (the log is B10's: every row laid out from the start) */
export function prepSession(ctx: ActCtx, S: Stage3): Prep {
  const k = (el: Element): [number, number, number, number] => { const b = boxOf(el, ctx.stage); return [b.x, b.y, b.w, b.h]; };
  const lb = k(S.log), logX = lb[0], logY = lb[1];
  const entries = [...S.log.querySelectorAll<HTMLElement>('.ui-entry')];
  const reqEntry = entries[0]!, agent = entries[1]!;
  const req = reqEntry.querySelector<HTMLElement>('.ui-request')!;
  const reqCall = reqEntry.querySelector<HTMLElement>('.ui-callno')!;
  const call = agent.querySelector<HTMLElement>('.ui-callno')!;
  const lines = [...call.children].filter((c) => c.tagName === 'SPAN') as HTMLElement[];
  const call1 = lines[0]!, call2 = lines[1]!;
  const disc = call.querySelector<HTMLElement>('.ui-disclosure')!;
  const rows = [...agent.querySelectorAll<HTMLElement>('.ui-step')];
  const rowY = rows.map((r) => k(r)[1] - logY), rowH = rows.map((r) => k(r)[3]);

  /* the request's text in the composer and in the card: the card starts with its text exactly over the typed text */
  S.input.textContent = REQUEST;
  const rIn = document.createRange(); rIn.selectNodeContents(S.input);
  const a = rIn.getBoundingClientRect();
  const rReq = document.createRange(); rReq.selectNodeContents(req);
  const b = rReq.getBoundingClientRect();
  const sk = ctx.stage.root.getBoundingClientRect().width / ctx.stage.width;
  /* (a transform inside the kit's zoom box is in the product's px: world px / 2.6) */
  const reqLift: [number, number] = [(a.left - b.left) / sk / X, (a.top - b.top) / sk / X];
  /* at the pull back the field shows its placeholder (a pseudo-element): measure it as text in the placeholder's ink */
  S.input.textContent = S.input.getAttribute('data-placeholder') ?? '';
  S.input.style.color = 'var(--text-quiet)';

  /* the ladder: its two stations (the marker travels between their centres), inside the list's own box (zoomed px) */
  const st = [...S.ladder.querySelectorAll<HTMLElement>('.ui-ladder__st')];
  const names = [...S.ladder.querySelectorAll<HTMLElement>('.ui-ladder__name')];
  const ol = k(S.ladder);
  const markerAt = st.map((e) => { const r = k(e); return [(r[0] + r[2] / 2 - ol[0]) / X, (r[1] + r[3] / 2 - ol[1]) / X] as [number, number]; });
  const markerSize = k(st[0]!)[2] / X;

  /* the rollback strip sits under row 4's meta, in the log's own px */
  const r4 = k(rows[3]!), title4 = k(rows[3]!.querySelector('.ui-step__title')!);
  const r5 = k(rows[4]!), r6 = k(rows[5]!);
  const stripAt: [number, number, number, number] = [title4[0] - logX, r4[1] + r4[3] - logY + 2, Math.min(560, title4[2]), Math.max(48, r6[1] - r5[1] - 14)];
  const composerTop = k(S.composer)[1];
  const call2H = k(call2)[3] / X;

  /* the words of the session, as bars (hidden): request, answer, Governance, composer; each in its own unzoomed box */
  const bars: Bar[] = [];
  const host = (owner: HTMLElement): HTMLElement => { const d = h('div', 'a3-bars'); owner.appendChild(d); return d; };
  const origin = (owner: HTMLElement): [number, number] => { const r = owner.getBoundingClientRect(); return [r.left, r.top]; };
  for (const owner of [S.log, S.gov, S.composer]) {
    const hb = host(owner);
    const o = origin(owner);
    const made = barsFor(owner.querySelector<HTMLElement>('.ui-film')!, hb, o);
    for (const m of made) { m.bar.style.left = (parseFloat(m.bar.style.left) / sk) + 'px'; m.bar.style.top = (parseFloat(m.bar.style.top) / sk) + 'px'; m.bar.style.width = (parseFloat(m.bar.style.width) / sk) + 'px'; }
    bars.push(...made);
  }
  S.input.style.color = '';
  const chars = charSpans(S.input, REQUEST);
  return { rows, rowY, rowH, logY, req, reqCall, reqLift, agent, call1, call2, call2H, disc, chars, st, names, markerAt, markerSize, stripAt, composerTop, bars };
}

/** B09: the request types, lifts into the thread; the answer starts on Sol; Governance slides in; the line rises */
export function b09(ctx: ActCtx, S: Stage3, P: Prep): void {
  const film = ctx.film, w = ctx.win('B09');
  const f = (n: number): number => n / film.fps;
  film.mark('B09', w.start);
  /* the shared camera is at rest through the act (SEAMS S2, S3): A3 moves its plates instead (a3/rig.ts). Held at rest
     from the seam frame, so the act lands on S3 whatever came before (a no-op when A2 lands at rest, as agreed) */
  ctx.cam.to({ x: film.width / 2, y: film.height / 2, zoom: 1, roll: 0 }, { at: w.start - 1 / 600, dur: 1 / 600, ease: travel, blur: false });
  const send = at('11.1');                  /* 21.333 */
  const rowsAt = [at('11.1.5'), at('11.2')]; /* 21.6, 21.867 */
  const lineAt = at('11.2');                 /* 21.867: lands about 22.4 */

  /* the request types at 30 cps with a person's rhythm, done a few frames before send */
  const tFirst = w.start + f(3);
  const times = rhythm(REQUEST, tFirst, send - f(5), 9);
  typeChars(film, P.chars, times);
  /* the composer's own state: its placeholder until the first character, the send button wakes, then empties on send */
  const back = send + f(14);
  film.onRender((t) => { const empty = t < tFirst || t >= back; const v = empty ? 'true' : 'false'; if (S.input.dataset['empty'] !== v) S.input.dataset['empty'] = v; });
  S.input.dataset['empty'] = 'true';
  film.tl.fromTo(S.send, { opacity: 0.35 }, { opacity: 1, duration: 0.15, ease: ui, immediateRender: true, data: { role: 'ui' } }, tFirst);
  film.tl.fromTo(S.send, { scale: 1 }, { scale: 0.96, duration: 0.09, ease: ui, immediateRender: false, data: { role: 'ui' } }, send - 0.09);
  film.tl.to(S.send, { scale: 1, duration: 0.15, ease: ui, immediateRender: false, data: { role: 'ui' } }, send);
  film.tl.to(S.send, { opacity: 0.35, duration: 0.15, ease: ui, immediateRender: false, data: { role: 'ui' } }, send + f(2));
  film.tl.set(P.chars, { immediateRender: false, opacity: 0 }, send);
  /* the placeholder comes back into the emptied field: a small rise, the product's --dur-2 */
  film.tl.fromTo(S.input, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: ui, immediateRender: false, data: { role: 'ui' } }, back);

  /* the request card: on send its text is exactly where the typed text was, on the composer's own --bg-3, and it lifts
     into the thread (T1, travel 20 f); its call number rises after it */
  P.req.style.visibility = 'hidden';
  film.tl.set(P.req, { immediateRender: false, visibility: 'visible' }, send);
  film.tl.fromTo(P.req, { x: P.reqLift[0], y: P.reqLift[1] }, { x: 0, y: 0, duration: f(22), ease: travel, immediateRender: true, data: { role: 'carry' } }, send);
  film.tl.fromTo(P.reqCall, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, send + f(10));

  /* 9:16: the composer leaves the band once it has sent (the column's foot is below the frame), so the section can sit
     under the steps */
  if (S.v) film.tl.fromTo(S.composer, { y: 0 }, { y: 760, duration: f(26), ease: travel, immediateRender: false, data: { role: 'carry' } }, send + f(4));

  /* the answer: its call number (Sol), then the rows, each the product's reveal (8 px, --spring, --dur-3), parts 3 f apart */
  film.tl.fromTo(P.call1, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, send + f(8));
  film.tl.fromTo(P.disc, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, rowsAt[1]!);
  const label = P.disc.querySelector<HTMLElement>('span')!;
  const roll = roller(label, 2, 6);
  for (const r of P.rows) r.style.setProperty('--sp', '0');
  P.rows.forEach((r) => { r.style.opacity = '0'; });
  rowIn(ctx, P, 0, rowsAt[0]!);
  rowIn(ctx, P, 1, rowsAt[1]!);
  (P as Prep & { roll?: typeof roll }).roll = roll;
  P.call2.style.overflow = 'clip';
  P.call2.style.height = '0px';

  /* the right panel's Governance section slides in from the window's edge (the product's layout travel: --dur-3 on
     --spring) and flashes its head once (--brass-soft, 1.2 s, as the app does when a panel opens from elsewhere) */
  const slideIn = send;
  const head = S.gov.querySelector<HTMLElement>('.ui-sec__head')!;
  if (S.panelWrap) {
    const kids = [...S.panelWrap.children] as HTMLElement[];
    film.tl.fromTo(kids, { x: S.panelWrap.offsetWidth + 40 }, { x: 0, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, slideIn);
  } else {
    film.tl.fromTo(S.gov, { x: ctx.film.width }, { x: 0, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, slideIn + f(10));
  }
  const flashAt = slideIn + (S.v ? f(10) : 0) + 0.3;
  film.tl.fromTo(head, { backgroundColor: TOKENS.brassSoft }, { backgroundColor: TOKENS.brassSoft, duration: 0.48, ease: ui, immediateRender: false, data: { role: 'ui' } }, flashAt);
  film.tl.fromTo(head, { backgroundColor: TOKENS.brassSoft }, { backgroundColor: TOKENS.brassSoftOff, duration: 0.72, ease: ui, immediateRender: false, data: { role: 'ui' } }, flashAt + 0.48);

  /* the film line: K1, the selection sweeps in behind "cheaper", the caret lands */
  lineIn(film, S.line9, lineAt);

  /* the camera: it follows the typing's leading edge, then the request up into the thread as the panel arrives, then
     leans in on the answer while the line lands (holds keep moving: 2 to 3% a second) */
  const D = S.rig.drift, cam = springDuration('camera');
  if (S.v) D.to(w.start, send, { dx: -30, dy: -60, z: 1.05 }, travel);
  else D.to(w.start, send, { dx: -60, dy: -24, z: 1.05 }, travel);
  D.to(send, send + cam, { dx: S.v ? 0 : 10, dy: S.v ? 30 : 30, z: 1.0 }, springEase('camera', cam));
  D.to(send + cam, ctx.win('B10').start, { dx: S.v ? 0 : -50, dy: S.v ? 0 : 24, z: S.v ? 1.03 : 1.05 }, travel);
  /* the lamp moves onto the session (B09's pool: the card stock's tone, a little left of centre) */
  S.rig.light.to(w.start, send + 0.4, S.v ? { x: 0.5, y: 0.5, w: 0.9, h: 0.96, inherit: 0 } : { x: 0.4, y: 0.5, w: 0.9, h: 0.96, inherit: 0 }, travel);
}

/** a step row rises (the product's reveal), its meta 3 f after; the row above draws its spine down to meet it */
function rowIn(ctx: ActCtx, P: Prep, i: number, t: number): void {
  const film = ctx.film, f = (n: number): number => n / film.fps;
  const r = P.rows[i]!;
  film.tl.fromTo(r, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, t);
  const meta = r.querySelector<HTMLElement>('.ui-step__meta');
  if (meta) film.tl.fromTo(meta, { y: 4, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, t + f(3));
  const above = P.rows[i - 1];
  if (above) film.tl.fromTo(above, { '--sp': 0 }, { '--sp': 1, duration: f(10), ease: ui, immediateRender: false, data: { role: 'ui' } }, t - f(2));
}

/** B10: the failed test, the rollback, the climb, the pass; the thread keeps the newest row in view; the lamp cools */
export function b10(ctx: ActCtx, S: Stage3, P: Prep): void {
  const film = ctx.film, w = ctx.win('B10');
  const f = (n: number): number => n / film.fps;
  film.mark('B10', w.start);
  const T = [at('11.4'), at('12.1'), at('12.2'), at('12.3')];   /* 22.933, 23.467, 24.0, 24.533 */
  const climb = at('12.1.5');                                    /* 23.733 */
  const roll = (P as Prep & { roll: ReturnType<typeof roller> }).roll;
  T.forEach((t, j) => { rowIn(ctx, P, j + 2, t); roll.step(film, t, j + 3); });

  /* the thread keeps the newest row in view: 16:9 scrolls the log (the product's own follow, --dur-3 on --spring), so the
     last row sits above the composer; 9:16 lets the column grow and pushes Governance down under it */
  const logY = P.logY;
  if (!S.v) {
    const room = P.composerTop - 34;
    let cur = 0;
    T.forEach((t, j) => {
      const r = j === 1 ? j + 3 : j + 2;                 /* row 4 makes room for row 5's slot too: the rollback strip */
      const bottom = logY + P.rowY[r]! + P.rowH[r]! + cur;
      const want = Math.min(0, cur - Math.max(0, bottom - room));
      if (want !== cur) { film.tl.fromTo(S.log, { y: cur }, { y: want, duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, t); cur = want; }
    });
  } else {
    /* the section sits where B09's key frame puts it, under two rows; each new row pushes it down by what the row adds */
    const bottom = (j: number): number => P.rowY[j]! + P.rowH[j]!;
    let cur = 0;
    T.forEach((t, j) => { const want = bottom(j + 2) - bottom(1); film.tl.fromTo(S.gov, { y: cur }, { y: want, duration: 0.3, ease: uiSpring, immediateRender: false, data: { role: 'ui' } }, t); cur = want; });
  }

  /* the rollback: under the row, a strip of invoice.ts's lines; the two added lines fold back into the originals (12 f),
     then the strip folds up into the row before the next row lands */
  const [sx, sy, sw, sh] = P.stripAt;
  const strip = h('div', 'a3-strip', '', { left: sx + 'px', top: sy + 'px', width: sw + 'px', height: sh + 'px' });
  const pitch = (sh - 20) / 3.2;
  const lineY = [10, 10 + pitch, 10 + 2 * pitch, 10 + 3 * pitch];
  const kinds = ['o', 'a', 'a', 'o'], widths = [0.62, 0.74, 0.48, 0.56];
  const bars = kinds.map((kd, i) => { const b = h('i', kd, '', { left: '22px', top: lineY[i] + 'px', width: Math.round((sw - 44) * widths[i]!) + 'px' }); strip.appendChild(b); return b; });
  S.log.appendChild(strip);
  const sIn = T[1]! + f(5), fold = sIn + f(10), up = fold + f(13);
  film.tl.fromTo(strip, { clipPath: 'inset(0% 0% 100% 0% round 26px)', y: -6 }, { clipPath: 'inset(0% 0% 0% 0% round 26px)', y: 0, duration: f(10), ease: uiSpring, immediateRender: true, data: { role: 'ui' } }, sIn);
  film.tl.fromTo([bars[1]!, bars[2]!], { scaleY: 1, scaleX: 1 }, { scaleY: 0, scaleX: 0.6, duration: f(12), ease: travel, immediateRender: false, data: { role: 'ui' } }, fold);
  film.tl.fromTo(bars[3]!, { y: 0 }, { y: -2 * pitch, duration: f(12), ease: travel, immediateRender: false, data: { role: 'ui' } }, fold);
  film.tl.fromTo(strip, { height: sh }, { height: sh - 2 * pitch, duration: f(12), ease: travel, immediateRender: false, data: { role: 'ui' } }, fold);
  film.tl.to(strip, { clipPath: 'inset(0% 0% 100% 0% round 26px)', y: -10, duration: f(9), ease: travel, immediateRender: false, data: { role: 'ui' } }, up);

  /* the climb: the brass marker travels down the ladder's spine from Sol to Astra (travel 16 f), stretching on the way;
     Sol's station is past under it, Astra's is now where it lands; the names trade ink; the call number's second line
     slides out from under the first */
  const ms = P.markerSize;
  const marker = h('i', 'a3-marker', '', { left: (P.markerAt[0]![0] - ms / 2) + 'px', top: (P.markerAt[0]![1] - ms / 2) + 'px', width: ms + 'px', height: ms + 'px' });
  S.ladder.appendChild(marker);
  const dy = P.markerAt[1]![1] - P.markerAt[0]![1];
  film.tl.fromTo(marker, { y: 0 }, { y: dy, duration: f(16), ease: travel, immediateRender: true, data: { role: 'ui' } }, climb);
  film.tl.fromTo(marker, { scaleY: 1 }, { scaleY: 1.9, duration: f(8), ease: travel, immediateRender: true, data: { role: 'ui' } }, climb);
  film.tl.to(marker, { scaleY: 1, duration: f(8), ease: travel, immediateRender: false, data: { role: 'ui' } }, climb + f(8));
  film.tl.set(P.st[0]!, { immediateRender: false, attr: { 'data-s': 'past' } }, climb);
  film.tl.set(P.st[1]!, { immediateRender: false, attr: { 'data-s': 'now' } }, climb + f(16));
  film.tl.fromTo(P.names[0]!, { color: TOKENS.strong }, { color: TOKENS.dim, duration: 0.15, ease: ui, immediateRender: false, data: { role: 'ui' } }, climb + f(2));
  film.tl.fromTo(P.names[1]!, { color: TOKENS.dim }, { color: TOKENS.strong, duration: 0.15, ease: ui, immediateRender: false, data: { role: 'ui' } }, climb + f(12));
  const inner = h('span', '', '', { display: 'block' });
  while (P.call2.firstChild) inner.appendChild(P.call2.firstChild);
  P.call2.appendChild(inner);
  film.tl.fromTo(P.call2, { height: 0 }, { height: P.call2H, duration: f(16), ease: travel, immediateRender: true, data: { role: 'ui' } }, climb);
  film.tl.fromTo(inner, { yPercent: -100 }, { yPercent: 0, duration: f(16), ease: travel, immediateRender: true, data: { role: 'ui' } }, climb);

  /* the film line leaves (K1 exit) */
  lineOut(film, S.line9, at('12.4'));
  /* the camera holds here: B10 is the act's densest text and its events land every half beat, so they carry the motion
     (a slow drift across this much text reads, to the eye and to the checker, as a dissolve); the lamp cools toward the
     text's ink (the escalation) */
  S.rig.light.to(w.start, ctx.win('B11').start, { cool: 1, inherit: 0 }, travel);
}

/** the session's words become bars as the camera leaves them: each run collapses into its bar a few frames before it
    would draw under 28 px on screen (the scale the window has at that time decides when) */
export function sessionBars(ctx: ActCtx, P: Prep, scaleAt: (t: number) => number, from: number, to: number): void {
  const film = ctx.film, step = 1 / film.fps;
  const when = new Map<number, number>();
  const timeFor = (px: number): number => {
    const key = Math.round(px * 10);
    const have = when.get(key);
    if (have != null) return have;
    let t = from;
    for (; t < to; t += step) if (px * scaleAt(t + 12 * step) < 28.6) break;
    const start = Math.max(from - 18 * step, t - 2 * step);
    when.set(key, start);
    return start;
  };
  /* in reading order: the lines higher up go a few frames sooner (never later than the floor allows) */
  const ys = P.bars.map((b) => b.bar.getBoundingClientRect().top), y0 = Math.min(...ys), y1 = Math.max(...ys);
  collapse(film, P.bars, (b) => { const i = P.bars.indexOf(b); return timeFor(b.px) - (1 - (ys[i]! - y0) / Math.max(1, y1 - y0)) * 6 * step; }, { dur: 10 });
}
