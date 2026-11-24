/* Composer (21.2 row 39; LAB-v7: session, bot, room, dock, notch; with its line; quick menu open; empty, typed, multi-line, running
   (Enter queues), held, no model). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';
import { NINA } from './_bots';

const LINE = [{ label: 'Mode', value: 'Governed' }, { label: 'Model', value: 'Smart' }, { label: 'Branch', value: 'w32/kit-v7', mono: true }, { label: 'Context', value: '76k / 200k', end: true, mono: true }, { label: 'Cost', value: '$0.37 of $0.60', end: true, mono: true }];
const empty = stage(['typical', 'empty'], ({ root }) => { fill(root, kit.composer({ line: LINE })); }, { width: 720 });
export default {
  id: 'kit/composer', title: 'Composer', area: 'composer', kind: 'component', covers: ['kit.composer'],
  states: {
    typical: empty,
    ...forced(empty, '[data-kit~="Composer"] [data-kit~="IconButton"]'),
    typed: stage(['variant'], ({ root }) => { fill(root, kit.composer({ line: LINE, textHTML: 'Deploy to ' + kit.html.mark({ text: 'staging', state: 'shown' }) + ' after ' + kit.html.mark({ text: 'the tests pass', state: 'shown' }) })); }, { width: 720 }),
    'multi-line': stage(['variant'], ({ root }) => { fill(root, kit.composer({ line: LINE, text: 'First, read the billing module.\nThen find where the rounding happens twice.\nFix it once, at the end, and run the tests.' })); }, { width: 720 }),
    running: stage(['loading'], ({ root }) => { fill(root, kit.composer({ running: true, line: LINE, hint: 'Enter queues, ctrl Enter steers' })); }, { width: 720 }),
    held: stage(['variant'], ({ root }) => { fill(root, kit.queue({ variant: 'held' })); fill(root, kit.composer({ kind: 'room', running: true, line: [{ label: 'Members', value: '3 members' }, { label: 'Cost', value: '$0.12', end: true, mono: true }] })); }, { width: 720 }),
    'no model': stage(['variant'], ({ root }) => { fill(root, kit.composer({ line: [{ label: 'Model', value: '+ Choose a model', need: true }] })); }, { width: 720 }),
    bot: stage(['variant'], ({ root }) => { fill(root, kit.composer({ kind: 'bot', text: 'Ship it', fill: kit.botFill(NINA.color), line: [{ label: 'Model', value: 'Claude Sonnet 4.5' }, { label: 'Cost', value: '$0.04', end: true, mono: true }] })); }, { width: 720 }),
    dock: stage(['variant'], ({ root }) => { fill(root, kit.composer({ kind: 'dock' })); }, { width: 624, ground: 'dock' }),
    notch: stage(['variant'], ({ root }) => { fill(root, kit.composer({ kind: 'notch' })); }, { width: 420 }),
    'quick menu open': stage(['open'], async ({ root, wait }) => {
      const c = kit.composer({ line: LINE }); fill(root, c);
      kit.openMenu(c.querySelector('[data-plus]') as HTMLElement, { label: 'Show under the composer', variant: 'quick', place: 'above', entries: [{ heading: 'Show under the composer' }, { label: 'Mode', checked: true }, { label: 'Smart', checked: true }, { label: 'Model', checked: false }, { label: 'Cost', checked: true }, { label: 'Context', checked: false }] });
      await wait(200);
    }, { width: 720, overlay: { anchor: '[data-plus]', layer: '.k7-menu[data-floating]' } }),
    long: stage(['long'], ({ root }) => { fill(root, kit.composer({ line: LINE, text: 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close and the auditors arrive on Monday, then tell me what moved and why.' })); }, { width: 480 })
  }
} satisfies Story;
