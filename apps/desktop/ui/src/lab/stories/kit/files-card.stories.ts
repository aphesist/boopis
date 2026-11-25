/* FilesCard (21.2 row 10; LAB-v7: 1 file, 12 files; collapsed, open). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';

const MANY = Array.from({ length: 12 }, (_, i) => ({ path: 'src/billing/part-' + (i + 1) + '.ts', add: 3 + i, del: i % 3 }));
export default {
  id: 'kit/files-card', title: 'FilesCard', area: 'composer', kind: 'component', covers: ['kit.filesCard'],
  states: {
    typical: stage(['typical'], ({ root }) => { fill(root, kit.filesCard({ files: [{ path: 'src/billing.ts', add: 12, del: 4 }] })); }, { width: 560 }),
    open: stage(['open', 'many'], ({ root }) => { fill(root, kit.filesCard({ files: MANY, open: true })); }, { width: 560 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.filesCard({ open: true, files: [{ path: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded.ts', add: 120, del: 48 }] })); }, { width: 420 }),
    /* board S23: the count with the turn's lines, Open diff, a row per file */
    'two files, S23': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.filesCard({ action: 'Open diff', files: [{ path: 'modules/dock/dock.css', add: 12, del: 3 }, { path: 'modules/dock/engine.ts', add: 2, del: 2 }] })); }, { width: 610 }),
    'the action hovered': stage(['hover'], ({ root }) => { fill(root, kit.filesCard({ action: 'Open diff', files: [{ path: 'modules/dock/dock.css', add: 12, del: 3 }] })); }, { width: 610, force: [{ sel: '[data-files]', state: 'hover' }] }),
    'the action focused': stage(['focus'], ({ root }) => { fill(root, kit.filesCard({ action: 'Open diff', files: [{ path: 'modules/dock/dock.css', add: 12, del: 3 }] })); }, { width: 610, force: [{ sel: '[data-files]', state: 'focus' }] }),
    'many, folded': stage(['many'], ({ root }) => { fill(root, kit.filesCard({ files: MANY, fold: true, action: 'Open diff' })); }, { width: 610 }),
    'many, unfolded': stage(['many', 'open'], ({ root }) => { fill(root, kit.filesCard({ files: MANY, fold: true, open: true, action: 'Open diff' })); }, { width: 610 }),
    empty: stage(['empty'], ({ root }) => { fill(root, kit.filesCard({ files: [] })); }, { width: 610 }),
    narrow: stage(['size', 'long'], ({ root }) => { fill(root, kit.filesCard({ action: 'Open diff', files: [{ path: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded.ts', add: 120, del: 48 }, { path: 'a.ts', add: 1, del: 0 }] })); }, { width: 328 })
  }
} satisfies Story;
