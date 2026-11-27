/* Behaviours: `hydrate(root)` wires every [data-ui] element under root once (string-built markup).
   Events bubble from the element and are cancelable where an action follows:
     'ui:change' {value} disclosure;  'ui:commit' hold to approve finished. The v6 segmented, switch, chips, sections, rows and tabs
   went at the repass's step 2a: the kit's own behaviours wire theirs (components/v7/wire.ts). */
import { fire } from '../core/dom';
import { wireHold } from './hold';

export interface UiChange<V = string> { value: V; index?: number }
export interface UiSelect { value: string | undefined; item: HTMLElement | unknown }

const WIRED = new WeakSet<Element>();
type Wire = (el: HTMLElement) => void;

const WIRE: Record<string, Wire> = {
  hold: (el) => { wireHold(el as HTMLButtonElement); },
  disclosure: (el) => el.addEventListener('click', () => {
    const open = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', String(open));
    const id = el.getAttribute('aria-controls'), t = id ? document.getElementById(id) : null; if (t) t.hidden = !open;
    fire(el, 'ui:change', { value: open });
  }),
  send: () => { /* the composer owns it */ }
};

export function hydrateOne(el: Element | null | undefined): void {
  if (!el || el.nodeType !== 1) return;
  const h = el as HTMLElement;
  const kind = h.dataset['ui'];
  if (kind && !WIRED.has(h)) { WIRED.add(h); WIRE[kind]?.(h); }
  for (const c of h.querySelectorAll<HTMLElement>('[data-ui]')) if (!WIRED.has(c)) { WIRED.add(c); WIRE[c.dataset['ui'] ?? '']?.(c); }
}
export function hydrate<E extends Element>(root?: E | null): E | null | undefined { hydrateOne(root ?? document.body); return root; }
