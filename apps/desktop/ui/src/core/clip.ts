/* Long text cut to fit: a name or a line that does not fit shows whole in the library's tooltip while it is cut, and the
   accessible name always carries it whole (apps/desktop/AGENTS.md, Names and long names). One implementation for every module
   that cuts text: the bots' rows and sheets (modules/bots/clips.ts), the store's and the connectors' item rows. */

/** is the text cut, in width (an ellipsis) or in height (a line clamp)? */
export const isClipped = (el: HTMLElement): boolean => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;

/** give `host` the whole text as its tooltip while `textEl` is cut, and take it back when it is not; a tooltip the
    host already had (the rail's) is never touched */
export function tipIfClipped(host: HTMLElement | null | undefined, textEl: HTMLElement | null | undefined, full: string): void {
  tipsIfClipped([[host, textEl, full]]);
}

/** the same as `tipIfClipped` for many spots: every measurement first, then every write. Measuring one, writing its
    tooltip attribute and measuring the next makes the browser lay the page out again for each spot. A spot whose text is
    cut in any of its parts (`textEl` as a list) counts as cut. */
export function tipsIfClipped(spots: ReadonlyArray<readonly [HTMLElement | null | undefined, HTMLElement | readonly (HTMLElement | null)[] | null | undefined, string]>): void {
  const todo: Array<[HTMLElement, string, boolean]> = [];
  for (const [host, textEl, full] of spots) {
    const parts = (Array.isArray(textEl) ? textEl : [textEl]).filter((x): x is HTMLElement => !!x && x.isConnected);
    if (!host || !parts.length) continue;
    if (host.hasAttribute('data-tip') && !host.hasAttribute('data-tip-auto')) continue;
    todo.push([host, full, parts.some(isClipped)]);
  }
  for (const [host, full, clipped] of todo) {
    if (clipped) { host.setAttribute('data-tip', full); host.setAttribute('data-tip-auto', ''); }
    else if (host.hasAttribute('data-tip-auto')) { host.removeAttribute('data-tip'); host.removeAttribute('data-tip-auto'); }
  }
}

/** the spots of every item row under `root` (the kit's `.ui-row--item`): the row shows its title and its line whole while either is cut */
export function clipSpots(root: ParentNode): Array<readonly [HTMLElement, readonly (HTMLElement | null)[], string]> {
  return [...root.querySelectorAll<HTMLElement>('.ui-row--item')].map((r) => {
    const t = r.querySelector<HTMLElement>('.ui-row__title'), l = r.querySelector<HTMLElement>('.ui-row__sub');
    return [r, [t, l], [t?.textContent ?? '', l?.textContent ?? ''].filter(Boolean).join('. ')] as const;
  });
}
