# The blocking stillness and edge check, on rec.cjs's stats.json (read from the canvases' own pixels):
#  - REST: every orb-frame at rest (reaction "pose", not hovered, unchanged 1.5 s) must have 0 changed pixels.
#  - ABA: silhouette pixels that toggle and come back (A-B-A), for every orb, moving or not, split in two:
#      motion      the silhouette really moved across those frames: it went out and came back (d2 under half of d1), or
#                  it moved on by more than 0.15 px along its whole outline on average (d2 over 0.15 of the perimeter): a
#                  swing, a spin, a wobble, a hop's top. A pixel near a moving edge can then read A-B-A legitimately.
#      shimmer     every other toggle: edge pixels flipping while the shape holds or creeps, which reads as flicker.
#                  The target is 0, and it blocks.
#  - JUMP: a canvas whose screen position changes (no orb moves in the layout of these scenes); REFIT: its backing width changes.
# usage: python3 -I edges.py <framesDir>   exit 1 when a proposed-side orb at rest changes, or the proposed side toggles or jumps.
import sys, json
d = sys.argv[1]; S = json.load(open(d + '/stats.json')); R = json.load(open(d + '/rects.json'))['rects']
bad = 0
for h, name in ((0, 'today'), (1, 'proposed')):
    js = [j for j, r in enumerate(R) if r['half'] == h]
    rest_f = sum(1 for f in S for j in js if f[j]['rest']); rest_bad = [(i, R[j]['bot'] or R[j]['shape'], f[j]['ch']) for i, f in enumerate(S) for j in js if f[j]['rest'] and f[j]['ch']]
    def turnaround(i, j):
        f = S[i][j]; per = 3.6 * max(f['a'], 1) ** .5   # the silhouette's perimeter, roughly (px)
        return (f['d1'] > 2 and f['d2'] < .5 * f['d1']) or f['d2'] > .15 * per
    # stats frame i holds the toggles at frame i-1 (seen once frame i came back)
    ev = [(i, j, f[j]['aba']) for i, f in enumerate(S) for j in js if f[j]['aba']]
    turn = [(i, R[j]['bot'] or R[j]['shape'], n) for i, j, n in ev if turnaround(i, j)]
    aba_f = [(i, R[j]['bot'] or R[j]['shape'], n) for i, j, n in ev if not turnaround(i, j)]
    aba = sum(n for _, _, n in aba_f); turn_px = sum(n for _, _, n in turn)
    jump = sum(1 for i in range(1, len(S)) for j in js if (S[i][j]['x'], S[i][j]['y']) != (S[i - 1][j]['x'], S[i - 1][j]['y']))
    refit = sum(1 for i in range(1, len(S)) for j in js if S[i][j]['w'] != S[i - 1][j]['w'])
    print(f'{name:8s} rest orb-frames {rest_f}, changed at rest {len(rest_bad)}; shimmer (A-B-A) {aba} px in {len(aba_f)} orb-frames; in fast motion {turn_px} px in {len(turn)}; canvas jumps {jump}; refits {refit}')
    for b in rest_bad[:5]: print('   rest changed: frame %d %s %d px' % b)
    for b in sorted(aba_f, key=lambda b: -b[2])[:5]: print('   shimmer: frame %d %s %d px' % b)
    if h == 1 and (rest_bad or aba or jump or refit): bad = 1
sys.exit(bad)
