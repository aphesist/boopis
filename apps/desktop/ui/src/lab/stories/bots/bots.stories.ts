/* The Bots tab: the roster (rail and open), a bot's room and thread, its settings sheet, a new bot (the dice: eyes are
   never user-settable, they belong to states; the dice agent, w11/dice, fixes), the Archived group and the "made outside
   boopis" mark, with no bots, one, many and long names. */
import type { AppCtx, ProviderSpec, State, Story } from '../../types';

const bots = async (c: AppCtx): Promise<void> => { c.hx.setState({ tab: 'bots' }); await c.wait(500); };
const pick = (id: string) => async (c: AppCtx): Promise<void> => { await bots(c); c.hx.emit('hx:bot-select', { id, from: 'lab' }); await c.wait(500); };
const st = (tags: State['tags'], provider: ProviderSpec, setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, setup }, ...extra });
const MOCK = { url: '/v6/__index.html', note: 'the mock opens on the session; its Bots tab is alt+2' };

const roster: Story = {
  id: 'bots/roster', title: 'Bots roster', area: 'bots', kind: 'surface', covers: ['surface:bots-roster'], scope: '#hx-side', mock: MOCK,
  states: {
    typical: st(['typical'], {}, bots),
    'no bots': st(['empty', 'owner'], { bots: 'none' }, bots),
    'one bot': st(['single'], { bots: 'one' }, bots),
    '120 bots, scrolling': st(['many', 'scroll'], { bots: 120 }, bots, { allow: { axe: 'axe-core reports label-content-name-mismatch (WCAG 2.5.3, R-a11y-1) only for the row that straddles the window\'s bottom edge (bot-017 at 1440 x 900, then bot-034 once scrolled); the same row, with the same name "bot-017, generated teammate 17, needs you" and the same visible words, passes when moved 100 px up, so it is the checker\'s clipping of a half-visible row and not the name, which holds every visible word in order (botLabel, R-a11y-1)' } }),
    'a long name and the made-outside mark': st(['long'], { fixtures: ['long', 'outside'] }, bots),
    'archived group open': st(['variant', 'open'], { fixtures: ['outside'] }, async (c) => { await bots(c); await c.click('.bt-archived .ui-group__head'); await c.wait(300); }),
    rail: st(['variant'], {}, async (c) => { await bots(c); c.hx.setState({ left: 'rail' }); await c.wait(500); }),
    'row hover': st(['hover'], {}, bots, { force: [{ sel: '#hx-list-bots li:nth-of-type(2) .ui-row', state: 'hover' }] }),
    'row focus': st(['focus'], {}, bots, { force: [{ sel: '#hx-list-bots .ui-row', state: 'focus' }] })
  }
};

const room: Story = {
  id: 'bots/room', title: 'Bot room', area: 'bots', kind: 'surface', covers: ['surface:bots-room'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    'nina (an approval)': st(['typical', 'owner'], {}, pick('nina')),
    'atlas (a thread)': st(['typical'], {}, pick('atlas')),
    'kai (no thread yet)': st(['empty'], {}, pick('kai')),
    'a long name': st(['long'], { fixtures: ['long'] }, pick('cassiopeia-staging-deploy-guardian')),
    'made outside boopis': st(['variant'], { fixtures: ['outside'] }, pick('sage')),
    'no bots at all': st(['empty', 'owner'], { bots: 'none' }, bots),
    'composer send hover': st(['hover', 'owner'], {}, pick('atlas'), { force: [{ sel: '#hx-view-bots .ui-send', state: 'hover' }] }),
    'composer attach tooltip': st(['tooltip', 'owner'], {}, async (c) => { await pick('atlas')(c); const b = document.querySelector<HTMLElement>('#hx-view-bots .ui-composer__attach, #hx-view-bots .ui-composer__mic'); if (b) { b.focus(); c.hx.ui.tooltip.show(b); } await c.wait(250); }, { overlay: { anchor: '#hx-view-bots .ui-composer__attach, #hx-view-bots .ui-composer__mic', layer: '.ui-tip' } })
  }
};

const sheet: Story = {
  id: 'bots/settings-sheet', title: 'Bot settings sheet', area: 'bots', kind: 'surface', covers: ['surface:bots-sheet'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    nina: st(['typical'], {}, async (c) => { await pick('nina')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); }),
    'a long name': st(['long'], { fixtures: ['long'] }, async (c) => { await pick('cassiopeia-staging-deploy-guardian')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); }),
    'scrolled to the end': st(['scroll'], {}, async (c) => { await pick('nina')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); for (const n of document.querySelectorAll<HTMLElement>('#hx-view-bots [class*="sheet"] *')) if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop = n.scrollHeight; await c.wait(200); })
  }
};

const newBot: Story = {
  id: 'bots/new-bot', title: 'New bot', area: 'bots', kind: 'surface', covers: ['surface:bots-new'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    typical: st(['typical'], {}, async (c) => { await bots(c); c.hx.emit('hx:new-bot'); await c.wait(600); }, { allow: { 'stability.render': 'the dice and autoname pick at random' } }),
    'from no bots': st(['empty', 'owner'], { bots: 'none' }, async (c) => { await bots(c); c.hx.emit('hx:new-bot'); await c.wait(600); }, { allow: { 'stability.render': 'the dice and autoname pick at random' } }),
    'dice hover': st(['hover'], {}, async (c) => { await bots(c); c.hx.emit('hx:new-bot'); await c.wait(600); }, { force: [{ sel: '#hx-view-bots [aria-label*="Surprise"], #hx-view-bots .bt-dice', state: 'hover' }], allow: { 'stability.render': 'random by design' } })
  }
};

export default [roster, room, sheet, newBot];
