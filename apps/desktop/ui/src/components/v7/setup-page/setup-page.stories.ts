/* SetupPage (the first run's setup pages, boards O-P01 to O-P04): the whole window before the app, in each of its arrangements. */
import { kit } from '@boopis/ui';
import { stage } from '../../../lab/story';
import type { State, Story } from '../../../lab/types';
import type { SetupPageOpts } from './setup-page';

/** a window-sized stage: the page covers it, as it covers the window */
const page = (tags: State['tags'], o: SetupPageOpts, extra: Omit<State, 'tags' | 'render'> = {}): State => stage(tags, ({ root }) => {
  const box = document.createElement('div'); box.style.cssText = 'position:relative;height:900px;overflow:hidden';
  box.append(kit.setupPage(o)); root.append(box);
}, { ground: 'frame', ...extra });
const HELLO: SetupPageOpts = { title: 'Hi, I’m boopis', lede: 'A minute of setup here, then sessions, then your bots. I’ll walk you through it.', mark: 'hero', actions: [{ label: 'Let’s start', primary: true, value: 'start' }], skip: { label: 'Skip setup', value: 'skip' } };
const CARD = kit.html.card({ variant: 'settings', rows: [{ label: 'Show boopis’s tools directly', subHTML: '<span class="k7-mono">tools.tool_search.enabled = off</span>' }, { label: 'Route governed work to each model tier', subHTML: '<span class="k7-mono">delegation.backend = boopis</span>' }] });

export default {
  id: 'kit/setup-page', title: 'SetupPage', area: 'components', kind: 'component', covers: ['kit.setupPage'],
  states: {
    typical: page(['typical'], HELLO, { note: 'board O-P01: the hero logomark, one heading at 196, the actions at 640, Skip setup' }),
    'a card, two actions, no way out': page(['variant'], { title: 'Settings boopis needs', lede: 'boopis changes three engine settings, and only these. It asks before it changes any other.', bodyHTML: CARD, actions: [{ label: 'Apply the changes', primary: true, value: 'apply' }, { label: 'Not now', value: 'decline' }] }, { note: 'board O-P02' }),
    'a status in place of the actions': page(['loading'], { ...HELLO, actions: [], status: { text: 'Getting boopis ready', figure: '62%' } }, { note: 'board O-P01b' }),
    'a notice over the card': page(['error'], { title: 'A model to think with', lede: 'I found these on this computer, so you only need to confirm.', noticeHTML: kit.html.notice({ icon: 'clock', title: 'No internet right now.', text: ' Your answers are saved.', actions: [{ label: 'Try again', ghost: true, value: 'retry' }] }), bodyHTML: CARD, actions: [{ label: 'Use Claude', primary: true, value: 'use' }, { label: 'Add another', value: 'more' }], skip: { label: 'Skip setup', value: 'skip' } }, { note: 'board O-P03e' }),
    'a primary that works': page(['loading'], { ...HELLO, actions: [{ label: 'Let’s start', primary: true, value: 'start', busy: true }] }),
    'no window glyphs (a tiling desktop)': page(['variant'], { ...HELLO, windowControls: false }),
    long: page(['long'], { title: 'Settings boopis needs before it can start every session on this computer', lede: 'boopis changes three engine settings, and only these. It asks before it changes any other setting, on this computer or on any other one you set up later.', bodyHTML: CARD, actions: [{ label: 'Apply the changes to the engine settings now', primary: true, value: 'apply' }, { label: 'Not now', value: 'decline' }] }),
    'narrow (390)': page(['variant'], HELLO, { width: 390 }),
    'the primary hovered': page(['hover'], HELLO, { force: [{ sel: '[data-setup="start"]', state: 'hover' }] }),
    'the primary focused': page(['focus'], HELLO, { force: [{ sel: '[data-setup="start"]', state: 'focus' }] }),
    'the primary pressed': page(['active'], HELLO, { force: [{ sel: '[data-setup="start"]', state: 'active' }] }),
    'the way out focused': page(['focus'], HELLO, { force: [{ sel: '[data-setup="skip"]', state: 'focus' }] })
  }
} satisfies Story;
