/* InlineChip (21.2 row 30; LAB-v7: mention, you, reference, code, model, countdown; at 13, 14, 15 px text; rest, wrapping line). */
import { kit } from '@boopis/ui';
import { put, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import { KAI, MOSS, NINA } from '../../../lab/stories/kit/_bots';

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
    long: stage(['long'], ({ root }) => { put(root, '<p class="k7-type-l">See ' + kit.html.inlineChip({ kind: 'reference', text: 'apps/desktop/ui/src/components/v7/inline.ts:120' }) + ' first.</p>'); }, { width: 640 }),

    /* board 12: a member's mention in a message (a control: it opens the bot), the whole room, a bot that is not here, a source */
    'in a message: mentions and a source': stage(['variant', 'owner'], ({ root }) => {
      put(root, '<p class="k7-type-l">' + kit.html.inlineChip({ kind: 'mention', bot: KAI, colour: KAI.color, action: true, label: 'kai. Open its chat' }) + ' write the notes, ' + kit.html.inlineChip({ kind: 'mention', text: '@all', members: [KAI, NINA, MOSS], action: true, label: '@all: kai, nina and moss' }) + ' read them, ' +
        kit.html.inlineChip({ kind: 'mention', bot: MOSS, out: true, label: "moss isn't in this room" }) + ' cannot. See ' + kit.html.inlineChip({ kind: 'cite', text: 'WebKit bug 27611', href: 'https://bugs.webkit.org/show_bug.cgi?id=27611' }) + '.</p>');
    }, { width: 560 }),
    'a mention hovered, a source hovered': stage(['hover'], ({ root }) => {
      put(root, '<p class="k7-type-l">' + kit.html.inlineChip({ kind: 'mention', bot: KAI, colour: KAI.color, action: true, label: 'kai. Open its chat' }) + ' and ' + kit.html.inlineChip({ kind: 'cite', text: 'WebKit bug 27611', href: 'https://bugs.webkit.org/show_bug.cgi?id=27611' }) + '</p>');
    }, { width: 360, force: [{ sel: 'button.k7-mention', state: 'hover' }, { sel: '.k7-cite', state: 'hover' }] }),
    'a mention focused': stage(['focus'], ({ root }) => { put(root, '<p class="k7-type-l">Ask ' + kit.html.inlineChip({ kind: 'mention', bot: NINA, colour: NINA.color, action: true, label: 'nina. Open its chat' }) + ' first.</p>'); }, { width: 360, force: [{ sel: 'button.k7-mention', state: 'focus' }] }),
    /* in a composer's text (owner, 25 November): each chip one unit, its own text the words that are sent */
    'in a composer: chips of the text': stage(['variant', 'owner'], ({ root }) => {
      put(root, '<p class="k7-type-m">' + kit.html.inlineChip({ kind: 'mention', bot: KAI, colour: KAI.color, words: '@kai' }) + ' check ' + kit.html.inlineChip({ kind: 'reference', text: '@notes.md', words: '@/home/you/notes.md' }) + ' with ' + kit.html.inlineChip({ kind: 'mention', text: '@all', members: [KAI, NINA, MOSS], words: '@all' }) + ' and tell ' + kit.html.inlineChip({ kind: 'you', words: '@user' }) + '</p>');
    }, { width: 560 })
  }
} satisfies Story;
