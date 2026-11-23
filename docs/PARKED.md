# Parked work (paused by the owner on 23 November 2026)

The owner paused the launch film and the in-app redesign work to focus on the macOS version and bug fixing. Nothing
here is merged; each piece is kept on its own branch so it can be picked up later.

## Launch film (media/launch)
- `w28/launch-video`: the film engine and everything finished: four animated acts (dark look), the light look
  (Bone preset), the rebuilt key frames, the planned-motion-blur renderer, the character layer and line helpers, the
  checker, the sound, and the seam contract for the light revision (38f465a3). Builds.
- `w28/launch-light-wip`: acts 1 and 2 partway through the light revision (does NOT build yet), plus the paper trail
  in `media/launch/notes/`: the owner's decisions, the frame-by-frame critique of acts 1-4 (71 findings), the
  revision brief and per-act fixes, the light look and the storyboard.
- Not started when paused: acts 3 and 4's light revision (only the seam numbers were committed), the second critic
  pass, the full cut with sound, the 4K/9:16/15 s/6 s finals.

## In-app redesign
- `w29/rail-counter-wip`: a smaller "+N" counter for the collapsed sidebar's group cluster (owner: "that +2 is too
  big"), half done in `components/stack.ts`; tests and goldens not updated.
- Finished design work already on fix branches (merging into w29/integrate): the Store and Connectors redesign
  (w29/store-connectors), the collapsed sidebar (w29/rail d0b123b2), the dock scroll and centred-dock option
  (w29/dock-notice).

## Still active (not parked)
- macOS: w30/macos (green), the notch design (approved, corners fixed; build not started).
- Bug fixing: w29/integrate (the w29 fix branches), w29/host-lifecycle, w30/governed-bots, w30/local-api-0.2.
