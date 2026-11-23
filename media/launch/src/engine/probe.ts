/* How far things move on screen: the renderer's motion-blur planner asks the page, and the page measures.

   probe(times) seeks the film to each time (no paint) and returns, for each step between consecutive times, the
   largest displacement of anything visible on screen, in stage px (1080p px; the renderer multiplies by its output
   scale). "Anything" is every rendered element and SVG shape of the stage (orb bodies and each eye are their own
   paths, words in masks their own units, the cursor, plates, kit components), measured by its box clamped to the frame,
   so an edge off screen never counts and an edge on screen always does. A clip-path inset or circle (a wipe, an iris)
   counts as the visible box it cuts. Structural boxes (the stage, the world, the layers) are not things.

   The element set is taken once per call, visible at the call's middle time; an element hidden at a probe time has
   an empty box there and is skipped for that step (an element appearing is a cut, not a move).

   An orb's eye cells are paths reused by index (engine/orb.ts): when a face morph changes how many cells there are,
   path k is a different cell on either side, and its box would read as a jump of tens of px that nothing on screen
   makes. Across a step where an orb's cell count changes, its cells are not compared one by one; the eyes' group box
   (all the cells together, which changes smoothly through the morph) still is. */
import type { Film } from './film';
import type { Stage } from './stage';

const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'filter', 'title', 'desc', 'metadata', 'symbol', 'pattern', 'marker']);
const STRUCTURAL = ['film-stage', 'film-world', 'film-ground', 'film-screen', 'film-layer', 'film-host'];

interface VisOpts { checkOpacity: boolean; checkVisibilityCSS: boolean }
const visible = (e: Element): boolean => {
  const f = (e as Element & { checkVisibility?: (o: VisOpts) => boolean }).checkVisibility;
  return f ? f.call(e, { checkOpacity: true, checkVisibilityCSS: true }) : true;
};
const structural = (e: Element): boolean => {
  const c = e.classList;
  for (const s of STRUCTURAL) if (c.contains(s)) return true;
  return false;
};

const CELLS = 'film-orb__eyes';
function things(root: Element): { els: Element[]; clipped: Set<Element>; groups: Element[]; groupOf: Int32Array } {
  const els: Element[] = [], clipped = new Set<Element>(), groups: Element[] = [], gi: number[] = [];
  const walk = (el: Element): void => {
    for (const c of el.children) {
      if (SKIP_TAGS.has(c.tagName)) continue;
      if (!visible(c)) continue;      /* display none, visibility hidden, opacity 0: nothing of it is seen */
      if (!structural(c)) {
        els.push(c);
        if (el.classList.contains(CELLS)) { let g = groups.indexOf(el); if (g < 0) { groups.push(el); g = groups.length - 1; } gi[els.length - 1] = g; }
        const cp = getComputedStyle(c).clipPath;
        if (cp && cp !== 'none') clipped.add(c);
      }
      walk(c);
    }
  };
  walk(root);
  const groupOf = new Int32Array(els.length).fill(-1);
  gi.forEach((g, i) => { groupOf[i] = g; });
  return { els, clipped, groups, groupOf };
}

/** the visible box of a clip-path inset()/circle() on a box (px or %), or the box itself */
function clipBox(e: Element, r: DOMRect): [number, number, number, number] {
  const cp = getComputedStyle(e).clipPath;
  const len = (s: string | undefined, of: number): number => (!s ? 0 : s.endsWith('%') ? (parseFloat(s) / 100) * of : parseFloat(s) || 0);
  let m = /inset\(([^)]*)\)/.exec(cp);
  if (m) {
    const v = m[1]!.replace(/round.*$/, '').trim().split(/\s+/);
    const t = len(v[0], r.height), rt = len(v[1] ?? v[0], r.width), b = len(v[2] ?? v[0], r.height), l = len(v[3] ?? v[1] ?? v[0], r.width);
    return [r.left + l, r.top + t, r.right - rt, r.bottom - b];
  }
  m = /circle\(\s*([\d.]+(?:px|%)?)\s*(?:at\s+([\d.]+(?:px|%)?)\s+([\d.]+(?:px|%)?))?\s*\)/.exec(cp);
  if (m) {
    const rad = len(m[1], Math.hypot(r.width, r.height) / Math.SQRT2), cx = r.left + (m[2] ? len(m[2], r.width) : r.width / 2), cy = r.top + (m[3] ? len(m[3], r.height) : r.height / 2);
    return [cx - rad, cy - rad, cx + rad, cy + rad];
  }
  return [r.left, r.top, r.right, r.bottom];
}

