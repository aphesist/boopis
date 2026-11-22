/* Act 3's type: what the user types (K2 with a human rhythm), the film lines (K1, with the look's brass selection swept
   in behind the accent word and its caret), and the way the product's words leave when the camera pulls away from
   them: each line of text squeezes into the bar the look draws for a line nobody reads (look.md 5), before it could
   fall under the 28 px floor. Nothing here fades a large element; every opacity is a character, a word or a bar. */
import type { Film } from '../../engine/film';
import { rng } from '../../engine/rng';
import { arrive, depart, travel, ui, type Ease } from '../../motion/ease';

/* ───────── K2: typing with a human rhythm ───────── */

/** split an element's text into one span per character (inline, no masks: the composer and the terminal wrap them) */
export function charSpans(el: HTMLElement, text: string): HTMLElement[] {
  el.textContent = '';
  const out: HTMLElement[] = [];
  for (const ch of [...text]) {
    const s = document.createElement('span');
    s.className = 'a3-ch';
    s.textContent = ch;
    el.appendChild(s);
    out.push(s);
  }
  return out;
}

/** the times a person types `text` between t0 and t1: bursts inside words, a beat between words, a longer one before a
    quote or a flag (seeded, so the same every render) */
export function rhythm(text: string, t0: number, t1: number, seed: number): number[] {
  const r = rng(seed);
  const gaps: number[] = [];
  const chars = [...text];
  chars.forEach((c, i) => {
    const prev = chars[i - 1] ?? '';
    let g = 0.8 + r() * 0.5;                              /* inside a word */
    if (prev === ' ') g += 1.6 + r() * 1.2;               /* the start of the next word */
    if (c === '"' || c === '-' && prev === ' ') g += 1.2;  /* reaching for a quote or a flag */
    if (c === '/' || c === '.') g += 0.5;
    if (i === 0) g = 0;
    gaps.push(g);
  });
  const total = gaps.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return gaps.map((g) => { acc += g; return t0 + ((t1 - t0) * acc) / total; });
}

/** K2: each character arrives over 5 frames at its time, so two or three are mid-arrival at the leading edge */
export function typeChars(film: Film, chars: HTMLElement[], times: number[], o: { fade?: number } = {}): void {
  const fade = (o.fade ?? 5) / film.fps;
  chars.forEach((c, i) => film.tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: fade, ease: arrive, immediateRender: true, data: { role: 'type', blur: false } }, times[i] ?? 0));
}

/* ───────── K1: a film line, word by word, keeping the look's selection ───────── */

export interface Line { el: HTMLElement; words: HTMLElement[]; sel: HTMLElement | null }

/** wrap each word of a film line (the look's filmLine(): text, <br>, one .sel span) in its own inline-block, keeping
    the line breaks and the selection whole */
export function lineWords(el: HTMLElement): Line {
  const words: HTMLElement[] = [];
  let sel: HTMLElement | null = null;
  const walk = (n: Node): void => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === Node.TEXT_NODE) {
        const parts = (c.textContent ?? '').split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const p of parts) {
          if (!p) continue;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); continue; }
          const w = document.createElement('span');
          w.className = 'a3-w';
          w.textContent = p;
          frag.appendChild(w);
          words.push(w);
        }
        c.replaceWith(frag);
      } else if (c instanceof HTMLElement && c.classList.contains('sel')) {
        const w = document.createElement('span');
        w.className = 'a3-w';
        c.replaceWith(w);
        w.appendChild(c);
        words.push(w);
        sel = c;
      } else if (c instanceof HTMLElement && c.tagName !== 'BR') walk(c);
    }
  };
  walk(el);
  /* reading order is document order */
  return { el, words, sel };
}

/** K1 entrance: each word y +32 to 0 out of an 8 px blur, 20 f on arrive, 4 f apart; then the selection sweeps in
    behind the accent word (10 f, arrive) and its brass caret lands at the end. Returns when the last word lands. */
export function lineIn(film: Film, line: Line, at: number, o: { stagger?: number; dur?: number } = {}): number {
  const f = film.fps, dur = (o.dur ?? 20) / f, st = (o.stagger ?? 4) / f;
  line.words.forEach((w, i) => film.tl.fromTo(w, { y: 32, filter: 'blur(8px)', opacity: 0 }, { y: 0, filter: 'blur(0px)', opacity: 1, duration: dur, ease: arrive, immediateRender: true, data: { role: 'type' } }, at + i * st));
  const landed = at + (line.words.length - 1) * st + dur;
  if (line.sel) {
    const i = line.words.findIndex((w) => w.contains(line.sel));
    const selAt = at + Math.max(0, i) * st + dur * 0.55;
    film.tl.fromTo(line.sel, { '--sel': 0, '--caret': 0 }, { '--sel': 1, duration: 10 / f, ease: arrive, immediateRender: true, data: { role: 'type' } }, selAt);
    film.tl.fromTo(line.sel, { '--caret': 0 }, { '--caret': 1, duration: 4 / f, ease: ui, immediateRender: false, data: { role: 'type' } }, selAt + 8 / f);
  }
  return landed;
}

/** the line leaves as one, up and out through a mask at the top of each word's own line box (12 f on depart): every word
    takes the same move on the same frame, cut by an edge, never faded (the clip lets the selection and its caret, which
    reach past the glyphs, travel with their word) */
