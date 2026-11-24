/* Chip (21.2 row 28; LAB-v7: answer, filter, mode; chosen, hover, focus). */
import { kit } from '@boopis/ui';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';

const typical = stage(['typical', 'variant'], ({ root }) => {
  line(root, kit.chip({ label: 'Allow once', variant: 'answer', chosen: true }), kit.chip({ label: 'Allow all this turn', variant: 'answer' }), kit.chip({ label: 'Deny', variant: 'answer' }));
  line(root, kit.chip({ label: 'All', chosen: true }), kit.chip({ label: 'Skills' }), kit.chip({ label: 'Plugins' }), kit.chip({ label: 'Mods' }));
  line(root, kit.chip({ label: 'Governed', variant: 'mode', chosen: true }), kit.chip({ label: 'Smart', variant: 'mode' }));
});
export default {
  id: 'kit/chip', title: 'Chip', area: 'components', kind: 'component', covers: ['kit.chip'],
  states: {
    typical,
    ...forced(typical, '[data-kit~="Chip"]'),
    long: stage(['long'], ({ root }) => { line(root, kit.chip({ label: 'Always allow for staging', variant: 'answer' }), kit.chip({ label: 'Connectors and their sources' })); })
  }
} satisfies Story;
