/* The council in the session (ADR-0035) on the kit (REPASS.md 6e, the lead's design; no board draws it): the form (S19's Menu: the
   members as checked OptionRows, the combiner a SelectorItem, "Ask the council"), the turn while the members answer and while one
   combines them (a Block of ToolRows), done (the reply with "council of N" and the stacked marks in its foot, the answers in a
   Disclosure), a member that failed (its reason in its Tooltip), and none reported (red, "Ask again"). The states draw the real pieces
   from the shapes the engine's `moa.*` events fill in; the live provider's own tests play the frames. */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, PARAGRAPH, UNBROKEN } from '../../fixtures';
import { councilAnswers, councilBlock, councilFoot, councilFormNode } from '../../../modules/session/council';
import { asV7 } from '../../../modules/session/s0';
import { asked, reply, sessionThread } from './_thread';
import type { CouncilForm, CouncilTurn, ModelChoice } from '../../../data';

const W = 720;
const C = 'claude-subscription-directsdk-experimental';
const ch = (provider: string, providerName: string, model: string, tier?: number): ModelChoice => ({ value: provider + '/' + model, provider, model, providerName, ...(tier !== undefined ? { tier, tierName: model } : {}) });
const OPTIONS = [ch(C, 'Claude subscription', 'claude-haiku-5-5', 0), ch(C, 'Claude subscription', 'claude-sonnet-5-5', 1), ch(C, 'Claude subscription', 'claude-opus-5-5', 2), ch('openai-codex', 'ChatGPT subscription', 'gpt-6-luna'), ch('gemini', 'Gemini', 'gemini-3.8-pro')];
const slot = (provider: string, model: string): { provider: string; model: string } => ({ provider, model });
const M = [slot(C, 'claude-opus-5-5'), slot('openai-codex', 'gpt-6-luna'), slot('gemini', 'gemini-3.8-pro'), slot('xai', 'grok-4'), slot('mistral', 'mistral-large-3')] as const;
const FORM: CouncilForm = { options: OPTIONS, remembered: false, choice: { members: [M[0], M[1], M[2]], combiner: slot(C, 'claude-sonnet-5-5') } };
const TEXT = ['Use a partial index on (account_id) where closed_at is null. It keeps the index small and the lookups exact.', 'A hash index would be faster for equality, but the planner will not use it for the range scans the report runs.'];
type Member = CouncilTurn['members'][number];
const ans = (i: 0 | 1 | 2 | 3 | 4, text: string): Member => ({ slot: M[i], state: 'answered', text });
const running: CouncilTurn = { members: [ans(0, ''), { slot: M[1], state: 'waiting', text: '' }, { slot: M[2], state: 'waiting', text: '' }], combiner: slot(C, 'claude-sonnet-5-5'), phase: 'members', done: 1, total: 3 };
const combining: CouncilTurn = { members: [ans(0, TEXT.join('\n\n')), ans(1, TEXT[1] as string), ans(2, TEXT[0] as string)], combiner: slot(C, 'claude-sonnet-5-5'), phase: 'combining', done: 3, total: 3 };
const done3: CouncilTurn = { ...combining, phase: 'done' };
const failed: CouncilTurn = { ...done3, members: [done3.members[0] as Member, { slot: M[1], state: 'failed', text: '', reason: 'the request timed out after 60 s' }, done3.members[2] as Member] };
const failedRunning: CouncilTurn = { ...combining, members: failed.members };
const five: CouncilTurn = { ...done3, members: [ans(0, TEXT[0] as string), ans(1, TEXT[1] as string), ans(2, TEXT[0] as string), ans(3, TEXT[1] as string), ans(4, TEXT[0] as string)], done: 5, total: 5 };
const resumed: CouncilTurn = { ...done3, done: 2, members: [{ ...(done3.members[0] as Member), cut: true }, done3.members[1] as Member, { slot: M[2], state: 'waiting', text: '' }] };
const none: CouncilTurn = { members: [], combiner: slot(C, 'claude-sonnet-5-5'), phase: 'done', done: 0, total: 2 };

