/* Menu: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Menu once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
/** Menu (drawn in place or floating): arrows move between rows, Home and End, a letter jumps; Enter and Space choose */
export function wireMenu(m: HTMLElement): void {
  m.addEventListener('keydown', (e) => {
    const rows = [...m.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]:not([aria-disabled="true"]), [data-kit~="OptionRow"]')];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const n = ({ ArrowDown: i + 1, ArrowUp: i < 0 ? rows.length - 1 : i - 1, Home: 0, End: rows.length - 1 } as Record<string, number>)[e.key];
    if (n != null && rows.length) { e.preventDefault(); rows[(n + rows.length) % rows.length]?.focus(); return; }
    if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const k = e.key.toLowerCase(), s = i + 1;
      rows.slice(s).concat(rows.slice(0, s)).find((x) => (x.textContent ?? '').trim().toLowerCase().startsWith(k))?.focus();
    }
  });
}
