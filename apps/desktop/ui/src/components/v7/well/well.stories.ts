/* Well (21.2 row 16; LAB-v7: code in a Block, code in a bubble, terminal; rest, long line (scrolls, code allowed)). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/well', title: 'Well', area: 'composer', kind: 'component', covers: ['kit.well'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => {
      fill(root, kit.block({ body: kit.html.well({ text: 'pnpm --filter ui test\n  42 passed' }) }));
      fill(root, kit.bubble({ kind: 'agent', html: '<p>Round once, at the end:</p>' + kit.html.well({ text: 'const cents = Math.round(total * 100);' }) + '<p>That is the whole fix.</p>' }));
      fill(root, kit.well({ kind: 'terminal', path: '~/code/boopis', branch: 'w32/kit-v7', text: '$ pnpm typecheck\nDone in 4.2s\n$ pnpm test\n  1268 passed' }));
    }, { width: 560 }),
    long: stage(['long', 'scroll'], ({ root }) => { fill(root, kit.well({ text: 'curl -s https://billing-api.internal.example.com/v2/invoices/inv_01HZX9Q2Y7K3M8N4P6R5S0T1V2W3/reconcile?dry_run=true | jq .' })); }, { width: 420 })
  }
} satisfies Story;
