/* IconButton (21.2 row 22; LAB-v7: 36, 28 tinted, ghost; hover, pressed, focus). */
import { kit } from '@boopis/ui';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';

const typical = stage(['typical', 'variant', 'size'], ({ root }) => {
  line(root, kit.iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B' }), kit.iconButton({ icon: 'search', label: 'Search', keys: 'mod+K' }), kit.iconButton({ icon: 'sidebar-right', label: 'Details' }));
  line(root, kit.iconButton({ icon: 'plus', label: 'Add', variant: 'tinted', haspopup: 'menu', expanded: false }), kit.iconButton({ icon: 'mic', label: 'Dictate', variant: 'tinted', pressed: false }), kit.iconButton({ icon: 'mic', label: 'Dictate', variant: 'tinted', pressed: true }), kit.iconButton({ icon: 'send', label: 'Send', variant: 'inverted' }));
  line(root, kit.iconButton({ icon: 'minimize', label: 'Minimize', variant: 'ghost' }), kit.iconButton({ icon: 'maximize', label: 'Maximize', variant: 'ghost' }), kit.iconButton({ icon: 'close', label: 'Close window', variant: 'ghost' }));
});

export default {
  id: 'kit/icon-button', title: 'IconButton', area: 'components', kind: 'component', covers: ['kit.iconButton'],
  states: {
    typical,
    ...forced(typical, '[data-kit~="IconButton"]'),
    disabled: stage(['disabled'], ({ root }) => { line(root, kit.iconButton({ icon: 'back', label: 'Back', disabled: true }), kit.iconButton({ icon: 'send', label: 'Send', variant: 'inverted', disabled: true })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.iconButton({ icon: 'gear', label: 'Open the settings of this bot in the details pane', keys: 'mod+,' })); })
  }
} satisfies Story;
