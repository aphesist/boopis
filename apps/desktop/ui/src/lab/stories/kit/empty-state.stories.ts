/* EmptyState (21.2, counted in Page; LAB-v7: per tab). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';

export default {
  id: 'kit/empty-state', title: 'EmptyState', area: 'components', kind: 'component', covers: ['kit.emptyState'],
  states: {
    typical: stage(['typical', 'empty'], ({ root }) => { fill(root, kit.emptyState({ text: 'No sessions yet', action: 'New session' })); fill(root, kit.emptyState({ text: 'Nothing waiting on you' })); fill(root, kit.emptyState({ text: 'No bots yet', action: 'New bot' })); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.emptyState({ text: 'Nothing installed from the store yet: skills, plugins and mods you add show here' })); }, { width: 360 })
  }
} satisfies Story;
