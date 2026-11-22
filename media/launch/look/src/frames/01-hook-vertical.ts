/* 01 The hook recomposed for 9:16 (B01): the claim in the upper band, the two orbs larger across the middle band, all inside the safe area. */
import { frame, h } from '../stage';
import { SCENE_CSS } from '../scenes/parts';
import { b01 } from '../scenes/hook';

frame(async (s) => {
  s.append(h('style', '', SCENE_CSS));
  await b01(s, true);
}, { vertical: true, settle: 2200 });
