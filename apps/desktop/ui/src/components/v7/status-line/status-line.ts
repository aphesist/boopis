/* StatusLine: its view (typed props to markup) and its contract. Its look is status-line.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { orbHtml } from '../../orb';
import { kitStack } from '../avatar/avatar';
import { attrs, cls, esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── StatusLine (34): bot (its live 16 px orb), session (the answering model's mark, breathing), system (the phrase alone) ── */
export const STATUS_LINE_KINDS = ['bot', 'session', 'system'] as const;
export type StatusLineKind = typeof STATUS_LINE_KINDS[number];
export interface StatusLineOpts {
  kind?: U<StatusLineKind>; phrase: string; working?: U<boolean>; bot?: U<BotLike>; members?: U<readonly BotLike[]>; model?: U<ModelRef>; count?: U<string>;
  /** inside the title pill: no live region of its own (the pill names it) */ inPill?: U<boolean>; attrs?: U<Attrs>;
}
export function statusLine(o: StatusLineOpts): string {
  const kind = o.kind ?? 'bot', working = o.working !== false;
  const lead = kind === 'bot'
    ? (o.members && o.members.length > 1 ? kitStack(o.members, 16) : o.bot ? orbHtml(o.bot, { size: 16, live: working, mode: 'fixed', ...(working ? { state: 'working' } : {}) })   /* at rest it keeps the bot's own face (board 11: "Waiting for you" with the needs-you face) */ : '')
    : kind === 'session' ? '<span class="k7-status__mark"' + attrs({ 'data-pulse': working ? '' : null, 'data-live': working ? '' : null }) + '>' + markHTML(o.model ?? null, { size: 16, label: false }) + '</span>' : '';
  return '<div class="k7-status"' + kitAttrs('StatusLine', { 'data-kind': kind, 'data-working': working ? '' : null, role: o.inPill ? null : 'status', 'aria-live': o.inPill ? null : 'polite', ...(o.attrs ?? {}) }) + '>' + lead +
    '<span class="' + cls('k7-status__phrase', working && 'k7-shimmer') + '"' + attrs({ 'data-live': working ? '' : null }) + '>' + esc(o.phrase) + '</span>' +
    (o.count ? '<span class="k7-status__count k7-mono">' + esc(o.count) + '</span>' : '') + '</div>';
}

/** what StatusLine promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<StatusLineOpts>({
  name: 'StatusLine',
  folder: 'status-line',
  layer: 'inline',
  summary: 'What is happening now, in one line with one shimmer: a bot\'s (its live orb), a session\'s (the answering model\'s mark, breathing), or the system\'s (the phrase alone).',
  exports: ['statusLine'],
  props: {
    kind: 'bot (the default), session or system',
    phrase: 'what is happening ("Reading the tests")',
    working: 'it is still going (the shimmer); false at rest',
    bot: 'bot: whose orb leads',
    members: 'bot: several at work, stacked',
    model: 'session: the answering model',
    count: 'a count at its end, in mono',
    inPill: 'inside the title pill: no live region of its own',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-kind', 'data-working'],
  parts: ['k7-status__phrase', 'k7-status__mark'],
  tokens: [
    '--dur-breathe', '--dur-shimmer', '--ease-io', '--fs-l', '--fs-xs', '--gap-xs', '--lh-m', '--sp-2', '--text', '--text-dim'
  ],
  a11y: 'role="status" with aria-live="polite", so a change is said once; inside the title pill the pill names it instead.',
  boards: []
});
