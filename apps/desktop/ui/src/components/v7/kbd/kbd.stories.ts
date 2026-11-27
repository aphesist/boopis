/* Kbd (21.2 row 27; LAB-v7: in text, in a pill, in a MenuRow). */
import { kit } from '@boopis/ui';
import { line, put, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/kbd', title: 'Kbd', area: 'components', kind: 'component', covers: ['kit.kbd', 'kit.kbdSpec'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => {
      line(root, kit.kbd({ keys: 'mod+K' }), kit.kbd({ keys: 'esc' }), kit.kbd({ keys: 'mod+shift+O' }), kit.kbd({ keys: 'Enter' }));
      put(root, '<p class="k7-dim">Press ' + kit.html.kbd({ keys: 'mod+Enter' }) + ' to steer.</p>');
    }),
    'in a pill': stage(['variant'], ({ root }) => { line(root, kit.field({ id: 'k-s', kind: 'search', placeholder: 'Search', keys: 'mod+K' })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.kbd({ keys: 'mod+shift+alt+Backspace' })); }),
    /* 7a, Settings › Keyboard: a binding as the keymap writes it */
    'a binding: alternatives, a sequence, a hold': stage(['variant'], ({ root }) => { line(root, kit.kbdSpec('mod+G I | / | i')); line(root, kit.kbdSpec('hold:space | enter enter')); line(root, kit.kbdSpec('up | down | k | j')); }),
    'a binding, long, in a narrow row': stage(['long'], ({ root }) => { line(root, kit.kbdSpec('left | right | up | down | home | end')); }, { width: 220 })
  }
} satisfies Story;
