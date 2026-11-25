/* Long names. Where the space is fixed (list rows, bylines, the sheet, the button) a name is one line with an
   ellipsis; the header wraps to two lines. A name that does not fit shows whole in the library's tooltip; the
   accessible name and hx:title always carry it whole. Checked after each render and on resize, one frame later. */
import { bot, railOn, S } from './model';

export { isClipped, tipIfClipped, tipsIfClipped } from '../../core/clip';
import { tipsIfClipped } from '../../core/clip';

let raf = 0;
function runChecks(): void {
  const spots: Array<readonly [HTMLElement | null | undefined, HTMLElement | null | undefined, string]> = [];
  if (!railOn()) for (const [id, r] of S.rows) { const b = bot(id); if (b) spots.push([r.btn, r.li.querySelector<HTMLElement>('.k7-lrow__title'), b.name]); }
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
let fontsWatched = false;
/** check again whenever `node` changes size, and when a web font finishes loading: a name measured in the fallback
    font can fit and then be cut once the real font, often wider, arrives (or the other way), while nothing resizes */
export function watchClips(node: Element | null): void {
  if (!fontsWatched && typeof document !== 'undefined' && document.fonts) {
    fontsWatched = true;
    document.fonts.addEventListener('loadingdone', () => checkClips());
    void document.fonts.ready.then(() => checkClips());
  }
  if (!node || typeof ResizeObserver !== 'function') return;
  obs ??= new ResizeObserver(() => checkClips());
  obs.observe(node);
}
