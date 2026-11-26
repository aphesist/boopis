/* What the host holds for the owner in a bot's thread, and a bot's approval card's 6e answers (REPASS.md 6e; the lead's design, no board
   draws these but O-B06's team-plan block): a team change a bot proposed (the kit's TeamPlan in an AskCard: Hold to apply, Change it,
   Later; the receipts with Undo), a step a rule paused while the owner was away (Hold to allow once, Always allow with approval rules, Deny),
   and the approval card's Edit (shown with `approval-edit`, which no provider has: the engine cannot take an edited request) and its
   receipts ("You allowed it always · exception drafted" with Open, once Settings › Approvals exists: `rules-settings`). */
import { kit } from '@boopis/ui';
import { put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';
import { data } from '../../../data';
import type { ApprovalMessage, Bot, LaterFeature, ParkedStep, TeamPlan } from '../../../data';
import { parkedCard, planCard } from '../../../modules/bots/held';
import { approvalCard } from '../../../modules/bots/room';
import { asV7 } from '../../../modules/session/s0';

const W = 720;
const thread = (...parts: HTMLElement[]): HTMLElement => { const t = document.createElement('div'); t.className = 'k7-thread'; for (const p of parts) t.append(p); return asV7(t); };
/** draw with these features switched on, as a lab fixture does for a board; the provider is put back as it was */
function withLater<T>(f: readonly LaterFeature[], fn: () => T): T {
  const info = data().info as { later?: ReadonlySet<LaterFeature> | undefined }, was = info.later;
  info.later = new Set(f);
  try { return fn(); } finally { info.later = was; }
}
const bots = (): readonly Bot[] => data().bots.snapshot().bots;
const botOf = (id: string): Bot | null => bots().find((b) => b.id === id) ?? null;
const PLAN: TeamPlan = {
  hash: 'a'.repeat(64), title: 'a small crew for ~/code/boopis', reason: 'You asked for help with reviews and the nightly tests. Nothing is made until you hold the button.',
  actions: [{ mark: '+', target: 'kai', what: 'reviews pull requests' }, { mark: '+', target: 'moss', what: 'runs the tests at night, proposes fixes' }, { mark: '~', target: 'iris', what: 'release notes and the changelog, now weekly' }],
  problems: [], notes: ['Room “crew”, kai leads. Routine: moss’s test sweep, weekdays at 02:00, paused.'], state: 'proposed', permanent: false, undoes: null, words: null, report: null, bot: 'boopis', createdAt: '2026-11-27T09:45:00Z', expiresAt: null
};
const DISBAND: TeamPlan = { ...PLAN, hash: 'b'.repeat(64), title: 'fold the old crew into release crew', actions: [{ mark: '-', target: 'room old crew', what: 'disbanded; its members join release crew' }, { mark: '~', target: 'room release crew', what: 'adds hex and nimbus' }], permanent: true, notes: [] };
const PROBLEMS: TeamPlan = { ...PLAN, problems: ['moss needs a model, and none is signed in.', 'A room named “crew” already exists.'] };
const plan = (p: TeamPlan, v: Parameters<typeof planCard>[3] = {}): HTMLElement => thread(kit.bubble({ kind: 'agent', text: 'Here’s a small team for code and reviews.' }), planCard(p, botOf('boopis'), bots(), v));

const STEP: ParkedStep = { id: 'p1', bot: 'kai', rule: 'Ask before a git force-push', tool: 'Run a command · git push', at: '2026-11-27T02:00:00Z', expiresAt: '2026-12-04T02:00:00Z', choices: ['once', 'always', 'deny'] };
const parked = (v: Parameters<typeof parkedCard>[2] = {}, f: readonly LaterFeature[] = []): HTMLElement => withLater(f, () => thread(parkedCard(STEP, botOf('kai'), v)));

const ASK: ApprovalMessage = { kind: 'approval', id: 'ap1', who: 'nina', t: '11:20', data: { from: 'nina', title: 'Deploy 0.2.0 to staging', rule: 'Deploys need my OK', item: ['pnpm deploy --env staging --tag 0.2.0'], quote: '', meta: '' } };
const approval = (m: ApprovalMessage, f: readonly LaterFeature[]): HTMLElement => withLater(f, () => thread(approvalCard(botOf('nina') as Bot, m)));

export default [{
  id: 'bots/held', title: 'Held for you: a team plan, a paused step, an approval edited', area: 'bots', kind: 'surface', covers: ['surface:held'],
  states: {
    'plan proposed': stage(['typical'], ({ root }) => { put(root, plan(PLAN)); }, { width: W }),
    'plan, hold hovered': stage(['hover'], ({ root }) => { put(root, plan(PLAN)); }, { width: W, force: [{ sel: '[data-value="apply"]', state: 'hover' }] }),
    'plan with a permanent action': stage(['variant'], ({ root }) => { put(root, plan(DISBAND)); }, { width: W }),
    'plan with problems': stage(['error'], ({ root }) => { put(root, plan(PROBLEMS)); }, { width: W }),
    'plan, change it': stage(['open'], ({ root }) => { put(root, plan(PLAN, { changing: 'Leave iris out for now' })); }, { width: W }),
    'plan, applying': stage(['loading'], ({ root }) => { put(root, plan(PLAN, { busy: true })); }, { width: W }),
    'plan, refused': stage(['error'], ({ root }) => { put(root, plan(PLAN, { error: 'The team changed since this plan was made. Ask for a new one.' })); }, { width: W }),
    'plan applied, with Undo': stage(['success'], ({ root }) => { put(root, plan({ ...PLAN, state: 'applied' })); }, { width: W }),
    'plan, changes asked': stage(['variant'], ({ root }) => { put(root, plan({ ...PLAN, state: 'rejected', words: 'Leave iris out for now' })); }, { width: W }),
    'plan expired': stage(['expired'], ({ root }) => { put(root, plan({ ...PLAN, state: 'expired' })); }, { width: W }),
    'plan failed': stage(['error'], ({ root }) => { put(root, plan({ ...PLAN, state: 'failed', report: 'moss could not be made: its folder is taken' })); }, { width: W }),
    'plan put off': stage(['variant'], ({ root }) => { put(root, plan(PLAN, { later: true })); }, { width: W }),
    'plan, long': stage(['long'], ({ root }) => { put(root, plan({ ...PLAN, title: LONG_TITLE, reason: UNBROKEN, actions: [{ mark: '+', target: UNBROKEN.slice(0, 40), what: LONG_TITLE }] })); }, { width: 420 }),
    'plan, nothing in it': stage(['empty'], ({ root }) => { put(root, plan({ ...PLAN, actions: [], notes: [] })); }, { width: W }),
    'step waited': stage(['typical'], ({ root }) => { put(root, parked()); }, { width: W }),
    'step waited, with approval rules': stage(['variant'], ({ root }) => { put(root, parked({}, ['approval-rules'])); }, { width: W }),
    'step allowed once': stage(['success'], ({ root }) => { put(root, parked({ answered: { choice: 'once', drafted: false } })); }, { width: W }),
    'step allowed always, exception drafted': stage(['success', 'variant'], ({ root }) => { put(root, parked({ answered: { choice: 'always', drafted: true } }, ['rules-settings'])); }, { width: W }),
    'step denied': stage(['disabled'], ({ root }) => { put(root, parked({ answered: { choice: 'deny', drafted: false } })); }, { width: W }),
    'approval with Edit': stage(['variant'], ({ root }) => { put(root, approval(ASK, ['approval-rules', 'approval-edit'])); }, { width: W }),
    'approval, editing': stage(['open'], ({ root }) => { const t = approval(ASK, ['approval-edit']); put(root, t); t.querySelector<HTMLElement>('[data-value="edit"]')?.click(); }, { width: W }),
    'approval approved, edited': stage(['success'], ({ root }) => { put(root, approval({ ...ASK, resolved: 'approved', how: 'edited', resolvedAt: '11:22' }, [])); }, { width: W }),
    'approval allowed always, exception drafted': stage(['success', 'variant'], ({ root }) => { put(root, approval({ ...ASK, resolved: 'approved', how: 'always', drafted: true, resolvedAt: '11:22' }, ['rules-settings'])); }, { width: W }),
    'approval denied': stage(['disabled'], ({ root }) => { put(root, approval({ ...ASK, resolved: 'denied', resolvedAt: '11:22' }, [])); }, { width: W })
  }
} satisfies Story] satisfies Story[];
