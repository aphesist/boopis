/* Menu: its behaviour; wire.ts wires it on every Menu once (docs/kit/RULES.md). State lives in ARIA and data attributes. The full keyboard
   of a list (step 2a: the v6 select and its listbox went, and the kit's Menu took their keys): the arrows move between the rows, Home and
   End go to the ends, PageUp and PageDown move a page of rows; typed letters jump to the next row whose name starts with them (a word
   typed quickly, "qw", finds "qwen3-coder"; the same letter again goes on to the next one that starts with it); Enter and Space choose (a
   row is a button). Esc and Tab close a floating Menu (layer.ts), and the focus goes back to what opened it. */
const TYPE_MS = 700;
const PAGE = 8;

/** Menu (drawn in place or floating) */
export function wireMenu(m: HTMLElement): void {
  let typed = '', timer = 0;
  m.addEventListener('keydown', (e) => {
    const rows = [...m.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]:not([aria-disabled="true"]), [data-kit~="OptionRow"]')];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const last = rows.length - 1;
    const n = ({ ArrowDown: i + 1, ArrowUp: i < 0 ? last : i - 1, Home: 0, End: last } as Record<string, number>)[e.key];
    if (n != null && rows.length) { e.preventDefault(); rows[(n + rows.length) % rows.length]?.focus(); return; }
    if ((e.key === 'PageDown' || e.key === 'PageUp') && rows.length) { e.preventDefault(); rows[Math.max(0, Math.min(last, (i < 0 ? 0 : i) + (e.key === 'PageDown' ? PAGE : -PAGE)))]?.focus(); return; }
    if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      window.clearTimeout(timer); timer = window.setTimeout(() => { typed = ''; }, TYPE_MS);
      /* one letter again goes on to the next row with it; a word typed quickly matches from the row it started at */
      const again = typed.length > 0 && [...typed].every((c) => c === k);
      typed = again ? k : typed + k;
      const nameOf = (x: HTMLElement): string => (x.querySelector('.k7-mrow__name, .k7-orow__label')?.textContent ?? x.textContent ?? '').trim().toLowerCase();
      const from = typed.length === 1 ? i + 1 : Math.max(0, i);
      const hit = rows.slice(from).concat(rows.slice(0, from)).find((x) => nameOf(x).startsWith(typed));
      if (hit) { e.preventDefault(); hit.focus(); }
    }
  });
}
