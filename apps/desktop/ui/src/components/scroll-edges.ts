/* The scroll area's edge fade (components.css, "scroll area"; R-scroll-9). A scroller never cuts its content with a straight
   edge: where more lies beyond an edge, the content fades out over --scroll-fade at that edge; at its start and at its end there
   is nothing beyond, so there is no fade. This module keeps the flags the stylesheet reads, on every .ui-scroll:
     data-more-top, data-more-bottom   (a vertical scroller, and a code block that scrolls both ways)
     data-more-left, data-more-right   (a sideways strip, and a code block that scrolls both ways)
   It reads a scroller when it scrolls (one capture listener for the whole document), when it or its content changes size (one
   ResizeObserver on each scroller and on its children), and when scrollers or their children appear (one MutationObserver), then
   writes the flags that changed in the next frame: reads first, writes after, so a frame never interleaves them. */

const SLACK = 1;   /* px: a fractional scroll position at an end is still the end */

export interface Edges { top: boolean; bottom: boolean; left: boolean; right: boolean }

/** what lies beyond each edge of a scroller now */
export function edgesOf(el: Element): Edges {
  const x = el.classList.contains('ui-scroll--x'), both = el.classList.contains('ui-scroll--both'), y = !x || both;
  const sx = x || both;
  const top = y && el.scrollTop > SLACK, bottom = y && el.scrollTop + el.clientHeight < el.scrollHeight - SLACK;
  const left = sx && el.scrollLeft > SLACK, right = sx && el.scrollLeft + el.clientWidth < el.scrollWidth - SLACK;
  return { top, bottom, left, right };
}

const FLAGS = [['top', 'data-more-top'], ['bottom', 'data-more-bottom'], ['left', 'data-more-left'], ['right', 'data-more-right']] as const;

/** write a scroller's flags from `e` (only those that changed) */
function write(el: Element, e: Edges): void {
  for (const [k, attr] of FLAGS) if (el.hasAttribute(attr) !== e[k]) el.toggleAttribute(attr, e[k]);
}

/** read and write one scroller now (a caller that just changed a scroller's content or position and cannot wait a frame) */
export function update(el: Element): void { write(el, edgesOf(el)); }

let started = false;
const pending = new Set<Element>();
let frame = 0;
let ro: ResizeObserver | null = null;
let mo: MutationObserver | null = null;
const watched = new WeakSet<Element>();

function flush(): void {
  frame = 0;
  const list = [...pending].filter((el) => el.isConnected);
  pending.clear();
  const read = list.map((el) => edgesOf(el));
  list.forEach((el, i) => { write(el, read[i] as Edges); });
}
function soon(el: Element): void {
  pending.add(el);
  if (!frame) frame = requestAnimationFrame(flush);
}
/** the scroller an observed element belongs to: itself, or the scroller it is a child of */
const scrollerOf = (el: Element): Element | null => (el.classList.contains('ui-scroll') ? el : el.parentElement?.classList.contains('ui-scroll') ? el.parentElement : null);

function watch(sc: Element): void {
  if (!watched.has(sc)) { watched.add(sc); ro?.observe(sc); }
  for (const c of sc.children) if (!watched.has(c)) { watched.add(c); ro?.observe(c); }
  soon(sc);
}
function scan(root: Element): void {
  if (root.classList.contains('ui-scroll')) watch(root);
  for (const sc of root.querySelectorAll('.ui-scroll')) watch(sc);
}

/** start keeping every scroller's edge flags (once, from main and the lab's frame); a page without the observers keeps plain edges */
export function start(): void {
  if (started || typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function') return;
  started = true;
  ro = new ResizeObserver((entries) => { for (const en of entries) { const sc = scrollerOf(en.target); if (sc) soon(sc); } });
  mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target as Element;
      if (t.classList?.contains('ui-scroll')) watch(t);   /* a child came or went: its children are watched again, its size read */
      for (const nd of m.addedNodes) if (nd.nodeType === 1) scan(nd as Element);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('scroll', (e) => { const t = e.target; if (t instanceof Element && t.classList.contains('ui-scroll')) soon(t); }, { capture: true, passive: true });
  scan(document.documentElement);
}

export const scrollEdges = { start, update, edgesOf };
