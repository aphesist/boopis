/* Card: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Card once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { emit } from '../events';

/** a Row that is a checkbox (board 14's "Under the composer"): a press toggles it and fires ui:change {value}; Space and Enter press it
    (it is a row action, wireRowAction) */
export function wireCheckRow(r: HTMLElement): void {
  const toggle = (): void => {
    const on = r.getAttribute('aria-checked') !== 'true';
    if (!emit(r, 'ui:change', { value: on }, true)) return;
    r.setAttribute('aria-checked', String(on));
  };
  r.addEventListener('click', toggle);
}
/** a Row that is a control (RowOpts.action): Enter and Space press it */
export function wireRowAction(r: HTMLElement): void {
  r.addEventListener('keydown', (e) => { if (e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); } });
}
