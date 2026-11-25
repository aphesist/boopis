/* The app's surfaces already on the v7 kit (w33/shell-bots; DESIGN-SYSTEM.md v7 7, 12, 19 and 21; screens 11 to 13): the floating
   chrome, the open sidebar's head and foot, the Bots roster and its rooms, the rail, a bot's chat and a room. Each state boots the
   whole app and scopes the checks to the part that is v7 already, so the v7 rules block on it (LAB_V7_BLOCKING "kit" counts
   stories/v7/ as the kit's); what is still v6 inside a view (the composer, the Archived group, a room's header, huddles, the
   presence entry) is left to the bots/ and shell/ stories. They run in v7's two themes, dark and light. */
import type { AppCtx, ProviderSpec, State, Story } from '../../types';
import { railRoster, railSettled } from '../../rail-fixtures';
import { ORB3_MOTION } from '../kit/_bots';

/* the orbs move (orb3's state life); the dock is on the kit (v7/dock) */
const V6_ELSEWHERE = { 'orb.edges': ORB3_MOTION } as const;
const st = (tags: State['tags'], provider: ProviderSpec, setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider: { sessions: 'none', ...provider }, setup }, allow: V6_ELSEWHERE, ...extra });   /* no session: its turns are v6 (w33/session-s0) */
const MOCK = { url: '/v6/__index.html', note: 'the v6 mock has no v7 surfaces: the approved v7 boards are screens 11, 12 and 13 (ds-v7)' };
const bots = async (c: AppCtx): Promise<void> => { c.hx.setState({ tab: 'bots' }); await c.wait(500); };
const pick = (id: string) => async (c: AppCtx): Promise<void> => { await bots(c); c.hx.emit('hx:bot-select', { id, from: 'lab' }); await c.wait(600); };
const room = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-group-rows > [data-kit~="ListRow"]'); await c.wait(700); };
const rail = (open?: string) => async (c: AppCtx): Promise<void> => {
  await bots(c);
  if (open) { c.hx.emit('hx:bot-select', { id: open, from: 'lab' }); await c.wait(200); }
  c.hx.setState({ left: 'rail' }); await c.wait(600);
  const bad = await railSettled();
  if (bad.length) throw new Error('the rail is laid out wrong: ' + bad.join('; '));
};

const chrome: Story = {
  id: 'v7/chrome', title: 'Chrome (v7)', area: 'shell', kind: 'surface', covers: ['surface:title-bar'], scope: '#hx-chrome', mock: MOCK,
  states: {
    'the Sessions tab': st(['typical'], {}, async (c) => { await c.wait(300); }, { note: 'the toggle, the title pill with a session\'s glyph ("New session"), the search hint, details and the window glyphs (board 05 A, P2 S5)' }),
    'a bot open': st(['typical', 'owner'], {}, pick('nina'), { note: 'the title pill carries the bot\'s orb (24) and name (15); it opens the details' }),
    'a room open': st(['variant'], { fixtures: ['groups'] }, room, { note: 'a room\'s title pill: its members\' stack and its name (screen 12)' }),
    'a long name': st(['long'], { fixtures: ['long'] }, pick('cassiopeia-staging-deploy-guardian')),
    'no bots, no sessions': st(['empty'], { sessions: 'none', bots: 'none' }, async (c) => { await c.wait(300); }),
    'the search hint hovered': st(['hover'], {}, async (c) => { await c.wait(300); }, { force: [{ sel: '#hx-btn-search', state: 'hover' }] }),
    'the search hint focused': st(['focus'], {}, async (c) => { await c.wait(300); }, { force: [{ sel: '#hx-btn-search', state: 'focus' }] }),
    'the title pill pressed': st(['active'], {}, pick('kai'), { force: [{ sel: '#hx-btn-title', state: 'active' }] })
  }
};

