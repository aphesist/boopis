/* Segmented: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Segmented once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { emit } from '../events';

/** Segmented: one of a few; arrows move and choose (radio) or move and choose the tab (tabs) */
export function wireSegmented(seg: HTMLElement): void {
  const items = (): HTMLButtonElement[] => [...seg.querySelectorAll<HTMLButtonElement>('.k7-seg__item')];
  const choose = (b: HTMLButtonElement, focus: boolean): void => {
    const tabs = seg.getAttribute('role') === 'tablist', list = items(), i = list.indexOf(b);
    if (b.getAttribute(tabs ? 'aria-selected' : 'aria-checked') === 'true') { if (focus) b.focus(); return; }
    if (!emit(seg, 'ui:change', { value: b.dataset['value'] ?? '' }, true)) return;
    for (const x of list) { const on = x === b; x.setAttribute(tabs ? 'aria-selected' : 'aria-checked', String(on)); x.tabIndex = on ? 0 : -1; }
    seg.style.setProperty('--i', String(i));
    if (focus) b.focus();
  };
  seg.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLButtonElement>('.k7-seg__item'); if (b) choose(b, false); });
  seg.addEventListener('keydown', (e) => {
    const list = items(), i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (n == null) return;
    e.preventDefault();
    const b = list[(n + list.length) % list.length];
    if (b) choose(b, true);
  });
}
