# boopis trailer: script

**Concept.** boopis's mark is a pair of eyes, and so is every bot. The film opens on two eyes in the dark, follows them
as they become a team that reads what you mean, works with three tools inside a sandbox, climbs only frontier models,
works across the plans you already pay for, learns, and waits for your hold before anything ships; then the eyes go
home into the wordmark.

**Format.** 1920x1080, 60 fps, 99.4 s (41 bars at 100 BPM, a bar is 2.4 s, a beat 0.6 s, plus a 1 s tail). Sound is
procedural (numpy), cut to the same bar grid: every cue below is a time on that grid. A silent version is the same
picture.

**Look.** A pitch-black stage (`#000`, the dock's own black) that real boopis UI floats on: plates of the Card catalog
preset (`--bg-2` ground, `--bg-1` frames, 30 px continuous corners), the kit's own components at 1.6x to 2.2x, orbs
rendered at their final size. Headlines in Libre Franklin 600, 88 to 120 px, `--text-strong`, sentence case, set on the
stage, never on a UI plate; secondary words `--text-dim`; mono (IBM Plex Mono) for state words, tools, models and
numbers. Brass only marks where you are (the cursor ring, the active rung, the caret); red only what you owe (a
"needs you" or "failed" stamp). Motion: travel on `--spring` (`cubic-bezier(.22, 1, .36, 1)`), UI steps on `--ease`
(`cubic-bezier(.2, .8, .2, 1)`), the dock's outline on critically damped springs (ω 22), never an overshoot; the only
overshoot in the film is the logo's playful letters at the end. Headlines enter word by word (a 28 px rise and a
fade, 90 ms stagger, 0.6 s on `--spring`) and leave in 0.2 s (fade and a 12 px lift). A slow push-in (scale 1 to 1.04)
runs under every held shot.

**Copy rule.** Few words, short lines, lowercase "boopis", no exclamation marks, no em dashes, nothing named that
boopis is built from. Lab and model names appear only where they take part (sign-ins, ladder, council, bylines).

## Beat sheet

Times are seconds from the first frame. "Bar n" starts at (n − 1) × 2.4 s.

