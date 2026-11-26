/* The form card on the kit (REPASS.md 6d, derived): a form is the AskCard's block of boards 11 and K04. Every kind in every state, the
   dock's compact width and the one row, a long one, its primary hovered and focused; the questions with options (S23's chips, K02-11's
   lettered rows, "Something else"); who asks. Their ids stay `cards/form-*`: the lab keeps `kit/` for the kit's own components. The data are the lab's form fixtures (the v6 mock-up's own forms). */
import { ui } from '@boopis/ui';
import { fill, frames } from '../../story';
import type { Render, State, Story } from '../../types';
import { FORM_LONG, FORM_SPECS, FORM_STATES } from '../../fixtures';

const TAG: Record<string, State['tags'][number]> = { open: 'typical', invalid: 'error', submitting: 'loading', done: 'success', deferred: 'variant', expired: 'expired', cancelled: 'disabled' };
const draw = (spec: Record<string, unknown>, o: { state?: string; size?: 'inline' | 'compact' | 'mini'; ground?: 'dock'; then?: (root: HTMLElement) => void | Promise<void> } = {}): Render => async ({ root }) => {
  fill(root, ui.card('form', JSON.parse(JSON.stringify(spec)) as Record<string, unknown>, { size: o.size ?? 'inline', state: o.state, ground: o.ground, enter: false }));
  await frames(3);
  if (o.then) { await o.then(root); await frames(2); }
};
const PRIMARY = 'hx-card .k7-ask__answers .k7-chip[data-chosen]';
/** invalid as the person sees it: the primary pressed with the form left empty (the errors are painted by the form itself) */
const pressPrimary = (root: HTMLElement): void => { root.querySelector<HTMLElement>('.k7-ask__answers .k7-chip:not([data-hold])[data-action="submit"]')?.click() ?? undefined; if (!root.querySelector('.k7-field__error')) root.querySelector<HTMLElement>('hx-card')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };

