/* A film orb: the product's orb (the vendored <orb-avatar>, orb2) drawn from a POSE, never from a clock.

   The kit's orb animates itself: a frame loop, springs integrated over the frame time, random blinks and glances, and in
   the app a worker. None of that can be seeked. A film orb asks orb2 for its geometry instead: one detached, never
   connected <orb-avatar> (a "probe": no loop, no observers, no worker) has its pose fields set and is asked for
   `toSVG()`, the element's own vector export. The answer (the body's outline and the eyes, projected on the body's
   hidden sphere exactly as the canvas draws them) is copied into this orb's SVG paths. So a pose is a pure function:
   the same pose always draws the same orb, whatever was drawn before, in whatever order frames are rendered.

   The pose (all numbers, so GSAP tweens them; see motion/orb-moves.ts):
     shapeMix   0..1 from look.shape to pose.shapeTo (orb2's own body interpolation)
     eyesMix    0..1 from pose.eyes to pose.eyesTo (orb2's own multi-cell face morph, `seqFace`)
     eyesVia, eyesViaMix   the morph's starting face is itself pose.eyes mixed toward eyesVia by eyesViaMix: a morph
                that starts while another is still under way takes over from where that one was, never from its end
     speak, speakT   0..1 toward orb2's speaking face, and the time on its speaking clock (s): bars whose heights move
                on orb2's cadence, circles on its slow cycle, each state held 0.7 s or more and morphed, never swapped
     yaw, pitch, roll   degrees: the gaze (the eyes travel on the body's sphere; the head follows by orb2's ratio)
     blink      0..1 (orb2's blink: the eyes morph to the closed "wide" slit)
     scale, squash, dx, dy   a transform on the drawn orb (squash > 0 is wider and lower)
     colorMix   0..1 from look.color to pose.colorTo (an opaque fill changing colour, never an opacity)

   On top of the pose, `life` (OrbLife) is what a character layer writes every frame (motion/character.ts): gaze,
   breath, float, blinks and speech as offsets, so an act's own pose tweens and the character's life compose. The orb
   draws `drawn()`: the pose plus its life.

   Size: `size` is the kit's orb size (the element's box). orb2 draws the body at 0.96 of it; so does this.
   orb2 is MIT licensed (apps/desktop/ui/vendor/orb-avatar.LICENSE, its notice kept there); `mixBody` below follows its body
   interpolation. */
import type { OrbAvatar } from '@ui/vendor/orb-avatar';
import { lookAttrs } from '@boopis/ui';

export type Pt = [number, number];
interface Cell { pts: Pt[]; c: Pt; fill: string; op?: number; noBlink?: boolean; key?: string }
interface Face { L: Cell[]; R: Cell[]; extras?: Cell[] }
interface Body {
  pts: Pt[]; spine: [number, number, number][]; slabH: number; coreR: number; camber: number; zHalf: number; taperY: number;
  ox: number; oy: number; poleX: number; poleY: number; rx: number; ry: number; fScale: number; floorY: number; isCircle: boolean; label: string;
}
interface Probe extends OrbAvatar {
  _bodyTo: Body; _bodyCur: Body; _eyaw: number; _epitch: number; _eroll: number; _hyaw: number; _hpitch: number; _bRoll: number;
  _curFace: Face; _pal: Record<string, string>; _face: number; _jx: number[]; _eyeShape: string;
}
interface Shapes { pairEyes(a: string, b?: string): Face; seqFace(t: number, steps: unknown[], morph?: number): Face }

export interface OrbLook { shape: string; color: string; eyeColor?: string | null }
export interface OrbPose {
  shapeTo: string; shapeMix: number;
  eyes: string; eyesTo: string; eyesMix: number;
  eyesVia: string; eyesViaMix: number;
  speak: number; speakT: number;
  yaw: number; pitch: number; roll: number;
  blink: number;
  scale: number; squash: number; dx: number; dy: number;
  colorTo: string; colorMix: number;
}

