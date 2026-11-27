/* SectionHead (21.2 row 18; LAB-v7: plain, with count, with disclosure; collapsed). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/section-head', title: 'SectionHead', area: 'components', kind: 'component', covers: ['kit.sectionHead'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, kit.sectionHead({ title: 'Groups' })); fill(root, kit.sectionHead({ title: 'Needs you', count: '2' })); fill(root, kit.sectionHead({ title: 'Settled', count: '14', disclosure: true })); }, { width: 300 }),
    collapsed: stage(['variant'], ({ root }) => { fill(root, kit.sectionHead({ title: 'Archived', count: '2', disclosure: true, collapsed: true })); }, { width: 300 }),
    empty: stage(['empty'], ({ root }) => { fill(root, kit.sectionHead({ title: 'Pinned', value: 'none' })); }, { width: 300 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.sectionHead({ title: 'Working on the release and the changelog', count: '128' })); }, { width: 300 })
  }
} satisfies Story;
