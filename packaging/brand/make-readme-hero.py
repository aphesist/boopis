#!/usr/bin/env python3
"""Make the README's hero: the boopis wordmark, animated, as two plain SVG files.

    packaging/brand/make-readme-hero.py [--out <dir>] [--check]

Writes `boopis-hero-on-light.svg` (the logo's dark ink, for a light page) and `boopis-hero-on-dark.svg` (the light ink, for a
dark page) into `.github/readme/`. `--check` writes nothing and fails when a file there is not what this would write.

GitHub shows an SVG in a README through `<img>`: no JavaScript, no external font or resource. So `boopis-logo.js` is ported
to what an image can run, CSS keyframes inside the file, and the wordmark is paths, never text.

What is taken from the brand, and not drawn here:
- The letters (b, p, i, s) are the paths of `design/v6/brand/logo/static/boopis-wordmark-{dark,light}-ink.svg`; the i's tittle
  is that path's second subpath. The only colour is the file's own `fill`, the logo's ink.
- The eyes are that file's two oval paths (the o's own box, a superellipse of exponent 2.4), with the points thinned and the
  curve refitted (the file has 64 segments per eye; 16 are within a fraction of a unit of it).

What is sampled from the real element (`<boopis-logo letters="play">` in Chromium) and written down below as data:
- the eyes' shapes for four gazes (the far eye narrows and the near one widens, as on the hidden sphere), as the translation
  and scale that take the resting oval to each (`POSES`);
- the `happy` state's eye shape (the arcs), thinned the same way (`HAPPY_EYE`);
- the playful letters' timing: a crouch, a hop with a 48 ms stagger along the word, a squash on landing, the tittle lagging,
  and the letters leaning with the gaze (3.85 degrees at a full glance).

The loop is one signature moment like the element's hero: eyes look right, then up and left, then down and right, blink, then
the happy arcs with the word bouncing, then one small hop of the b. It is for a README hero, a "site hero" in the logo's rules
(a big moment: the playful letters are allowed). With `prefers-reduced-motion` nothing moves: the resting eyes, as a still logo.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "design" / "v6" / "brand" / "logo" / "static"
OUT = ROOT / ".github" / "readme"

# the viewBox: the wordmark's own box, with room for the hop (92 units at most) and the lean
VIEW = (-1342, -962, 3491, 1327)
LOOP = 10.0  # seconds

# (translation x, y, scale x, y) of each eye from its resting oval, from `<boopis-logo>`'s own look(u, v) after it settled:
# bounding boxes (x, y, w, h) of the left and right eye, at rest and at each gaze. Lean is the letters' rotation, degrees.
REST = {"L": (-556.4, -539.2, 514.5, 548.9), "R": (41.9, -539.2, 514.5, 548.9)}
GAZES = {
    "right": {"L": (-539.8, -539.1, 532.7, 550.6), "R": (102.5, -529.7, 440.7, 545.9), "lean": 3.85},
    "upleft": {"L": (-547.4, -566.4, 457.4, 540.6), "R": (11.6, -574.6, 533.1, 539.0), "lean": -3.08},
    "downright": {"L": (-546.0, -498.1, 533.9, 548.8), "R": (87.2, -493.2, 461.3, 543.7), "lean": 3.08},
}

# the `happy` state's left eye (the right one is its mirror), sampled from the element and thinned (tolerance 2.5 units)
HAPPY_EYE = (
    "M-306 -472C-284 -473 -258 -467 -240 -462C-222 -458 -214 -454 -198 -445C-182 -435 -162 -423 -142 -405C-122 -387 -95 -354 -80 -336"
    "C-65 -318 -60 -311 -54 -297C-48 -283 -43 -267 -43 -252C-43 -237 -47 -220 -54 -207C-60 -194 -72 -181 -84 -172C-97 -164 -113 -158 -128 -156"
    "C-143 -155 -160 -157 -174 -163C-188 -168 -195 -173 -211 -190C-227 -206 -257 -247 -269 -261C-282 -275 -281 -272 -287 -275"
    "C-294 -279 -301 -283 -308 -283C-315 -283 -323 -278 -329 -275C-336 -271 -335 -275 -347 -260C-359 -246 -388 -205 -403 -188"
    "C-419 -172 -425 -167 -438 -161C-451 -156 -467 -153 -481 -155C-494 -156 -511 -165 -520 -170C-530 -175 -531 -175 -536 -184"
    "C-542 -194 -552 -210 -556 -224C-559 -238 -559 -254 -555 -269C-552 -283 -546 -293 -537 -309C-527 -325 -512 -347 -497 -364"
    "C-482 -381 -464 -400 -450 -412C-436 -425 -426 -431 -413 -439C-400 -447 -390 -453 -372 -459C-355 -464 -329 -472 -306 -472Z"
)

NUM = r"-?\d*\.?\d+(?:e-?\d+)?"


def fmt(v: float) -> str:
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def read_static(name: str) -> tuple[str, list[tuple[str, tuple[float, float]]]]:
    """The fill and the paths (data, translate) of a static wordmark file."""
    text = (STATIC / name).read_text(encoding="utf-8")
    fill = re.search(r'<svg[^>]*\sfill="(#[0-9a-fA-F]{6})"', text).group(1)
    paths = []
    for tag in re.findall(r"<path\b[^>]*>", text):
        move = re.search(r'transform="translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)"', tag)
        d = re.search(r'\sd="([^"]+)"', tag).group(1)
        paths.append((d, (float(move.group(1)), float(move.group(2))) if move else (0.0, 0.0)))
    if len(paths) != 6:
        raise SystemExit(f"{name}: expected 6 paths (b, two eyes, p, i, s), found {len(paths)}")
    return fill, paths


def end_points(d: str) -> list[tuple[float, float]]:
    """The end points of an `M ... C ... Z` path made of cubic segments (the eye files)."""
    toks = re.findall(r"[MCLZ]|" + NUM, d)
    pts, i = [], 0
    while i < len(toks):
        t = toks[i]
        if t == "M" or t == "L":
            pts.append((float(toks[i + 1]), float(toks[i + 2])))
            i += 3
        elif t == "C":
            pts.append((float(toks[i + 5]), float(toks[i + 6])))
            i += 7
        else:
            i += 1
    if pts and pts[0] == pts[-1]:
        pts.pop()
    return pts


def douglas(p: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(p) < 3:
        return p
    a, b = p[0], p[-1]
    span = math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
    best, at = 0.0, 0
    for k in range(1, len(p) - 1):
        x, y = p[k]
        dist = abs((b[0] - a[0]) * (a[1] - y) - (a[0] - x) * (b[1] - a[1])) / span
        if dist > best:
            best, at = dist, k
    if best > tol:
        return douglas(p[: at + 1], tol)[:-1] + douglas(p[at:], tol)
    return [a, b]


def thin_closed(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    far = max(range(len(pts)), key=lambda k: math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]))
    first = douglas(pts[: far + 1], tol)
    second = douglas(pts[far:] + [pts[0]], tol)
    return first[:-1] + second[:-1]


def smooth_closed(p: list[tuple[float, float]], cx: float, cy: float) -> str:
    """A closed Catmull-Rom curve through the points, as cubics, with the origin moved to (cx, cy)."""
    n = len(p)
    q = [(x - cx, y - cy) for x, y in p]
    out = [f"M{fmt(q[0][0])} {fmt(q[0][1])}"]
    for i in range(n):
        p0, p1, p2, p3 = q[i - 1], q[i], q[(i + 1) % n], q[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append("C" + " ".join(fmt(v) for v in (*c1, *c2, *p2)))
    return "".join(out) + "Z"


def move_path(d: str, dx: float, dy: float) -> str:
    """The same absolute path with its origin moved by (dx, dy); only the commands the eyes use (M, C, L, Z)."""
    out, nums, cmd = [], [], ""
    for t in re.findall(r"[MCLZ]|" + NUM, d):
        if t in "MCLZ":
            out.append(t)
            cmd = t
            nums = []
            continue
        nums.append(float(t))
        k = len(nums) - 1
        out.append(("" if len(out) and out[-1] in "MCLZ" else " ") + fmt(nums[-1] + (dx if k % 2 == 0 else dy)))
    return "".join(out)


def subpaths(d: str) -> list[str]:
    return ["M" + part for part in d.split("M")[1:]]


def bbox(d: str) -> tuple[float, float, float, float]:
    nums = [float(t) for t in re.findall(NUM, d)]
    # every number pair is a coordinate (the glyphs use absolute M, L, Q, C and Z only)
    xs, ys = nums[0::2], nums[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def pose(g: tuple, rest: tuple) -> tuple[float, float, float, float]:
    cx, cy = g[0] + g[2] / 2, g[1] + g[3] / 2
    rx, ry = rest[0] + rest[2] / 2, rest[1] + rest[3] / 2
    return cx - rx, cy - ry, g[2] / rest[2], g[3] / rest[3]


def tr(p: tuple[float, float, float, float]) -> str:
    return f"translate({fmt(p[0])}px,{fmt(p[1])}px) scale({p[2]:.3f},{p[3]:.3f})"


# ---------------------------------------------------------------------------------------------------- the animation ----


def pct(t: float) -> str:
    return fmt(round(t / LOOP * 100, 2)) + "%"


def keyframes(name: str, stops: list[tuple[float, str]]) -> str:
    """@keyframes from (seconds, declaration) stops, held between equal neighbours; the loop closes on its first stop."""
    body = "".join(f"{pct(t)}{{{decl}}}" for t, decl in stops)
    return f"@keyframes {name}{{{body}}}"


def build(fill: str, paths: list[tuple[str, tuple[float, float]]]) -> str:
    b, eye_l, _eye_r, p, i, s = paths
    # the eyes: one oval, drawn about its own centre, used twice (the right eye is the left one mirrored)
    pts = end_points(eye_l[0])
    x0, y0, x1, y1 = min(q[0] for q in pts), min(q[1] for q in pts), max(q[0] for q in pts), max(q[1] for q in pts)
    ecx, ecy = (x0 + x1) / 2, (y0 + y1) / 2
    oval = smooth_closed(thin_closed(pts, 0.5), ecx, ecy)
    happy = move_path(HAPPY_EYE, -ecx, -ecy)

    # the letters, each about the middle of its advance on the baseline, as the element's own pieces
    stem_d, dot_d = None, None
    for sub in subpaths(i[0]):
        lo, hi = bbox(sub)[1], bbox(sub)[3]
        if hi < -400:
            dot_d = sub
        else:
            stem_d = sub
    if not (stem_d and dot_d):
        raise SystemExit("the i is not a stem and a tittle")
    dot_box = bbox(dot_d)
    dot_cx, dot_cy = (dot_box[0] + dot_box[2]) / 2, (dot_box[1] + dot_box[3]) / 2

    # pivots as the element has them: b (-890), p (913.5), i (1332), s (1715.5); the glyph's origin is its path's translate
    pivots = {"b": -890.0, "p": 913.5, "i": 1332.0, "s": 1715.5}
    letters = {"b": b, "p": p, "i": i, "s": s}
    for k, (d, (tx, _)) in letters.items():
        want = pivots[k]
        lo, _, hi, _ = bbox(d)
        if abs((tx + lo) - (want - (hi - lo) / 2)) > 140:  # a sanity check on the pivot: the glyph is near its pivot
            raise SystemExit(f"the {k} is not where the logo's pieces put it")

    def piece(k: str, inner: str) -> str:
        tx = letters[k][1][0]
        return f'<g transform="translate({fmt(pivots[k])} 0)"><g class="l {k}"><g transform="translate({fmt(tx - pivots[k])} 0)">{inner}</g></g></g>'

    b_el = piece("b", f'<path d="{b[0]}"/>')
    p_el = piece("p", f'<path d="{p[0]}"/>')
    s_el = piece("s", f'<path d="{s[0]}"/>')
    # the i: the stem and the tittle, which hops on its own about its own middle
    i_inner = (
        f'<path d="{stem_d}"/>'
        f'<g transform="translate({fmt(dot_cx)} {fmt(dot_cy)})"><g class="t"><path transform="translate({fmt(-dot_cx)} {fmt(-dot_cy)})" d="{dot_d}"/></g></g>'
    )
    i_el = piece("i", i_inner)

    cl, cr = (ecx, ecy), (-ecx, ecy)

    def eye(side: str, mirror: bool) -> str:
        cx, cy = cl if side == "L" else cr
        flip = ' transform="scale(-1 1)"' if mirror else ""
        return (
            f'<g transform="translate({fmt(cx)} {fmt(cy)})"><g class="z{side.lower()}"><g class="k">'
            f'<use class="o" href="#o"{flip}/><use class="h" href="#h"{flip}/></g></g></g>'
        )

    # --- the gaze: where the eyes are, and how the letters lean, over the loop
    poses = {n: {side: pose(g[side], REST[side]) for side in "LR"} for n, g in GAZES.items()}
    rest_pose = (0.0, 0.0, 1.0, 1.0)
    timeline = [  # seconds, gaze name or None for the centre
        (0.0, None), (0.7, None), (1.1, "right"), (2.3, "right"), (2.7, "upleft"), (3.8, "upleft"),
        (4.2, "downright"), (4.9, "downright"), (5.3, None), (LOOP, None),
    ]
    css = []
    for side in "LR":
        stops = [(t, "transform:" + tr(rest_pose if n is None else poses[n][side])) for t, n in timeline]
        css.append(keyframes("g" + side, stops))
    lean = {None: 0.0, **{n: g["lean"] for n, g in GAZES.items()}}
    css.append(keyframes("lean", [(t, f"rotate:{fmt(lean[n])}deg") for t, n in timeline]))

    # --- blinks: the element's own 0.155 s; the eye closes to a lid a little wider than itself
    def blink_stops() -> list[tuple[float, str]]:
        shut = "transform:scale(1.15,.14)"
        open_ = "transform:scale(1,1)"
        stops = [(0.0, open_)]
        for t0 in (3.35, 5.45, 5.72, 8.75):
            stops += [(t0, open_), (t0 + 0.0775, shut), (t0 + 0.155, open_)]
        stops.append((LOOP, open_))
        return stops

    css.append(keyframes("blink", blink_stops()))

    # --- the happy arcs: the ovals cross-fade into them while the word bounces, and back (0.1 s)
    happy_in, happy_out = 5.85, 7.7
    css.append(keyframes("ovals", [(0.0, "opacity:1"), (happy_in, "opacity:1"), (happy_in + 0.1, "opacity:0"), (happy_out, "opacity:0"), (happy_out + 0.1, "opacity:1"), (LOOP, "opacity:1")]))
    css.append(keyframes("arcs", [(0.0, "opacity:0"), (happy_in, "opacity:0"), (happy_in + 0.1, "opacity:1"), (happy_out, "opacity:1"), (happy_out + 0.1, "opacity:0"), (LOOP, "opacity:0")]))

    # --- the bounce: crouch (a wide, flat squash), launch and stretch, land and squash, settle; the element's timings, with
    # the hop 88 units high (the logo allows 92). Every letter runs the same keyframes 48 ms after the one before it.
    t0 = 5.85
    hop = [
        (0.0, "translate:0 0;scale:1 1"), (t0, "translate:0 0;scale:1 1"),
        (t0 + 0.12, "translate:0 0;scale:1.14 .87"),   # anticipation: the crouch
        (t0 + 0.17, "translate:0 -34px;scale:.9 1.13"),  # leaves the ground, stretched
        (t0 + 0.30, "translate:0 -88px;scale:.91 1.09"),  # the top
        (t0 + 0.50, "translate:0 -34px;scale:.93 1.07"),
        (t0 + 0.62, "translate:0 0;scale:1.05 .95"),   # lands: squash
        (t0 + 0.72, "translate:0 0;scale:.98 1.02"),
        (t0 + 0.82, "translate:0 0;scale:1 1"), (LOOP, "translate:0 0;scale:1 1"),
    ]
    css.append(keyframes("hop", [(t, d) for t, d in hop]))
    # the b's own small hop, later, as the element's idle fidget does: the b's keyframes are the bounce and then this
    f0 = 8.1
    fidget = [
        (f0, "translate:0 0;scale:1 1"), (f0 + 0.08, "translate:0 0;scale:1.08 .92"),
        (f0 + 0.2, "translate:0 -60px;scale:.97 1.04"), (f0 + 0.36, "translate:0 0;scale:1.03 .97"), (f0 + 0.46, "translate:0 0;scale:1 1"),
    ]
    css.append(keyframes("hopb", hop[:-1] + fidget + [(LOOP, "translate:0 0;scale:1 1")]))
    # the tittle lags the stem, then bounces on its own (follow-through)
    css.append(keyframes("tittle", [
        (0.0, "translate:0 0"), (t0 + 0.1, "translate:0 0"), (t0 + 0.2, "translate:0 14px"), (t0 + 0.4, "translate:0 -34px"),
        (t0 + 0.58, "translate:0 8px"), (t0 + 0.7, "translate:0 -9px"), (t0 + 0.84, "translate:0 0"), (LOOP, "translate:0 0"),
    ]))

    rules = [
        "svg{--ink:" + fill + "}",
        "path{fill:var(--ink)}",
        ".l,.l>g,.t,.zl,.zr,.k{transform-origin:0 0}",
        ".zl{animation:gL 10s infinite ease-in-out}.zr{animation:gR 10s infinite ease-in-out}",
        ".k{animation:blink 10s infinite linear}",
        ".o{animation:ovals 10s infinite linear}.h{opacity:0;animation:arcs 10s infinite linear}",
        ".l{animation:lean 10s infinite ease-in-out,hop 10s infinite ease-in-out}",
        ".l.p{animation-delay:0s,.048s}.l.i{animation-delay:0s,.096s}.l.s{animation-delay:0s,.144s}",
        ".l.b{animation:lean 10s infinite ease-in-out,hopb 10s infinite ease-in-out}",
        ".t{animation:tittle 10s infinite ease-in-out .06s}",
        "@media (prefers-reduced-motion:reduce){*{animation:none!important}}",
    ]
    style = "".join(rules)
    keyframe_css = "".join(css)
    eyes = eye("L", False) + eye("R", True)
    vb = " ".join(str(v) for v in VIEW)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="boopis">'
        f"<title>boopis</title>"
        f"<style>{style}{keyframe_css}</style>"
        f'<defs><path id="o" d="{oval}"/><path id="h" d="{happy}"/></defs>'
        f"{b_el}{eyes}{p_el}{i_el}{s_el}</svg>\n"
    )


def files() -> dict[str, str]:
    out = {}
    for name, static in (("boopis-hero-on-light.svg", "boopis-wordmark-dark-ink.svg"), ("boopis-hero-on-dark.svg", "boopis-wordmark-light-ink.svg")):
        fill, paths = read_static(static)
        out[name] = build(fill, paths)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", action="store_true", help="make nothing; fail when the files in --out are not what this writes")
    args = ap.parse_args()
    stale = False
    for name, text in files().items():
        target = args.out / name
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != text:
                print(f"{target} is not what make-readme-hero.py writes", file=sys.stderr)
                stale = True
            continue
        args.out.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        print(f"wrote {target} ({len(text.encode())} bytes)")
    return 1 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
