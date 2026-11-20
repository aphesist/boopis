/* Whole-window layouts, at every width the checker runs (390, 1200, 1440, 1920): the empty app, a conversation on
   the mock, a live conversation over recorded gateway frames (real data), the Bots tab, Settings open, first run. */
import { runFirstRun } from '../../../host/first-run';
import type { AppCtx, ProviderSpec, State, Story } from '../../types';

const page = (tags: State['tags'], provider: ProviderSpec = {}, setup?: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, ...(setup ? { setup } : {}) }, ...extra });
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
    'Bots with 120 bots': page(['many'], { bots: 120 }, async (c) => { c.hx.setState({ tab: 'bots' }); await c.wait(700); }, { allow: { axe: { el: 'label-content-name-mismatch', reason: 'axe-core reports label-content-name-mismatch (WCAG 2.5.3, R-a11y-1) only for the row that straddles the window\'s bottom edge (bot-017 at 1440 x 900, then bot-034 once scrolled); the same row, with the same name "bot-017, generated teammate 17, needs you" and the same visible words, passes when moved 100 px up, so it is the checker\'s clipping of a half-visible row and not the name, which holds every visible word in order (botLabel, R-a11y-1); every other axe rule still runs on this state (the same state as the Bots story\'s "120 bots, scrolling", drawn in the whole window)' } } }),
    'Settings open': page(['open'], {}, async (c) => { document.body.focus(); await c.key(',', { ctrlKey: true }); await c.wait(500); }),
    'palette open': page(['open'], {}, async (c) => { document.body.focus(); await c.key('k', { ctrlKey: true }); await c.wait(450); }),
    'long names everywhere': page(['long'], { fixtures: ['long', 'outside'] }, async (c) => { c.hx.dock()?.openSession('cassiopeia-staging-deploy-guardian'); await c.wait(900); }),
    'first run': { tags: ['typical'], scope: '.hx-first-run', allow: { 'stability.render': 'the welcome logo plays once' },
      async render({ root, wait }) { void runFirstRun({ check: () => Promise.resolve({ hermes_installed: true, needed: true, reason: 'lab' }), source: () => Promise.resolve(null), onProgress: () => Promise.resolve(() => {}), advance: () => Promise.resolve({ steps: [], form: null, done: false, install_command: null, receipt: null }) }, root); await wait(400); } }
  }
};

export default [pages];