const Q = 'Which index should the overdue report use?';
/** a council turn as the session draws it: while it works the Block; done, the reply, the answers under it and the foot */
function turn(c: CouncilTurn, o: { open?: boolean } = {}): HTMLElement {
  if (c.phase !== 'done') return sessionThread(asked(Q), councilBlock(c));
  const f = c.members.length ? councilFoot(c) : null;
  return sessionThread(asked(Q), reply(PARAGRAPH, 'claude-sonnet-5-5'), councilAnswers(c, !!o.open), c.members.length ? null : councilBlock(c, { again: () => undefined }),
    kit.turnFoot({ kind: 'session', ...(f ? { marks: f.marks, modelName: f.modelName } : { model: 'claude-sonnet-5-5', modelName: 'sonnet 5.5' }), time: '14s', cost: '$0.06', label: 'Checkpoint 4', actions: [] }));
}
const form = (f: CouncilForm): HTMLElement => { const w = document.createElement('div'); w.append(councilFormNode(f, () => Promise.resolve()).el); return asV7(w); };

export default [{
  id: 'composer/council', title: 'Council', area: 'composer', kind: 'surface', covers: ['surface:council'],
  states: {
    'the form': stage(['typical', 'open'], ({ root }) => { fill(root, form(FORM)); }, { width: 420 }),
    'the form, remembered': stage(['variant'], ({ root }) => { fill(root, form({ ...FORM, remembered: true })); }, { width: 420 }),
    'the form, one member': stage(['error'], ({ root }) => { fill(root, form({ ...FORM, choice: { ...FORM.choice, members: [M[0]] } })); }, { width: 420 }),
    'the form, choosing the combiner': stage(['variant', 'open'], ({ root }) => { fill(root, form(FORM)); root.querySelector<HTMLElement>('[data-combiner]')?.click(); }, { width: 420 }),
    'the form, long names': stage(['long'], ({ root }) => { fill(root, form({ ...FORM, options: [...OPTIONS, ch('custom', LONG_TITLE, UNBROKEN.slice(0, 60))] })); }, { width: 420 }),
    'the form, a row hovered': stage(['hover'], ({ root }) => { fill(root, form(FORM)); }, { width: 420, force: [{ sel: '[data-kit~="OptionRow"]:nth-of-type(2)', state: 'hover' }] }),
    'running': stage(['loading'], ({ root }) => { fill(root, turn(running)); }, { width: W }),
    'combining': stage(['loading', 'variant'], ({ root }) => { fill(root, turn(combining)); }, { width: W }),
    'combining, a member failed': stage(['error'], ({ root }) => { fill(root, turn(failedRunning)); }, { width: W }),
    'a failed member\'s reason': stage(['focus', 'error'], ({ root }) => { fill(root, turn(failedRunning)); }, { width: W, force: [{ sel: '[data-kit~="StatusWord"][data-tip]', state: 'focus' }] }),
    'done': stage(['typical', 'success'], ({ root }) => { fill(root, turn(done3)); }, { width: W }),
    'done, answers open': stage(['open'], ({ root }) => { fill(root, turn(done3, { open: true })); }, { width: W }),
    'done, a member failed, answers open': stage(['error', 'open'], ({ root }) => { fill(root, turn(failed, { open: true })); }, { width: W }),
    'done, five members': stage(['many'], ({ root }) => { fill(root, turn(five)); }, { width: W }),
    'resumed: a cut answer, one never answered': stage(['variant', 'open'], ({ root }) => { fill(root, turn(resumed, { open: true })); }, { width: W }),
    'none reported': stage(['empty', 'error'], ({ root }) => { fill(root, turn(none)); }, { width: W })
  }
} satisfies Story] satisfies Story[];
