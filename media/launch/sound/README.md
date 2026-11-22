# boopis launch film: the sound

The film's music and effects, synthesised in code and synced to the picture's grid (112.5 BPM, 60 fps, 32 frames a
beat), mixed and mastered, with a measured sync audit. No samples, loops or downloaded sounds of any kind: every
sample is computed with numpy and scipy, so the licensing is clean.

## Regenerate everything (one command)

```sh
python3 media/launch/sound/build.py               # about 40 s, one process
python3 media/launch/sound/build.py --no-preview  # skip the two preview mp4s
python3 media/launch/sound/build.py --act-checks  # also mux the master's span of acts 1 and 4 under their renders
                                                  # (SC/renders/a1-sound.mp4, a4-sound.mp4), as short sync checks
```

It writes to `$FILM_SC/sound` (`FILM_SC` defaults to the team's shared folder, as for the renderer):

| File | What |
|---|---|
| `master.wav` | the 46.93 s master: stereo, 48 kHz, 24-bit PCM, -14 LUFS integrated, true peak at most -1.3 dBTP |
| `stems/master-music.wav`, `stems/master-sfx.wav` | music and effects, carrying the master's own gain curve: they sum to the master |
| `cut-15s.wav`, `bumper-6s.wav` (+ stems) | the 15 s cut and the 6 s bumper (`SC/script/cutdowns.md`), arranged for their length |
| `sync-audit.md` | every cue of the three cuts: its frame and where it measures in the delivered mix |
| `notes.md` | what the sound is, the loudness numbers, the timing assumptions, a listening checklist |
| `preview.mp4` | the master under the newest full-length render in `SC/renders` (muxed with `tools/render.mjs --mux`) |
| `preview-cues.mp4` | the master under a 60 fps board-o-matic of the storyboard's key frames, every cue labelled and flashed on its frame |
| `report.json` | the measurements as data |

The build is deterministic: every random source is seeded, so the same code gives the same samples.

## How it is made

| File | What |
|---|---|
| `timeline.py` | the grid (`at("12.1.5")`, `F(frame)`) and the **cue sheets** of the three cuts: one line per effect cue with its frame, its sound, its level, pan, spaces and its source in the script. Re-time a cue here. |
| `score.py` | the **music** as data on the grid (chords, keys, bass lines, drums, filter and level automation) and its renderer |
| `mix.py` | the effects bus (each cue, its room, plate, hall and echo sends), the ducking, and the **master** (bus EQ, glue, loudness, true-peak limiter as one gain curve shared by the stems) |
| `audit.py` | the **sync audit**: blind onset measurements in the master, in the effects stem and on each cue alone through the master's chain |
| `preview.py` | the board-o-matic and the mux |
| `analyze.py` | balance analysis used while mixing: `python3 -m sound.analyze film` (from `media/launch`) prints each part's loudness per section, every focal cue's margin over the bed, octave bands, phone and mono losses |
| `lib/dsp.py` | oscillators (band-limited saws), envelopes, filters (incl. a click-free swept biquad), synthetic stereo reverbs, echo, chorus, the limiter and compressor gain computers |
| `lib/voices.py` | every instrument and effect voice |
| `lib/meter.py` | ITU-R BS.1770-4 loudness and true peak, 24-bit WAV I/O, and ffmpeg's `ebur128` and `loudnorm` as the reference meters |

### The music

F major, 112.5 BPM. The four bots' notes (kai A4, nina C5, moss E5, vox G5) are the upper structure of Fmaj9, and
every chord the score passes through holds all four, so whenever bots talk to each other the room harmonises. The
arrangement follows the film's sections: the hook's open chord already sounding at frame 0; the room's felt kick and
walking sub; the fold resolving to F; the turn to D minor at the governed beat; the breath (the band thins, the pad's
filter opens for two bars instead of a riser); the drop on the terminal's Enter; the fall to a pedal for the approval;
one rising tone over silence for the 60-frame hold; the release chord; the stop as the wordmark's letters land, the
last chord ringing out under the end card. `score.py`'s docstring has the bar-by-bar plan.

### When the picture changes

Acts 1 and 4 are timed to the animation: the act builders (`src/acts/a1/`, `a4/`, the source of truth) checked frame
by frame on their renders; each of those cues keeps its old frame (`was`) and how its frame was found (`check`), and
`sync-audit.md` lists them. Acts 2 and 3 are still timed from the approved script and storyboard. When a scene is
animated, read its event times from its builder (presses bottom out on a frame, moves arrive on a frame, anything that
starts from nothing shows on the next frame), check the ones that matter on its render, change those cues' frames in
`timeline.py` (the music's grid events are in `score.py`) and rebuild: the audit then measures the new mix against the
new frames. A natural next step is for each beat builder to mark its sound moments on the film's timeline so
`timeline.py` can read them from the page.

### Rules the code keeps

- Every voice starts on its attack and ends on a fade; swept filters carry their state, so nothing clicks.
- Every cue sits on a whole frame; typing follows the motion library's K2 (`typeOn`): each character sounds on its
  first visible frame.
- The master is linear up to one gain curve, so the stems always sum to it.
- No sound carries meaning alone (the film is complete muted); the film lines (type) are deliberately silent.

## Credits

No code was copied from the skill repositories in the shared folder. The method (a cue sheet derived from the
picture's own timing, procedural synthesis, a measured sync audit, mixing by measurement) follows the `cuelab` skill
(MIT, endlessconflict).
