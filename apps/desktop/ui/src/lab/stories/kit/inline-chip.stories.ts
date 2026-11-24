/* InlineChip (21.2 row 30; LAB-v7: mention, you, reference, code, model, countdown; at 13, 14, 15 px text; rest, wrapping line). */
import { kit } from '@boopis/ui';
import { put, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, NINA } from './_bots';

const chips = (): string =>
  'Ask ' + kit.html.inlineChip({ kind: 'mention', bot: KAI, colour: KAI.color }) + ' or ' + kit.html.inlineChip({ kind: 'mention', bot: NINA, colour: NINA.color }) +
  ' then tell ' + kit.html.inlineChip({ kind: 'you' }) + ' about ' + kit.html.inlineChip({ kind: 'reference', text: 'src/billing.ts:42' }) +
  ', run ' + kit.html.inlineChip({ kind: 'code', text: 'pnpm test' }) + ' with ' + kit.html.inlineChip({ kind: 'model', model: 'claude-sonnet-4.5', text: 'Claude Sonnet 4.5' }) +
  ' and answer in ' + kit.html.inlineChip({ kind: 'countdown', text: '0:42' }) + '.';
/* each paragraph a step apart, as running text is: a chip's background may reach a hair past its line box */
const at = (px: 's' | 'm' | 'l'): string => '<p class="k7-type-' + px + ' k7-lab-para">' + chips() + '</p>';
export default {
  id: 'kit/inline-chip', title: 'InlineChip', area: 'components', kind: 'component', covers: ['kit.inlineChip'],
  states: {
    typical: stage(['typical', 'variant', 'size'], ({ root }) => { put(root, at('s'), at('m'), at('l')); }, { width: 720 }),
    'wrapping line': stage(['long'], ({ root }) => { put(root, at('l')); }, { width: 320 }),
    long: stage(['long'], ({ root }) => { put(root, '<p class="k7-type-l">See ' + kit.html.inlineChip({ kind: 'reference', text: 'apps/desktop/ui/src/components/v7/inline.ts:120' }) + ' first.</p>'); }, { width: 640 })
  }
} satisfies Story;
