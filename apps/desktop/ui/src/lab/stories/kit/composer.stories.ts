/* Composer (21.2 row 39; LAB-v7: session, bot, room, dock, notch; with its line; quick menu open; empty, typed, multi-line, running
   (Enter queues), held, no model). */
import { kit } from '@boopis/ui';
import { fill, forced, frames, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, LONG_BOT, MOSS, NINA } from './_bots';

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
    long: stage(['long'], ({ root }) => { fill(root, kit.composer({ line: LINE, text: 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close and the auditors arrive on Monday, then tell me what moved and why.' })); }, { width: 480 }),

    /* board 12: a room's composer, its line (how many members, what the talk has cost) */
    'a room': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.composer({ kind: 'room', placeholder: 'Message release crew', line: [{ label: 'Members', value: '3 members', icon: 'at', plain: true }, { label: 'Spend', value: '$0.21', mono: true, end: true }] })); }, { width: 720 }),
    'a room, a member answers first': stage(['variant'], ({ root }) => { fill(root, kit.composer({ kind: 'room', placeholder: 'Message release crew', hint: 'kai answers first', line: [{ label: 'Members', value: '3 members', icon: 'at', plain: true }] })); }, { width: 720 }),
    /* owner, 25 November: a mention and a file are chips in the text */
    'chips in the text: a mention, the room, a file': stage(['variant', 'owner'], ({ root }) => {
      fill(root, kit.composer({ kind: 'room', line: [{ label: 'Members', value: '3 members', icon: 'at', plain: true }], textHTML: 'hey ' + kit.html.inlineChip({ kind: 'mention', bot: NINA, colour: NINA.color, words: '@nina' }) + ' ship it, ' + kit.html.inlineChip({ kind: 'mention', text: '@all', members: [KAI, NINA, MOSS], words: '@all' }) + ' read ' + kit.html.inlineChip({ kind: 'reference', text: '@CHANGELOG.md', words: '@/home/you/code/boopis/CHANGELOG.md' }) + ' first' }));
    }, { width: 720 }),
    'chips in the text, narrow: they wrap with the words': stage(['size', 'long'], ({ root }) => {
      fill(root, kit.composer({ kind: 'room', textHTML: kit.html.inlineChip({ kind: 'reference', text: '@a-very-long-file-name-for-the-release-notes.md', words: '@/x/a-very-long-file-name-for-the-release-notes.md' }) + ' and ' + kit.html.inlineChip({ kind: 'mention', bot: LONG_BOT, colour: LONG_BOT.color, words: '@' + LONG_BOT.id }) + ' then ' + kit.html.inlineChip({ kind: 'mention', bot: KAI, colour: KAI.color, words: '@kai' }) }));
    }, { width: 320 }),
    /* "@" opens the kit's Menu over the composer, under its heading (as the composer's lists of boards S31 and S32) */
    'the "@" list, open': stage(['open', 'owner'], async ({ root }) => {
      const c = kit.composer({ kind: 'room', placeholder: 'Message release crew', line: [{ label: 'Members', value: '3 members', icon: 'at', plain: true }] });
      const pad = document.createElement('div'); pad.style.paddingTop = '220px'; pad.append(c); fill(root, pad);
      kit.mentions(c, { label: 'Members', foot: () => 'Only the bots you name answer. With no name, every member does.', entries: () => [KAI, NINA, MOSS].map((b) => ({ value: b.id, label: b.name, desc: b.id === 'kai' ? 'docs and changelog' : b.id === 'nina' ? 'deploys' : 'flaky test hunter', leadHTML: kit.html.avatar({ bot: b, size: 16, still: true }) })) });
      const t = c.querySelector<HTMLElement>('.k7-composer__text') as HTMLElement;
      t.focus(); t.textContent = '@'; const r = document.createRange(); r.setStart(t.firstChild as Node, 1); r.collapse(true); getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
      t.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(3);
    }, { width: 720 })
  }
} satisfies Story;
