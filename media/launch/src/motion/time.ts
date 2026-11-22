/* Timing in bars and beats (craft bible 2.2). At 60 fps pick a tempo whose beat is a whole number of frames:
   112.5 BPM = 32 f a beat (the bible's choice), 120 BPM = 30 f, 100 BPM = 36 f. Everything returns SECONDS on the frame
   grid, so a landing computed here falls exactly on a frame.

   What sits on the grid is the LANDING of a move, not its start: `grid.land(beat, frames)` is the start time of a move
   of that many frames that lands on that beat.

     const g = grid(film)              // film.bpm, film.fps, 4 beats a bar
     g.beat(3)                         // the 4th beat (beats count from 0)
     g.bar(2, 1)                       // bar 2, beat 1 (bars count from 0)
     g.f(24)                           // 24 frames, in seconds
     g.land(g.beat(4), 30)             // start a 30-frame move here so it lands on beat 4
     g.beats(1.5)                      // a duration of one and a half beats */

export interface Grid {
  bpm: number; fps: number; perBar: number;
  /** frames per beat (32 at 112.5 BPM and 60 fps) */
  framesPerBeat: number;
  /** the time of beat n (n may be fractional: 0.5 is the half beat) */
  beat(n: number): number;
  /** the time of bar `bar`, beat `beat` */
  bar(bar: number, beat?: number): number;
  /** a duration of n beats */
  beats(n: number): number;
  /** a duration of n bars */
  bars(n: number): number;
  /** n frames, in seconds */
  f(n: number): number;
  /** snap a time to the frame grid */
  snap(t: number): number;
  /** the start time of a move of `frames` frames (or seconds when `seconds` is set) that lands at `landing` */
  land(landing: number, frames: number): number;
  /** the beat index at or before t, and how far into it */
  at(t: number): { beat: number; bar: number; inBeat: number };
}

export function grid(o: { bpm: number; fps: number }, perBar = 4): Grid {
  const { bpm, fps } = o;
  const spb = 60 / bpm;
  const fpb = spb * fps;
  if (Math.abs(fpb - Math.round(fpb)) > 1e-6) console.warn('[film] ' + bpm + ' BPM is ' + fpb.toFixed(3) + ' frames a beat at ' + fps + ' fps: landings will not fall on whole frames');
  const snap = (t: number): number => Math.round(t * fps) / fps;
  return {
    bpm, fps, perBar, framesPerBeat: fpb,
    beat: (n) => snap(n * spb),
    bar: (b, n = 0) => snap((b * perBar + n) * spb),
    beats: (n) => snap(n * spb),
    bars: (n) => snap(n * perBar * spb),
    f: (n) => n / fps,
    snap,
    land: (landing, frames) => snap(landing - frames / fps),
    at: (t) => { const b = Math.floor(t / spb + 1e-9); return { beat: b, bar: Math.floor(b / perBar), inBeat: t - b * spb }; }
  };
}
