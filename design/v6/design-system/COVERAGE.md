# boopis design system: coverage

Which topics a complete design system must answer, and how far boopis's answers them, before and after version 1.1
(19 November 2026). **Covered**: a written rule decides every case, with its tokens. **Partly**: some cases are decided,
others are left to the module, or a value is a range. **Missing**: nothing written. The list of topics follows what a
complete system answers (it was checked against the structure of the owner's other product, which covers colour, type,
shape, shadow, spacing, motion, components and voice, each with tokens generated from one source); boopis's answers are
its own.

Links go to `DESIGN-SYSTEM.md`; rule IDs are indexed in [`RULES.md`](RULES.md) with their checks; the live
demonstration is [`rules.html`](rules.html).

| Topic | Before 1.1 | After 1.1 | Where | Rules |
|---|---|---|---|---|
| Colour roles | covered | covered | [4](DESIGN-SYSTEM.md#4-colour) | R-colour-1 to 8 |
| Contrast | covered | covered | [5.4](DESIGN-SYSTEM.md#54-the-pairs-that-must-hold), [15](DESIGN-SYSTEM.md#15-accessibility) | R-colour-6, R-a11y-8 |
| Type families | covered | covered | [6](DESIGN-SYSTEM.md#6-typography) | R-type-1 |
| Type scale | covered | covered | [6](DESIGN-SYSTEM.md#6-typography) | R-type-2, R-type-7 |
| Weights | partly (menu labels 500 in the table, 400 in the library) | covered | [6](DESIGN-SYSTEM.md#6-typography) | R-type-3 |
| Line heights | partly (1.45 and 1.5 were literals) | covered | [6](DESIGN-SYSTEM.md#6-typography) | R-type-4 |
| Case | covered | covered | [2](DESIGN-SYSTEM.md#2-voice-and-copy), [6](DESIGN-SYSTEM.md#6-typography) | R-copy-1, R-type-5 |
| Numerals | covered | covered | [6](DESIGN-SYSTEM.md#6-typography) | R-type-6, R-copy-5 |
| Code | covered | covered | [6](DESIGN-SYSTEM.md#6-typography), [14.7](DESIGN-SYSTEM.md#147-prose-and-code-chips) | R-type-7 |
| Text overflow and truncation | missing | covered | [7.1](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | R-overflow-1 to 4 |
| Icon set and stroke | covered | covered | [10](DESIGN-SYSTEM.md#10-iconography) | R-icon-1, R-icon-2 |
| Icon sizes | partly (ranges "14–15", "10–12") | covered (six tokens) | [10.2](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | R-icon-3, R-icon-4 |
| Icon optical alignment | missing | covered | [10.2](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | R-icon-6, R-icon-9 |
| Icon plus text spacing | partly (the table said 4, the library drew 6 and 8) | covered | [10.2](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | R-icon-5 |
| When to use an icon | partly | covered | [10.2](DESIGN-SYSTEM.md#102-sizes-spacing-and-alignment) | R-icon-8, R-icon-10 |
| Spacing scale | covered | covered | [7](DESIGN-SYSTEM.md#7-space-density-and-layout) | R-space-1 to 3 |
| Density | covered | covered | [7](DESIGN-SYSTEM.md#7-space-density-and-layout) | R-space-4, R-space-5 |
| Corners: continuous | covered | covered | [8.1](DESIGN-SYSTEM.md#81-the-drawn-corner-hxuisquircle) | R-corner-6 |
| Corners: concentric | covered | covered (tokens per container) | [8.2](DESIGN-SYSTEM.md#82-nested-corners-fit-their-container) | R-corner-3, R-corner-4, R-corner-8 |
| Corners: edge band (pieces beside a corner piece) | missing | covered | [8](DESIGN-SYSTEM.md#8-shape) | R-corner-5, R-seg-3 |
| Radius per element kind | partly (by token, not by kind) | covered | [8](DESIGN-SYSTEM.md#8-shape) | R-corner-1, R-corner-2, R-corner-9 |
| Borders and dividers | partly (4.5 roles only) | covered | [9](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | R-line-1 to 5 |
| Elevation and shadows | partly (three shadows, no levels) | covered (five levels, `--elev-*`) | [9](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | R-elev-1 to 4 |
| Stacking and z-index | partly (a scale, with calc() layers in the shell and no rule for dialogs) | covered | [9](DESIGN-SYSTEM.md#9-elevation-hairlines-and-depth) | R-elev-5 to 8 |
| Surfaces on surfaces, a card on a card | partly (the layering rule, "don't nest a card") | covered | [9.1](DESIGN-SYSTEM.md#91-surfaces-on-surfaces) | R-stack-1 to 5 |
| Scrollbars (WebKitGTK and Chromium) | partly (`scrollbar-width: thin`, ignored by WebKitGTK) | covered | [7.1](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | R-scroll-1 to 5 |
| Where scrollbars may appear, overflow regions | missing | covered | [7.1](DESIGN-SYSTEM.md#71-overflow-and-scrollbars) | R-scroll-6 to 9 |
| Focus | covered | covered | [14.24](DESIGN-SYSTEM.md#1424-focus-rings) | R-focus-1 to 6 |
| Every interactive state | partly (per component, scattered) | covered (one table) | [14.35](DESIGN-SYSTEM.md#1435-interactive-states) | R-state-1 to 7 |
| Motion: durations and curves | covered | covered | [11](DESIGN-SYSTEM.md#11-motion) | R-motion-1, R-motion-3, R-motion-4 |
| Motion: springs | partly | covered | [11](DESIGN-SYSTEM.md#11-motion) | R-motion-3, R-motion-5 |
| Motion: reduced motion | covered | covered | [11](DESIGN-SYSTEM.md#11-motion) | R-motion-6 |
| Motion: 120 Hz | partly (in the app's guide only) | covered | [11](DESIGN-SYSTEM.md#11-motion) | R-motion-5 |
| Layout grid | covered | covered | [7](DESIGN-SYSTEM.md#7-space-density-and-layout) | R-layout-2, 3, 6 |
| Breakpoints | partly (two component breakpoints outside the set) | covered | [7](DESIGN-SYSTEM.md#7-space-density-and-layout) | R-layout-1 |
| Edges and safe areas | partly | covered | [7](DESIGN-SYSTEM.md#7-space-density-and-layout) | R-layout-4, R-layout-5 |
| Buttons | covered | covered | [14.14](DESIGN-SYSTEM.md#1414-buttons) | R-btn-1 to 5 |
| Icon buttons | covered | covered | [14.14](DESIGN-SYSTEM.md#1414-buttons) | R-ib-1, R-ib-2 |
| Toggles and switches | covered | covered | [14.16](DESIGN-SYSTEM.md#1416-switches) | R-switch-1 to 3 |
| Segmented controls | covered | covered | [14.3](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | R-seg-1 to 3 |
| Tabs | partly (three looks, unnamed; dialog tabs not concentric) | covered | [14.3](DESIGN-SYSTEM.md#143-tabs-pill-segmented-control-as-tabs) | R-tab-1 to 3 |
| Selects and listboxes | partly (a native select with a drawn chevron) | covered | [14.32](DESIGN-SYSTEM.md#1432-selects-and-listboxes) | R-select-1 to 4 |
| Text fields | covered | covered | [14.25](DESIGN-SYSTEM.md#1425-fields) | R-field-1 to 4 |
| Search fields | partly (each described in its place) | covered | [14.31](DESIGN-SYSTEM.md#1431-search-fields) | R-search-1 to 5 |
| Chips | covered | covered | [14.17](DESIGN-SYSTEM.md#1417-chips) | R-chip-1 to 3 |
| Key chips | partly (size only; radius in a field undecided) | covered | [14.17](DESIGN-SYSTEM.md#1417-chips) | R-kbd-1 to 3 |
| Sliders | missing | covered | [14.34](DESIGN-SYSTEM.md#1434-sliders) | R-slider-1 |
| Checkboxes and radios | partly (radio rows only) | covered | [14.33](DESIGN-SYSTEM.md#1433-checkboxes-and-radios) | R-check-1, R-check-2 |
| Menus | covered | covered | [14.18](DESIGN-SYSTEM.md#1418-menus) | R-menu-1 to 3 |
| Tooltips | covered | covered (placement tightened) | [14.23](DESIGN-SYSTEM.md#1423-tooltips) | R-tip-1 to 4 |
| Popovers, placement, gap, arrows | partly (gap and arrows unwritten) | covered | [14.19](DESIGN-SYSTEM.md#1419-popovers) | R-float-1 to 5 |
| Dialogs and sheets | partly (Settings only) | covered | [14.30](DESIGN-SYSTEM.md#1430-dialogs-and-sheets) | R-dialog-1 to 6 |
| Lists and rows | covered | covered | [14.4](DESIGN-SYSTEM.md#144-list-rows) | R-row-1 to 4 |
| Empty states | covered | covered | [14.28](DESIGN-SYSTEM.md#1428-empty-states) | R-empty-1 |
| Loading and skeletons | missing | covered | [14.36](DESIGN-SYSTEM.md#1436-loading-errors-and-unknown) | R-load-1, R-load-2 |
| Errors | partly (copy and the error card) | covered | [14.36](DESIGN-SYSTEM.md#1436-loading-errors-and-unknown) | R-error-1, R-error-2, R-unknown-1 |
| Toasts | covered | covered | [14.22](DESIGN-SYSTEM.md#1422-toasts) | R-toast-1 to 3 |
| Cards | covered | covered | [14.13](DESIGN-SYSTEM.md#1413-cards) | R-card-1 to 4 |
| Forms | partly (in the app's guide) | covered | [14.38](DESIGN-SYSTEM.md#1438-forms) | R-form-1 to 3 |
| Tables | missing | covered | [14.37](DESIGN-SYSTEM.md#1437-tables-and-data) | R-table-1, R-table-2 |
| Measures and progress | covered | covered | [14.27](DESIGN-SYSTEM.md#1427-ladder-measures-capacity-pages) | R-data-1 |
| Orbs and bots | covered (eyes listed as the bot's data) | covered (eyes follow the state) | [13](DESIGN-SYSTEM.md#13-bots-and-orbs) | R-orb-1 to 7 |
| The dock | covered | covered (the presence decision) | [14.12](DESIGN-SYSTEM.md#1412-dock) | R-dock-1 to 6 |
| Voice and copy | covered | covered | [2](DESIGN-SYSTEM.md#2-voice-and-copy) | R-copy-1 to 9 |
| Accessibility minimums | covered (2.1) | covered (2.2, targets, focus not obscured) | [15](DESIGN-SYSTEM.md#15-accessibility) | R-a11y-1 to 8 |
| Theming and presets | covered | covered | [5](DESIGN-SYSTEM.md#5-theming-contract) | R-theme-1 to 6 |
| Native controls | missing | covered | [14.39](DESIGN-SYSTEM.md#1439-native-controls) | R-native-1 to 3 |
| Logo | covered | covered | [12](DESIGN-SYSTEM.md#12-logo) | (`brand/logo/README.md`) |

**Totals.** Before 1.1: 35 covered, 25 partly, 8 missing (of 68 topics). After 1.1: all 68 covered, of which 8 rest on a
Approved rule (the 18 formerly proposed rules were approved, three of them amended, in the owner-delegated review of 19 November 2026). Every rule has an ID and a check: 220 rules, 211
machine-checkable, 4 by machine and by eye, 5 by eye ([`RULES.md`](RULES.md)).
