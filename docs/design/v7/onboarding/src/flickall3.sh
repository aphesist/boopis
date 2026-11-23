#!/bin/bash
# Revision 3's frame check of every clip and its reduced-motion version (flicker2.py), with the regions from regions3.cjs
cd "$(dirname "$0")/../motion"
F="python3 -I ../src/flicker2.py"
for r in "" r; do
  sfx=$([ -z "$r" ] && echo "" || echo "-reduced-motion")
  n() { echo "$1" | sed -E "s/^(O-M[0-9]+[a-z]?)-(.*)/\1$r-\2$sfx.mp4/"; }
  $F $(n O-M1-speaker-wakes) --track 470,300,340,200
  $F $(n O-M2-speaker-reacts) --track 560,60,160,100
  $F $(n O-M3-what-bots-are) --orb 558,268,53,53@96-552 --orb 747,268,53,53@96-552 --orb 935,268,53,53@96-552 --orb 107,84,53,53
  $F $(n O-M4-team-assembles) --orb 107,84,53,53 --orb 11,164,39,39@215-256 --orb 11,164,39,39@300-516 --orb 11,203,39,39@300-340 --orb 11,203,39,39@380-516 --orb 11,242,39,39@390-516
  $F $(n O-M5-try-it) --track 560,60,160,100
  $F $(n O-M6a-setup-hello-to-model) --track 400,30,480,480 --eyes
  $F $(n O-M6b-setup-into-sessions) --track 560,60,300,260 --eyes
  $F $(n O-M7-goal-tiles) --orb 505,249,39,39@270-540 --orb 691,249,39,39@400-540 --orb 966,206,32,32@60-540 --orb 1019,206,32,32@60-540
  $F $(n O-M8-handoff) --track 708,196,130,96@0-255 --eyes --orb 738,68,71,71@330-600 --orb 107,84,53,53@330-600
done
