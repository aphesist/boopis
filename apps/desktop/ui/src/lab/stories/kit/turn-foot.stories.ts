/* TurnFoot (21.2 row 37; LAB-v7: bot, session; rest, hover reveals actions). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';

export default {
  id: 'kit/turn-foot', title: 'TurnFoot', area: 'composer', kind: 'component', covers: ['kit.turnFoot'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'bot', model: 'claude-sonnet-4.5', modelName: 'Claude Sonnet 4.5', time: '10:05', cost: '$0.04' })); fill(root, kit.turnFoot({ kind: 'session', model: 'gpt-5', modelName: 'GPT-5', time: '10:07', cost: '$0.12' })); }, { width: 560 }),
    hover: stage(['hover'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', model: 'gpt-5', modelName: 'GPT-5', time: '10:07', cost: '$0.12' })); }, { width: 560, force: [{ sel: '[data-kit~="TurnFoot"]', state: 'hover' }] }),
    long: stage(['long'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'bot', model: 'claude-opus-4.1', modelName: 'Claude Opus 4.1 (thinking)', time: 'Yesterday 23:59', cost: 'unknown' })); }, { width: 360 })
  }
} satisfies Story;
