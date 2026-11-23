/* Deterministic time. A film is one paused GSAP master timeline plus a list of renderers (pure functions of t that draw
   what GSAP cannot set directly: orbs from their pose, morphing paths, the camera, the grain). Seeking is the only way
   time moves: `seek(t)` puts the timeline at t, runs every renderer, and resolves once fonts and images are ready and
   the frame is painted. Nothing reads a clock: no Date.now, no performance.now, no requestAnimationFrame-driven motion,
   no CSS transitions (engine/kit.ts turns them off). The one rAF in this file waits for the paint after a seek; it
   moves nothing.

   The page exposes `window.__film = { duration, fps, seek(t), ... }` for the renderer (tools/render.mjs) and the craft
   checker (tools/qa/qa.mjs). */
import { gsap } from 'gsap';
import { cancelScriptAnimations, decodeImages, loadAllFonts } from './kit';

export type Variant = 'landscape' | 'vertical';
export interface FilmConfig {
  name: string;
  /** seconds */
  duration: number;
  fps?: number;
  /** the music's tempo; the craft bible's grid is 112.5 BPM (32 frames a beat at 60 fps) */
  bpm?: number;
  /** where this clip starts on the film's absolute clock: an act rendered alone writes at the script's absolute times,
      and its frame 0 is `offset` (seek(t) shows absolute time offset + t) */
  offset?: number;
}
export type Renderer = (t: number) => void;
/** white: white at alpha u x alpha (the engine's ground); look: the art director's grain, mid-grey noise of +-amp in
    soft-light at `opacity` (look/src/stage.ts) */
export interface GrainSpec { kind?: 'white' | 'look'; seed: number; alpha?: number; opacity?: number; amp?: number }

/** a tween tagged `data: { blur: false }` is motion that needs no motion blur (a slow drift, typing); `samples` asks for
    more sub-frames than the default 8 while it runs (a whip or a zoom-through: 24 to 32, so the streak does not step) */
export interface TweenData { blur?: boolean; linear?: boolean; role?: string; samples?: number }

export interface TweenInfo {
  start: number; end: number; ease: string; linear: boolean; linearOk: boolean; blur: boolean;
  props: string[]; targets: string[]; role: string | null;
}

export class Film {
  readonly name: string;
  readonly duration: number;
  /** the clip's start on the absolute clock (FilmConfig.offset); the timeline and renderers always see absolute time */
  readonly offset: number;
  readonly fps: number;
  readonly bpm: number;
  readonly variant: Variant;
  readonly width: number;
  readonly height: number;
  readonly tl: gsap.core.Timeline;
  readonly cuts: number[] = [];
  /** scene boundaries by name (a script beat's id at its start): the checker counts and lists them */
  readonly marks: { name: string; t: number }[] = [];
  private readonly renderers: { fn: Renderer; priority: number; order: number }[] = [];
  private readonly extraMotion: [number, number, number][] = [];
  private motionSpans: [number, number, number][] = [];
  private finalized = false;
  private time = -1;
  private lastAbs = -1;
  ready: Promise<void> = Promise.resolve();
  /** the ground's grain, which the renderer adds to finished frames (engine/ground.ts, engine/look.ts) */
  grain: GrainSpec | null = null;
  /** build-time warnings (a mounted component whose text lands under the 28 px floor); the checker lists them */
  readonly warnings: string[] = [];

  constructor(cfg: FilmConfig, variant: Variant) {
    this.name = cfg.name;
    this.duration = cfg.duration;
    this.offset = cfg.offset ?? 0;
    this.fps = cfg.fps ?? 60;
    this.bpm = cfg.bpm ?? 112.5;
    this.variant = variant;
    this.width = variant === 'vertical' ? 1080 : 1920;
    this.height = variant === 'vertical' ? 1920 : 1080;
    gsap.ticker.lagSmoothing(0);
    gsap.config({ autoSleep: 60, force3D: false, nullTargetWarn: false });
    this.tl = gsap.timeline({ paused: true, defaults: { immediateRender: true, overwrite: false } });
  }

  /** draw something that GSAP does not set directly, on every seek: it must be a pure function of t. Lower priorities
      run first (-10: decide what is shown; 0: draw; 10: the camera) */
  onRender(fn: Renderer, priority = 0): void {
    this.renderers.push({ fn, priority, order: this.renderers.length });
    this.renderers.sort((a, b) => a.priority - b.priority || a.order - b.order);
  }
  /** a scene boundary: where one idea hands off to the next (a beat of the script) */
  mark(name: string, t: number): void { this.marks.push({ name, t }); this.marks.sort((a, b) => a.t - b.t); }
  /** a hard cut at t: motion blur never mixes samples across it */
  cut(t: number): void { if (this.cuts.some((c) => Math.abs(c - t) < 1e-6)) return; this.cuts.push(t); this.cuts.sort((a, b) => a - b); }
  /** motion that GSAP does not know about (a renderer that moves things between t0 and t1); `samples` as in TweenData */
  motion(t0: number, t1: number, samples = 0): void { this.extraMotion.push([t0, t1, samples]); }