/** the boxes of the things, clamped to the frame, in stage px (NaN for an element with no box now) */
function boxes(stage: Stage, els: Element[], clipped: Set<Element>): Float64Array {
  const f = stage.root.getBoundingClientRect(), k = f.width / stage.width, W = stage.width, H = stage.height;
  const out = new Float64Array(els.length * 4);
  for (let i = 0; i < els.length; i++) {
    const e = els[i]!, r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { out[i * 4] = NaN; continue; }
    const [l, t, rr, b] = clipped.has(e) ? clipBox(e, r) : [r.left, r.top, r.right, r.bottom];
    const x0 = Math.max(0, Math.min(W, (l - f.left) / k)), x1 = Math.max(0, Math.min(W, (rr - f.left) / k));
    const y0 = Math.max(0, Math.min(H, (t - f.top) / k)), y1 = Math.max(0, Math.min(H, (b - f.top) / k));
    if (x1 - x0 <= 0 || y1 - y0 <= 0) { out[i * 4] = NaN; continue; }
    out[i * 4] = x0; out[i * 4 + 1] = y0; out[i * 4 + 2] = x1; out[i * 4 + 3] = y1;
  }
  return out;
}

export interface ProbeResult {
  /** for each step between consecutive times: the largest edge displacement of any thing on screen, stage px */
  steps: number[];
  /** how many things were measured */
  things: number;
  /** what moved most in the largest step (for logs) */
  fastest: string;
}

/** measure on-screen motion across a list of clip times (the film is left at the last one) */
export async function probe(film: Film, stage: Stage, times: number[]): Promise<ProbeResult> {
  if (times.length < 2) return { steps: [], things: 0, fastest: '' };
  await film.seek(times[Math.floor(times.length / 2)]!, { paint: false });
  const { els, clipped, groups, groupOf } = things(stage.root);
  const per: Float64Array[] = [], counts: number[][] = [];
  for (const t of times) { await film.seek(t, { paint: false }); per.push(boxes(stage, els, clipped)); counts.push(groups.map((g) => g.childElementCount)); }
  const steps: number[] = [];
  let best = 0, who = -1;
  for (let s = 0; s + 1 < per.length; s++) {
    const a = per[s]!, b = per[s + 1]!, ca = counts[s]!, cb = counts[s + 1]!;
    let m = 0;
    for (let i = 0; i < els.length; i++) {
      const g = groupOf[i]!;
      if (g >= 0 && ca[g] !== cb[g]) continue;   /* the cells were renumbered: the group's box speaks for them */
      const o = i * 4;
      if (Number.isNaN(a[o]!) || Number.isNaN(b[o]!)) continue;
      const d = Math.max(Math.abs(a[o]! - b[o]!), Math.abs(a[o + 1]! - b[o + 1]!), Math.abs(a[o + 2]! - b[o + 2]!), Math.abs(a[o + 3]! - b[o + 3]!));
      if (d > m) { m = d; if (d > best) { best = d; who = i; } }
    }
    steps.push(m);
  }
  const e = who >= 0 ? els[who]! : null;
  const fastest = e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(/\s+/)[0] : (e.getAttribute('class') ? '.' + e.getAttribute('class')!.split(/\s+/)[0] : '')) : '';
  return { steps, things: els.length, fastest };
}
