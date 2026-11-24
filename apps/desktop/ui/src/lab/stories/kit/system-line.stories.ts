/* SystemLine (21.2 row 13; LAB-v7: info, steer, hand-off, error with action; rest, action hover, action focus). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, NINA } from './_bots';

const all = stage(['typical', 'variant'], ({ root }) => {
  const t = document.createElement('div'); t.className = 'k7-thread';
  t.append(kit.systemLine({ text: 'Continued after a restart', icon: 'clock' }), kit.systemLine({ text: 'Created routine Weekly changelog', icon: 'clock' }),
    kit.systemLine({ variant: 'steer', text: 'You steered', message: 'Use the staging database' }), kit.systemLine({ variant: 'handoff', text: 'kai handed the notes to nina', from: KAI, to: NINA }),
    kit.systemLine({ variant: 'error', text: 'The engine stopped', action: 'Start it again' }));
  fill(root, t);
}, { width: 640 });
export default {
  id: 'kit/system-line', title: 'SystemLine', area: 'components', kind: 'component', covers: ['kit.systemLine'],
  states: {
    typical: all,
    ...forced(all, '[data-kit~="SystemLine"] [data-kit~="Button"]'),
    error: stage(['error'], ({ root }) => { fill(root, kit.systemLine({ variant: 'error', text: 'The engine stopped', action: 'Start it again' })); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.systemLine({ text: 'Settings changed: How careful is now Auto-accept edits for every new session in this project' })); }, { width: 420 })
  }
} satisfies Story;
