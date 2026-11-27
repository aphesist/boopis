/* Switch (21.2 row 25; LAB-v7: on, off, focus, disabled). */
import { kit } from '@boopis/ui';
import { forced, line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const typical = stage(['typical'], ({ root }) => { line(root, kit.switch({ checked: true, label: 'Show search' }), kit.switch({ checked: false, label: 'Compact dock when idle' })); });
export default {
  id: 'kit/switch', title: 'Switch', area: 'components', kind: 'component', covers: ['kit.switch'],
  states: {
    typical,
    ...forced(typical, '[data-kit~="Switch"]'),
    disabled: stage(['disabled'], ({ root }) => { line(root, kit.switch({ checked: true, disabled: true, label: 'Governed' }), kit.switch({ checked: false, disabled: true, label: 'Ungoverned' })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.switch({ checked: true, label: 'Your messages in a bot\'s colour in every chat with that bot' })); })
  }
} satisfies Story;
