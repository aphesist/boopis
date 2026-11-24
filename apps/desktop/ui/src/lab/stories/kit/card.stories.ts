/* Card (21.2 row 6; LAB-v7: settings, pane card, danger zone; collapsed, open). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { State, Story } from '../../types';

const withAllow = (states: Record<string, State>, name: string, allow: NonNullable<State['allow']>): Record<string, State> => ({ ...states, [name]: { ...states[name], tags: states[name]?.tags ?? [], allow } });

const sw = (on: boolean, label: string): string => kit.html.switch({ checked: on, label });
const settings = (): HTMLElement => kit.card({ rows: [
  { label: 'Show search', control: sw(true, 'Show search') },
  { label: 'Search shows as', control: kit.html.selectorItem({ variant: 'field', label: 'Search shows as', value: 'The hint' }) },
  { label: 'Governed', explain: 'boopis checks every change at the gate before it reaches your files.', control: sw(true, 'Governed') },
  { label: 'Spend this month', value: '$12.40', mono: true }
] });
export default {
  id: 'kit/card', title: 'Card', area: 'components', kind: 'component', covers: ['kit.card'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, settings()); }, { width: 560 }),
    ...withAllow(forced(stage(['typical'], ({ root }) => { fill(root, settings()); }, { width: 560 }), '[data-kit~="Switch"]'), 'focus', { 'mark.rest': 'a focused switch is focus within its row, which reveals the row\'s info label (17.1); the static pass reads it as rest' }),
    'row hover': stage(['hover'], ({ root }) => { fill(root, settings()); }, { width: 560, force: [{ sel: '[data-kit-part~="Row"]', state: 'hover' }], allow: { 'mark.rest': 'the state forces the rows\' hover, which is what reveals an info label (17.1); the static pass reads it as rest' } }),
    pane: stage(['variant'], ({ root }) => { fill(root, kit.card({ variant: 'pane', rows: [{ label: 'Model', value: 'Claude Sonnet 4.5' }, { label: 'Spend', value: '$0.37 of $0.60', mono: true }, { label: 'Workspace', value: '~/code/boopis', mono: true }] })); }, { width: 324 }),
    'danger zone collapsed': stage(['variant'], ({ root }) => { fill(root, kit.card({ variant: 'danger', rows: [{ label: 'Archive this bot', control: kit.html.button({ label: 'Archive', variant: 'tint', size: 32 }) }, { label: 'Delete this bot', control: kit.html.button({ label: 'Delete', variant: 'danger', size: 32 }) }] })); }, { width: 560 }),
    'danger zone open': stage(['open'], ({ root }) => { fill(root, kit.card({ variant: 'danger', open: true, rows: [{ label: 'Archive this bot', control: kit.html.button({ label: 'Archive', variant: 'tint', size: 32 }) }, { label: 'Delete this bot', control: kit.html.button({ label: 'Delete', variant: 'danger', size: 32 }) }] })); }, { width: 560 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.card({ rows: [{ label: 'Your messages in a bot\'s colour in every chat you have with that bot', control: sw(true, 'Bot colour') }, { label: 'Workspace', value: '/home/someone/code/a-very-long-project-name/apps', mono: true }] })); }, { width: 440 })
  }
} satisfies Story;