  /** every tween in the master timeline, with its global times */
  tweens(): { tween: gsap.core.Tween; start: number; end: number }[] {
    const out: { tween: gsap.core.Tween; start: number; end: number }[] = [];
    const walk = (tl: gsap.core.Timeline, offset: number, scale: number): void => {
      for (const c of tl.getChildren(false, true, true)) {
        const s = offset + c.startTime() / scale;
        if (c instanceof gsap.core.Timeline) walk(c, s, scale * c.timeScale());
        else out.push({ tween: c as gsap.core.Tween, start: s, end: s + (c.totalDuration() / c.timeScale()) / scale });
      }
    };
    walk(this.tl, 0, 1);
    return out;
  }

  /** after the scene is built: record every tween's start values in time order, and index the motion */
  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    if (this.tl.duration() < this.offset + this.duration) this.tl.set({}, {}, this.offset + this.duration);
    /* sweep: render the whole timeline forward and back once, so every tween records its start values in time order
       (GSAP records a tween's start the first time it renders; without the sweep a worker that seeks straight to the
       middle could record different ones) */
    this.tl.progress(1, true).progress(0, true);
    const spans: [number, number, number][] = [...this.extraMotion];
    for (const { tween, start, end } of this.tweens()) {
      const d = (tween.data ?? {}) as TweenData;
      if (d.blur === false || end - start <= 0) continue;
      spans.push([start, end, d.samples ?? 0]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    this.motionSpans = spans;
    gsap.ticker.sleep();
  }

  /** does anything that needs motion blur move between t0 and t1 (clip time)? (the renderer skips samples when not) */
  moving(t0: number, t1: number): boolean { return this.samples(t0, t1) !== 0; }
  /** the sub-frames motion in (t0, t1) (clip time) asks for: 0 = nothing moves, -1 = the default, n = at least n */
  samples(c0: number, c1: number): number {
    const t0 = c0 + this.offset, t1 = c1 + this.offset;
    let n = 0;
    for (const [a, b, k] of this.motionSpans) {
      if (a >= t1) break;
      if (b > t0) n = k > 0 ? Math.max(n, k) : n === 0 ? -1 : n;
    }
    return n;
  }

  /** put the film at clip time t (absolute offset + t) and draw it; resolves once fonts and images are ready and the
      frame is painted */
  async seek(t: number, o: { paint?: boolean } = {}): Promise<void> {
    if (!this.finalized) this.finalize();
    const time = Math.max(0, Math.min(this.duration, t));
    this.time = time;
    const abs = this.offset + time;
    /* never render the timeline backward: where two tweens overlap on one property, GSAP's backward render lets the
       earlier one win and its forward render the later one, so the same time could draw two different frames. A seek
       back goes to 0 and forward again: every frame is the forward state, whatever was drawn before it. */
    if (abs < this.lastAbs - 1e-9) this.tl.time(0, true);
    this.tl.time(abs, true);
    this.lastAbs = abs;
    for (const r of this.renderers) r.fn(abs);
    cancelScriptAnimations();
    await this.ready;
    if (o.paint !== false) await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  /** clip time of the last seek */
  get now(): number { return this.time; }
  /** hard cuts in clip time */
  clipCuts(): number[] { return this.cuts.map((c) => c - this.offset).filter((c) => c > 0 && c < this.duration); }

  /** fonts and images, once, before the first frame */
  async load(root: ParentNode): Promise<void> {
    this.ready = (async () => { await loadAllFonts(); await decodeImages(root); })();
    await this.ready;
  }

  /** the timeline as data, for the craft checker (linear easing, full-layer fades) */
  tweenInfo(): TweenInfo[] {
    return this.tweens().map(({ tween, start, end }) => {
      const v = tween.vars as Record<string, unknown>;
      const e = v['ease'];
      const name = typeof e === 'string' ? e : typeof e === 'function' ? ((e as { easeName?: string }).easeName ?? 'custom') : 'default (power1.out)';
      const d = (tween.data ?? {}) as TweenData;
      const linear = /^(none|linear|power0)/i.test(name);
      const targets = (tween.targets() as unknown[]).map(describe);
      const props = Object.keys(v).filter((k) => !SPECIAL.has(k));
      return { start, end, ease: name, linear, linearOk: !!d.linear, blur: d.blur !== false, props, targets, role: d.role ?? null };
    });
  }
}

const SPECIAL = new Set(['ease', 'duration', 'delay', 'data', 'immediateRender', 'overwrite', 'onUpdate', 'onComplete', 'onStart', 'stagger', 'startAt', 'runBackwards', 'id', 'lazy', 'keyframes', 'callbackScope', 'paused', 'repeat', 'yoyo', 'repeatDelay']);
function describe(t: unknown): string {
  if (t instanceof Element) {
    const id = t.id ? '#' + t.id : '';
    const cls = typeof t.className === 'string' && t.className ? '.' + t.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return t.tagName.toLowerCase() + id + cls;
  }
  if (t && typeof t === 'object') return (t as { __name?: string }).__name ?? 'object';
  return String(t);
}
