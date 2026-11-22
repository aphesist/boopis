/* Words become bars as the camera pulls back past the size anyone can read (look.md 5: "secondary lines become bars",
   the text's own length at half its em, rounded), and back into words as it pushes in again. The change is a wipe: one
   edge crosses each line from its start, the words on one side of it, the bar on the other (a mask, never a fade). */
import type { Film } from '../../engine/film';
import type { Stage } from '../../engine/stage';
import { h } from '../../../look/src/stage';
import { travel, type Ease } from './util';

export interface Run { el: HTMLElement; bars: HTMLElement[]; box: { l: number; w: number } }
type Tone = 'q' | 's' | '';

/** the lines of every piece of text under `root` (skipping `skip`), with a bar for each line in the nearest placed box */
export function runsOf(stage: Stage, root: HTMLElement, o: { skip?: string; tone?: (el: HTMLElement) => Tone; placeholder?: boolean } = {}): Run[] {
  const k = stage.root.getBoundingClientRect().width / stage.width;
  const out: Run[] = [];
  /* where every element rests: transforms off while measuring (put back as they were) */
  const all = [root, ...root.querySelectorAll<HTMLElement>('*')];
  const saved = all.map((e) => e.style.transform);
  for (const e of all) e.style.transform = 'none';
  const visit = (el: HTMLElement): void => {
    if (o.skip && el.matches(o.skip)) return;
    if (el.closest('svg') || getComputedStyle(el).display === 'none') return;
    const texts = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
    const isInput = el.classList.contains('ui-composer__input') && o.placeholder;
    if (texts.length || isInput) {
      let rects: DOMRect[] = [];
      if (isInput) {
        /* the placeholder is the field's ::before: measure the same words set in the field's own font */
        const probe = document.createElement('span');
        probe.textContent = el.getAttribute('data-placeholder') ?? '';
        probe.style.cssText = 'position:absolute;white-space:nowrap;visibility:hidden';
        el.appendChild(probe);
        const cs = getComputedStyle(el), r = el.getBoundingClientRect(), pr = probe.getBoundingClientRect(), z = r.width / el.offsetWidth;
        rects = [new DOMRect(r.left + parseFloat(cs.paddingLeft) * z, r.top + parseFloat(cs.paddingTop) * z, pr.width, pr.height)];
        probe.remove();
      } else {
        for (const t of texts) { const rg = document.createRange(); rg.selectNodeContents(t); rects.push(...rg.getClientRects()); }
      }
      rects = rects.filter((r) => r.width > 1 && r.height > 1);
      if (rects.length) {
        /* one bar per line: rects on the same line merge */
        const lines: DOMRect[] = [];
        for (const r of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.top + last.height / 2 - (r.top + r.height / 2)) < r.height * 0.4) { const l = Math.min(last.left, r.left), rr = Math.max(last.right, r.right); lines[lines.length - 1] = new DOMRect(l, Math.min(last.top, r.top), rr - l, Math.max(last.bottom, r.bottom) - Math.min(last.top, r.top)); }
          else lines.push(r);
        }
        const place = el.closest<HTMLElement>('.ui-place') ?? root;
        const pr = place.getBoundingClientRect();
        const fs = parseFloat(getComputedStyle(el).fontSize) * (el.getBoundingClientRect().width / Math.max(1, el.offsetWidth));
        const tone = o.tone ? o.tone(el) : '';
        const bars = lines.map((ln) => {
          const hh = Math.max(4, fs * 0.42) / k, w = ln.width / k;
          const b = h('i', 'a2-bar', '', { left: ((ln.left - pr.left) / k).toFixed(2) + 'px', top: ((ln.top + ln.height / 2 - pr.top) / k - hh / 2).toFixed(2) + 'px', width: w.toFixed(2) + 'px', height: hh.toFixed(2) + 'px' });
          if (tone) b.dataset[tone] = '';
          place.appendChild(b);
          return b;
        });
        const er = el.getBoundingClientRect();
        const l = Math.min(...lines.map((x) => x.left)), r = Math.max(...lines.map((x) => x.right));
        out.push({ el, bars, box: { l: (l - er.left) / er.width, w: (r - l) / er.width } });
      }
    }
    for (const c of el.children) if (c instanceof HTMLElement) visit(c);
  };
  visit(root);
  all.forEach((e, i) => { e.style.transform = saved[i] ?? ''; });
  return out;
}

/** the runs' state over time: words or bars, changing by a wipe that crosses each line from its start, in reading
    order. `start` is the state before the first change. */
export interface Bars { to(state: 'bar' | 'text', at: number, o?: { dur?: number; stagger?: number; ease?: Ease }): number }
export function bars(film: Film, runs: Run[], start: 'bar' | 'text' = 'text', o: { hiddenBefore?: Map<Run, number> } = {}): Bars {
  interface Seg { t0: number; to: 'bar' | 'text'; p: { k: number } }
  const segs: Seg[][] = runs.map(() => []);
  const apply = (run: Run, state: 'bar' | 'text', k: number): void => {
    /* k: how far the edge has crossed (0 = all `from`, 1 = all `state`) */
    const e = run.box.l + run.box.w * k;
    const toBar = state === 'bar';
    const textClip = k <= 0 ? (toBar ? '' : 'inset(0 100% 0 0)') : k >= 1 ? (toBar ? 'inset(0 0 0 100%)' : '') : toBar ? 'inset(-20% -2% -20% ' + (e * 100).toFixed(2) + '%)' : 'inset(-20% ' + ((1 - e) * 100).toFixed(2) + '% -20% -2%)';
    if (run.el.style.clipPath !== textClip) run.el.style.clipPath = textClip;
    for (const b of run.bars) {
      const shown = toBar ? k > 0 : k < 1;
      const v = shown ? '' : 'hidden';
      if (b.style.visibility !== v) b.style.visibility = v;
      b.style.clipPath = toBar ? 'inset(0 ' + ((1 - k) * 100).toFixed(2) + '% 0 0)' : 'inset(0 0 0 ' + (k * 100).toFixed(2) + '%)';
    }
  };
  runs.forEach((run, i) => {
    film.onRender((t) => {
      const list = segs[i]!;
      let cur: Seg | null = null;
      for (const sg of list) if (sg.t0 <= t + 1e-9) cur = sg;
      if (!cur) apply(run, start, 1); else apply(run, cur.to, cur.p.k);
      const hb = o.hiddenBefore?.get(run);
      if (hb != null && t < hb - 1e-9) for (const b of run.bars) b.style.visibility = 'hidden';
    }, 2);
  });
  return {
    to(state, at, o = {}) {
      const dur = o.dur ?? 9 / 60, st = o.stagger ?? 0.4 / 60;
      runs.forEach((_, i) => {
        const p = { k: 0, __name: 'a2-wipe' };
        const t0 = at + i * st;
        film.tl.fromTo(p, { k: 0 }, { k: 1, duration: dur, ease: o.ease ?? travel, immediateRender: false, data: { role: 'ui' } }, t0);
        segs[i]!.push({ t0, to: state, p });
        segs[i]!.sort((a, b) => a.t0 - b.t0);
      });
      return at + (runs.length - 1) * st + dur;
    }
  };
}
