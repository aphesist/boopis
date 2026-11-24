/* ToolRow (21.2 row 8; LAB-v7: edit, command, read, search; running, done, failed, waiting (attached AskCard), long path). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';
import { NINA } from './_bots';

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
    long: stage(['long'], ({ root }) => { fill(root, kit.toolRow({ kind: 'edit', tool: 'Edit', target: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded.ts' })); }, { width: 420 })
  }
} satisfies Story;
