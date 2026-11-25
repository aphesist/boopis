/* Rail (21.2 row 40; LAB-v7: A, B; current, needs you, working). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';
import { BOOPIS, HEX, IRIS, KAI, MOSS, NINA, NIMBUS, ORB3_MOTION } from './_bots';

const BOTS = [{ ...BOOPIS, ink: true }, { ...KAI, current: true }, { ...NINA, needs: true }, { ...MOSS, working: true }, { ...IRIS }, { ...HEX }];
const GROUPS = [{ name: 'release', members: [KAI, NINA, MOSS] }, { name: 'triage', members: [NIMBUS, HEX, IRIS, KAI, NINA] }];
export default {
  id: 'kit/rail', title: 'Rail', area: 'bots', kind: 'component', covers: ['kit.rail'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, kit.rail({ bots: BOTS, groups: GROUPS }), kit.rail({ size: 'b', bots: BOTS, groups: GROUPS })); }, { ground: 'frame', allow: { 'orb.edges': ORB3_MOTION } }),
    long: stage(['long', 'many'], ({ root }) => { line(root, kit.rail({ bots: [...BOTS, { id: 'cassiopeia-staging-deploy-guardian', name: 'cassiopeia-staging-deploy-guardian', shape: 'star', color: '#e8b04a' }] })); }, { ground: 'frame', allow: { 'orb.edges': ORB3_MOTION } })
  }
} satisfies Story;
