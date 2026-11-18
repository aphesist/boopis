---
name: hypotaxis
description: A desktop harness for AI coding agents; one nameless coding agent per session, named bots as teammates.
colors:
  cabinet: "#121110"
  reading-room: "#181715"
  card-stock-dark: "#23211e"
  drawer: "#0c0b0a"
  bone: "#ece6da"
  ink: "#1a1815"
  text: "#e9e4da"
  text-strong: "#f6f2ea"
  text-dim: "#a59d90"
  text-quiet: "#958c7f"
  brass: "#c8a66a"
  stamp-red: "#e5484d"
  stamp-red-text: "#f0646a"
typography:
  body:
    fontFamily: "Libre Franklin, Franklin Gothic, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  ui:
    fontFamily: "Libre Franklin, Franklin Gothic, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  title:
    fontFamily: "Libre Franklin, Franklin Gothic, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  callno:
    fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.01em"
rounded:
  xs: "4px"
  s: "6px"
  m: "10px"
  l: "14px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.s}"
    height: "30px"
    padding: "0 14px"
  button-secondary:
    textColor: "{colors.text}"
    rounded: "{rounded.s}"
    height: "30px"
    padding: "0 14px"
  request-card:
    backgroundColor: "{colors.card-stock-dark}"
    textColor: "{colors.text}"
    rounded: "{rounded.m}"
    padding: "10px 14px"
  composer:
    backgroundColor: "{colors.card-stock-dark}"
    textColor: "{colors.text}"
    rounded: "{rounded.m}"
    width: "720px"
  dock:
    backgroundColor: "{colors.drawer}"
    rounded: "{rounded.l}"
    height: "72px"
---

# Design System: hypotaxis

## Overview

The world is the library card catalog: an ebonised cabinet of drawers, cards typed on a typewriter, a call number in
the corner of every card, a brass label holder on the drawer you have open, and a red due-date stamp when something
is owed. It lends this working screen four things only: palette, type, density and one signature move. Layout,
navigation and controls stay the standard ones a developer already knows from desktop harnesses.

Signature move: **the call-number margin**. Every unit of work carries its call number in a fixed 112px margin on
the left of the conversation column: who or which model, how long, how much. "qwen3-coder → sonnet 5.5, 3m 42s,
$0.37" is typed there in mono, quiet, always in the same place. Cost and model are always knowable and never loud.

Raised by the challengers the direction beat (Impeccable concept roll, unattended):
- From the emission-line plate: state is carried by form before colour (a breathing dot for running, nothing for
  idle, a line struck through for archived), so colour stays free for meaning.
- From the orienteering map: brass is the one reserved "you are here" colour: focus, the current item, the active
  rung. It is never decoration.
- From the transit map (competitive): the governance ladder is drawn as a line with stations, the current station in
  brass.
- From the character goods catalog (competitive): every bot has the same fixed furniture in the same places: orb,
  name, role, schedule, state word.
- From the cassette j-card: hard capacities show a running total against the limit, right-aligned in mono
  ("76k / 200k", "$0.37 of $0.60").
- From the bitmap specimen: one family per role, at fixed steps; no ad-hoc sizes.

## Colors

