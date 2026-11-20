# UI controls: nothing drawn by the platform

The desktop app draws with WebKitGTK. A native control there brings the system's popup, highlight and grey, which ignore the theme (the blue-highlighted Model list on the new-bot sheet was a `<select>`). The rule: **every control's look comes from the design system's tokens, drawn by `apps/desktop/ui/src/components/`.** This page is the audit (what was native, where, and what replaced it), the components, the guard that keeps it so, and the places where the design system was silent and the closest existing pattern was used, for the owner to confirm.

## The components

| Kind | Component | Where | Semantics |
|---|---|---|---|
| Choose one value from a list | `ui.select`, `ui.field({ kind: 'select' })`, `ui.html.select` | `components/select.ts`, `select-html.ts` | A button that is a select-only combobox (`role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` while open, named by its label and its value). `ui:change` `{ value, option }`, cancelable. `el.value`, `el.setOptions()` |
| Choose a model | `ui.field({ kind: 'model' })`, `ui.modelEntries(ids)` | same | The same select; options grouped by provider family (a header with the provider's mono mark, models with brand marks, design system 10.1). One family needs no header |
| The list a select opens, or a chip opens | `ui.listbox.open(anchor, entries, { value, onSelect })` | same | `role="listbox"` of `option`s (`aria-selected`, `aria-disabled`), `group`s named by their header. A surface of the library's one layer: one open at a time, Esc closes and returns focus, an outside press closes, it opens **inside** the dialog or first-run view that holds its trigger (a modal dialog makes everything outside it inert), the thin themed scrollbar, the menu's rows and focus ring, light and dark by tokens |
| Do something | `ui.menu` (unchanged) | `components/layer.ts` | `role="menu"`. A menu is for actions, a listbox for a value |
| Switch | `ui.switch` (unchanged) | `components/html.ts` | A checkbox with `appearance: none` (14.16) |
| One of a few | `ui.segmented`, `ui.chipGroup`, the form card's option rows (unchanged) | | |
| Free text, numbers, secrets | `.ui-input` (a number is a text field with `inputmode`) | | |
| A tooltip | `data-tip` (unchanged) | `components/tooltip.ts` | never `title=` |

Keyboard on a select: Down, Up, Home, End or a typed letter open it; Enter and Space too. In the list: Up and Down move over the enabled options (no wrap, like a native select), Home, End, PageUp, PageDown, a typed word jumps to the next option that starts with it (700 ms buffer; one letter repeated cycles; Space is part of the word while one is being typed), Enter or Space chooses, Esc closes and changes nothing, Tab closes and moves on. Disabled options are skipped and refuse a click. A 1200-option list is drawn whole and scrolls (tested).

## The audit

Searched `apps/desktop/ui/src` and `index.html` for `<select>`, `<option>`, `<datalist>`; `input` types `date`, `time`, `datetime-local`, `month`, `week`, `color`, `range`, `number`, `file`, `checkbox`, `radio`; spin buttons; scrollers without the thin bar; `title=` and `.title =` as UI; `<dialog>`, `<details>`, `<summary>`, `<progress>`, `<meter>`; `alert`/`confirm`/`prompt`; autofill. Dynamic markup was read too (the forms renderer, settings rows, the theme customizer, setup and connector forms, the bots sheets, the Models tab, mods).

| Where | What was native | Replaced by |
|---|---|---|
| `modules/bots/new-bot.ts` (confirm sheet: "This makes a Hermes profile for …") | `<select>` Model | `ui.field({ kind: 'model' })` |
| `modules/bots/settings-live.ts` (bot settings, live) | `<select>` Model | the same |
| `modules/bots/settings.ts` (bot settings, preview) | `<select>` Model | the same |
| `modules/session/composer.ts` (alt+M, the model chip) | `ui.menu` of models (role `menu`, not native, but a second picker) | `ui.listbox.open` with Automatic (Smart) first, then the usable models by provider (`modules/session/model-menu.ts`) |
| `modules/cards/form.ts`, enum titled "Model" (setup's ladder form "Which model should do the work?", through the first-run view and Settings > Models > Change models) | a long radio list | `ui.html.select` with the provider's mark on each model. Titled "Model" is the rule, see the open points |
| `modules/cards/form.ts`, `x-picker` (model, teammate, folder, file, repo, host, branch) | `ui.menu` of `menuitemradio` | `ui.listbox.open` (the model one is the model picker) |
| `modules/cards/form.ts`, `integer` and `number` fields | `<input type="number">` (spin buttons) | `type="text"` with `inputmode` `numeric` or `decimal`; `form-model.ts` already validates the number, its range and "whole number" |
| `components/mod-view.ts`, a mod's `Select` | `ui.menu` | `ui.listbox.open` |
| `styles/theme-panel.ts`, Interface font and Code font | two `<select>` | `ui.html.select` in a `setRow` (`labelId`) |
| `styles/theme-panel.ts`, 26 colour rows | `<input type="color">` (the GTK colour chooser) | a swatch `<button>` (`--sw`) that moves to the row's hex field. No colour wheel, see the open points |
| `styles/theme-panel.ts` `.hxt-flag`, `components/mod-view.ts` non-https link | `title=` tooltips | `data-tip` (+ `aria-label` / `aria-description`) |
| `modules/bots/settings*.ts` Cap per run, `modules/session/list.ts` rename | text inputs without `autocomplete="off"` (a browser's suggestion list is native) | `autocomplete="off"` |
| `components/components.css` | `select.ui-input` rules (a native select with a drawn chevron); no autofill rule | `.ui-select`; `.ui-input:-webkit-autofill` keeps the theme's tint and ink |
| scrollers | thin themed bar everywhere inside `.ui-root` (`:where(.ui-root) *`); the first-run view lives outside it | the same rule now covers `[data-layer-host]` (the first-run view); `.ui-listbox__list` sets its own |
| Models tab (`host/models-tab.ts`, `plan-view.ts`) | none: a read-only ladder list, rows and buttons | unchanged (its "Change models" opens the ladder form above) |
| Connector forms (`host/connectors.ts`, Rust `plan.rs`) | enum radios of 2 to 3 options, a password input, multiline text | unchanged: option rows and `.ui-input`, already the design system's |
| Setup's "Free models" (`x-multi`) | checkbox rows | unchanged: the form card's option rows (`role="checkbox"` buttons) |
| Settings, bots sheets, dock | `ui.switch`, `ui.segmented`, `ui.chipGroup`, buttons | unchanged |

Left native on purpose, each on the allowlist of `components/native-controls.test.ts`:

| Where | What | Why |
|---|---|---|
| `modules/cards/form.ts` upload; `styles/theme-panel.ts` Import file | `<input type="file">`, hidden, opened by a library button | the OS file chooser has no web equivalent; the input draws nothing |
| `components/html.ts` `ui.switch`, `index.html` Dock switch | `<input type="checkbox" role="switch">` | `appearance: none`, drawn by `.ui-switch` (design system 14.16 says "a native checkbox") |
| `styles/theme-panel.ts` preset cards | visually hidden `<input type="radio">` inside a themed card | keeps the group's arrow-key behaviour; the card is the look |
| `index.html`, `modules/shell/` | `<dialog class="hx-dialog">` | reset (`padding`, `border`, `background`) and a themed `::backdrop`; the guard fails any other `<dialog>` |
| `modules/shell/dialogs.ts` | reads `input[type="radio"]` state for the dialog's Tab loop | draws nothing |
| `modules/dock/views.ts` (`title="${name}"` on a bot's long name) | `title=` | the dock belongs to another change; it moves to `data-tip` there |

Not present: `<datalist>`, date, time, range, `<details>`, `<progress>`, `<meter>`, `alert`, `confirm`, `prompt`.

## The guard

`components/native-controls.test.ts` (part of `pnpm test`) reads every `.ts`, `.css` and `.html` under `src` plus `index.html` (not tests, not `vendor/`, not generated files) and fails on: a native `select`, `option` or `datalist` (markup, `createElement`, `el()`, and a CSS rule for them); date, time, colour, range, number, file, checkbox or radio inputs; `title=`; `alert`/`confirm`/`prompt`; a `<dialog>` that is not `.hx-dialog`; `<details>`, `<summary>`, `<progress>`, `<meter>`. Each hit outside the allowlist prints the line and the component to use. An allowlist entry nothing uses fails too. It also checks that the autofill and thin-scrollbar rules are still in `components.css`. Smoke part `controls` checks the real DOM in Chromium: no native field in any Settings tab, the Bots tab or its sheet; the open picker, its keyboard, its theme, its place inside the Settings dialog; axe on the open picker in a dark and a light theme and in Appearance.

To add a control: build it in `components/` from the design system, test it, and add it to the table above. Do not add to the allowlist to ship one.

## Open points for the owner (the design system is silent)

1. **Select.** 14.25 says only "Selects draw their own chevron" and lists no select component. The select is the field (`.ui-input`, `--ctl`, the chevron) that opens the menu surface (14.18: `--r-m`, padding 4, `--r-in` rows, `--current` and the inset 2px brass ring, fade with a 6px drop) with listbox semantics. It is the pattern the form card's pickers already used (`.cd-picker` + `ui.menu`), now one component. `DESIGN-SYSTEM.md` (the reference, not edited here) has no section for it: 14.25 and 14.18 need one.
2. **Colour chooser.** 14.21 names the colour row as "swatch, label and hint, hex field, Reset"; the swatch was a native colour input. There is no themed colour wheel in the design system, so the swatch is now a button that moves to the hex field and a colour is typed or pasted. A visual picker, if wanted, needs a design.
3. **Which enum is a model.** The host sends setup's ladder as a plain enum titled "Model". The renderer treats a single-choice enum without a free answer or preview, titled "Model" or "Models", as the model picker. The better fix is for the host to send `x-picker: model` with the ids (Rust: not changed here); the renderer then lists the provider's models from the data seam instead of the enum.
4. **Search.** There is no filter field in the list. A long list (OpenRouter) has typeahead, groups and Page keys. A combobox with a filter is a design question.
5. **Group headers** are the model family (the existing map), not the host (an OpenRouter-served Claude is under Claude, as 10.1 says). A header is drawn only when the list has two or more families.
6. **Dock.** `modules/dock/views.ts` still has a `title=` on a bot's long name; it is on the allowlist until the dock change lands, then it should be `data-tip` and the allowlist entry removed (the test will say so).
