# What is left of v6: the inventory for the phase 2 gate

The phase 2 gate is "no v6 left". This file lists every v6 module, component, CSS file, story and golden still in the tree at
the repass's step 9 (27 November 2026, branch `w33/repass`), who in the app still uses it, and a proposed fate:

- **delete**: no app user; it goes as soon as the parts listed with it go (most went at step 9, below);
- **port**: the app uses it; it moves to the kit (`src/components/v7/<name>/`) as an existing component's variant or a new one,
  then the v6 part is deleted;
- **keep**: it is not a v6 look (a behaviour, data, an engine of the kit) and stays, for the reason given.

"App users" are files outside `src/components/`, `src/lab/` and the tests that call the part (`ui.<name>`, `html.<name>` but not
`kit.html.<name>`, or its named export), read from the source at step 9. Paths are under `apps/desktop/ui/`.

## Deleted at step 9

No app user, the cascade contained. Each went with its CSS, its stories, its goldens and its tests.

| Part | What it was | Stories and goldens that went |
|---|---|---|
| `ui.itemMark`, `ui.publisher` (`itemMarkHTML`, `publisherHTML`, `.ui-imark`, `.ui-pub`) | the v6 item tile and the publisher's name with its mark | `components/item-mark`, `components/publisher` (no goldens). The tile's lab cases moved to `kit/list-row` ("items: every brand mark", "items: publishers, a mod, letters"): `itemTile` is the one rule |
| `ui.presence` (`components/presence.ts`, `presence.css`, `presence.test.ts`) | who is at work in a conversation; the room stopped drawing it at step 3 (COVERAGE: "dropped because no board draws it") | `chat/presence`, `chat/presence-rooms` and their goldens |
| `ui.group`, `html.group` (the collapsible group of rows, its `data-ui="group"` wiring) | v6's sidebar groups; the sidebars are the kit's | `components/group`, `components/variants-group` and their goldens |
| `ui.send`, `html.send` (`.ui-send`) | the v6 composer's send square; the composer is the kit's | `components/send`, `components/variants-send` and their goldens |
| `ui.stamp`, `html.stamp` (`.ui-stamp`) | the red "needs you" stamp; the kit's StatusWord says it | `components/stamp` and its goldens |
| `ui.capacity`, `html.capacity` (`.ui-capacity`) | "$0.37 of $0.60"; the pane's Cost row says it | `components/capacity` and its goldens |
| `ui.pages`, `html.pages` (`.ui-pages`, the lab's standing allowance for `ui-pages__dot`) | the v6 dock's page dots | `components/pages`, `components/variants-pages` and their goldens |
| `ui.steps`, `html.steps` (`.ui-steps`, `.ui-step`) | the v6 steps list; the kit's Disclosure and ToolRow draw steps | `composer/steps` and its goldens |

The lab's v6 aliases for these (`.ui-step` for ToolRow, `.ui-stamp` for StatusWord, `.ui-steps` for Steps, `.ui-presence__shimmer` for
Live in `tests/lab/v7.mjs`) went with them.

## Deleted at step 2a

The order's items 1 to 3 (27 and 28 November 2026): the bot's settings sheet, the new-bot and new-group forms and a group's board on
the kit; the toast as the kit's Notice (conflict 31: the v7 spec wins, bottom centre, just above the composer); the selects and the
listbox as the kit's Menu. Each part went with its CSS, its stories, its goldens and its tests.

