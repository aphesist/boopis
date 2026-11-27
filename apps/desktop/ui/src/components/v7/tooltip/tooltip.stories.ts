/* Tooltip (21.2 row 29; LAB-v7: name, name + keys; shown). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/tooltip', title: 'Tooltip', area: 'components', kind: 'component', covers: ['kit.tooltip'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, kit.tooltip({ label: 'Details' }), kit.tooltip({ label: 'Search', keys: 'mod+K' })); }),
    shown: stage(['tooltip'], async ({ root, wait, ui }) => {
      const b = kit.iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B' }); line(root, b); b.focus(); ui.tooltip.show(b); await wait(300);
    }, { overlay: { anchor: '[data-kit~="IconButton"]', layer: '.ui-tip' } }),
    long: stage(['long'], ({ root }) => { line(root, kit.tooltip({ label: 'Open the full chat in the Bots tab', keys: 'mod+Enter' })); })
  }
} satisfies Story;
