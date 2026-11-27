/* Switch: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Switch once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { emit } from '../events';

/** Switch: applies at once (R-switch-1) */
export function wireSwitch(sw: HTMLButtonElement): void {
  sw.addEventListener('click', () => {
    if (sw.disabled) return;
    const on = sw.getAttribute('aria-checked') !== 'true';
    if (!emit(sw, 'ui:change', { value: on }, true)) return;
    sw.setAttribute('aria-checked', String(on));
  });
}
