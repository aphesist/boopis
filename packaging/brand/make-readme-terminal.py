#!/usr/bin/env python3
"""Make the README's terminal: a replay of the real installer, as one animated SVG.

    packaging/brand/make-readme-terminal.py [--out <dir>] [--check]

Writes `boopis-installer.svg` into `.github/readme/`. `--check` writes nothing and fails when the file there is not what this
would write, which is how it stays true: it is made from the installer's own sources, never drawn by hand.

- **The banner and the bots** are drawn by the installer's own renderer, `render.awk`, at truecolor, from `boopis.art`: the
  scene as printed, then each frame of its animation (their timings are the art file's). Every character the renderer prints
  (the quadrant blocks, a cell being 2 x 2 pixels, with the eye colour as the foreground over the bot's colour) is drawn as
  rectangles, so no font is involved and the pixels are exactly the blocks' pixels.
- **The words** are `scripts/install.sh`'s: the step labels, the label width, the bar's width, the box's lines and how it is
  sized. The generator reads them from the script and stops when one is gone or changed, so the replay cannot drift from it.
- **The colours** are the art file's palette (the ink, moss green for a check mark, terra for a warning) and the Graphite
  preset's tokens (`design/v6/tokens.css`) for the window and its text. No other colour.

The release in the replay is a real one (see `RELEASE`): its tag, its AppImage's size and its SHA-256 from `SHA256SUMS`.
Moving it to a newer release is changing those values and running this script again.

GitHub shows an SVG through `<img>`: no JavaScript, no external font. The text is the viewer's own monospace font, set at
absolute positions; the bar, the box and the banner are shapes. With `prefers-reduced-motion` nothing moves: the finished
screen is shown at once.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "packaging" / "brand"
INSTALL_SH = ROOT / "scripts" / "install.sh"
TOKENS = ROOT / "design" / "v6" / "tokens.css"
OUT = ROOT / ".github" / "readme"

# A real release: its tag, the AppImage's size in bytes (the release's asset list) and its line in SHA256SUMS.
RELEASE = {
    "tag": "v0.1.1",
    "artifact": "boopis_0.1.1_amd64.AppImage",
    "total_bytes": 179_935_736,
    "hash": "8194d93735f09f1e5fe9ab45bcc6e5ad894b5a3516e30d56a937b4394773e2bb",
    "platform": "linux x86_64",
}
COMMAND_URL = "https://raw.githubusercontent.com/aphesist/boopis/main/scripts/install.sh"

CW, CH = 8, 16  # a terminal cell in px; a pixel of the art is half a cell wide and half a cell tall
COLS = 84
PAD_X, TOP = 28, 44
LOOP = 20.0  # seconds
HOLD_UNTIL = 18.0  # the finished screen stays until here, then fades

QUADS = " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█"  # the renderer's q[0..15]: bit 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right


def token(name: str) -> str:
    """A custom property of the Graphite preset."""
    block = re.search(r'\[data-hx-preset="graphite"\]\s*\{(.*?)\n\}', TOKENS.read_text(encoding="utf-8"), re.S).group(1)
    return re.search(r"--" + re.escape(name) + r":\s*(#[0-9a-fA-F]{6})", block).group(1).lower()


# ------------------------------------------------------------------------------------------------------ the art ----


def art_text() -> str:
    return (BRAND / "boopis.art").read_text(encoding="utf-8")


def palette(art: str) -> dict[str, str]:
    return {m.group(1): m.group(2).lower() for m in re.finditer(r"^color (\S+) (#[0-9a-fA-F]{6})", art, re.M)}


def anim_frames(art: str) -> list[int]:
    """The banner's animation: the milliseconds of each frame, as the renderer waits before drawing it."""
    block = re.search(r"^anim banner\n(.*?)^end", art, re.M | re.S).group(1)
    return [int(m.group(1)) for m in re.finditer(r"^frame (\d+) ", block, re.M)]