const BODY_SCALE = 0.48;   /* orb2: body radius 1 = canvas (1.54 x size) / 3.2 */
const DEG = Math.PI / 180;

let probe: Probe | null = null;
const shapes = (): Shapes => (window as unknown as { OrbAvatar: { shapes: Shapes } }).OrbAvatar.shapes;
function theProbe(): Probe {
  if (!probe) {
    if (!customElements.get('orb-avatar')) throw new Error('film orb: <orb-avatar> is not defined (import engine/kit.ts first)');
    probe = document.createElement('orb-avatar') as Probe;   /* upgraded at creation, never connected: no loop runs it */
    probe.setAttribute('static', '');
  }
  return probe;
}

const bodies = new Map<string, Body>();
function bodyOf(shape: string): Body {
  let b = bodies.get(shape);
  if (!b) {
    const p = theProbe();
    p.setAttribute('shape', shape);   /* not initialised and static: orb2 sets the target body at once */
    b = p._bodyTo;
    bodies.set(shape, b);
  }
  return b;
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** orb2's body interpolation (both bodies are resampled to the same point and spine counts) */
function mixBody(a: Body, b: Body, t: number): Body {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    pts: a.pts.map((p, i) => [lerp(p[0], b.pts[i]![0], t), lerp(p[1], b.pts[i]![1], t)] as Pt),
    spine: a.spine.map((s, i) => [lerp(s[0], b.spine[i]![0], t), lerp(s[1], b.spine[i]![1], t), lerp(s[2], b.spine[i]![2], t)] as [number, number, number]),
    slabH: lerp(a.slabH, b.slabH, t), coreR: lerp(a.coreR, b.coreR, t), camber: lerp(a.camber, b.camber, t), zHalf: lerp(a.zHalf, b.zHalf, t),
    taperY: lerp(a.taperY, b.taperY, t), ox: lerp(a.ox, b.ox, t), oy: lerp(a.oy, b.oy, t), poleX: lerp(a.poleX, b.poleX, t), poleY: lerp(a.poleY, b.poleY, t),
    rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t), fScale: lerp(a.fScale, b.fScale, t), floorY: lerp(a.floorY, b.floorY, t),
    isCircle: a.isCircle && b.isCircle, label: b.label
  };
}
const faces = new Map<string, Face>();
const faceOf = (eyes: string): Face => { let f = faces.get(eyes); if (!f) { f = shapes().pairEyes(eyes); faces.set(eyes, f); } return f; };
/** orb2's face morph between two eye shapes (its multi-cell morph, through the exported sequencer) */
const mixFace = (a: Face, b: Face, t: number): Face => (t <= 0 ? a : t >= 1 ? b : shapes().seqFace(t, [[-1, a], [0, b, 1]]));
function lerpCells(a: Cell[], b: Cell[], t: number): Cell[] | null {
  if (a.length !== b.length) return null;
  return a.map((c, i) => {
    if (c.noBlink) return c;
    const d = b[i]!;
    return { ...c, pts: c.pts.map((p, k) => [lerp(p[0], d.pts[k]![0], t), lerp(p[1], d.pts[k]![1], t)] as Pt) };
  });
}
/** orb2's blink: the eyes morph toward the closed slit ("wide") */
function blinkFace(f: Face, z: number): Face {
  if (z <= 0.0005) return f;
  const w = faceOf('wide');
  const L = lerpCells(f.L, w.L, z), R = lerpCells(f.R, w.R, z);
  if (L && R) return { L, R, extras: f.extras ?? [] };
  const m = mixFace(f, w, z);
  return { L: L ?? m.L, R: R ?? m.R, extras: f.extras ?? [] };
}

/* orb2's speaking face at time t on its clock (vendor orb-avatar, state "speaking"): two bars per eye whose heights
   follow sines at 9.5 rad/s, and for the last 32% of each 2.38 s cycle a pair of circles. orb2 switches between the two
   on the frame; here the switch is orb2's own face morph over 0.13 s (8 frames at 60), so every state holds 0.7 s or
   more and no frame shows half of one and half of the other in a flicker. */
