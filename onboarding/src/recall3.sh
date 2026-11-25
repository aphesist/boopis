#!/bin/bash
# Records revision 3's clips and their reduced-motion versions (1280 x 800, 60 fps), each with a 16-frame strip cut from the MP4
cd "$(dirname "$0")/.."
export NODE_PATH=$(npm root -g)
rec() { # clip name
  local Rn=$(echo $2 | sed -E "s/^(O-M[0-9]+[a-z]?)-/\1r-/")
  node src/rec3.cjs $1 motion/$2.mp4 && python3 -I src/strip2.py motion/$2.mp4 motion/$2-strip.jpg
  node src/rec3.cjs $1 motion/$Rn-reduced-motion.mp4 "" reduced && python3 -I src/strip2.py motion/$Rn-reduced-motion.mp4 motion/$Rn-reduced-motion-strip.jpg
}
for x in ${@:-wake listen alive assemble tryit stepsA stepsB goals handoff}; do
  case $x in
    wake) rec wake O-M1-speaker-wakes;;
    listen) rec listen O-M2-speaker-reacts;;
    alive) rec alive O-M3-what-bots-are;;
    assemble) rec assemble O-M4-team-assembles;;
    tryit) rec tryit O-M5-try-it;;
    stepsA) rec stepsA O-M6a-setup-hello-to-model;;
    stepsB) rec stepsB O-M6b-setup-into-sessions;;
    goals) rec goals O-M7-goal-tiles;;
    handoff) rec handoff O-M8-handoff;;
  esac
done
