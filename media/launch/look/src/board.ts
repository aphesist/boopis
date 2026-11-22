/* The storyboard's key frames: one page per beat (board/<beat>.html, and <beat>-vertical.html for the 9:16 cut). The page's
   name says which beat and which format; the beat's builder lives in scenes/. */
import { frame, h } from './stage';
import { SCENE_CSS } from './scenes/parts';
import { BEATS } from './scenes/beats';

const name = (location.pathname.split('/').pop() ?? '').replace(/\.html$/, '');
const vertical = name.endsWith('-vertical');
const id = name.replace(/-vertical$/, '');
const beat = BEATS[id];
frame(async (s) => {
  s.append(h('style', '', SCENE_CSS));
  if (!beat) { s.append(h('p', 't t--second', 'No beat ' + id)); return; }
  await beat(s, vertical);
}, { vertical, settle: 2200 });
