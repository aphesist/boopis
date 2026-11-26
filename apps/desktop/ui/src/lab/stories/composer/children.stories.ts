/* The tasks a turn handed to other models, on the kit (REPASS.md 6e, the lead's design; no board draws it): a ToolRow each in the turn
   that started them (the model's mark and name, the task, its StatusWord: queued, running with its clock, done, error with why in its
   Tooltip, stopped), what it reported quoted under it, a Disclosure over its transcript in a Well, and a ghost Stop while it runs.
   Drawn by the session's own module (modules/session/children.ts) on the session's thread. */
import { fill, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';
import { CUT_NOTE, childrenBlock, resetChildren } from '../../../modules/session/children';
import type { ChildHost } from '../../../modules/session/children';
import type { ChildTask, Turn } from '../../../data';
import { asked, reply, sessionThread } from './_thread';

const W = 720, NOW = 1_800_000_000_000;
const task = (o: Partial<ChildTask> & Pick<ChildTask, 'id' | 'goal' | 'model' | 'status'>): ChildTask => ({ subagentId: 'sa-' + o.id, childSession: 'cs-' + o.id, index: 0, startedAt: NOW - 12_000, seconds: null, tools: 0, now: '', summary: '', ...o });
const FOUR: readonly ChildTask[] = [
  task({ id: 'a', model: 'claude-opus-5-5', goal: 'Review the diff in src/billing for rounding errors', status: 'running', now: 'read_file src/billing/invoice.ts', tools: 3 }),
  task({ id: 'b', model: 'gpt-6-luna', goal: 'Write the migration that moves invoices to integer cents', status: 'done', seconds: 64, tools: 9, summary: 'Added 0042_integer_cents.sql and a rollback; both run on the sample database.' }),
  task({ id: 'c', model: 'gemini-3.8-flash', goal: 'Find every caller of prorate() outside src/billing', status: 'failed', seconds: 8, tools: 2, summary: 'The search tool timed out twice.' }),
  task({ id: 'd', model: 'grok-4', goal: 'Draft the changelog entry', status: 'stopped', seconds: 5, tools: 1 })
];
const TRANSCRIPT: readonly Turn[] = [
  { id: 'u', role: 'user', at: '09:41', text: 'Write the migration that moves invoices to integer cents.' },
  { id: 'x', role: 'assistant', model: 'gpt-6-luna', time: '1m 04s', cost: '', stepCount: 3, status: 'done', paragraphs: ['Added 0042_integer_cents.sql and a rollback. Both ran on the sample database: every row moves.'], bullets: [],
    steps: [{ title: 'Read', mono: true, meta: ['db/schema.sql'], time: '0:04' }, { title: 'Wrote', mono: true, meta: ['db/0042_integer_cents.sql'], time: '0:31' }, { title: 'Ran', mono: true, meta: ['pnpm db:migrate --dry'], time: '0:58' }] }
];
const host = (o: { stop?: boolean; open?: boolean; fail?: boolean } = {}): ChildHost => ({
  col: () => null, now: () => NOW,
  ...(o.stop === false ? {} : { stop: () => undefined }),
  ...(o.open === false ? {} : { transcript: () => (o.fail ? Promise.reject(new Error('its session was removed')) : Promise.resolve(TRANSCRIPT)) })
});
const turn = (kids: readonly ChildTask[], h = host()): HTMLElement => { resetChildren(); return sessionThread(asked('Split the cents work four ways.'), reply('I sent four tasks, one to each model you named. Their results come back here.', 'claude-sonnet-5-5'), childrenBlock(kids, h)); };
const openFirst = async (root: HTMLElement): Promise<void> => { root.querySelector<HTMLElement>('[data-child-id] .k7-disc__sum')?.click(); await new Promise((r) => setTimeout(r, 30)); };

export default [
  {
    id: 'composer/children', title: 'Tasks handed to other models', area: 'composer', kind: 'component', covers: ['surface:children'],
    states: {
      typical: stage(['typical', 'many'], ({ root }) => { fill(root, turn(FOUR)); }, { width: W }),
      queued: stage(['variant'], ({ root }) => { fill(root, turn([task({ id: 'q', model: 'claude-haiku-5-5', goal: 'Summarise the README', status: 'queued', startedAt: null, subagentId: '' })])); }, { width: W }),
      running: stage(['loading'], ({ root }) => { fill(root, turn([FOUR[0] as ChildTask])); }, { width: W }),
      'stop hovered': stage(['hover'], ({ root }) => { fill(root, turn([FOUR[0] as ChildTask])); }, { width: W, force: [{ sel: '[data-action="stop"]', state: 'hover' }] }),
      done: stage(['success'], ({ root }) => { fill(root, turn([FOUR[1] as ChildTask])); }, { width: W }),
      'transcript open': stage(['open'], async ({ root }) => { fill(root, turn([FOUR[1] as ChildTask])); await openFirst(root); }, { width: W }),
      'transcript could not be read': stage(['error', 'open'], async ({ root }) => { fill(root, turn([FOUR[1] as ChildTask], host({ fail: true }))); await openFirst(root); }, { width: W }),
      error: stage(['error'], ({ root }) => { fill(root, turn([FOUR[2] as ChildTask])); }, { width: W }),
      'error, its reason': stage(['error', 'focus'], ({ root }) => { fill(root, turn([FOUR[2] as ChildTask])); }, { width: W, force: [{ sel: '[data-kit~="StatusWord"][data-tip]', state: 'focus' }] }),
      'after a resume': stage(['variant'], ({ root }) => { fill(root, turn([{ ...(FOUR[1] as ChildTask), summary: 'Added 0042_integer_cents.sql and a rollback; every row moves.', cut: true }, { ...(FOUR[3] as ChildTask), childSession: '' }], host({ stop: false }))); }, { width: W, note: 'read back from the turn book: none can be stopped; a report longer than the book keeps ends with' + CUT_NOTE }),
      'nothing to open or stop (the page build)': stage(['empty'], ({ root }) => { fill(root, turn([FOUR[0] as ChildTask], host({ stop: false, open: false }))); }, { width: W }),
      long: stage(['long'], ({ root }) => { fill(root, turn([task({ id: 'l', model: 'claude-sonnet-5-5-20261101-extended-context-preview', goal: LONG_TITLE + ' ' + UNBROKEN, status: 'running', now: UNBROKEN }), task({ id: 'm', model: 'gpt-6-luna', goal: LONG_TITLE, status: 'done', seconds: 599, summary: LONG_TITLE + ' ' + UNBROKEN })])); }, { width: 420 })
    }
  }
] satisfies Story[];
