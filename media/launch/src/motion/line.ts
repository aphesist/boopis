/* Film lines without masks: the craft bible's K1 word rise and K5 self-editing line, done so that no invisible box ever
   cuts a letter (the critique's E6: masks that sliced words mid-rise and mid-exit, A2-02, A2-06).

     const ws = words(el, 'the plans you already pay for', { accent: ['already'] })
     wordRise(film, ws, { at })          K1 in: each word y +32 px to 0, blur 8 to 0, opacity 0 to 1, 20 f on arrive,
                                         4 f apart. The words are plain inline blocks: nothing clips them, the blur
                                         included
     lineExit(film, el, { at })          K1 out: the whole line y 0 to -16 px, blur 0 to 6 px, opacity 1 to 0, 12 f on
                                         depart; never word by word
     selfEdit(film, el, [{ at, word: 'pay', to: 'use' }, ...], { name: 'kai', color })
                                         K5: a selection highlights the word (8 f), a caret with a name flag sits at
                                         it, the word is replaced by type-on (K2: 28 cps, each character over 5 f), the
                                         selection clears; the caret travels to the next edit. Space the edits on the
                                         beat, faster each time (beats 2, 2, 1, 1)

   Both check what they are given: a word or line inside something that clips (overflow hidden or clip, a clip-path, a
   mask) is reported in film.warnings, since that box would cut the rise, the blur or the exit. */
import type { Film } from '../engine/film';
import { arrive, depart, travel, ui, type Ease } from './ease';

/** set a line as plain word spans (inline blocks, so transforms apply; no masks); returns the words */
export function words(el: HTMLElement, text?: string, o: { accent?: string[] } = {}): HTMLElement[] {
  if (text != null || !el.querySelector('.film-w')) {
    const src = text ?? el.textContent ?? '';
    el.textContent = '';
    for (const w of src.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(' ')); continue; }
      const s = document.createElement('span');
      s.className = 'film-w' + (o.accent?.includes(w.replace(/[^\p{L}\p{N}'-]/gu, '')) ? ' film-accent' : '');
      s.textContent = w;
      el.appendChild(s);
    }
  }
  const ws = [...el.querySelectorAll<HTMLElement>('.film-w')];
  for (const w of ws) w.style.display = 'inline-block';
  return ws;
}

/** the nearest ancestor (below the stage) that would clip `el`, or null */
export function clipper(el: Element): HTMLElement | null {
  for (let n = el.parentElement; n && !n.classList.contains('film-stage'); n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY) || (cs.clipPath && cs.clipPath !== 'none') || (cs.maskImage && cs.maskImage !== 'none')) return n;
  }
  return null;
}
function checkUnclipped(film: Film, els: Element[], what: string): void {
  const seen = new Set<HTMLElement>();
  for (const e of els) {
    const c = clipper(e);
    if (c && !seen.has(c)) { seen.add(c); film.warnings.push(what + ': "' + (e.textContent ?? '').trim().slice(0, 30) + '" sits inside a clipping box (' + c.tagName.toLowerCase() + '.' + (c.className || '').toString().split(/\s+/)[0] + '): it will cut the move'); }
  }
}

/** K1 in: each word rises 32 px, unblurs 8 px and fades in over 20 f on arrive, 4 f after the one before */
export function wordRise(film: Film, ws: HTMLElement[], o: { at: number; dur?: number; stagger?: number; ease?: Ease; y?: number; blur?: number }): number {
  checkUnclipped(film, ws, 'wordRise');
  const dur = o.dur ?? 20 / film.fps, st = o.stagger ?? 4 / film.fps;
  ws.forEach((w, i) => film.tl.fromTo(w, { y: o.y ?? 32, filter: 'blur(' + (o.blur ?? 8) + 'px)', opacity: 0 },
    { y: 0, filter: 'blur(0px)', opacity: 1, duration: dur, ease: o.ease ?? arrive, data: { role: 'type' } }, o.at + i * st));
  return o.at + (ws.length - 1) * st + dur;
}

/** K1 out: the whole line up 16 px, blur 6 px, opacity to 0 over 12 f on depart (never word by word) */
export function lineExit(film: Film, el: HTMLElement, o: { at: number; dur?: number; y?: number; blur?: number }): number {
  checkUnclipped(film, [el], 'lineExit');
  const dur = o.dur ?? 12 / film.fps;
  film.tl.to(el, { y: -(o.y ?? 16), filter: 'blur(' + (o.blur ?? 6) + 'px)', opacity: 0, duration: dur, ease: depart, immediateRender: false, data: { role: 'type' } }, o.at);
  return o.at + dur;
}

export interface Edit { at: number; word: number | string; to: string }
export interface SelfEditOptions {
  /** the name on the caret's flag (a bot's name) and its colour (the bot's colour); no name, no flag */
  name?: string; color?: string;
  /** typing speed (K2: 25 to 30 a second) and each character's fade, frames */
  cps?: number; fade?: number;
  /** the selection's sweep and the pause before typing, frames */
  select?: number; hold?: number;
  /** how long the caret stays after the last edit, frames (then it leaves over 8) */
  linger?: number;
}

