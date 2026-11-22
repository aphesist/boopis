/* B17 to B19: the tagline, nina's eyes becoming the wordmark, the end card (variant b). Built from the art director's
   key frames b17 and b19b (look/src/scenes/close.ts), which live in the frame's own layer: from the tagline on, what
   is on screen does not move with the camera, so the wordmark lands exactly where the end card sets it while the world
   behind it (the desktop, out of focus) falls away below.

     B17  T7: the desktop blurs to 24 px and darkens 10% while nina lifts off the session head and comes to the middle of
          the lower third (her orb redrawn at every size: a vector); "Your AI plans, on one team" rises above her (K1)
     B18  her body shrinks behind her eyes, her eyes morph into the logo's two ovals and turn light, the letters play in
          (logo.ts); the camera rises, so the blurred desktop leaves the frame and the lamp opens into an even field
     B19  the two lines rise under the wordmark (K1), well below its protection area; the eyes glance once and blink;
          the frame drifts; the last frame is the end card at rest, the family of frame 0

   In a cut-down (cutdowns.md C5, D2) B18 opens from the beat before it instead: the camera pushes into nina where that
   beat's key frame has her (the folded stack, or the hook's pair) and the same morph follows. */
import type { ActCtx } from '../context';
import { swapOrbs, type SwappedOrb } from '../../engine/look';
import { FilmOrb, defaultPose, orbGeometry, type Pt } from '../../engine/orb';
import { blink, glance } from '../../motion/orb-moves';
import { springEase, springDuration } from '../../motion/spring';
import { depart, travel } from '../../motion/ease';
import { deskSet } from './desk';
import { lineUnits, lineExit, softRise } from './type';
import { eyeBlink, eyeGlance, eyesToWordmark, wordmark, type LogoBox, type Source, type Wordmark } from './logo';
import { lerp, onlyIn, prog, screenLayer, uiEase } from './util';

const NINA = '#f23b5a';

interface CloseState {
  /** B17's nina, handed to B18: her orb and where she rests (frame px), and the pose she holds at the hand-off */
  nina?: { orb: FilmOrb; x: number; y: number; size: number; pose: Partial<ReturnType<typeof defaultPose>>; shadow: (s: number, x: number) => void };
  end?: Promise<{ kf: HTMLElement; box: LogoBox }>;
  wm?: Wordmark;
}
const states = new WeakMap<ActCtx, CloseState>();
const stateOf = (ctx: ActCtx): CloseState => { let s = states.get(ctx); if (!s) { s = {}; states.set(ctx, s); } return s; };

/** the end card's key frame (b19b) in the frame's layer; its <boopis-logo> stays for layout, hidden: the wordmark is
    drawn in its place from the film's clock */
function endCard(ctx: ActCtx): Promise<{ kf: HTMLElement; box: LogoBox }> {
  const cs = stateOf(ctx);
  if (!cs.end) cs.end = (async () => {
    const scr = screenLayer(ctx.film, ctx.stage);
    const kf = await ctx.keyFrame('b19b', { swapOrbs: false });
    scr.el.appendChild(kf);
    kf.style.left = '0px'; kf.style.top = '0px';
    const logo = kf.querySelector<HTMLElement>('boopis-logo')!;
    logo.style.visibility = 'hidden';
    const host = ctx.stage.root.getBoundingClientRect().width / ctx.stage.width;
    const r = logo.getBoundingClientRect(), f = kf.getBoundingClientRect();
    return { kf, box: { x: (r.left - f.left) / host, y: (r.top - f.top) / host, s: r.width / host / 3091 } };
  })();
  return cs.end;
}

