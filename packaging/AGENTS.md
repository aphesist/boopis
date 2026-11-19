# AGENTS.md: packaging

How boopis reaches a terminal: the installers (`scripts/install.sh`, `scripts/install.ps1`), the Arch install script (`arch/boopis.install`) and the art they and the app's binary (`boopis --version`, `boopis doctor`) draw. Why the art is data with three renderers: ADR-0026.

## Layout
```
packaging/
  brand/
    boopis.art       the art, as data: palette, sprites, scenes, animation frames (format below)
    render.awk       the renderer install.sh carries (POSIX awk)
    render.ps1       the renderer install.ps1 carries (ASCII only)
    golden/          what the host draws, per scene and colour level; every renderer must print these bytes
    icons/           the app icons (light and dark PNGs, 16 to 256) and the symbolic SVG; install.sh embeds them
  arch/boopis.install   pacman's install script: a static banner and two lines on how to start
scripts/
  install.sh  install.ps1   the installers; their `>>> brand` blocks are generated
  embed-brand.sh            writes those blocks (and the Arch banner); `--check` fails when one is stale
  test-brand.sh             awk against the goldens, and the blocks current
  test-install.sh           install then uninstall into a temp prefix, checksums, download path, terminal switches, macOS (stubbed)
apps/desktop/src-tauri/src/brand.rs   the reference renderer (and the colour and terminal rules); cli.rs uses it
```

## The art format (`boopis.art`)
One line per record; `#` starts a comment line. A **cell** is 2x2 **pixels**, drawn with the quadrant blocks (`▘▝▀▖▌▞▛▗▚▐▜▄▙▟█`), so a pixel is half a cell wide and half a cell tall.
- `format 1`
- `color <name> <#rrggbb | -> [hole]`: `-` is the terminal's own foreground (the ink: the wordmark takes it, so it is right on a light and a dark theme). A `hole` colour (the bots' eyes) is not drawn without colour.
- `sprite <name> <color>` then rows of `.` (nothing), `#` (the sprite's colour) and `o` (the eye colour), then `end`.
- `text <name> <string>`: the one-line logo (`compact`, `compact.ascii`).
- `scene <name>` with `slot <slot> <x> <y> <sprite>` (pixels), then `end`.
- `anim <scene>` with `frame <ms> <slot>=<sprite>[@dy] ...` (dy in pixels, up is negative), then `end`. The parser refuses an animation over 1.5 s in total.
- A cell holds at most one body colour and the eye colour; anything else is refused by the parser.
- Colour: truecolor, 256, 16, then none (`mono`: no escape codes, eyes are holes). The 256 and 16 fallbacks are the nearest palette colour by squared RGB distance (rules in `brand.rs`, copied exactly in `render.awk` and `render.ps1`).

## Terminal rules (the same in all three renderers and in the installers)
- No colour: `NO_COLOR` set and non-empty, `TERM=dumb`, output that is not a terminal, or `--no-color`.
- Colour level: `COLORTERM` of `truecolor` or `24bit` (or Windows Terminal) is truecolor; a `TERM` ending in `256color` is 256; any other terminal is 16.
- Unicode (the blocks, `✓ ✗`, the rounded box): a UTF-8 locale. Otherwise ASCII marks and `boopis` in plain letters.
- Animation (at most 1.5 s, at the start only): an interactive UTF-8 terminal, `CI` unset, `BOOPIS_NO_ANIMATION` unset, empty or `0`. The installer starts the download before the banner, so the animation never holds the work up.
- Marks: ✓ in moss green, ! in terra, ✗ in nina red: the bots' own colours, never a colour of their own.

## Changing the art
1. Edit `boopis.art` (the wordmark was sampled from `design/v6/brand/logo` at 9 rows; the bots are hand-made at 12 x 6 pixels).
2. `UPDATE_GOLDEN=1 cargo test -p hypotaxis-host brand` rewrites the goldens; read the diff.
3. `scripts/embed-brand.sh`, then `scripts/test-brand.sh` and `scripts/test-install.sh`.
The wordmark's letter shapes come from Libre Franklin (SIL OFL 1.1), as the logo's own do.

## What not to do
- Do not edit between `>>> brand` markers by hand; do not type the art into a script.
- Do not add a colour that is not the ink, a bot's colour or the eye ink. No gradients, no emoji.
- Do not pipe a download into a shell inside an installer; the installers only download a release file, check its sha256 and install it.
- Do not ask for `sudo` except under `--system`.
- Do not make the installers write anything that is not in the manifest: `--uninstall` removes exactly the manifest.
