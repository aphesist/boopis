/* ADR-0031: boopis is the product and its engine is invisible. The one exception in the app is an item the user gets from the
   engine's plugin store (a connector, a skill, a plugin): its own name and publisher are shown as they are, even when they say
   "Hermes". A component that draws such an item marks it with `data-store-item`, and the brand checks (the source guard,
   `engine-words.test.ts`, and the rendered-text check below) leave what is inside it alone. */

/** the attribute that marks a store item's own text */
export const STORE_ITEM = 'data-store-item';

/** the components allowed to draw store items, so the guard knows where the attribute may appear */
export const STORE_COMPONENTS: readonly string[] = ['host/connectors.ts'];

/** wrap a store item's markup so the brand checks leave its own name and publisher alone; `display: contents` keeps layout */
export function storeItem(html: string): string {
  return `<div ${STORE_ITEM} style="display:contents">${html}</div>`;
}

/** the rendered texts under `root` that name the engine outside a store item (empty when the screen is clean) */
export function engineWordsIn(root: Node): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof Element) {
      if (n.closest('[' + STORE_ITEM + ']')) continue;
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
        const v = n.getAttribute(a);
        if (v && /hermes/i.test(v)) found.push(v);
      }
    } else if (/hermes/i.test(n.textContent ?? '') && !n.parentElement?.closest('[' + STORE_ITEM + ']')) {
      found.push((n.textContent ?? '').trim());
    }
  }
  return found;
}
