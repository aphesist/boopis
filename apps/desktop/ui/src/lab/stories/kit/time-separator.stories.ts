/* TimeSeparator (21.2 row 38). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';

export default {
  id: 'kit/time-separator', title: 'TimeSeparator', area: 'composer', kind: 'component', covers: ['kit.timeSeparator'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, kit.timeSeparator({ text: 'Today 10:05' })); fill(root, kit.timeSeparator({ text: 'NEW', unread: true })); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.timeSeparator({ text: 'Wednesday 12 November 2026, 23:59' })); }, { width: 360 })
  }
} satisfies Story;
