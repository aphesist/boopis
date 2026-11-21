/* The council in the session (ADR-0034): the form that picks who sits on it, and a council turn while it runs and when it is done.
   The states draw the real pieces (the form's content in a popover surface, the turn's block in an entry) from the shapes the engine's
   `moa.*` events fill in; the live provider's own tests play the frames. */
import { ui } from '@boopis/ui';
import { put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, PARAGRAPH, UNBROKEN } from '../../fixtures';
import { councilBlock, councilFormNode } from '../../../modules/session/council';
import type { CouncilForm, CouncilTurn, ModelChoice } from '../../../data';

const W = 720;
const C = 'claude-subscription-directsdk-experimental';
const ch = (provider: string, providerName: string, model: string, tier?: number): ModelChoice => ({ value: provider + '/' + model, provider, model, providerName, ...(tier !== undefined ? { tier, tierName: model } : {}) });
const OPTIONS = [ch(C, 'Claude subscription', 'haiku', 0), ch(C, 'Claude subscription', 'sonnet', 1), ch(C, 'Claude subscription', 'opus', 2), ch('openai-codex', 'ChatGPT subscription', 'gpt-6-luna'), ch('gemini', 'Gemini', 'gemini-3.8-pro')];
const FORM: CouncilForm = { options: OPTIONS, remembered: false, choice: { members: [{ provider: C, model: 'opus' }, { provider: 'openai-codex', model: 'gpt-6-luna' }, { provider: 'gemini', model: 'gemini-3.8-pro' }], combiner: { provider: C, model: 'sonnet' } } };
const slot = (provider: string, model: string): { provider: string; model: string } => ({ provider, model });
const M = [slot(C, 'opus'), slot('openai-codex', 'gpt-6-luna'), slot('gemini', 'gemini-3.8-pro')] as const;
const TEXT = ['Use a partial index on (account_id) where closed_at is null. It keeps the index small and the lookups exact.', 'A hash index would be faster for equality, but the planner will not use it for the range scans the report runs.'];
const running: CouncilTurn = { members: [{ slot: M[0], state: 'answered', text: '' }, { slot: M[1], state: 'waiting', text: '' }, { slot: M[2], state: 'waiting', text: '' }], combiner: slot(C, 'sonnet'), phase: 'members', done: 1, total: 3 };
const combining: CouncilTurn = { members: [{ slot: M[0], state: 'answered', text: TEXT.join('\n\n') }, { slot: M[1], state: 'answered', text: TEXT[1] as string }, { slot: M[2], state: 'answered', text: TEXT[0] as string }], combiner: slot(C, 'sonnet'), phase: 'combining', done: 3, total: 3 };
const done3: CouncilTurn = { ...combining, phase: 'done' };
const entry = (model: string, why: string, c: CouncilTurn, body: string): HTMLElement => {
  const e = ui.entry({ kind: 'agent', callno: [model, why, '14s'], body: '' });
  const b = e.querySelector('.ui-entry__body') as HTMLElement;
  b.append(councilBlock(c));
  if (body) { const p = document.createElement('div'); p.className = 'ui-prose'; p.innerHTML = '<p>' + ui.html.inline(body) + '</p>'; b.append(p); }
  return e;
};
const pop = (form: CouncilForm): HTMLElement => {
  const w = document.createElement('div'); w.className = 'ui-pop'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'Ask a council'); w.setAttribute('data-static', '');
  w.append(councilFormNode(form, () => Promise.resolve()));
  return w;
};

export default [{
  id: 'composer/council', title: 'Council', area: 'composer', kind: 'surface', covers: ['surface:council'], mock: { url: '/v6/design-system/index.html#c-conversation', crop: '#c-conversation' },
  states: {
    'the form': stage(['typical', 'open'], ({ root }) => { put(root, pop(FORM)); }, { width: 360 }),
    'the form, remembered': stage(['variant'], ({ root }) => { put(root, pop({ ...FORM, remembered: true })); }, { width: 360 }),
    'the form, one member': stage(['error'], ({ root }) => { put(root, pop({ ...FORM, choice: { ...FORM.choice, members: [FORM.choice.members[0] as { provider: string; model: string }] } })); }, { width: 360 }),
    'the form, long names': stage(['long'], ({ root }) => { put(root, pop({ ...FORM, options: [...OPTIONS, ch('custom:' + UNBROKEN.slice(0, 24), LONG_TITLE, UNBROKEN.slice(0, 60))] })); }, { width: 360 }),
    'a council turn running': stage(['loading'], ({ root }) => { put(root, entry(C + '/sonnet', 'Council of 3', running, '')); }, { width: W }),
    'a council turn combining': stage(['variant'], ({ root }) => { put(root, entry(C + '/sonnet', 'Council of 3', combining, '')); }, { width: W }),
    'a council turn done, three members': stage(['typical', 'success'], ({ root }) => { put(root, entry(C + '/sonnet', 'Council of 3', done3, PARAGRAPH)); }, { width: W }),
    'a council turn, answers open': stage(['variant', 'open'], ({ root }) => { const e = entry(C + '/sonnet', 'Council of 3', done3, PARAGRAPH); put(root, e); e.querySelector<HTMLElement>('.ss-council .ui-disclosure')?.click(); }, { width: W }),
    'a council turn, one member failed': stage(['error'], ({ root }) => { put(root, entry(C + '/sonnet', 'Council of 3', { ...done3, members: [done3.members[0] as CouncilTurn['members'][number], { slot: M[1], state: 'failed', text: '' }, done3.members[2] as CouncilTurn['members'][number]] }, PARAGRAPH)); }, { width: W }),
    'a council turn, no member reported': stage(['empty'], ({ root }) => { put(root, entry(C + '/sonnet', 'Council of 2', { members: [], combiner: slot(C, 'sonnet'), phase: 'combining', done: 0, total: 0 }, PARAGRAPH)); }, { width: W })
  }
} satisfies Story] satisfies Story[];
