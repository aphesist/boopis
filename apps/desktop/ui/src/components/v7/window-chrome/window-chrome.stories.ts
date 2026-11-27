/* WindowChrome (21.2 row 1; LAB-v7: rail A, compact B; title idle, title running; search hint, search pill; rest, hover, focus). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import { KAI, ORB3_MOTION } from '../../../lab/stories/kit/_bots';

const typical = stage(['typical', 'variant'], ({ root }) => { fill(root, kit.windowChrome({ title: 'kai', bot: KAI })); }, { width: 1200 });
export default {
  id: 'kit/window-chrome', title: 'WindowChrome', area: 'shell', kind: 'component', covers: ['kit.windowChrome', 'kit.titlePill', 'kit.searchHint'],
  states: {
    typical,
    ...forced(typical, '.k7-search-hint, [data-kit-part~="TitlePill"]'),
    'compact rail': stage(['variant'], ({ root }) => { fill(root, kit.windowChrome({ title: 'kai', bot: KAI, rail: 'b' })); }, { width: 1000 }),
    'title running': stage(['variant', 'loading'], ({ root }) => { fill(root, kit.windowChrome({ title: 'kai', bot: KAI, running: 'Writing the changelog' })); }, { width: 1200, allow: { 'orb.edges': ORB3_MOTION } }),
    'search pill': stage(['variant'], ({ root }) => { fill(root, kit.windowChrome({ title: 'Fix the flaky billing test', search: 'pill' })); }, { width: 1200 }),
    'search button': stage(['variant'], ({ root }) => { fill(root, kit.windowChrome({ title: 'Fix the flaky billing test', search: 'button', windowControls: false })); }, { width: 1200 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.windowChrome({ title: 'Reconcile the invoices against the ledger before the quarterly close and the audit', running: 'Running the tests' })); }, { width: 1200 })
  }
} satisfies Story;
