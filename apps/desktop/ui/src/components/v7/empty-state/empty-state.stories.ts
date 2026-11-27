/* EmptyState (21.2, counted in Page; LAB-v7: per tab). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/empty-state', title: 'EmptyState', area: 'components', kind: 'component', covers: ['kit.emptyState'],
  states: {
    typical: stage(['typical', 'empty'], ({ root }) => { fill(root, kit.emptyState({ text: 'No sessions yet', action: 'New session' })); fill(root, kit.emptyState({ text: 'Nothing waiting on you' })); fill(root, kit.emptyState({ text: 'No bots yet', action: 'New bot' })); }, { width: 640 }),
    'in a list': stage(['variant', 'empty', 'owner'], ({ root }) => { fill(root, kit.emptyState({ text: 'No sessions yet', place: 'list' })); }, { width: 280, note: 'board S41: a list with nothing in it says so in one line, where its rows and heads would start their words' }),
    long: stage(['long'], ({ root }) => { fill(root, kit.emptyState({ text: 'Nothing installed from the store yet: skills, plugins and mods you add show here' })); }, { width: 360 })
  }
} satisfies Story;
