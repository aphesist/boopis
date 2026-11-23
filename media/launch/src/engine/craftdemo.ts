/* The engine's character and type helpers in one place (index.html?scene=craft): what an animator reaches for, shown
   working, and what the reviews asked of the engine.

     kai, nina   two orbs with a character (motion/character.ts): an idle that never freezes (float, breath,
                 micro-glances, seeded blinks) through a 1.3 s hold; kai's gaze queue with a look that interrupts the
                 one before (1.10 s, then 1.22 s: the second takes over from where the first is, no jump); nina speaks
                 from 1.6 s to 3.6 s on orb2's speaking face (bars with moving heights, circles on the slow cycle)
     the line    K1 (motion/line.ts): the words rise unmasked at 0.3 s, the whole line leaves at 3.9 s
     the edit    K5: a line edits itself with kai's named caret, on beats 2, 2, 1 (motion/line.ts selfEdit)
     the notes   E5 (motion/bars.ts): a block of small text shrinks with its group to 30% and comes back; each run turns
                 into its bar as a whole, only while it is under 12 px on screen, and back

   No grain, the light ground. */
import type { Scene } from '../scenes/types';
import { FilmOrb } from './orb';
import { el, place } from './stage';
import { character } from '../motion/character';
import { glance } from '../motion/orb-moves';
import { lineExit, selfEdit, wordRise, words } from '../motion/line';
import { textBars, textRuns } from '../motion/bars';
import { travel } from '../motion/ease';

const BEAT = 60 / 112.5;

export const CRAFT = {
  kaiLooks: [[1.1, 26, 4], [1.22, -22, 10], [2.4, 8, -6]] as [number, number, number][],
  ninaSpeaks: [1.6, 3.6] as [number, number],
  rise: 0.3, exit: 3.9,
  edits: [0.9, 0.9 + 2 * BEAT, 0.9 + 4 * BEAT],
  shrink: { at: 0.6, dur: 1.1, back: 2.6, to: 0.3 }
};

const scene: Scene = {
  config: { name: 'craft', duration: 4.5, fps: 60, bpm: 112.5 },
  build(film, stage) {
    stage.root.style.background = 'var(--bg-1)';
    const world = stage.layer('stage', 1);
    const C = CRAFT;

    /* the orbs */
    const mk = (shape: string, color: string, x: number, seed: number, yaw: number): FilmOrb => {
      const orb = new FilmOrb({ shape, color }, 220, { eyes: 'pill', yaw, pitch: 4 });
      const holder = place(el('div', 'craft-orb'), x, 330, { w: 220, h: 220 });
      holder.appendChild(orb.el);
      world.appendChild(holder);
      character(film, orb, { seed });
      film.onRender(() => orb.render());
      return orb;
    };
    const kai = mk('circle', '#d97757', 300, 7, 10);
    const nina = mk('squircle', '#10a37f', 600, 11, -10);
    /* kai: three looks through orb-moves' glance (with a character they are looks in its queue); the second comes
       0.12 s into the first, while it is still travelling */
    for (const [at, yaw, pitch] of C.kaiLooks) glance(film, kai, at, yaw, pitch);
    const nc = character(film, nina);
    nc.look(1.5, 18, -4).speak(C.ninaSpeaks[0], C.ninaSpeaks[1]).look(3.7, -6, 8);

    /* K1: the words rise without masks, the line leaves whole */
    const k1 = place(el('div', 'craft-k1'), 900, 150, { anchor: 'topleft' });
    k1.style.cssText += ';font:600 84px/1.1 var(--sans);color:var(--text-strong);white-space:nowrap;letter-spacing:-0.02em';
    world.appendChild(k1);
    const ws = words(k1, 'calm, and alive', { accent: ['alive'] });
    wordRise(film, ws, { at: C.rise });
    lineExit(film, k1, { at: C.exit });

    /* K5: the line edits itself */
    const k5 = place(el('div', 'craft-k5'), 860, 420, { anchor: 'topleft' });
    k5.style.cssText += ';font:600 64px/1.15 var(--sans);color:var(--text-strong);white-space:nowrap;letter-spacing:-0.02em';
    world.appendChild(k5);
    words(k5, 'one bot, one tab, one key');
    selfEdit(film, k5, [{ at: C.edits[0]!, word: 0, to: 'every' }, { at: C.edits[1]!, word: 'tab,', to: 'room,' }, { at: C.edits[2]!, word: 'key', to: 'answer' }], { name: 'kai', color: '#d97757' });

    /* E5: small text in a group that shrinks and comes back; whole runs swap below 12 px */
    const notes = place(el('div', 'craft-notes'), 160, 640, { anchor: 'topleft', w: 1400 });
    notes.style.cssText += ';transform-origin:0 0';
    notes.innerHTML = '<div style="font:600 30px/1.3 var(--sans);color:var(--text-strong)">release: three bots, one room</div>' +
      '<div style="font:400 22px/1.45 var(--sans);color:var(--text-body, var(--text-strong));max-width:1100px">kai drafts the change, nina reviews it, moss runs the tests. Each one answers in the same thread, and nothing ships until you say so.</div>' +
      '<div style="font:500 18px/1.4 var(--mono, monospace);color:var(--text-quiet, var(--text-strong))">call 14 · src/billing · 3 files</div>';
    world.appendChild(notes);
    const S = C.shrink;
    const scale = (t: number): number => {
      if (t <= S.at) return 1;
      if (t < S.at + S.dur) return 1 + (S.to - 1) * travel((t - S.at) / S.dur);
      if (t <= S.back) return S.to;
      if (t < S.back + S.dur) return S.to + (1 - S.to) * travel((t - S.back) / S.dur);
      return 1;
    };
    const runs = textRuns(stage, notes);
    film.onRender((t) => { notes.style.transform = 'scale(' + scale(t).toFixed(5) + ')'; }, -3);
    textBars(film, runs, { scale });
  }
};
export default scene;
