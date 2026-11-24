/* Bubble (21.2 row 14; LAB-v7: user, agent, bot fill (light and dark derived), room byline, you wash, with inline chips; rest, long
   word, code). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, NINA } from './_bots';
import { UNBROKEN } from '../../fixtures';

const thread = (...n: HTMLElement[]): HTMLElement => { const t = document.createElement('div'); t.className = 'k7-thread'; t.setAttribute('data-kit-part', 'Thread'); t.append(...n); return t; };
export default {
  id: 'kit/bubble', title: 'Bubble', area: 'composer', kind: 'component', covers: ['kit.bubble'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => {
      fill(root, thread(kit.bubble({ kind: 'agent', text: 'I will write the changelog from the merged pull requests.' }), kit.bubble({ kind: 'agent', text: 'Fourteen merged since 0.1.10.' }),
        kit.bubble({ kind: 'user', text: 'Keep it short.' }), kit.bubble({ kind: 'agent', text: 'Done: six lines, grouped by area.' })));
      /* a session's thread: every agent-side block in the 30 px gutter, the model's tile on the last bubble of a run (S09) */
      fill(root, thread(kit.bubble({ kind: 'agent', gutter: true, text: 'Reading the billing module.' }), kit.bubble({ kind: 'agent', brand: 'claude-sonnet-4.5', text: 'The rounding happens twice; I will fix it once.' }), kit.bubble({ kind: 'user', text: 'Go.' })));
    }, { width: 640 }),
    'bot fill': stage(['variant'], ({ root }) => {
      fill(root, thread(kit.bubble({ kind: 'user', text: 'Ship it to staging.', fill: kit.botFill(NINA.color) }), kit.bubble({ kind: 'user', text: 'And the changelog.', fill: kit.botFill(KAI.color) })));
    }, { width: 640 }),
    'room byline': stage(['variant'], ({ root }) => {
      fill(root, thread(kit.bubble({ kind: 'bot', byline: { bot: KAI, colour: KAI.color }, html: 'The notes are ready, ' + kit.html.inlineChip({ kind: 'mention', bot: NINA, colour: NINA.color }) + '.' }),
        kit.bubble({ kind: 'bot', byline: { bot: NINA, colour: NINA.color }, toYou: true, html: kit.html.inlineChip({ kind: 'you' }) + ' can I deploy them to staging?' })));
    }, { width: 640 }),
    code: stage(['variant'], ({ root }) => { fill(root, thread(kit.bubble({ kind: 'agent', html: 'Run ' + kit.html.inlineChip({ kind: 'code', text: 'pnpm test' }) + ' then ' + kit.html.inlineChip({ kind: 'reference', text: 'src/billing.ts:42' }) + '.' }))); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, thread(kit.bubble({ kind: 'agent', text: 'The file is ' + UNBROKEN }), kit.bubble({ kind: 'user', text: 'Reconcile the invoices against the ledger before the quarterly close and the auditors arrive on Monday, then tell me what moved.' }))); }, { width: 640 })
  }
} satisfies Story;
