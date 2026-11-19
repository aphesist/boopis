/* Forms are one card family (owner decision): one renderer from the schema, every kind a template, every state, the
   origin slot on every card (docs/FORMS.md). Every kind in every state, compact and mini, on the dock, with long names
   and many askers, its submit hovered and focused. The data are the v6 mock-up's own forms (cards.test.html). */
import { ui } from '@boopis/ui';
import { fill, frames } from '../../story';
import type { Render, State, Story } from '../../types';
import { FORM_LONG, FORM_SPECS, FORM_STATES } from '../../fixtures';

const TAG: Record<string, State['tags'][number]> = { open: 'typical', invalid: 'error', submitting: 'loading', done: 'success', deferred: 'variant', expired: 'expired', cancelled: 'disabled' };
const draw = (spec: Record<string, unknown>, o: { state?: string; size?: 'inline' | 'compact' | 'mini'; ground?: 'dock' } = {}): Render => async ({ root }) => {
  fill(root, ui.card('form', JSON.parse(JSON.stringify(spec)) as Record<string, unknown>, { size: o.size ?? 'inline', state: o.state, ground: o.ground, enter: false }));
  await frames(3);
};
const SUBMIT = 'hx-card .ui-btn--primary, hx-card .ui-hold';

function story(name: string): Story {
  const spec = FORM_SPECS[name] as Record<string, unknown>;
  const kind = String(spec['kind']);
  const states: Record<string, State> = {};
  for (const s of FORM_STATES) states[s] = { tags: [TAG[s] ?? 'variant'], render: draw(spec, { state: s }), width: 608 };
  states['submit hover'] = { tags: ['hover'], render: draw(spec), width: 608, force: [{ sel: SUBMIT, state: 'hover' }] };
  states['submit focus'] = { tags: ['focus'], render: draw(spec), width: 608, force: [{ sel: SUBMIT, state: 'focus' }] };
  states['first field focus'] = { tags: ['focus'], render: draw(spec), width: 608, force: [{ sel: 'hx-card .ui-input, hx-card .cd-opt, hx-card .ui-chip', state: 'focus' }] };
  states['compact'] = { tags: ['size'], render: draw(spec, { size: 'compact' }), width: 400 };
  states['compact, on the dock'] = { tags: ['size', 'variant'], render: draw(spec, { size: 'compact', ground: 'dock' }), width: 400, ground: 'dock' };
  states['mini'] = { tags: ['size'], render: draw(spec, { size: 'mini' }), width: 360 };
  states['long'] = { tags: ['long'], width: 608, render: draw({ ...spec, title: String(spec['title']) + ' — ' + 'and a title long enough to wrap twice in the card at the conversation measure', why: String(spec['why'] ?? '') + ' ' + 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard_v2_final.ts' }) };
  states['empty schema'] = { tags: ['empty'], width: 608, render: draw({ ...spec, schema: { properties: {} }, why: undefined, effect: undefined }) };
  return { id: 'cards/form-' + name, title: 'Form: ' + name + (name !== kind ? ' (' + kind + ')' : ''), area: 'cards', kind: 'card', covers: name === kind ? ['form:' + kind] : [], mock: { url: '/v6/cards.test.html?view=forms' }, states };
}

const askers: Story = {
  id: 'cards/form-askers', title: 'Form: who is asking', area: 'cards', kind: 'card', covers: ['card:form', 'form:origin'], mock: { url: '/v6/cards.test.html?view=who' },
  states: {
    typical: { tags: ['typical'], width: 608, render: draw(FORM_SPECS['question'] as Record<string, unknown>) },
    'long teammate name': { tags: ['long'], width: 608, render: draw(FORM_LONG['one'] as Record<string, unknown>) },
    'five askers': { tags: ['many'], width: 608, render: draw(FORM_LONG['five'] as Record<string, unknown>) },
    'a relay': { tags: ['variant'], width: 608, render: draw(FORM_LONG['relay'] as Record<string, unknown>) },
    'a long model': { tags: ['long'], width: 608, render: draw(FORM_LONG['model'] as Record<string, unknown>) },
    'five askers, compact on the dock': { tags: ['many', 'size'], width: 400, ground: 'dock', render: draw(FORM_LONG['five'] as Record<string, unknown>, { size: 'compact', ground: 'dock' }) },
    error: { tags: ['error'], width: 608, render: draw(FORM_SPECS['credential'] as Record<string, unknown>, { state: 'invalid' }) },
    'no origin given': { tags: ['empty'], width: 608, render: draw({ ...(FORM_SPECS['question'] as Record<string, unknown>), origin: undefined }), note: 'unknown is shown as unknown' }
  }
};

export default [...Object.keys(FORM_SPECS).map(story), askers];
