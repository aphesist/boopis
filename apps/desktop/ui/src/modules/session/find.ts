/* find in a conversation (6e): where the words are, as ranges the CSS Custom Highlight API washes (nothing in the thread is rewritten) */
export type Hl = { new (...r: Range[]): unknown };
export const highlights = (): { set(k: string, v: unknown): void; delete(k: string): void } | null => (typeof CSS !== 'undefined' && 'highlights' in CSS ? (CSS as unknown as { highlights: { set(k: string, v: unknown): void; delete(k: string): void } }).highlights : null);
export const Highlight = (): Hl | null => ((globalThis as { Highlight?: Hl }).Highlight ?? null);
/** every place `q` is found in the thread's words, in reading order (case is ignored) */
export function findRanges(col: HTMLElement, q: string): Range[] {
  const out: Range[] = [], needle = q.toLowerCase();
  if (!needle) return out;
  const walk = document.createTreeWalker(col, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement?.closest('[aria-hidden="true"], .k7-sr, svg, button, [data-kit~="HoverBar"]')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = (n.nodeValue ?? '').toLowerCase();
    for (let i = t.indexOf(needle); i >= 0; i = t.indexOf(needle, i + needle.length)) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length); out.push(r); }
  }
  return out;
}
