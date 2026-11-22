#!/bin/sh
# writes one page per beat and format; the pages are identical but for their names, which the board script reads
cd "$(dirname "$0")"
for b in b01 b02 b03 b04 b05 b06 b07 b08 b09 b10 b11 b12 b13 b14 b15 b16 b17 b18 b19a b19b; do
  for f in "$b" "$b-vertical"; do
    printf '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>boopis board: %s</title></head>\n<body><div class="stage"></div><script type="module" src="../src/board.ts"></script></body>\n</html>\n' "$f" > "$f.html"
  done
done
