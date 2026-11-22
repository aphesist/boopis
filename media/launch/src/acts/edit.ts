/* Edits: which beats play when. The master plays every beat at its script time (beats.json). A cut-down plays some
   beats, re-timed, in windows of its own (SC/script/cutdowns.md). A beat builder never types a time: it asks the edit
   for its window (`ctx.win('B05')`), so the same builder serves the master and a cut.

   In the master a window IS the script's absolute time (beat('B05').start); the coordinator's rule "each builder
   writes at the script's absolute times" holds, through `ctx.win`. */
import { BEATS, FILM_DURATION, beat } from '../motion/beats';

export interface Window { start: number; end: number; dur: number }
export interface Edit {
  id: string;
  duration: number;
  /** each source beat's window on this edit's clock, in play order; a cut may give one beat several windows' worth of
      story (its builder reads `dur` and compresses) */
  windows: { beat: string; win: Window; note?: string }[];
}
const w = (start: number, end: number): Window => ({ start, end, dur: end - start });

export const MASTER: Edit = {
  id: 'master',
  duration: FILM_DURATION,
  windows: BEATS.map((b) => ({ beat: b.id, win: w(b.start, b.end) }))
};

/* The 15 s cut (cutdowns.md section 3), with the owner's end card (b): no address anywhere (decisions.md 2).
   C1 is B01 unchanged; C2 runs B02 and B03 compressed; C3 the room (B04 into B05's reply); C4 the huddle and the fold
   (B06, B07); C5 the push into nina's orb in the folded stack into the wordmark (B18's move); C6 the end card (B19b). */
export const CUT15: Edit = {
  id: 'cut15',
  duration: 14.933,
  windows: [
    { beat: 'B01', win: w(0, 2.667), note: 'C1: master B01, unchanged' },
    { beat: 'B02', win: w(2.667, 3.467), note: 'C2: the buttons fan out of the eye' },
    { beat: 'B03', win: w(3.467, 5.067), note: 'C2: straight into the cast cards; eyes open on sixteenths; collapse into orbs' },
    { beat: 'B04', win: w(5.067, 6.4), note: 'C3: the room, the line types, send' },
    { beat: 'B05', win: w(6.4, 7.467), note: "C3: kai's reply lands whole" },
    { beat: 'B06', win: w(7.467, 8.8), note: 'C4: the huddle gathers, compressed' },
    { beat: 'B07', win: w(8.8, 10.667), note: 'C4: you send, the huddle folds, push in on the label' },
    { beat: 'B18', win: w(10.667, 12.8), note: "C5: push into nina's orb in the folded stack; body away, eyes to the logo's ovals, letters spring in" },
    { beat: 'B19', win: w(12.8, 14.933), note: 'C6: the end card, variant (b)' }
  ]
};

/* The 6 s bumper (cutdowns.md section 4), end card (b). */
export const BUMPER6: Edit = {
  id: 'bumper6',
  duration: 6,
  windows: [
    { beat: 'B01', win: w(0, 2.133), note: 'D1: frame 0 set; Same group chat rises; both turn to camera on 2.1' },
    { beat: 'B18', win: w(2.133, 3.733), note: 'D2: push into nina; her body away; eyes to the ovals; letters spring in' },
    { beat: 'B19', win: w(3.733, 6), note: 'D3: the end card; the cut lands on the logo blink' }
  ]
};

export const EDITS: Record<string, Edit> = { master: MASTER, cut15: CUT15, bumper6: BUMPER6 };

/** the beat ids an edit plays, in order */
export const beatsOf = (e: Edit): string[] => e.windows.map((x) => x.beat);
/** the master's script beat (times, words, picture) for a window's beat */
export const scriptOf = (id: string): ReturnType<typeof beat> => beat(id);
