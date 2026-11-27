/* TeamPlan: its view (typed props to markup) and its contract. Its look is team-plan.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { esc, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── TeamPlan (6e, derived from O-B06's team-plan block): what a proposed change to the team does, one row per action led by its
   mark (+ added, ~ changed, − removed), what it is about and what changes; the plan's problems as error lines, its notes quiet, and
   a quiet note where an action cannot be undone. It is what an AskCard asks about (`fields`), here and in the first run's O-B06 ── */
export type PlanMark = '+' | '~' | '-' | '−';
export interface PlanAction { mark: PlanMark | string; target: string; what?: U<string>; /** what leads the target (a bot's 16 orb) */ leadHTML?: U<string> }
export interface TeamPlanOpts {
  actions: readonly PlanAction[]; problems?: U<readonly string[]>; notes?: U<readonly string[]>;
  /** an action that cannot be undone (disbanding a room), said in one quiet line */ permanent?: U<string>; attrs?: U<Attrs>;
}
const PLAN_MARK: Readonly<Record<string, readonly [glyph: string, tone: string, said: string]>> = { '+': ['+', 'add', 'adds'], '~': ['~', 'change', 'changes'], '-': ['−', 'del', 'removes'], '−': ['−', 'del', 'removes'] };
export function teamPlan(o: TeamPlanOpts): string {
  const rows = o.actions.map((a) => {
    const [g, tone, said] = PLAN_MARK[a.mark] ?? ['•', 'neutral', ''];
    return '<li class="k7-plan__row"' + partAttrs('PlanRow', { 'data-mark': tone }) + '><span class="k7-plan__mark k7-mono" aria-hidden="true">' + esc(g) + '</span>' + (a.leadHTML ?? '') +
      '<span class="k7-plan__text"><span class="k7-sr">' + esc(said) + ' </span><span class="k7-plan__target">' + esc(a.target) + '</span>' + (a.what ? ' <span class="k7-plan__what">' + esc(a.what) + '</span>' : '') + '</span></li>';
  }).join('');
  return '<div class="k7-plan"' + kitAttrs('TeamPlan', o.attrs ?? null) + '>' + (rows ? '<ul class="k7-plan__list" aria-label="What the plan changes">' + rows + '</ul>' : '') +
    (o.problems ?? []).map((p) => '<p class="k7-plan__problem k7-text" role="alert">' + esc(p) + '</p>').join('') +
    (o.notes ?? []).map((n) => '<p class="k7-plan__note k7-text">' + esc(n) + '</p>').join('') +
    (o.permanent ? '<p class="k7-plan__note k7-text" data-permanent>' + esc(o.permanent) + '</p>' : '') + '</div>';
}

/** what TeamPlan promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<TeamPlanOpts>({
  name: 'TeamPlan',
  folder: 'team-plan',
  layer: 'thread',
  summary: 'What a proposed change to the team does: a row per action led by its mark (+ adds, ~ changes, − removes), then problems, notes and a permanent note.',
  exports: ['teamPlan'],
  props: {
    actions: 'its actions: a mark, a target, what it does, a lead',
    problems: 'what stops it, as alerts',
    notes: 'quiet notes',
    permanent: 'an action that cannot be undone, in one quiet line',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-mark'],
  parts: ['PlanRow'],
  tokens: [
    '--add', '--ctl-s', '--fs-s', '--fs-xs', '--icon-s', '--lh-s', '--lh-xs', '--pad-text', '--red-text', '--sp-1', '--sp-2',
    '--text', '--text-dim'
  ],
  a11y: 'A list; each mark is also said in words ("adds"), and a problem is role="alert".',
  boards: []
});
