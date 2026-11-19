/* The card family (14.13), through the library's `ui.card(kind, data, {state, size, ground})`: every kind in every
   state, inline at the conversation's measure, compact at the dock's width, mini, on the chrome and on the dock, with
   the mock-up's own gallery data and with every string long. Forms have their own story (forms.stories.ts). */
import { ui, type CardKind } from '@boopis/ui';
import { fill, frames } from '../../story';
import type { Render, State, Story } from '../../types';
import { CARD_DATA, CARD_LONG } from '../../fixtures';

/** each kind's states, as the card layer names them (the coverage gate checks this list against the layer) */
export const CARD_STATES: Readonly<Record<string, readonly string[]>> = {
  approval: ['pending', 'holding', 'approved', 'denied', 'expired'],
  ship: ['passed', 'failed', 'rolled-back'],
  blank: ['open', 'answered'],
  teammate: ['pending', 'accepted', 'declined'],
  escalation: ['escalated', 'capped'],
  error: ['failed', 'retrying', 'passed'],
  schedule: ['pending', 'scheduled', 'dismissed'],
  connector: ['needed', 'waiting', 'connected', 'failed']
};
const TAG: Record<string, State['tags'][number]> = { denied: 'error', failed: 'error', capped: 'error', declined: 'error', expired: 'expired', dismissed: 'disabled', approved: 'success', passed: 'success', connected: 'success', accepted: 'success', scheduled: 'success', answered: 'success', holding: 'active', retrying: 'loading', waiting: 'loading' };
const INLINE = 608, COMPACT = 400, MINI = 360;

const draw = (kind: CardKind, data: Record<string, unknown>, o: { state?: string | undefined; size?: 'inline' | 'compact' | 'mini'; ground?: 'chrome' | 'dock' } = {}): Render => async ({ root }) => {
  const c = ui.card(kind, { ...data }, { size: o.size ?? 'inline', state: o.state, ground: o.ground, enter: false });
  fill(root, c);
  await frames(3);
};

function story(kind: CardKind): Story {
  const d = CARD_DATA[kind] ?? {}, long = CARD_LONG[kind] ?? d;
  const states: Record<string, State> = {};
  for (const s of CARD_STATES[kind] ?? []) {
    const tags: State['tags'][number][] = s === CARD_STATES[kind]?.[0] ? ['typical', ...(TAG[s] ? [TAG[s]] : [])] : [TAG[s] ?? 'variant'];
    const st: State = { tags, render: draw(kind, d, { state: s }), width: INLINE };
    if (s === 'holding') st.allow = { 'stability.render': 'a hold in progress is time based', visual: 'a hold in progress is time based' };
    states[s] = st;
  }
  const first = CARD_STATES[kind]?.[0];
  states['long'] = { tags: ['long'], render: draw(kind, long, { state: first }), width: INLINE };
  states['compact'] = { tags: ['size'], render: draw(kind, d, { state: first, size: 'compact' }), width: COMPACT };
  states['compact, long'] = { tags: ['size', 'long'], render: draw(kind, long, { state: first, size: 'compact' }), width: COMPACT };
  states['compact, on the dock'] = { tags: ['size', 'variant'], render: draw(kind, d, { state: first, size: 'compact', ground: 'dock' }), width: COMPACT, ground: 'dock' };
  states['mini'] = { tags: ['size'], render: draw(kind, d, { state: first, size: 'mini' }), width: MINI };
  states['mini, long'] = { tags: ['size', 'long'], render: draw(kind, long, { state: first, size: 'mini' }), width: MINI };
  states['empty data'] = { tags: ['empty'], render: draw(kind, {}, { state: first }), width: INLINE, note: 'a sender that gave nothing: unknown stays unknown' };
  if (kind === 'approval') {
    states['hold hover'] = { tags: ['hover'], render: draw(kind, d), width: INLINE, force: [{ sel: '.ui-hold', state: 'hover' }] };
    states['deny focus'] = { tags: ['focus'], render: draw(kind, d), width: INLINE, force: [{ sel: '[data-action="deny"], .ui-btn:not(.ui-hold)', state: 'focus' }] };
    states['queue of three'] = { tags: ['many'], width: INLINE, async render({ root }) { for (let i = 0; i < 3; i++) fill(root, ui.card('approval', { ...d }, { queue: { index: i, total: 3 }, enter: false })); await frames(3); } };
  }
  if (kind === 'blank') {
    states['popover'] = { tags: ['open'], width: INLINE, async render({ root }) { fill(root, ui.card('blank', { ...d }, { size: 'popover', enter: false })); await frames(3); } };
  }
  return { id: 'cards/' + kind, title: 'Card: ' + kind, area: 'cards', kind: 'card', covers: ['card:' + kind, ...(kind === 'approval' ? ['ui.card'] : [])], mock: { url: '/v6/cards.test.html#k-' + kind, crop: '#k-' + kind }, states };
}

export default (Object.keys(CARD_STATES) as CardKind[]).map(story);

