/* Avatar (21.2 row 35; LAB-v7: orb 16 to 64, brand tile, stack, orb wearing the model; idle, working, needs, sleeping). Orbs
   are hidden in screenshots (their motion is random by design); the orb checks read their canvases. */
import { kit } from '@boopis/ui';
import { line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

import { BOOPIS, HEX, IRIS, KAI, MOSS, NINA, NIMBUS, LONG_BOT, ORB3_MOTION } from '../../../lab/stories/kit/_bots';

export default {
  id: 'kit/avatar', title: 'Avatar', area: 'components', kind: 'component', covers: ['kit.avatar'],
  states: {
    typical: stage(['typical', 'variant', 'size'], ({ root }) => {
      line(root, ...kit.variants.avatar.size.map((size) => kit.avatar({ bot: KAI, size })));
      line(root, kit.avatar({ variant: 'brand', model: 'claude-sonnet-4.5', label: 'Claude' }), kit.avatar({ variant: 'brand', model: 'gpt-5', label: 'ChatGPT' }), kit.avatar({ variant: 'brand', model: 'gemini-2.5-pro', label: 'Gemini' }));
      line(root, kit.avatar({ variant: 'stack', members: [KAI, NINA, MOSS], size: 24 }), kit.avatar({ variant: 'stack', members: [KAI, NINA, MOSS, IRIS, HEX], size: 16 }));
    }, { width: 720 }),
    /* the logomark is the wordmark's two eyes alone (S41 A, <boopis-logo mark>): it has no body by design; asleep with no model */
    logomark: stage(['variant'], ({ root }) => { line(root, kit.avatar({ variant: 'logomark' }), kit.avatar({ variant: 'logomark', state: 'sleeping', label: 'boopis, asleep' })); }),
    states: stage(['variant'], ({ root }) => {
      line(root, kit.avatar({ bot: { ...NINA, state: 'idle' }, size: 40 }), kit.avatar({ bot: { ...KAI, state: 'working' }, size: 40 }), kit.avatar({ bot: { ...NINA, state: 'needs', attention: 'approval' }, size: 40, flag: true }), kit.avatar({ bot: { ...NIMBUS, state: 'sleeping' }, size: 40 }), kit.avatar({ bot: BOOPIS, size: 40, ink: true }));
    }, { allow: { 'orb.edges': ORB3_MOTION } }),
    /* ORBS.md section 23: the rest pose at the home (still, 0 changed pixels), then the state table's faces, each on the alive-idle engine */
    'rest and states': stage(['variant'], ({ root }) => {
      line(root, ...[KAI, NINA, MOSS, IRIS, HEX, NIMBUS].map((b) => kit.avatar({ bot: b, size: 40, rest: true })));
      line(root, ...(['working', 'compute', 'thinking', 'speaking', 'listening', 'needs', 'done', 'error', 'sleeping'] as const).map((st) => kit.avatar({ bot: { ...KAI, state: st }, size: 64, rest: true })));
    }, { width: 760, allow: { 'orb.edges': ORB3_MOTION } }),
    long: stage(['long'], ({ root }) => { line(root, kit.avatar({ bot: LONG_BOT, size: 36 }), kit.avatar({ variant: 'stack', members: [KAI, NINA, MOSS, IRIS, HEX, NIMBUS], size: 24 })); })
  }
} satisfies Story;
