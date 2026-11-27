/* Mark: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Mark once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { frag, reduced } from '../../../core/dom';
import { layer } from '../../layer';
import { esc } from '../util';

/** a feedforward or blank mark that is new draws in once, then loses the flag (17.1); reduced motion shows it whole */
export function wireMark(mk: HTMLElement): void {
  if (!mk.hasAttribute('data-mark-new')) return;
  if (reduced()) { mk.removeAttribute('data-mark-new'); return; }
  mk.addEventListener('animationend', () => mk.removeAttribute('data-mark-new'), { once: true });
}
/** an info label (17.1): hovering it opens its explanation after 300 ms, 8 from the label; Enter or Space opens it; Esc closes and
    returns focus (layer.ts) */
export function wireInfo(b: HTMLElement): void {
  let t = 0;
  const open = (): void => {
    const text = b.getAttribute('data-explain');
    if (!text || b.getAttribute('aria-expanded') === 'true') return;
    const pop = frag('<div class="k7-pop" role="dialog" data-kit="Menu" data-variant="popover" data-sq data-sq-mode="surface"' + (b.textContent ? ' aria-label="' + esc(b.textContent.trim()) + '"' : '') + '>' + esc(text) + '</div>');
    b.setAttribute('data-mark', 'open');
    layer.open(b, pop, { place: 'below', align: 'start', onClose: () => b.removeAttribute('data-mark') });
  };
  b.addEventListener('pointerenter', () => { clearTimeout(t); t = window.setTimeout(open, 300); });
  b.addEventListener('pointerleave', () => clearTimeout(t));
  b.addEventListener('click', open);
}
/** a container's mark reveal (17.1): 'hover' hides its info labels' marks until the row or card is hovered or focused */
export function markReveal(container: HTMLElement, mode: 'hover' | 'always'): void { container.setAttribute('data-mark-reveal', mode); }
