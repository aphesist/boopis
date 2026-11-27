/* Block (21.2 row 7; LAB-v7: the bare surface with a 28 control in each corner, the corner rule's specimen). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const corners = (): HTMLElement => kit.block({ body:
  '<div class="k7-lab-corners">' + kit.html.iconButton({ icon: 'plus', label: 'Add', variant: 'tinted' }) + kit.html.chip({ label: 'Allow once', variant: 'answer', chosen: true }) +
  '<p class="k7-text k7-type-s">A Block: radius 22, padding 8. Its 28 px controls sit 8 from both edges (22 - 8 = 14, their radius); text indents 4 more.</p>' +
  kit.html.button({ label: 'Deny', variant: 'tint', size: 28 }) + kit.html.iconButton({ icon: 'more', label: 'More', variant: 'tinted' }) + '</div>' });
export default {
  id: 'kit/block', title: 'Block', area: 'components', kind: 'component', covers: ['kit.block'],
  states: {
    typical: stage(['typical'], ({ root }) => { fill(root, corners()); }, { width: 480 }),
    /* board S37 (`.ns-hello`): an offer: what is missing, said kindly, over the ways to get it (each a Button led by its provider's mark) */
    'an offer (S37)': stage(['variant', 'owner'], ({ root, ui }) => {
      const way = (name: string, model: string): string => kit.html.button({ label: name, size: 28, leadHTML: ui.html.modelMark(model, { size: 14, label: false }) });
      fill(root, kit.block({ variant: 'offer', body: '', text: 'boopis needs a model to think with. Sign in once and every session can use it.', actions: way('Claude', 'claude-sonnet') + way('ChatGPT', 'gpt-5') + way('Gemini', 'gemini-pro') + kit.html.button({ label: 'More', size: 28, variant: 'ghost' }) }));
    }, { width: 560 }),
    'an offer, narrow': stage(['size'], ({ root, ui }) => {
      const way = (name: string, model: string): string => kit.html.button({ label: name, size: 28, leadHTML: ui.html.modelMark(model, { size: 14, label: false }) });
      fill(root, kit.block({ variant: 'offer', body: '', text: 'boopis needs a model to think with. Sign in once and every session can use it.', actions: way('Claude', 'claude-sonnet') + way('ChatGPT', 'gpt-5') + way('Gemini', 'gemini-pro') + kit.html.button({ label: 'More', size: 28, variant: 'ghost' }) }));
    }, { width: 300 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.block({ body: '<p class="k7-text k7-type-s">' + 'Reconcile the invoices against the ledger before the quarterly close. '.repeat(4) + '</p>' })); }, { width: 480 })
  }
} satisfies Story;