Everything below is the default preset, Card catalog. The app is themeable (Settings > Appearance): presets
Card catalog, Graphite (neutral grey close to the owner's Figma), Bone (light) and Typewriter (mono, lowercase), plus
per-colour editing with contrast warnings, font, case, corner and density choices, and JSON export and import.
The dock is pitch black (`--dock-bg`, #000) in every theme and is not themeable.

### Primary
- **Brass** `#c8a66a`: you are here. Focus rings, the current row's marker, the active rung, checked menu items,
  selection. Never a fill for large areas, never decoration.

### Neutral
- **Cabinet** `#121110`: the frame (title bar, sidebars, the open right panel, menus, palette, dialogs).
- **Reading room** `#181715`: the ground the work sits on.
- **Dark card stock** `#23211e`: things the user wrote or is writing (request cards, the composer), tooltips.
- **Drawer** `#0c0b0a`: things set into the work (the dock, approval and ship cards, inset fields).
- **Bone** `#ece6da` on **ink** `#1a1815`: the selected segment and primary buttons; the one high-contrast object.
- Text: bone `#e9e4da`, dim `#a59d90`, quiet `#958c7f` (meta that must stay readable), faint `#5b554c` (decoration only).

### Named Rules
- **The stamp rule.** Red (`#e5484d` for dots and outlines, `#f0646a` for text) appears only when the user owes
  something: a blank waiting, an approval, a failed gate. Nothing else is red, ever.
- **The warm-neutral rule.** Every neutral leans a few degrees warm; no pure greys, no pure white.

## Typography

- **Libre Franklin** (400, 500, 600) for interface and prose: the American gothic of library labels and signage.
- **IBM Plex Mono** (400, 500) for code, paths, numbers, timestamps, costs, model names, call numbers and kbd: the
  typewriter lineage of the catalog card. Never as a costume for "technical" prose.

### Hierarchy
- Display 20/600: one per screen at most (a bot's name under its orb).
- Title 16/600: view and dialog titles.
- Reading 14/1.6: conversation prose and the composer; measure 608px (about 80 characters).
- Interface 13/1.35: rows, buttons, menus, tabs.
- Label 12/500: group headings, field labels, tooltips.
- Call number 11 mono: meta, times, costs, kbd.

### Named Rules
- **Sentence case** for interface text ("New session", "Show the dock"). The brand is always lowercase:
  "hypotaxis". Content keeps its own case. No all caps, no middle-dot meta strings, no em dashes in interface copy.

## Layout

Standard harness organisation: title bar with a centred command field, a left sidebar with the two tabs, the work
column in the middle, an optional right panel, the dock at the bottom edge. Geometry and per-slot rules are in
LAYOUT.md. The sidebar has one icon axis (x = 28, the rail's centre) and one text line (x = 44).

## Elevation & Depth

Flat. Surfaces separate by tone (cabinet, reading room, card stock, drawer). Hairlines (`--hair`) divide inside a
surface; `--line` outlines controls. Shadows only on things that float over other things (menus, palette, dialogs,
overlay drawers): `--shadow-pop` (0 16px 40px at 50% black), `--shadow-side` for a drawer over the ground,
`--shadow-tip` for tooltips. Pill radius only for status dots and the switch.

## Shapes

Small corners, as on catalog cards: 4 (kbd, chips, stamps), 6 (buttons, rows, fields, segmented control),
10 (cards, composer, menus), 14 (where the ground meets the cabinet, the dock, dialogs, palette). Concave corners
where a surface grows out of an edge: the ground under the title bar, the dock into the bottom edge.

## Components

### Buttons
Primary: bone fill, ink text, 30px, radius 6, 13/500. Secondary: transparent, inset 1px `--line`. Icon: 28px,
radius 6, 18px stroke icons at 1.5. Hover fills `--hover`; press moves 1px down and scales .96 to .985.

### Segmented control
Drawer-colour track with a hairline, 3px inset, a bone thumb that slides (240ms).

### Lists
30px rows (44px for two lines), inset 8px, text on the 44px line, glyph on the 28px axis, meta right-aligned mono.
Current row: `--current` fill and a brass marker when idle.

### Stamp
Mono 11/500, red outline, red text, radius 4, 20px tall: "waiting for you", "needs you", "failed".

### Dock orbs (owner decisions, v10 and v11)
A click (or Enter, or Space) opens the bot's session in the dock: its last messages, its open card and a composer;
a small poke is the click's feedback and the tab stays. The same orb again, or Esc, closes it; another orb switches
it. A double-click (or mod+Enter) opens the bot's full chat in the Bots tab. "Grow bots on hover" (Settings >
Appearance, `HX.state.orbGrow`, on by default) lets the hovered orb grow. Approval is a hold of 1 second wherever it
appears (`--dur-hold`): the dot fills while held, and releasing early cancels.

## Do's and Don'ts

- Do put model, time and cost in the call-number margin; don't repeat them in the prose.
- Do keep brass for "you are here" and red for "you owe something"; don't use either as an accent.
- Do keep every control standard; don't draw drawers, cards with holes or typewriter keys.
- Don't animate anything that is not changing state, except the running dot's breathing.
- Do let cards animate their height when their state changes (owner decision: the conversation must not jump).
