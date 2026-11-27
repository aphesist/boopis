/* Badge (21.2 row 33; LAB-v7: neutral, amber). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/badge', title: 'Badge', area: 'components', kind: 'component', covers: ['kit.badge'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, kit.badge({ text: '3' }), kit.badge({ text: 'outside' }), kit.badge({ text: '2', tone: 'owe', label: '2 need you' }), kit.badge({ text: 'needs you', tone: 'owe' })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.badge({ text: 'made outside boopis' }), kit.badge({ text: '1,204' })); })
  }
} satisfies Story;
