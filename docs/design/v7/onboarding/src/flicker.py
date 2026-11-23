"""Frame-by-frame check of a clip: flags flicker (a frame that differs from both neighbours while they agree: A-B-A),
and cuts (a single-frame change much larger than the clip's typical motion). Prints one line per clip."""
import subprocess, sys
import numpy as np
W, H = 320, 200
for path in sys.argv[1:]:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
    d = np.abs(np.diff(f, axis=0)).mean(axis=(1, 2))
    flick = []
    for i in range(1, len(f) - 1):
        a, b = np.abs(f[i] - f[i - 1]).mean(), np.abs(f[i + 1] - f[i - 1]).mean()
        if a > 1.5 and b < a * 0.25:
            flick.append((i, round(float(a), 2), round(float(b), 2)))
    cuts = [(i + 1, round(float(x), 2)) for i, x in enumerate(d) if x > 6]
    print(f'{path.split("/")[-1]}: {len(f)} frames, mean change {d.mean():.2f}, max {d.max():.2f} at frame {int(d.argmax()) + 1}; flicker {flick or "none"}; cuts over 6 {cuts or "none"}')
