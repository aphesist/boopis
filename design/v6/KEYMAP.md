# boopis keymap (v7)

One keymap for the whole app. The shell owns every global key and the region model; each module owns the keys
inside its own region. The help sheet (`?` or `mod+/`), Settings > Keyboard, the palette and the tooltips all
render from the table in `shell.js` (`KEYGROUPS`), so this file and that table must change together.

## 0. Rules

- **mod** is ⌘ Command on macOS and Ctrl on Windows and Linux. **alt** is ⌥ Option on macOS. Show keys with
  `HX.keys('mod+K')` (it prints ⌘K on a Mac, `ctrl K` elsewhere) and set `aria-keyshortcuts` on the control.
- Match letters and digits with `KeyboardEvent.code` (`KeyK`, `Digit1`), never `key`, so Option on macOS and
  non-US layouts still work. Punctuation: `Period`, `Comma`, `Slash`, `BracketLeft`, `BracketRight`.
- Two layers.
  - **Modifier keys** (mod, alt, F-keys) work everywhere, including while typing.
  - **Single keys** (j, k, o, c, g, ?, /, digits) work only when focus is not in a text field (input, textarea,
    select, contenteditable) and no dialog or palette is open.
- A module handles a key on its own elements and calls `preventDefault()` (and `stopPropagation()` for Esc) when
  it consumes it. The shell's window handler skips events that are already `defaultPrevented`.
- Never bind a global key in a module. Never take a text-editing key while the user types (mod+A/C/V/X/Z/Y,
  arrows with or without modifiers, Home/End, alt+arrows, Backspace/Delete).
- No traps. Tab and Shift+Tab always move on, except inside a modal (palette, dialogs), which Esc always closes.
  Every focusable thing shows the brass focus ring (`:focus-visible`).
- Destructive actions never sit on a single key. Approve is a hold of 1 second, everywhere (owner decision; `--dur-hold`).

## 1. Global (shell; works everywhere)

| Key | Action | Notes |
|---|---|---|
| mod+K | Command palette: sessions, bots, commands | `>` limits to commands, `@` to bots |
| mod+P | Go to a session or bot | the palette without commands |
| mod+F | Find in this conversation | shell calls the `find` provider of the current tab; with none, the browser's find runs |
| mod+shift+O | New session (Session tab) or new bot (Bots tab) | emits `hx:new` and `hx:new-session` or `hx:new-bot` |
| mod+. | Stop the running turn | shell calls the `stop` provider of the current tab |
| mod+[ , mod+] | Back, forward | the shell's own history of tabs and selections |
| alt+1, alt+2 | Session tab, Bots tab | |
| mod+B | Sidebar: open, or collapse to the rail (or hide, per Settings) | |
| mod+shift+B | Sidebar: hide completely, or show | |
| mod+I | Details panel: session details on Session, bot settings on Bots | was mod+. in v6; mod+. is now Stop |
| mod+J | Dock on or off | |
| mod+shift+J | Dock expanded or normal | shell calls `window.hxDock.setMode()` |
| mod+, | Settings | |
| mod+shift+, | Settings > Appearance (theme customizer) | |
| mod+shift+S | Store: browse and install skills, connectors, plugins and mods | opens the store view; Esc closes it |
| mod+shift+L | Light or dark | to Bone, and back to the user's last dark theme with its overrides |
| mod+/ | Keyboard shortcuts sheet | also `?` outside text fields |
| F6, shift+F6 | Next, previous region | order: title bar, sidebar list, conversation, composer, details panel, dock; skips what is closed |
| F8, shift+F8 | Next, previous thing that needs you | blanks, approvals, failures; current tab first, then the other tab (the shell switches tab) |
| mod+G, then a key | Go to (a hint appears for 1.6 s) | L list, M conversation, I composer, P details panel (opens it), D dock (turns it on), S Session tab, B Bots tab, 1–9 bot n in the dock, Esc cancels |
| Esc | Close the top layer: palette, menu, dialog, overlay panel or drawer. With nothing open: from the composer or the details panel, go to the conversation | modules close their own popovers first and consume the Esc |

## 2. Navigation layer (shell; outside text fields)

