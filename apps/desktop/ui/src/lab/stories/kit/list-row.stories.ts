/* ListRow (21.2 row 17; LAB-v7: session, bot, item, compact; rest, hover, current, needs you, working, long title). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, LONG_BOT, MOSS, NINA } from './_bots';

const all = (): HTMLElement => {
  const w = document.createElement('div'); w.className = 'k7-list'; w.setAttribute('role', 'listbox'); w.setAttribute('aria-label', 'Rows');
  for (const r of [
    kit.listRow({ variant: 'session', title: 'Fix the flaky billing test', sub: 'boopis · 12 min', current: true }),
    kit.listRow({ variant: 'session', title: 'Release 0.2.0', sub: 'running', working: true }),
    kit.listRow({ variant: 'session', title: 'Deploy to staging', sub: 'waiting', needs: true, count: '1' }),
    kit.listRow({ variant: 'bot', title: 'kai', sub: 'Writing the changelog', bot: KAI, working: true }),
    kit.listRow({ variant: 'bot', title: 'nina', needs: 'Needs you: approve a deploy', bot: { ...NINA, state: 'needs', attention: 'approval' } }),
    kit.listRow({ variant: 'bot', title: 'moss', sub: 'asleep', bot: MOSS }),
    kit.listRow({ variant: 'compact', title: 'Deploy to staging', sub: 'nina asks to run the deploy', needs: true, count: '1' })
  ]) w.append(r);
  return w;
};
export default {
  id: 'kit/list-row', title: 'ListRow', area: 'components', kind: 'component', covers: ['kit.listRow', 'kit.list'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, all()); }, { width: 380 }),
    hover: stage(['hover'], ({ root }) => { fill(root, all()); }, { width: 380, force: [{ sel: '[data-kit~="ListRow"]', state: 'hover' }] }),
    long: stage(['long'], ({ root }) => {
      fill(root, kit.list({ label: 'Long rows', rows: [{ variant: 'session', title: 'Reconcile the invoices against the ledger before the quarterly close', sub: '/home/someone/code/billing' },
        { variant: 'bot', title: LONG_BOT.name, sub: 'Watching the staging deploy and its health checks', bot: LONG_BOT }] }));
    }, { width: 300 }),
    items: stage(['variant'], ({ root }) => { fill(root, kit.list({ label: 'Store', rows: [{ variant: 'item', title: 'GitHub', sub: 'Pull requests, issues and checks', markText: 'GH', action: 'Install' }, { variant: 'item', title: 'Linear', sub: 'Issues and projects', markText: 'LN', action: 'Install' }] })); }, { width: 380 })
  }
} satisfies Story;
