/* KEYMAP.md section 8, roving tabindex: each region of the dock (the bot row, the grid, a session's switcher, the queue
   at rest) is one Tab stop and the arrows move real focus inside it, so a screen reader announces each orb by its name.
   The row and the grid share one index (S.rowIdx: the bots, then "+"), so Up from the row lands on the same bot in the
   grid. The index maths are pure and tested; the DOM part follows them. */
import { $$, clamp } from '../../core/dom';
import { S, X } from './ctx';

/** the item a Left / Right / Up / Down / Home / End press goes to, in a line of n (not clamped: `rove` clamps) */
export const stepIndex = (key: string, i: number, n: number): number =>
  key === 'Home' ? 0 : key === 'End' ? n - 1 : i + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1);

/** the number of columns of a grid whose items have these tops: the items on the first line */
export function columnsOf(tops: readonly number[]): number {
  const first = tops[0];
  const k = tops.findIndex((t) => t !== first);
  return Math.max(1, k > 0 ? k : tops.length);
}

/** The grid's move in two dimensions. Left / Right / Home / End walk the items in order (so they wrap by rows); Up
    goes a row up and stays on the first row; Down goes a row down, clamped to the last item, and from the last row it
    leaves the grid (null: back to the bot row, on the same bot). */
export function gridTarget(key: string, i: number, n: number, cols: number): number | null {
  if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') return stepIndex(key, i, n);
  if (key === 'ArrowUp') return i - cols >= 0 ? i - cols : i;
  if (Math.floor(i / cols) === Math.floor((n - 1) / cols)) return null;
  return Math.min(i + cols, n - 1);
}

/** one tab stop per region: the current item (the dock's own index for the row and the grid) */
export function syncRoving(): void {
  const root = X.root;
  S.rowIdx = clamp(S.rowIdx, 0, S.bots.length);
  for (const box of $$('.dk-row', root)) $$('.dk-bot, .dk-add', box).forEach((el, k) => { el.tabIndex = k === S.rowIdx ? 0 : -1; });
  for (const box of $$('.dk-roster', root)) $$('.ui-row', box).forEach((el, k) => { el.tabIndex = k === S.rowIdx ? 0 : -1; });
  for (const box of $$('.dk-strip', root)) {
    const items = $$('.dk-strip-bot', box);
    const keep = items.find((x) => x === document.activeElement) ?? items.find((x) => x.getAttribute('aria-current') === 'true') ?? items[0];
    items.forEach((x) => { x.tabIndex = x === keep ? 0 : -1; });
  }
  for (const box of $$('.dk-v-wait-norm .dk-cards', root)) {
    const items = $$('.cd-mini', box);
    const keep = items.find((x) => x === document.activeElement) ?? items.find((x) => x.tabIndex === 0) ?? items[0];
    items.forEach((x) => { x.tabIndex = x === keep ? 0 : -1; });
  }
}
/** move focus to items[j] (clamped), making it the region's one tab stop; returns the index it landed on */
export function rove(items: readonly HTMLElement[], i: number, j: number): number {
  if (!items.length) return i;
  const to = clamp(j, 0, items.length - 1);
  items.forEach((el, k) => { el.tabIndex = k === to ? 0 : -1; });
  items[to]?.focus({ preventScroll: true });
  return to;
}
