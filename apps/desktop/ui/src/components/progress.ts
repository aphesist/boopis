/* Progress as dots, never a bar (design system 14.27, F18). Determinate: the library's measure row with the dots filled in
   proportion, and the percent beside it in mono; indeterminate: one dot travelling along the row, at rest in the middle
   under reduced motion. The element is the row itself made a `progressbar`, as the design's own mod view does it
   (`design/v6/components/mod-view.js`, `buildProgress`), so there is one dot row and one place that fills it. */
import { html } from './html';

export interface ProgressOpts {
  /** 0 to 100; null when nothing is known (the travelling dot) */
  value: number | null;
  /** accessible name, and what it measures ("Unpacking Hermes") */
  label: string;
  /** dots in the row, 3 to 20 */
  dots?: number;
}

const GAP = 10; /* a dot (4px) and the library's gap (6px) */
const clampDots = (n: number | undefined): number => Math.max(3, Math.min(20, Math.round(n ?? 10) || 10));
const clamp = (v: number): number => Math.max(0, Math.min(100, v));

/** the whole indicator: the dot row (a `progressbar`) and the percent, when it is known */
export function progressDots(o: ProgressOpts): HTMLElement {
  const n = clampDots(o.dots);
  const wrap = document.createElement('span');
  wrap.className = 'ui-progress';
  const holder = document.createElement('span');
  holder.innerHTML = html.measure({ variant: 'row', used: 0, total: 100, dots: n, label: o.label });
  const bar = holder.firstElementChild as HTMLElement;
  bar.classList.add('ui-progress__bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.style.setProperty('--run', `${String((n - 1) * GAP)}px`);
  const pct = document.createElement('span');
  pct.className = 'ui-progress__pct';
  wrap.append(bar, pct);
  setProgress(wrap, o.value, o.label);
  return wrap;
}

/** change what an indicator shows, in place (progress arrives many times a second: nothing is redrawn) */
export function setProgress(wrap: HTMLElement, value: number | null, label?: string): void {
  const bar = wrap.querySelector<HTMLElement>('.ui-progress__bar');
  const pct = wrap.querySelector<HTMLElement>('.ui-progress__pct');
  if (!bar || !pct) return;
  if (label) bar.setAttribute('aria-label', label);
  const cells = [...bar.querySelectorAll<HTMLElement>(':scope > i:not(.ui-progress__run)')];
  const known = value !== null && Number.isFinite(value);
  let run = bar.querySelector<HTMLElement>(':scope > .ui-progress__run');
  if (known) {
    const v = clamp(value);
    const on = Math.round((v / 100) * cells.length);
    cells.forEach((c, i) => { if (i < on) c.setAttribute('data-on', ''); else c.removeAttribute('data-on'); });
    bar.setAttribute('aria-valuenow', String(Math.round(v)));
    bar.removeAttribute('aria-busy');
    bar.removeAttribute('data-indeterminate');
    run?.remove();
    pct.textContent = `${String(Math.round(v))}%`;
  } else {
    cells.forEach((c) => { c.removeAttribute('data-on'); });
    bar.removeAttribute('aria-valuenow');
    bar.setAttribute('aria-busy', 'true');
    bar.setAttribute('data-indeterminate', '');
    if (!run) { run = document.createElement('i'); run.className = 'ui-progress__run'; bar.append(run); }
    pct.textContent = '';
  }
}
