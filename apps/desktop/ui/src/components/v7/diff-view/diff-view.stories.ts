/* DiffView (21.2 row 15; LAB-v7: stacked, split; with a comment; rest, comment focused). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import { KAI } from '../../../lab/stories/kit/_bots';

const LINES = [
  { n: 40, sign: ' ' as const, text: 'export function prorate(total: number, days: number) {' },
  { n: 41, sign: '-' as const, text: '  return Math.round(total / days * 100) / 100;' },
  { n: 41, sign: '+' as const, text: '  const cents = Math.round(total * 100);' },
  { n: 42, sign: '+' as const, text: '  return Math.round(cents / days);' },
  { n: 43, sign: ' ' as const, text: '}' }
];
export default {
  id: 'kit/diff-view', title: 'DiffView', area: 'composer', kind: 'component', covers: ['kit.diffView'],
  states: {
    typical: stage(['typical'], ({ root }) => { fill(root, kit.diffView({ path: 'src/billing.ts', lines: LINES })); }, { width: 640 }),
    comment: stage(['variant'], ({ root }) => { fill(root, kit.diffView({ path: 'src/billing.ts', lines: LINES, comment: { at: 3, who: 'kai', bot: KAI, text: 'Round once, at the end: this drifts on 31-day months.' } })); }, { width: 640 }),
    'comment focused': stage(['focus'], async ({ root, wait }) => { const d = kit.diffView({ path: 'src/billing.ts', lines: LINES, focusComment: true, comment: { at: 3, who: 'You', text: 'Why not floor?' } }); fill(root, d); (d.querySelector('.k7-diff__text') as HTMLElement).focus(); await wait(50); }, { width: 640 }),
    /* a file of the tools' Diff (board S24): its head folds it */
    'folds: open': stage(['variant', 'open', 'owner'], ({ root }) => { fill(root, kit.diffView({ path: 'modules/dock/dock.css', lines: LINES, add: 12, del: 3, fold: true, open: true })); }, { width: 496 }),
    'folds: closed': stage(['variant'], ({ root }) => { fill(root, kit.diffView({ path: 'modules/dock/engine.ts', lines: LINES, add: 2, del: 2, fold: true })); }, { width: 496 }),
    'folds: the head hovered and focused': stage(['hover', 'focus'], ({ root }) => { fill(root, kit.diffView({ path: 'modules/dock/engine.ts', lines: LINES, fold: true })); }, { width: 496, force: [{ sel: '.k7-diff__head', state: 'focus' }] }),
    split: stage(['variant'], ({ root }) => { fill(root, kit.diffView({ path: 'src/billing.ts', lines: LINES, variant: 'split' })); }, { width: 900 }),
    long: stage(['long', 'scroll'], ({ root }) => { fill(root, kit.diffView({ path: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded.ts', lines: [{ n: 1, sign: '+', text: 'const url = "https://billing-api.internal.example.com/v2/invoices/inv_01HZX9Q2Y7K3M8N4P6R5S0T1V2W3/reconcile?dry_run=true";' }] })); }, { width: 480 })
  }
} satisfies Story;
