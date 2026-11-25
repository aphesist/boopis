/* TurnFoot (21.2 row 37; LAB-v7: bot, session; rest, hover reveals actions). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';

export default {
  id: 'kit/turn-foot', title: 'TurnFoot', area: 'composer', kind: 'component', covers: ['kit.turnFoot'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'bot', model: 'claude-sonnet-4.5', modelName: 'Claude Sonnet 4.5', time: '10:05', cost: '$0.04' })); fill(root, kit.turnFoot({ kind: 'session', model: 'gpt-5', modelName: 'GPT-5', time: '10:07', cost: '$0.12' })); }, { width: 560 }),
    hover: stage(['hover'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', model: 'gpt-5', modelName: 'GPT-5', time: '10:07', cost: '$0.12' })); }, { width: 560, force: [{ sel: '[data-kit~="TurnFoot"]', state: 'hover' }] }),
    long: stage(['long'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'bot', model: 'claude-opus-4.1', modelName: 'Claude Opus 4.1 (thinking)', time: 'Yesterday 23:59', cost: 'unknown' })); }, { width: 360 }),
    /* board S23: the checkpoint the turn left, its three actions, the model with its time and cost */
    'a session, S23': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', label: 'Checkpoint 3', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '0m 59s', cost: '$0.08' })); }, { width: 610 }),
    'only what exists: Undo alone, then nothing': stage(['variant'], ({ root }) => {
      fill(root, kit.turnFoot({ kind: 'session', label: 'Checkpoint 1', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '12s', cost: '$0.01', actions: [{ label: 'Undo', value: 'undo', icon: 'back' }] }));
      fill(root, kit.turnFoot({ kind: 'session', model: 'gpt-5', modelName: 'gpt 5', time: '3m 42s', cost: '$0.37', actions: [] }));
    }, { width: 610 }),
    'Undo that cannot run': stage(['disabled'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', label: 'Checkpoint 2', modelName: 'Model unknown', time: '41s', actions: [{ label: 'Undo', value: 'undo', icon: 'back', disabled: true, tip: 'Rewind needs this session\'s own worktree.' }] })); }, { width: 610 }),
    'an action hovered': stage(['hover'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', label: 'Checkpoint 3', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '0m 59s', cost: '$0.08' })); }, { width: 610, force: [{ sel: '.k7-foot__btn', state: 'hover' }] }),
    'an action focused': stage(['focus'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', label: 'Checkpoint 3', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '0m 59s', cost: '$0.08' })); }, { width: 610, force: [{ sel: '.k7-foot__btn', state: 'focus' }] }),
    'a route, why it was picked, ungoverned': stage(['long', 'variant'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', model: 'sonnet 5.5', modelName: 'qwen3 coder → sonnet 5.5', note: 'debugging', badge: 'ungoverned', badgeTip: 'It ran without governance.', time: '3m 42s', cost: '$0.37', actions: [] })); }, { width: 610 }),
    narrow: stage(['size'], ({ root }) => { fill(root, kit.turnFoot({ kind: 'session', label: 'Checkpoint 3', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '0m 59s', cost: '$0.08', actions: [{ label: 'Undo', value: 'undo', icon: 'back' }] })); }, { width: 328 })
  }
} satisfies Story;
