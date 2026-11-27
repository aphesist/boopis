# Where state lives

Every piece of state in the desktop UI lives in exactly one of four places. Before you add one, decide which: the place says who
may change it, who hears about the change, and what survives a redraw. A component never keeps state anywhere else (no hidden
variables that the markup does not show), and a screen never keeps a second copy of what a Source owns.

| Place | What lives there | Who changes it | Real examples |
|---|---|---|---|
| **element** (ARIA and data attributes on the component's own markup) | What a person can see or feel of one component right now: on, open, chosen, held, running. Its view writes the first value from props; its behaviour changes it in place and says so with an event. A redraw from new props replaces it. | the component's behaviour, or the app through a kit function that writes the same attribute (`kit.composerRunning`) | A Switch's `aria-checked` (switch/behaviour.ts flips it and dispatches `ui:change {value}`); a Segmented's `aria-checked` or `aria-selected` and its thumb's `--i`; a Disclosure's `aria-expanded` and `data-open`; a Button that holds: `data-holding`, then `data-held`; the Composer's `data-running`, `data-listening` and `data-typed`; a Mark's `data-mark` (`shown`, then `chosen`). |
| **module** (a screen module's own variables) | How one screen is arranged right now, which no Source knows: which card is open, a timer, the last press. It is lost when the window reloads, and that is fine. | the module, in its own code | `modules/dock/index.ts`: the dock's `S.open` (null, the stack of asks, or one bot's card), `S.compact` and the `idleTimer` of "compact when idle", `lastClick` (a double press opens the full chat), the composer kept per bot so a draft survives its card closing. Its rules are pure functions in `modules/dock/model.ts` (`shows`, `ordered`). |
| **Source** (`src/data/provider.ts`) | The app's data: sessions, bots, rooms, asks, plans, the store. A screen reads it through a `Watch` (a value that changes) or a `Feed` (a snapshot and the events after it), and acts on it through commands that return when the provider accepted them; the result comes back on the stream. The mock and the live provider implement the same interfaces. | the provider (the engine, through the gateway) | `TeamPlansSource` (`list`, `apply(hash)` behind the owner's hold, `reject`, `undo`), read by `modules/bots/held.ts` as `data().teamPlans`; `ParkedSource` (`list`, `answer(id, choice)`, `subscribe` for a step parked or answered), read as `data().parked`; `DictationSource`, whose events the Composer draws through `kit.composerDictation`. Unknown is `null` and is shown as unknown; nothing is invented. |
| **host** (Tauri commands and events) | What only the machine can do or keep: secrets, files, the microphone, the engine's process, windows. The web view calls a command and gets events back; it never receives a secret. | the host (`src-tauri/`), through `src/host/` | `secret_set`, `secret_exists` and `secret_delete` (the keychain; there is no command that returns a secret); `dictation_start(events)` and `dictation_stop`, whose channel carries `listening`, `partial`, `final` and errors to `src/host/dictation.ts`, which hands them to the Composer; the window controls in `host/window-controls.ts`. |

## How they meet

- **Props down, events up.** A Source's value reaches a component as props; the person's action comes back as a `ui:` event that
  the screen turns into a command on the Source. The component changes its own element state at once (the Switch shows on), and the
  next value from the Source draws it again (or a listener cancels the event, and nothing changes).
- **A component never reads a Source or calls the host.** The kit is pure (`components/kit.guard.test.ts`): it imports nothing from
  `modules/`, `host/` or `data/`.
- **A module never copies a Source.** It keeps how its screen is arranged, and asks the Source for the rest.
- **The host's state reaches the UI as a Source** where the screens need it (dictation, the engine's state), so screens and tests
  see one shape whichever provider runs.
