/* Rail (21.2 row 40; LAB-v7: A, B; current, needs you, working). The rooms' clusters are decided (owner, 25 November 2026): at most three
   orbs in their triangle (15, or 12 on the compact rail), the rest a "+N" chip clear of them on the right, a filled pill half an orb tall. */
import { kit } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';
import { BOOPIS, HEX, IRIS, KAI, MOSS, NINA, NIMBUS, ORB3_MOTION } from './_bots';

const TABS = [{ value: 'session', label: 'Sessions', icon: 'session', keys: 'alt+1' }, { value: 'bots', label: 'Bots', icon: 'bots', keys: 'alt+2' }];
const BOTS = [{ ...BOOPIS, ink: true }, { ...KAI, current: true }, { ...NINA, needs: true }, { ...MOSS, working: true }, { ...IRIS }, { ...HEX }];
const GROUPS = [{ name: 'release', members: [KAI, NINA, MOSS] }, { name: 'triage', members: [NIMBUS, HEX, IRIS, KAI, NINA] }];
export default {
  id: 'kit/rail', title: 'Rail', area: 'bots', kind: 'component', covers: ['kit.rail'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, kit.rail({ bots: BOTS, groups: GROUPS }), kit.rail({ size: 'b', bots: BOTS, groups: GROUPS })); }, { ground: 'frame', allow: { 'orb.edges': ORB3_MOTION } }),
    long: stage(['long', 'many'], ({ root }) => { line(root, kit.rail({ bots: [...BOTS, { id: 'cassiopeia-staging-deploy-guardian', name: 'cassiopeia-staging-deploy-guardian', shape: 'star', color: '#e8b04a' }] })); }, { ground: 'frame', allow: { 'orb.edges': ORB3_MOTION } }),
    /* owner, 25 November (option B): the tab switch, upright, under the sidebar toggle; on the Sessions tab the rail shows no bots */
    'the tab switch: Bots': stage(['variant', 'owner'], ({ root }) => { line(root, kit.rail({ bots: BOTS, groups: GROUPS, tabs: { value: 'bots', items: TABS } }), kit.rail({ size: 'b', bots: BOTS, groups: GROUPS, tabs: { value: 'bots', items: TABS } })); }, { ground: 'frame', allow: { 'orb.edges': ORB3_MOTION } }),
    'the tab switch: Sessions, no bots': stage(['variant', 'empty', 'owner'], ({ root }) => { line(root, kit.rail({ bots: [], tabs: { value: 'session', items: TABS }, newLabel: 'New session' }), kit.rail({ size: 'b', bots: [], tabs: { value: 'session', items: TABS }, newLabel: 'New session' })); }, { ground: 'frame', allow: { 'orb.edges': ORB3_MOTION } }),
    'the tab switch, a tab hovered': stage(['hover'], ({ root }) => { line(root, kit.rail({ bots: BOTS, tabs: { value: 'bots', items: TABS } })); }, { ground: 'frame', force: [{ sel: '[data-rail-tabs] .k7-seg__item[aria-selected="false"]', state: 'hover' }] }),
    'the tab switch, a tab focused': stage(['focus'], ({ root }) => { line(root, kit.rail({ bots: BOTS, tabs: { value: 'bots', items: TABS } })); }, { ground: 'frame', force: [{ sel: '[data-rail-tabs] .k7-seg__item[aria-selected="true"]', state: 'focus' }] })
  }
} satisfies Story;
