/* A storyboard key frame on the engine: index.html?scene=board&beat=b03 (b01 to b18, b19a, b19b; &variant=vertical).
   The art director's beat builder draws it (look/src/scenes/), the look's ground sits behind it, its orbs become film
   orbs, and the frame holds for the beat's length from beats.json. Nothing moves yet: this is where a scene animator
   starts a beat (the storyboard waits for the owner's approval before any beat is animated). */
import { keyFrame, lookGround, swapOrbs } from '../engine/look';
import { camera } from '../motion';
import { beat as scriptBeat } from '../motion/beats';
import type { Scene } from './types';

const id = (new URLSearchParams(location.search).get('beat') ?? 'b01').toLowerCase();
const beatId = id.replace(/[ab]$/, '').replace(/^b(\d)$/, 'b0$1').toUpperCase();

const scene: Scene = {
  config: { name: 'board-' + id, duration: scriptBeat(beatId).dur, fps: 60, bpm: 112.5 },
  async build(film, stage) {
    lookGround(film, stage);
    camera(film, stage);
    film.mark(beatId, 0);
    const kf = await keyFrame(film, stage, id);
    swapOrbs(film, kf);
  }
};
export default scene;
