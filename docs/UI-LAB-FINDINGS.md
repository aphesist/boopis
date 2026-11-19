# UI lab findings

What the UI lab and the agents working beside it found that is not fixed yet, by rule, for the area fix agents. Each entry names the place, what the rule wants and what it would take.

## concentric

The rule: nested corners fit their container (`DESIGN-SYSTEM.md` §8.2), through the primitives in `apps/desktop/AGENTS.md` ("Corners and overlays in code"): containers declare `--r-outer` and `--pad` and carry `.ui-nest`; corner controls take `.ui-corner`; a corner row is `.ui-corners`. Numbers below are the default preset.

Converted already (branch `w12/corners`): the session, Bots tab and dock session composers; the toast's action; the terminal's copy button in the details panel; the segmented track's thumb and options.

Still to do:

| Where | What is wrong | What it takes |
|---|---|---|
| Dialog close button: Settings and the keyboard sheet (`index.html` `.hx-dialog__head .ui-ib`, `shell.css` `.hx-dialog__head`) | The card is 30 with a 12 gap, so `--r-in` is 18, but a 28px button is at most a 14 circle; it sits 12 from the top and the right, where one centre needs 16. | A layout change: the head becomes `--corner-size + 2 × --corner-inset` tall (60) with `padding-right: var(--corner-inset)` and the button `.ui-corner`, or a 36px close button (the §8.2 table's "18"). Owner's call. |
| Palette rows at the bottom of the list (`shell.css` `.hx-pal-row`, `.hx-palette__list`) | The table says 30 / 6 / 24, but a row is `--row-h` (30) tall, so its 24 clamps to a 15 capsule and the last row, 6 from the edge, is not concentric (needs 15, or a 48px row). | A design decision on row height or the last row's inset; then `.hx-palette__box` carries `.ui-nest` and loses its hand-written `--r-in`. |
| Hand-written `--r-in` formulas outside the library (`shell.css` lines 215, 245, 388, 389; `mods.css` line 12; `cards.css` line 53; `dock.css` line 165 `--r-card`) | Each repeats the formula instead of the one rule, so none gets `--r-corner` or `--corner-inset`, and none clamps `--r-in` to the outer radius. | Pure CSS: add the container's class to the rule's list (or `.ui-nest` in markup) and delete the local formula. Cards keep their `--r-in: initial` overrides. The dock's is `w11/empty-dock`'s. |
| Mods band and inline pane chevron (`mods.css` `.mod-chev`, `.mod-inline__head .ui-ib`) | The band's gap is 4 and its row 32, so the 28px chevron (a 14 circle) sits 6 from the top but 4 from the right, under a 20 corner (needs 6 and 6). | The band and pane carry `.ui-nest`; the row's and head's right padding becomes `--corner-inset` and the chevron `.ui-corner`. |
| A mod toast's dismiss button (`mods/toasts.ts` `.mod-toast__x`, `mods.css`) | A 24px button in a toast whose corner size is the 28px action: 8 from the top and bottom, 6 from the right, radius 12. | Either a 28px dismiss, or the toast declaring `--corner-size: 24px` while it holds one; then `.ui-corner`. |
| Menu items and popover contents (`components.css` `.ui-menu`, `.ui-pop`) | Concentric already (20 − 4 = 16), but the menu's `padding: 4px` and the popover's 12 are literals beside `--pad`. | `padding: var(--corner-inset)` once the menu's items are checked at the sharp preset. |
| Bots settings sheet, new-bot form (`bots.css` `.bt-sheet`, `.bt-new-close`, `.bt-dice`) | Not nested corners: the sheet is flush with the frame (the concave corner), the close and the dice sit in a page and a field. No change; the dice is `w11/dice`'s. | None. |
| Settings rows (`.ui-set__row`) and the palette's input (`.hx-palette__field`) | A flat list with hairlines, and a field flush with the palette's top edge (gap 0: the container's radius). No control sits in a rounded corner. | None. |
