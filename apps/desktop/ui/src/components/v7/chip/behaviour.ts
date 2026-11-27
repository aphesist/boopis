/* Chip: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Chip once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { emit } from '../events';

/** a filter or mode Chip toggles; an answer chip only reports (its card decides) */
export function wireChip(c: HTMLButtonElement): void {
  if (c.dataset['variant'] === 'answer' || c.hasAttribute('data-hold')) return;
  c.addEventListener('click', () => {
    const on = c.getAttribute('aria-pressed') !== 'true';
    if (!emit(c, 'ui:change', { value: on }, true)) return;
    c.setAttribute('aria-pressed', String(on));
    c.toggleAttribute('data-chosen', on);
  });
}
