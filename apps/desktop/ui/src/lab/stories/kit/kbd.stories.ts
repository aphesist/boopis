/* Kbd (21.2 row 27; LAB-v7: in text, in a pill, in a MenuRow). */
import { kit } from '@boopis/ui';
import { line, put, stage } from '../../story';
import type { Story } from '../../types';

export default {
  id: 'kit/kbd', title: 'Kbd', area: 'components', kind: 'component', covers: ['kit.kbd'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => {
      line(root, kit.kbd({ keys: 'mod+K' }), kit.kbd({ keys: 'esc' }), kit.kbd({ keys: 'mod+shift+O' }), kit.kbd({ keys: 'Enter' }));
      put(root, '<p class="k7-dim">Press ' + kit.html.kbd({ keys: 'mod+Enter' }) + ' to steer.</p>');
    }),
    'in a pill': stage(['variant'], ({ root }) => { line(root, kit.field({ id: 'k-s', kind: 'search', placeholder: 'Search', keys: 'mod+K' })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.kbd({ keys: 'mod+shift+alt+Backspace' })); })
  }
} satisfies Story;
