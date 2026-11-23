/* window.__film: the page's contract with the renderer (tools/render.mjs) and the craft checker (tools/qa/qa.mjs).

     duration, fps, width, height, variant, frames, bpm, cuts
     seek(t)                 async; resolves once the frame at t is painted, fonts and images ready
     moving(t0, t1)          does a tween or a marked span run in (t0, t1]? (informational)
     probe(times)            the largest on-screen displacement between consecutive times (the blur planner's input)
     samples(t0, t1)         0 = nothing moves, -1 = the default sub-frames, n = a fast move asks for at least n
     tweens()                every tween with its global times, ease, properties and targets
     text()                  the text visible now: each run's words, its size on screen in px, its opacity
     fades()                 opacity tweens on large elements (a full-layer cross-fade is never allowed) */
import type { Film } from './film';
import type { Stage } from './stage';
import { probe, type ProbeResult } from './probe';

export interface TextRun { text: string; px: number; opacity: number; x: number; y: number; w: number; h: number; clipped: number; el: string }
export interface FadeInfo { start: number; end: number; target: string; area: number; overlaps: number }

export interface FilmApi {
  name: string; duration: number; fps: number; width: number; height: number; variant: string; frames: number; bpm: number; cuts: number[];
  grain: Film['grain'];
  warnings: string[];
  marks: { name: string; t: number }[];
  /** cuts and instant changes (zero-duration tweens), clip time: no shutter reaches across one */
  fences: number[];
  /** the clip's start on the film's absolute clock (an act alone); everything else here is clip time */
  offset: number;
  seek(t: number, o?: { paint?: boolean }): Promise<void>;
  moving(t0: number, t1: number): boolean;
  /** the largest on-screen displacement between consecutive clip times, stage px (engine/probe.ts) */
  probe(times: number[]): Promise<ProbeResult>;
  samples(t0: number, t1: number): number;
  tweens(): ReturnType<Film['tweenInfo']>;
  text(): TextRun[];
  fades(): Promise<FadeInfo[]>;
}
declare global { interface Window { __film?: FilmApi } }

/* Every capture is a full raster. Chromium repaints only what changed since the last frame it drew, and a repainted
   strip of an unchanged shape (the edge of a box under a cursor that moved) can come out up to 10 levels different
   in its antialiasing from the same shape drawn whole: the same frame then had different pixels depending on what was
   drawn before it. A zero, transparent shadow toggled on the stage after each seek invalidates the whole stage, so
   every frame is drawn whole and is the same pixels whatever came before (the self-test's determinism check). */
let flip = false;
function repaintAll(stage: Stage): void {
  flip = !flip;
  stage.root.style.boxShadow = flip ? '0 0 0 0 rgba(0, 0, 0, 0)' : 'none';
}

export function expose(film: Film, stage: Stage): FilmApi {
  const api: FilmApi = {
    name: film.name, duration: film.duration, fps: film.fps, width: film.width, height: film.height, variant: film.variant,
    frames: Math.round(film.duration * film.fps), bpm: film.bpm, cuts: film.clipCuts(), fences: film.clipFences(), grain: film.grain,
    marks: film.marks.map((m) => ({ name: m.name, t: m.t - film.offset })).filter((m) => m.t >= -1e-9 && m.t < film.duration), warnings: film.warnings, offset: film.offset,
    seek: async (t, o) => { await film.seek(t, o); repaintAll(stage); },
    moving: (a, b) => film.moving(a, b),
    probe: (times) => probe(film, stage, times),
    samples: (a, b) => film.samples(a, b),
    tweens: () => film.tweenInfo().map((t) => ({ ...t, start: t.start - film.offset, end: t.end - film.offset })).filter((t) => t.end > 0 && t.start < film.duration),
    text: () => visibleText(stage),
    fades: () => fades(film, stage)
  };
  window.__film = api;
  return api;
}

const frameRect = (stage: Stage): DOMRect => stage.root.getBoundingClientRect();
const hostScale = (stage: Stage): number => frameRect(stage).width / stage.width;

