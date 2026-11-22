/* The film lines of act 2, the art director's own (`filmLine`, look/src/scenes/parts.ts): "They {hand} work to each
   other" (B05) and "They {work} it out" (B06), set in the room's ground above the log, in screen space (the camera follows
   the thread under them; the log scrolls under their band, never behind them).

   - rise: K1 without a fade: every word rises into its own mask on `arrive`, in reading order; the selection sweeps in
     behind the accent word as it lands, its caret riding the sweep's leading edge (K5's selection).
   - swap (B05 to B06): the line edits itself. "They" stays, "hand" sinks out of the selection, "work" travels into it
     (the selection's box resizes around it), "to each other" sinks away and "it out" rises after it. Nothing fades.
   - exit: the whole line sinks up out of its masks together on `depart` (the K1 exit, without opacity). */
import type { Film } from '../../engine/film';
import type { Stage } from '../../engine/stage';
import { filmLine } from '../../../look/src/scenes/parts';
import { h } from '../../../look/src/stage';
import { arrive, depart, travel, vis, type Ease } from './util';

export interface Line { el: HTMLElement; units: HTMLElement[]; masks: HTMLElement[]; sel: HTMLElement | null; text: string[] }

/** the art director's film line, its words split into masked units (its selection kept inside its own unit) */
export function line(layer: HTMLElement, text: string, o: { y: number; x?: number; align?: 'center' | 'left'; size?: number; width?: number }): Line {
  const el = filmLine(text, o);
  layer.appendChild(el);
  return split(el);
}
/** any element's words as masked units (a label in the product's UI as well as a film line) */
export function split(el: HTMLElement): Line {
  el.classList.add('a2-split');
  const units: HTMLElement[] = [], masks: HTMLElement[] = [], words: string[] = [];
  const wrap = (inner: Node, sel: boolean, word: string): HTMLElement => {
    const m = h('span', 'a2-wm' + (sel ? ' a2-wm--sel' : ''));
    const u = h('span', 'a2-wu');
    u.appendChild(inner);
    m.appendChild(u);
    units.push(u); masks.push(m); words.push(word);
    return m;
  };
  /* every text node at any depth (inside a <b> as well) becomes word units in place; a selection is one unit */
  const walk = (parent: Node): void => {
    for (const n of [...parent.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) {
        const parts = (n.textContent ?? '').split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const p of parts) {
          if (!p) continue;
          if (/^\s+$/.test(p)) frag.appendChild(document.createTextNode(' '));
          else frag.appendChild(wrap(document.createTextNode(p), false, p));
        }
        n.replaceWith(frag);
      } else if (n instanceof HTMLElement && n.classList.contains('sel')) {
        const ph = document.createComment('sel');
        n.replaceWith(ph);
        ph.replaceWith(wrap(n, true, n.textContent ?? ''));
      } else if (n instanceof HTMLElement && !n.classList.contains('a2-wm') && !n.matches('svg, .mark-inline')) {
        walk(n);
      }
    }
  };
  walk(el);
  return { el, units, masks, sel: el.querySelector<HTMLElement>('.sel'), text: words };
}

/** the line's words rise into their masks, the last landing at `land`; the selection sweeps in as its word lands */
export function rise(film: Film, ln: Line, land: number, o: { dur?: number; stagger?: number } = {}): void {
  const dur = o.dur ?? 24 / 60, st = o.stagger ?? 3 / 60, n = ln.units.length;
  const at0 = land - dur - (n - 1) * st;
  ln.units.forEach((u, i) => film.tl.fromTo(u, { yPercent: 112 }, { yPercent: 0, duration: dur, ease: arrive, data: { role: 'type' } }, at0 + i * st));
  if (ln.sel) {
    const i = ln.units.findIndex((u) => u.contains(ln.sel));
    sweep(film, ln.sel, at0 + i * st + dur * 0.55, 12 / 60);
  }
  vis(film, ln.el, (t) => t >= at0 - 1e-9);
}

/** the selection sweeps in behind its word from the left, the caret on its leading edge */
export function sweep(film: Film, sel: HTMLElement, at: number, dur: number): void {
  sel.dataset['a2Sweep'] = '';
  const w = sel.offsetWidth;
  sel.style.setProperty('--a2-w', w + 'px');
  film.tl.fromTo(sel, { '--a2-k': 0 }, { '--a2-k': 1, duration: dur, ease: arrive, data: { role: 'type' } }, at);
}

/** the whole line sinks up out of its masks, together (the selection rides inside its word's mask) */
export function exit(film: Film, ln: Line, at: number, dur = 14 / 60, ease: Ease = depart): void {
  for (const u of ln.units) film.tl.fromTo(u, { yPercent: 0 }, { yPercent: -114, duration: dur, ease, immediateRender: false, data: { role: 'type' } }, at);
  vis(film, ln.el, (t) => t < at + dur);
}

/** line A edits itself into line B (both already placed; B is drawn from the swap on). Words with the same text travel
    to B's place; the selection's box travels from A's accent word to B's; A's other words sink out, B's rise in. */
