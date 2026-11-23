/* The Bots tab's collapsed sidebar, the rail (DESIGN-SYSTEM 14.2): the Session | Bots switch, New bot, the bots, then the groups
   (each a cluster of its members' orbs) and New group, with no bots, one, the owner's seven and twelve, and no groups, one,
   the owner's two and five (two to six members). The owner's report, 0.1.9: "+ sign up there is over a bot, and the groups at
   the bottom are indistinguishible from bots themselves". Every state runs in each preset, dark and light. */
import type { AppCtx, ProviderSpec, State, Story } from '../../types';
import { railRoster, railSettled } from '../../rail-fixtures';
import type { RailBots, RailGroups } from '../../rail-fixtures';

const st = (tags: State['tags'], provider: ProviderSpec, setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, setup }, ...extra });
const roster = (b: RailBots, g: RailGroups): ProviderSpec => ({ patch: railRoster(b, g) });
/** the Bots tab in the rail, `pick` open (the owner's screenshot had iris open); the setup fails when the rail is laid out wrong */
const rail = (pick?: string) => async (c: AppCtx): Promise<void> => {
  c.hx.setState({ tab: 'bots' }); await c.wait(300);
  if (pick) { c.hx.emit('hx:bot-select', { id: pick, from: 'lab' }); await c.wait(200); }
  c.hx.setState({ left: 'rail' }); await c.wait(600);
  const bad = await railSettled();
  if (bad.length) throw new Error('the rail is laid out wrong: ' + bad.join('; '));
};
const openGroup = (gid: string) => async (c: AppCtx): Promise<void> => { await rail()(c); await c.click('.bt-groups .ui-row[data-gid="' + gid + '"]'); await c.wait(500); const bad = await railSettled(); if (bad.length) throw new Error('the rail is laid out wrong: ' + bad.join('; ')); };
const scrolledToEnd = async (c: AppCtx): Promise<void> => { await rail('iris')(c); const l = document.querySelector<HTMLElement>('#hx-list-bots'); if (l) l.scrollTop = l.scrollHeight; await c.wait(300); };
/** a row's tooltip, shown as keyboard focus shows it; not where the window is too narrow for a rail (under 640 the sidebar is a drawer and
    the rail takes no width), since a hidden row cannot be focused or pointed at */
const tipOn = (sel: string) => async (c: AppCtx): Promise<void> => {
  await rail('iris')(c);
  const b = document.querySelector<HTMLElement>(sel), side = document.querySelector<HTMLElement>('#hx-side');
  if (b && side && b.getBoundingClientRect().right <= side.getBoundingClientRect().right + 0.5) { b.focus(); c.hx.ui.tooltip.show(b); }
  await c.wait(250);
};
const MOCK = { url: '/v6/__index.html', note: 'the mock collapses to the rail with ctrl shift B; its Bots tab is alt+2' };

const story: Story = {
  id: 'bots/rail', title: 'Bots rail', area: 'bots', kind: 'surface', covers: ['surface:bots-rail'], scope: '#hx-side', mock: MOCK,
  states: {
    'the owner\'s seven and two groups': st(['typical', 'owner'], roster(7, 2), rail('iris'), { note: 'the switch, then New bot on its own row, the seven, a rule, the two groups as clusters of their members and New group' }),
    'no bots, no groups': st(['empty'], roster(0, 0), rail()),
    'one bot': st(['single'], roster(1, 0), rail()),
    'one bot, a group with one member left': st(['single', 'variant'], roster(1, 1), rail(), { note: 'release crew\'s other members are no longer bots of the user: its cluster is the one orb left' }),
    'seven bots, no groups': st(['variant'], roster(7, 0), rail('iris')),
    'seven bots, one group': st(['variant'], roster(7, 1), rail('iris')),
    'seven bots, five groups (two to six members)': st(['many', 'variant'], roster(7, 5), rail('iris'), { note: 'clusters of six, three, two, four and five members' }),
    'twelve bots, two groups': st(['many'], roster(12, 2), rail('iris')),
    'twelve bots, five groups': st(['many', 'scroll'], roster(12, 5), rail('iris'), { note: 'taller than the window: the list scrolls under the switch, and New bot stays above it' }),
    'twelve bots, five groups, scrolled to the end': st(['many', 'scroll'], roster(12, 5), scrolledToEnd),
    'a group open': st(['variant'], roster(7, 2), openGroup('room-paper'), { note: 'the current group wears the row\'s current fill, as a current bot does' }),
    'a bot hovered': st(['hover'], roster(7, 2), rail('iris'), { force: [{ sel: '#hx-list-bots .bt-rows li:nth-of-type(3) .ui-row', state: 'hover' }] }),
    'a group hovered': st(['hover'], roster(7, 2), rail('iris'), { force: [{ sel: '.bt-groups .ui-row[data-gid="room-paper"]', state: 'hover' }] }),
    'a group focused': st(['focus'], roster(7, 2), rail('iris'), { force: [{ sel: '.bt-groups .ui-row[data-gid="room-paper"]', state: 'focus' }] }),
    'New bot focused': st(['focus'], roster(7, 2), rail('iris'), { force: [{ sel: '.hx-rail__new', state: 'focus' }] }),
    'a group\'s tooltip': st(['tooltip'], roster(7, 2), tipOn('.bt-groups .ui-row[data-gid="room-paper"]'), { overlay: { anchor: '.bt-groups .ui-row[data-gid="room-paper"]', layer: '.ui-tip' } }),
    'New group\'s tooltip': st(['tooltip'], roster(7, 2), tipOn('.bt-groups [data-new-group]'), { overlay: { anchor: '.bt-groups [data-new-group]', layer: '.ui-tip' } }),
    'seven bots and five groups, larger (112%)': st(['size', 'variant'], roster(7, 5), rail('iris'), { zoom: 1.12 })
  }
};
export default story;