export function lineOut(film: Film, line: Line, at: number, o: { dur?: number } = {}): number {
  const dur = (o.dur ?? 12) / film.fps;
  film.tl.fromTo(line.words, { yPercent: 0, clipPath: 'inset(-30% -25% -30% -25%)' }, { yPercent: -100, clipPath: 'inset(100% -25% 0% -25%)', duration: dur, ease: depart, immediateRender: false, data: { role: 'type' } }, at);
  film.tl.set(line.words, { immediateRender: false, visibility: 'hidden' }, at + dur);
  return at + dur;
}

/* ───────── a count that rolls (the steps disclosure: "2 steps" to "6 steps") ───────── */

/** replace the number at the start of a label with a slot that rolls through `from`..`to` (mono, tabular) */
export function roller(label: HTMLElement, from: number, to: number): { strip: HTMLElement; step: (film: Film, at: number, n: number) => void } {
  const rest = (label.textContent ?? '').replace(/^\s*\d+/, '');
  label.textContent = '';
  const slot = document.createElement('span');
  slot.className = 'a3-roll';
  const strip = document.createElement('span');
  strip.className = 'a3-roll__strip';
  for (let n = from; n <= to; n++) { const d = document.createElement('span'); d.textContent = String(n); strip.appendChild(d); }
  slot.appendChild(strip);
  label.append(slot, document.createTextNode(rest));
  let cur = from;
  return {
    strip,
    step(film, at, n) {
      /* the product changes the count at once; the film rolls it up one digit in the product's --dur-2 on --ease */
      film.tl.fromTo(strip, { yPercent: -((cur - from) * 100) / (to - from + 1) }, { yPercent: -((n - from) * 100) / (to - from + 1), duration: 0.2, ease: ui, immediateRender: false, data: { role: 'ui' } }, at);
      cur = n;
    }
  };
}

/* ───────── words into bars (the camera leaves them) ───────── */

export interface Bar { bar: HTMLElement; text: HTMLElement; px: number }

/** for every text leaf under `root`, a bar per line box, placed in `host` (an unzoomed box in world px whose top-left
    is `origin`); `tone` picks the look's bar ink from the text's own colour (strong, body, quiet) */
export function barsFor(root: HTMLElement, host: HTMLElement, origin: [number, number], skip?: (el: HTMLElement) => boolean): Bar[] {
  const out: Bar[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set<HTMLElement>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !(n.textContent ?? '').trim() || el.closest('svg') || (skip && skip(el))) continue;
    if (getComputedStyle(el).display === 'none') continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const zoom = zoomOf(el);
    const px = fs * zoom;
    const tone = toneOf(getComputedStyle(el).color);
    for (const r of [...range.getClientRects()]) {
      if (r.width < 2) continue;
      const b = document.createElement('span');
      b.className = 'a3-bar a3-bar--' + tone;
      const hgt = Math.max(4, px * 0.42);
      b.style.cssText = 'left:' + (r.left - origin[0]).toFixed(1) + 'px;top:' + (r.top + r.height / 2 - hgt / 2 - origin[1]).toFixed(1) + 'px;width:' + r.width.toFixed(1) + 'px;height:' + hgt.toFixed(1) + 'px;border-radius:' + (hgt / 2).toFixed(1) + 'px';
      host.appendChild(b);
      out.push({ bar: b, text: el, px });
    }
    seen.add(el);
  }
  return out;
}
function zoomOf(el: HTMLElement): number {
  let z = 1;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) { const v = parseFloat(getComputedStyle(n).zoom || '1'); if (v && v !== 1) z *= v; }
  return z;
}
function toneOf(c: string): 's' | 'm' | 'q' {
  const m = /(\d+(\.\d+)?)/g, v = (c.match(m) ?? ['200', '200', '200']).slice(0, 3).map(Number);
  const l = 0.2126 * (v[0] ?? 0) + 0.7152 * (v[1] ?? 0) + 0.0722 * (v[2] ?? 0);
  return l > 215 ? 's' : l > 170 ? 'm' : 'q';
}

/** collapse text into its bars over `dur`: each bar sweeps in from the line's start in reading order while the text is
    cut away at the bar's leading edge (one opaque edge travelling, never a fade), then the text is hidden */
export function collapse(film: Film, bars: Bar[], at: (b: Bar) => number, o: { dur?: number; ease?: Ease } = {}): void {
  const dur = (o.dur ?? 9) / film.fps, ease = o.ease ?? travel;
  const done = new Set<HTMLElement>();
  for (const b of bars) {
    const t = at(b);
    film.tl.fromTo(b.bar, { scaleX: 0 }, { scaleX: 1, duration: dur, ease, immediateRender: true, data: { role: 'lod' } }, t);
    if (done.has(b.text)) continue;
    done.add(b.text);
    film.tl.fromTo(b.text, { clipPath: 'inset(-20% 0% -20% 0%)' }, { clipPath: 'inset(-20% 0% -20% 100%)', duration: dur, ease, immediateRender: false, data: { role: 'lod' } }, t);
    film.tl.set(b.text, { immediateRender: false, visibility: 'hidden' }, t + dur);
  }
}