function story(name: string): Story {
  const spec = FORM_SPECS[name] as Record<string, unknown>;
  const kind = String(spec['kind']);
  const states: Record<string, State> = {};
  for (const s of FORM_STATES) states[s] = { tags: [TAG[s] ?? 'variant'], render: s === 'invalid' ? draw(spec, { then: pressPrimary }) : draw(spec, { state: s }), width: 608 };
  states['primary hover'] = { tags: ['hover'], render: draw(spec), width: 608, force: [{ sel: PRIMARY, state: 'hover' }] };
  states['primary focus'] = { tags: ['focus'], render: draw(spec), width: 608, force: [{ sel: PRIMARY, state: 'focus' }] };
  states['compact, on the dock'] = { tags: ['size', 'variant'], render: draw(spec, { size: 'compact', ground: 'dock' }), width: 400, ground: 'dock' };
  states['mini'] = { tags: ['size'], render: draw(spec, { size: 'mini' }), width: 360 };
  states['long'] = { tags: ['long'], width: 608, render: draw({ ...spec, title: String(spec['title']) + ', and a title long enough to wrap in the card at the conversation measure', why: String(spec['why'] ?? '') + ' ' + 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard_v2_final.ts' }) };
  states['empty schema'] = { tags: ['empty'], width: 608, render: draw({ ...spec, schema: { properties: {} }, why: undefined, effect: undefined }) };
  return { id: 'cards/form-' + name, title: 'Form: ' + name + (name !== kind ? ' (' + kind + ')' : ''), area: 'cards', kind: 'card', covers: name === kind ? ['form:' + kind] : [], states };
}

const q = (props: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> => ({ id: 'q-' + Object.keys(props)[0], kind: 'question', title: 'A question', schema: { properties: props, required: Object.keys(props) }, ...extra });
const CHIPS = q({ build: { type: 'string', enum: ['staging', 'linux'], enumNames: ['staging', 'the Linux app'], 'x-other': true } }, { title: 'Check the fix on which build?', origin: { kind: 'agent', model: 'sonnet 5.5' } });
const LETTERS = q({ for: { type: 'string', enum: ['people', 'devs', 'both'], enumNames: ['People who use boopis', 'Developers building on the Local API', 'Both, in two sections'], 'x-other': true } }, { title: 'Who are the notes for?', origin: { kind: 'agent', model: 'sonnet 5.5' } });
const other = (root: HTMLElement): void => { (Array.from(root.querySelectorAll<HTMLElement>('.k7-chip, .k7-ask__choice')).find((x) => /Something else/.test(x.textContent ?? '')))?.click(); };
const questions: Story = {
  id: 'cards/form-questions', title: 'Form: a question with options', area: 'cards', kind: 'card', covers: ['form:question-options'],
  states: {
    'chips (S23)': { tags: ['typical'], width: 608, render: draw(CHIPS) },
    'lettered rows (K02-11)': { tags: ['variant'], width: 608, render: draw(LETTERS) },
    'something else': { tags: ['variant'], width: 608, render: draw(CHIPS, { then: other }) },
    'a row chosen': { tags: ['variant'], width: 608, render: draw(LETTERS), force: [{ sel: 'hx-card .k7-ask__choice:nth-child(2)', state: 'hover' }] },
    answered: { tags: ['success'], width: 608, render: draw({ ...CHIPS, receiptText: 'You answered: staging' }, { state: 'done' }) },
    'compact, on the dock': { tags: ['size'], width: 400, ground: 'dock', render: draw(LETTERS, { size: 'compact', ground: 'dock' }) },
    long: { tags: ['long'], width: 608, render: draw(q({ for: { type: 'string', enum: ['a', 'b', 'c', 'd'], enumNames: ['People who use boopis every day, at work and at home', 'Developers building on the Local API and its websocket events', 'Both, in two sections', 'Nobody yet'] } }, { title: 'Who are the notes for, and how long should each section be before it moves on to the next one?' })) },
    'no options': { tags: ['empty'], width: 608, render: draw(q({ for: { type: 'string', enum: [] } }, { title: 'Who are the notes for?' })) },
    'not delivered': { tags: ['error'], width: 608, render: draw(CHIPS, { then: (root) => { const c = root.querySelector('hx-card') as (HTMLElement & { formState: { error: string }; update(p: Record<string, unknown>): void }) | null; if (c) { c.formState.error = 'The engine is not running. Start it again and answer.'; c.update({}); } } }) }
  }
};

const askers: Story = {
  id: 'cards/form-askers', title: 'Form: who is asking', area: 'cards', kind: 'card', covers: ['card:form', 'form:origin'],
  states: {
    typical: { tags: ['typical'], width: 608, render: draw(FORM_SPECS['approval'] as Record<string, unknown>) },
    'the agent of a session': { tags: ['variant'], width: 608, render: draw(FORM_SPECS['credential'] as Record<string, unknown>) },
    'five askers': { tags: ['many'], width: 608, render: draw(FORM_LONG['five'] as Record<string, unknown>) },
    'a relay': { tags: ['variant'], width: 608, render: draw({ ...(FORM_SPECS['approval'] as Record<string, unknown>), id: 'relay', origin: { kind: 'teammate', ids: ['nina'], via: 'atlas' } }) },
    'a connector': { tags: ['variant'], width: 608, render: draw({ ...(FORM_SPECS['approval'] as Record<string, unknown>), id: 'mcp', origin: { kind: 'mcp', server: 'sentry' } }) },
    'a mod': { tags: ['variant'], width: 608, render: draw(FORM_SPECS['theme'] as Record<string, unknown>) },
    'the app': { tags: ['variant'], width: 608, render: draw(FORM_SPECS['choice'] as Record<string, unknown>) },
    'a long model': { tags: ['long'], width: 608, render: draw(FORM_LONG['model'] as Record<string, unknown>) },
    'five askers, compact on the dock': { tags: ['many', 'size'], width: 400, ground: 'dock', render: draw(FORM_LONG['five'] as Record<string, unknown>, { size: 'compact', ground: 'dock' }) },
    'not delivered': { tags: ['error'], width: 608, render: draw(FORM_LONG['five'] as Record<string, unknown>, { then: (root) => { const c = root.querySelector('hx-card') as (HTMLElement & { formState: { error: string }; update(p: Record<string, unknown>): void }) | null; if (c) { c.formState.error = 'The answer was not delivered. Try again.'; c.update({}); } } }) },
    'no origin given': { tags: ['empty'], width: 608, render: draw({ ...(FORM_SPECS['approval'] as Record<string, unknown>), id: 'none', origin: undefined }), note: 'unknown is shown as unknown: "Needs your answer"' }
  }
};

export default [...Object.keys(FORM_SPECS).map(story), questions, askers];
