# The kit's terms

The v7 kit (`apps/desktop/ui/src/components/v7/`) uses a few words in one sense each. The rules (`RULES.md`), the state table
(`STATE.md`), the contracts and the generated article (`pnpm kit:docs`) all use them this way.

| Term | What it means here | Where it is |
|---|---|---|
| **component** | One thing the kit draws, under one public name (Button, AskCard, Dock). Its root carries `data-kit="<Name>"`. Each has a folder of its own. | `components/v7/<name>/` |
| **view** | The function that turns typed props into markup: `button(o: ButtonOpts): string`. It reads nothing and keeps nothing; the same props give the same markup. | `<name>/<name>.ts` |
| **part** | A named piece of a component that the lab and the app can find (`data-kit-part="SegmentedItem"`), or a small sibling that only exists inside it (a Card's Row, a Disclosure's Steps). A part lives in its parent's folder. | the parent's view |
| **behaviour** | What a component does with keys, focus and the pointer, wired once per element by `wire.ts`. It changes ARIA and data attributes and dispatches events; it never redraws the component. | `<name>/behaviour.ts` |
| **props** | The typed options a view takes (`ButtonOpts`). Props go down: a screen draws a component from props, and draws it again with new props when its data changes. | the view's `…Opts` type |
| **event** | What a component says came up from the person: a bubbling `CustomEvent` on its root, named `ui:…`, cancelable where an action follows. The one list is `UiEvents`. | `components/v7/events.ts` |
| **contract** | What a component promises, as a typed const beside its view: its props (each described), events, states, parts, tokens, a11y and boards. Tests check it against the code. | `export const contract` in the view; `contract.ts` |
| **state** | What is true of a component now (on, open, running, chosen). It lives in one of four places: the element, the module, a Source, or the host. | `STATE.md` |
| **source** | A part of the data provider that a screen reads and commands: a `Watch`, a `Feed`, or a set of commands (`TeamPlansSource`, `ParkedSource`). The mock and the live provider implement the same ones. | `src/data/provider.ts` |
| **host** | The Tauri app around the web view: its commands (`secret_set`, `dictation_start`) and its events. The web view never holds a secret. | `src-tauri/`, `src/host/` |
| **story** | The first test level: props in, markup and states out, in vitest. `describe('story: …')` in a component's test file. The lab's stories (`<name>.stories.ts`) draw the same states for people and for the checker. | `<name>/<name>.test.ts`, `<name>/<name>.stories.ts` |
| **scene** | The second test level: the behaviour in jsdom, keys and clicks in, events and ARIA out. `describe('scene: …')`. | `<name>/<name>.test.ts` |
| **play** | The third test level: the smoke in a real browser, the whole app running (`pnpm test:smoke`, parts such as `controls`, `keys`, `axe`). | `tests/smoke/` |
| **board** | An approved image of a screen. `pnpm lab:board` draws the board from its source beside the app's story and measures the difference; a component's contract names the boards it stands on. | `tests/lab/boards.json`, `docs/design/v7/boards/` |
| **token** | A named value of the design (a colour, a length, a duration) declared on a v7 root by `styles/tokens.v7.css`, which `pnpm tokens` writes from `tokens.v7.json`. A component's CSS reads tokens only. | `src/styles/tokens.v7.{json,css}` |

Two more words the code uses:

- **wire**: `kit.<name>(opts)` returns the element already wired; `kit.html.<name>(opts)` returns the markup, and `kit.wire(root)`
  wires everything under a root once (a screen that writes markup itself calls it after).
- **layer**: where a component stands in the kit's order (control, inline, row, block, surface, thread, compose, dock, notify).
  Each layer builds on the ones before, and the article teaches them in that order.
