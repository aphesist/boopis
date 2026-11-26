/* OptionRow (21.2 row 20; LAB-v7: permission step, import pick; chosen, hover, focus). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';

const steps = (): HTMLElement => kit.menu({ label: 'How careful', variant: 'options', entries: [
  { label: 'Supervised', meaning: 'Asks before every change', ticks: { of: 4, on: 1 } },
  { label: 'Auto-accept edits', meaning: 'Edits files, asks before commands', ticks: { of: 4, on: 2 }, chosen: true },
  { label: 'Trusted', meaning: 'Runs what the gate allows', ticks: { of: 4, on: 3 } },
  { label: 'Full access', meaning: 'Never asks', ticks: { of: 4, on: 4 } }
] });
export default {
  id: 'kit/option-row', title: 'OptionRow', area: 'components', kind: 'component', covers: ['kit.optionRow'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, steps()); }),
    'import pick': stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'Import', variant: 'options', entries: [{ label: 'From Claude Code', meaning: '12 sessions in ~/.claude', chosen: true }, { label: 'From Codex', meaning: '3 sessions in ~/.codex' }] })); }),
    hover: stage(['hover'], ({ root }) => { line(root, steps()); }, { force: [{ sel: '[data-kit~="OptionRow"]:nth-child(3)', state: 'hover' }] }),
    focus: stage(['focus'], ({ root }) => { line(root, steps()); }, { force: [{ sel: '[data-kit~="OptionRow"]:nth-child(3)', state: 'focus' }] }),
    'check (choose any)': stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'Suites', variant: 'options', entries: [{ label: 'invoice.test.ts', meaning: '', check: true, chosen: true }, { label: 'prorate.test.ts', meaning: '', check: true }] })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.menu({ label: 'Import', variant: 'options', entries: [{ label: 'From a folder', meaning: '/home/someone/code/a-project-with-a-very-long-name/sessions' }] })); })
  }
} satisfies Story;
