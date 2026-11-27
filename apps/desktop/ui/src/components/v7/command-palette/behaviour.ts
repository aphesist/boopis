/* CommandPalette: its behaviour; wire.ts wires it on every CommandPalette once (docs/kit/RULES.md). State lives in ARIA attributes: the
   row the keys are on is aria-selected, and the field names it (aria-activedescendant). The rows are read at each key, so a screen may
   draw the list again (`commandPaletteList`) as the query changes. */
import { emit } from '../events';

/** the row the keys are on moves with Up and Down (Tab and Shift+Tab too: the field keeps the focus), and under the pointer; Enter or a
    press chooses it with `ui:select {value}` on the palette (cancelable) */
export function wireCommandPalette(p: HTMLElement): void {
  const input = p.querySelector<HTMLInputElement>('.k7-field__input');
  const list = p.querySelector<HTMLElement>('.k7-cpal__list');
  if (!input || !list) return;
  const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('[data-kit-part="CommandPaletteRow"]')];
  const at = (): number => rows().findIndex((r) => r.getAttribute('aria-selected') === 'true');
  const set = (r: HTMLElement | undefined, scroll: boolean): void => {
    if (!r) return;
    for (const x of rows()) x.setAttribute('aria-selected', String(x === r));
    input.setAttribute('aria-activedescendant', r.id);
    if (scroll) r.scrollIntoView?.({ block: 'nearest' });
  };
  const choose = (r: HTMLElement | undefined): void => { if (r) emit(p, 'ui:select', { value: r.dataset['value'] ?? '' }, true); };
  input.addEventListener('keydown', (e) => {
    const all = rows(); if (!all.length) return;
    const d = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) ? 1 : e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 0;
    if (d) { e.preventDefault(); set(all[(Math.max(0, at()) + d + all.length) % all.length], true); return; }
    if (e.key === 'Enter') { e.preventDefault(); choose(all[Math.max(0, at())]); }
  });
  list.addEventListener('pointermove', (e) => {
    const r = (e.target as Element).closest<HTMLElement>('[data-kit-part="CommandPaletteRow"]');
    if (r && r.getAttribute('aria-selected') !== 'true') set(r, false);
  });
  list.addEventListener('click', (e) => { choose((e.target as Element).closest<HTMLElement>('[data-kit-part="CommandPaletteRow"]') ?? undefined); });
  /* a press on a row does not take the focus from the field (the caret stays where the person types) */
  list.addEventListener('pointerdown', (e) => { if ((e.target as Element).closest('[data-kit-part="CommandPaletteRow"]')) e.preventDefault(); });
}
