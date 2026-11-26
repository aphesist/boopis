/* Disclosure (21.2 row 36; LAB-v7: steps, work log; open, closed). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';

const STEPS = [{ text: 'Read CHANGELOG.md', time: '0:02' }, { text: 'Read 6 pull requests', time: '0:09' }, { text: 'Writing the notes', state: 'now' as const }, { text: 'Open a pull request', state: 'todo' as const }];
export default {
  id: 'kit/disclosure', title: 'Disclosure', area: 'composer', kind: 'component', covers: ['kit.disclosure'],
  states: {
    typical: stage(['typical'], ({ root }) => { fill(root, kit.disclosure({ summary: 'Read 6 files, ran 2 commands', steps: STEPS })); }, { width: 560 }),
    open: stage(['open'], ({ root }) => { fill(root, kit.disclosure({ summary: 'Read 6 files, ran 2 commands', steps: STEPS, open: true })); }, { width: 560 }),
    'work log': stage(['variant', 'open'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Worked for 59s: read 6 files, ran the tests', steps: [...STEPS.slice(0, 2), { text: 'Ran the tests', state: 'failed', time: '0:31' }], open: true })); }, { width: 560 }),
    /* board S10: the work line open: its rows under its words, each led by its kind's glyph */
    'work log open, S10': stage(['variant', 'open', 'owner'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Worked for 59s: changed 2 files, ran 1 command', open: true, steps: [{ text: 'Read 6 files', state: 'log', icon: 'session' }, { text: 'Changed dock.css, +12 −3', state: 'log', icon: 'pen' }, { text: 'Changed engine.ts, +2 −2', state: 'log', icon: 'pen' }, { text: 'Ran pnpm test dock', state: 'log', icon: 'terminal' }] })); }, { width: 560 }),
    /* derived from S10 (no board draws these): a step that failed, a step that moved to a stronger model, the step being done now, many steps */
    'work log open: a failed step, an escalation, the step being done': stage(['variant', 'open', 'error', 'owner'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Read 6 files, changed 1 file, ran 2 commands', open: true, steps: [{ text: 'Read 6 files', state: 'log', icon: 'session' }, { text: 'Changed dock.css', state: 'log', icon: 'pen' }, { text: 'Ran pnpm test dock', state: 'log', icon: 'terminal', word: 'failed', time: '12s' }, { text: 'qwen3-coder → sonnet 5.5', state: 'log', icon: 'ladder' }, { text: 'Ran pnpm test dock', state: 'now' }] })); }, { width: 560 }),
    'work log open: many steps': stage(['many', 'open'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Worked for 12m 40s: read 40 files, changed 18 files, ran 31 commands', open: true, steps: Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? { text: 'Read ' + (i + 2) + ' files', state: 'log' as const, icon: 'session' } : i % 3 === 1 ? { text: 'Changed part-' + i + '.ts, +' + (i + 3) + ' −' + (i % 4), state: 'log' as const, icon: 'pen' } : { text: 'Ran pnpm test billing --filter part-' + i, state: 'log' as const, icon: 'terminal' })) })); }, { width: 560 }),
    /* what follows the steps: a work log's output in the terminal Well (the session's commands, derived from S10 and S26); a list of parts
       with what it can do (the context's parts and "Compact conversation" in the session's details, derived) */
    'work log open, with its output': stage(['variant', 'open', 'owner'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Worked for 59s: changed 2 files, ran 1 command', open: true, steps: [{ text: 'Changed dock.css, +12 −3', state: 'log', icon: 'pen' }, { text: 'Ran pnpm test dock', state: 'log', icon: 'terminal' }], after: kit.html.well({ kind: 'terminal', path: 'dock-paint', branch: 'w32/dock-paint', label: 'Output', text: '$ pnpm test dock\n ✓ geometry.test.ts (12)\n ✓ centred.test.ts (4)\n\n Test Files  2 passed (2)' }) })); }, { width: 560 }),
    'parts with an action after them': stage(['variant', 'open'], ({ root }) => { fill(root, kit.disclosure({ summary: 'What fills the context', open: true, steps: [{ text: 'System and tools', time: '9k', state: 'log' }, { text: 'Project memory', time: '4k', state: 'log' }, { text: 'Conversation', time: '22k', state: 'log' }], after: kit.html.button({ label: 'Compact conversation', size: 28 }) })); }, { width: 324 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.disclosure({ summary: 'Worked for 12m 40s: read 214 files, ran 31 commands and changed 18 files across the billing service', steps: STEPS })); }, { width: 360 }),
    'the summary hovered': stage(['hover'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Read 6 files, searched 2 patterns', steps: STEPS })); }, { width: 560, force: [{ sel: '.k7-disc__sum', state: 'hover' }] }),
    'the summary focused': stage(['focus'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Read 6 files, searched 2 patterns', steps: STEPS })); }, { width: 560, force: [{ sel: '.k7-disc__sum', state: 'focus' }] }),
    'no steps': stage(['empty'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: '6 steps', steps: [] })); }, { width: 560 }),
    narrow: stage(['size'], ({ root }) => { fill(root, kit.disclosure({ variant: 'worklog', summary: 'Worked for 59s: changed 2 files, ran 1 command', steps: STEPS, open: true })); }, { width: 328 })
  }
} satisfies Story;
