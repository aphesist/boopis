/* StatusWord (21.2 row 32; LAB-v7: neutral, amber, red, ok; with dot; pulse). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/status-word', title: 'StatusWord', area: 'components', kind: 'component', covers: ['kit.statusWord'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => {
      line(root, kit.statusWord({ text: 'working' }), kit.statusWord({ text: 'needs you', tone: 'owe' }), kit.statusWord({ text: 'failed', tone: 'red' }), kit.statusWord({ text: 'connected', tone: 'ok' }));
      line(root, kit.statusWord({ text: 'asleep', dot: true }), kit.statusWord({ text: 'needs you', tone: 'owe', dot: true }), kit.statusWord({ text: 'failed', tone: 'red', dot: true }), kit.statusWord({ text: 'online', tone: 'ok', dot: true }));
    }),
    pulse: stage(['variant', 'loading'], ({ root }) => { line(root, kit.statusWord({ text: 'working', pulse: true })); }, { note: 'the pulse loops in motion; a still shows it at rest' }),
    long: stage(['long'], ({ root }) => { line(root, kit.statusWord({ text: 'Needs you: approve a deploy to production', tone: 'owe', dot: true })); })
  }
} satisfies Story;
