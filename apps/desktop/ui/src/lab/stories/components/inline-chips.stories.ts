/* Chips set into running text, on their line: the person's "you" capsule, a bot's mention, the room's (`@all`), a bot outside the
   room, a model mention and feedforward marks in the composer, inline code, a path the host found, the blank and an attachment chip.
   Each kind is drawn where it is met: in a bot's message, in the person's request bubble, in a paragraph of markdown and in the
   composer. The `inline-baseline` check (tests/lab/probe.js) measures every chip here against its line: the owner saw nina's
   "[you] staging needs your approval before I deploy." with the capsule riding off the sentence's line. */
import { ui, html } from '@boopis/ui';
import type { MarkdownCtx, MdBot, MentionSource } from '@boopis/ui';
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
const paths = (m: HTMLElement): void => { ui.markdown.upgradePaths(m, new Map([[PATH, { path: PATH, abs: '/work/boopis/' + PATH, kind: 'file' as const }]])); };

const NINA = '@user staging needs your approval before I deploy.';
const ALL = '@kai and @moss, the `deploy.yaml` diff is in `' + PATH + '`; @all please read it, and @rex can wait.';

/** nina's message in the room, as the room draws a member's message */
const botMessage = (text: string) => ({ root }: { root: HTMLElement }): void => {
  const m = ui.markdown(text, ROOM); paths(m);
  const e = ui.entry({ kind: 'agent', who: 'nina', callno: ['09:14'], label: 'nina, 09:14' });
  e.querySelector('.ui-entry__body')?.append(m);
  put(root, e);
};
/** the person's request bubble, as the room draws what they sent */
const request = (text: string) => ({ root }: { root: HTMLElement }): void => {
  const e = ui.entry({ kind: 'user', who: 'you', callno: ['09:13'], body: html.request(''), label: 'You, 09:13' });
  const b = e.querySelector<HTMLElement>('.ui-request');
  if (b) b.innerHTML = ui.markdown.plain(text, ROOM);
  put(root, e);
};
/** a paragraph of markdown with every inline kind, and the blank at its end */
const paragraph = (text: string) => ({ root }: { root: HTMLElement }): void => {
  const m = ui.markdown(text + '\n\n![the pot, in the accounts](pot.png)', ROOM); paths(m);
  const p = document.createElement('p'); p.innerHTML = 'Which year does the pot hang from? ' + html.blank() + ' and the answer so far: ' + html.blank({ answer: '1300' });
  m.append(p);
  const e = ui.entry({ kind: 'agent', who: 'nina', callno: ['09:15'], label: 'nina, 09:15' });
  e.querySelector('.ui-entry__body')?.append(m);
  put(root, e);
};
/** the same paragraph in dense interface text (13px at 1.35, a card's or the dock's), where the 20px capsule does not fit the line */
const dense = (text: string) => ({ root }: { root: HTMLElement }): void => {
  const m = ui.markdown(text, ROOM); paths(m);
  const p = document.createElement('p'); p.innerHTML = 'Which year does the pot hang from? ' + html.blank() + ' and the answer so far: ' + html.blank({ answer: '1300' });
  m.append(p);
  put(root, m);
};
/** the room's composer: "@" names a member, the room or the person, drawn as the capsule the sent message will show */
const roomMentions: MentionSource = {
  label: 'Bring in', query: () => null, entries: () => [], best: () => null, write: () => null,
  find: (t) => ui.markdown.spans(t, ROOM).map((s) => ({ at: s.at, text: s.text, kind: 'bot', ...ui.markdown.chip(s) }))
};
/** the session's composer: "@" names the model that answers this message, a quiet capsule; feedforward marks read the text */
const MODELS = ['@Claude Haiku'];
const modelMentions: MentionSource = {
  label: 'Answer this message with', query: () => null, entries: () => [], best: () => null, write: () => null,
  find: (t) => MODELS.flatMap((w) => { const at = t.indexOf(w); return at >= 0 ? [{ at, text: w, kind: 'mention' }] : []; })
};
const feedforward = (t: string): Array<{ text: string; kind: string; confirmed?: boolean; at: number }> =>
  [['integer cents', false], ['src/billing', true]].flatMap(([w, confirmed]) => { const at = t.indexOf(w as string); return at >= 0 ? [{ text: w as string, kind: 'scope', confirmed: confirmed as boolean, at }] : []; });
const composer = (value: string, which: 'room' | 'session') => ({ root }: { root: HTMLElement }): void => {
  put(root, which === 'room'
    ? ui.composer({ placeholder: 'Message the group', label: 'Message the group', attach: false, mentions: roomMentions, value })
    : ui.composer({ placeholder: 'Message', label: 'Message', attach: false, mentions: modelMentions, feedforward, value }));
};

const W = 340;   /* narrow enough that every width the lab uses (390 and up) draws the state */
const story: Story = {
  id: 'components/inline-chips', title: 'Inline chips', area: 'components', kind: 'component', covers: [],
  states: {
    typical: stage(['typical'], botMessage(NINA), { width: W, ground: 'ground' }),
    'every kind in a bot message': stage(['variant'], botMessage(NINA + '\n\n' + ALL), { width: W, ground: 'ground' }),
    'in a request bubble': stage(['variant'], request('@nina ' + ALL), { width: W, ground: 'ground' }),
    'in a paragraph': stage(['variant'], paragraph(ALL + ' ' + NINA), { width: W, ground: 'frame' }),
    'in dense text': stage(['variant'], dense(ALL + ' ' + NINA), { width: W, ground: 'frame' }),
    'in the room composer': stage(['variant'], composer('@user @nina and @all: is @rex needed for the deploy?', 'room'), { width: W, ground: 'ground' }),
    'in the session composer': stage(['variant'], composer('@Claude Haiku move src/billing to integer cents', 'session'), { width: W, ground: 'ground' }),
    long: stage(['long'], botMessage(NINA + ' ' + LONG_TITLE + ' @nina @moss `' + LONG_TITLE + '` ' + PATH), { width: W, ground: 'ground' })
  }
};
export default story;
