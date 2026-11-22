/* The stage: 1920x1080 of pitch black, the scenes on it, and the frame driver the render script calls.
   A scene is set up shortly before it starts (so its orbs and fonts are warm), updated on every frame while it is on,
   and taken down after it ends. Everything a scene draws is a function of the clock `t` (seconds from the first
   frame); one-off actions (an orb's reaction, typing, a click) are cues that fire once, in order, as `t` passes them. */
import { SPRING, EASE, clamp } from './motion';

export const W = 1920, H = 1080;

export interface Ctx {
  /** run `fn` once, the first frame at or after `at` */
  at(at: number, fn: () => void): void;
}
export type Update = (t: number) => void;
export interface SceneDef { id: string; start: number; end: number; setup: (root: HTMLElement, ctx: Ctx) => Update; z?: number }

interface Live { def: SceneDef; root: HTMLElement; update: Update; cues: Array<{ at: number; fn: () => void; done: boolean }> }

const LEAD = 0.6, TAIL = 0.05;

/* The vertical cut (?v=1): the stage is 1080x1920; each scene's 1920x1080 composition is scaled to the width and sits
   in the middle band, and the headlines move up into the top band, larger (a line marked data-v="bottom" goes to the
   bottom band). Scenes keep drawing in their own coordinates; this pass runs after them on every frame. */
export const VERTICAL = new URLSearchParams(location.search).get('v') === '1';
const VS = 0.65, VX = (1080 - 1920 * VS) / 2, VY = 640, VK = 1.3;
function verticalPass(roots: HTMLElement[]): void {
  for (const root of roots) {
    root.style.transform = `translate(${VX}px, ${VY}px) scale(${VS})`;
    const lines = [...root.querySelectorAll<HTMLElement>(':scope > .line')].filter((l) => l.style.visibility !== 'hidden');
    const groups: Record<string, HTMLElement[]> = { top: [], bottom: [] };
    for (const l of lines) groups[l.dataset['v'] === 'bottom' ? 'bottom' : 'top']!.push(l);
    for (const [band, ls] of Object.entries(groups)) {
      if (!ls.length) continue;
      const tops = ls.map((l) => parseFloat(l.style.top) || 0), base = Math.min(...tops);
      ls.forEach((l, i) => {
        const k = Math.min(VK, 1000 / (l.offsetWidth * VS));
        const screenY = (band === 'top' ? 330 : 1480) + (tops[i]! - base) * VS * VK;
        l.style.left = '960px'; l.style.translate = '-50% 0'; l.style.transformOrigin = '50% 0';
        l.style.top = ((screenY - VY) / VS) + 'px'; l.style.scale = String(k);
      });
    }
  }
}

export function createStage(host: HTMLElement, defs: SceneDef[]) {
  const live = new Map<string, Live>();
  if (VERTICAL) { document.documentElement.classList.add('vertical'); }
  function frame(t: number): void {
    for (const def of defs) {
      const on = t >= def.start - LEAD && t < def.end + TAIL;
      let l = live.get(def.id);
      if (on && !l) {
        const root = document.createElement('div');
        root.className = 'scene'; root.dataset['scene'] = def.id; root.style.zIndex = String(def.z ?? 1);
        host.append(root);
        const cues: Live['cues'] = [];
        const ctx: Ctx = { at: (at, fn) => { cues.push({ at, fn, done: false }); } };
        const update = def.setup(root, ctx);
        cues.sort((a, b) => a.at - b.at);
        l = { def, root, update, cues };
        live.set(def.id, l);
      }
      if (!on && l) { l.root.remove(); live.delete(def.id); continue; }
      if (!l) continue;
      const visible = t >= def.start && t < def.end;
      l.root.style.opacity = visible ? '1' : '0';
      for (const c of l.cues) if (!c.done && t >= c.at) { c.done = true; try { c.fn(); } catch (e) { console.error('cue', def.id, c.at, e); } }
      try { l.update(t); } catch (e) { console.error('update', def.id, e); }
    }
    if (VERTICAL) verticalPass([...live.values()].map((l) => l.root));
  }
  return { frame };
}

/* ───────── elements ───────── */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.append(e);
  return e;
}
export function frag(html: string): HTMLElement {
  const t = document.createElement('template'); t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}
/** place an element by its centre, in stage pixels */
export function put(e: HTMLElement, x: number, y: number, s = 1, o = 1, extra = ''): void {
  e.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s}) ${extra}`;
  e.style.opacity = String(clamp(o));
}
export function tf(e: HTMLElement, transform: string, o?: number): void {
  e.style.transform = transform;
  if (o != null) e.style.opacity = String(clamp(o));
}
export const show = (e: HTMLElement, on: boolean): void => { e.style.visibility = on ? 'visible' : 'hidden'; };

/* ───────── kinetic type: a headline enters word by word and leaves in one piece ───────── */
export interface Line extends HTMLElement { words: HTMLElement[] }
export function line(text: string, cls = 'h1', parent?: HTMLElement): Line {
  const e = el('div', 'line ' + cls, parent) as Line;
  e.words = [];
  text.split(/(\s+)/).forEach((w) => {
    if (/^\s+$/.test(w)) { e.append(document.createTextNode(' ')); return; }
    const s = el('span', 'w', e); s.textContent = w; e.words.push(s);
  });
  return e;
}
/** words rise 28px and fade in, 90 ms apart, over 0.6 s on --spring; the line leaves over 0.2 s, fading and lifting 12px */
export function kinetic(l: Line, t: number, tin: number, tout: number, o: { stagger?: number; rise?: number; dur?: number; outDur?: number } = {}): void {
  const st = o.stagger ?? 0.09, rise = o.rise ?? 28, dur = o.dur ?? 0.6, od = o.outDur ?? 0.2;
  const out = EASE(clamp((t - tout) / od));
  l.style.visibility = t >= tin && t < tout + od ? 'visible' : 'hidden';
  l.words.forEach((w, i) => {
    const p = SPRING(clamp((t - tin - i * st) / dur));
    w.style.transform = `translateY(${(1 - p) * rise - out * 12}px)`;
    w.style.opacity = String(p * (1 - out));
  });
}
