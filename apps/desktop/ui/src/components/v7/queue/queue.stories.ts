/* Queue (21.2 row 11; LAB-v7: list (1, 3, 9 messages), held; rest, a row hover, editing a row). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const MSGS = ['Then update the changelog', 'And open a pull request', 'Tag it 0.2.0', 'Write the release notes', 'Ping nina', 'Check the staging health', 'Run the smoke tests', 'Archive the old branch', 'Close the milestone'];
export default {
  id: 'kit/queue', title: 'Queue', area: 'composer', kind: 'component', covers: ['kit.queue'],
  states: {
    typical: stage(['typical'], ({ root }) => { fill(root, kit.queue({ items: MSGS.slice(0, 3) })); }, { width: 640 }),
    one: stage(['single'], ({ root }) => { fill(root, kit.queue({ items: MSGS.slice(0, 1) })); }, { width: 640 }),
    nine: stage(['many'], ({ root }) => { fill(root, kit.queue({ items: MSGS })); }, { width: 640 }),
    held: stage(['variant'], ({ root }) => { fill(root, kit.queue({ variant: 'held' })); }, { width: 640 }),
    'row hover': stage(['hover'], ({ root }) => { fill(root, kit.queue({ items: MSGS.slice(0, 3) })); }, { width: 640, force: [{ sel: '[data-kit-part~="QueueRow"]:nth-child(2)', state: 'hover' }] }),
    editing: stage(['focus'], ({ root }) => { fill(root, kit.queue({ items: MSGS.slice(0, 3), editing: 1 })); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.queue({ items: ['Reconcile the invoices against the ledger before the quarterly close and tell me what moved, then open a pull request'] })); }, { width: 480 }),

    /* board K02: a room's held message, as it rests (the clock, the line, Send now) and with the pointer on it (its Edit shows) */
    'held, it can be taken back': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.queue({ variant: 'held', edit: 'Take back: and the changelog?', sendTip: 'Waiting for kai to finish. Send now stops that turn.' })); }, { width: 720 }),
    'held, hovered': stage(['hover'], ({ root }) => { fill(root, kit.queue({ variant: 'held', held: '3 messages wait until the discussion ends', edit: 'Take back: and the changelog?' })); }, { width: 720, force: [{ sel: '[data-kit-part~="QueueRow"]', state: 'hover' }] }),
    'held, its Edit focused': stage(['focus'], ({ root }) => { fill(root, kit.queue({ variant: 'held', edit: 'Take back: and the changelog?' })); }, { width: 720, force: [{ sel: '[data-queue="edit"]', state: 'focus' }] }),
    'held, narrow': stage(['size', 'long'], ({ root }) => { fill(root, kit.queue({ variant: 'held', held: '12 messages wait until the discussion between the members ends', edit: 'Take back' })); }, { width: 300 })
  }
} satisfies Story;
