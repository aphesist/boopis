# The approved v7 boards

These are the sources of the screens the owner approved for v7. **They are the binding reference for how the app
looks.** A screen in the app is done when it matches its board, in dark and light, at 1440 × 900.

- `src/screen.html?s=<screen>&theme=dark|light` draws one screen. The screens are defined in `src/screens.js`,
  `src/botscreens.js`, `src/sessiontab.js`, `src/sessiontab2.js`, `src/sessionnew.js` and `src/dockv7.js`.
- `src/kit.css` and `src/kit.js` are the boards' kit: the exact sizes, spacing and structure of every part.
- `src/jobs-*.json` list every rendered board with its parameters.
- The orb library is not copied here. Point `screen.html` at the app's vendored `orb-avatar` to render.

The written spec is `../DESIGN-SYSTEM.md` and `../SESSION-TAB.md`. Where the spec and a board differ, ask the owner.
