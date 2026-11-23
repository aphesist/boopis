/* The film lines of act 2, the art director's own (`filmLine`, look/src/scenes/parts.ts): "They {hand} work to each
   other" (B05) and "They {work} it out" (B06), set in the room's ground above the log, in screen space (the camera follows
   the thread under them; the log scrolls under their band, never behind them). The size is the look's token.

   Nothing here masks a letter (the critique's E6): the words are the engine's plain word spans (motion/line.ts).
   - in: K1, each word rises unmasked with its blur (wordRise); the accent's selection sweeps in behind its word as the
     word lands, its caret riding the sweep's leading edge.
   - the edit (B05 to B06): K5, the line edits itself (selfEdit): "hand" is selected and deleted, then "to each other" is
     selected and "it out" types in; the accent's selection then sweeps onto "work".
   - out: K1, the whole line leaves together (lineExit). */
import type { Film } from '../../engine/film';
import { filmLine } from '../../../look/src/scenes/parts';
import { lineExit, selfEdit, wordRise, type Edit } from '../../motion/line';
import { ui } from './util';

export interface Line { el: HTMLElement; words: HTMLElement[]; sel: HTMLElement | null }

/** the art director's film line in `layer`, its words plain spans (a selection is one word; a group of words given in
    `groups` is one span, so an edit can select it whole) */
export function line(layer: HTMLElement, text: string, o: { y: number; x?: number; align?: 'center' | 'left'; width?: number }, groups: string[] = []): Line {
  const el = filmLine(text, o);
  layer.appendChild(el);
  const word = (inner: Node | string): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'film-w';
    s.style.display = 'inline-block';
    if (typeof inner === 'string') s.textContent = inner; else s.appendChild(inner);
    return s;
  };
  const walk = (parent: Node): void => {
    for (const n of [...parent.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) {
        let src = n.textContent ?? '';
        const frag = document.createDocumentFragment();
        /* a group stays one span */
        for (const g of groups) src = src.split(g).join('\u0000' + g.replace(/ /g, '\u0001') + '\u0000');
        for (const piece of src.split('\u0000')) {
          if (!piece) continue;
          if (piece.includes('\u0001') || groups.includes(piece)) { frag.appendChild(word(piece.replace(/\u0001/g, ' '))); continue; }
          for (const w of piece.split(/(\s+)/)) {
            if (!w) continue;
            if (/^\s+$/.test(w)) frag.appendChild(document.createTextNode(' '));
            else frag.appendChild(word(w));
          }
        }
        n.replaceWith(frag);
      } else if (n instanceof HTMLElement && n.classList.contains('sel')) {
        const ph = document.createComment('sel');
        n.replaceWith(ph);
        ph.replaceWith(word(n));
      } else if (n instanceof HTMLElement && !n.classList.contains('film-w') && !n.matches('svg, br, .mark-inline')) {
        walk(n);
      }
    }
  };
  walk(el);
  return { el, words: [...el.querySelectorAll<HTMLElement>('.film-w')], sel: el.querySelector<HTMLElement>('.sel') };
}

/** the accent's selection sweeps in behind its word from its start, the caret riding the leading edge (a clip on the
    selection's own box, never on a letter) */
export function sweep(film: Film, sel: HTMLElement, at: number, dur = 10 / 60): void {
  sel.dataset['a2Sweep'] = '';
  sel.style.setProperty('--a2-w', sel.offsetWidth + 'px');
  film.tl.fromTo(sel, { '--a2-k': 0 }, { '--a2-k': 1, duration: dur, ease: ui, immediateRender: true, data: { role: 'type' } }, at);
}

/** K1 in: the words rise unmasked; the accent's selection sweeps in as its word lands */
export function rise(film: Film, l: Line, at: number): number {
  const end = wordRise(film, l.words, { at });
  if (l.sel) {
    const i = l.words.findIndex((w) => w.contains(l.sel!));
    sweep(film, l.sel, at + Math.max(0, i) * (4 / 60) + 12 / 60);
  }
  return end;
}

/** K5: the line edits itself. An edit to '' deletes the word (its space goes with it). Returns the end of the typing. */
export function edit(film: Film, l: Line, edits: Edit[]): number {
  const before = new Map(l.words.map((w) => [w, w.nextElementSibling]));
  const SEL = 8, HOLD = 4;
  const end = selfEdit(film, l.el, edits, { color: 'var(--brass)', linger: 4, select: SEL, hold: HOLD });
  for (const e of edits) {
    if (e.to !== '') continue;
    const old = typeof e.word === 'number' ? l.words[e.word] : l.words.find((w) => w.textContent === e.word);
    if (!old) continue;
    /* selfEdit puts the new word right after the old one; an empty one would hold the spaces on both sides apart, so it
       goes with the old word at the first key and the two spaces collapse into one */
    const neu = old.nextElementSibling as HTMLElement | null;
    if (neu && neu !== before.get(old)) film.tl.set(neu, { display: 'none' }, e.at + (SEL + HOLD) / 60);
  }
  return end;
}

/** K1 out: the whole line leaves together */
export function exit(film: Film, l: Line, at: number): number {
  return lineExit(film, l.el, { at });
}