/* ───────── B17: the tagline ───────── */
export async function b17(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B17')) return;
  const { film, g, cam, stage } = ctx;
  const V = ctx.variant === 'vertical';
  const w = ctx.win('B17'), b = (n: number): number => w.start + g.beats(n);
  film.mark('B17', w.start);
  const desk = await deskSet(ctx);
  const scr = screenLayer(film, stage);
  const kf = await ctx.keyFrame('b17', { swapOrbs: false });
  scr.el.appendChild(kf);
  kf.style.left = '0px'; kf.style.top = '0px';
  (kf.querySelector('.win') as HTMLElement).style.display = 'none';   /* the real desktop, blurred, is the ground */
  const nina = swapOrbs(film, kf).get('nina') as SwappedOrb;
  const wrap = nina.holder.closest('.orb') as HTMLElement;
  delete wrap.dataset['shadow'];
  const host = stage.root.getBoundingClientRect().width / stage.width;
  const wr = wrap.getBoundingClientRect(), fr = kf.getBoundingClientRect();
  const S = wr.width / host, cx = (wr.left - fr.left) / host + S / 2, cy = (wr.top - fr.top) / host + S / 2;
  /* her contact shadow, as the look draws it (film.css .orb[data-shadow]::after), so it can grow as she lifts off */
  const shadow = document.createElement('div');
  shadow.className = 'a4-contact';
  shadow.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:100px;border-radius:50%;background:radial-gradient(closest-side, var(--contact), transparent);transform-origin:0 0';
  scr.el.insertBefore(shadow, kf);
  onlyIn(film, kf, w.start, ctx.win('B18').start);

  /* the hand-off: the session head's orb becomes this one, where it is on the frame at the beat's first frame */
  const T0 = w.start;
  const st = cam.stateAt(T0);
  const [hx, hy] = cam.project(desk.head.x, desk.head.y, 1, st);
  const hs = desk.head.size * st.zoom;
  onlyIn(film, desk.headOrb.holder, -Infinity, T0, { from: T0 });
  Object.assign(nina.orb.pose, { eyes: 'arc', eyesTo: '', eyesMix: 0, yaw: -6, pitch: 8 });
  const lift = prog(film, T0, g.f(32), travel, 'nina-lift');
  /* before the morph she floats up to the wordmark's line (her eyes onto the o's), off the table: her shadow stays on
     it and draws in */
  const { box } = await endCard(ctx);
  const restPose = { eyes: 'arc', eyesTo: '', eyesMix: 0, yaw: 0, pitch: 0, blink: 0, squash: 0, scale: 1 };
  const g0 = orbGeometry(nina.orb.look, defaultPose(restPose), S);
  const eyeY = g0.eyes.filter((e) => e.op >= 0.99).flatMap((e) => e.pts).reduce((a, p, _i, arr) => a + p[1] / arr.length, 0);
  const lineY = box.y + (742 - 265) * box.s;          /* the logo's eyes' middle, in frame px */
  const upY = lineY - eyeY;
  const T1 = ctx.has('B18') ? ctx.win('B18').start : w.end;
  const up = prog(film, T1 - g.beats(0.5), g.beats(0.5), travel, 'nina-up');
  wrap.style.transformOrigin = '50% 50%';
  const shadowAt = (x: number, size: number, k: number, y: number): void => {
    const sw = size * 0.78 * k, sh = size * 0.13 * k;
    if (sw < 0.5) { shadow.style.visibility = 'hidden'; return; }
    shadow.style.visibility = '';
    shadow.style.transform = 'translate(' + (x - sw / 2).toFixed(2) + 'px,' + (y - sh / 2).toFixed(2) + 'px) scale(' + (sw / 100).toFixed(4) + ',' + (sh / 100).toFixed(4) + ')';
    shadow.style.filter = 'blur(' + (size * 0.025 * 100 / Math.max(1, sw)).toFixed(2) + 'px)';
  };
  film.onRender((t) => {
    if (t >= T1) return;   /* from the hand-off the wordmark's rig draws her shadow (B18) */
    const k = lift.k, bend = Math.sin(Math.PI * k) * 0.08;
    const x = lerp(hx, cx, k) + (cy - hy) * bend, y = lerp(hy, cy, k) - (cx - hx) * bend * 0.4 + (upY - cy) * up.k;
    const size = Math.exp(lerp(Math.log(hs), Math.log(S), k));
    wrap.style.transform = 'translate(' + (x - cx).toFixed(2) + 'px,' + (y - cy).toFixed(2) + 'px) scale(' + (size / S).toFixed(5) + ')';
    shadowAt(x, size, k * (1 - 0.35 * up.k), lerp(hy, cy, k) + size * 0.65);
  });
  onlyIn(film, shadow, T0, Infinity);
  /* a small hop of joy as she lands, then she looks up at the line, blinks, and turns back to you for the morph */
  const o = nina.orb;
  film.tl.fromTo(o.pose, { squash: 0 }, { squash: -0.08, duration: g.f(6), ease: travel, immediateRender: false, data: { role: 'orb' } }, T0 + g.f(26));
  film.tl.to(o.pose, { squash: 0, duration: springDuration('character'), ease: springEase('character'), immediateRender: false, data: { role: 'orb' } }, T0 + g.f(32));
  glance(film, o, b(1.15), 0, 16);
  /* mid-line, a small hop of joy: a crouch, up, and a squash on landing (her face's own spring) */
  const hop = b(2.9);
  film.tl.fromTo(o.pose, { squash: 0 }, { squash: 0.1, duration: g.f(5), ease: travel, immediateRender: false, data: { role: 'orb' } }, hop);
  film.tl.fromTo(o.pose, { dy: 0 }, { dy: -S * 0.07, duration: g.f(10), ease: uiEase, immediateRender: false, data: { role: 'orb' } }, hop + g.f(5));
  film.tl.to(o.pose, { squash: -0.06, duration: g.f(10), ease: uiEase, immediateRender: false, data: { role: 'orb' } }, hop + g.f(5));
  film.tl.to(o.pose, { dy: 0, duration: g.f(9), ease: depart, immediateRender: false, data: { role: 'orb' } }, hop + g.f(15));
  film.tl.to(o.pose, { squash: 0.09, duration: g.f(9), ease: depart, immediateRender: false, data: { role: 'orb' } }, hop + g.f(15));
  film.tl.to(o.pose, { squash: 0, duration: springDuration('character'), ease: springEase('character'), immediateRender: false, data: { role: 'orb' } }, hop + g.f(24));
  blink(film, o, b(3.9));
  glance(film, o, b(3.5), 0, 0);
  stateOf(ctx).nina = { orb: o, x: cx, y: upY, size: S, pose: restPose, shadow: (s, x) => shadowAt(x, S, 0.65 * s, cy + S * 0.65) };

  /* T7: everything but nina loses focus (24 px on screen, through the camera's zoom) and darkens 10%; one layer is
     always opaque, the blurred desktop becomes the ground; it keeps receding while the line holds */
  const pull = prog(film, T0, g.f(32), travel, 'focus-pull');
  const deskBox = desk.box;
  film.onRender((t) => {
    if (t < T0 - 1e-9) { if (deskBox.style.filter) deskBox.style.filter = ''; return; }
    const z = Math.exp(cam.state.lz);
    deskBox.style.filter = 'blur(' + (24 * pull.k / z).toFixed(2) + 'px) brightness(' + (1 - 0.12 * pull.k).toFixed(4) + ')';
  }, 1);
  /* the camera pushes into her, landing with the focus pull */
  const m = desk.medium, Z1 = m.zoom * 1.22;
  cam.to({ x: lerp(m.x, desk.head.x, 0.45), y: lerp(m.y, desk.head.y, 0.45), zoom: Z1 }, { at: T0, dur: g.f(32), ease: travel });
  /* then the blurred ground holds still (a drift would crawl its soft shapes, which reads as a dissolve); nina and the
     line carry the motion */

  /* the tagline rises above her (K1, "team" in the selection), holds, and leaves before the eyes turn */
  const line = kf.querySelector('.film-line') as HTMLElement;
  softRise(film, lineUnits(line), b(1));
  lineExit(film, line, b(4.25));
  void V;
}

