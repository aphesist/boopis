/* Words into bars when nobody can read them any more (look.md 5: "secondary lines become bars"), and back.

   A run is one piece of text (one text element, all its lines); its bars are one per line, the line's own length, 0.42
   em tall, in the text's own ink, laid where the line is and moving with it. A run is words or bars as a WHOLE: it
   swaps only while it is smaller than `below` px on screen (default 12, the size where words stop being words), and
   the swap is a 6-frame dissolve of the whole run at that size, so no edge ever crosses a word that can still be read
   and no mask slices a letter (the critique's E5: the old wipes cut words in half at readable sizes).

     const runs = textRuns(stage, root, { skip: '.ui-avatar' });
     textBars(film, runs, { scale: (t) => cam.stateAt(t).zoom });   // on screen: the run's px x scale(t)

   `scale(t)` is how much bigger than when measured the runs are on screen at film time t (a camera's zoom, to the
   power of the layer's depth off the stage plane; a group's scale); once the timeline is complete the helper finds,
   frame by frame, when each run crosses `below` and schedules its swap there (with 15% hysteresis, so a size hovering
   at the line does not flip back and forth). textBars returns the swaps it made (filled when the film is finalized),
   for logs and tests. The helper owns the opacity of the runs' elements. */
import type { Film } from '../engine/film';
import type { Stage } from '../engine/stage';

export interface TextRun {
  /** the text element */
  el: HTMLElement;
  /** one bar per line, placed in the text's positioned ancestor */
  bars: HTMLElement[];
  /** the text's size on screen when measured (stage px, the stage at 1080p) */
  px: number;
}

const SKIP = 'svg, script, style, template';

/** measure every piece of text under `root` (layout as it is now; transforms are left alone, so measure at rest) and
    make its bars, hidden until textBars shows them */
export function textRuns(stage: Stage, root: HTMLElement, o: { skip?: string; ink?: (el: HTMLElement) => string } = {}): TextRun[] {
  const k = stage.root.getBoundingClientRect().width / stage.width;
  const out: TextRun[] = [];
  const visit = (el: HTMLElement): void => {
    if (el.matches(SKIP) || (o.skip && el.matches(o.skip))) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const texts = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
    if (texts.length) {
      const rects: DOMRect[] = [];
      for (const t of texts) { const rg = document.createRange(); rg.selectNodeContents(t); rects.push(...[...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1)); }
      /* one bar per line: rects on one line merge */
      const lines: DOMRect[] = [];
      for (const r of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.top + last.height / 2 - (r.top + r.height / 2)) < r.height * 0.4) {
          const l = Math.min(last.left, r.left), rr = Math.max(last.right, r.right), t = Math.min(last.top, r.top);
          lines[lines.length - 1] = new DOMRect(l, t, rr - l, Math.max(last.bottom, r.bottom) - t);
        } else lines.push(r);
      }
      const host = (el.offsetParent as HTMLElement | null) ?? root;
      const hr = host.getBoundingClientRect(), hs = host.offsetWidth ? hr.width / host.offsetWidth : 1;
      const fsScreen = parseFloat(cs.fontSize) * (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1);
      const ink = o.ink ? o.ink(el) : 'color-mix(in srgb, ' + cs.color + ' 55%, transparent)';
      const bars = lines.map((ln) => {
        const hh = Math.max(4 * k, fsScreen * 0.42) / hs;
        const b = document.createElement('i');
        b.className = 'film-bar';
        b.style.cssText = 'position:absolute;pointer-events:none;visibility:hidden;opacity:0;background:' + ink + ';left:' + ((ln.left - hr.left) / hs - host.clientLeft).toFixed(2) + 'px;top:' +
          ((ln.top + ln.height / 2 - hr.top) / hs - host.clientTop - hh / 2).toFixed(2) + 'px;width:' + (ln.width / hs).toFixed(2) + 'px;height:' + hh.toFixed(2) + 'px;border-radius:' + (hh / 2).toFixed(2) + 'px';
        host.appendChild(b);
        return b;
      });
      out.push({ el, bars, px: fsScreen / k });
    }
    for (const c of el.children) if (c instanceof HTMLElement) visit(c);
  };
  visit(root);
  return out;
}

export interface BarSwap { run: TextRun; at: number; to: 'bar' | 'text'; px: number }

/** swap each run between words and bars where its on-screen size crosses `below` px (whole runs, 6-frame dissolves).
    The plan is made once the timeline is complete (film.onFinalize), so `scale` may read it, a camera's stateAt
    included; the returned list fills then. */
export function textBars(film: Film, runs: TextRun[], o: { scale: (t: number) => number; below?: number; from?: number; to?: number; dissolve?: number }): BarSwap[] {
  const below = o.below ?? 12, dis = (o.dissolve ?? 6) / film.fps;
  const swaps: BarSwap[] = [];
  const plans = runs.map(() => ({ first: 'text' as 'bar' | 'text', list: [] as { at: number; to: 'bar' | 'text' }[] }));
  film.onFinalize(() => {
    const t0 = o.from ?? film.offset, t1 = o.to ?? film.offset + film.duration;
    /* frame by frame: bars below `below`, words above `below` x 1.15 (between, a run keeps what it is) */
    const state = runs.map((run, i) => { const s = run.px * o.scale(t0) < below ? 'bar' : 'text'; plans[i]!.first = s; return s as 'bar' | 'text'; });
    for (let f = Math.ceil(t0 * film.fps); f / film.fps <= t1 + 1e-9; f++) {
      const t = f / film.fps, k = o.scale(t);
      runs.forEach((run, i) => {
        const px = run.px * k;
        const want = px < below ? 'bar' : px > below * 1.15 ? 'text' : state[i]!;
        if (want !== state[i]) { state[i] = want; plans[i]!.list.push({ at: t, to: want }); swaps.push({ run, at: t, to: want, px: Math.round(px * 10) / 10 }); }
      });
    }
  });
  const smooth = (x: number): number => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
  runs.forEach((run, i) => {
    let lastOp = '', lastVis = '';
    film.onRender((t) => {
      const { first, list } = plans[i]!;
      /* how much bar: the state before the latest swap, dissolving toward that swap's state over `dis` from its time */
      let k = first === 'bar' ? 1 : 0;
      for (const s of list) {
        if (s.at > t + 1e-9) break;
        const p = smooth((t - s.at) / dis);
        k = s.to === 'bar' ? k + (1 - k) * p : k * (1 - p);
      }
      const textOp = (1 - k).toFixed(3), barOp = k.toFixed(3), vis = k > 0.0005 ? '' : 'hidden';
      if (textOp !== lastOp) { run.el.style.opacity = k <= 0.0005 ? '' : textOp; lastOp = textOp; }
      if (vis !== lastVis) { for (const b of run.bars) b.style.visibility = vis; lastVis = vis; }
      for (const b of run.bars) if (b.style.opacity !== barOp) b.style.opacity = barOp;
    }, 2);
  });
  return swaps;
}
