/* The dock (14.12): pitch black in every theme, centred, its pages, its modes, a bot's session in it, and the owner's
   cases: zero bots (the empty shape), one bot, eleven (the mock), a hundred and more; hovering and opening must not
   flicker (the stability check samples frames while the interaction plays). The dock agent (w11/empty-dock) fixes; this
   covers. */
import type { AppCtx, Interaction, ProviderSpec, State, Story } from '../../types';

const SCOPE = '#hx-dock';
/** The page dots tile the nub at a 10 px pitch (a 4 px mark, a 14 px pill for the current page; 14.12). R-a11y-2 names them: a mark smaller
    than --hit-min gets a hit area of 24 around it, and each dot has one, 24 px tall through ::after (the probe measures it). At this pitch a
    24 px wide area per dot would cover its neighbour's centre, so the dots cannot be 24 wide; the checker's size and spacing test cannot
    hold for them. Only the dots are excused (`el`): the dock's other targets, the orbs and the buttons, are still checked. */
const PAGE_DOTS = { 'geometry.target': { el: 'ui-pages__dot', reason: 'the page dots: R-a11y-2 names them, each has a 24 px tall hit area around its mark, and a 24 px wide one would cover its neighbour at the 10 px pitch of the nub (14.12)' } } as const;
const dockState = (tags: State['tags'], provider: ProviderSpec, setup?: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State =>
  ({ tags, app: { provider, ...(setup ? { setup } : {}) }, ...extra, allow: { ...PAGE_DOTS, ...(extra.allow ?? {}) } });
const mode = (m: string) => async (c: AppCtx): Promise<void> => { c.hx.dock()?.setMode(m); await c.wait(900); };
const page = (id: string) => async (c: AppCtx): Promise<void> => { c.hx.dock()?.setMode('expanded'); await c.wait(600); c.hx.dock()?.goPage(id); await c.wait(700); };

/** what the owner saw flicker: hovering along the row, opening and closing a bot's session, expanding and collapsing */
const HOVER_ROW: Interaction = { name: 'hover along the row', watch: SCOPE, steps: [{ do: 'hover', sel: '#hx-dock .dk-bot >> nth=0', ms: 250 }, { do: 'hover', sel: '#hx-dock .dk-bot >> nth=2', ms: 250 }, { do: 'hover', sel: '#hx-dock .dk-bot >> nth=4', ms: 250 }, { do: 'move-away', ms: 300 }], sample: 900 };
const OPEN_CLOSE: Interaction = { name: 'open a bot, close it', watch: SCOPE, steps: [{ do: 'click', sel: '#hx-dock .dk-bot >> nth=1', ms: 900 }, { do: 'press', key: 'Escape', ms: 200 }], sample: 1100 };
const EXPAND: Interaction = { name: 'expand and collapse', watch: SCOPE, steps: [{ do: 'call', js: '__lab.hx.dock().setMode("expanded")', ms: 900 }, { do: 'call', js: '__lab.hx.dock().setMode("normal")' }], sample: 1100 };
const MINIMISE: Interaction = { name: 'minimise and restore', watch: SCOPE, steps: [{ do: 'call', js: '__lab.hx.dock().setMode("minimal")', ms: 900 }, { do: 'call', js: '__lab.hx.dock().setMode("normal")' }], sample: 1100 };
const PAGES: Interaction = { name: 'switch pages', watch: SCOPE, steps: [{ do: 'call', js: '__lab.hx.dock().goPage("run")', ms: 700 }, { do: 'call', js: '__lab.hx.dock().goPage("bots")' }], sample: 1000 };
const HOVER_EMPTY: Interaction = { name: 'hover the empty dock', watch: SCOPE, steps: [{ do: 'hover', sel: '#hx-dock .dk', ms: 400 }, { do: 'move-away', ms: 300 }], sample: 900 };

const dock: Story = {
  id: 'dock/dock', title: 'Dock', area: 'dock', kind: 'surface', covers: ['surface:dock'], scope: SCOPE,
  mock: { url: '/v6/dock.test.html' },
  states: {
    'at rest (11 bots)': dockState(['typical', 'owner'], {}, undefined, { interact: [HOVER_ROW, OPEN_CLOSE, EXPAND, MINIMISE, PAGES] }),
    'no bots (the empty shape)': dockState(['empty', 'owner'], { bots: 'none' }, undefined, { interact: [HOVER_EMPTY, EXPAND, MINIMISE] }),
    'no bots, expanded': dockState(['empty', 'owner'], { bots: 'none' }, mode('expanded')),
    'one bot': dockState(['single', 'owner'], { bots: 'one' }, undefined, { interact: [HOVER_ROW] }),
    'one bot, expanded': dockState(['single', 'owner'], { bots: 'one' }, mode('expanded')),
    '120 bots': dockState(['many', 'owner'], { bots: 120 }, undefined, { interact: [HOVER_ROW] }),
    '120 bots, expanded': dockState(['many', 'owner', 'scroll'], { bots: 120 }, mode('expanded')),
    'a long-named bot': dockState(['long'], { fixtures: ['long'] }),
    'a long-named bot, its session': dockState(['long'], { fixtures: ['long'] }, async (c) => { c.hx.dock()?.openSession('cassiopeia-staging-deploy-guardian'); await c.wait(900); }),
    expanded: dockState(['open'], {}, mode('expanded')),
    minimised: dockState(['variant'], {}, mode('minimal')),
    off: dockState(['disabled'], {}, async (c) => { c.hx.dock()?.setOn(false); await c.wait(700); }, { allow: { 'geometry.contain': 'the dock is off: nothing to check' } }),
    "nina's session (an approval)": dockState(['typical', 'owner'], {}, async (c) => { c.hx.dock()?.openSession('nina'); await c.wait(900); }),
    "atlas's session (a thread)": dockState(['typical'], {}, async (c) => { c.hx.dock()?.openSession('atlas'); await c.wait(900); }),
    'the run page': dockState(['variant'], {}, page('run')),
    'the waiting page': dockState(['variant'], {}, page('wait')),
    'the schedules page': dockState(['variant'], {}, page('sched')),
    'no waits, no schedules (one bot)': dockState(['empty'], { bots: 'one' }, page('wait')),
    'orb hover': dockState(['hover'], {}, undefined, { force: [{ sel: '#hx-dock .dk-bot:nth-of-type(2)', state: 'hover' }] }),
    'orb focus': dockState(['focus'], {}, async (c) => { c.$('#hx-dock .dk-bot').focus(); await c.wait(200); }, { force: [{ sel: '#hx-dock .dk-bot:first-of-type', state: 'focus' }] }),
    'orb tooltip': dockState(['tooltip'], {}, async (c) => { const b = c.$('#hx-dock .dk-bot'); b.focus(); const t = b.closest<HTMLElement>('[data-tip]') ?? b; c.hx.ui.tooltip.show(t); await c.wait(250); })
  }
};

export default [dock];
