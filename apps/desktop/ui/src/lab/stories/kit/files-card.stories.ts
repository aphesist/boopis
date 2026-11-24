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
    long: stage(['long'], ({ root }) => { fill(root, kit.filesCard({ open: true, files: [{ path: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded.ts', add: 120, del: 48 }] })); }, { width: 420 })
  }
} satisfies Story;
