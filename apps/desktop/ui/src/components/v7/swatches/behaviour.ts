/* Swatches: its behaviour (docs/kit/RULES.md). A Swatches that chooses is one radio group: a press or the arrows, Home and End choose,
   with one tab stop on the chosen circle. The choice is ui:change {value}, cancelable: a listener that calls preventDefault() keeps the
   choice as it was. State lives in aria-checked and tabindex. */
import { emit } from '../events';

export function wireSwatches(g: HTMLElement): void {
  const items = (): HTMLElement[] => [...g.querySelectorAll<HTMLElement>('[role="radio"]')];
  const choose = (it: HTMLElement, focus: boolean): void => {
    if (it.getAttribute('aria-checked') !== 'true') {
      if (!emit(g, 'ui:change', { value: it.dataset['value'] ?? '' }, true)) return;
      for (const x of items()) { const on = x === it; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; }
    }
    if (focus) it.focus();
  };
  g.addEventListener('click', (e) => { const it = (e.target as Element).closest<HTMLElement>('[role="radio"]'); if (it && g.contains(it)) choose(it, false); });
  g.addEventListener('keydown', (e) => {
    const list = items(), i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const n = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (n == null) return;
    e.preventDefault();
    const it = list[(n + list.length) % list.length];
    if (it) choose(it, true);
  });
}
