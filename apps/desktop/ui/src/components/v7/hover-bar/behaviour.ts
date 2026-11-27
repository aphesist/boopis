/* HoverBar: its behaviour, moved as it was from wire.ts; wire.ts wires it on every HoverBar once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { emit } from '../events';

/** stand a HoverBar beside `bubble`, on its middle: the two share a row (the boards' `.row` of a bubble and its `.hoverbar`). A bar that
    stood beside another bubble leaves that one as it was (a turn's later bubble takes the bar) */
export function hoverBeside(bar: HTMLElement, bubble: HTMLElement): void {
  const old = bar.parentElement?.classList.contains('k7-hoverrow') ? bar.parentElement : null;
  if (old && old.contains(bubble)) return;
  bar.remove();
  if (old) { const was = old.firstElementChild; if (was) old.replaceWith(was); else old.remove(); }
  const row = document.createElement('div');
  row.className = 'k7-hoverrow';
  bubble.replaceWith(row);
  row.append(bubble, bar);
}
/** HoverBar: a press on one of its actions says which (`ui:act` {value, el}: `el` is the button, what a menu opens against) */
export function wireHoverBar(bar: HTMLElement): void {
  bar.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('[data-act]'); if (b && bar.contains(b)) emit(bar, 'ui:act', { value: b.dataset['act'] ?? '', el: b }); });
}
