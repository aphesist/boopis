/* Type, animated per line, word or character, behind masks (craft bible part 5, K1 to K3).

     const t = setType(el, 'the plans you already pay for', { accent: ['already'] })
     const u = split(t, 'word')                  // or 'line' or 'char'; each unit sits in its own mask
     rise(film, u, { at, stagger: g.f(4) })      // each unit rises into its mask on `arrive` (no opacity at all)
     soft(film, u, { at })                       // K1: y +32 px, blur 8 to 0, opacity 0 to 1 per word (small units only)
     typeOn(film, el, { at, cps: 28 })           // K2: characters at 25 to 30 a second, a soft 5-frame leading edge
     exit(film, t, { at })                       // K1 exit: the whole line up 16 px, blur 6, on `depart`, 12 frames

   Masks clip at each unit's line box with room for ascenders and descenders (.film-mask in film.css). Text is laid out
   at its final size: animate transforms of units, never a scaled bitmap of the line. */
import type { Film } from '../engine/film';
import { arrive, depart, type Ease } from './ease';

export type Unit = 'line' | 'word' | 'char';

/** set the text of an element, marking accent words (class film-accent) */
export function setType(el: HTMLElement, text: string, o: { accent?: string[] } = {}): HTMLElement {
  el.textContent = '';
  const words = text.split(/(\s+)/);
  for (const w of words) {
    if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(' ')); continue; }
    if (!w) continue;
    const s = document.createElement('span');
    s.className = 'film-w' + (o.accent?.includes(w.replace(/[^\p{L}\p{N}'-]/gu, '')) ? ' film-accent' : '');
    s.textContent = w;
    el.appendChild(s);
  }
  return el;
}

const wrap = (inner: Node, cls: string): HTMLSpanElement => {
  const mask = document.createElement('span');
  mask.className = 'film-mask ' + cls;
  const unit = document.createElement('span');
  unit.className = 'film-unit';
  unit.appendChild(inner);
  mask.appendChild(unit);
  return mask;
};

/** split an element (set with setType, or plain text) into masked units; returns the moving units (inside the masks) */
export function split(el: HTMLElement, by: Unit): HTMLElement[] {
  if (!el.querySelector('.film-w')) setType(el, el.textContent ?? '');
  const words = [...el.querySelectorAll<HTMLElement>('.film-w')];
  if (by === 'word') {
    for (const w of words) { const m = wrap(document.createTextNode(w.textContent ?? ''), 'film-word'); m.firstElementChild!.className += w.classList.contains('film-accent') ? ' film-accent' : ''; w.replaceWith(m); }
    return [...el.querySelectorAll<HTMLElement>('.film-mask > .film-unit')];
  }
  if (by === 'char') {
    for (const w of words) {
      const holder = document.createElement('span');
      holder.className = 'film-word' + (w.classList.contains('film-accent') ? ' film-accent' : '');
      for (const ch of [...(w.textContent ?? '')]) holder.appendChild(wrap(document.createTextNode(ch), 'film-char'));
      w.replaceWith(holder);
    }
    return [...el.querySelectorAll<HTMLElement>('.film-mask > .film-unit')];
  }
  /* lines: group the words by where layout breaks them, then mask each line */
  const tops: [number, HTMLElement[]][] = [];
  for (const w of words) {
    const top = Math.round(w.offsetTop);
    const last = tops[tops.length - 1];
    if (last && Math.abs(last[0] - top) < 2) last[1].push(w); else tops.push([top, [w]]);
  }
  el.textContent = '';
  for (const [, ws] of tops) {
    const line = document.createElement('span');
    ws.forEach((w, i) => { if (i) line.appendChild(document.createTextNode(' ')); line.appendChild(w); });
    const m = wrap(line, 'film-line');
    el.appendChild(m);
  }
  return [...el.querySelectorAll<HTMLElement>('.film-line > .film-unit')];
}

export interface TypeMove { at: number; dur?: number; stagger?: number; ease?: Ease }

/** each unit rises into its mask: y from below the mask to rest, on `arrive` (24 to 40 f); no opacity */
export function rise(film: Film, units: HTMLElement[], o: TypeMove & { from?: number }): number {
  const dur = o.dur ?? 32 / film.fps, st = o.stagger ?? 4 / film.fps;
  units.forEach((u, i) => film.tl.fromTo(u, { yPercent: o.from ?? 110 }, { yPercent: 0, duration: dur, ease: o.ease ?? arrive, data: { role: 'type' } }, o.at + i * st));
  return o.at + (units.length - 1) * st + dur;
}

/** K1: y +32 px to 0, blur 8 to 0, opacity 0 to 1, 20 f each, 4 f apart (opacity on small units only) */
export function soft(film: Film, units: HTMLElement[], o: TypeMove): number {
  const dur = o.dur ?? 20 / film.fps, st = o.stagger ?? 4 / film.fps;
  units.forEach((u, i) => film.tl.fromTo(u, { y: 32, filter: 'blur(8px)', opacity: 0 }, { y: 0, filter: 'blur(0px)', opacity: 1, duration: dur, ease: o.ease ?? arrive, data: { role: 'type' } }, o.at + i * st));
  return o.at + (units.length - 1) * st + dur;
}

/** units leave down out of their masks together (the mirror of rise), on `depart`, 0.6 to 0.7x the entry */
export function sink(film: Film, units: HTMLElement[], o: TypeMove & { to?: number }): number {
  const dur = o.dur ?? 20 / film.fps, st = o.stagger ?? 0;
  units.forEach((u, i) => film.tl.to(u, { yPercent: o.to ?? -110, duration: dur, ease: o.ease ?? depart, immediateRender: false, data: { role: 'type' } }, o.at + i * st));
  return o.at + (units.length - 1) * st + dur;
}

/** K2: characters appear at `cps` a second (25 to 30), each fading in over `fade` frames, so two or three are mid-fade */
export function typeOn(film: Film, el: HTMLElement, o: { at: number; cps?: number; fade?: number }): number {
  const chars = split(el, 'char');
  const cps = o.cps ?? 28, fade = (o.fade ?? 5) / film.fps;
  chars.forEach((c, i) => film.tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: fade, ease: arrive, data: { role: 'type', blur: false } }, o.at + i / cps));
  return o.at + chars.length / cps + fade;
}

/** K1 exit: the whole line y 0 to -16 px, blur 0 to 6 px, opacity 1 to 0 over 12 f on `depart` (never word by word) */
export function exit(film: Film, el: HTMLElement, o: { at: number; dur?: number }): number {
  const dur = o.dur ?? 12 / film.fps;
  film.tl.to(el, { y: -16, filter: 'blur(6px)', opacity: 0, duration: dur, ease: depart, immediateRender: false, data: { role: 'type' } }, o.at);
  return o.at + dur;
}
