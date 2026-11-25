/* Avatar (21.2 row 35; LAB-v7: orb 16 to 64, brand tile, stack, orb wearing the model; idle, working, needs, sleeping). Orbs
   are hidden in screenshots (their motion is random by design); the orb checks read their canvases. */
import { kit } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';

/* orb.rest still holds every resting orb of these states to 0 changed pixels; what is excused is orb.edges on the orbs that move */
const ORB3_SHIMMER = 'orb3 3.0.2 leaves a residual edge shimmer on orbs in motion (a lively idle, a state on the alive-idle engine): 1 to 3 px in 48 frames, not every run, on CI and not locally; ORBS.md measures 6 to 27 px per clip for this build. An upstream fix (aphesist/orb2), reported to the owner, not a kit defect';
import { BOOPIS, HEX, IRIS, KAI, MOSS, NINA, NIMBUS, LONG_BOT } from './_bots';

export default {
  id: 'kit/avatar', title: 'Avatar', area: 'components', kind: 'component', covers: ['kit.avatar'],
  states: {
    typical: stage(['typical', 'variant', 'size'], ({ root }) => {
      line(root, ...kit.variants.avatar.size.map((size) => kit.avatar({ bot: KAI, size })));
      line(root, kit.avatar({ variant: 'brand', model: 'claude-sonnet-4.5', label: 'Claude' }), kit.avatar({ variant: 'brand', model: 'gpt-5', label: 'ChatGPT' }), kit.avatar({ variant: 'brand', model: 'gemini-2.5-pro', label: 'Gemini' }));
      line(root, kit.avatar({ variant: 'stack', members: [KAI, NINA, MOSS], size: 24 }), kit.avatar({ variant: 'stack', members: [KAI, NINA, MOSS, IRIS, HEX], size: 16 }));
      line(root, kit.avatar({ variant: 'logomark' }));
    }, { width: 720 }),
    states: stage(['variant'], ({ root }) => {
      line(root, kit.avatar({ bot: { ...NINA, state: 'idle' }, size: 40 }), kit.avatar({ bot: { ...KAI, state: 'working' }, size: 40 }), kit.avatar({ bot: { ...NINA, state: 'needs', attention: 'approval' }, size: 40, flag: true }), kit.avatar({ bot: { ...NIMBUS, state: 'sleeping' }, size: 40 }), kit.avatar({ bot: BOOPIS, size: 40, ink: true }));
      line(root, kit.avatar({ variant: 'logomark', state: 'sleeping', label: 'boopis, asleep' }));
    }, { allow: { 'orb.edges': ORB3_SHIMMER } }),
    /* ORBS.md section 23: the rest pose at the home (still, 0 changed pixels), then the state table's faces, each on the alive-idle engine */
    'rest and states': stage(['variant'], ({ root }) => {
      line(root, ...[KAI, NINA, MOSS, IRIS, HEX, NIMBUS].map((b) => kit.avatar({ bot: b, size: 40, rest: true })));
      line(root, ...(['working', 'compute', 'thinking', 'speaking', 'listening', 'needs', 'done', 'error', 'sleeping'] as const).map((st) => kit.avatar({ bot: { ...KAI, state: st }, size: 64, rest: true })));
    }, { width: 760, allow: { 'orb.edges': ORB3_SHIMMER } }),
    long: stage(['long'], ({ root }) => { line(root, kit.avatar({ bot: LONG_BOT, size: 36 }), kit.avatar({ variant: 'stack', members: [KAI, NINA, MOSS, IRIS, HEX, NIMBUS], size: 24 })); })
  }
} satisfies Story;
