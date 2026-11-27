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

## Components (`src/components/`, not `v7/`)

| File | What | App users | Fate |
|---|---|---|---|
| `html.ts`, `index.ts` (`ui`, `html`) | the v6 library's templates and factories | the members below | port member by member; delete when the last goes |
| `components.css` | every v6 component's look (about 900 lines; most of `lab:static`'s `tokens.loose` findings) | the members below, and modules that write `ui-` classes by hand (`modules/bots/new-bot.ts` writes `ui-group__head`) | delete section by section with its member |
| `kit.css` | imports the v6 tokens and the v6 CSS files | `main.ts`, the lab | delete last |
| `toast.ts` (`ui.toast`) | the v6 toast; the kit's Notice is the merged name (`kit.single`: 274 of its findings are the word "toast") | `host/connectors-notice.ts`, `host/endpoint-form.ts`, `host/live-provider.ts`, `host/window-controls.ts`, `main.ts`, `modules/chat/refs.ts`, `modules/mods/toasts.ts` | port to the kit's Notice (conflict 31: where a floating notice sits is an owner question), then rename the callers |
| `tooltip.ts`, `layer.ts` (`ui.tooltip`, `ui.popover`, `ui.layer`) | the floating layer and its placement | `main.ts`, `modules/shell/dialogs.ts`, `modules/shell/palette.ts`, `modules/chat/refs.ts`, `modules/shell/index.ts` | keep the placement engine (`layer.ts`, `place.ts`); port the tooltip's look to the kit's Tooltip |
| `select.ts`, `select-html.ts` (`ui.select`, the v6 listbox) | the v6 select and its listbox (`components/listbox`: 119 of the v7 findings at step 8, `geometry.row`) | `modules/bots/group-board.ts`, `modules/mods/ctl.ts`; `select-html.ts`'s helpers in `modules/session/composer.ts`, `model-menu.ts`, `modules/settings/*` | port the two selects to the kit's Menu with SelectorItem; delete the listbox |
| `scroll.ts`, `scroll-edges.ts` (`ui.scrollClass`, `ui.scrollEdges`) | the scroll area's class and its edge fades | `modules/bots/room.ts`, `group-room.ts`, `modules/session/conversation.ts`, `main.ts` | keep: a behaviour every scroller uses (R-scroll-9) |
| `tabs.ts` (`fitTabs`) | the v6 tab strip | `modules/bots/look-picker.ts`, `look-edit.ts`, `modules/mods/panes.ts` | port to the kit's Segmented or its tabs |
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
| `ui.button`, `html.button` | `host/notice.ts`, `host/signin-card.ts`, `modules/bots/new-bot.ts`, `new-group.ts`, `settings.ts`, `settings-live.ts`, `modules/chat/refs.ts` | port the callers to `kit.html.button` |
| `ui.iconButton` | `host/window-controls.ts`, `modules/bots/look-edit.ts`, `new-bot.ts`, `new-group.ts`, `settings*.ts`, `modules/mods/panes.ts`, `toasts.ts` | port to `kit.html.iconButton` |
| `ui.segmented` | `modules/bots/look-picker.ts`, `settings*.ts` | port to the kit's Segmented |
| `ui.chipGroup` (and the v6 chip under it) | `modules/bots/settings*.ts` | port to the kit's Chip |
| `ui.field`, `html.input` | `modules/bots/new-bot.ts`, `settings*.ts` | port to the kit's Field |
| `ui.section`, `html.section`, `html.setRow`, `html.switch`, `ui.ladder` | `modules/bots/settings*.ts`, `group-board.ts` | port with the bot's settings sheet (the kit's Card rows) |
| `ui.select`, `ui.empty`, `html.row`, `html.empty` | `modules/bots/group-board.ts`, `new-group.ts`, `modules/mods/ctl.ts`, `modules/shell/index.ts` | port to the kit's Menu, EmptyState, ListRow |
| `ui.entry`, `html.request` | `modules/mods/rows.ts`, `theme-card.ts` | port with the mods |
| `ui.code`, `html.code` | `host/notice.ts`, `host/providers-view.ts` | port to the kit's InlineChip code |
| `html.badge` | `modules/bots/outside.ts` | port to the kit's Badge |
| `html.keys`, `html.dot`, `html.model`, `html.inline`, `html.icon` | `modules/shell/index.ts`, `modules/chat/refs.ts`, `modules/session/*`, `modules/onboarding/bots.ts` | port to the kit's Kbd, StatusWord dot, InlineChip; `html.inline` and `html.icon` keep (content and glyphs) |
| `ui.card` | `host/connectors.ts`, `endpoint-form.ts`, `providers-view.ts`, `modules/cards/index.ts`, `modules/mods/theme-card.ts`, `modules/onboarding/setup.ts`, `modules/session/conversation.ts`, `modules/store/view.ts` | keep: the card host (`hx-card`); its forms draw the kit since 6d |
| `ui.hydrate` | `host/providers-view.ts`, `modules/bots/group-board.ts`, `settings*.ts` | delete with the v6 controls it wires |