const SPEAK_CYCLE = 1 / 0.42, SPEAK_CIRCLES = 0.68, SPEAK_MORPH = 0.13;
function speakBars(t: number): Face {
  const h = (ph: number): number => 0.22 + 0.22 * (0.5 + 0.5 * Math.sin(9.5 * t + ph));
  return shapes().pairEyes(['bars', { h1: h(0), h2: h(1.3) }] as unknown as string, ['bars', { h1: h(2.5), h2: h(0.6) }] as unknown as string);
}
function speakCircles(t: number): Face {
  const r = 0.148 + 0.024 * Math.sin(10.5 * t);
  return shapes().pairEyes(['circle', { r: r + 0.014 }] as unknown as string, ['circle', { r: r - 0.01 }] as unknown as string);
}
export function speakingFace(t: number): Face {
  const T = Math.max(0, t), ph = (T % SPEAK_CYCLE) / SPEAK_CYCLE, w = SPEAK_MORPH / SPEAK_CYCLE / 2;
  /* how far toward circles: 0 in the bars, 1 in the circles, a smoothstep across each switch */
  const ramp = (x: number): number => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
  let k: number;
  if (ph < 0.34) k = T < SPEAK_CYCLE * w ? 0 : 1 - ramp((ph + w) / (2 * w));      /* the end of the switch back to bars */
  else if (ph < 0.84) k = ramp((ph - (SPEAK_CIRCLES - w)) / (2 * w));             /* bars, then into the circles */
  else k = 1 - ramp((ph - (1 - w)) / (2 * w));                                   /* the circles, then back toward bars */
  return mixFace(speakBars(T), speakCircles(T), k);
}

/* colours: CSS colours (tokens included) resolved to rgb() once through a probe span */
const colourCache = new Map<string, [number, number, number]>();
function rgbOf(c: string): [number, number, number] {
  let v = colourCache.get(c);
  if (!v) {
    const s = document.createElement('span');
    s.style.color = c; s.style.display = 'none';
    document.body.appendChild(s);
    const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(s).color);
    s.remove();
    v = m ? [+m[1]!, +m[2]!, +m[3]!] : [241, 239, 233];
    colourCache.set(c, v);
  }
  return v;
}
export function mixColour(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  /* mix in linear light, so a colour change does not dip through a darker middle */
  const A = rgbOf(a), B = rgbOf(b);
  const lin = (u: number): number => { const x = u / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const enc = (x: number): number => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  const o = A.map((u, i) => enc(lerp(lin(u), lin(B[i]!), t)));
  return 'rgb(' + o.join(',') + ')';
}

export interface OrbGeometry { body: Pt[]; eyes: { pts: Pt[]; fill: string; op: number }[]; color: string }

const NUM = /-?\d+(?:\.\d+)?/g;
function parsePath(d: string): Pt[] {
  const n = (d.match(NUM) ?? []).map(Number), out: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  return out;
}

/** the geometry of an orb in a pose, in px around its centre (pure: the same arguments, the same answer) */
export function orbGeometry(look: OrbLook, pose: OrbPose, size: number): OrbGeometry {
  const p = theProbe();
  const body = mixBody(bodyOf(look.shape), bodyOf(pose.shapeTo || look.shape), pose.shapeMix);
  const start = pose.eyesVia && pose.eyesViaMix > 0 ? mixFace(faceOf(pose.eyes), faceOf(pose.eyesVia), pose.eyesViaMix) : faceOf(pose.eyes);
  const base = mixFace(start, faceOf(pose.eyesTo || pose.eyes), pose.eyesMix);
  const face = blinkFace(pose.speak > 0.0005 ? mixFace(base, speakingFace(pose.speakT), Math.min(1, pose.speak)) : base, pose.blink);
  const yaw = pose.yaw * DEG || 1e-6, pitch = pose.pitch * DEG || 1e-6;   /* orb2 reads 0 as "unset" */
  const head = lerp(bodyOf(look.shape).isCircle ? 0.68 : 0.54, bodyOf(pose.shapeTo || look.shape).isCircle ? 0.68 : 0.54, pose.shapeMix);
  const color = mixColour(look.color, pose.colorTo || look.color, pose.colorMix);
  const eye = look.eyeColor ?? '#141418';
  Object.assign(p, {
    _bodyCur: body, _eyaw: yaw, _epitch: pitch, _eroll: 0, _hyaw: yaw * head, _hpitch: pitch * head, _bRoll: 0,
    _curFace: face, _face: 1, _jx: [0, 0, 0, 0, 0, 0], _pal: { color, eye, blush: '#ff6f91', spark: '#ffe08a' }
  });
  const svg = p.toSVG({ size: 1 });
  const k = size * BODY_SCALE;
  const paths = [...svg.matchAll(/<path d="([^"]+)"(?: fill="([^"]*)")?(?: opacity="([\d.]+)")?\/>/g)];
  /* [0] is the clip path, [1] the body, the rest the eyes */
  const scale = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x * k, y * k]);
  const bodyPts = scale(parsePath(paths[1]?.[1] ?? paths[0]?.[1] ?? ''));
  const eyes = paths.slice(2).map((m) => ({ pts: scale(parsePath(m[1]!)), fill: m[2] ?? eye, op: m[3] ? +m[3] : 1 }));
  return { body: bodyPts, eyes, color };
}

