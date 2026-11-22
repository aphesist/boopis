"""The preview: the master against picture.

If SC/renders holds a full-length render of the film (46.93 s), the master is muxed under the newest one. Until the
animatic exists, the picture is a board-o-matic: the approved storyboard key frames (SC/storyboard/board, variant b
of the end card), each held for its beat's span, with the timecode, bar.beat and beat on top and a label plus a
frame-exact marker for every cue at the bottom, so the sync can be judged by eye and ear. Either way the audio goes
under the picture with the engine's own mux step (media/launch/tools/render.mjs --mux: AAC 320k, 48 kHz).
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile

from .timeline import FILM, FPS

FFMPEG, FFPROBE = "/usr/bin/ffmpeg", "/usr/bin/ffprobe"
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)  # media/launch
FONT = "Inter"

TITLES = {"B01": "The hook", "B02": "The promise", "B03": "The cast", "B04": "The room: you ask once",
          "B05": "They hand work on", "B06": "They work it out", "B07": "The fold", "B08": "To your own session",
          "B09": "The cheaper one tries first", "B10": "A failed test buys the next rung", "B11": "The breath",
          "B12": "From a terminal", "B13": "The run, live in the room", "B14": "Same thread, other apps",
          "B15": "Nothing ships until you hold", "B16": "The hold", "B17": "The tagline",
          "B18": "The eyes become the wordmark", "B19": "The end card"}


def duration(path: str) -> float:
    return float(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                capture_output=True, text=True).stdout.strip() or 0)


def newest_film_render(sc: str) -> str | None:
    d = os.path.join(sc, "renders")
    if not os.path.isdir(d):
        return None
    cands = []
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if f.endswith(".mp4") and not f.endswith("-sound.mp4") and abs(duration(p) - FILM) < 0.1:
            cands.append((os.path.getmtime(p), p))
    return max(cands)[1] if cands else None


def _ts(t: float) -> str:
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _ass(beats: list, rows: list, w: int, h: int) -> str:
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Beat,{FONT},22,&H00EAF2F6,&H00EAF2F6,&H00000000,&H90000000,0,0,0,0,100,100,0,0,3,8,0,7,24,24,20,1
Style: Cue,{FONT},20,&H00EAF2F6,&H00EAF2F6,&H00000000,&H90000000,0,0,0,0,100,100,0,0,3,6,0,1,24,24,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    for b in beats:
        ev.append(f"Dialogue: 0,{_ts(b['start_s'])},{_ts(b['end_s'])},Beat,,0,0,0,,{b['id']} · {TITLES[b['id']]} · bar {b['bar']}")
    shown = set()
    for r in rows:
        if r["measure"] == "texture" and r["id"] in shown:
            continue
        label = r["group"] if r["group"] else r["label"]
        key = r["group"] or r["id"]
        if r["group"]:
            if key in shown:
                continue
            last = max(q["t"] for q in rows if q["group"] == key)
            ev.append(f"Dialogue: 1,{_ts(r['t'])},{_ts(last + 0.3)},Cue,,0,0,0,,{label}")
        else:
            ev.append(f"Dialogue: 1,{_ts(r['t'])},{_ts(r['t'] + 0.6)},Cue,,0,0,0,,{r['id']}  ·  {label}")
        shown.add(key)
    return head + "\n".join(ev) + "\n"


def boardomatic(sc: str, beats: list, rows: list, out: str, w: int = 1280, h: int = 720) -> None:
    board = os.path.join(sc, "storyboard", "board")
    inputs, filt = [], []
    for k, b in enumerate(beats):
        img = os.path.join(board, ("b19b" if b["id"] == "B19" else b["id"].lower()) + ".jpg")
        f0, f1 = int(round(b["start_s"] * FPS)), int(round(b["end_s"] * FPS))
        inputs += ["-loop", "1", "-framerate", str(FPS), "-t", f"{(f1 - f0) / FPS + 0.1:.4f}", "-i", img]
        filt.append(f"[{k}:v]scale={w}:{h}:flags=lanczos,setsar=1,format=yuv420p,trim=end_frame={f1 - f0},setpts=PTS-STARTPTS[v{k}]")
    hits = sorted({r["frame"] for r in rows if r["hit"]})
    marks = "+".join(f"between(n,{f},{f + 2})" for f in hits)
    with tempfile.TemporaryDirectory() as tmp:
        ass = os.path.join(tmp, "cues.ass")
        with open(ass, "w") as fh:
            fh.write(_ass(beats, rows, w, h))
        filt.append("".join(f"[v{k}]" for k in range(len(beats))) + f"concat=n={len(beats)}:v=1:a=0[cat]")
        filt.append(f"[cat]subtitles={ass}:fontsdir=/usr/share/fonts/opentype/inter,"
                    f"drawbox=x={w - 52}:y={h - 52}:w=28:h=28:color=0xF6F2EA@0.95:t=fill:enable='{marks}'[out]")
        script = os.path.join(tmp, "filter.txt")
        with open(script, "w") as fh:
            fh.write(";\n".join(filt))
        subprocess.run([FFMPEG, "-v", "error", "-y", *inputs, "-filter_complex_script", script, "-map", "[out]",
                        "-frames:v", str(int(round(FILM * FPS))), "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart", out], check=True)


def mux(video: str, wav: str, out: str) -> None:
    """The engine's own audio mux step."""
    subprocess.run(["node", os.path.join(ENGINE, "tools", "render.mjs"), "--mux", video, "--audio", wav, "--out", out],
                   check=True, cwd=ENGINE, capture_output=True)


ACTS = {"a1": (0.0, 9.6), "a4": (32.0, FILM)}   # the acts timed to the animation; a2, a3 join once they are


def act_checks(sc: str, master: str, acts=ACTS) -> list[dict]:
    """Short checks: the master's span of each act under that act's render (SC/renders/<act>-1080.mp4), muxed with
    the engine's step into SC/renders/<act>-sound.mp4."""
    out = []
    for act, (t0, t1) in acts.items():
        video = os.path.join(sc, "renders", f"{act}-1080.mp4")
        if not os.path.exists(video):
            continue
        dest = os.path.join(sc, "renders", f"{act}-sound.mp4")
        with tempfile.TemporaryDirectory(dir=os.path.dirname(master)) as tmp:
            span = os.path.join(tmp, f"{act}.wav")
            subprocess.run([FFMPEG, "-v", "error", "-y", "-i", master, "-ss", f"{t0:.6f}", "-t", f"{t1 - t0:.6f}",
                            "-c:a", "pcm_s24le", span], check=True)
            mux(video, span, dest)
        out.append({"act": act, "span": (t0, t1), "video": video, "out": dest})
    return out


def make(sc: str, outdir: str, rows: list, beats_path: str) -> dict:
    """preview-cues.mp4: the board-o-matic with every cue marked (always). preview.mp4: the master under the newest
    full-length film render, or the board-o-matic when there is none yet."""
    master = os.path.join(outdir, "master.wav")
    out, cues = os.path.join(outdir, "preview.mp4"), os.path.join(outdir, "preview-cues.mp4")
    with open(beats_path) as fh:
        beats = json.load(fh)
    with tempfile.TemporaryDirectory(dir=outdir) as tmp:
        silent = os.path.join(tmp, "boardomatic.mp4")
        boardomatic(sc, beats, rows, silent)
        mux(silent, master, cues)
    film = newest_film_render(sc)
    if film:
        mux(film, master, out)
        return {"picture": os.path.basename(film), "out": out, "cues": cues}
    os.replace(cues, out)
    return {"picture": "the board-o-matic", "out": out, "cues": out}
