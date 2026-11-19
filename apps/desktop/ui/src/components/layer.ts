/* Menus and popovers: one open at a time, placed against an anchor, closed by Esc or an outside press, focus
   returned to the anchor. `layer` is the same layer for a node that brings its own surface (the card layer's blank
   popover). */
import { attrs, fire, frag, reduced } from '../core/dom';
import type { Attrs } from '../core/dom';
import { html, itemValue } from './html';
import type { MenuEntry, MenuItem } from './html';
import { icon } from './icons';

export interface PlaceOpts { place?: 'above' | 'below' | undefined; align?: 'start' | 'end' | 'center' | undefined; inset?: number | undefined }
export interface LayerOpts extends PlaceOpts { layer?: Element | undefined; onClose?: (() => void) | undefined }
interface OpenLayer { node: HTMLElement; anchor: HTMLElement | null; onClose: (() => void) | undefined; off(): void }
let openLayer: OpenLayer | null = null;

function place(node: HTMLElement, anchor: HTMLElement, o: PlaceOpts): void {
  const r = anchor.getBoundingClientRect(), w = node.offsetWidth, h = node.offsetHeight, gap = 8;
  const fitsBelow = r.bottom + h + gap <= innerHeight - 8, fitsAbove = r.top - h - gap >= 8;
  const above = o.place === 'above' ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
  let x = o.align === 'end' ? r.right - w : o.align === 'center' ? r.left + r.width / 2 - w / 2 : r.left - (o.inset == null ? 8 : o.inset);
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  node.style.left = x + 'px';
  node.style.top = Math.max(8, above ? r.top - h - gap : r.bottom + gap) + 'px';
  node.dataset['place'] = above ? 'above' : 'below';
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
  if (node.classList.contains('ui-listbox')) return;   /* the listbox keeps its own keys (select.ts) */
  if (node.classList.contains('ui-menu')) {
    const items = [...node.querySelectorAll<HTMLElement>('.ui-menu__item:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = ({ ArrowDown: i + 1, ArrowUp: i < 0 ? items.length - 1 : i - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
    if (n != null && items.length) { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); return; }
    if (e.key === 'Tab') { closeLayer(false); return; }
    if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const k = e.key.toLowerCase(), start = i + 1;
      const hit = items.slice(start).concat(items.slice(0, start)).find((x) => (x.textContent ?? '').trim().toLowerCase().startsWith(k));
      if (hit) hit.focus();
    }
  } else if (e.key === 'Tab') {
    const f = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"], textarea, select')].filter((x) => x.offsetParent !== null);
    const first = f[0], last = f[f.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}, true);

export interface MenuOpts extends LayerOpts { label?: string | undefined; multi?: boolean | undefined; onSelect?: ((value: string, item: MenuItem | undefined) => void) | undefined }
export const menu = {
  /** menu.open(anchor, items, {label, place, align, multi, onSelect, layer}): the node, or null when the same anchor closed it */
  open(anchor: HTMLElement, items: readonly MenuEntry[], o: MenuOpts = {}): HTMLElement | null {
    const node = frag('<div class="ui-menu" role="menu"' + attrs({ 'aria-label': o.label }) + '>' + html.menuItems(items, o) + '</div>');
    if (!openLayerAt(anchor, node, o)) return null;
    node.addEventListener('click', (e) => {
      const it = (e.target as Element).closest<HTMLButtonElement>('.ui-menu__item'); if (!it || it.disabled) return;
      const value = it.dataset['value'] ?? '';
      const item = items.find((x): x is MenuItem => x !== '-' && !!x && itemValue(x) === value);
      if (!fire(node, 'ui:select', { value, item }, true)) return;
      o.onSelect?.(value, item);
      if (!o.multi) closeLayer();
      else { const c = it.getAttribute('aria-checked') !== 'true'; it.setAttribute('aria-checked', String(c)); const g = it.querySelector('.ui-menu__glyph'); if (g) g.innerHTML = c ? icon('check') : ''; }
    });
    const first = node.querySelector<HTMLElement>('.ui-menu__item[aria-checked="true"]') ?? node.querySelector<HTMLElement>('.ui-menu__item:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
    return node;
  },
  close: closeLayer,
  /** a menu drawn in place (specimens, documentation): no anchor, no positioning */
  still(items: readonly MenuEntry[], o: MenuOpts = {}): HTMLElement { return frag('<div class="ui-menu" role="menu" data-static' + attrs({ 'aria-label': o.label } as Attrs) + '>' + html.menuItems(items, o) + '</div>'); }
};

export interface PopoverOpts extends LayerOpts { label?: string | undefined }
export const popover = {
  /** a dialog-like layer with a focus loop */
  open(anchor: HTMLElement, content: Node, o: PopoverOpts = {}): HTMLElement | null {
    const node = frag('<div class="ui-pop" role="dialog"' + attrs({ 'aria-label': o.label }) + '></div>');
    node.appendChild(content);
    if (!openLayerAt(anchor, node, o)) return null;
    const f = node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>('button, input, textarea, select, [tabindex="0"]');
    if (f) f.focus({ preventScroll: true });
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
