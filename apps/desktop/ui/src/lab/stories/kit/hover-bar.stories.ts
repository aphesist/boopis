/* HoverBar (board 11's `.hoverbar`: copy, more): what a turn offers while the pointer or the focus is on it, beside its last bubble on
   that bubble's middle. One part for every thread: a bot's message, a room's member (in the gutter), a session's answer. */
import { kit } from '@boopis/ui';
import type { HoverAction } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';
import { KAI } from './_bots';
import { UNBROKEN } from '../../fixtures';

const thread = (...n: HTMLElement[]): HTMLElement => { const t = document.createElement('div'); t.className = 'k7-thread'; t.setAttribute('data-kit-part', 'Thread'); t.append(...n); return t; };
const ACTS: HoverAction[] = [{ value: 'copy', icon: 'copy', label: 'Copy kai’s message', tip: 'Copy', keys: 'C' }, { value: 'more', icon: 'more', label: 'More for kai’s message', tip: 'More', menu: true }];
const ROOM: HoverAction[] = [ACTS[0] as HoverAction, { value: 'reply', icon: 'at', label: 'Reply to kai', tip: 'Reply' }, { value: 'open', icon: 'bots', label: 'Open kai’s chat', tip: 'Open chat' }];
/** a bubble with its bar beside it, shown (`data-shown`) or as it rests until the turn is hovered */
const turn = (bubble: HTMLElement, o: { shown?: boolean; actions?: HoverAction[] } = {}): HTMLElement => {
  const t = thread(bubble);
  const b = bubble.matches('[data-kit~="Bubble"]') ? bubble : bubble.querySelector<HTMLElement>('[data-kit~="Bubble"]') as HTMLElement;
  kit.hoverBeside(kit.hoverBar({ label: 'Actions on kai’s message', actions: o.actions ?? ACTS, ...(o.shown === false ? {} : { attrs: { 'data-shown': '' } }) }), b);
  return t;
};
const typical = stage(['typical', 'owner'], ({ root }) => { fill(root, turn(kit.bubble({ kind: 'agent', text: 'The notes are in two sections: one screen for people, one for the Local API.' }))); }, { width: 720 });
export default {
  id: 'kit/hover-bar', title: 'HoverBar', area: 'composer', kind: 'component', covers: ['kit.hoverBar'],
  states: {
    typical,
    'an action hovered': { ...typical, tags: ['hover'], force: [{ sel: '.k7-hoverbar .k7-ib', state: 'hover' }] },
    'an action focused': { ...typical, tags: ['focus'], force: [{ sel: '.k7-hoverbar .k7-ib', state: 'focus' }] },
    'an action pressed': { ...typical, tags: ['active'], force: [{ sel: '.k7-hoverbar .k7-ib', state: 'active' }] },
    'at rest: nothing shows until the turn is hovered': stage(['variant'], ({ root }) => { fill(root, turn(kit.bubble({ kind: 'agent', text: 'The notes are in two sections.' }), { shown: false })); }, { width: 720 }),
    'in the gutter: a session\'s answer': stage(['variant', 'owner'], ({ root }) => { fill(root, turn(kit.bubble({ kind: 'agent', brand: 'claude-sonnet-4.5', text: 'Fixed. The pages are centred by layout now, and the tests pass.' }))); }, { width: 720 }),
    'in the gutter: a room\'s member, with reply and open': stage(['variant'], ({ root }) => { fill(root, turn(kit.bubble({ kind: 'bot', byline: { bot: KAI, colour: KAI.color }, text: 'The notes are ready.' }), { actions: ROOM })); }, { width: 720 }),
    long: stage(['long', 'size'], ({ root }) => { fill(root, turn(kit.bubble({ kind: 'agent', text: 'The file is ' + UNBROKEN + ' and it is long enough to fill the column.' }))); }, { width: 420 }),
    'the more menu, open': stage(['open'], async ({ root, wait }) => {
      fill(root, turn(kit.bubble({ kind: 'agent', text: 'The notes are in two sections.' })));
      const more = root.querySelector<HTMLElement>('[data-act="more"]');
      if (more) kit.openMenu(more, { label: 'More', place: 'below', align: 'start', entries: [{ label: 'Copy as Markdown', icon: 'copy', value: 'md' }] });
      await wait(200);
    }, { width: 720, overlay: { anchor: '[data-act="more"]', layer: '.k7-menu[data-floating]' } })
  }
} satisfies Story;
