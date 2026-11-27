# The approved v7 boards

These are the sources of the screens the owner approved for v7. **They are the binding reference for how the app
looks.** A screen in the app is done when it matches its board, in dark and light, at 1440 × 900.

- `src/screen.html?s=<screen>&theme=dark|light` draws one screen. The screens are defined in `src/screens.js`,
  `src/botscreens.js`, `src/sessiontab.js`, `src/sessiontab2.js`, `src/sessionnew.js` and `src/dockv7.js`.
- `src/kit.css` and `src/kit.js` are the boards' kit: the exact sizes, spacing and structure of every part.
- `src/jobs-*.json` list every rendered board with its parameters.
- The orb library is not copied here. Point `screen.html` at the app's vendored `orb-avatar` to render.

- `src-k02/` is the source of the later board K02 (the owner's 23 November picks for the Bots sidebar: the main bot at 44, rows
  of 28, the switch in the sidebar; `bots/K02-*.jpg` in the archive): only the files it changed, the rest are `src/`'s
  (`screen.html?s=room&sidebar=open&queue=1&main=44`). Where it and `src/` disagree on the Bots sidebar, K02 is the later decision.

- `src-onboarding/` is the source of the onboarding boards, round 3 (`onboarding/screens/O-*.jpg` in the archive): the files it adds
  or changed, the rest are `src/`'s (`ob3.html?s=o3P01`, `o3S03`, `o3B06` …; the archive's `jobs3-screens.json` lists every one).

The written spec is `../DESIGN-SYSTEM.md` and `../SESSION-TAB.md`. Where the spec and a board differ, ask the owner.

## Comparing the app with a board

`pnpm lab:board <board>` in `apps/desktop/ui` draws a board from these sources beside the app's own screen on the same content
and measures the difference (docs/UI-LAB.md, "A screen against its approved board"). `apps/desktop/ui/tests/lab/boards.json`
lists which boards have a screen in the app so far.