export const ptsToD = (pts: Pt[]): string => {
  let d = '';
  for (let i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + pts[i]![0].toFixed(2) + ' ' + pts[i]![1].toFixed(2);
  return d + 'Z';
};

const SVGNS = 'http://www.w3.org/2000/svg';
let clipId = 0;
export const defaultPose = (o: Partial<OrbPose> = {}): OrbPose => ({
  shapeTo: '', shapeMix: 0, eyes: 'pill', eyesTo: '', eyesMix: 0, eyesVia: '', eyesViaMix: 0, speak: 0, speakT: 0, yaw: 8, pitch: 5, roll: 0, blink: 0,
  scale: 1, squash: 0, dx: 0, dy: 0, colorTo: '', colorMix: 0, ...o
});

/** what a character layer adds to a pose every frame (motion/character.ts): offsets that compose with the act's tweens */
export interface OrbLife {
  yaw: number; pitch: number; roll: number;   /* degrees, added */
  dx: number; dy: number; squash: number;     /* px and squash, added */
  scale: number;                              /* multiplied */
  blink: number;                              /* the larger of the pose's and this */
  speak: number; speakT: number;              /* when larger than the pose's, the face speaks on this clock */
}
export const noLife = (): OrbLife => ({ yaw: 0, pitch: 0, roll: 0, dx: 0, dy: 0, squash: 0, scale: 1, blink: 0, speak: 0, speakT: 0 });
/** a pose with a life on top: what the orb draws */
export function withLife(p: OrbPose, l: OrbLife): OrbPose {
  const speaks = l.speak > p.speak;
  return {
    ...p, yaw: p.yaw + l.yaw, pitch: p.pitch + l.pitch, roll: p.roll + l.roll, dx: p.dx + l.dx, dy: p.dy + l.dy,
    squash: p.squash + l.squash, scale: p.scale * l.scale, blink: Math.max(p.blink, l.blink),
    speak: speaks ? l.speak : p.speak, speakT: speaks ? l.speakT : p.speakT
  };
}

/** a film orb: an <svg> the size of the kit's orb box, drawn from `pose` (plus `life`) by `render()` */
export class FilmOrb {
  readonly el: SVGSVGElement;
  readonly pose: OrbPose;
  /** written every frame by a character layer (motion/character.ts); zero without one */
  readonly life: OrbLife = noLife();
  readonly look: OrbLook;
  readonly size: number;
  private readonly g: SVGGElement;
  private readonly bodyPath: SVGPathElement;
  private readonly clipPath: SVGPathElement;
  private readonly eyesG: SVGGElement;
  private sig = '';
  /** set to take over drawing (a morph into another shape draws the body itself) */
  hidden = false;

  constructor(look: OrbLook, size: number, pose: Partial<OrbPose> = {}) {
    const a = lookAttrs({ shape: look.shape, color: look.color });
    const eyeColor = look.eyeColor ?? (a['eye-color'] ? resolveVar(a['eye-color']) : null);
    this.look = { shape: a.shape, color: a.color, eyeColor };
    this.size = size;
    this.pose = defaultPose(pose);
    const id = 'film-orb-clip-' + ++clipId;
    const h = size / 2;
    this.el = document.createElementNS(SVGNS, 'svg');
    this.el.setAttribute('class', 'film-orb');
    this.el.setAttribute('viewBox', [-h, -h, size, size].join(' '));
    this.el.setAttribute('width', String(size));
    this.el.setAttribute('height', String(size));
    this.el.setAttribute('overflow', 'visible');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<defs><clipPath id="' + id + '"><path/></clipPath></defs><g class="film-orb__pose"><path class="film-orb__body"/><g class="film-orb__eyes" clip-path="url(#' + id + ')"></g></g>';
    this.g = this.el.querySelector('.film-orb__pose') as SVGGElement;
    this.bodyPath = this.el.querySelector('.film-orb__body') as SVGPathElement;
    this.clipPath = this.el.querySelector('clipPath path') as SVGPathElement;
    this.eyesG = this.el.querySelector('.film-orb__eyes') as SVGGElement;
    this.render();
  }

  /** the pose as drawn: the pose plus the life a character layer gives it */
  drawn(): OrbPose { return withLife(this.pose, this.life); }

  /** the geometry a pose draws (default: as drawn), in px around the orb's centre (before scale, squash and offsets) */
  geometry(pose: OrbPose = this.drawn()): OrbGeometry { return orbGeometry(this.look, pose, this.size); }

  /** the transform a pose puts on the drawn orb (default: as drawn) */
  transform(pose: OrbPose = this.drawn()): string {
    const sx = pose.scale * (1 + pose.squash * 0.5), sy = pose.scale * (1 - pose.squash);
    return 'translate(' + pose.dx.toFixed(3) + ' ' + pose.dy.toFixed(3) + ') rotate(' + pose.roll.toFixed(3) + ') scale(' + sx.toFixed(5) + ' ' + sy.toFixed(5) + ')';
  }

  /** draw the pose (a no-op when nothing in it changed) */
  render(): void {
    const p = this.drawn();
    const sig = [p.shapeTo, p.shapeMix, p.eyes, p.eyesTo, p.eyesMix, p.eyesVia, p.eyesViaMix, p.speak, p.speakT, p.yaw, p.pitch, p.roll, p.blink, p.scale, p.squash, p.dx, p.dy, p.colorTo, p.colorMix, this.hidden].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.g.style.display = this.hidden ? 'none' : '';
    if (this.hidden) return;
    const geo = this.geometry(p);
    const d = ptsToD(geo.body);
    this.bodyPath.setAttribute('d', d);
    this.bodyPath.setAttribute('fill', geo.color);
    this.clipPath.setAttribute('d', d);
    const kids = this.eyesG.children;
    for (let i = 0; i < geo.eyes.length; i++) {
      let path = kids[i] as SVGPathElement | undefined;
      if (!path) { path = document.createElementNS(SVGNS, 'path'); this.eyesG.appendChild(path); }
      const e = geo.eyes[i]!;
      path.setAttribute('d', ptsToD(e.pts));
      path.setAttribute('fill', e.fill);
      if (e.op < 0.999) path.setAttribute('opacity', e.op.toFixed(3)); else path.removeAttribute('opacity');
    }
    while (this.eyesG.children.length > geo.eyes.length) this.eyesG.lastElementChild?.remove();
    this.g.setAttribute('transform', this.transform(p));
  }
}

function resolveVar(v: string): string {
  const s = document.createElement('span');
  s.style.color = v; s.style.display = 'none';
  document.body.appendChild(s);
  const c = getComputedStyle(s).color;
  s.remove();
  return c || '#141418';
}
