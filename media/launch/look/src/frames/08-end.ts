/* 08 The end card, at rest: the wordmark alone on an even field of light, its eyes glancing, and far below, outside its
   protection area, the platforms (the storyboard boards B19 with and without the repository's address; the address waits on
   the owner). */
import { frame, h } from '../stage';
import { SCENE_CSS } from '../scenes/parts';
import { endCard } from '../scenes/close';

frame((s) => {
  s.append(h('style', '', SCENE_CSS));
  endCard(s, false, 'none');
}, { settle: 2400 });