const sidebar: Story = {
  id: 'v7/sidebar', title: 'Sidebar (v7)', area: 'shell', kind: 'surface', covers: ['surface:sidebar', 'surface:bots-roster'], scope: '#hx-list-bots .bt-rows', mock: MOCK,
  states: {
    'the roster': st(['typical', 'owner'], {}, pick('nina'), { note: 'a ListRow per bot: its 36 orb at rest, its name, "Needs you: ..." in amber, what it is doing, or its role' }),
    'one bot': st(['single'], { bots: 'one' }, bots),
    'no bots': st(['empty'], { bots: 'none' }, bots),
    'a long name and the made-outside mark': st(['long'], { fixtures: ['long', 'outside'] }, bots),
    '120 bots, scrolling': st(['many', 'scroll'], { bots: 120 }, bots),
    'a row hovered': st(['hover'], {}, bots, { force: [{ sel: '#hx-list-bots .bt-rows > [data-kit~="ListRow"]:nth-of-type(3)', state: 'hover' }] }),
    'a row focused': st(['focus'], {}, bots, { force: [{ sel: '#hx-list-bots .bt-rows > [data-kit~="ListRow"]:nth-of-type(2)', state: 'focus' }] }),
    'the head: Sessions / Bots and New': st(['variant'], {}, async (c) => { await c.wait(300); }, { scope: '.hx-side__head' }),
    'the head, New hovered': st(['hover'], {}, async (c) => { await c.wait(300); }, { scope: '.hx-side__head', force: [{ sel: '#hx-btn-new', state: 'hover' }] }),
    'the foot: you, Store, Settings': st(['variant'], {}, async (c) => { await c.wait(300); }, { scope: '#hx-foot' }),
    'the groups': st(['variant'], { fixtures: ['groups', 'paper-past'] }, bots, { scope: '#hx-list-bots .bt-groups', note: '"Groups", a row per room with its stack (24) and its last words, New group' }),
    'the groups, a room open': st(['variant'], { fixtures: ['groups', 'paper-past'] }, room, { scope: '#hx-list-bots .bt-groups' })
  }
};

const railStory: Story = {
  id: 'v7/rail', title: 'Rail (v7)', area: 'bots', kind: 'surface', covers: ['surface:bots-rail'], scope: '#hx-rail', mock: MOCK,
  states: {
    'the owner\'s seven and two groups': st(['typical', 'owner'], { patch: railRoster(7, 2) }, rail('iris')),
    'no bots, no groups': st(['empty'], { patch: railRoster(0, 0) }, rail()),
    'twelve bots, five groups': st(['many', 'long', 'scroll'], { patch: railRoster(12, 5) }, rail('iris')),
    'a tile hovered': st(['hover'], { patch: railRoster(7, 2) }, rail('iris'), { force: [{ sel: '#hx-rail .k7-tile:nth-of-type(3)', state: 'hover' }] }),
    'a tile focused': st(['focus'], { patch: railRoster(7, 2) }, rail('iris'), { force: [{ sel: '#hx-rail .k7-tile:nth-of-type(2)', state: 'focus' }] })
  }
};

const chat: Story = {
  id: 'v7/bot-chat', title: 'Bot chat (v7)', area: 'bots', kind: 'surface', covers: ['surface:bots-room'], scope: '#hx-view-bots .bt-room:not(.bt-group) .bt-log', mock: MOCK,
  states: {
    'nina asks (the AskCard)': st(['typical', 'owner'], {}, pick('nina'), { note: 'the bot\'s bubble, then its approval: Hold to allow once and Deny (screen 11)' }),
    'atlas (a thread)': st(['typical'], {}, pick('atlas'), { note: 'your bubble in the bot\'s derived fill (18.1), the bot\'s on --bubble-agent' }),
    'kai (no thread yet)': st(['empty'], {}, pick('kai')),
    'a long name': st(['long'], { fixtures: ['long'] }, pick('cassiopeia-staging-deploy-guardian')),
    'a turn hovered: its actions': st(['hover'], {}, pick('atlas'), { force: [{ sel: '#hx-view-bots .bt-turn[data-kind="bot"]', state: 'hover' }] })
  }
};

const roomStory: Story = {
  id: 'v7/room', title: 'Room (v7)', area: 'bots', kind: 'surface', covers: ['surface:bots-group'], scope: '#hx-view-bots .bt-group .bt-log', mock: MOCK,
  states: {
    'release crew': st(['typical', 'owner'], { fixtures: ['groups'] }, room, { note: 'each member\'s name in its colour above its first bubble and its orb at that bubble\'s foot; yours in ink (screen 12)' }),
    'a long group name': st(['long'], { fixtures: ['groups', 'long'] }, room),
    'release crew, larger (112%)': st(['size', 'variant'], { fixtures: ['groups'] }, room, { zoom: 1.12 })
  }
};

export default [chrome, sidebar, railStory, chat, roomStory];
