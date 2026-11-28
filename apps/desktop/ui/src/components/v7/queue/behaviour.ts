/* Queue's behaviour: a mod's band (variant mod) opens and closes a row with its fold. The fold says so (`ui:fold {open, row}`,
   cancelable); unless a listener keeps it as it was, the row and its button change in place. */
import { emit } from '../events';

export function wireQueue(el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-queue="fold"]');
    const row = b?.closest<HTMLElement>('[data-kit-part~="QueueRow"]');
    if (!b || !row || !el.contains(row)) return;
    const open = b.getAttribute('aria-expanded') !== 'true', name = row.dataset['row'] ?? '';
    if (!emit(el, 'ui:fold', { open, row: name }, true)) return;
    b.setAttribute('aria-expanded', String(open));
    b.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + name);
    row.toggleAttribute('data-open', open);
  });
}
