# boopis trailer: script

**Concept.** boopis's mark is a pair of eyes, and so is every bot. The film opens on two eyes in the dark, follows them
as they become a team that reads what you mean, works with three tools inside a sandbox, climbs only frontier models,
works across the plans you already pay for, learns, and waits for your hold before anything ships; then the eyes go
home into the wordmark.

**Format.** 1920x1080, 60 fps, 101.8 s: 42 bars at 100 BPM (a bar is 2.4 s, a beat 0.6 s) and a one-second tail. A
1080x1920 cut draws the same scenes in the middle band with the headlines above. Sound is procedural (numpy) and reads
its effects from the cue list the picture writes, so every cue below is on the same clock. A silent version is the
same picture.

**Look.** A pitch-black stage (`#000`, the dock's own black) that real boopis UI floats on: plates of the Card catalog
preset (`--bg-2` ground, `--bg-1` frames, continuous 30 px corners), the kit's own components at 1.4x to 2.2x, orbs
rendered at their final size. Headlines in Libre Franklin 600 (84 to 112 px), `--text-strong`, sentence case, set on
the stage; secondary words `--text-dim`; mono (IBM Plex Mono) for state words, tools, models and numbers. Brass only
marks where you are (the caret, a click's ring, the active rung, a chosen reading); red only what you owe ("needs you",
"failed", "waiting for you"). Motion: travel on `--spring` (`cubic-bezier(.22, 1, .36, 1)`), UI steps on `--ease`
(`cubic-bezier(.2, .8, .2, 1)`), the dock's outline on critically damped springs, never an overshoot; the only
overshoot in the film is the logo's playful letters at the end. Headlines enter word by word (a 28 px rise and a fade,
90 ms apart, 0.6 s on `--spring`) and leave in 0.2 s (a fade and a 12 px lift).

**Copy rule.** Few words, short lines, lowercase "boopis", no exclamation marks, no em dashes, nothing named that
boopis is built from. Lab and model names appear only where they take part (sign-ins, ladder, council, bylines).

## Beat sheet

Times are seconds from the first frame. "Bar n" starts at (n − 1) × 2.4 s.

