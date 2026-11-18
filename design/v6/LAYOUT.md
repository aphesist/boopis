# hypotaxis v6: layout spec (redesign)

The shell (`index.html`, `shell.css`, `shell.js`, `tokens.css`) is the design authority; the system and its reasons
are in `DESIGN.md`. This file says where everything sits and what each module must change. The earlier spec (faithful
to the Figma frame) is withdrawn: the Figma, Grok Bot, the Gemini mock-up and Panacea were inspiration only.

## 1. The frame

```
┌ title bar 40 (cabinet) [sidebar][‹][›]      [⌕ billing-api / proration drift in src/billing  ctrl K]      [details] [– □ ×] ┐
├ sidebar 256–288 (cabinet) ╭ ground (reading room), 14px concave corner                          ┊ 28px strip / panel 300–340 ┤
│ φ hypotaxis               │       ┌ margin 112 ┬ measure 608 ───────────────┐                    ┊ (cabinet, session tab only)│
│ [ Session | Bots ]        │       │ You 14:01  │ request card               │                    ┊                            │
│ + New session             │       │ qwen3-coder│ answer prose 14/1.6        │                    ┊ · context measure          │
│ billing-api               │       │ → sonnet   │                            │                    ┊                            │
│ • proration drift    now  │       └────────────┴────────────────────────────┘                    ┊                            │
│                           │       [ composer, 720 wide, card stock ]                             ┊                            │
│ (E) enzo             ⚙    │              ╭──[ dock, drawer colour, flush to the edge ]──╮       ┊                            │
└───────────────────────────┴──────────────┴──────────────────────────────────────────────┴───────┴────────────────────────────┘
```

