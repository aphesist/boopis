# @boopis/ui: the kit and its engines

Every piece of UI that more than one place draws is one component of the **v7 kit** (`v7/`, one folder per component: its view and
contract, behaviour, CSS, stories and tests). Its rules are `docs/kit/RULES.md`, its words `docs/kit/TERMS.md`, where state lives
`docs/kit/STATE.md`; `pnpm kit:docs` writes its article from the folders. The live catalogue is the **UI lab** (`pnpm lab`,
`docs/UI-LAB.md`). The v6 library that stood here (`ui`, `html`, `components.css`) went at the repass's step 2b;
`docs/design/v7/V6-LEFT.md` records what went and what was kept.

## The package

- **Where.** `apps/desktop/ui/src/components/`, imported as `@boopis/ui` (a path alias in `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`). Nothing outside this folder imports a file inside it; `kit.guard.test.ts` fails if anything does.
- **Entry.** `index.ts`: `kit` (every component once: `kit.<name>(opts)` an element already wired, `kit.html.<name>(opts)` its markup)
  and the engines the kit draws with, each a named export: the orbs and a bot's look (`orb`, `orbHtml`, `lookOf`, `stack`), a model's
  mark (`modelMark`, `markHTML`), what a bot or an agent wrote (`markdown`, `inlineCodeHTML`), the floating layer and the tooltip
  (`layer`, `popover`, `tooltip`), the corners (`squircle`), the scroll areas (`scrollClass`, `scrollEdges`), the card host (`card`),
  the labs' and the Store's marks (`signinButton`, `itemTile`), glyphs and words for assistive tech (`icon`, `announce`).
- **Pure.** The kit imports nothing from the app: no module, no host, no data provider, no app state or settings. Its only outside
  imports are `core/dom`, `core/keys`, `core/log`, `core/bus` (it re-reads tokens on `hx:theme`), `styles/colour`, the vendored
  elements and two shared tables in `apps/shared/data` (`model-names.json`, `room-mentions.json`). Views render from their props alone.
- **Styles.** The app loads, in order (`styles/index.ts`): the themes' tokens (`styles/tokens.css`), the engines' sheets (`corners.css`,
  `scroll.css`, `orb.css`, `markdown.css`, `model-mark.css`, `signin-marks.css`), the kit (`v7/kit-v7.css`, its tokens on a v7 root),
  then the modules' CSS, which only places kit components.
- **Build.** `pnpm kit` builds `dist-kit/boopis-ui.js` and `dist-kit/boopis-ui.css` (entry `kit.ts`) for a page outside the app. It
  carries no fonts: the page loads them (`styles/fonts.ts`).

```ts
import { kit } from '@boopis/ui';
const root = kit.segmented({ label: 'Show', value: 'all', items: [{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }] });
kit.on(root, 'ui:change', (e) => show(String(e.detail.value)));
```

Events bubble and are cancelable where an action follows (`v7/events.ts`, the one map `UiEvents`).
