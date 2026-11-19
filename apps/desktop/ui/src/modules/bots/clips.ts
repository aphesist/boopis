/* Long names. Where the space is fixed (list rows, bylines, the sheet, the button) a name is one line with an
   ellipsis; the header wraps to two lines. A name that does not fit shows whole in the library's tooltip; the
   accessible name and hx:title always carry it whole. Checked after each render and on resize, one frame later. */
import { bot, railOn, S } from './model';

/** is the text cut, in width (an ellipsis) or in height (a line clamp)? */
export const isClipped = (el: HTMLElement): boolean => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;

/** give `host` the whole text as its tooltip while `textEl` is cut, and take it back when it is not; a tooltip the
    host already had (the rail's) is never touched */
export function tipIfClipped(host: HTMLElement | null | undefined, textEl: HTMLElement | null | undefined, full: string): void {
  if (!host || !textEl || !textEl.isConnected) return;
  if (host.hasAttribute('data-tip') && !host.hasAttribute('data-tip-auto')) return;
  if (isClipped(textEl)) { host.setAttribute('data-tip', full); host.setAttribute('data-tip-auto', ''); }
  else if (host.hasAttribute('data-tip-auto')) { host.removeAttribute('data-tip'); host.removeAttribute('data-tip-auto'); }
}

/** the same as `tipIfClipped` for many spots: every measurement first, then every write. Measuring one, writing its
    tooltip attribute and measuring the next makes the browser lay the page out again for each spot. */
export function tipsIfClipped(spots: ReadonlyArray<readonly [HTMLElement | null | undefined, HTMLElement | null | undefined, string]>): void {
  const todo: Array<[HTMLElement, string, boolean]> = [];
  for (const [host, textEl, full] of spots) {
    if (!host || !textEl || !textEl.isConnected) continue;
    if (host.hasAttribute('data-tip') && !host.hasAttribute('data-tip-auto')) continue;
    todo.push([host, full, isClipped(textEl)]);
  }
  for (const [host, full, clipped] of todo) {
    if (clipped) { host.setAttribute('data-tip', full); host.setAttribute('data-tip-auto', ''); }
    else if (host.hasAttribute('data-tip-auto')) { host.removeAttribute('data-tip'); host.removeAttribute('data-tip-auto'); }
  }
}

let raf = 0;
function runChecks(): void {
  const spots: Array<readonly [HTMLElement | null | undefined, HTMLElement | null | undefined, string]> = [];
  if (!railOn()) for (const [id, r] of S.rows) { const b = bot(id); if (b) spots.push([r.btn, r.li.querySelector<HTMLElement>('.ui-row__title'), b.name]); }
  if (S.draftRow && !railOn()) spots.push([S.draftRow.btn, S.draftRow.name, S.draftRow.name.textContent ?? '']);
  const root = S.viewRoot;
  if (root) {
    for (const n of root.querySelectorAll<HTMLElement>('.bt-p-name, .bt-who-name, .bt-sh-name')) spots.push([n, n, n.textContent ?? '']);
    for (const label of root.querySelectorAll<HTMLElement>('.bt-go-label, .bt-arch-label')) spots.push([label.closest('button'), label, label.textContent ?? '']);
  }
  tipsIfClipped(spots);
}
/** check every long-name spot, one frame from now (once, however many ask) */
export function checkClips(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; runChecks(); });
}
let obs: ResizeObserver | null = null;
/** check again whenever `node` changes size */
export function watchClips(node: Element | null): void {
  if (!node || typeof ResizeObserver !== 'function') return;
  obs ??= new ResizeObserver(() => checkClips());
  obs.observe(node);
}
