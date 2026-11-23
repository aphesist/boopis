#!/bin/bash
# Records every revision 2 clip and its reduced-motion version, each with a frame strip (16 frames, evenly spaced over the clip)
cd "$(dirname "$0")/.."
export NODE_PATH=$(npm root -g)
rec() { # clip name dur_ms
  local R=$(echo $2 | sed -E "s/^(O-M[0-9]+[a-z]?)-/\1r-/"); local T=$(python3 -c "import json;d=$3;print(json.dumps([round(i*(d-60)/15) for i in range(16)]))")
  STRIP_COLS=8 STRIP_W=240 STRIP_T="$T" node src/rec2.cjs $1 motion/$2.mp4 motion/$2-strip.jpg
  STRIP_COLS=8 STRIP_W=240 STRIP_T="$T" node src/rec2.cjs $1 motion/$R-reduced-motion.mp4 motion/$R-reduced-motion-strip.jpg reduced
}
for c in "$@"; do
  case $c in
    listen) rec listen O-M2-speaker-reacts 9600;;
    alive) rec alive O-M3-bots-come-alive 10800;;
    assemble) rec assemble O-M4-team-assembles 8600;;
    tryit) rec tryit O-M5-try-it 9300;;
    stepsA) rec stepsA O-M6a-steps-hello-to-setup 8800;;
    stepsB) rec stepsB O-M6b-steps-setup-to-canvas 10000;;
    goals) rec goals O-M7-goal-tiles 9600;;
  esac
done
