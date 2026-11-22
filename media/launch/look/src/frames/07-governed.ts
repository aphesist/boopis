/* 07 Close-up: governed, in your own session (B09 at 22.5 s). The session's composer with its Governed chip, the answer starting on GPT-6.2 Sol, and the right panel's Governance section with the ladder, Sol current in brass; the one line governed mode may say, anchored above the ladder. */
import { frame, h } from '../stage';
import { SCENE_CSS } from '../scenes/parts';
import { b09 } from '../scenes/session';

frame(async (s) => {
  s.append(h('style', '', SCENE_CSS));
  await b09(s, false);
}, { vertical: false, settle: 2200 });
