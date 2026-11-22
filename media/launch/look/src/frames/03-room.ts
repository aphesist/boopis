/* 03 A group chat at work (B05 at 11.2 s): the lead's hand-off has landed whole with two mention chips, the film line sits in the room's ground above it, the presence line names who took the work. */
import { frame, h } from '../stage';
import { SCENE_CSS } from '../scenes/parts';
import { b05 } from '../scenes/room';

frame(async (s) => {
  s.append(h('style', '', SCENE_CSS));
  await b05(s, false);
}, { vertical: false, settle: 2200 });
