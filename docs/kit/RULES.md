# The kit's rules

These hold for every component of the v7 kit (`apps/desktop/ui/src/components/v7/`). The words are defined in `TERMS.md`; where state
may live is `STATE.md`. The design rules (tokens, corners, motion, the boards) are the design system's (`docs/UI-COMPONENTS.md`,
`DESIGN-SYSTEM.md` v7); these are the rules of the code's shape. Section 7 is the rule for the words the app shows in settings and
settings-like places, components and modules alike.

## 1. Props down, events up

- A view takes typed props and returns markup. It reads no data, keeps nothing, and gives the same markup for the same props.
- A screen draws a component from props, from a Source's value, and draws it again when the value changes.
- What a person does comes back as an event of the kit's one map, `UiEvents` (`events.ts`): a bubbling `CustomEvent` on the
  component's root, named `ui:…`, dispatched with `emit(el, name, detail, cancelable)`. A screen listens once on a container with
  `kit.on(root, name, handler)` (or `addEventListener`), and turns the event into a command on its Source.
- Where an action follows (a Switch turning on, a tab chosen, the composer sending), the event is cancelable, and a listener that calls
  `preventDefault()` keeps the component as it was.
- A new event is added to `UiEvents` (name and detail type) before anything dispatches it. Never dispatch a string the map does not
  name; never put a callback in props where an event would do.

## 2. Every component has a contract

Beside its view, every component exports `contract = defineContract<Opts>({ … })` (`contract.ts`):

| Field | What to write |
|---|---|
| `name`, `folder`, `layer` | its public name (its `data-kit`), its folder, where it stands in the kit's order |
| `summary` | one or two plain sentences: what it is for |
| `exports` | the functions of `kit.html` the folder owns (the component, and parts the app draws on their own) |
| `props` | every prop of its options type, each with what it does; the compiler fails when one is missing |
| `events` | the `ui:` events it dispatches |
| `states` | the ARIA and data attributes that say its state |
| `parts` | its named parts (`data-kit-part`) and the pieces with a name of their own |
| `tokens` | the v7 tokens its CSS reads |
| `a11y` | how a keyboard and a screen reader meet it |
| `boards` | the approved boards the lab compares it on (`tests/lab/boards.json` ids) |

`contract.test.ts` checks it against the code: each event is in the map and each event the behaviour dispatches is listed; each token
is one `tokens.v7.css` declares, and every token the CSS reads is listed; each board is one the lab compares; each part is drawn; the
root carries `data-kit="<name>"`; and every function of `kit.html` belongs to exactly one contract. The article (`pnpm kit:docs`) is
written from the contracts and the folders' files, so a contract that lies is a doc that lies.

## 3. One folder per component

```
components/v7/<name>/          <name> is the public name in kebab-case (AskCard: ask-card)
  <name>.ts                    the view (typed props to markup) and the contract
  behaviour.ts                 keys, focus and pointer, wired by wire.ts (only when it has any)
  <name>.css                   its look: tokens only
  <name>.stories.ts            the lab's states of it (id kit/<name>)
  <name>.test.ts               describe('story: …') and describe('scene: …')
```

