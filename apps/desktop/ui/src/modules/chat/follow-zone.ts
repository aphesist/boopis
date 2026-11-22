/* A conversation's composer floats over its foot, and the conversation's bottom padding follows the composer's height (a custom
   property the view's stylesheet reads). When the composer grows (more lines typed, a hint, who works next, held messages), a
   conversation read to its end stays at its end, so its last entry keeps its distance above the composer and is never under it.
   One implementation for every chat: the session view and the bots' rooms. */

/** whether a scroller shows its end (within a line) */
export const atEnd = (s: HTMLElement, slack = 48): boolean => s.scrollHeight - s.scrollTop - s.clientHeight < slack;

/** measure `zone` into `prop` on `root` whenever it changes size, keeping a conversation that showed its end at its end. A hidden
 *  pane's zone measures 0 and is skipped: the pane on screen owns the value. Returns the measure, to run once at mount. */
export function followZone(zone: HTMLElement, scroll: () => HTMLElement | null, root: () => HTMLElement | null, prop: string): () => void {
  const measure = (): void => {
    const pane = zone.parentElement;
    if (!pane || pane.offsetParent === null) return;
    const sc = scroll(), pin = !!sc && atEnd(sc);
    root()?.style.setProperty(prop, zone.offsetHeight + 'px');
    if (pin && sc) sc.scrollTop = sc.scrollHeight;
  };
  new ResizeObserver(measure).observe(zone);
  return measure;
}
