/* Segmented (21.2 row 23; LAB-v7: inline 2, 3, 4; page head; tab bar; each chosen, hover, focus). */
import { kit } from '@boopis/ui';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';

const two = [{ value: 'activity', label: 'Activity' }, { value: 'library', label: 'Library' }];
const three = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
const four = [{ value: 'diff', label: 'Diff' }, { value: 'files', label: 'Files' }, { value: 'terminal', label: 'Terminal' }, { value: 'pr', label: 'PR' }];
const typical = stage(['typical', 'variant'], ({ root }) => {
  line(root, kit.segmented({ label: 'Details', items: two, value: 'activity' }));
  line(root, kit.segmented({ label: 'Theme', items: three, value: 'light' }));
  line(root, kit.segmented({ label: 'Tools', items: four, value: 'terminal', variant: 'tabs' }));
  line(root, kit.segmented({ label: 'Scope', items: [{ value: 'device', label: 'This device' }, { value: 'project', label: 'This project' }], value: 'project', variant: 'head' }));
});
const each = Object.fromEntries(four.map((it) => ['chosen ' + it.label, stage(['variant'], ({ root }) => { line(root, kit.segmented({ label: 'Tools', items: four, value: it.value, variant: 'tabs' })); })]));
export default {
  id: 'kit/segmented', title: 'Segmented', area: 'components', kind: 'component', covers: ['kit.segmented'],
  states: {
    typical,
    ...forced(typical, '.k7-seg__item'),
    ...each,
    long: stage(['long'], ({ root }) => { line(root, kit.segmented({ label: 'How careful', items: [{ value: 's', label: 'Supervised' }, { value: 'a', label: 'Auto-accept edits' }], value: 'a' })); })
  }
} satisfies Story;
