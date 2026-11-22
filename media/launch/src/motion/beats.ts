/* The script's timeline, read from beats.json (the scriptwriter's data: SC/script/beats.json, or the snapshot in
   media/launch/script/ when the shared folder is not there; vite.config.ts picks). Nothing here is typed by hand: a
   scene asks for its beat by id and gets its times, its bar range, its words and its hand-off.

     import { beat, at, BEATS, FILM_DURATION } from '../motion/beats'
     const b = beat('B03')          // { id, start, end, dur, bar, words, picture, carry_out, sound, ... }
     at('5.3')                      // 9.6: bar 5, beat 3 (bars and beats count from 1.1 = 0 s; '.5' is a half-beat)
     at('3.2.5')                    // 5.067
     span('2.2-3.2.5')              // [2.667, 5.067]
     beatsIn('B05')                 // the grid times of every beat inside B05

   Times are seconds on the 60 fps frame grid at the script's tempo (112.5 BPM: 32 f a beat, 128 f a bar). `check()`
   reports any beat whose start_s/end_s disagree with its bar string. */
import data from '@script/beats.json';

export interface ScriptBeat {
  id: string; start_s: number; end_s: number; bar: string; picture: string; words: string[];
  carry_out?: string; sound?: string; truth_rows?: string[];
}
export interface Beat extends ScriptBeat { start: number; end: number; dur: number; from: number; to: number }

export const BPM = 112.5;
export const FPS = 60;
export const PER_BAR = 4;
const SPB = 60 / BPM;
const snap = (t: number): number => Math.round(t * FPS) / FPS;

/** '5.3' -> 9.6 s; '3.2.5' -> bar 3, beat 2.5 (a half-beat) */
export function at(barBeat: string): number {
  const m = /^(\d+)\.(\d+(?:\.5)?)$/.exec(barBeat.trim());
  if (!m) throw new Error('beats: "' + barBeat + '" is not bar.beat (e.g. 5.3 or 3.2.5)');
  const bar = Number(m[1]), b = Number(m[2]);
  return snap(((bar - 1) * PER_BAR + (b - 1)) * SPB);
}
/** '2.2-3.2.5' -> [2.667, 5.067] */
export function span(range: string): [number, number] {
  const [a, b] = range.split('-');
  if (!a || !b) throw new Error('beats: "' + range + '" is not a bar range');
  return [at(a), at(b)];
}

export const BEATS: Beat[] = (data as ScriptBeat[]).map((b) => {
  const [from, to] = span(b.bar);
  return { ...b, start: snap(b.start_s), end: snap(b.end_s), dur: snap(b.end_s - b.start_s), from, to };
});
export const FILM_DURATION = BEATS.length ? BEATS[BEATS.length - 1]!.end : 0;

export function beat(id: string): Beat {
  const b = BEATS.find((x) => x.id === id);
  if (!b) throw new Error('beats: no beat ' + id + ' (have ' + BEATS.map((x) => x.id).join(', ') + ')');
  return b;
}
/** the grid times of every beat (or half-beat with step 0.5) from a beat's start to its end */
export function beatsIn(id: string, step = 1): number[] {
  const b = beat(id), out: number[] = [];
  for (let n = Math.ceil(b.start / SPB / step - 1e-6) * step; n * SPB <= b.end + 1e-6; n += step) out.push(snap(n * SPB));
  return out;
}
/** beats whose times disagree with their bar strings, or that leave gaps or overlaps (empty when the data is clean) */
export function check(): string[] {
  const out: string[] = [];
  BEATS.forEach((b, i) => {
    if (Math.abs(b.from - b.start) > 0.5 / FPS) out.push(b.id + ': start_s ' + b.start_s + ' but bar ' + b.bar + ' starts at ' + b.from.toFixed(3));
    if (Math.abs(b.to - b.end) > 0.5 / FPS) out.push(b.id + ': end_s ' + b.end_s + ' but bar ' + b.bar + ' ends at ' + b.to.toFixed(3));
    const next = BEATS[i + 1];
    if (next && Math.abs(next.start - b.end) > 0.5 / FPS) out.push(b.id + ' ends at ' + b.end + ' but ' + next.id + ' starts at ' + next.start);
  });
  return out;
}
