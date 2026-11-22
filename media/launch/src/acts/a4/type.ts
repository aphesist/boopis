/* Film lines as the art director sets them (look/src/scenes/parts.ts filmLine: Libre Franklin 600, the one word held in
   the brass selection with its caret, line breaks as <br>) split into words for K1 without losing the selection: a word
   of plain text and the whole selected word are each one unit (motion/type.ts split() would retype the line and drop
   the selection). The line's words sit in one inline-block, so the K1 exit moves a box the size of the words, not the
   frame-wide heading; a heading of two lines exits as two lines at once. */
import type { Film } from '../../engine/film';
import { exit, soft } from '../../motion/type';

const wraps = new WeakMap<HTMLElement, { wraps: HTMLElement[]; units: HTMLElement[] }>();

export function lineUnits(line: HTMLElement): HTMLElement[] {
  const have = wraps.get(line);
  if (have) return have.units;
  /* one inline-block per line of the heading (the art director breaks lines with <br>) */
  const nodes = [...line.childNodes];
  line.textContent = '';
  const segs: HTMLElement[] = [];
  const seg = (): HTMLElement => { const w = document.createElement('span'); w.className = 'a4-line'; w.style.display = 'inline-block'; line.appendChild(w); segs.push(w); return w; };
  let cur = seg();
  for (const n of nodes) {
    if (n instanceof HTMLElement && n.tagName === 'BR') { line.appendChild(n); cur = seg(); continue; }
    cur.appendChild(n);
  }
  const units: HTMLElement[] = [];
  for (const wrap of segs) for (const n of [...wrap.childNodes]) {
    if (n.nodeType === Node.TEXT_NODE) {
      const parts = (n.textContent ?? '').split(/(\s+)/);
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); continue; }
        const s = document.createElement('span');
        s.className = 'a4-w';
        s.style.display = 'inline-block';
        s.textContent = p;
        frag.appendChild(s);
        units.push(s);
      }
      n.replaceWith(frag);
    } else if (n instanceof HTMLElement) {
      n.style.display = 'inline-block';
      units.push(n);
    }
  }
  wraps.set(line, { wraps: segs, units });
  return units;
}

/** K1: each word rises 32 px out of an 8 px blur, 20 frames, 4 frames apart (opacity on single words only) */
export function softRise(film: Film, units: HTMLElement[], at: number, o: { stagger?: number; dur?: number } = {}): number {
  return soft(film, units, { at, stagger: o.stagger ?? 4 / film.fps, dur: o.dur ?? 20 / film.fps });
}

/** K1 exit: the whole line up 16 px into a 6 px blur, 12 frames on depart (never word by word) */
export function lineExit(film: Film, line: HTMLElement, at: number): number {
  lineUnits(line);
  let end = at;
  for (const w of wraps.get(line)!.wraps) end = exit(film, w, { at });
  return end;
}