export function swap(film: Film, stage: Stage, a: Line, b: Line, at: number, o: { travelDur?: number; land?: number; zoom?: number; showB?: boolean } = {}): void {
  const td = o.travelDur ?? 30 / 60;
  const k = stage.root.getBoundingClientRect().width / stage.width * (o.zoom ?? 1);
  const rel = (e: Element, to: Element): { x: number; y: number; w: number; h: number } => {
    const r = e.getBoundingClientRect(), p = to.getBoundingClientRect();
    return { x: (r.left - p.left) / k, y: (r.top - p.top) / k, w: r.width / k, h: r.height / k };
  };
  /* pair B's words with A's: the longest run of equal words in order (an edit never crosses words over each other) */
  const n1 = a.text.length, n2 = b.text.length;
  const L: number[][] = Array.from({ length: n1 + 1 }, () => new Array<number>(n2 + 1).fill(0));
  for (let i = n1 - 1; i >= 0; i--) for (let j = n2 - 1; j >= 0; j--) L[i]![j] = a.text[i] === b.text[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const pairOf = new Array<number>(n2).fill(-1);
  const used = new Set<number>();
  for (let i = 0, j = 0; i < n1 && j < n2;) {
    if (a.text[i] === b.text[j]) { pairOf[j] = i; used.add(i); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++; else j++;
  }
  /* measure every word where it rests (not where a rise or a sink has put it for now) */
  const all = [...a.units, ...b.units, ...a.masks, ...b.masks];
  const saved = all.map((u) => u.style.transform);
  for (const u of all) u.style.transform = 'none';
  const restore = (): void => { all.forEach((u, i) => { u.style.transform = saved[i] ?? ''; }); };
  const travelAt = at + 4 / 60;
  const moves = b.units.map((ub, j) => { const i = pairOf[j]!; if (i < 0) return null; const ra = rel(a.units[i]!, a.el), rb = rel(ub, a.el); return { i, ub, dx: rb.x - ra.x, dy: rb.y - ra.y }; });
  const selA = a.sel && b.sel ? rel(a.sel, a.el) : null, selB = a.sel && b.sel ? rel(b.sel!, a.el) : null;
  restore();
  /* A's words that leave sink up out of their masks, in reading order */
  let n = 0;
  a.units.forEach((u, i) => {
    if (used.has(i)) return;
    film.tl.fromTo(u, { yPercent: 0 }, { yPercent: -114, duration: 14 / 60, ease: depart, immediateRender: false, data: { role: 'type' } }, at + (n++) * 2 / 60);
  });
  /* the shared words travel to B's place; at the end B's own word takes over (the same glyphs on the same pixels) */
  for (const mv of moves) {
    if (!mv) continue;
    const ua = a.units[mv.i]!;
    /* the word's mask travels with it (a unit moved out of its own mask would be clipped) */
    const ma = ua.parentElement as HTMLElement;
    film.tl.fromTo(ma, { x: 0, y: 0 }, { x: mv.dx, y: mv.dy, duration: td, ease: travel, immediateRender: false, data: { role: 'type' } }, travelAt);
    film.tl.set(mv.ub, { yPercent: 0 }, 0);
    vis(film, ua, (t) => t < travelAt + td);
    vis(film, mv.ub, (t) => t >= travelAt + td);
  }
  /* B's own new words rise in after the travel, in reading order */
  const fresh = b.units.filter((_, j) => pairOf[j]! < 0);
  const dur = 22 / 60, st = 3 / 60;
  /* a new word arrives only once the words it replaces have left (never two words on one place at once) */
  const sunk = at + 14 / 60 + Math.max(0, n - 1) * 2 / 60 - 4 / 60;
  const land = Math.max(o.land ?? travelAt + td + 18 / 60, sunk + dur + (fresh.length - 1) * st);
  const at0 = land - dur - (fresh.length - 1) * st;
  fresh.forEach((u, i) => film.tl.fromTo(u, { yPercent: 112 }, { yPercent: 0, duration: dur, ease: arrive, data: { role: 'type' } }, at0 + i * st));
  /* the selection: its box and caret travel from A's accent word to B's (drawn by us while it travels) */
  if (a.sel && b.sel) {
    const sa = selA!, sb = selB!;
    const fs = parseFloat(getComputedStyle(a.sel).fontSize);
    const box = h('div', 'a2-sel'), caret = h('div', 'a2-caret');
    a.el.append(box, caret);
    const geo = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => ({ x: r.x - 0.07 * fs, y: r.y + 0.13 * fs, w: r.w + 0.14 * fs, h: r.h - 0.10 * fs });
    const A = geo(sa), B = geo(sb);
    const p = { k: 0, __name: 'a2-sel' };
    film.tl.fromTo(p, { k: 0 }, { k: 1, duration: td, ease: travel, immediateRender: false, data: { role: 'type' } }, travelAt);
    const cw = Math.max(4, 0.04 * fs);
    box.style.position = caret.style.position = 'absolute';
    film.onRender(() => {
      const t = p.k, lerp = (x: number, y: number): number => x + (y - x) * t;
      const x = lerp(A.x, B.x), y = lerp(A.y, B.y), w = lerp(A.w, B.w), hh = lerp(A.h, B.h);
      Object.assign(box.style, { left: x.toFixed(2) + 'px', top: y.toFixed(2) + 'px', width: w.toFixed(2) + 'px', height: hh.toFixed(2) + 'px' });
      Object.assign(caret.style, { left: (x + w - 0.03 * fs - cw).toFixed(2) + 'px', top: y.toFixed(2) + 'px', height: hh.toFixed(2) + 'px', width: cw.toFixed(2) + 'px' });
    });
    const on = (t: number): boolean => t >= at - 1e-9 && t < travelAt + td;
    vis(film, box, on); vis(film, caret, on);
    /* A's own selection is off while ours stands in; B's comes on when ours has landed on it */
    film.onRender((t) => {
      const offA = t >= at - 1e-9, offB = t < travelAt + td;
      if (offA) a.el.dataset['a2Nosel'] = ''; else delete a.el.dataset['a2Nosel'];
      if (offB) b.el.dataset['a2Nosel'] = ''; else delete b.el.dataset['a2Nosel'];
    });
  }
  if (o.showB !== false) {
    vis(film, b.el, (t) => t >= at - 1e-9);
    vis(film, a.el, (t) => t < travelAt + td + 1 / 60);
  }
}