/** K5: the line edits itself, word by word, with a named caret; returns when the last edit is typed */
export function selfEdit(film: Film, line: HTMLElement, edits: Edit[], o: SelfEditOptions = {}): number {
  const f = 1 / film.fps, cps = o.cps ?? 28, fade = (o.fade ?? 5) * f, sel = (o.select ?? 8) * f, hold = (o.hold ?? 4) * f;
  const colour = o.color ?? 'var(--brass, #c8a66a)';
  let ws = words(line);
  checkUnclipped(film, ws, 'selfEdit');
  if (getComputedStyle(line).position === 'static') line.style.position = 'relative';
  line.style.isolation = 'isolate';   /* the selection sits behind the words, not behind the plate under the line */

  interface Plan { old: HTMLElement; neu: HTMLElement; sel0: number; type0: number; end: number; highlight: HTMLElement }
  const plans: Plan[] = [];
  for (const e of [...edits].sort((a, b) => a.at - b.at)) {
    const old = typeof e.word === 'number' ? ws[e.word] : ws.find((w) => w.textContent === e.word);
    if (!old) { film.warnings.push('selfEdit: no word "' + e.word + '" in "' + (line.textContent ?? '').slice(0, 40) + '"'); continue; }
    const neu = document.createElement('span');
    neu.className = old.className;
    neu.style.display = 'inline-block';
    const chars = [...e.to].map((ch) => { const c = document.createElement('span'); c.textContent = ch; c.style.display = 'none'; neu.appendChild(c); return c; });
    old.after(neu);
    const type0 = e.at + sel + hold;
    /* the selection: a box behind the word, the word's own box with the same air each side, sweeping from its start */
    const highlight = document.createElement('span');
    highlight.className = 'film-select';
    highlight.style.cssText = 'position:absolute;z-index:-1;pointer-events:none;transform-origin:0 50%;visibility:hidden;border-radius:0.08em;background:color-mix(in srgb, ' + colour + ' 30%, transparent)';
    line.appendChild(highlight);
    film.tl.fromTo(highlight, { scaleX: 0 }, { scaleX: 1, duration: sel, ease: ui, immediateRender: false, data: { role: 'type' } }, e.at);
    /* typing replaces the selection: the old word and the selection go at the first key, the new word grows a key at a
       time (sets: the renderer treats each as an instant change and keeps the shutter on one side) */
    film.tl.set(old, { display: 'none' }, type0);
    chars.forEach((c, i) => {
      film.tl.set(c, { display: 'inline' }, type0 + i / cps);
      film.tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: fade, ease: arrive, immediateRender: false, data: { role: 'type', blur: false } }, type0 + i / cps);
    });
    plans.push({ old, neu, sel0: e.at, type0, end: type0 + chars.length / cps, highlight });
    ws = ws.map((w) => (w === old ? neu : w));
  }
  if (!plans.length) return edits[0]?.at ?? 0;

  /* the caret and its flag */
  const caret = document.createElement('span');
  caret.className = 'film-caret';
  caret.style.cssText = 'position:absolute;left:0;top:0;width:0.055em;pointer-events:none;opacity:0;background:' + colour;
  if (o.name) {
    const flag = document.createElement('span');
    flag.className = 'film-caret__flag';
    flag.textContent = o.name;
    flag.style.cssText = 'position:absolute;left:0;bottom:100%;margin-bottom:0.04em;padding:0.05em 0.22em 0.07em;font:600 0.26em/1 var(--sans, sans-serif);letter-spacing:0;white-space:nowrap;border-radius:0.3em 0.3em 0.3em 0;color:var(--bg-0, #fff);background:' + colour;
    caret.appendChild(flag);
  }
  line.appendChild(caret);
  const pad = 0.06;   /* em of air either side of a selected word */
  const linger = (o.linger ?? 18) * f, leave = 8 * f, arriveIn = 8 * f;
  const endOf = (el: HTMLElement): [number, number, number] => [el.offsetLeft + el.offsetWidth, el.offsetTop, el.offsetHeight];
  const startOf = (el: HTMLElement): [number, number, number] => [el.offsetLeft, el.offsetTop, el.offsetHeight];
  const smooth = (x: number): number => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
  const last = plans[plans.length - 1]!;
  film.onRender((t) => {
    /* the selections: shown from their sweep to the first key, sized to the word as it is laid out now */
    for (const p of plans) {
      const on = t >= p.sel0 - 1e-9 && t < p.type0 - 1e-9;
      const v = on ? '' : 'hidden';
      if (p.highlight.style.visibility !== v) p.highlight.style.visibility = v;
      if (on) {
        const em = parseFloat(getComputedStyle(p.old).fontSize) || 16, [x, y, h] = startOf(p.old);
        p.highlight.style.left = (x - pad * em).toFixed(2) + 'px';
        p.highlight.style.top = y.toFixed(2) + 'px';
        p.highlight.style.width = (p.old.offsetWidth + 2 * pad * em).toFixed(2) + 'px';
        p.highlight.style.height = h.toFixed(2) + 'px';
      }
    }
    /* the caret: at the end of the selection, then of what is typed; travelling between edits; in and out */
    /* the edit the caret belongs to: the last one started (the travel toward the next is the end of this one) */
    let i = plans.findIndex((_, k) => t < (plans[k + 1]?.sel0 ?? Infinity));
    if (i < 0) i = plans.length - 1;
    const p = plans[i]!, next = plans[i + 1];
    const here = (q: Plan): [number, number, number] => (t < q.type0 ? endOf(q.old) : endOf(q.neu));
    let pos = here(p);
    if (next && t >= next.sel0 - arriveIn) {
      const k = travel(Math.min(1, (t - (next.sel0 - arriveIn)) / arriveIn)), b = endOf(next.old);
      pos = [pos[0] + (b[0] - pos[0]) * k, pos[1] + (b[1] - pos[1]) * k, pos[2] + (b[2] - pos[2]) * k];
    }
    const first = plans[0]!;
    const op = smooth((t - (first.sel0 - arriveIn)) / arriveIn) * (1 - smooth((t - (last.end + linger)) / leave));
    caret.style.opacity = op.toFixed(3);
    caret.style.transform = 'translate(' + pos[0].toFixed(2) + 'px,' + pos[1].toFixed(2) + 'px)';
    caret.style.height = pos[2].toFixed(2) + 'px';
  });
  return last.end;
}