/* ───────── B18: the eyes become the wordmark ───────── */
export async function b18(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B18')) return;
  const { film, g, cam, stage } = ctx;
  const V = ctx.variant === 'vertical';
  const w = ctx.win('B18');
  film.mark('B18', w.start);
  const cs = stateOf(ctx);
  const scr = screenLayer(film, stage);
  const { box } = await endCard(ctx);
  const wm = wordmark(scr.el, box, stage.width, stage.height);
  cs.wm = wm;
  let src: Source, T1: number, morph = 0.4, lettersAt: number, morphAt = 0, riseAt = 0, riseDur = 1.2;
  let behind: HTMLElement[] = [];

  if (cs.nina) {
    /* the master: B17's nina, at rest in the lower third, her face back to you */
    const n = cs.nina;
    const geo = orbGeometry(n.orb.look, defaultPose(n.pose), n.size);
    src = sourceOf(geo, n.x, n.y, n.size, n.orb.look.eyeColor ?? '#141418');
    src.onBody = (k, x) => n.shadow(k, x);
    T1 = w.start; morphAt = T1; riseAt = T1 + g.f(4);
    lettersAt = w.start + g.beats(0.5);
    behind = [(await deskSet(ctx)).box];
  } else {
    /* a cut-down: push into nina where the beat before this one has her */
    const prev = ctx.edit.windows[ctx.edit.windows.findIndex((x) => x.beat === 'B18') - 1];
    const pk = prev ? await ctx.keyFrame(prev.beat.toLowerCase()) : null;
    const host = stage.root.getBoundingClientRect().width / stage.width;
    const holders = pk ? [...pk.querySelectorAll<HTMLElement>('.film-orb-holder')].filter((h) => (h.querySelector('.film-orb__body')?.getAttribute('fill') ?? '').toLowerCase() === NINA) : [];
    const sr = stage.root.getBoundingClientRect();
    const rects = holders.map((h) => { const r = h.getBoundingClientRect(); return { h, x: (r.left - sr.left) / host, y: (r.top - sr.top) / host, s: r.width / host }; }).sort((a, b2) => b2.s - a.s);
    const hook = prev?.beat === 'B01';
    const r = rects[0] ?? { h: null, x: stage.width / 2 - 130, y: stage.height / 2 - 130, s: 260 };
    const nx = r.x + r.s / 2, ny = r.y + r.s / 2;
    /* our nina in the key frame's own holder, over its orb, in the same look and pose (a still face looking out: the
       stack's orbs, or the hook's pair turned to camera), so the stack keeps its order and the layout does not move */
    const pose = hook ? { eyes: 'pill', yaw: 0, pitch: 0 } : { eyes: 'pill', yaw: 8, pitch: 5 };
    const own = r.h ? parseFloat(r.h.style.width) || r.s : r.s;
    const orb = new FilmOrb({ shape: 'triangle', color: NINA }, Math.max(8, Math.round(own)), pose);
    (orb.el as unknown as HTMLElement).style.cssText = 'position:absolute;left:0;top:0';
    let holder: HTMLElement;
    if (r.h) {
      holder = orb.el as unknown as HTMLElement;
      r.h.appendChild(orb.el);
      const was = r.h.firstElementChild as HTMLElement;
      onlyIn(film, was, -Infinity, w.start, { from: w.start });
    } else {
      holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;line-height:0;left:' + (nx - orb.size / 2) + 'px;top:' + (ny - orb.size / 2) + 'px;width:' + orb.size + 'px;height:' + orb.size + 'px';
      holder.appendChild(orb.el);
      ctx.world.appendChild(holder);
    }
    film.onRender(() => orb.render());
    /* the push: her size on the frame (the hook's kai leaves the frame to the left by the scale) */
    const target = V ? (hook ? 700 : 380) : (hook ? 680 : 360);
    const Zp = target / r.s;
    const fy = box.y + 477 * box.s + 0.1 * target;   /* her eyes about on the wordmark's line */
    const push = hook ? 0.45 : 0.55;
    cam.to({ x: nx, y: ny - (fy - stage.height / 2) / Zp, zoom: Zp }, { at: w.start, dur: push, ease: springEase('camera', push) });
    if (pk) {
      onlyIn(film, pk, w.start, Infinity, { from: w.start });
      for (const l of pk.querySelectorAll<HTMLElement>('.film-line')) lineExit(film, l, w.start + g.f(hook ? 8 : 2));
      behind = [pk];
    }
    T1 = w.start + push;
    const st = cam.stateAt(T1);
    const [sx, sy] = cam.project(nx, ny, 1, st);
    const size = r.s * st.zoom;
    onlyIn(film, holder, -Infinity, T1);
    const geo = orbGeometry(orb.look, defaultPose(pose), size);
    src = sourceOf(geo, sx, sy, size, orb.look.eyeColor ?? '#141418');
    morph = 0.36;
    /* out of the stack, the others fall away first and she is alone for a moment; the hook has nobody left in frame */
    morphAt = hook ? T1 : T1 + 0.3;
    riseDur = hook ? 1.2 : 0.55;
    riseAt = hook ? T1 + g.f(4) : T1;
    lettersAt = morphAt + g.f(8);
  }

  onlyIn(film, wm.svg as unknown as HTMLElement, T1, Infinity);
  eyesToWordmark(film, wm, src, { at: morphAt, morph, shrink: morph + 0.05, letters: lettersAt, until: w.end + 4 });

  /* the camera rises: the world behind (the blurred desktop, or the beat before) falls away below the frame */
  const st = cam.stateAt(riseAt), rise = riseDur;
  cam.to({ y: st.y - (stage.height * 1.25) / st.zoom }, { at: riseAt, dur: rise, ease: travel });
  for (const el of behind) onlyIn(film, el, -Infinity, riseAt + rise, { from: T1 });
  /* the frame breathes once the word has landed (1.5% a second, look.md section 8) */
}

