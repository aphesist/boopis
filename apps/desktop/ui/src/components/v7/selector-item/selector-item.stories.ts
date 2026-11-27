/* SelectorItem (21.2 row 24; LAB-v7: line, launch, field; with a mark, with ticks; hover, open). */
import { kit } from '@boopis/ui';
import { forced, line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const typical = stage(['typical', 'variant'], ({ root }) => {
  line(root, kit.selectorItem({ variant: 'line', label: 'Mode', value: 'Governed' }), kit.selectorItem({ variant: 'line', label: 'Model', value: 'Smart' }), kit.selectorItem({ variant: 'line', label: 'Branch', value: 'w32/kit-v7', mono: true }));
  line(root, kit.selectorItem({ variant: 'launch', label: 'Folder', value: 'boopis', icon: 'folder' }), kit.selectorItem({ variant: 'launch', label: 'How careful', value: 'Auto-accept edits', ticks: { of: 4, on: 2 } }), kit.selectorItem({ variant: 'launch', label: 'Model', value: '+ Choose a model', need: true, chevron: false }));
  line(root, kit.selectorItem({ variant: 'field', label: 'Wait for my answer', value: '60 s' }));
});
export default {
  id: 'kit/selector-item', title: 'SelectorItem', area: 'components', kind: 'component', covers: ['kit.selectorItem'],
  states: {
    typical,
    ...forced(typical, '[data-kit~="SelectorItem"]'),
    open: stage(['open'], ({ root }) => { line(root, kit.selectorItem({ variant: 'launch', label: 'Model', value: 'claude-sonnet-4.5', open: true })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.selectorItem({ variant: 'launch', label: 'Folder', value: 'apps/desktop/ui/src/components', icon: 'folder', mono: true })); })
  }
} satisfies Story;
