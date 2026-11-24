/* Block (21.2 row 7; LAB-v7: the bare surface with a 28 control in each corner, the corner rule's specimen). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';

const corners = (): HTMLElement => kit.block({ body:
  '<div class="k7-lab-corners">' + kit.html.iconButton({ icon: 'plus', label: 'Add', variant: 'tinted' }) + kit.html.chip({ label: 'Allow once', variant: 'answer', chosen: true }) +
  '<p class="k7-text k7-type-s">A Block: radius 22, padding 8. Its 28 px controls sit 8 from both edges (22 - 8 = 14, their radius); text indents 4 more.</p>' +
  kit.html.button({ label: 'Deny', variant: 'tint', size: 28 }) + kit.html.iconButton({ icon: 'more', label: 'More', variant: 'tinted' }) + '</div>' });
export default {
  id: 'kit/block', title: 'Block', area: 'components', kind: 'component', covers: ['kit.block'],
  states: {
    typical: stage(['typical'], ({ root }) => { fill(root, corners()); }, { width: 480 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.block({ body: '<p class="k7-text k7-type-s">' + 'Reconcile the invoices against the ledger before the quarterly close. '.repeat(4) + '</p>' })); }, { width: 480 })
  }
} satisfies Story;
