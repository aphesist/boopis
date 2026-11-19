/* Whole-window layouts, at every width the checker runs (390, 1200, 1440, 1920): the empty app, a conversation on
   the mock, a live conversation over recorded gateway frames (real data), the Bots tab, Settings open, first run. */
import { runFirstRun } from '../../../host/first-run';
import type { AppCtx, ProviderSpec, State, Story } from '../../types';

/** the dock's page dots in a whole window: excused one element at a time, exactly as in the dock's own stories (R-a11y-2 names them;
    a 24 px wide area would cover the neighbour at the nub's 10 px pitch); every other target in the window is still checked */
const PAGE_DOTS = { 'geometry.target': { el: 'ui-pages__dot', reason: 'the dock\'s page dots: R-a11y-2 names them, each has a 24 px tall hit area around its mark, and a 24 px wide one would cover its neighbour at the 10 px pitch of the nub (14.12)' } } as const;
const page = (tags: State['tags'], provider: ProviderSpec = {}, setup?: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, ...(setup ? { setup } : {}) }, ...extra, allow: { ...PAGE_DOTS, ...(extra.allow ?? {}) } });
const LIVE = { 'stability.render': 'the recording replays with live timing' } as const;

const pages: Story = {
  id: 'pages/window', title: 'Whole window', area: 'shell', kind: 'page', covers: ['page:empty', 'page:conversation', 'page:live', 'page:bots', 'page:settings', 'page:first-run'],
  mock: { url: '/v6/__index.html' },
  states: {
    'empty app': page(['empty', 'owner'], { sessions: 'none', bots: 'none' }),
    'a conversation': page(['typical']),
    'a live conversation (recorded frames)': page(['typical'], { replay: 'session' }, async (c) => { await c.wait(600); }, { allow: LIVE }),
    'a live conversation with a form (recorded)': page(['variant'], { replay: 'forms' }, async (c) => { await c.wait(900); }, { allow: LIVE }),
    'unpriced models (recorded)': page(['variant'], { replay: 'unpriced' }, async (c) => { await c.wait(600); }, { allow: LIVE }),
    'details panel open': page(['variant'], {}, async (c) => { c.hx.setState({ right: 'open' }); await c.wait(600); }),
    'sidebar as a rail': page(['variant'], {}, async (c) => { c.hx.setState({ left: 'rail' }); await c.wait(600); }),
    'sidebar closed, dock off': page(['variant'], {}, async (c) => { c.hx.setState({ left: 'closed' }); c.hx.dock()?.setOn(false); await c.wait(700); }),
    Bots: page(['typical'], {}, async (c) => { c.hx.setState({ tab: 'bots' }); await c.wait(500); c.hx.emit('hx:bot-select', { id: 'nina', from: 'lab' }); await c.wait(500); }),
    'Bots with 120 bots': page(['many'], { bots: 120 }, async (c) => { c.hx.setState({ tab: 'bots' }); await c.wait(700); }),
    'Settings open': page(['open'], {}, async (c) => { document.body.focus(); await c.key(',', { ctrlKey: true }); await c.wait(500); }),
    'palette open': page(['open'], {}, async (c) => { document.body.focus(); await c.key('k', { ctrlKey: true }); await c.wait(450); }),
    'long names everywhere': page(['long'], { fixtures: ['long', 'outside'] }, async (c) => { c.hx.dock()?.openSession('cassiopeia-staging-deploy-guardian'); await c.wait(900); }),
    'first run': { tags: ['typical'], scope: '.hx-first-run', allow: { 'stability.render': 'the welcome logo plays once' },
      async render({ root, wait }) { void runFirstRun({ check: () => Promise.resolve({ hermes_installed: true, needed: true, reason: 'lab' }), source: () => Promise.resolve(null), onProgress: () => Promise.resolve(() => {}), advance: () => Promise.resolve({ steps: [], form: null, done: false, install_command: null, receipt: null }) }, root); await wait(400); } }
  }
};

export default [pages];
