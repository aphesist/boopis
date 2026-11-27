/* Tiles (the boopis bot's first-run cards, boards O-B02, O-B03): goals to pick and bots over their jobs. */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import type { Tile, TilesOpts } from './tiles';

const orb = (id: string, color: string, shape: string): string => kit.html.avatar({ bot: { id, name: id, color, shape, state: 'idle', attention: null } as never, size: 24, still: true });
const GOALS: Tile[] = [
  { label: 'Code and reviews', value: 'code', icon: 'code', chosen: true, colour: '#4fd1b5', leadHTML: orb('kai', '#4fd1b5', 'circle') },
  { label: 'Research and writing', value: 'research', icon: 'search' }, { label: 'Videos and posts', value: 'videos', icon: 'play' },
  { label: 'Data and reports', value: 'data', icon: 'sliders' }, { label: 'Inbox and calendar', value: 'inbox', icon: 'clock' }, { label: 'Something else', value: 'else', icon: 'more' }
];
const goals = (o: Partial<TilesOpts> = {}): TilesOpts => ({ label: 'What your bots work on first', head: 'Pick up to three. Each pick gets a bot.', tiles: GOALS, action: { label: 'Next' }, ...o });
const BOTS: TilesOpts = { variant: 'bots', label: 'Three bots I could make', tiles: [{ label: 'Reviews pull requests', value: 'kai', leadHTML: kit.html.avatar({ bot: { id: 'kai', name: 'kai', color: '#4fd1b5', shape: 'circle', state: 'idle', attention: null } as never, size: 40, still: true }) }, { label: 'Runs the tests at night', value: 'moss', leadHTML: kit.html.avatar({ bot: { id: 'moss', name: 'moss', color: '#22c55e', shape: 'squircle', state: 'idle', attention: null } as never, size: 40, still: true }) }], action: { label: 'Got it' }, note: 'Yours get their own jobs next' };

export default {
  id: 'kit/tiles', title: 'Tiles', area: 'components', kind: 'component', covers: ['kit.tiles'],
  states: {
    typical: stage(['typical'], ({ root }) => { fill(root, kit.tiles(goals())); }, { width: 608, note: 'board O-B03: one goal chosen, its bot in the tile' }),
    'none chosen': stage(['empty'], ({ root }) => { fill(root, kit.tiles(goals({ tiles: GOALS.map((t) => ({ ...t, chosen: false })), action: { label: 'Next', on: false } }))); }, { width: 608 }),
    bots: stage(['variant'], ({ root }) => { fill(root, kit.tiles(BOTS)); }, { width: 608, note: 'board O-B02' }),
    long: stage(['long'], ({ root }) => { fill(root, kit.tiles(goals({ tiles: GOALS.map((t) => ({ ...t, label: t.label + ' and everything else around it' })) }))); }, { width: 420 }),
    'a goal hovered': stage(['hover'], ({ root }) => { fill(root, kit.tiles(goals())); }, { width: 608, force: [{ sel: '.k7-tiles__tile[data-value="research"]', state: 'hover' }] }),
    'a goal focused': stage(['focus'], ({ root }) => { fill(root, kit.tiles(goals())); }, { width: 608, force: [{ sel: '.k7-tiles__tile[data-value="research"]', state: 'focus' }] }),
    'a goal pressed': stage(['active'], ({ root }) => { fill(root, kit.tiles(goals())); }, { width: 608, force: [{ sel: '.k7-tiles__tile[data-value="research"]', state: 'active' }] })
  }
} satisfies Story;
