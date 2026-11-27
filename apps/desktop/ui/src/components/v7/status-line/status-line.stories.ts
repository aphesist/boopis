/* StatusLine (21.2 row 34; LAB-v7: bot, session, system; working, waiting, reduced motion). The checker's still is reduced
   motion: the shimmer and the breath rest there (9.2); the full-motion pass samples them. */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import { KAI, MOSS, ORB3_MOTION } from '../../../lab/stories/kit/_bots';

export default {
  id: 'kit/status-line', title: 'StatusLine', area: 'components', kind: 'component', covers: ['kit.statusLine'],
  states: {
    typical: stage(['typical', 'variant', 'loading'], ({ root }) => {
      fill(root, kit.statusLine({ kind: 'bot', bot: KAI, phrase: 'Reading the changelog' }));
      fill(root, kit.statusLine({ kind: 'bot', members: [KAI, MOSS], phrase: 'kai and moss are replying' }));
      fill(root, kit.statusLine({ kind: 'session', model: 'claude-sonnet-4.5', phrase: 'Running the tests', count: '3 of 12' }));
      fill(root, kit.statusLine({ kind: 'system', phrase: 'Checking the gate' }));
    }, { width: 560, allow: { 'orb.edges': ORB3_MOTION } }),
    waiting: stage(['variant'], ({ root }) => {
      fill(root, kit.statusLine({ kind: 'bot', bot: KAI, phrase: 'Waiting for your approval', working: false }));
      fill(root, kit.statusLine({ kind: 'session', model: 'gpt-5', phrase: 'Waiting for your approval', working: false }));
    }, { width: 560 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.statusLine({ kind: 'session', model: 'claude-sonnet-4.5', phrase: 'Reconciling the invoices against the ledger before the quarterly close and the audit' })); }, { width: 360 })
  }
} satisfies Story;
