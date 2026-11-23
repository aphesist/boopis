# The blocking stillness and edge check, on rec.cjs's stats.json (read from the canvases' own pixels):
#  - REST: every orb-frame at rest (reaction "pose", not hovered, unchanged 1.5 s) must have 0 changed pixels.
#  - ABA: silhouette pixels that toggle and come back (A-B-A), for every orb, moving or not; the target is 0.
#  - JUMP: a canvas whose screen position changes (no orb moves in the layout of these scenes); REFIT: its backing width changes.
# usage: python3 -I edges.py <framesDir>   exit 1 when a proposed-side orb at rest changes, or the proposed side toggles or jumps.
import sys, json
d = sys.argv[1]; S = json.load(open(d + '/stats.json')); R = json.load(open(d + '/rects.json'))['rects']
bad = 0
for h, name in ((0, 'today'), (1, 'proposed')):
    js = [j for j, r in enumerate(R) if r['half'] == h]
    rest_f = sum(1 for f in S for j in js if f[j]['rest']); rest_bad = [(i, R[j]['bot'] or R[j]['shape'], f[j]['ch']) for i, f in enumerate(S) for j in js if f[j]['rest'] and f[j]['ch']]
    aba = sum(f[j]['aba'] for f in S for j in js); aba_f = [(i, R[j]['bot'] or R[j]['shape'], f[j]['aba']) for i, f in enumerate(S) for j in js if f[j]['aba']]
    jump = sum(1 for i in range(1, len(S)) for j in js if (S[i][j]['x'], S[i][j]['y']) != (S[i - 1][j]['x'], S[i - 1][j]['y']))
    refit = sum(1 for i in range(1, len(S)) for j in js if S[i][j]['w'] != S[i - 1][j]['w'])
    print(f'{name:8s} rest orb-frames {rest_f}, changed at rest {len(rest_bad)}; A-B-A edge pixels {aba} in {len(aba_f)} orb-frames; canvas jumps {jump}; refits {refit}')
    for b in rest_bad[:5]: print('   rest changed: frame %d %s %d px' % b)
    for b in sorted(aba_f, key=lambda b: -b[2])[:5]: print('   A-B-A: frame %d %s %d px' % b)
    if h == 1 and (rest_bad or aba or jump or refit): bad = 1
sys.exit(bad)