function sourceOf(geo: ReturnType<typeof orbGeometry>, x: number, y: number, size: number, eyeInk: string): Source {
  const eyes = geo.eyes.filter((e) => e.op >= 0.99).map((e) => e.pts).sort((a, b) => a.reduce((s, p) => s + p[0], 0) / a.length - b.reduce((s, p) => s + p[0], 0) / b.length);
  return { x, y, size, body: geo.body as Pt[], eyes: eyes.slice(0, 2) as Pt[][], color: geo.color, eyeInk };
}

/* ───────── B19: the end card, variant (b) ───────── */
export async function b19(ctx: ActCtx): Promise<void> {
  if (!ctx.has('B19')) return;
  const { film, g, stage } = ctx;
  const w = ctx.win('B19');
  film.mark('B19', w.start);
  const cs = stateOf(ctx);
  const { kf, box } = await endCard(ctx);
  const scr = screenLayer(film, stage);
  onlyIn(film, kf, w.start, Infinity);
  let wm = cs.wm;
  if (!wm) { wm = wordmark(scr.el, box, stage.width, stage.height); onlyIn(film, wm.svg as unknown as HTMLElement, w.start, Infinity); }
  /* the two lines rise under the wordmark (K1), the tagline first */
  const [tag, plat] = [...kf.querySelectorAll<HTMLElement>('p')];
  if (tag) softRise(film, lineUnits(tag), w.start);
  if (plat) softRise(film, lineUnits(plat), w.start + g.f(5), { stagger: 3 / 60 });
  /* the live eyes: one glance (with the blink a glance brings) and one blink; in the bumper the cut lands on the blink */
  const d = w.dur, bumper = ctx.edit.id === 'bumper6';
  const gAt = w.start + (ctx.edit.id === 'master' ? g.beats(3) : d * 0.42);
  eyeGlance(film, wm, gAt, 0.7, 0.35, gAt + Math.min(0.75, d * 0.3));
  eyeBlink(film, wm, gAt + g.f(2));
  eyeBlink(film, wm, bumper ? w.end - 0.0775 - 1 / 60 : w.start + (ctx.edit.id === 'master' ? g.beats(5) : d * 0.8));
  /* the frame drifts (1.5% a second) from the moment the word has landed to the last frame */
  const from = ctx.has('B18') ? ctx.win('B18').end - g.beats(1) : w.start;
  film.tl.fromTo(scr.drift, { s: 1 }, { s: 1 + 0.015 * (w.end - from), duration: w.end - from, ease: travel, data: { role: 'drift', blur: false } }, from);
}