| Part | Size | Notes |
|---|---|---|
| title bar | 40px, cabinet | left: the mark (Φ, or φ per Appearance) centred on the sidebar's icon axis x = 28, then sidebar toggle, back, forward (28px icon buttons). No wordmark. Centre of the window: the command field, clamp(240px, 34vw, 480px) × 26px, drawer colour with a hairline, shows "project / title" and `ctrl K`; it opens the palette. Right: session details toggle, then window controls (36×28) |
| left sidebar | open `--sb-w` clamp(256px, 15vw, 288px); rail 56px; closed 0 | full height under the title bar. Icon axis x = 28 (φ, glyphs, +, avatar), text line x = 44, group headings and brand outdented to x = 20 |
| ground | everything between the sidebars | reading-room colour; 14px concave corner against the cabinet at top-left (and top-right while the right panel is open and pushing) |
| right panel | closed: 28px bare strip; open: `--right-w` clamp(300px, 18vw, 340px), cabinet colour | session tab only (hidden on bots). Full height under the title bar |
| dock | resting height 76px (orbs 40 and the 24px foot), flush to the window bottom | pitch black `--dock-bg` (#000) in every theme, 14px top corners with 14px concave flares into the bottom edge |

Breakpoints: ≥1200 both sidebars push the ground; 900–1199 the right panel overlays with a shadow (Esc closes);
640–899 an open sidebar overlays a rail with a scrim; <640 the sidebar is a drawer, back/forward and window controls
hide, the command field fills the bar.

## 2. The centre line

`hx:layout` (viewport px) and the animated custom properties on `#hx-app` carry it: `--hx-center-x`, `--hx-col-left`,
`--hx-col-w`, `--hx-view-left`, `--hx-view-right`, `--hx-dock-space`, `--hx-margin-w`. `#hx-app[data-margin]` is
`on` or `off`.

- `centerX` = middle of the free ground (minus any `hx:view-inset {right}` of the current tab).
- `colWidth` = min(720, free − 64). `marginW` = 112 when `colWidth` ≥ 560, else 0 (the call number then sits on one
  line above its entry). Measure = `colWidth − marginW` (608 at full width).
- The composer is `colWidth` wide (it spans the margin and the measure), centred on `centerX`.
- Travel: bind to `--hx-center-x` (already animated on the shell's curve) or animate with
  `var(--dur-3) var(--spring)` (300ms, settle, no overshoot). No JS spring physics for travel.

| Window | Left | Right | centerX | column |
|---|---|---|---|---|
| 1920 | open 288 | strip 28 | 1090 | 720 |
| 1920 | open 288 | open 340 | 934 | 720 |
| 1440 | open 256 | strip 28 | 834 | 720 |
| 1440 | open 256 | open 300 | 698 | 720 |
| 1440 | rail 56 | strip 28 | 734 | 720 |
| 390 | drawer | strip 28 | 181 | 330 (margin off) |

## 3. A view, top to bottom

| Element | Rule |
|---|---|
| first entry | 32px below the title bar |
| entry | grid `112px 1fr`: call number in the margin, content in the measure. 32px between entries |
| call number | mono 11/1.45, `--text-quiet`; first line `--text-dim`. User: "You", time. Agent: one line per model ("qwen3-coder", "→ sonnet 5.5"), elapsed, cost. Bot: orb 20, name, time. Disclosures that belong to the entry ("6 steps") sit here too, as a quiet mono button |
| request card (what the user wrote) | card stock `--bg-3`, radius 10, padding 10px 14px, 14/1.6, `width: fit-content; max-width: 100%`, left-aligned in the measure. No right-aligned bubbles |
| answer prose | 14/1.6 `--text`, paragraphs 12px apart, lists indented 18px, inline code: Plex Mono 12.5px on `--chip`, radius 4, padding 1px 5px |
| blank | dotted underline in `--red` under the gap, then a stamp: mono 11/500, red outline, `--red-text`, radius 4, 20px tall, "waiting for you" |
| cards (approval, ship, teammate) | in the measure, left-aligned, `width: min(100%, 520px)`, drawer colour, radius 10 |
| hints above the composer ("Will assume …") | 12px `--text-quiet`, left-aligned with the composer's text, 8px above it, only while typing |
| composer | `--bg-3` with a hairline, radius 10, padding 12px 14px 8px; input 14/1.6 sans; a 28px toolbar inside at the bottom: left, attach and the mode chips (Governed, Smart); right, the spend "$0.37 of $0.60" in mono quiet, mic, send (bone square 28, radius 6). Nothing below the composer |
| composer bottom | `calc(var(--hx-dock-space) + var(--composer-gap))`: 88px with the dock at rest, 16px without. `--hx-dock-space` follows the height the dock reports in `hx:dock`, so when the dock expands the composer rises with it (same curve) instead of being covered |
| bottom padding of the scroller | composer height + composer bottom + 24px |

## 4. Type, spacing, shape, depth, motion

Tokens are final in `tokens.css`; DESIGN.md explains them.

- Families: `--sans` (Libre Franklin) for interface and prose; `--mono` (IBM Plex Mono) only for code, paths,
  numbers, times, costs, model names, call numbers and kbd.
- Sizes: 11 mono meta (`--fs-2xs`), 12 labels (`--fs-xs`), 13 interface (`--fs-s`), 14 reading (`--fs-m`), 16 titles
  (`--fs-l`), 20 one display moment (`--fs-xl`). Weights 400, 500 (labels, current), 600 (titles). Nothing else.
- Case: sentence case for interface text; "hypotaxis" lowercase; data as authored. No all caps, no middle-dot meta
  strings, no em dashes in interface copy, no "→" after links (the arrow in a model escalation is content).
- Spacing: 4, 8, 12, 16, 24, 32, 48 (`--sp-1` … `--sp-7`); rows 30 (`--row-h`) and 44 (`--row-h-2`).
- Radii: 4, 6, 10, 14 (`--r-xs`, `--r-s`, `--r-m`, `--r-l`); pill only for dots and the switch.
- Surfaces: cabinet `--bg-1`, reading room `--bg-2`, card stock `--bg-3`, drawer `--bg-0`, bone `--selected`.
  `--hair` divides inside a surface, `--line` outlines a control. Shadows only on floating things (`--shadow-pop`).
- Colour jobs: brass `--brass` = you are here (focus, current marker, active rung, checked); red `--red` /
  `--red-text` = the user owes something. Bot colours belong to their orbs only.
- Motion: hover 150/120ms, press 90ms, menus 200ms with a 6px drop, indicators 240ms, layout travel 300ms
  `--spring`. The only loop: a running item's dot breathes (1.8s, opacity), stopped under reduced motion. No
  transform, filter or will-change on a view root or any ancestor of a fixed element.
- Height: cards (approval, ship, blank, teammate) keep their height animation when their state changes (owner
  decision: it stops the conversation jumping). Use `var(--dur-3) var(--spring)`; under reduced motion it snaps.
  Elsewhere prefer opacity and transform for state changes.

## 5. Controls

| Control | Spec |
|---|---|
| primary button | `--selected` fill, `--text-on-light`, 30px, radius 6, 13/500, padding 0 14 |
| secondary button | transparent, inset 1px `--line`, `--text`; hover `--hover` |
| icon button | 28px, radius 6, icon 18px drawn at 1.5 stroke, `--icon`; hover `--hover` + `--text-strong` |
| segmented | 30px, drawer track with hairline, 3px inset, bone thumb radius 4, labels 13/500 |
| list row | 30px (44px two-line), inset 8px, padding 12px; glyph column 16px on the x = 28 axis; text from x = 44; meta right, mono 11 quiet; hover `--hover`, current `--current` + `--text-strong` |
| row glyph | running: bone dot breathing; needs you: red dot; current and idle: brass dot; otherwise nothing |
| field | radius 6, drawer colour on cabinet (card stock on reading room), inset 1px `--line`, focus ring on the field via `:focus-within`; textareas grow, no resize grip |
| switch | 34×20, as in Settings (`.hx-switch`) |
| focus | 2px brass ring, 2px offset, no transition |
| tooltip | card stock, radius 6, 12px, kbd chips after the label |

## 6. Slots

| Slot | Owner | Must |
|---|---|---|
| `#hx-list-session` | session-list | §5 rows, grouped by project; group heading 12/500 quiet at x = 20, 12px above; no search field (the command field is the search) |
| `#hx-list-bots` | bots-list | two-line rows: orb 20 on the axis, name 13 and role 12 quiet from x = 44, state word mono right ("working", "asleep", "needs you" in `--red-text`). No permanent "new bot" row (the sidebar's New button is "New bot" on this tab); while a bot is being made a draft row may sit at the top, current |
| either list, rail | optional | set `root.dataset.rail = 'ok'` and render a 56px variant when `HX.state.left === 'rail'` (bots: orbs 24 centred, 40px rows); otherwise the shell hides the list |
| `#hx-view-session` | session | §3; the scroller fills the slot |
| `#hx-view-bots` | bots | §3 with bot call numbers; header: orb 40, name 16/600, role 12 quiet, state; settings as an icon button at the right of the column |
| bots settings sheet | bots | inside `#hx-view-bots`, flush right, full height of the view, width `--right-w`, cabinet colour, 14px concave corner at its top-left, no border; emit `hx:view-inset {right: width}` while open |
| `#hx-right` | session-right | the shell paints the cabinet surface and the corner and keeps the open width while sliding; paint no outer background. Open: head 44px, "Session details" 13/600 at x = 20; no close button (the title-bar toggle and `mod+I` own it). Sections: 40px header rows (label 13, value mono 11 quiet right, chevron), body padding 0 20px 16px, hairlines between. Closed (28px): the context measure as one button, centred in the height above `--hx-dock-space`, 8 dots of 4px with 6px gaps, tooltip "Context 38% used" + `mod+I` |
| `#hx-dock` | dock | `position: fixed` is fine (the slot is never transformed); hide itself when `HX.state.dock === 'off'`; §1 geometry; orbs 40 at a 54px pitch; the foot (Arrange, the page nub, Minimise) inside the slab's last 24px, the nub's dots about 7px above the window edge; no tab on the top edge, no side lanes or arrows (owner, v10); a click outside it returns it to rest (session, grid, expanded page, arrange) without taking the click; the pill and off stay as they are (owner, v12) |

Events: the shell emits `hx:layout`, `hx:state`, `hx:tab`, `hx:new` {tab}, `hx:new-session`, `hx:new-bot`,
`hx:open-panel` {panel}; it listens to `hx:session-select`, `hx:bot-select`, `hx:attention` {source, count, tab?},
`hx:view-inset` {right, tab?}, `hx:title` {title, tab?} (shown in the command field), `hx:toast` {text}, `hx:dock`
{mode, page, width, height} (height becomes `--hx-dock-space`; mode `off` turns the dock off in the shell's state).

One owner per action: "New session" and "New bot" belong to the sidebar's New button (and `ctrl shift O`); lists
carry no "new" row, only a draft row while something is being made. The dock's "+" is the dock's own second path.

Local testing: `index.html` is a fragment (the Artifact host adds the doctype and head). Open it through a wrapper
with `<!doctype html>` (the shell's test harness does this), or quirks mode changes some metrics. Shortcuts belong to the shell (ctrl/⌘ K, B, shift B, ., J, shift O, comma, [ and ]; alt 1 and 2).
`HX.toggle()`, `HX.openPalette({scope})`, `HX.keys('mod+K')`, `HX.toast(text)` are available.

## 7. Conformance: what each module must change

Checked against `session.test.html`, `bots.test.html` and their code as of 15:44.

### session
1. Everything is set in `var(--mono)` (`.ss-view`, `.ssl`, `.ssr`, `.ssc`). Switch interface and prose to `var(--sans)`; keep mono for code, paths, numbers, times, costs and model names.
2. Prose is 12/22; make it 14/1.6 (`--fs-m`, `--lh`).
3. The user's message is a right-aligned bubble (`.ss-bubble`, max 660, `--r-xl`). Replace it with the entry grid (§3): call number "You, 14:01" in the margin, request card left-aligned in the measure.
4. The meta line under the answer ("qwen3-coder → sonnet 5.5 › 6 steps escalated once 3m 42s $0.37") moves into the margin as the call number; "6 steps" becomes the disclosure under it.
5. Composer: `--bg-1` with radius `--r-xl`, toolbar outside. Use card stock with a hairline, radius 10, width `colWidth`, bottom `dock-space + 16`; move Governance and Smart into the toolbar as chips; show the spend there; "Will assume" left-aligned, sentence case, only while typing.
6. Session list: remove "search sessions"; 30px rows with the glyph column on the x = 28 axis and titles from x = 44; meta mono 11; headings 12/500 at x = 20.
7. Right panel: drop `.ssr-panel`'s background and its close button; head and sections per §6; values in mono; labels sentence case ("Context", "Tasks", "Changes"); the closed strip is now 28px.
8. Blank: keep the dotted underline, add the "waiting for you" stamp (§3) instead of a lone red dot.
9. Labels to sentence case throughout ("Governed", "Will assume", "Session details"). Replace `--ss-quiet` with `--text-quiet`.

### bots
1. Everything is set in `var(--mono)`; switch interface and prose to `var(--sans)` (mono for times, costs, schedules).
2. List rows are 52px with a 26px orb at x = 22; use 44px rows, orb 20 on the x = 28 axis, text from x = 44. Remove the "new bot" row.
3. Thread: messages use a name-and-time line above the text; put the bot's orb, name and time in the call-number margin (§3) and render the user's messages as request cards.
4. Composer has a 1px outline and no fill; use the session composer's look and rules (§3).
5. Settings sheet: 400px with a left border to the window bottom; use §6 (width `--right-w`, cabinet colour, concave corner, no border).
6. Header: orb 44 with name 15; use orb 40, name 16/600, role 12 quiet; the gear stays a 28px icon button.
7. Sentence case for interface text ("New bot", "Message nina", "Governed"); "needs you" in `--red-text`.

### dock
1. Geometry per §1: `var(--dock-bg)` (always #000, never a theme colour), 76px at rest (foot included), `--r-l` corners and flares, orbs 40 at a 54px pitch. Text and icons inside the dock use the dock's own fixed light inks (`--dock-*` in dock.css), since the dock stays black when the theme is light.
2. Travel on `--hx-center-x` or a CSS transition with `var(--dur-3) var(--spring)`; no JS spring.

### cards
1. Drawer colour, radius 10, padding 14px 16px, title 14/600 sans, meta mono 11 quiet, buttons per §5, `width: min(100%, 520px)`.
2. Red only for the attention marker of an approval or a failure; no dither texture.
3. Keep the height animation on state changes (§4).

## 8. Theming: rules every module follows

The app is fully themeable (Settings > Appearance, rendered by `theme.js`). Four presets live in `tokens.css`
(`data-hx-preset` on `<html>`): **Card catalog** (warm dark, default), **Graphite** (neutral R = G = B grey, close to
the owner's Figma), **Bone** (light) and **Typewriter** (Geist Mono, lowercase, round corners). The user can change
any solid colour, the interface and code fonts, the interface case, corners and density; overrides are inline
custom properties on `<html>`, saved in localStorage, exportable and importable as JSON.

1. No literal colours in module files. Use the tokens; translucent ones (`--hair`, `--line`, `--line-strong`,
   `--hover`, `--current`, `--brass-soft`, `--red-soft`) already follow the theme. For a tint of your own, derive it:
   `color-mix(in srgb, var(--text) 6%, transparent)`.
2. The dock is the one fixed surface: `var(--dock-bg)` is #000 in every theme and is not offered in the customizer.
3. Fonts only through `var(--sans)` and `var(--mono)`; sizes only through `--fs-*`.
4. Sizes that density changes: `--row-h`, `--row-h-2`, `--ctl`, `--ctl-s`. Radii that corners change: `--r-xs`,
   `--r-s`, `--r-m`, `--r-l`. Use them instead of fixed px so Compact, Comfortable, Sharp and Round reach you.
5. Interface labels (buttons, tabs, headings, menu items, field labels, placeholders) take
   `text-transform: var(--ui-case)`; content (messages, session titles, bot names and roles, code) never does.
6. Light themes: `<html data-hx-theme="light">` is set whenever the ground is light. Prefer tokens; use the attribute
   only for what tokens cannot express (an orb's shadow, an image).
7. Anything that caches colours in JS (canvas, orb2 attributes) re-reads them on `hx:theme` {preset, scheme}.
   `window.HX_THEME` exposes `get()`, `set(patch)`, `preset(id)`, `reset()`, `exportJSON()`, `importJSON(text)`,
   `scheme()`.

## 9. Integration notes

- Load order (index.html): tokens.css, theme.js, components/components.css, shell.css, cards.css, session.css,
  bots.css, dock.css; then shell.js, data.js, components/components.js, cards.js, session.js,
  vendor/orb-avatar.min.js, bots.js, dock.js. The shell boots on DOMContentLoaded, after the library has loaded.
- The shell's own pieces come from the library (`HX.ui`): icons, the tabs pill and the rail (segmented, `ui:change`),
  the New button, the account menu, tooltips, the toast (`HX.toast` wraps `HX.ui.toast`), palette rows
  (`.ui-row`, `.ui-group__head`), keys (`.ui-keys`), settings rows and the customizer's fields. The palette and the
  dialogs stay shell singletons. The library closes its own layer on Esc before the shell sees the key.
- Attention: each tab's dot counts only the module that owns the items (`session`, `bots`; unique `ids` when sent).
  `cards` and `dock` re-report the same items and never add to a tab. An owner's zero is kept. `HX.attention(tab)`
  returns the count.
- `HX.state.orbGrow` (true by default; Settings > Appearance > Bots, and the palette's "Toggle grow bots on hover")
  says whether dock bots grow under the pointer. It changes through `setState`, so `hx:state` carries it, and the
  shell mirrors it on `#hx-app` as `data-orb-grow="on|off"`. The dock reads it.
- The first tab is the shell's decision: a `setState({tab})` made while modules mount is ignored. Switch tabs only in
  answer to a user action.
- Base rules (focus ring, selection, caret, scrollbars) come from `.ui-root` on `#hx-app`, at zero specificity; a
  module's own rule always wins.

## 10. Keyboard

The keymap is `KEYMAP.md` (v7). In short: the shell owns global keys and regions (F6, `mod+G` then a letter, F8
for things that need you, `?` for the sheet); modules mark focus targets (`data-hx-focus`, `data-hx-turn`,
`data-hx-attention`), handle keys inside their own region, and provide `find`, `stop` and `bot-settings` with
`HX.provide()`. The details panel moved from `mod+.` to `mod+I`; `mod+.` now stops the running turn.
