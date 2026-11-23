#!/bin/bash
# records the orb3 look-around (beside Grok-Bot's drop) and torture clips, runs every check, encodes, deletes frames
S=/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/character
cd $S
rm -rf $S/work/f-look $S/work/f-t3 $S/work/keep-t3
node tools/rec.cjs "http://127.0.0.1:8765/clip.html?scene=look&solo=1&right=orb3" $S/work/f-look 15 2
echo "== look"; python3 -I tools/edges.py $S/work/f-look | grep -v "^   today"
echo "-- eyes (2.2-10 s: the pose's exit, the head turn and nod, the lively idle)"; python3 -I tools/eyecheck.py $S/work/f-look 1 2.2-10
echo "-- eyes (whole clip)"; python3 -I tools/eyecheck.py $S/work/f-look 1 | tail -1
python3 -I tools/shape.py $S/work/f-look | sed -n 3p
ffmpeg -v error -y -framerate 31.25 -i $S/work/f-look/%04d.jpg -ss 0 -t 15 -i $S/../owner-grok-videos/drop-moving.mp4 -i $S/look-cap.png -filter_complex "[0:v]scale=1280:800:flags=lanczos[ours];[1:v]crop=360:300:1980:510,scale=600:500,fps=31.25[g];[ours][g]overlay=20:150:shortest=1[a];[a][2:v]overlay=0:0" -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart -t 15 $S/anim-look-orb3-vs-grok.mp4
rm -rf $S/work/f-look
node tools/rec.cjs "http://127.0.0.1:8765/clip.html?scene=torture&right=orb3" $S/work/f-t3 13 2
echo "== torture"; python3 -I tools/edges.py $S/work/f-t3 | grep -v "^   "
echo "-- eyes (0-9 s, the turn sweep)"; python3 -I tools/eyecheck.py $S/work/f-t3 1 0-9
mkdir -p $S/work/keep-t3; cp $S/work/f-t3/rects.json $S/work/keep-t3/
for i in $(seq 0 3 406); do f=$(printf "%04d" $i); [ -f $S/work/f-t3/$f.jpg ] && cp $S/work/f-t3/$f.jpg $S/work/keep-t3/; done
python3 -I tools/convexdents.py $S/work/keep-t3
ffmpeg -v error -y -framerate 31.25 -i $S/work/f-t3/%04d.jpg -vf "scale=1280:800:flags=lanczos" -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart $S/anim-torture-orb3.mp4
rm -rf $S/work/f-t3