### 1. Cold open: two eyes in the dark (0.0 to 9.6, bars 1 to 4)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 0.0 | Black. | | A low drone (D and A) fades up over three seconds. |
| 0.6 | The boopis mark (the two oval eyes, 300 px wide) fades in at the centre. | | A soft high shimmer. |
| 1.8 | The eyes blink (the logo's own 0.155 s blink). | | A dry tick. |
| 2.4 | The eyes glance left; at 3.3 right and a little up; at 4.2 back to the centre (the logo's capped gaze). | | Two air swishes, left then right; a sub heartbeat every 1.2 s. |
| 4.4 | The eyes narrow toward the bots' idle shape and settle to noct's eye spacing. | | |
| 4.8 | noct's dark body (`#1c1c24`) fades in around them, its light eyes exactly where the mark's were; the mark fades out under them (match on the eyes). The camera eases back. | | The drone opens up. |
| 6.0 | noct blinks and turns to listening. | | Tick. |
| 7.2 | noct rises; under it, word by word: | **meet your team.** | Downbeat: the first kick and a low hit. |
| 9.0 | The line lifts out; noct drops back and shrinks toward the grid's centre. | | |

### 2. The team, and the dock (9.6 to 19.2, bars 5 to 8)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 9.6 | The other ten bots pop in around noct, one every 0.15 s, into two rows: atlas, nina, kai, iris, hex, sol / terra, nimbus, noct, vox, moss, each with its name and role. | atlas reviewer, nina deploys, kai docs and changelog, iris design QA, hex security review, sol night shift, terra data migrations, nimbus inbox triage, noct on-call, vox release notes, moss flaky test hunter | A pluck per pop, up a pentatonic scale; the groove starts (kick on 1 and 3, soft hats, the pad). |
| 12.0 | On each beat every face changes to the same state, and its word appears large at the bottom, mono: | **listening** (12.0), **thinking** (12.6), **working** (13.2), **needs you** (13.8, red), **done** (14.4) | An accent per word; a two-note alert on "needs you"; a bell chord on "done". |
| 15.0 | Faces return to their own states. An app window (Card catalog: title bar with the still mark, sidebar, a conversation, the composer) rises; the bots fly into a row and the pitch-black dock rises under them on its springs, flares and all; nina wears her red flag. | **always one click away.** (15.6) | A whoosh down; a thud as the dock lands. |
| 16.6 | A pointer comes in onto nina's orb and clicks (17.4): the orb pokes, the row leaves, and the slab morphs into nina's session in the dock: her last message, a compact approval card ("nina, Deploy to staging", Deny, Hold to approve) and a composer "Message nina". The camera pushes in on the dock. | | Click; a soft rising sweep for the morph. |
| 18.9 | The window fades out. | | |

### 3. Group chats with bots, governed bot by bot (19.2 to 26.4, bars 9 to 11)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 19.2 | A room plate: "billing crew", three stacked orbs, "3 bots". Messages arrive with their orb and name in the call number. | **group chats.** / **with bots.** (left) | Claps join; open hats. |
| 19.8 | You: "@terra plan the cents migration. @atlas, review it when it's up." | | Pop. |
| 20.7 | terra: "Plan is up: three steps, one migration. Nothing writes until you approve." | | Pop. |
| 21.75 | A teammate card arrives: "terra, Hands atlas the review", "Migration 0042: invoices to integer cents, in three steps.", the well (cents/migration-0042; plan.md, 3 steps, 1 migration); at 22.2 it turns to "Accepted at 14:09". | **they hand work** / **to each other.** | A two-note hand-off figure, left to right. |
| 22.5 | atlas: "Reviewed. One nit, fixed in `9f3c1a2`. 142 tests pass." | | Pop. |
| 23.4 | nina: "Ready for staging when you are." | | Pop. |
| 24.0 | The room slides away left; nina's settings slide in from the right: "Model" (Only frontier models, and every write ends at the gate) with Governed and Ungoverned; at 24.6 the thumb slides to Governed; under "Ask me before", Deploying anywhere, Pushing to protected branches, Reaching the network and Spending past the run cap switch on one per sixteenth; "Workspace": Sandbox. | **governed,** / **bot by bot.** | A switch click per toggle. |

### 4. Feedforward: it shows how it read you (26.4 to 36.0, bars 12 to 15)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 26.4 | Black, and one large session composer (the kit's, 720 px at 1.9x): Governed, Smart, "$0.00 of $0.60". | **say what you want.** (below) | The groove thins to kick and bass; the pad closes. |
| 27.0 | Typing, 24 characters a second, a brass caret: "refactor the proration helpers in src/billing to integer cents, run the tests, then open a PR." Each decision word gets its dashed underline as it completes, and the "Will assume:" row above the field fills: ">refactor", ">src/billing", ">npm test", ">draft a PR", ">governed starts on Claude Opus 5.5". The reading is the app's own (`modules/session/feedforward.ts`). | | A soft key click per character; a tick as each reading lands. |
| 31.2 | The line changes. | **it shows how it read you.** | The groove returns. |
| 31.8 | The pointer clicks "refactor": its readings open above it (Read as "refactor": refactor, Same behaviour, new structure; rewrite, Behaviour may change, I will list how; fix, The smallest change that makes it right; review only, Read and comment, no edits; "Dashed: my guess. Solid: your choice."). The highlight steps to "fix" (32.4) and it is chosen (32.7): the underline turns solid brass and the assumption rewrites to ">fix, smallest change". | | Click; a menu swish; a two-note select. |
| 33.6 | Keycaps by "open a PR": alt ↓. Its readings open (When done "open a PR": Draft a PR; Open a ready PR, Asks atlas for a review; Push the branch only); "Open a ready PR" is chosen (34.5); the assumption becomes ">ready PR". | **one click changes it.** | Two key clicks; select. |
| 35.4 | The send button takes the brass ring; the composer fades. | | A riser into the next bar. |

### 5. No pile of tools (36.0 to 43.2, bars 16 to 18)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 36.0 | A wall of generic tool names in quiet mono, fifteen rows drifting in alternate directions and speeding up (read_file, write_file, edit_file, multi_edit, apply_patch, grep, glob, list_dir, bash, terminal, run_command, web_fetch, web_search, todo_write, notebook_edit, git_status, git_diff and fifty more). A black band through the middle carries the line. | **no pile of tools.** | A riser and a departures-board tick. |
| 38.1 | Every name flies into one of three points. | | A reverse swell. |
| 38.4 | **pack**, **exec**, **ship** land on the beats (38.4, 39.0, 39.6), mono, 132 px, each with its line: "reads", "runs in a sandbox", "the only way to write". | **three tools.** | Three low hits with a bell. |
| 40.8 | A dashed boundary draws itself around exec, its edges named in mono: "network off", "workspace read-only, secrets left out"; under pack: "files, symbols, diffs; secrets redacted"; under ship the gate runs: "npm test", a red **failed** stamp with "invoice.test.ts" (41.4), "rolled back, byte for byte" (41.8), "142 passed" in green (42.3). | **sandboxed, and reversible.** | A soft draw; a thud on failed; a rewind; a chime on passed. |

### 6. Governed models (43.2 to 55.2, bars 19 to 23)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 43.2 | Title, centre; under it at 44.0, mono: "frontier models only". At 44.35 both rise and shrink. | **governed mode.** | Impact; the four-on-the-floor groove and the bass line. |
| 44.45 | A ladder builds on the left, the kit's list ladder with each lab's mark: Gemini 4 Hydrogen "first try", GPT-6.2 Sol "after 1 fail", Claude Opus 5.5 "after 2 fails". | | Three plucks. |
| 45.6 | On the right, the run's steps arrive: "Read 9 files in src/billing" and "Moved the proration helpers to integer cents" (Gemini 4 Hydrogen); "npm test" with a red **failed** stamp (46.5); "Rolled back invoice.ts and climbed to GPT-6.2 Sol" while the brass station climbs (47.1); "Rounded once per invoice and added the property test" (GPT-6.2 Sol); "npm test, 142 passed" (47.7). | **a failed test climbs the ladder.** | Thud; rewind; a step up; a chime. |
| 48.0 | "Heavy models" slides in: Climb to Fable (Claude mark) and Grok 4.7 (Grok mark), "Token-heavy. Off until you turn it on.", both off. The pointer turns Fable on (49.2) and a new top station lights: Claude Fable 5.2, "on because you chose it". | **heavy models wait for your word.** | A switch; a low heavy note. |
| 50.4 | Cut to nina's approval card, 2x: "Deploy to staging", "needs you", "billing/cents → staging, dry run first", the well, "Expires in 9 min", Deny, Hold to approve. The pointer presses at 51.0 and stays down: the dot field gathers and fuses into the fill over exactly one second; "Approved" at 52.0; at 52.3 the receipt "Approved at 14:09" and nina's orb turns happy. | **nothing ships until you hold.** | The groove drops out; a one-second riser locked to the fill; a bell at 52.0. |
| 52.8 | The card shrinks away and the record builds upward, a row every 0.2 s: seq, type, the previous line's hash → its own: session.opened, route.decided, tool.called, ship.applied, gate.decided, ship.restored, route.decided, gate.decided, approval.decided (in a brass ring), checkpoint.committed. | **every step on the record.** | A typewriter tick per row; the groove returns. |

### 7. The plans you already pay for, many models (55.2 to 67.2, bars 24 to 28)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 55.2 | The setup hub assembles: the labs' own sign-in buttons as boopis draws them (Sign in with Claude, ChatGPT, GitHub, xAI), a wall of key tiles in brand colour (Gemini, DeepSeek, Qwen, Kimi, Mistral, MiniMax, Z.ai, Llama), "Connect any lab at any time in Settings, Models.", Do it later, Continue. From 56.2 three plates turn into receipts: Claude subscription, ChatGPT, GitHub Copilot, "connected". | **bring the plans you already pay for.** | An arpeggio; a blip per receipt. |
| 57.1 | "Do it later" takes the brass ring. | **or start free.** | A two-note answer. |
| 58.8 | One conversation, 1.38x: "should line items round on their own, or once per invoice?"; the answer's call number "Claude Opus 5.5, Council of 3"; three member rows (Claude Opus 5.5, GPT-6.2 Astra, Gemini 4 Neon) go from "thinking" to "done" (59.4, 59.7, 60.0), then "Claude Opus 5.5 combined 3 answers" and the combined answer: "Once per invoice. Rounding each line drifts by up to a cent a line; all three answers agree, and the property test proves it." | **ask a** / **council.** | Three tones that resolve to one chord. |
| 61.2 | "@" in the composer opens the model menu in brand colour ("Ask one model, for this message": Claude Opus 5.5, Claude Sonnet 5.5, GPT-6.2 Astra, GPT-6.2 Sol, Gemini 4 Neon, Grok 4.7, DeepSeek V3.2, Qwen3 Coder); the highlight runs to GPT-6.2 Sol and the mention chip forms: "@GPT-6.2 Sol write the property test"; sent (63.0); a divider "Claude Opus 5.5 → GPT-6.2 Sol"; the reply signed GPT-6.2 Sol: "Added `prorate.test.ts`: splitting a window never changes the total, across 5,000 random splits." | **@ any** / **model.** | Menu ticks; select; a send whoosh. |
| 63.6 | More replies, each signed with its mark and a divider where the model changes: Gemini 4 Neon ("The changelog and the API docs now say amounts are integer cents."), Claude Opus 5.5 ("Ready to ship: 4 files, `142 passed`, public API unchanged."), DeepSeek V3.2 ("Ran the backfill on a copy: 1.2 million invoices in 3m 10s, every total unchanged."). | **every reply** / **signed.** | A pop per reply. |

### 8. They learn (67.2 to 74.4, bars 29 to 31)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 67.2 | moss (green squircle, "flaky test hunter"), 320 px, working; under it "invoice.test.ts fails only after midnight UTC", ticking to "done" (68.4) as its face turns done. | **they learn on the job.** | A sparse arpeggio. |
| 68.5 | A skill writes itself (skills/flaky-tests/SKILL.md, "Flaky tests"): "When a test fails only sometimes:", "1. Rerun it 20 times.", "2. Pin the clock and the seed.", "3. Then touch the code." At 70.2 "saved to moss's skills"; moss looks happy. | | Pen ticks; a bell. |
| 70.8 | The skill refines: "+ Check the time zone first." slides in, in green, tagged "refined". | | A brighter bell. |
| 72.0 | Memory chips float in: "remembers you prefer draft PRs", "remembers invoices round once", "remembers staging before production". | **and they remember.** | Three soft notes. |

### 9. One store for every source (74.4 to 81.6, bars 32 to 34)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 74.4 | Fourteen unnamed source tiles appear in a ring, glyphs on raised tiles, some captioned in mono: your folder, a repository, a registry, a marketplace, a skills hub, a link, a catalogue, a plugin store. | **every source.** | A sparkle per tile. |
| 75.6 | They fly to the centre and the store grows out of where they met: "Store", the search field ("Search skills, connectors, plugins and mods"), All, Skills, Connectors, Plugins, Mods, "Recommended", six items with their kind and tier ("Recommended by boopis", "Verified by its source", "Not reviewed"). | **one store.** (76.5) | A merge whoosh and a low hit. |
| 77.8 | "changelog" is typed into search; the other items recede. | | Key clicks. |
| 78.8 | changelog-writer is picked: "Install changelog-writer?", "Skill, Recommended by boopis", Pinned to a3f9c21, Runs code yes from your next session, Network none. The pointer holds "Hold to install" for one second (79.4 to 80.4); "Installed. Your next session has it."; the foot becomes "Installed at 14:31". | | Click; a one-second riser; a bell. |

### 10. Everything else, fast (81.6 to 91.2, bars 35 to 38)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 81.6 | A form card flips up into place: atlas, "waiting for you", "How should line items round?", the rounding rule (Half away from zero, Half to even, Do not round line items, Other), Later, Cancel, Answer. "Half to even" is picked at 82.7. | **one card for anything it needs.** | A card flip; a click. |
| 84.0 | A composer, 2x; a mod's status line appears ("coverage", "coverage 91%, up 2 since main", progress dots filling) and the composer rises 22 px. | **mods.** | A quick arpeggio. |
| 85.2 | An app window with the dock wipes through the four presets on the beats, each named: Card catalog, Graphite (85.8), Bone (86.4), Typewriter (87.0); the dock stays black in all four. | **four themes.** | A swish per wipe. |
| 87.6 | Keycaps snap in, one every 0.3 s: ctrl K Command palette, alt M Who answers next, alt C Ask a council, alt G Governed, alt V Talk. | **keyboard first.** | A key thock per row. |
| 89.4 | A plain machine outline draws itself; the boopis window lands in its screen; below, in mono: "its engine, your keys and your sessions stay on this computer". | **runs on your machine.** | A warm pad swell. |

### 11. The eyes go home (91.2 to 101.8, bars 39 to 42 and the tail)

| Time | On screen and motion | Copy | Sound |
|---|---|---|---|
| 91.2 | The eleven bots return in a ring from the edges, happy, turning; at 92.3 they converge into the centre, shrinking. | | Shimmers; the groove at full. |
| 92.75 | One pair of eyes on black (93.0); a blink. | | A reverse swell; everything stops dead at 93.0. |
| 93.6 | The wordmark grows out of the eyes: its "oo" is the pair, the letters open outward (a reveal from the centre) as it settles to the centre; 250 px, `--text-strong` on black, nothing in its protection area. | | A low "boop" over a held chord. |
| 94.2 | The logo's big moment, `letters="play"`: listening, thinking, happy, idle; the letters hop, lean and squash. | | A playful blip on each step. |
| 96.0 | Far below the wordmark, on its own beat: | **AI coding agents. you stay in charge.** | The final chord, with a boom and bells. |
| 98.2 | The end card holds; the wordmark's eyes come alive (glances, blinks). | | The chord rings out. |
| 101.4 | Fade to black. | | Silence at 101.8. |

## Transitions

- 4.8: match on the eyes (the mark's eyes become noct's).
- 9.6: noct becomes the grid's centre (continuous).
- 15.0: the grid becomes the dock (shared elements travel, as the app's dock does).
- 18.9 to 19.2: a short dip through black into the room; 26.4 a hard cut on the bar.
- 36.0: the composer gives way to the tool wall (mono to mono); 38.4 collapse to three points.
- 43.2: cut on the impact; 50.4 cut to the card; 52.8 the card shrinks into the record.
- 55.2, 67.2, 74.4: short dips through black on the bar, chapter by chapter.
- 81.6 to 91.2: half-bar cuts; the theme changes are diagonal wipes on the beats.
- 91.2: the bots converge into the eyes; 93.6 the eyes become the wordmark (bookending 4.8).

## Brand checks for every frame

- Nothing that boopis is built from is named or shown. Lab marks only where a lab takes part.
- The wordmark: one colour, on flat black, never rotated, skewed, blurred or outlined; nothing in its protection area.
- The dock is black; the hold is one second; red only on what you owe; brass only as a mark.
- Text on screen long enough to read (every line holds at least 1.2 s).