- A small sibling that only exists inside another (a Card's Row, a Disclosure's Steps, the chrome's TitlePill) is a part of its
  parent and lives in the parent's folder.
- `index.ts` is the barrel: everything the app uses is reached through `@boopis/ui` (`kit`, `kit.html`, the types). Nothing outside
  the kit imports a component's file.
- `wire.ts` is a registry: it imports each `behaviour.ts` and wires it by selector, in a fixed order. Behaviour goes in the folder,
  never in `wire.ts`.
- `kit-v7.css` imports each component's CSS in the kit's cascade order. A new component's file goes after the ones it builds on.
- The foundations stay at the root: `base.css` (what every component inherits), `util.ts`, `events.ts`, `contract.ts`, `theme/`.

## 4. Test levels, named everywhere

| Level | What it proves | Where | Run |
|---|---|---|---|
| **Story** | props in, markup and states out | `describe('story: <Name>')` in `<name>.test.ts`; the lab's `<name>.stories.ts` | `pnpm test` |
| **Scene** | behaviour in jsdom: keys and clicks in, events and ARIA out | `describe('scene: <Name>')` in `<name>.test.ts` | `pnpm test` |
| **Play** | the whole app in a real browser | `tests/smoke/` | `pnpm test:smoke [part]` |
| **Board** | the screen is the approved board, dark and light | `tests/lab/boards.json` | `pnpm lab:board <board> \| --all` |

The lab's checks (`pnpm lab:check`, `pnpm lab:static`) run every story's every state through the design system's rules and its
screenshots. A change to the kit's shape must leave the goldens, the stories and the board numbers as they were.

## 5. A new component, step by step

1. Check the kit: a variant of an existing component (a new prop, a new value) is better than a new one. The boards decide.
2. Make the folder `components/v7/<name>/`. Write the view: an `…Opts` interface with every prop, a function that returns markup
   with `kitAttrs('<Name>', …)` on its root and `partAttrs('<Part>')` on its named parts. State goes in ARIA and data attributes.
3. Write the contract under the view. List every prop, the events, the states, the parts, the tokens and the boards.
4. If it has keys, focus or pointer behaviour, write `behaviour.ts`: a `wire…(el)` that changes attributes in place and dispatches
   through `emit`. Add one line to `WIRES` in `wire.ts`. Add any new event to `UiEvents` first.
5. Write `<name>.css` from tokens only, and import it in `kit-v7.css` after what it builds on.
6. Export it from `index.ts`: the function in `html`, its options type, its variants in `kitVariants`.
7. Write `<name>.stories.ts` (id `kit/<name>`; at least `typical` and `long`, the forced hover, focus and pressed states of anything
   interactive) and `<name>.test.ts` with its story and scene cases.
8. Run `pnpm typecheck`, `pnpm test`, `pnpm lab:static`, `pnpm lab:check --story kit/<name>`, and `pnpm lab:board` for the boards it
   stands on. Then `pnpm kit:docs` and read its section of the article.

## 6. A new state, a new Source

- **A new state of a component**: decide where it lives (`STATE.md`). If it is the element's, add the attribute to the view (from a
  prop), change it in the behaviour, add it to the contract's `states`, and test it in a story and a scene.
- **Wiring a Source**: the Source's interface goes in `src/data/provider.ts` (a `Watch`, a `Feed`, commands), both providers implement
  it, and the screen module reads it and draws kit components from its values. The component does not change: it gets props and
  dispatches events, and the module turns the events into the Source's commands.

## 7. Copy

Every word the app shows in its settings and settings-like places: the Settings pages, a bot's sheet, the new-bot flow, the session
launch, and the rows, cards, notices and placeholders of the v7 modules (the owner, 27 November 2026: "we need to fix this
verboseness"). Thread and chat content, the engine's messages, text a board draws and the docs are not copy in this sense.

1. **The label carries the meaning.** Add a hint only when the label cannot stand alone.
2. **A hint is one short sentence**, at most about ten words. No second sentence.
3. **Say what it does for the person, not how it works.** No mechanics, edge cases, billing internals, file formats or
   implementation words.
4. **Do not restate** the label, the control or the current value. Do not explain how to clear a field ("Empty it to remove…") or
   that a switch turns something on.
5. **Defaults show as the control's value or placeholder**, not in prose.
6. **Notices and confirmations:** one sentence, plus the action. A destructive confirm lists only what is lost, a few words each.
7. **Empty states:** one quiet line.
8. **Write plainly**, in sentence case as the app does. Add no new claims, and keep every fact the person needs in order to decide
   (that a delete cannot be undone, that something leaves the computer).

For example, "Cap per run": the hint "Pauses and asks you when it's reached.", the placeholder "No cap".
