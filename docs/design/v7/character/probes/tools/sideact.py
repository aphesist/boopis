# per-avatar activity in Grok-Bot's sidebar: mean abs change between frames at 10 fps in each avatar box, printed as a
# timeline (one char per 0.5 s: '.' still, ':' small, '#' moving), plus the moving spans
import sys, subprocess, numpy as np
f = sys.argv[1]; W, H = 1440, 866
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', 'fps=10', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
n = len(raw) // (W * H); v = np.frombuffer(raw, np.uint8)[:n * W * H].reshape(n, H, W).astype(np.int16)
boxes = {'main': (88, 58, 136, 110), 'row1': (8, 146, 48, 184), 'row2': (8, 192, 48, 230), 'row3': (8, 238, 48, 276), 'row4': (8, 284, 48, 322)}
for k, (x0, y0, x1, y1) in boxes.items():
    d = np.abs(np.diff(v[:, y0:y1, x0:x1], axis=0)).mean(axis=(1, 2))
    line = ''.join('#' if d[i:i + 5].max() > 3 else ':' if d[i:i + 5].max() > .8 else '.' for i in range(0, len(d), 5))
    print(f'{k:5s} {line}')