function opacityOf(el: Element | null, stop: Element): number {
  let o = 1;
  for (let n = el; n && n !== stop.parentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    o *= parseFloat(cs.opacity || '1');
    if (o < 0.01) return 0;
  }
  return o;
}
/** the part of a rect left after every clipping ancestor (overflow, clip-path inset) between it and the stage */
function clipOf(el: Element, stage: Stage, r: DOMRect): DOMRect | null {
  let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
  const f = frameRect(stage);
  x0 = Math.max(x0, f.left); y0 = Math.max(y0, f.top); x1 = Math.min(x1, f.right); y1 = Math.min(y1, f.bottom);
  for (let n: Element | null = el; n && n !== stage.root; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const clips = /(hidden|clip)/.test(cs.overflowX + cs.overflowY) || (cs.clipPath && cs.clipPath !== 'none');
    if (!clips) continue;
    const c = n.getBoundingClientRect();
    let cx0 = c.left, cy0 = c.top, cx1 = c.right, cy1 = c.bottom;
    const m = /inset\(([^)]+)\)/.exec(cs.clipPath || '');
    if (m) {
      const v = m[1]!.split(/\s+/).map((s) => (s.endsWith('%') ? parseFloat(s) / 100 : NaN));
      const [t = 0, rt = t, b = t, l = rt] = v.map((p) => (Number.isFinite(p) ? p : 0));
      cx0 = c.left + l * c.width; cx1 = c.right - rt * c.width; cy0 = c.top + t * c.height; cy1 = c.bottom - b * c.height;
    }
    if (/(hidden|clip)/.test(cs.overflowX + cs.overflowY) || m) { x0 = Math.max(x0, cx0); y0 = Math.max(y0, cy0); x1 = Math.min(x1, cx1); y1 = Math.min(y1, cy1); }
  }
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return null;
  return new DOMRect(x0, y0, x1 - x0, y1 - y0);
}

/** every visible run of text now, with its size on screen in 1080p px (1em measured through every zoom and transform) */
export function visibleText(stage: Stage): TextRun[] {
  const out: TextRun[] = [];
  const k = hostScale(stage), f = frameRect(stage);
  const walker = document.createTreeWalker(stage.root, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || seen.has(el) || /^(STYLE|SCRIPT)$/.test(el.tagName)) continue;
    if (el.closest('.film-hud, svg, [aria-hidden="true"].film-noqa')) continue;
    const op = opacityOf(el, stage.root);
    if (op < 0.05) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const vis = clipOf(el, stage, r);
    if (!vis) continue;
    /* 1em of this text on screen: a zero-width inline-block 1em tall, measured through zoom and transforms */
    const ruler = document.createElement('span');
    ruler.style.cssText = 'display:inline-block;width:0;height:1em;vertical-align:baseline;padding:0;margin:0;border:0';
    el.appendChild(ruler);
    const em = ruler.getBoundingClientRect().height / k;
    ruler.remove();
    seen.add(el);
    out.push({ text: (el.textContent ?? text).replace(/\s+/g, ' ').trim().slice(0, 80), px: Math.round(em * 10) / 10, opacity: Math.round(op * 100) / 100,
      x: Math.round((vis.left - f.left) / k), y: Math.round((vis.top - f.top) / k), w: Math.round(vis.width / k), h: Math.round(vis.height / k),
      clipped: Math.round((1 - (vis.width * vis.height) / (r.width * r.height)) * 100) / 100, el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '') });
  }
  return out;
}

/** opacity tweens whose target covers more than 10% of the frame at the tween's middle, and what they overlap */
async function fades(film: Film, stage: Stage): Promise<FadeInfo[]> {
  const out: FadeInfo[] = [];
  const now = film.now;
  const k = hostScale(stage), area = stage.width * stage.height;
  for (const { tween, start: s0, end: e0 } of film.tweens()) {
    const v = tween.vars as Record<string, unknown>;
    if (!('opacity' in v) && !('autoAlpha' in v)) continue;
    const start = s0 - film.offset, end = e0 - film.offset;
    if (end <= 0 || start >= film.duration || end - start <= 0) continue;
    await film.seek((start + end) / 2, { paint: false });
    for (const t of tween.targets() as unknown[]) {
      if (!(t instanceof Element)) continue;
      const r = t.getBoundingClientRect();
      const f = frameRect(stage);
      const w = Math.max(0, Math.min(r.right, f.right) - Math.max(r.left, f.left)) / k, h = Math.max(0, Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top)) / k;
      const a = (w * h) / area;
      if (a > 0.1) out.push({ start, end, target: t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.split(/\s+/)[0] : ''), area: Math.round(a * 100) / 100, overlaps: 0 });
    }
  }
  await film.seek(now, { paint: false });
  return out;
}