| Part | What it was | Now | Stories and goldens that went |
|---|---|---|---|
| `toast.ts` (`ui.toast`, `toast.whenReady`, `html.toast`, `.ui-toast`, `--pad-toast`, `--r-in-toast`, `--z-toast`), `modules/mods/toasts.ts`, the session's own `say` Notice | the v6 toast, a mod's toast queue, a second notice in the session | `kit.notify` (`components/v7/notice/notify.ts`): one at a time, "+N", Esc, its action and time, one polite live region; `modules/shell/notices.ts` places it and holds boot-time notices (`notifyWhenReady`); a mod's notice is `modules/mods/notices.ts`. Every `toast` name in the code is gone (`hx:notify`, `deps.notify`, the `notice` mod event) but the plugin's wire method `mod.toast` | `components/toast`, `shell/toast` (now `shell/notice`), `cards/mod-surfaces` "toast with +N" (now "a notice with +N"), `toast.test.ts`, `toast-place.test.ts` |
| `select.ts`, `select-html.ts` (`ui.select`, `ui.listbox`, `ui.wireSelect`, `ui.modelEntries`, `html.select`, `ui.field({ kind: 'select' \| 'model' })`, `.ui-select`, `.ui-listbox`, `.ui-option`) | the v6 select and its listbox | the kit's SelectorItem opening the kit's Menu: `modules/bots/model-pick.ts` (a model, by provider with marks), `modules/settings/rows.ts` `openSelect` (the board's chooser), `kit.openMenu` (a mod's Select); the Menu's keys gained a word typed quickly and PageUp/PageDown. The list's choices as data: `components/select-entries.ts` | `components/select`, `components/listbox`, `components/variants-select`, `select.test.ts` |
| `tabs.ts` (`ui.tabs`, `html.tabs`, `fitTabs`, `.ui-tabs`) | the v6 tab strip | the kit's Segmented tabs (the Look editor) | `components/tabs`, `components/variants-tabs` |
| `ui.segmented`, `ui.switch`, `ui.chip`, `ui.chipGroup`, `ui.field`, `html.input`, `ui.section`, `html.setRow`, `html.setHead`, `html.setSection`, `ui.ladder`, `ui.row` (`html.leadFor`, `html.stateWord`) and their wiring in `wire.ts` | the v6 controls the bot sheet and the forms drew | the kit's Segmented, Switch, Chip, Field, SectionHead, Card rows, ListRow | `components/segmented`, `switch`, `chip`, `chip-group`, `field`, `input`, `section` (its disclosure now `components/disclosure`), `set-row`, `set-section`, `ladder`, `row` and their `variants-*`; `choices.stories.ts`; 130 rules of `components.css` |
| `modules/bots/settings.ts`, `settings-live.ts`, `look-edit.ts`, `look-picker.ts` (v6) | a bot's settings sheet | the kit's Pane as a sheet (`variant: 'sheet'`, new), folding SectionHeads, Fields, pane Card rows with Switches, Segmenteds, the run limit's Button, the model's Menu, the Look editor as Segmented tabs over Swatches (Swatches gained its keys and `ui:change`, and a face: a bot's shape), the review as DiffView, the foot's Buttons | `bots/settings-sheet` re-taken (new states: a head focused and the next folded, the model menu open) |
| `modules/bots/new-bot.ts`, `new-group.ts` (v6) | the new-bot and new-group forms | the kit's Dialog (form) drawn in the view; the name and what it does as Fields, the suggestions as ListRows, the members as checking OptionRows led by their orbs (O-B06's look) | `bots/new-bot`, `bots/new-group` re-taken |
| `modules/bots/group-board.ts` (v6) | a group's kanban board | a read-only Card column per state (Card `body`, new), its tasks as ListRow items carrying the assignee's orb; the chooser the kit's Menu; one EmptyState line | `bots/group-board` re-taken ("a column collapsed" is now "a task hovered": the columns no longer fold) |

## Components (`src/components/`, not `v7/`)

