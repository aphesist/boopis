# Light revision brief (every animator)

The owner's bar: "the video needs to feel 100% premium and well made", "every single pixel should be tasteful",
"saas trailer animation" (Rayan Visuals, hi27624, byshubh_, titouangillet). The owner watched act 1 and found visual
bugs at once; nothing reaches them again without a clean frame-by-frame pass.

Read, in this order (SC = /tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/launch-video):
1. SC/decisions.md (all of it, points 6-8 are new: light theme, revise everything, zero visible defects).
2. SC/critique/summary.md and SC/critique/actN.md (your act's findings, every one with frames, crop, cause, fix).
3. SC/revision-notes.md (cross-act issues, the order of work, and the art director's per-act fixes for your act).
4. SC/storyboard/look.md (the light look; sections 2 bleed and 7 safe box, crop rule, type token, 9:16 rule) and the
   light style frames in SC/storyboard/light/.
5. media/launch/README.md (the engine: renderer, sampling, helpers, checker).

What changed under you (engine, already committed on w28/launch-video):
- The look is light (Bone preset); film values are tokens in look/src/film.css (--lamp-*, --plate-*, --card-shadow,
  --contact*, --cursor-shadow, --haze, --focus-pull, --far-dim). Replace every dark hard-code in your act (list in
  revision-notes.md).
- Key frames moved: safe areas, bleeding plates (bleedPlate()), one film-line size (--film-line-size; filmLine() takes
  no size), inStage() placement, B13/B10/B16/B17 framing, B03 cards 820 px, 9:16 rebalanced. Land on the new key
  frames.
- The renderer plans sub-frames from on-screen motion: remove every film.motion(..., N) / sampleAll workaround.
  Seeks are always forward and frames are deterministic. A zero-duration set that changes a value is a clean cut.
- springEase lands exactly at rest.
- New helpers (src/motion): character(film, orb, {seed}) with .look/.speak/.blink/.hold (idle life, never frozen;
  replaces hand-made speak sequences and overlapping glances); words()/wordRise()/lineExit() (K1) and selfEdit() (K5),
  never masks that slice letters; textRuns()/textBars() for words-to-bars (whole runs, only under 12 px on screen).
  Demo: look at index.html?scene=craft.
- The checker (tools/qa) has new hard rules: no full-frame cross-fade (a drift is no longer one), no double images
  (fast screen + 64-sample confirmation of worst frames), no readable text cut by an edge or outside the safe box, act
  joins that match within grain, no element of an act visible outside its span, inline chip baselines matching the
  product. Run `node tools/qa/qa.mjs <video> --scene aN` and the page rules on the film scene.

Bring motion back into the holds: the camera was held dead still only to dodge the old false positive. Gentle,
motivated drift and parallax are allowed again. Still share target: well under 0.3 in both formats.

Seams stay at 9.600, 20.000, 32.000 s with handles in SEAMS.md; every act ends at rest on its seam state and starts
from the previous act's carry. Bound every element to your act's own window (the checker fails otherwise).

Process:
- Iterate with --preview and stills; render full 1080p60 landscape + vertical only when you believe it is clean.
  Use --workers 2 (four animators share 4 CPUs). Disk is tight (about 2 GB free): delete intermediate renders.
- Before you report: both renders pass every checker rule; you looked at every motion event frame by frame at full
  size and at the critique's frames; every finding in your act's critique is fixed or explicitly argued; the film
  scene at your seams matches.
- Commit only your act's paths, staged by name, as aphesist alone (no Co-Authored-By, no Claude-Session, nothing
  naming an agent or model). Do not push. Do not edit src/engine, tools/, look/ or another act's files; if you need an
  engine change, stop and tell the coordinator.
- Report: what changed per beat, each critique finding with its fix, the checker table for both formats, the seam
  check, the render paths (SC/renders/aN-1080-light.mp4 and aN-vertical-light.mp4, plus aN-sheet-light.jpg), commits.
