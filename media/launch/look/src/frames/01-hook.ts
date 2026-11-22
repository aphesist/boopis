/* 01 The hook (the storyboard's B01 at 1.0 s): the claim reads by the first second with the sound off, the labs' marks set as words, and under it the proof, a Claude bot and a ChatGPT bot looking at each other. The first frame is the thumbnail. */
import { frame, h } from '../stage';
import { SCENE_CSS } from '../scenes/parts';
import { b01 } from '../scenes/hook';

frame(async (s) => {
  s.append(h('style', '', SCENE_CSS));
  await b01(s, false);
}, { vertical: false, settle: 2200 });