def render(frame: int) -> list[str]:
    """What `render.awk` prints for the banner at truecolor: frame -1 is the scene as written."""
    out = subprocess.run(
        ["awk", "-v", "mode=truecolor", "-v", "scene=banner", "-v", f"frame={frame}", "-v", "indent=0", "-f", str(BRAND / "render.awk")],
        input=art_text(), capture_output=True, text=True, check=True,
    ).stdout
    return out.split("\n")[:-1] if out.endswith("\n") else out.split("\n")


Pix = dict[tuple[int, int], str]  # (pixel x, pixel y) -> colour


def pixels(lines: list[str], ink: str) -> Pix:
    """The ANSI lines as pixels: each cell is 2 x 2, the background fills it, the foreground draws the block's quadrants."""
    pix: Pix = {}
    for row, line in enumerate(lines):
        fg: str | None = None
        bg: str | None = None
        col = 0
        i = 0
        while i < len(line):
            if line[i] == "\x1b":
                end = line.index("m", i)
                nums = line[i + 2 : end].split(";")
                k = 0
                while k < len(nums):
                    n = int(nums[k] or 0)
                    if n == 0:
                        fg = bg = None
                        k += 1
                    elif n in (38, 48) and nums[k + 1] == "2":
                        rgb = "#%02x%02x%02x" % tuple(int(v) for v in nums[k + 2 : k + 5])
                        if n == 38:
                            fg = rgb
                        else:
                            bg = rgb
                        k += 5
                    else:
                        raise SystemExit(f"render.awk printed an SGR code this generator does not read: {nums[k]}")
                i = end + 1
                continue
            ch = line[i]
            i += 1
            mask = QUADS.index(ch)
            if bg:
                for q in range(4):
                    pix[(col * 2 + q % 2, row * 2 + q // 2)] = bg
            for q in range(4):
                if mask & (1 << q):
                    pix[(col * 2 + q % 2, row * 2 + q // 2)] = fg or ink
            col += 1
    return pix


def rects(pix: Pix) -> dict[str, str]:
    """One path per colour: runs along x, merged downwards when the same run repeats on the next row (a pixel is CW/2 x CH/2)."""
    px, py = CW // 2, CH // 2
    runs: dict[str, dict[tuple[int, int], list[int]]] = {}
    by_row: dict[tuple[str, int], list[int]] = {}
    for (x, y), c in pix.items():
        by_row.setdefault((c, y), []).append(x)
    for (c, y), xs in by_row.items():
        xs.sort()
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            runs.setdefault(c, {})[(start, prev - start + 1)] = runs.get(c, {}).get((start, prev - start + 1), []) + [y]
            if x is not None:
                start = prev = x
    out = {}
    for c, spans in runs.items():
        d = []
        for (x, w), ys in sorted(spans.items()):
            ys.sort()
            top = prev_y = ys[0]
            for y in ys[1:] + [None]:
                if y is not None and y == prev_y + 1:
                    prev_y = y
                    continue
                d.append(f"M{x * px} {top * py}h{w * px}v{(prev_y - top + 1) * py}h{-w * px}z")
                if y is not None:
                    top = prev_y = y
        out[c] = "".join(d)
    return out


# ------------------------------------------------------------------------------------------------ the installer ----


def installer_words() -> dict[str, object]:
    """What install.sh says, read from it. A change to any of it stops the generator, so the replay is rebuilt on purpose."""
    sh = INSTALL_SH.read_text(encoding="utf-8")

    def need(pattern: str) -> re.Match[str]:
        m = re.search(pattern, sh)
        if not m:
            raise SystemExit(f"scripts/install.sh no longer has {pattern!r}: update make-readme-terminal.py to its new wording")
        return m

    for label in ("Platform", "Release", "Downloaded", "Verified", "Installed", "Registered"):
        need(r"step_ok " + label + r"\b")
    need(r"Downloading")
    label_width = int(need(r"%-13s").group(0)[2:-1])
    bar_width = int(need(r"local pct=\$1 width=(\d+)").group(1))
    box = [
        need(r'lines\+=\("" "\$APP is ready" ""\)').group(0),
        need(r'lines\+=\("(Start it {4})\$START_HINT"\)').group(1),
        need(r'linux\) lines\+=\("( +)or open \$APP from your app menu"\)').group(1),
        need(r'lines\+=\("(Remove it {3})\$UNINSTALL_HINT"\)').group(1),
    ]
    need(r"width=\$\(\(width \+ 2\)\)")
    registered = need(r"\$\(\[ \"\$OS\" = linux \] && printf '([^']+)'").group(1)
    uninstall = need(r'UNINSTALL_HINT="bash \$\(tilde "\$PREFIX/share/\$APP/uninstall.sh"\)"').group(0)
    if not re.search(r"^APP=boopis$", sh, re.M):
        raise SystemExit("scripts/install.sh no longer sets APP=boopis")
    return {
        "label_width": label_width,
        "bar_width": bar_width,
        "start": box[1],
        "open": box[2],
        "remove": box[3],
        "registered": registered,
        "uninstall": uninstall,
    }


def human_size(b: int) -> str:
    tenths = b * 10 // 1048576
    return f"{tenths // 10}.{tenths % 10} MB"


def short_hash(h: str) -> str:
    return h[:12] + "…" + h[-6:]


# ---------------------------------------------------------------------------------------------------------- build ----


class Scene:
    """Elements with the seconds they are visible in, and the CSS that does it."""

    def __init__(self) -> None:
        self.body: list[str] = []
        self.kf: dict[tuple, str] = {}
        self.rules: list[str] = []

    def reveal(self, t_on: float, t_off: float | None, transient: bool) -> str:
        """The class of an element shown from t_on to t_off (None: the end of the hold). A transient element is hidden without animation."""
        key = (round(t_on, 3), None if t_off is None else round(t_off, 3), transient)
        if key not in self.kf:
            name = f"v{len(self.kf)}"
            self.kf[key] = name
            a = pct(t_on)
            hold = pct(HOLD_UNTIL)
            if transient:
                off = pct(t_off if t_off is not None else HOLD_UNTIL)
                css = f"@keyframes {name}{{0%,{a}{{opacity:0}}{pct(t_on + 0.001)},{off}{{opacity:1}}{pct((t_off or HOLD_UNTIL) + 0.001)},100%{{opacity:0}}}}"
                self.rules.append(f".{name}{{opacity:0;animation:{name} {LOOP:g}s infinite linear}}")
            else:
                css = f"@keyframes {name}{{0%,{a}{{opacity:0}}{pct(t_on + 0.001)},100%{{opacity:1}}}}"
                self.rules.append(f".{name}{{animation:{name} {LOOP:g}s infinite linear}}")
            self.rules.append(css)
        return self.kf[key]


def pct(t: float) -> str:
    s = f"{t / LOOP * 100:.3f}".rstrip("0").rstrip(".")
    return s + "%"


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build() -> str:
    art = art_text()
    pal = palette(art)
    words = installer_words()
    bg_win, bg_bar = token("bg-1"), token("bg-3")
    text, strong, dim, faint = token("text"), token("text-strong"), token("text-quiet"), token("text-faint")
    hairline = token("bg-4")
    moss = pal["moss"]
    ink = strong  # the wordmark takes the terminal's own foreground: on this window, the lightest ink
    width = COLS * CW + 2 * PAD_X

    sc = Scene()

    def cx(col: float) -> float:
        return PAD_X + col * CW

    def ry(row: float) -> float:
        return TOP + row * CH

    def line(row: int, segs: list[tuple[str, str]], col0: int = 0) -> str:
        """A line of text: each segment (class, string) at its own absolute column, so the font's own advance cannot shift the next."""
        out, col = [], col0
        for cls, s in segs:
            if s.strip():
                out.append(f'<tspan x="{cx(col)}" class="{cls}">{esc(s)}</tspan>')
            col += len(s)
        return f'<text y="{ry(row) + 12}">{"".join(out)}</text>'

    parts: list[str] = []

    # --- the command, typed, then "run"
    cmd1, cmd2 = "curl -fsSL \\", "    " + COMMAND_URL + " | bash"
    t = 0.3
    typed = []
    for row, s in ((0, cmd1), (1, cmd2)):
        n = len(s) if row == 0 else len(s) - 4
        dur = max(0.3, n / 80)
        typed.append((row, s, t, t + dur))
        t += dur + 0.1
    enter_at = t + 0.3
    for row, s, a, b in typed:
        prefix = [("d", "$ ")] if row == 0 else [("d", "  ")]
        parts.append(line(row, prefix + [("t", s)]))
        # the cover: the window's colour over the part not typed yet; a cursor on its edge; both leave when the line is done
        name = f"ty{row}"
        x0 = cx(2 + (0 if row == 0 else 4))
        w_text = (len(s) - (0 if row == 0 else 4)) * CW
        steps = len(s) - (0 if row == 0 else 4)
        sc.rules.append(
            f"@keyframes {name}{{0%,{pct(a)}{{opacity:1;transform:translateX(0)}}{pct(b)}{{opacity:1;transform:translateX({w_text}px)}}"
            f"{pct(b + 0.25)}{{opacity:0;transform:translateX({w_text}px)}}100%{{opacity:0;transform:translateX({w_text}px)}}}}"
            f".{name}{{opacity:0;animation:{name} {LOOP:g}s infinite steps({steps},end)}}"
        )
        parts.append(
            f'<g class="{name}"><rect x="{x0}" y="{ry(row)}" width="{w_text + 2 * CW}" height="{CH}" fill="{bg_win}"/>'
            f'<rect x="{x0}" y="{ry(row) + 2}" width="{CW}" height="{CH - 4}" fill="{text}"/></g>'
        )
    # --- the banner and the bots
    banner_at = enter_at + 0.4
    base = render(-1)
    base_pix = pixels(base, ink)
    banner_row = 3
    ox, oy = cx(2), ry(banner_row)

    def layer(pix: Pix, cls: str) -> str:
        shapes = "".join(f'<path fill="{c}" d="{d}"/>' for c, d in sorted(rects(pix).items()))
        return f'<g class="{cls}" transform="translate({ox} {oy})" shape-rendering="crispEdges">{shapes}</g>'

    parts.append(layer(base_pix, sc.reveal(banner_at, None, False)))
    frames = anim_frames(art)
    at = banner_at
    shown = set()
    for f, ms in enumerate(frames):
        at += ms / 1000
        end = at + (frames[f + 1] / 1000 if f + 1 < len(frames) else 0.0)
        pix = pixels(render(f), ink)
        delta: Pix = {}
        for k in set(pix) | set(base_pix):
            if pix.get(k) != base_pix.get(k):
                delta[k] = pix.get(k, bg_win)
        if delta and end > at:
            parts.append(layer(delta, sc.reveal(at, end, True)))
            shown.add(f)
    banner_done = banner_at + sum(frames) / 1000 + 0.35

    # --- the steps, as install.sh prints them
    lw = int(words["label_width"])
    steps_row = banner_row + 15

    def step(row: int, label: str, detail: str, t_on: float, mark: str = "✓", mark_cls: str = "g") -> str:
        cls = sc.reveal(t_on, None, False)
        return f'<g class="{cls}">' + line(row, [("t", "  "), (mark_cls, mark), ("t", " "), ("t", label.ljust(lw)), ("t", " "), ("t", detail)]) + "</g>"

    t = banner_done
    parts.append(step(steps_row, "Platform", str(RELEASE["platform"]), t))
    t += 0.45
    parts.append(step(steps_row + 1, "Release", str(RELEASE["tag"]), t))
    t += 0.45
    # the download: a bar that fills (28 cells), then the finished line
    bw = int(words["bar_width"])
    total = int(RELEASE["total_bytes"])
    stages = [0, 9, 21, 34, 48, 63, 77, 90, 100]
    dl_row = steps_row + 2
    for k, p in enumerate(stages):
        on = t + k * 0.32
        off = t + (k + 1) * 0.32
        fill = p * bw // 100
        # "  · Downloading " then the bar, " 63%  " and the sizes
        have = total * p // 100
        txt = line(dl_row, [("t", "  "), ("d", "·"), ("t", " "), ("t", "Downloading".ljust(lw)), ("t", " ")])
        bar_col = 2 + 1 + 1 + lw + 1
        bar = (
            f'<rect x="{cx(bar_col)}" y="{ry(dl_row) + 1}" width="{fill * CW}" height="{CH - 2}" fill="{strong}"/>'
            f'<rect x="{cx(bar_col + fill)}" y="{ry(dl_row) + 1}" width="{(bw - fill) * CW}" height="{CH - 2}" fill="{faint}"/>'
        )
        tail = line(dl_row, [("t", f"{p:3d}%  {human_size(have)} of {human_size(total)}")], col0=bar_col + bw + 1)
        parts.append(f'<g class="{sc.reveal(on, off, True)}">{txt}{bar}{tail}</g>')
    t += len(stages) * 0.32
    parts.append(step(dl_row, "Downloaded", f"{RELEASE['artifact']} ({human_size(total)})", t))
    t += 0.5
    parts.append(step(steps_row + 3, "Verified", "sha256 " + short_hash(str(RELEASE["hash"])), t))
    t += 0.5
    parts.append(step(steps_row + 4, "Installed", "~/.local/share/boopis", t))
    t += 0.5
    parts.append(step(steps_row + 5, "Registered", str(words["registered"]), t))
    t += 0.7

    # --- the box, sized as install.sh sizes it: the longest line plus two, one blank line on each side of the title
    start, open_, remove = str(words["start"]), str(words["open"]), str(words["remove"])
    lines_ = [
        "",
        "boopis is ready",
        "",
        start + "boopis",
        open_ + "or open boopis from your app menu",
        remove + "bash ~/.local/share/boopis/uninstall.sh",
        "",
    ]
    bwid = max(len(s) for s in lines_) + 2
    top = steps_row + 7
    cls = sc.reveal(t, None, False)
    shape = (
        f'<rect x="{cx(2.5)}" y="{ry(top) + CH / 2}" width="{(bwid + 1) * CW}" height="{(len(lines_) + 1) * CH}" rx="9" '
        f'fill="none" stroke="{dim}" stroke-opacity=".55" stroke-width="1.2"/>'
    )
    inner = [shape]
    for k, s in enumerate(lines_):
        if not s:
            continue
        cl = "s" if k == 1 else "t"
        inner.append(line(top + 1 + k, [(cl, s)], col0=4))
    parts.append(f'<g class="{cls}">{"".join(inner)}</g>')
    rows = top + len(lines_) + 2
    height = TOP + rows * CH + 20

    css = [
        f"text{{font:13px ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace;fill:{text};white-space:pre}}",
        f".t{{fill:{text}}}.s{{fill:{strong};font-weight:700}}.d{{fill:{dim}}}.g{{fill:{moss}}}",
        f"@keyframes scene{{0%{{opacity:0}}1.5%,{pct(HOLD_UNTIL)}{{opacity:1}}{pct(HOLD_UNTIL + 0.7)},100%{{opacity:0}}}}",
        f".scene{{animation:scene {LOOP:g}s infinite linear}}",
        *sc.rules,
        "@media (prefers-reduced-motion:reduce){*{animation:none!important}}",
    ]
    chrome = (
        f'<rect width="{width}" height="{height}" rx="14" fill="{bg_win}"/>'
        f'<rect x=".5" y=".5" width="{width - 1}" height="{height - 1}" rx="13.5" fill="none" stroke="{hairline}"/>'
        f'<path d="M0 14a14 14 0 0 1 14-14h{width - 28}a14 14 0 0 1 14 14v20h-{width}z" fill="{bg_bar}"/>'
        + "".join(f'<circle cx="{22 + 18 * k}" cy="17" r="5" fill="{faint}"/>' for k in range(3))
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="A terminal running the boopis installer: the banner, a download, a checked hash, and a box that says boopis is ready.">'
        f"<title>The boopis installer, replayed</title>"
        f"<style>{''.join(css)}</style>{chrome}"
        f'<g class="scene">{"".join(parts)}</g></svg>\n'
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", action="store_true", help="make nothing; fail when the file in --out is not what this writes")
    args = ap.parse_args()
    text = build()
    target = args.out / "boopis-installer.svg"
    if args.check:
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            print(f"{target} is not what make-readme-terminal.py writes", file=sys.stderr)
            return 1
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(f"wrote {target} ({len(text.encode())} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