| Key | Action |
|---|---|
| ? | Keyboard shortcuts |
| g, then a key | Go to, as mod+G; `g g` asks the focused region for its first item (`hx:nav {action:'first'}`) |
| / or i | Focus the composer |

## 3. Regions and the module contract

The shell focuses a region's **default target** and remembers the last focused element of each region.

| Region | Root | Default target (first that exists) |
|---|---|---|
| title bar | `.hx-bar` | the command field |
| sidebar list | the active `#hx-list-session` or `#hx-list-bots` | `[data-hx-focus="list"]`, else `[aria-current="true"]`, else the first focusable |
| conversation | the active `#hx-view-*` | `[data-hx-focus="messages"]`, else the last `[data-hx-turn]`, else the view itself |
| composer | inside the active view | `[data-hx-focus="composer"]`, else the first visible textarea or contenteditable |
| details panel | `#hx-right` (Session), `[data-hx-panel]` (Bots sheet) | `[data-hx-focus="panel"]`, else the first focusable |
| dock | `#hx-dock` | `[data-hx-focus="dock"]`, else `[aria-current="true"]`, else the first focusable |

Modules must:

1. Mark the element that should take focus: `data-hx-focus="list|messages|composer|panel|dock"`.
2. Make every conversation turn a focusable element with `data-hx-turn` and `tabindex="-1"` (roving: the
   focused turn gets `tabindex="0"`). Give turns an accessible name ("You, 14:01", "qwen3-coder then sonnet 5.5,
   3m 42s, $0.37").
3. Put `data-hx-attention` on the focusable element of every item waiting on the user (the blank's button, the
   approval's Hold button, a failed gate's primary action), and remove it when resolved. (Until then the shell
   also finds `button.ss-blank`, `button.cd-blank` with a stamp and `button.cd-hold[data-hold]`.)
4. Provide actions the global keys call, returning `true` when handled:
   `HX.provide('find', ({tab}) => …)`, `HX.provide('stop', ({tab}) => …)`, `HX.provide('bot-settings', ({toggle}) => …)`.
5. Expose `window.hxDock.botAt(n)` returning the id of the n-th bot as the dock shows them (the shell uses
   `data.js` order until then).
6. Listen to `hx:nav {action:'first'|'last', region}` and `hx:region {region}` if useful.

## 4. Sidebar lists (session-list, bots-list)

| Key | Action |
|---|---|
| ↑ ↓, k j | Previous, next row (roving focus; group headings are skipped) |
| Home, End | First, last row |
| shift+↑, shift+↓ | Previous, next project group (session list) |
| Enter | Open the row (the view shows it; focus stays in the list) |
| Esc | Back to the conversation |

## 5. Conversation (session, bots)

| Key | Action |
|---|---|
| ↑ ↓, k j | Previous, next turn |
| Home, End, `g g`, shift+G | First turn, latest turn |
| Enter, o | Open or close the focused turn's steps |
| c | Copy the turn as Markdown (toast "Copied") |
| e | Edit your message (it returns to the composer; only on your own turns) |
| d | Open the turn's diff (changes or ship card) |
| b | Answer the blank in the turn (opens its popover) |
| Tab, shift+Tab | Move through the controls inside the turn, then on |

## 6. Cards and forms (cards)

Keys work on the card that has focus, in every place a card appears (the conversation, the dock, the Bots section,
team chat). Single keys never act while focus is in a text field.

| Key | Action |
|---|---|
| hold Space (1 s), or Enter twice | Approve, on the focused "Hold to approve" button (the dot fills while held; releasing early cancels). A form whose submit is a hold submits the same way |
| x | Deny, while focus is in an approval card; cancel, while focus is in a form (the sender continues without it) |
| d | Open the diff, while focus is in a ship card |
| 1–9 | Pick an option: in the blank popover, and in a form's option list (the focused list, else the first). In a multi-select list they toggle |
| ↑ ↓ | Move through a form's options (single choice selects as it moves); from the last option, ↓ goes to "Other" |
| Tab, Shift+Tab | Move between a form's fields, then its buttons |
| Tab (to a cut name) | A sender's name that is cut short in a card's byline takes focus only then, and its full name shows as the tooltip; in a one-row card the row itself shows it |
| Enter | Submit the form from a field or an option (Ctrl or ⌘ + Enter from long text). A hold form moves focus to its hold button instead of submitting |
| Esc | Defer the form ("Later": it collapses and waits in the dock; Open brings it back). In the blank popover, close it and return focus to the blank |

Every card waiting on the user marks its focusable element with `data-hx-attention` (the hold button, the blank,
a form's first field, a failed gate's primary action), so F8 and Shift+F8 reach it.

## 7. Composer (session, bots, the dock's session)

| Key | Action |
|---|---|
| Enter | Send |
| shift+Enter | New line |
| mod+Enter | Send now, even with a menu or the assumptions open |
| ↑ (composer empty, caret at start) | Edit your last message |
| Tab (when "Will assume" shows) | Into the assumptions row: ← → between them, Enter or Space changes the focused one, Delete drops it, shift+Tab or Esc back to the text. With no assumptions, Tab moves on as usual |
| alt+G | Governed or ungoverned |
| alt+S | Smart (Automatic) on or off |
| alt+M | Who answers next: the model chip's menu. Automatic (Smart) first, then every usable model by provider (↑ ↓, Enter, Esc) |
| alt+C | Ask a council: opens the form (members, combiner); the next message is answered by several models and combined by one. Not offered in a governed session |
| alt+A | Attach files |
| alt+V | Talk (the mic, in every composer; owner decision): a tap toggles listening, a hold of 400ms or more talks while held and stops on release. With a bot as the target its orb listens |
| Esc, while listening | Stop listening (the composer consumes it); the next Esc does what it always does |
| Esc | Close a popover; otherwise go to the conversation (latest turn) |

## 8. Dock (dock)

Each region of the dock is one Tab stop and the arrows move real focus inside it (roving tabindex): a screen reader
announces each orb or row by its name, the focus ring is the squircle ring, and the arrows never scroll the page.

| Region | Key | Action |
|---|---|---|
| Bot row (at rest) | ← →, Home, End | Previous, next bot (and "+"), first, last. The focused orb shows its tooltip, and grows if "Grow bots on hover" is on |
| | ↑ | Open the grid on the same bot |
| | ↓ | Minimise the dock |
| | Enter, Space | Open the bot's session in the dock: its last messages, its open card, a composer. Again closes it |
| | mod+Enter | Open the bot's full chat in the Bots tab (bot selected); the same as a double-click |
| Grid (expanded) | ← → ↑ ↓, Home, End | Move in 2D; ← → wrap by rows; ↓ from the last row goes back to the bot row (on the same bot) |
| | Enter, mod+Enter | Open the session, the full chat |
| Session switcher (under the composer) | ← →, Home, End | Previous, next bot |
| | Enter | Switch the session to that bot (focus stays in the switcher); on the open bot, close the session |
| Queue (Needs you, at rest) | ↑ ↓, Home, End | Previous, next row |
| | Enter | Expand it (the compact cards) |
| Page nub | ← →, Home, End | Previous, next, first, last page (a tablist) |
| Anywhere in the dock | [ ], PageUp PageDown | Previous, next dock page. The arrows never change pages |
| | 1–9 | Bot n: in the row (or in the grid when it is open; anywhere: mod+G 1–9) |
| | Esc | In a session (its composer included): close it, focus back on its orb (in the grid when it was opened there). Otherwise collapse an expanded dock, then return focus to where it came from. A click anywhere outside the dock does the same (below) |
| | ↑ ↓ (elsewhere) | Expand, collapse; in a session they move nothing, and in its message log they scroll it |

In a session the composer keeps §7 (Enter sends to that bot's thread, `HX.data.botThreads`; Shift+Enter breaks the
line; alt+V talks to that bot, whose orb listens; Esc while listening stops listening before it closes the session)
and its card keeps §6 (hold Space 1 s, or Enter twice, approves). mod+Enter on an orb was chosen over a second
key so the orb keeps one verb per key: Enter opens here, mod+Enter opens there.

Pointer, on an orb (owner decisions, v10; the keys above are their equivalents):

| Gesture | Action |
|---|---|
| Click | Opens the bot's session in the dock (a small poke is the click's feedback); the current tab stays |
| Click the same orb again (in the session's head or the switcher) | Closes the session, back to the row |
| Click another orb (the switcher under the composer) | Switches the session |
| Double-click | Opens the bot's full chat in the Bots tab (as mod+Enter) and closes the session. The second click is the double-click's alone: whatever it lands on (a Deny button, the page) never receives it |
| Hold on "Hold to approve" (1 s) | Approves; releasing early cancels (as hold Space) |
| Click anywhere outside the dock | Returns it to rest: a session, the grid, an expanded page or the arrange view goes back to the row. The click still reaches what it was on, and focus stays there. The pill stays a pill and an off dock stays off; a session's typed text is kept for next time. A press that starts inside the dock (a drag) or in a menu or popover the dock opened counts as inside |

There is no short press any more: pressing and holding an orb is a click. The orb's accessible description says the
same: "Click or Enter opens its session here. Click it again, or Esc, to close. Double-click or Control+Enter opens the
full chat in the Bots tab." Pages: a sideways swipe or trackpad drag, [ ] or PageUp PageDown, or a dot of the nub in
the slab's foot. There are no side arrows or lanes.

## 9. Details panel (session-right, bots settings sheet)

| Key | Action |
|---|---|
| ↑ ↓ | Previous, next section header |
| Enter, Space | Open or close the section |
| Esc | Back to the conversation (the panel stays open; mod+I closes it) |

## 10. Palette, menus, dialogs (shell)

Palette: ↑ ↓ or Tab and shift+Tab move, Enter runs, Esc closes; `>` commands only, `@` bots only. Menus: ↑ ↓,
Home, End, Enter, Esc returns focus to the opener. Dialogs: Tab cycles inside, Esc closes and focus returns.
Settings tabs and segmented controls: ← →.

## 11. Conflicts avoided

| Avoided | Why |
|---|---|
| mod+N, T, W, Tab, 1–9, shift+N/T/W | browsers keep them (and Tauri users expect window keys there) |
| ⌘Q, ⌘H, ⌘M, ⌘` , ⌘⇧3/4/5 | macOS system keys |
| ctrl+alt+anything | AltGr on Windows keyboards types characters; Linux uses ctrl+alt+arrows for workspaces |
| alt+D, alt+E, alt+F | browser menus on Windows and Linux |
| F5, F11, F12 | reload, full screen, developer tools |
| single-letter type-ahead in lists | would collide with j and k |
| alt+M for the mic | taken by the model picker; alt+V (voice) instead. Like alt+S, alt+V opens a menu in Firefox on Windows and Linux (View); the composer consumes it, and the desktop app has no such menu |

In a web browser (the published mock-up) F6 may move focus to the browser's address bar, and on Linux alt+1 and
alt+2 may switch browser tabs; mod+G gives every region its own key, and every action is in the palette. In the
desktop app all of the above work.

## 12. Status

Walked through end to end on the integrated build (18 November 2026, after the corners and v10/v11 dock changes):
110 of 110 checks pass, every section, in Chrome at 1440 by 900, including alt+V (tap, hold, Esc) in the session and
dock composers, the dock session (Enter, Space, mod+Enter, Esc, 1–9, ↑ ↓) and grow on hover on and off.

| Part | Owner | State |
|---|---|---|
| §1, §2, §3 shell side, §10, the sheet, tooltips, palette | shell | done |
| §3 markers and providers, §5, §7 | session | done |
| §3 markers and providers, §4 bots list, §5 thread, §7, §9 sheet | bots | done |
| §6 (hold Space 1 s, Enter twice, x, d, 1–9, arrows, Tab, Enter, Esc defers; `data-hx-attention`) | cards | done, forms included |
| §8, the pointer gestures, `hxDock.botAt(n)` | dock | done |
| §7 alt+V and Esc while listening (in `HX.ui.composer`) | design system | done in the library; shell adds the row to `KEYGROUPS`, dock and bots pass `bot` (MIGRATION.md §8) |
