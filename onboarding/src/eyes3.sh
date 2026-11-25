#!/bin/bash
# orb3's eye-constraint check (character/probes/tools/eyecheck.py on w31/bot-character) on revision 3's clips: for each
# resting place of a bot (x,y,w,h in the 1280 x 800 clip) and the frames it sits there, the frames are cut from the MP4 into
# a temporary folder with eyecheck's rects.json, checked, and deleted. usage: eyes3.sh <eyecheck.py>
EC=$1; cd "$(dirname "$0")/../motion"; T=$(mktemp -d)
run() { # clip label x,y,w,h f0 f1
  local d=$T/f; mkdir -p $d; ffmpeg -v error -i $1 -vf "select='between(n,$4,$5)'" -vsync 0 -q:v 2 $d/%04d.jpg
  IFS=, read x y w h <<< "$3"; echo "{\"dpr\":1,\"rects\":[{\"x\":$x,\"y\":$y,\"w\":$w,\"h\":$h,\"half\":1,\"bot\":\"$2\",\"shape\":\"$2\"}]}" > $d/rects.json
  echo "$1 $2 frames $4-$5: $(python3 -I $EC $d | tail -2 | head -1 | sed 's/  */ /g')"; rm -r $d
}
run2x() { # clip label x,y,w,h(page px) f0 f1 [reduced]: bots under 30 px, recorded again at DPR 2 (the 1280 MP4 cannot resolve their pills)
  local d=$T/f; node ../src/rec3-crop.cjs $1 $d $3 $4 $5 $6 >/dev/null
  echo "$1${6:+ reduced} $2 at 2x frames $4-$5: $(python3 -I $EC $d | tail -2 | head -1 | sed 's/  */ /g')"; rm -r $d
}
export NODE_PATH=$(npm root -g)
for r in "" r; do s=$([ -z "$r" ] && echo "" || echo "-reduced-motion")
  M3=O-M3$r-what-bots-are$s.mp4; M4=O-M4$r-team-assembles$s.mp4; M7=O-M7$r-goal-tiles$s.mp4; M8=O-M8$r-handoff$s.mp4
  run $M3 kai 558,268,53,53 96 551; run $M3 moss 747,268,53,53 96 551; run $M3 iris 935,268,53,53 96 551; run $M3 boopis-side 107,84,53,53 0 551
  run $M4 boopis-side 107,84,53,53 0 515; run $M4 kai-row 11,164,39,39 300 515; run $M4 moss-row 11,203,39,39 380 515;
  run $M7 kai-tile 505,249,39,39 300 539; run $M7 iris-tile 691,249,39,39 440 539
  run $M8 boopis-chat 738,68,71,71 330 599; run $M8 boopis-side 107,84,53,53 330 599
done
for r in "" reduced; do run2x goals nimbus 1087,232,36,36 60 539 $r; run2x goals nina 1146,232,36,36 60 539 $r; run2x assemble iris-row 12,272,44,44 470 515 $r; done; rmdir $T
