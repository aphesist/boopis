/* ToolRow (21.2 row 8; LAB-v7: edit, command, read, search; running, done, failed, waiting (attached AskCard), long path). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';
import { NINA } from './_bots';

const S20 = [{ label: 'Deny', value: 'deny', outline: true, keys: 'esc' }, { label: 'Always allow this session', value: 'session' }, { label: 'Hold to allow once', value: 'once', primary: true, hold: true }];
const col = (...n: HTMLElement[]): HTMLElement => { const t = document.createElement('div'); t.className = 'k7-thread'; t.setAttribute('data-kit-part', 'Steps'); t.append(...n); return t; };
const typical = stage(['typical', 'variant'], ({ root }) => {
  fill(root, col(
    kit.toolRow({ kind: 'command', tool: 'Terminal', target: 'ran 2 commands', model: 'claude-sonnet-4.5' }),
    kit.toolRow({ kind: 'read', tool: 'Read', target: '14 merged pull requests' }),
    kit.toolRow({ kind: 'edit', tool: 'Edit', target: 'src/billing.ts', state: 'running' }),
    kit.toolRow({ kind: 'search', tool: 'Search', target: '"prorateCents"', state: 'failed' })));
}, { width: 560 });
export default {
  id: 'kit/tool-row', title: 'ToolRow', area: 'composer', kind: 'component', covers: ['kit.toolRow'],
  states: {
    typical,
    ...forced(typical, '.k7-tool__head'),
    open: stage(['open'], ({ root }) => { fill(root, kit.toolRow({ kind: 'command', tool: 'Terminal', target: 'ran 2 commands', open: true, command: '$ pnpm test\n  1268 passed' })); fill(root, kit.toolRow({ kind: 'read', tool: 'Release 0.2.0', target: 'step 3 of 5', open: true, steps: [{ text: 'Bump the version', time: '0:04' }, { text: 'Write the notes', time: '0:31' }, { text: 'Build the installers', state: 'now' }, { text: 'Tag the release', state: 'todo' }] })); }, { width: 560 }),
    waiting: stage(['variant'], ({ root }) => { fill(root, kit.toolRow({ kind: 'command', tool: 'Terminal', target: 'deploy to staging', state: 'waiting', ask: { bot: NINA, ask: 'Run the deploy to staging', sub: 'Rule: “Ask before deploys”', command: 'fly deploy --app billing-staging' } })); }, { width: 560 }),
    error: stage(['error'], ({ root }) => { fill(root, kit.toolRow({ kind: 'command', tool: 'Terminal', target: 'pnpm build', state: 'failed', open: true, command: '$ pnpm build\nerror TS2339: Property keys does not exist' })); }, { width: 560 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.toolRow({ kind: 'edit', tool: 'Edit', target: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded.ts' })); }, { width: 420 }),
    /* boards S09 and S20: a change waiting on its row, then what became of it */
    'a change waiting, S20': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.toolRow({ kind: 'edit', state: 'waiting', tool: 'modules/dock/dock.css', model: 'sonnet 5.5', add: 12, del: 3, ask: { ask: 'Allow this change?', answers: S20 } })); }, { width: 610 }),
    'a command waiting': stage(['variant'], ({ root }) => { fill(root, kit.toolRow({ kind: 'command', state: 'waiting', tool: 'pnpm test --filter billing', model: 'sonnet 5.5', ask: { ask: 'Allow this command?', answers: [S20[0] as typeof S20[number], S20[2] as typeof S20[number]] } })); }, { width: 610 }),
    'allowed, and denied with feedback': stage(['variant', 'success'], ({ root }) => {
      fill(root, col(kit.toolRow({ kind: 'edit', tool: 'modules/dock/dock.css', model: 'sonnet 5.5', add: 12, del: 3, word: 'Allowed once 09:43' }), kit.toolRow({ kind: 'edit', tool: 'modules/dock/dock.css', model: 'sonnet 5.5', add: 12, del: 3, word: 'Denied 09:44', note: 'Keep the transform, fix the clip instead' })));
    }, { width: 610 }),
    'an answer hovered': stage(['hover'], ({ root }) => { fill(root, kit.toolRow({ kind: 'edit', state: 'waiting', tool: 'modules/dock/dock.css', model: 'sonnet 5.5', add: 12, del: 3, ask: { ask: 'Allow this change?', answers: S20 } })); }, { width: 610, force: [{ sel: '.k7-tool .k7-chip', state: 'hover' }] }),
    'an answer focused': stage(['focus'], ({ root }) => { fill(root, kit.toolRow({ kind: 'edit', state: 'waiting', tool: 'modules/dock/dock.css', model: 'sonnet 5.5', add: 12, del: 3, ask: { ask: 'Allow this change?', answers: S20 } })); }, { width: 610, force: [{ sel: '.k7-tool .k7-chip', state: 'focus' }] }),
    /* 6f: a name that is words (a model handed a task) takes the regular face; the tool rows above keep mono for commands and paths */
    'a model\'s name, in words': stage(['variant'], ({ root }) => { fill(root, col(kit.toolRow({ kind: 'command', icon: '', text: true, tool: 'opus 5.5', model: 'claude-opus-5-5', target: 'Review the diff', state: 'running', word: 'running 12s' }), kit.toolRow({ kind: 'command', icon: '', text: true, tool: 'gpt 6', model: 'gpt-6-luna', target: 'Write the release notes', word: 'done 41s' }))); }, { width: 560 }),
    'waiting, narrow: the answers wrap': stage(['size', 'long'], ({ root }) => { fill(root, kit.toolRow({ kind: 'edit', state: 'waiting', tool: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded.ts', model: 'sonnet 5.5', add: 120, del: 48, ask: { ask: 'Allow this change?', answers: S20 } })); }, { width: 328 })
  }
} satisfies Story;