### 1. Cold open: two eyes in the dark (0.0 to 9.6, bars 1 to 4)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 0.0 | Black. | | A low drone fades up; a slow sub pulse, two beats apart. |
| 0.6 | The boopis mark (two oval eyes, 150 px wide, `--text-strong`) fades in at the centre over 0.6 s. | | A soft high shimmer. |
| 1.8 | The eyes blink (the logo's own 0.155 s blink). | | A dry "tick". |
| 2.4 | The eyes glance left (0.4 s, the logo's capped gaze), hold, glance right and a little up at 3.3, back to centre at 4.2. | | Two small air swishes. |
| 4.8 | The eyes become a bot: noct's orb (a dark body, `#1c1c24`, with light eyes, 420 px) fades in around them, its eyes landing where the mark's were; the mark fades out under them. The camera eases back from 1.12 to 1.0. | | The drone opens up (filter sweep). |
| 6.0 | noct blinks and turns to listening. | | Tick. |
| 7.2 | noct rises 150 px; under it, word by word: | **meet your team.** | Downbeat: the first kick and a warm chord. |
| 9.0 | The line lifts out; noct shrinks toward the centre of a grid. | | Reverse swell into bar 5. |

### 2. The team, and the dock (9.6 to 19.2, bars 5 to 8)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 9.6 | The other ten bots pop in around noct, one every 0.15 s (scale 0.6 to 1 and a 24 px rise on `--spring`), settling into two rows: atlas, nina, kai, iris, hex, sol / terra, nimbus, vox, moss, with noct in the middle. Each has its name (600) and role (`--text-quiet`) under it. | names and roles: atlas reviewer, nina deploys, kai docs and changelog, iris design QA, hex security review, sol night shift, noct on-call, terra data migrations, nimbus inbox triage, vox release notes, moss flaky test hunter | A pluck per pop, rising through a pentatonic scale; the groove starts (kick, soft hat). |
| 12.0 | On each beat every face changes at once to the same state, and the state word appears large at the bottom, mono: | **listening** (12.0), **thinking** (12.6), **working** (13.2), **needs you** (13.8, in `--red-text`), **done** (14.4) | A beat accent per word; "needs you" gets a two-note alert; "done" a bright chord. |
| 15.0 | Faces go back to their own states. The grid flies down and shrinks into a row as an app window (Card catalog ground, a quiet sidebar and conversation) rises behind; the black dock slab rises from the window's bottom edge, its concave flares following the springs, and the eleven orbs land in it at a 54 px pitch. | **always one click away.** (15.6) | A whoosh down, a soft thud as the dock lands. |
| 16.8 | A pointer travels to nina's orb; nina's flag is red. Click at 17.4: the orb pokes, and the dock morphs open (outline on springs) into nina's session: her last message, a compact approval card ("nina wants to deploy to staging", Deny, Hold to approve) and a composer "Message nina". The camera pushes in on the dock (1.0 to 1.5). | | Click; the morph is a soft rising sweep. |

### 3. Group chats with bots, governed bot by bot (19.2 to 26.4, bars 9 to 11)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 19.2 | The dock session slides up and widens into a room: header "billing crew" with three stacked orbs (terra, atlas, nina), messages with their orb in the margin. | **group chats. with bots.** (left of the room) | Hats open up; a chord change. |
| 19.8 | You: "@terra plan the cents migration. @atlas, review it when it's up." | | Message pop (soft click). |
| 20.7 | terra (thinking, then replying): "Plan is up: three steps, one migration. Nothing writes until you approve." | | Pop. |
| 21.6 | A teammate card travels from terra's message down to atlas: "terra asks atlas to review the plan", Accept; it turns to "accepted" and atlas's orb looks happy. | **they hand work to each other.** | A two-note hand-off figure (left to right in the stereo field). |
| 22.5 | atlas: "Reviewed. One nit, fixed in 9f3c1a2. 142 tests pass." | | Pop. |
| 23.4 | nina: "Ready for staging when you are." | | Pop. |
| 24.0 | The room slides left; nina's settings slide in from the right: her orb, name and role; "Governed" switches on (24.6); under "Ask before", deploys, pushes, network and spend switch on one per sixteenth; "Workspace: sandbox". Beside it, noct's row stays "ungoverned". | **governed, bot by bot.** | A switch click per toggle, on the sixteenths. |

### 4. Feedforward: it shows how it read you (26.4 to 36.0, bars 12 to 15)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 26.4 | Hard cut to black and one large session composer (the kit's, 720 px at 1.9x), the Governed and Smart chips in its foot, "$0.00 of $0.60". | **say what you want.** (above) | The groove thins to kick and bass; a filter closes. |
| 27.0 | Typing, about 22 characters a second: "refactor the proration helpers in src/billing to integer cents, run the tests, then open a PR." Each decision word, as it completes, gets its dashed underline (drawn left to right) and the "Will assume:" row under the composer gains its item: ">refactor", ">src/billing", ">npm test", ">draft a PR". | | A soft key click per character; a tick as each assumption lands. |
| 31.2 | The first line changes. | **it shows how it read you.** | Bar 14 downbeat: the groove returns. |
| 31.8 | The pointer clicks "refactor": the readings open under the word (refactor: Same behaviour, new structure; rewrite: Behaviour may change, I will list how; fix: The smallest change that makes it right; review only: Read and comment, no edits). The highlight steps to "fix" (32.4); chosen (32.7): the underline turns solid and the assumption rewrites to ">fix, smallest change". | | Menu open whoosh; select click. |
| 33.6 | Two keycaps appear by "open a PR": alt + ↓. Its readings open (Draft a PR; Open a ready PR: Asks atlas for a review; Push the branch only); "Open a ready PR" is chosen (34.5); the assumption becomes ">ready PR". | **one click changes it.** | Keycap clicks; select. |
| 35.4 | The send button takes the brass ring. | | A rising sweep into the next bar. |

### 5. No pile of tools (36.0 to 43.2, bars 16 to 18)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 36.0 | The assumption chips scatter and multiply into a wall of generic tool names in quiet mono (read_file, write_file, edit_file, multi_edit, apply_patch, grep, glob, list_dir, find_files, bash, terminal, run_command, web_fetch, web_search, todo_write, notebook_edit, git_status, git_diff, search_files, outline, and more), rows scrolling in alternate directions, crowding the frame. | **no pile of tools.** (36.6, on a black band in the middle) | A noise riser; the wall's rows tick like a departures board. |
| 38.4 | Every name flies into three points and the wall is gone. Three words, mono, 110 px: **pack**, **exec**, **ship**, landing on the beats 38.4, 39.0, 39.6, each with its line: "reads", "runs in a sandbox", "the only way to write". | **three tools.** | Silence for one eighth, then three hits. |
| 40.8 | A dashed boundary draws itself around exec with its edge labels in mono ("network off", "workspace read-only", "secrets left out"); under ship a gate pill runs: "npm test", then "failed", the diff restores ("rolled back, byte for byte"), then "142 passed". | **sandboxed, and reversible.** | A low gate thud on "failed", a reverse swoosh for the rollback, a bright up-chime for "passed". |

### 6. Governed models (43.2 to 55.2, bars 19 to 23)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 43.2 | Title, centre, 120 px. Under it at 44.0, mono: "frontier models only". | **governed mode.** | Impact; the bass line enters. |
| 44.4 | The title rises and shrinks; a ladder builds from the bottom, each rung a station dot, a lab's mark (mono) and a model: Gemini 4 Hydrogen "first try", GPT-6.2 Sol "after 1 fail", Claude Opus 5.5 "after 2 fails". | | A rising three-note figure, one per rung. |
| 45.6 | The run plays beside it: rung 1 takes the brass dot; "Moved the proration helpers to integer cents"; "npm test" ... a red **failed** stamp (46.5) with "invoice.test.ts"; "rolled back" (46.9); the brass dot climbs to rung 2 (47.1); "npm test" ... "142 passed" (47.7). | **a failed test climbs the ladder.** | Thud on failed; up-step on the climb; chime on passed. |
| 48.0 | Two settings rows slide in under the ladder: "Climb to Fable" (Claude mark) and "Grok 4.7" (Grok mark), each "Token-heavy. Off until you turn it on.", both switches off. The pointer turns Fable on (49.2): a fourth rung, "Claude Fable 5.2, on because you chose it", lights at the top. | **heavy models wait for your word.** | Switch click; a low, heavier note for the new rung. |
| 50.4 | Cut to nina's approval card, large: "nina wants to deploy to staging", "needs you" stamp, "billing/cents → staging, dry run first", the well (staging, invoices-api; read-only on invoices, 1 migration), "expires in 9 min", Deny, Hold to approve. The pointer presses Hold at 51.0: the dot field gathers and fuses into the fill over exactly one second; at 52.0 the label reads "Approved", the receipt "Approved at 14:09", and nina's orb in the card's side column turns happy. | **nothing ships until you hold.** | The groove drops out; a one-second riser locked to the fill; a chime at 52.0. |
| 52.8 | The card shrinks into one row of a record that builds upward, a line per event in mono: seq, type, a short hash, each line's hash linked by a hairline to the next line's previous hash: session.opened, route.decided, tool.called, gate.decided, ship.restored, route.decided, gate.decided, approval.decided, checkpoint.committed. | **every step on the record.** | A typewriter tick per line; the groove returns. |

### 7. The plans you already pay for, many models (55.2 to 64.8, bars 24 to 27)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 55.2 | The setup hub assembles: four sign-in buttons as boopis draws them (Sign in with Claude, Sign in with ChatGPT, Sign in with GitHub, Sign in with xAI, each with its lab's own mark), then a wall of key tiles with brand-colour marks (Gemini, DeepSeek, Qwen, Kimi, Mistral, MiniMax, Z.ai, a local runtime). From 56.4 one button a beat turns into its receipt ("Connected"). | **bring the plans you already pay for.** | Arp in; a connect blip per receipt. |
| 57.0 | The quiet "Do it later" button lifts into focus (brass ring). | **or start free.** | A soft two-note answer. |
| 57.6 | A conversation turn: the composer's chip reads "Council of 3"; three member rows (Claude Opus 5.5, GPT-6.2 Astra, Gemini 4 Neon, mono marks) go from "thinking" to "done" at 58.2, 58.5, 58.8, then fold into one byline, "Claude Opus 5.5 combined 3 answers", and the combined answer writes in. | **ask a council.** | Three overlapping chord tones resolving to one. |
| 60.0 | In the composer "@" opens the model menu with brand-colour marks (the one place the app shows colour); the highlight runs down to GPT-6.2 Sol; Enter makes the mention chip; "write the property test" is sent; the reply arrives signed: the OpenAI mark and "GPT-6.2 Sol". | **@ any model.** | Menu ticks; send whoosh. |
| 62.4 | A conversation column scrolls up through replies, each signed by a different model, with dividers where the model changes ("Claude Opus 5.5 → GPT-6.2 Sol"). | **every reply signed.** | Groove peak; fill into bar 28. |

### 8. They learn (64.8 to 72.0, bars 28 to 30)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 64.8 | moss (green squircle, flaky test hunter) at the left, 260 px, working. A task line: "invoice.test.ts fails only after midnight UTC" ticks to done (66.0); moss's face turns done. | **they learn on the job.** | Softer: a sparse arpeggio. |
| 66.0 | On the right a skill writes itself, line by line (mono title "flaky-tests"): "When a test fails only sometimes", "1. Rerun it 20 times", "2. Pin the clock and the seed", "3. Then touch the code". A tag drops in: "saved to moss's skills". | | Pen ticks; a "saved" chime. |
| 68.4 | Later: the skill refines itself, a diff line slides in, "+ Check the time zone first", tagged "refined". | | A brighter chime. |
| 69.6 | Memory chips float in beside moss: "you prefer draft PRs", "invoices round once", "staging before production". | **and they remember.** | Three soft notes. |

### 9. One store for every source (72.0 to 79.2, bars 31 to 33)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 72.0 | Unnamed source tiles appear around the edges, fourteen of them, each a glyph on a raised tile (a registry box, a repository branch, a folder, a marketplace, a puzzle piece, a plug, a book of skills). | **every source.** | Groove back; sparkles per tile. |
| 73.2 | They fly to the centre and merge into one store window: the search field ("Search skills, connectors, plugins and mods"), the kind chips (Skills, Connectors, Plugins, Mods), "Recommended", and item cards with their tier words ("Recommended by boopis", "Verified by its source", "Not reviewed"). | **one store.** (74.4) | A big merge whoosh and a low hit. |
| 75.6 | "changelog" is typed into search; the cards reorder. | | Key clicks. |
| 76.8 | changelog-writer's install card: "Pinned to a3f9c21", "Runs code", "No network". The pointer holds "Hold to install" for one second (77.4 to 78.4): "Installed. Your next session has it." | | Riser and chime, as in the governed act, smaller. |

### 10. Everything else, fast (79.2 to 88.8, bars 34 to 37)

Half-bar cuts (1.2 s), each on a downbeat or a backbeat.

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 79.2 | A form card flips up into place (a rotation on X, 0.4 s): "How should line items round?", options Half away from zero, Half to even, Do not round, Other; Later, Cancel, Answer. | **one card for anything it needs.** | Card flip swish. |
| 80.4 | "Half to even" is picked; Answer; the card recedes to its receipt, "Answered at 14:12". | | Click. |
| 81.6 | A composer with a mod's status line rising in (the composer lifts 22 px), the band's progress dots filling, a mod toast. | **mods.** | A quick arpeggio. |
| 82.8 | A small app view (sidebar, conversation, card, dock) wipes through the four themes on the beats: Card catalog, Graphite (82.8), Bone (83.4), Typewriter (84.0); the dock stays black in all four. | **four themes.** | A swish per wipe. |
| 85.2 | Keycaps snap in, one every 0.3 s, with what they do: ctrl K "Command palette", alt M "Who answers next", alt C "Ask a council", alt G "Governed", alt V "Talk". | **keyboard first.** | A key thock per cap. |
| 86.4 | A plain machine outline draws itself; the boopis window lands inside it; a small line: "keys stay in your system keychain". | **runs on your machine.** | A warm pad swells. |

### 11. The eyes go home (88.8 to 99.4, bars 38 to 41 and a tail)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 88.8 | The eleven orbs return from the edges in a ring, turn to face the centre, and converge, shrinking, into one pair of eyes on black (90.6). | | Everything sweeps into the centre; the groove stops dead at 90.6. |
| 91.2 | The wordmark grows out of the eyes: its "oo" is the pair, and the letters b, p, i, s open outward from them (a reveal from the centre, 0.5 s). Font size 220 px, `--text-strong` on black, nothing inside its protection area. | | A low "boop" on the reveal. |
| 91.8 | The logo's big moment: `letters="play"`, a short hero (listening, thinking, happy, idle): the letters hop, lean and squash, the i's dot bounces. | | A playful blip on each step, over a held chord. |
| 95.4 | Far below the wordmark, outside its protection area, on its own: | **AI coding agents. you stay in charge.** | The final chord. |
| 98.4 | Hold on the end card; the chord rings out. Fade to black over the last 0.4 s. | | Reverb tail to silence at 99.4. |

## Transitions

- 4.8: match on the eyes (the mark's eyes become noct's).
- 9.6: noct becomes the grid's centre (continuous).
- 15.0: the grid becomes the dock (shared elements travel, as the app's dock does).
- 19.2: the dock session grows into the room (continuous).
- 26.4: hard cut to black on the bar.
- 36.0: the assumption chips become the tool wall (mono to mono).
- 38.4: collapse to three points.
- 43.2: cut on the impact.
- 50.4: cut to the card; 52.8 the card becomes the record's last line.
- 55.2: cut; the hub assembles from nothing.
- 64.8, 72.0: cuts on the bar.
- 79.2 to 88.8: half-bar cuts.
- 88.8: everything converges into the eyes; 91.2 the eyes become the wordmark (match on the eyes, bookending 4.8).

## Brand checks for every frame

- Nothing that boopis is built from is named or shown. Lab marks only where a lab takes part.
- The wordmark: one colour, on flat black, never rotated, skewed, blurred or outlined; nothing in its protection area.
- The dock is black; the hold is one second; red only on "needs you" and "failed"; brass only as a mark.
- Text on screen long enough to read (every line holds at least 1.2 s).
