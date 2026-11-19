#!/usr/bin/env python3
"""Make the two bitmaps of the Windows installer from the logo's own files.

    packaging/brand/make-installer-images.py [--out <dir>] [--check]

Writes `nsis-header.bmp` (150 x 57, the strip across the top of every installer page) and `nsis-sidebar.bmp` (164 x 314,
the welcome and finish pages) into `apps/desktop/src-tauri/icons/installer/`, which `bundle.windows.nsis` in
`tauri.conf.json` points at. `--check` makes nothing and fails when a file there is not what this would write.

Nothing here is drawn by hand. The shapes are `design/v6/brand/logo/static/boopis-wordmark-{dark,light}-ink.svg`, the
logo's static files (path data only: lines, quadratic and cubic curves), filled the way an SVG renderer fills them. The
only colours are the logo's two inks, read from those files' `fill`: the dark ink `#0f0e0c` and the light ink `#ffffff`,
which is also how the app icon is made (design-system section 12.1: a tile of one ink, the mark in the other).

- **Header:** the wordmark in the dark ink on the light ink. The installer's pages are white, so the strip has no edge.
- **Sidebar:** the wordmark in the light ink on the dark ink, the dark twin of the app icon.
- **The wordmark alone** (the lockup rule): no tagline, no second mark, no effect. It is placed by its viewBox, which already
  holds the protection area (0.28 of the type size on every side), and set at a type size of 30 px (header) and 44 px
  (sidebar), both over the 20 px minimum. Edges are anti-aliased by 8x supersampling.

Needs Pillow. NSIS wants 24-bit BMP files, which is what Pillow writes for an RGB image."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "design" / "v6" / "brand" / "logo" / "static"
OUT = ROOT / "apps" / "desktop" / "src-tauri" / "icons" / "installer"
SS = 8  # supersampling
UNITS_PER_EM = 1000  # the logo's type size is 1000 units (a mark of width W has a type size of W / 1.156)
CURVE_STEPS = 24

TOKEN = re.compile(r"[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?")


def svg(name: str) -> tuple[tuple[float, float, float, float], str, list[tuple[str, float, float]]]:
    """The viewBox, the fill and the paths (data and `translate`, the only transform the files use) of a static file."""
    text = (STATIC / name).read_text(encoding="utf-8")
    box = tuple(float(v) for v in re.search(r'viewBox="([^"]+)"', text).group(1).split())
    fill = re.search(r'<svg[^>]*\sfill="(#[0-9a-fA-F]{6})"', text).group(1)
    paths = []
    for tag in re.findall(r"<path\b[^>]*>", text):
        move = re.search(r'transform="translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)"', tag)
        if 'transform="' in tag and not move:
            raise SystemExit(f"{name}: a transform other than translate: {tag[:80]}")
        paths.append((re.search(r'\sd="([^"]+)"', tag).group(1), *(map(float, move.groups()) if move else (0.0, 0.0))))
    return box, fill, paths


def subpaths(d: str) -> list[list[tuple[float, float]]]:
    """Flatten absolute M, L, Q, C and Z commands into polygons (one per subpath)."""
    tokens = TOKEN.findall(d)
    out: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    i, cmd, pt = 0, "", (0.0, 0.0)

    def num(n: int) -> list[float]:
        nonlocal i
        vals = [float(tokens[i + k]) for k in range(n)]
        i += n
        return vals

    while i < len(tokens):
        if tokens[i] in "MLQCZ":
            cmd = tokens[i]
            i += 1
            if cmd == "Z":
                if cur:
                    out.append(cur)
                cur = []
                continue
        if cmd == "M":
            if cur:
                out.append(cur)
            pt = tuple(num(2))  # type: ignore[assignment]
            cur = [pt]
            cmd = "L"  # further pairs after a move are lines
        elif cmd == "L":
            pt = tuple(num(2))  # type: ignore[assignment]
            cur.append(pt)
        elif cmd == "Q":
            cx, cy, x, y = num(4)
            for s in range(1, CURVE_STEPS + 1):
                t = s / CURVE_STEPS
                u = 1 - t
                cur.append((u * u * pt[0] + 2 * u * t * cx + t * t * x, u * u * pt[1] + 2 * u * t * cy + t * t * y))
            pt = (x, y)
        elif cmd == "C":
            x1, y1, x2, y2, x, y = num(6)
            for s in range(1, CURVE_STEPS + 1):
                t = s / CURVE_STEPS
                u = 1 - t
                cur.append((
                    u**3 * pt[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x,
                    u**3 * pt[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y,
                ))
            pt = (x, y)
        else:
            raise SystemExit(f"unexpected path data near token {tokens[i]!r}")
    if cur:
        out.append(cur)
    return out


def hex_rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def make(size: tuple[int, int], type_size: float, ink_file: str, ground_file: str) -> Image.Image:
    """The wordmark of `ink_file` at `type_size` px, centred, on the ink of `ground_file`."""
    box, ink, paths = svg(ink_file)
    _, ground, _ = svg(ground_file)
    scale = type_size / UNITS_PER_EM * SS  # supersampled pixels per unit
    width, height = size[0] * SS, size[1] * SS
    # the viewBox is centred on the image: its own protection area is the margin around the letters
    ox = (width - box[2] * scale) / 2 - box[0] * scale
    oy = (height - box[3] * scale) / 2 - box[1] * scale
    mask = Image.new("L", (width, height), 0)
    for d, tx, ty in paths:
        # even-odd, so a counter (the b's, the p's) is a hole: each subpath toggles the mask
        for poly in subpaths(d):
            layer = Image.new("L", (width, height), 0)
            ImageDraw.Draw(layer).polygon([((x + tx) * scale + ox, (y + ty) * scale + oy) for x, y in poly], fill=255)
            mask = ImageChops.difference(mask, layer)
    mask = mask.resize(size, Image.Resampling.LANCZOS)
    image = Image.new("RGB", size, hex_rgb(ground))
    image.paste(Image.new("RGB", size, hex_rgb(ink)), (0, 0), mask)
    return image


def images() -> dict[str, Image.Image]:
    return {
        # dark ink on the light ink: the installer's pages are white
        "nsis-header.bmp": make((150, 57), 30, "boopis-wordmark-dark-ink.svg", "boopis-wordmark-light-ink.svg"),
        # light ink on the dark ink: the dark app icon's pairing
        "nsis-sidebar.bmp": make((164, 314), 44, "boopis-wordmark-light-ink.svg", "boopis-wordmark-dark-ink.svg"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", action="store_true", help="make nothing; fail when the files in --out are not what this writes")
    args = ap.parse_args()
    stale = False
    for name, image in images().items():
        target = args.out / name
        if args.check:
            if not target.is_file() or Image.open(target).convert("RGB").tobytes() != image.tobytes():
                print(f"{target} is not what make-installer-images.py writes", file=sys.stderr)
                stale = True
            continue
        args.out.mkdir(parents=True, exist_ok=True)
        image.save(target, format="BMP")
        print(f"wrote {target} ({image.width}x{image.height})")
    return 1 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
