/* Who answered, and "@": the conversation with replies from three models and the dividers between them, a reply of unknown model after
   a resume, a governed session's turn marked ungoverned, and the composer's "@" menu and mention chip (ADR-0036). App states: the
   real session view on the mock provider with the conversation and the model choices set here. */
import type { AgentTurn, ModelChoice, Turn } from '../../../data';
import type { DataProvider } from '../../../data/provider';
import { store } from '../../../data/store';
import type { AppCtx, ProviderSpec, State, Story } from '../../types';

const P = 'claude-subscription-directsdk-experimental';
const HAIKU = P + '/haiku', OPUS = P + '/opus', LUNA = 'openai-codex/gpt-6-luna';
const CHOICES: ModelChoice[] = [
  { value: HAIKU, provider: P, model: 'haiku', providerName: 'Claude subscription', tier: 0, tierName: 'haiku' },
  { value: P + '/sonnet', provider: P, model: 'sonnet', providerName: 'Claude subscription', tier: 1, tierName: 'sonnet' },
  { value: OPUS, provider: P, model: 'opus', providerName: 'Claude subscription', tier: 2, tierName: 'opus' },
  { value: LUNA, provider: 'openai-codex', model: 'gpt-6-luna', providerName: 'ChatGPT subscription' },
  { value: 'openai-codex/gpt-5.1-codex-mini', provider: 'openai-codex', model: 'gpt-5.1-codex-mini', providerName: 'ChatGPT subscription' }
];

const ask = (id: string, text: string, at: string): Turn => ({ id, role: 'user', at, text });
const answer = (id: string, model: string, paragraphs: string[], extra: Partial<AgentTurn> = {}): Turn => ({ id, role: 'assistant', model, time: '41s', cost: '$0.00', stepCount: 0, steps: [], paragraphs, bullets: [], status: 'done', ...extra });
const THREE: Turn[] = [
  ask('u1', 'rename the proration helper to prorateCents and fix the callers', '10:02'),
  answer('a1', HAIKU, ['Renamed it in six files and the tests still pass.']),
  ask('u2', '@GPT-6 Luna review that diff for rounding mistakes', '10:05'),
  answer('a2', LUNA, ['One caller still divides before rounding. It is in src/billing/invoice.ts, line 88.']),
  ask('u3', '@Claude Opus fix it and explain why it drifted', '10:09'),
  answer('a3', OPUS, ['Fixed: round once, at the end. The drift came from rounding each line before the sum.']),
  ask('u4', 'thanks, now the changelog', '10:12'),
  answer('a4', OPUS, ['Added an entry under Fixed.'])
];
const RESUMED: Turn[] = [
  ask('u1', 'what changed in the last release?', '09:40'),
  answer('a1', '', ['Three fixes and one removal. The removal is the legacy export.']),
  ask('u2', 'and the one before?', '09:44'),
  answer('a2', HAIKU, ['Two features and a rename.'])
];
const GOVERNED: Turn[] = [
  ask('u1', 'move src/billing to integer cents', '10:02'),
  answer('a1', HAIKU + ' → ' + P + '/sonnet', ['Done at tier 2 after the gate caught a failing test at tier 1.'], { time: '3m 42s' }),
  ask('u2', '@GPT-6 Luna just explain what the gate checks, no changes', '10:08'),
  answer('a2', LUNA, ['It runs the project\'s test command on a copy, with the sandbox on.'], { ungoverned: true })
];

function withModels(turns: Turn[], governed: boolean): (p: DataProvider) => DataProvider {
  return (p) => ({
    ...p,
    sessions: { ...p.sessions, conversation: () => ({ snapshot: () => ({ turns }), subscribe: () => () => undefined }) },
    details: { ...p.details, choices: store(CHOICES), governance: store({ ...p.details.governance.get(), governed, smart: false, model: HAIKU }) }
  });
}
const spec = (turns: Turn[], governed = false): ProviderSpec => ({ simulate: false, patch: withModels(turns, governed) });
const app = (tags: State['tags'], provider: ProviderSpec, setup?: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, ...(setup ? { setup } : {}) }, ...extra });
/* at 390 the call number of a governed turn (a route of two models, the time, the cost, the steps) wraps to a second row; the check compares an item of the first row with the centre of the whole row */
const WRAPS = { 'geometry.center': { reason: 'at 390 px the call number wraps to a second row, and the check compares an item of the first row with the centre of both rows; each item is centred in its own row (align-items: center)', el: 'ui-callno' } } as const;

/** types "@" into the session composer the way a person does (the composer opens its menu on the typed character) */
async function typeAt(c: AppCtx): Promise<void> {
  (c.$('#hx-view-session [data-hx-composer]') as HTMLElement & { setValue(t: string): void }).setValue('');   /* the mock starts with a draft */
  c.$('#hx-view-session .ui-composer__input').focus();
  document.execCommand('insertText', false, '@');
  await c.wait(400);
}
const draft = (text: string) => async (c: AppCtx): Promise<void> => {
  const comp = c.$('#hx-view-session [data-hx-composer]') as HTMLElement & { setValue(t: string): void };
  comp.setValue(text);
  await c.wait(350);
};
const MENU = { anchor: '#hx-view-session .ss-mention-anchor', layer: '.ui-listbox' };

const story: Story = {
  id: 'composer/attribution', title: 'Who answered, and "@"', area: 'composer', kind: 'surface', covers: ['surface:attribution'], scope: '#hx-view-session',
  mock: { url: '/v6/__index.html' },
  states: {
    'three models, with dividers': app(['variant', 'owner'], spec(THREE), async (c) => { await c.wait(400); }),
    'after a resume: one reply of unknown model': app(['variant'], spec(RESUMED), async (c) => { await c.wait(400); }),
    'governed: the tier route, then an ungoverned turn': app(['variant', 'owner'], spec(GOVERNED, true), async (c) => { await c.wait(400); }, { allow: WRAPS }),
    'the "@" menu': app(['open', 'owner'], spec(THREE), async (c) => { await typeAt(c); }, { overlay: MENU }),
    'a mention chip in the composer': app(['typical', 'owner'], spec(THREE), draft('@Claude Haiku rename the helper in src/billing')),
    'two mentions in one message': app(['variant'], spec(THREE), draft('@Claude Haiku rename it, then @GPT-6 Luna review it')),
    'governed: the "@" menu says the message runs without governance': app(['open', 'owner'], spec(GOVERNED, true), async (c) => { await typeAt(c); }, { overlay: MENU, allow: WRAPS }),
    'governed: a mention chip': app(['variant', 'owner'], spec(GOVERNED, true), draft('@GPT-6 Luna what does the gate check?'), { allow: WRAPS })
  }
};
export default [story];