| File | What | App users | Fate |
|---|---|---|---|
| `html.ts`, `index.ts` (`ui`, `html`) | the v6 library's templates and factories | the members below | port member by member; delete when the last goes |
| `components.css` | every v6 component's look (about 900 lines; most of `lab:static`'s `tokens.loose` findings) | the members below, and modules that write `ui-` classes by hand (`modules/bots/new-bot.ts` writes `ui-group__head`) | delete section by section with its member |
| `kit.css` | imports the v6 tokens and the v6 CSS files | `main.ts`, the lab | delete last |
| `tooltip.ts`, `layer.ts` (`ui.tooltip`, `ui.popover`, `ui.layer`) | the floating layer and its placement | `main.ts`, `modules/shell/dialogs.ts`, `modules/shell/palette.ts`, `modules/chat/refs.ts`, `modules/shell/index.ts` | keep the placement engine (`layer.ts`, `place.ts`); port the tooltip's look to the kit's Tooltip |
| `scroll.ts`, `scroll-edges.ts` (`ui.scrollClass`, `ui.scrollEdges`) | the scroll area's class and its edge fades | `modules/bots/room.ts`, `group-room.ts`, `modules/session/conversation.ts`, `main.ts` | keep: a behaviour every scroller uses (R-scroll-9) |
| `markdown.ts`, `md-view.ts` (`ui.markdown`) | what a bot or an agent wrote, as markup | `modules/bots/room.ts`, `group-room.ts`, `modules/chat/*`, `modules/session/conversation.ts` | keep: content rendering; its inline chips already draw the kit's InlineChip |
| `model-mark.ts`, `model-mark.css`, `model-name.ts` (`ui.modelMark`, `html.modelMark`) | a model's mark and name | 19 files (`host/live/*`, `modules/session/*`, `modules/cards/*`, the kit's own components) | keep: the kit draws it; move the CSS beside the kit when `kit.css` goes |
| `orb.ts`, `orb-*`, `look.ts`, `shape.ts`, `stack.ts`, `bot-state.ts` | the orbs, a bot's look, the avatar stack | the dock, the rooms, the rail, the kit's Avatar and InlineChip | keep: the kit's engine for bots |
| `squircle.ts`, `squircle-path.ts`, `corners.ts` | the corner engine | every story, `main.ts`, the kit | keep: the kit's engine |
| `icons.ts`, `kbd.ts`, `announce.ts`, `clipboard.ts`, `wire.ts`, `card-registry.ts`, `hold.ts` | glyphs, key names, live-region messages, copying, wiring, the card host, the hold | many | keep: behaviours and data, not looks |
| `item-mark.ts` | the item's mark: `itemTile`, `brandMarkHTML`, `connectorKey` | `host/connectors.ts`, `modules/store/view.ts`, `modules/session/details.ts`, `modules/onboarding/bots.ts` | keep: the kit's ListRow and Card row draw it (conflict 30) |
| `mod-view.ts`, `mod-view.css`, `mod-tree.ts`, `mod-colors.ts`, `mod-svg.ts`, `progress.ts`, `progress.css` (`ui.modView`, `html.mod`, `html.measure`, `html.legend`) | what a mod draws | `modules/mods/*` | port with the mods (conflict 32: no board shows a mod, an owner question) |
| `signin-button.ts`, `signin-button.css` (`ui.signinButton`) | a lab's sign-in button | `host/signin-card.ts`, `host/signin-brands.ts`, `host/providers-view.ts` | port to the kit's Button with a lead mark (ADR-0040's marks stay) |
| `logo.ts` | the logo's element (`logoHTML`) | `html.empty`'s mark only (the welcome logo went at step 8) | delete with `html.empty`, unless the kit's EmptyState takes the mark |
| `variants.ts` | the v6 variants the lab draws | the lab | delete with the v6 stories |

### `ui` and `html` members still used by the app

| Member | App users | Fate |
|---|---|---|
| `ui.button`, `html.button` | `host/notice.ts`, `host/signin-card.ts`, `modules/chat/refs.ts` | port the callers to `kit.html.button` |
| `ui.iconButton` | `host/window-controls.ts`, `modules/mods/panes.ts` | port to `kit.html.iconButton` |
| `ui.empty`, `html.empty` | `modules/shell/index.ts` | port to the kit's EmptyState |
| `ui.entry`, `html.request` | `modules/mods/rows.ts`, `theme-card.ts` | port with the mods |
| `ui.code`, `html.code` | `host/notice.ts`, `host/providers-view.ts` | port to the kit's InlineChip code |
| `html.badge` | `modules/bots/outside.ts` | port to the kit's Badge |
| `html.keys`, `html.dot`, `html.model`, `html.inline`, `html.icon` | `modules/shell/index.ts`, `modules/chat/refs.ts`, `modules/session/*`, `modules/onboarding/bots.ts` | port to the kit's Kbd, StatusWord dot, InlineChip; `html.inline` and `html.icon` keep (content and glyphs) |
| `ui.card` | `host/connectors.ts`, `endpoint-form.ts`, `providers-view.ts`, `modules/cards/index.ts`, `modules/mods/theme-card.ts`, `modules/onboarding/setup.ts`, `modules/session/conversation.ts`, `modules/store/view.ts` | keep: the card host (`hx-card`); its forms draw the kit since 6d |
| `ui.hydrate` | `host/providers-view.ts` | it wires only the hold and the disclosure now (step 2a); delete with them |

Members with no app user left, kept only because another v6 member draws them: `ui.dot`, `ui.keys`, `ui.inline`, `ui.disclosure`,
`ui.scroll`, `ui.hold`, `ui.measure`, `ui.legend`, `ui.request`, `ui.model`, `ui.modelRoute`, `ui.shape`, `html.tip`, `html.combo`,
`html.comboKbds`. **Fate: delete** with the member that draws each (the mods hold most of them). The switch, chip, row, tabs,
listbox, setHead, setSection, stateWord, leadFor, field and select went at step 2a.

## Screens still on v6

| Module | What | Board | Fate |
|---|---|---|---|
| `modules/mods/*` (`panes.ts`, `rows.ts`, `toasts.ts`, `theme-card.ts`, `ctl.ts`, `index.ts`, `mods.css`) | where a mod draws | none (conflict 32) | owner question; port with its answer |
| `host/window-controls.ts`, `host/notice.ts`, `host/signin-card.ts`, `host/endpoint-form.ts`, `host/connectors-notice.ts`, `host/providers-view.ts` (4 v6 calls) | the window's controls, the startup notice, a sign-in, an endpoint, a connectors notice, Settings › Models' providers | 14 for Models; none for the others | port the v6 controls they still call |
| `modules/chat/refs.ts` | a mention's card, a path's menu | none | port its button and dot (its notices are the kit's since 2a) |

Module CSS that is still v6 look rather than placement: `modules/mods/mods.css` (15; `modules/bots/bots.css` is placement only since 2a),
`modules/shell/shell.css` (15). **Fate:** each goes with its screen's port.

## Stories and goldens

Kit stories (`src/components/v7/*/`), the app's v7 surfaces (`src/lab/stories/v7/`), the boards (`src/lab/stories/boards/`) and the
converted screens' stories (`store/*`, `pages/window`, `bots/held`, `composer/council`, `composer/children`, `composer/composer-in-app`,
`composer/attribution`, `cards/form-*`, `cards/escalation`, `cards/error`, `cards/teammate`, `cards/schedule`, `shell/*` but for the
v6 parts named below) are not v6.

| Story | What it draws | Goldens | Fate |
|---|---|---|---|
| `components/button`, `icon-button`, `hold`, `popover`, `tooltip`, `scroll`, `badge`, `key-combos`, `disclosure`, `code`, `keys`, `dot`, `measure`, `model-mark`, `orb`, `stack`, `empty`, `signin-button`, `markdown`, `inline-chips` | the v6 gallery, one specimen per member | `tests/lab-golden/components__*` (the switch, segmented, chip, chip group, field, input, section, set row, set section, ladder, row, tabs, toast, select and listbox folders went at 2a) | delete each with its member; `model-mark`, `orb`, `stack`, `markdown` and `inline-chips` keep (the kit draws them) |
| `components/variants-*` | every v6 member's variants | `components__variants-*` (22 folders) | delete with `variants.ts` |
| `composer/entry`, `composer/request` | the v6 call-number entry and the request bubble | `composer__entry`, `composer__request` | delete with the mods' port |
| `cards/mod-view`, `cards/mod-surfaces` | what a mod draws | `cards__mod-view`, `cards__mod-surfaces` | port with the mods |
| `settings/signin-card`, `settings/xai-signin`, `settings/startup-notice` | the sign-in card, xAI's sign-in, the startup notice | their folders | port with `host/signin-card.ts` and `host/notice.ts` |

## The order proposed for phase 2

1. ~~The bot's settings sheet and the new-bot and new-group forms~~ (done at 2a, with a group's board).
2. ~~The toast as the kit's Notice~~ (done at 2a: conflict 31 decided for the spec; the `kit.single` findings for it are gone).
3. ~~The selects and the listbox as the kit's Menu~~ (done at 2a).
4. The mods (2b: the band in the held/queued strip's slot, status in the composer's foot line, a pane a tab after the four, rows as
   SystemLine and ToolRow, notices the kit's Notice already).
5. The sign-in card, the startup notice, the window's controls; then `variants.ts`, the v6 gallery, `html.ts`'s last members,
   `components.css` and `kit.css`.
