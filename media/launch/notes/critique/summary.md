# Critique summary: acts 1-4 (dark renders, before the light revision)

71 findings: 23 blockers, 26 majors, 22 minors. Per-act detail, crops, causes and fixes in act1.md to act4.md.

| act | span | blockers | majors | minors | total |
|---|---|---|---|---|---|
| 1 | 0-9.6 s | 8 | 8 | 8 | 24 |
| 2 | 9.6-20.0 s | 5 | 5 | 4 | 14 |
| 3 | 20.0-32.0 s | 6 | 8 | 4 | 18 |
| 4 | 32.0-46.93 s | 4 | 5 | 6 | 15 |

Theme-independent except A1-24, A2-14, A3-18, A4-15 and part of A3-12.

## Top 10
1. Double images wherever something small moves (A1-01, A1-06, A1-08, A2-02, A3-03, A4-03, A4-04).
2. Mention chips 15-18 px below the line in every act (A1-05, A2-04, A3-06); the real product shares the baseline.
3. Fast moves break into rows of copies: cursor, the dive, the lifts, the glide (A1-03, A1-04, A2-09, A3-02, A3-05, A4-02).
4. Faint ghosts of older poses even at rest (A1-02).
5. Act 3's send at 21.333 s: request doubled for a frame, then a 300 px jump, no press (A3-01).
6. 9:16: the other app's panel covers half of "Hold to approve" for the whole hold (A4-01).
7. The drop at 29.97-30.17 s: the window empties for 2-3 frames, then the room fades in (A3-04).
8. Lab logos slide through the cast cards' names and roles (A1-07).
9. Act 2's busiest beats fall apart: reply stutter (12.77 s), summary scramble and strobe (14.63 s), bubble sliced into bars (17.93 s) (A2-03, A2-02, A2-05).
10. Act joins pop: orb faces change at 9.600 (A2-01), terminal jumps 10 px at 32.000 (A4-05).

## Systemic: engine and renderer
- E1 Two-sample shortcut (tools/lib/worker.mjs:101-106, :46-51) gives the double images. Remove; count samples from motion.
- E2 Samples seeked out of order (worker.mjs:103-106) plus overlapping tweens with overwrite:false (engine/film.ts:75, :145): one stale sample in eight. Seek ascending; overwrite:'auto' or chained fromTo.
- E3 Sample count ignores screen speed (8 default, 64 max, worker.mjs:94). Base it on displacement (1-2 px between samples) or blur the cursor analytically; slow the moves to the script's timings.
- E4 Instant swaps on a frame time get averaged across the exposure (A3-01, acts/a3/session.ts:116, :123). Make instant changes film.cut() automatically or move them half a frame.
- E5 Text-to-bars wipe slices words at readable size (acts/a2/bars.ts:71-107, act 3's barsFor). One shared helper; swap whole runs, only below ~12 px on screen.
- E6 Invisible masks slice letters (A2-06, A2-02). Use the craft bible's word-rise exit (K1) and self-editing line (K5).
- E7 Act joins untested: diff each act's last frame with the next's first; check no element draws outside its act's span. Known: act 3's .a3-sessionclip drawn from 0 s; act 4 must read ctx.carry.orbs.nina in the 15 s cut.
- E8 The checker passed all of this: add double-image detection, text cut by the frame edge, the act-join diff, inline chip baselines against the product.

## Systemic: look (light rebuild)
- L1 The orb swap moves the chip's baseline: look/src/stage.ts:104-113 (sharpenOrbs) and engine/look.ts:86 (swapOrbs).
- L2 Plates must bleed past the frame (A1-13, A3-13).
- L3 Safe areas and edge crops: headline 30 px from the top (A4-07), room text cut right (A3-07), timestamps cut left (A3-08), 9:16 headline under platform buttons (A1-16), hold button hidden (A4-01); B13 and B16 key frames crop text and Deny.
- L4 One character layer for the orbs: freezes in holds (A4-09), speaking-face flicker (A1-19), overlapping glances (feeds E2).
- L5 Film lines set at ~105-110 px against the script's 84-96 px.
- L6 9:16 top-heavy: lower 30-45% empty in every act.
- L7 (dark-specific) dark plates on a dark ground read as murk.

## Per act (fixed in the act)
- Act 1: A1-07, A1-10, A1-11, A1-12, A1-14.
- Act 2: A2-02, A2-03, A2-07, A2-08.
- Act 3: A3-01, A3-04, A3-11, A3-12, A3-13, A3-14.
- Act 4: A4-01, A4-02, A4-06, A4-08, A4-09 (act 4 needs a re-render before the 32 s seam is re-checked).
