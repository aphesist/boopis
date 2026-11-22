/* 03 The room in 9:16 (B05): the product's own narrow layout folds each call number above its message; the composer closes the column. */
import { frame, h } from '../stage';
import { SCENE_CSS } from '../scenes/parts';
import { b05 } from '../scenes/room';

frame(async (s) => {
  s.append(h('style', '', SCENE_CSS));
  await b05(s, true);
}, { vertical: true, settle: 2200 });
