/* SystemLine (21.2 row 13; LAB-v7: info, steer, hand-off, error with action; rest, action hover, action focus). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, NIMBUS, NINA } from './_bots';

const all = stage(['typical', 'variant'], ({ root }) => {
  const t = document.createElement('div'); t.className = 'k7-thread';
  t.append(kit.systemLine({ text: 'Continued after a restart', icon: 'clock' }), kit.systemLine({ text: 'Created routine Weekly changelog', icon: 'clock' }),
    kit.systemLine({ variant: 'steer', text: 'You steered', message: 'Use the staging database' }), kit.systemLine({ variant: 'handoff', text: 'kai handed the notes to nina', from: KAI, to: NINA }),
    kit.systemLine({ variant: 'error', icon: 'close', text: 'boopis\'s engine stopped', action: 'Start it again' }));
  fill(root, t);
}, { width: 640 });
export default {
  id: 'kit/system-line', title: 'SystemLine', area: 'components', kind: 'component', covers: ['kit.systemLine'],
  states: {
    typical: all,
    ...forced(all, '[data-kit~="SystemLine"] [data-kit~="Button"]'),
    /* board S33: a setting changed mid-session, its extra cost in mono at the line's end */
    'a setting changed, with its cost (S33)': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.systemLine({ icon: 'sliders', text: 'Settings changed: continued with Auto-accept edits', meta: '+$0.04' })); fill(root, kit.systemLine({ icon: 'sliders', text: 'Effort changed to High' })); }, { width: 640 }),
    /* 6f: a room's lead gives a message to more than one member: the receivers stacked at 16 */
    'a hand-off to two members': stage(['variant'], ({ root }) => { fill(root, kit.systemLine({ variant: 'handoff', text: 'kai gave this to nina and nimbus.', from: KAI, to: [NINA, NIMBUS] })); }, { width: 640 }),
    error: stage(['error'], ({ root }) => { fill(root, kit.systemLine({ variant: 'error', icon: 'close', text: 'boopis\'s engine stopped', action: 'Start it again' })); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.systemLine({ text: 'Settings changed: How careful is now Auto-accept edits for every new session in this project' })); }, { width: 420 })
  }
} satisfies Story;