Members with no app user left, kept only because another v6 member draws them: `ui.switch`, `ui.chip`, `ui.dot`, `ui.row`, `ui.keys`,
`ui.inline`, `ui.disclosure`, `ui.scroll`, `ui.tabs`, `ui.hold`, `ui.measure`, `ui.legend`, `ui.request`, `ui.listbox`,
`ui.modelEntries`, `ui.wireSelect`, `ui.model`, `ui.modelRoute`, `ui.shape`, `html.setHead`, `html.setSection`, `html.tip`,
`html.combo`, `html.comboKbds`, `html.stateWord`, `html.leadFor`, `html.field`, `html.select`. **Fate: delete** with the member
that draws each (the bots' settings sheet and the mods hold most of them).

## Screens still on v6

| Module | What | Board | Fate |
|---|---|---|---|
| `modules/bots/settings.ts`, `settings-live.ts`, `look-edit.ts`, `look-picker.ts` | a bot's settings sheet (its Approvals section is the kit's since 7a+) | none for the sheet's other sections | port to the kit's Pane and Card rows; an owner question for the look |
| `modules/bots/new-bot.ts`, `new-group.ts` | the new-bot and new-group forms | O-B06's team plan covers making a team, not these forms | port; nearest drawn state meanwhile (rule 6) |
| `modules/bots/group-board.ts` | a group's kanban board, read only | none | port; owner question |
| `modules/mods/*` (`panes.ts`, `rows.ts`, `toasts.ts`, `theme-card.ts`, `ctl.ts`, `index.ts`, `mods.css`) | where a mod draws | none (conflict 32) | owner question; port with its answer |
| `host/window-controls.ts`, `host/notice.ts`, `host/signin-card.ts`, `host/endpoint-form.ts`, `host/connectors-notice.ts`, `host/providers-view.ts` (4 v6 calls) | the window's controls, the startup notice, a sign-in, an endpoint, a connectors notice, Settings › Models' providers | 14 for Models; none for the others | port the v6 controls they still call |
| `modules/chat/refs.ts` | a mention's card, a path's menu | none | port its button, toast and dot |

Module CSS that is still v6 look rather than placement: `modules/bots/bots.css` (8 `tokens.loose`), `modules/mods/mods.css` (16),
`modules/shell/shell.css` (15). **Fate:** each goes with its screen's port.

## Stories and goldens

Kit stories (`src/components/v7/*/`), the app's v7 surfaces (`src/lab/stories/v7/`), the boards (`src/lab/stories/boards/`) and the
converted screens' stories (`store/*`, `pages/window`, `bots/held`, `composer/council`, `composer/children`, `composer/composer-in-app`,
`composer/attribution`, `cards/form-*`, `cards/escalation`, `cards/error`, `cards/teammate`, `cards/schedule`, `shell/*` but for the
v6 parts named below) are not v6.

| Story | What it draws | Goldens | Fate |
|---|---|---|---|
| `components/button`, `icon-button`, `hold`, `switch`, `segmented`, `chip`, `chip-group`, `field`, `popover`, `tooltip`, `toast`, `tabs`, `scroll`, `badge`, `input`, `set-section`, `key-combos`, `row`, `section`, `set-row`, `code`, `keys`, `dot`, `ladder`, `measure`, `model-mark`, `orb`, `stack`, `empty`, `select`, `listbox`, `signin-button`, `markdown`, `inline-chips` | the v6 gallery, one specimen per member | `tests/lab-golden/components__*` (34 folders) | delete each with its member; `model-mark`, `orb`, `stack`, `markdown` and `inline-chips` keep (the kit draws them) |
| `components/variants-*` | every v6 member's variants | `components__variants-*` (22 folders) | delete with `variants.ts` |
| `composer/entry`, `composer/request` | the v6 call-number entry and the request bubble | `composer__entry`, `composer__request` | delete with the mods' port |
| `cards/mod-view`, `cards/mod-surfaces` | what a mod draws | `cards__mod-view`, `cards__mod-surfaces` | port with the mods |
| `bots/settings-sheet`, `bots/new-bot`, `bots/new-group`, `bots/group-board`, `bots/group-details` | the screens above | `bots__settings-sheet`, `bots__new-bot`, `bots__new-group`, `bots__group-board` | port with their screens |
| `settings/signin-card`, `settings/xai-signin`, `settings/startup-notice` | the sign-in card, xAI's sign-in, the startup notice | their folders | port with `host/signin-card.ts` and `host/notice.ts` |

## The order proposed for phase 2

1. The bot's settings sheet and the new-bot and new-group forms (they hold most of the v6 members still used).
2. The toast as the kit's Notice (with conflict 31's answer), which clears the `kit.single` findings.
3. The selects and the listbox as the kit's Menu.
4. The mods, once conflict 32 is answered.
5. The sign-in card, the startup notice, the window's controls; then `variants.ts`, the v6 gallery, `html.ts`'s last members,
   `components.css` and `kit.css`.
