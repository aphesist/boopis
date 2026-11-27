/* Tiles: its behaviour; wire.ts wires it on every Tiles once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { emit } from '../events';

/** a goal toggles on a press, up to the most that may be chosen (data-max); it says so with ui:change {value} (cancelable), and the
    foot's count follows */
export function wireTiles(el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLButtonElement>('.k7-tiles__tile');
    if (!t || !el.contains(t)) return;
    const on = t.getAttribute('aria-pressed') !== 'true';
    const max = Number(el.dataset['max'] ?? '3');
    const chosen = el.querySelectorAll('.k7-tiles__tile[aria-pressed="true"]').length;
    if (on && chosen >= max) return;
    if (!emit(t, 'ui:change', { value: t.dataset['value'] ?? '' }, true)) return;
    t.setAttribute('aria-pressed', String(on));
    const n = chosen + (on ? 1 : -1);
    const note = el.querySelector('.k7-tiles__note');
    if (note && el.dataset['variant'] === 'goals') note.textContent = String(n) + ' of ' + String(max);
    const act = el.querySelector<HTMLElement>('[data-tiles-act]');
    if (act) { act.toggleAttribute('data-chosen', n > 0); if (n > 0) act.removeAttribute('aria-disabled'); else act.setAttribute('aria-disabled', 'true'); }
  });
}
