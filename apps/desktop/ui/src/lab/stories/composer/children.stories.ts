/* The tasks a turn handed to other models: a card per child agent, in the turn that started them. A turn with four of them
   shows every ending a child can have (working, done, failed, stopped); the card alone, long text and a card with no session to
   open. Drawn with the kit's `ui.child` inside the call-number entry, as the session draws them (modules/session/children.ts). */
import { html, ui } from '@boopis/ui';
import type { ChildOpts } from '@boopis/ui';
import { line, put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const CONV = { url: '/v6/design-system/index.html#c-conversation', crop: '#c-conversation' };
const W = 720;

const FOUR: readonly ChildOpts[] = [
  { id: 'a', model: 'claude-opus-5-5', goal: 'Review the diff in src/billing for rounding errors', status: 'running', time: '12s', now: 'read_file src/billing/invoice.ts', tools: 3, canOpen: true, canStop: true },
  { id: 'b', model: 'gpt-6-luna', goal: 'Write the migration that moves invoices to integer cents', status: 'done', time: '1m 04s', tools: 9, summary: 'Added 0042_integer_cents.sql and a rollback; both run on the sample database.', canOpen: true },
  { id: 'c', model: 'gemini-3.8-flash', goal: 'Find every caller of prorate() outside src/billing', status: 'failed', time: '8s', tools: 2, summary: 'The search tool timed out twice.', canOpen: true },
  { id: 'd', model: 'grok-4', goal: 'Draft the changelog entry', status: 'stopped', time: '5s', tools: 1, summary: 'Stopped before it finished.', canOpen: true }
];
const turnWith = (kids: readonly ChildOpts[]): HTMLElement => {
  const box = document.createElement('div'); box.className = 'ss-children';
  for (const k of kids) box.append(ui.child(k));
  return ui.entry({ kind: 'agent', callno: ['claude-sonnet-5-5', '48s', '$0.04'], body: '<p>' + html.inline('I sent four tasks, one to each model you named. Their results come back here.') + '</p>' + box.outerHTML });
};

export default [
  {
    id: 'composer/children', title: 'Tasks handed to other models', area: 'composer', kind: 'component', covers: ['ui.child', 'html.child'], mock: CONV,
    states: {
      typical: stage(['typical', 'variant', 'many'], ({ root }) => { put(root, turnWith(FOUR)); ui.hydrate(root); }, { width: W }),
      'the card alone': stage(['single', 'variant'], ({ root }) => { line(root, ui.child(FOUR[0] as ChildOpts)); }, { width: 420 }),
      'queued, and no session to open yet': stage(['variant'], ({ root }) => { line(root, ui.child({ id: 'q', model: 'claude-haiku-5-5', goal: 'Summarise the README', status: 'queued' })); }, { width: 420 }),
      long: stage(['long'], ({ root }) => { line(root, ui.child({ id: 'l', model: 'claude-sonnet-5-5-20261101-extended-context-preview', goal: LONG_TITLE + ' ' + UNBROKEN, status: 'running', time: '3m 02s', now: UNBROKEN, tools: 120, canOpen: true, canStop: true }), ui.child({ id: 'm', model: 'gpt-6-luna', goal: LONG_TITLE, status: 'done', time: '9m 59s', summary: LONG_TITLE + ' ' + UNBROKEN, canOpen: true })); }, { width: 420 }),
      empty: stage(['empty'], ({ root }) => { line(root, ui.child({ id: 'e', model: '', goal: '', status: 'queued' })); }, { width: 420 }),
      error: stage(['error'], ({ root }) => { line(root, ui.child(FOUR[2] as ChildOpts)); }, { width: 420 })
    }
  }
] satisfies Story[];
