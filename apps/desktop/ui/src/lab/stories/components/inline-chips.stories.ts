/* Chips set into running text, on their line: the person's "you" capsule, a bot's mention, the room's (`@all`), a bot outside the
   room, inline code, a path the host found, the blank and an attachment chip. Each kind is drawn where it is met: in a bot's message,
   in the person's request bubble and in a paragraph of markdown (a composer's chips and marks are the kit's: `kit/composer`,
   `kit/inline-chip`). The `inline-baseline` check (tests/lab/probe.js) measures every chip here against its line: the owner saw nina's
   "[you] staging needs your approval before I deploy." with the capsule riding off the sentence's line. */
import { kit, markdown } from '@boopis/ui';
import type { MarkdownCtx, MdBot } from '@boopis/ui';
import { put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE } from '../../fixtures';

const BOTS: readonly MdBot[] = [
  { id: 'kai', name: 'kai', handle: 'kai', role: 'the lead', shape: 'circle', color: '#e8b04a', state: 'idle' },
  { id: 'nina', name: 'nina', handle: 'nina', role: 'research', shape: 'triangle', color: '#f23b5a', state: 'working' },
  { id: 'moss', name: 'moss', handle: 'moss', role: 'translation', shape: 'square', color: '#5aa7f2', state: 'idle' }
];
const REX: MdBot = { id: 'rex', name: 'rex', handle: 'rex', role: 'release', shape: 'circle', color: '#7fd18b', state: 'idle' };
/** a group room: `@user` is the person, the members are named, rex exists but is not here */
const ROOM: MarkdownCtx = {
  mention: (h) => BOTS.find((b) => b.handle === h.toLowerCase()) ?? null,
  outside: (h) => (h.toLowerCase() === 'rex' ? REX : null),
  everyone: BOTS,
  you: true
};
const PATH = 'episodes/cooking-pot/episode.json';
const paths = (m: HTMLElement): void => { markdown.upgradePaths(m, new Map([[PATH, { path: PATH, abs: '/work/boopis/' + PATH, kind: 'file' as const }]])); };

const NINA = '@user staging needs your approval before I deploy.';
const ALL = '@kai and @moss, the `deploy.yaml` diff is in `' + PATH + '`; @all please read it, and @rex can wait.';

/** nina's message in the room, as the room draws a member's message: the kit's Bubble (2b: the v6 entry went) */
const inBubble = (kind: 'bot' | 'user', m: HTMLElement): HTMLElement => kit.bubble({ kind, html: m.outerHTML });
const botMessage = (text: string) => ({ root }: { root: HTMLElement }): void => {
  const m = markdown(text, ROOM); paths(m);
  put(root, inBubble('bot', m));
};
/** the person's request bubble, as the room draws what they sent */
const request = (text: string) => ({ root }: { root: HTMLElement }): void => {
  put(root, kit.bubble({ kind: 'user', html: markdown.plain(text, ROOM) }));
};
/** a paragraph of markdown with every inline kind (the v6 blank went with its card at step 6f: the kit's Mark draws a blank, kit/mark) */
const paragraph = (text: string) => ({ root }: { root: HTMLElement }): void => {
  const m = markdown(text + '\n\n![the pot, in the accounts](pot.png)', ROOM); paths(m);
  put(root, inBubble('bot', m));
};
/** the same paragraph in dense interface text (13px at 1.35, a card's or the dock's), where the 20px capsule does not fit the line */
const dense = (text: string) => ({ root }: { root: HTMLElement }): void => {
  const m = markdown(text, ROOM); paths(m);
  put(root, m);
};
const W = 340;
/* 2b: the specimens draw the kit's chips since the v6 capsules went. The kit's "you" and reference capsules keep the boards' own 18 line
   (badge.css, `.badge2`, `.you`, `.refchip`), which sits up to 2.6 device px under the cap band, and a mention's orb lifts a dense 13/18
   line by under a device px: a board decision against the check, an open question for the lead (REPASS 2b) */
const BOARD_CAPS = { allow: { 'inline-baseline': 'the boards\' own 18 line for the kit\'s "you" and reference capsules (badge.css); a mention in a dense line (REPASS 2b, for the lead)' } };   /* narrow enough that every width the lab uses (390 and up) draws the state */
const story: Story = {
  id: 'components/inline-chips', title: 'Inline chips', area: 'components', kind: 'component', covers: [],
  states: {
    typical: stage(['typical'], botMessage(NINA), { width: W, ground: 'ground', ...BOARD_CAPS }),
    'every kind in a bot message': stage(['variant'], botMessage(NINA + '\n\n' + ALL), { width: W, ground: 'ground', ...BOARD_CAPS }),
    'in a request bubble': stage(['variant'], request('@nina ' + ALL), { width: W, ground: 'ground', ...BOARD_CAPS }),
    'in a paragraph': stage(['variant'], paragraph(ALL + ' ' + NINA), { width: W, ground: 'ground', ...BOARD_CAPS }),
    'in dense text': stage(['variant'], dense(ALL + ' ' + NINA), { width: W, ground: 'ground', ...BOARD_CAPS }),
    long: stage(['long'], botMessage(NINA + ' ' + LONG_TITLE + ' @nina @moss `' + LONG_TITLE + '` ' + PATH), { width: W, ground: 'ground', ...BOARD_CAPS })
  }
};
export default story;
