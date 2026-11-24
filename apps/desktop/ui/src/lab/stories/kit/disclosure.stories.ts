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
    long: stage(['long'], ({ root }) => { fill(root, kit.disclosure({ summary: 'Worked for 12m 40s: read 214 files, ran 31 commands and changed 18 files across the billing service', steps: STEPS })); }, { width: 360 })
  }
} satisfies Story;
