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
}
export type Renderer = (t: number) => void;

/** a tween or timeline tagged `data: { blur: false }` is motion that needs no motion blur (a slow drift, the grain) */
export interface TweenData { blur?: boolean; linear?: boolean; role?: string }

export interface TweenInfo {
  start: number; end: number; ease: string; linear: boolean; linearOk: boolean; blur: boolean;
  props: string[]; targets: string[]; role: string | null;
}

export class Film {
  readonly name: string;
  readonly duration: number;
  readonly fps: number;
  readonly bpm: number;
  readonly variant: Variant;
  readonly width: number;
  readonly height: number;
  readonly tl: gsap.core.Timeline;
  readonly cuts: number[] = [];
  private readonly renderers: Renderer[] = [];
  private readonly extraMotion: [number, number][] = [];
  private motionSpans: [number, number][] = [];
  private finalized = false;
  private time = -1;
  ready: Promise<void> = Promise.resolve();

  constructor(cfg: FilmConfig, variant: Variant) {
    this.name = cfg.name;
    this.duration = cfg.duration;
    this.fps = cfg.fps ?? 60;
    this.bpm = cfg.bpm ?? 112.5;
    this.variant = variant;
    this.width = variant === 'vertical' ? 1080 : 1920;
    this.height = variant === 'vertical' ? 1920 : 1080;
    gsap.ticker.lagSmoothing(0);
    gsap.config({ autoSleep: 60, force3D: false, nullTargetWarn: false });
    this.tl = gsap.timeline({ paused: true, defaults: { immediateRender: true, overwrite: false } });
  }

  /** draw something that GSAP does not set directly, on every seek: it must be a pure function of t */
  onRender(fn: Renderer): void { this.renderers.push(fn); }
  /** a hard cut at t: motion blur never mixes samples across it */
  cut(t: number): void { this.cuts.push(t); this.cuts.sort((a, b) => a - b); }
  /** motion that GSAP does not know about (a renderer that moves things between t0 and t1) */
  motion(t0: number, t1: number): void { this.extraMotion.push([t0, t1]); }

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
    if (this.tl.duration() < this.duration) this.tl.set({}, {}, this.duration);
    /* sweep: render the whole timeline forward and back once, so every tween records its start values in time order
       (GSAP records a tween's start the first time it renders; without the sweep a worker that seeks straight to the
       middle could record different ones) */
    this.tl.progress(1, true).progress(0, true);
    const spans: [number, number][] = [...this.extraMotion];
    for (const { tween, start, end } of this.tweens()) {
      const d = (tween.data ?? {}) as TweenData;
      if (d.blur === false || end - start <= 0) continue;
      spans.push([start, end]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([s[0], s[1]]);
    }
    this.motionSpans = merged;
    gsap.ticker.sleep();
  }

  /** does anything that needs motion blur move between t0 and t1? (the renderer skips extra samples when not) */
  moving(t0: number, t1: number): boolean {
    for (const [a, b] of this.motionSpans) { if (a < t1 && b > t0) return true; if (a >= t1) break; }
    return false;
  }

  /** put the film at t and draw it; resolves once fonts and images are ready and the frame is painted */
  async seek(t: number, o: { paint?: boolean } = {}): Promise<void> {
    if (!this.finalized) this.finalize();
    const time = Math.max(0, Math.min(this.duration, t));
    this.time = time;
    this.tl.time(time, true);
    for (const r of this.renderers) r(time);
    cancelScriptAnimations();
    await this.ready;
    if (o.paint !== false) await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  get now(): number { return this.time; }

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
