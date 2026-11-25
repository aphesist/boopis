/* The app's dock on the v7 kit (w33/dock; DESIGN-SYSTEM.md v7 21.4, the kit's Dock): the Sessions tab's alone, hidden until you have a
   bot of your own. The row at rest (D01 B: the bots that matter now, then "N more"), a hover naming the bot and its state in the end
   slot, the ask pill (D03 C) and the stack it opens, a bot's card with the row under it as the switcher. Each state boots the whole
   app and scopes the checks to the dock, so the v7 rules block on it (stories/v7/ counts as the kit's). Moving the dock must not take
   an orb out of the page or draw one anew (`orbs: 'stay'`): its orbs are made once, in place, and a hover only writes their size. */
import type { AppCtx, Interaction, ProviderSpec, State, Story } from '../../types';
import { ORB3_MOTION } from '../kit/_bots';

const SCOPE = '#hx-dock';
const MOCK = { url: '/v6/__index.html', note: 'the v6 mock has no v7 dock: the approved v7 boards are ds-v7/dock-boards (D01 B, D02 A, D03 C, DK1, DK2, K01 to K09)' };
/* the session's turns are v6 still (w33/session-s0); the orbs move (orb3's state life) */
const ALLOW = { 'orb.edges': ORB3_MOTION } as const;
const st = (tags: State['tags'], provider: ProviderSpec, setup?: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State =>
  ({ tags, app: { provider, setup: async (c) => { await c.wait(400); await setup?.(c); } }, allow: ALLOW, ...extra });
const card = (id: string) => async (c: AppCtx): Promise<void> => { c.hx.dock()?.openSession(id); await c.wait(700); };
const asks = async (c: AppCtx): Promise<void> => { c.hx.dock()?.openAsks(); await c.wait(700); };
/** the pointer on the n-th orb of the row (a hover is the row's own: it reads where the pointer is) */
const hover = (n: number) => async (c: AppCtx): Promise<void> => {
  const o = document.querySelectorAll<HTMLElement>('#hx-dock .k7-dock__orb:not([hidden])')[n];
  const r = o?.getBoundingClientRect();
  if (r) c.hx.dock()?.hover(r.left + r.width / 2);
  await c.wait(500);
};
const NO_DOCK = { ...ALLOW, 'geometry.contain': 'no dock is drawn: nothing to check' } as const;

const HOVER_ROW: Interaction = { name: 'hover along the row', watch: SCOPE, orbs: 'stay', steps: [{ do: 'hover', sel: '#hx-dock .k7-dock__orb >> nth=0', ms: 300 }, { do: 'hover', sel: '#hx-dock .k7-dock__orb >> nth=2', ms: 300 }, { do: 'move-away', ms: 400 }], sample: 900 };
const OPEN_CLOSE: Interaction = { name: 'open a bot\'s card, close it', watch: SCOPE, orbs: 'stay', steps: [{ do: 'click', sel: '#hx-dock .k7-dock__orb >> nth=1', ms: 700 }, { do: 'press', key: 'Escape', ms: 400 }], sample: 900 };
const ASKS: Interaction = { name: 'open the asks, close them', watch: SCOPE, orbs: 'stay', steps: [{ do: 'call', js: '__lab.hx.dock().openAsks()', ms: 700 }, { do: 'call', js: '__lab.hx.dock().closeSession()' }], sample: 900 };

const dock: Story = {
  id: 'v7/dock', title: 'Dock (v7)', area: 'dock', kind: 'surface', covers: ['surface:dock'], scope: SCOPE, mock: MOCK,
  states: {
    'at rest (the mock\'s bots)': st(['typical', 'owner'], {}, undefined, { note: 'the row: orbs 40 at rest in the pose, gap 14, needs you first, then working; nina\'s ask as the amber pill at the row\'s end', interact: [HOVER_ROW, OPEN_CLOSE, ASKS] }),
    'one bot': st(['single', 'owner'], { bots: 'one' }, undefined, { interact: [HOVER_ROW] }),
    'no bots of your own (no dock)': st(['empty', 'owner'], { bots: 'none' }, undefined, { note: 'boopis alone does not count: no dock, and the composer keeps no room for it (K06)', allow: NO_DOCK }),
    '120 bots (N more)': st(['many', 'owner'], { bots: 120 }, undefined, { note: 'D01 B: as many as fit in 640, then "N more" to the Bots tab' }),
    'a long-named bot': st(['long'], { fixtures: ['long'] }),
    'a long-named bot hovered': st(['long', 'hover'], { fixtures: ['long'] }, hover(0)),
    'an orb hovered': st(['hover'], {}, hover(2), { note: 'the hovered orb 52, its neighbours 46; its name and state in the end slot (no tooltip)' }),
    'an orb focused': st(['focus'], {}, async (c) => { c.$('#hx-dock .k7-dock__orb[tabindex="0"]').focus(); await c.wait(300); }, { force: [{ sel: '#hx-dock .k7-dock__orb[tabindex="0"]', state: 'focus' }] }),
    'the asks open (the stack)': st(['open', 'owner'], {}, asks, { note: 'D03 C: "Waiting on you", each ask an AskCard (Hold to allow once, Deny), the row under it' }),
    "nina's card (an approval)": st(['open', 'owner'], {}, card('nina'), { note: 'the card: its head (28 orb, name, state, Open in Bots, close), its last messages, its AskCard, a composer; the row under it, nina marked' }),
    "atlas's card (a thread)": st(['open'], {}, card('atlas')),
    'a long-named bot\'s card': st(['open', 'long'], { fixtures: ['long'] }, card('cassiopeia-staging-deploy-guardian')),
    'centred in the window': st(['variant'], {}, async (c) => { c.hx.setState({ dockCentred: true }); await c.wait(600); }),
    'the Bots tab (no dock)': st(['variant', 'owner'], {}, async (c) => { c.hx.setState({ tab: 'bots' }); await c.wait(600); }, { note: 'the dock is the Sessions tab\'s alone', allow: NO_DOCK }),
    'larger (112%)': st(['size', 'variant'], {}, undefined, { zoom: 1.12 })
  }
};

export default [dock];
