/* Popovers and the layer every floating thing shares (the kit's Menu and Notice, a select's list): one open at a time, placed
   against an anchor, closed by Esc or an outside press, focus returned to the anchor. `layer` is the same layer for a node that brings
   its own surface (kit.openMenu, the card layer's blank popover). The v6 menu that drew here went at step 7b: the kit's Menu replaced it. */
import { attrs, frag, reduced } from '../core/dom';
import { placeAt } from './place';

export interface PlaceOpts { place?: 'above' | 'below' | undefined; align?: 'start' | 'end' | 'center' | undefined; inset?: number | undefined }
export interface LayerOpts extends PlaceOpts { layer?: Element | undefined; onClose?: (() => void) | undefined }
interface OpenLayer { node: HTMLElement; anchor: HTMLElement | null; onClose: (() => void) | undefined; off(): void }
let openLayer: OpenLayer | null = null;

/* placement is the library's one primitive (place.ts): outside the anchor, flipped and shifted into the window, never
   over a text the anchor's container asks to keep visible */
function place(node: HTMLElement, anchor: HTMLElement, o: PlaceOpts): void {
  const align = o.align ?? 'start';
  placeAt(node, anchor, { side: o.place === 'above' ? 'top' : 'bottom', align, overhang: align === 'start' ? (o.inset ?? 8) : 0 });
}
export function closeLayer(returnFocus?: boolean): void {
  if (!openLayer) return;
  const L = openLayer; openLayer = null;
  L.node.classList.remove('is-in');
  setTimeout(() => L.node.remove(), reduced() ? 0 : 160);
  if (L.anchor) L.anchor.setAttribute('aria-expanded', 'false');
  L.off();
  if (returnFocus !== false && L.anchor && L.anchor.isConnected) L.anchor.focus({ preventScroll: true });
  if (L.onClose) L.onClose();
}
function openLayerAt(anchor: HTMLElement, node: HTMLElement, o: LayerOpts): HTMLElement | null {
  if (openLayer && openLayer.anchor === anchor) { closeLayer(); return null; }
  closeLayer(false);
  /* a modal dialog (Settings) and the first-run view cover the app: a layer opened from inside one lives inside it */
  (o.layer ?? anchor.closest('dialog, [data-layer-host]') ?? document.getElementById('hx-app') ?? document.body).appendChild(node);
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  place(node, anchor, o);
  requestAnimationFrame(() => node.classList.add('is-in'));
  const outside = (e: Event): void => { const t = e.target as Node; if (!node.contains(t) && !(anchor && anchor.contains(t))) closeLayer(false); };
  const onResize = (): void => closeLayer(false);
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', onResize);
  openLayer = { node, anchor, onClose: o.onClose, off() { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', onResize); } };
  return node;
}
document.addEventListener('keydown', (e) => {
  if (!openLayer) return;
  const node = openLayer.node;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayer(); return; }
  if (e.key === 'Tab') {
    const f = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"], textarea, select')].filter((x) => x.offsetParent !== null);
    const first = f[0], last = f[f.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}, true);

export interface PopoverOpts extends LayerOpts { label?: string | undefined; /** false: a card shown on hover keeps focus where it was (Tab still reaches it) */ focus?: boolean | undefined }
export const popover = {
  /** a dialog-like layer with a focus loop */
  open(anchor: HTMLElement, content: Node, o: PopoverOpts = {}): HTMLElement | null {
    /* the kit's popover surface (the Menu's floating pop, menu.css `.k7-pop`): --bg-3, radius 16, the float line */
    const node = frag('<div class="k7-pop" role="dialog" data-kit="Menu" data-variant="popover" data-sq data-sq-mode="surface"' + attrs({ 'aria-label': o.label }) + '></div>');
    node.appendChild(content);
    if (!openLayerAt(anchor, node, o)) return null;
    const f = node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>('button, input, textarea, select, [tabindex="0"]');
    if (f && o.focus !== false) f.focus({ preventScroll: true });
    return node;
  },
  close: closeLayer,
  get current(): HTMLElement | null { return openLayer ? openLayer.node : null; }
};
export const layer = {
  open: (anchor: HTMLElement, node: HTMLElement, o: LayerOpts = {}): HTMLElement | null => openLayerAt(anchor, node, o),
  close: closeLayer,
  place: (node: HTMLElement, anchor: HTMLElement, o: PlaceOpts = {}): void => place(node, anchor, o)
};
