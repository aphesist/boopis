/* Composer (21.2 row 39; LAB-v7: session, bot, room, dock, notch; with its line; quick menu open; empty, typed, multi-line, running
   (Enter queues), held, no model). */
import { kit } from '@boopis/ui';
import { fill, forced, frames, stage } from '../../../lab/story';
import type { State, Story } from '../../../lab/types';
import { KAI, LONG_BOT, MOSS, NINA } from '../../../lab/stories/kit/_bots';
import { LONG_TITLE, RTL, UNBROKEN } from '../../../lab/kit-fixtures';

const LINE = [{ label: 'Mode', value: 'Governed' }, { label: 'Model', value: 'Smart' }, { label: 'Branch', value: 'w32/kit-v7', mono: true }, { label: 'Context', value: '76k / 200k', end: true, mono: true }, { label: 'Cost', value: '$0.37 of $0.60', end: true, mono: true }];
const S20 = [{ label: 'How careful', value: 'Supervised', icon: 'shield', plain: true }, { label: 'Branch', value: 'w32/dock-paint', icon: 'fork', mono: true, plain: true, still: true, fold: true }, { label: 'Who answers next', value: 'sonnet 5.5', model: 'sonnet 5.5', plain: true, ticks: 3 }, { label: 'Context', value: '76k / 200k', mono: true, end: true, ticks: 2, fold: true }, { label: 'Cost', value: '$0.37 of $0.60', mono: true, end: true }];
const TYPED = 'proration drifts by a cent on long invoices';
const typedState = stage(['variant', 'owner'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20, text: TYPED })); }, { width: 720 });
/** a button's tooltip, shown (the runtime's, as a focus shows it) */
const tip = (sel: string): State => stage(['tooltip', 'owner'], async ({ root, wait, tooltip }) => {
  fill(root, kit.composer({ kind: 'session', line: S20, text: TYPED }));
  const b = root.querySelector<HTMLElement>(sel); if (b) { b.focus(); tooltip.show(b); }
  await wait(300);
}, { width: 720, overlay: { anchor: sel, layer: '.k7-tip' }, force: [{ sel, state: 'focus' }] });
/** a draft of more than one line: the one row keeps its buttons on the last line (composer.css `.k7-composer__box`: align-items flex-end) */
const LINES = { 'geometry.center': { reason: 'a draft of more than one line: the kit composer keeps its buttons on the last line (composer.css `.k7-composer__box`: align-items flex-end), as its multi-line state draws', el: 'k7-composer__box' } } as const;
const empty = stage(['typical', 'empty'], ({ root }) => { fill(root, kit.composer({ line: LINE })); }, { width: 720 });
export default {
  id: 'kit/composer', title: 'Composer', area: 'composer', kind: 'component', covers: ['kit.composer'],
  states: {
    typical: empty,
    ...forced(empty, '[data-kit~="Composer"] [data-kit~="IconButton"]'),
    'typed, with marks': stage(['variant'], ({ root }) => { fill(root, kit.composer({ line: LINE, textHTML: 'Deploy to ' + kit.html.mark({ text: 'staging', state: 'shown' }) + ' after ' + kit.html.mark({ text: 'the tests pass', state: 'shown' }) })); }, { width: 720 }),
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
      const pad = document.createElement('div'); pad.style.marginTop = '220px';   /* the story's room for the list above the composer (a margin: not a design value the token check reads) */  pad.append(c); fill(root, pad);
      kit.mentions(c, { label: 'Members', foot: () => 'Only the bots you name answer. With no name, every member does.', entries: () => [KAI, NINA, MOSS].map((b) => ({ value: b.id, label: b.name, desc: b.id === 'kai' ? 'docs and changelog' : b.id === 'nina' ? 'deploys' : 'flaky test hunter', leadHTML: kit.html.avatar({ bot: b, size: 16, still: true }) })) });
      const t = c.querySelector<HTMLElement>('.k7-composer__text') as HTMLElement;
      t.focus(); t.textContent = '@'; const r = document.createRange(); r.setStart(t.firstChild as Node, 1); r.collapse(true); getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
      t.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(3);
    }, { width: 720 }),
    /* owner, 25 November: Stop is its own button at the start of the right cluster while a turn runs; the primary circle never becomes it */
    'running: Stop beside the mic': stage(['loading', 'owner'], ({ root }) => { fill(root, kit.composer({ kind: 'session', running: true, line: S20 })); }, { width: 720 }),
    'running, with text: Stop, the mic, Queue': stage(['loading', 'variant'], ({ root }) => { fill(root, kit.composer({ kind: 'bot', running: true, text: 'and the changelog?' })); }, { width: 720 }),
    'idle: no Stop': stage(['variant'], ({ root }) => { fill(root, kit.composer({ kind: 'bot', text: 'and the changelog?' })); }, { width: 720 }),
    'Stop hovered': stage(['hover'], ({ root }) => { fill(root, kit.composer({ kind: 'room', running: true })); }, { width: 720, force: [{ sel: '[data-stop]', state: 'hover' }] }),
    'Stop focused': stage(['focus'], ({ root }) => { fill(root, kit.composer({ kind: 'room', running: true })); }, { width: 720, force: [{ sel: '[data-stop]', state: 'focus' }] }),
    'running, narrow': stage(['size'], ({ root }) => { fill(root, kit.composer({ kind: 'dock', running: true, text: 'a message long enough to wrap in a narrow composer' })); }, { width: 328, ground: 'dock' }),
    /* the voice circle always shows (owner, 26 November): with no voice model it is drawn the same and its name and tip say what it needs */
    'no voice model yet: the voice circle as ever, then the send': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.composer({ kind: 'session', voiceSetup: true, line: S20 })); fill(root, kit.composer({ kind: 'session', voiceSetup: true, text: 'Describe the change' })); }, { width: 720 }),
    'no voice model yet: what the circle opens': stage(['open', 'owner'], async ({ root, wait }) => {
      fill(root, kit.composer({ kind: 'bot', voiceSetup: true }));
      await wait(100);   /* the Notice is placed against the circle where the stage has laid it out */
      const b = root.querySelector<HTMLElement>('[data-send]');
      if (b) kit.openNotice(b, { icon: 'waveform', title: 'Voice needs a voice model', text: '', action: 'Set up voice' });
      await wait(200);
    }, { width: 720, overlay: { anchor: '[data-send]', layer: '.k7-notice[data-floating]' } }),
    /* the mic is transcription (owner, 26 November): what its dictation reports is drawn with what the composer has. Derived, no board:
       the speech model being fetched once (its progress in the placeholder), the words arriving in the text, an error at the mic with
       "Try again", and a build with no dictation at all */
    'dictation: getting the speech model': stage(['loading', 'owner'], ({ root }) => {
      const c = kit.composer({ kind: 'bot', placeholder: 'Message nina', hears: 'nina' }); fill(root, c);
      c.querySelector<HTMLElement>('[data-mic]')?.click();
      kit.composerDictation(c, { kind: 'preparing', done: 12 * 1048576, total: 57 * 1048576 });
    }, { width: 720 }),
    'dictation: the words arriving': stage(['variant', 'owner'], ({ root }) => {
      const c = kit.composer({ kind: 'session', line: S20, text: 'Fix the dock,' }); fill(root, c);
      c.querySelector<HTMLElement>('[data-mic]')?.click();
      kit.composerDictation(c, { kind: 'partial', text: 'and update the change' });
    }, { width: 720 }),
    'dictation: it failed': stage(['error', 'open', 'owner'], async ({ root, wait }) => {
      const c = kit.composer({ kind: 'bot', placeholder: 'Message nina', hears: 'nina' }); fill(root, c);
      await wait(100);
      c.querySelector<HTMLElement>('[data-mic]')?.click();
      kit.composerDictation(c, { kind: 'error', reason: 'Microphone access is off for boopis' });
      await wait(200);
    }, { width: 720, overlay: { anchor: '[data-mic]', layer: '.k7-notice[data-floating]' } }),
    'dictation: not in this build': stage(['open', 'disabled', 'owner'], async ({ root, wait }) => {
      fill(root, kit.composer({ kind: 'bot', voiceSetup: true, micOff: true }));
      await wait(100);
      const b = root.querySelector<HTMLElement>('[data-mic]');
      if (b) kit.openNotice(b, { icon: 'mic', title: 'Dictation is not available in this build', text: '' });
      await wait(200);
    }, { width: 720, overlay: { anchor: '[data-mic]', layer: '.k7-notice[data-floating]' } }),
    /* a thing shows only once it exists: no send while a turn runs where nothing queues */
    'running where nothing queues: Stop and the mic': stage(['variant'], ({ root }) => { fill(root, kit.composer({ kind: 'session', running: true, voiceSetup: true, queueOff: true, text: 'wait' })); }, { width: 720 }),
    /* boards S05 B and S20: the session's line, and the words the text is read by */
    'a session, S20: the line and the marks': stage(['variant', 'owner'], ({ root }) => {
      const c = kit.composer({ kind: 'session', placeholder: 'Send feedback to decline this request', text: 'Don\'t centre with a transform, use auto margins on the page', line: S20 });
      fill(root, c);
      kit.composerMarks(c, (t) => [{ at: t.indexOf('auto margins'), text: 'auto margins' }, { at: t.indexOf('page'), text: 'page', chosen: true }]);
    }, { width: 720 }),
    'a line item hovered': stage(['hover'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20 })); }, { width: 720, force: [{ sel: 'button.k7-composer__item', state: 'hover' }] }),
    'a line item focused': stage(['focus'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20 })); }, { width: 720, force: [{ sel: 'button.k7-composer__item', state: 'focus' }] }),
    'the line, narrow': stage(['size'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20 })); }, { width: 390 }),
    'no line': stage(['empty'], ({ root }) => { fill(root, kit.composer({ kind: 'session' })); }, { width: 720 }),
    /* the owner's cases (the v6 composer's, on the kit's): the send with text at rest, hovered, focused and pressed; "+" hovered; each
       button's tooltip, clear of the text; the dock's composer with text */
    typed: typedState,
    'the send hovered': { ...typedState, tags: ['hover', 'owner'], force: [{ sel: '[data-send]', state: 'hover' }] },
    'the send focused': { ...typedState, tags: ['focus', 'owner'], force: [{ sel: '[data-send]', state: 'focus' }] },
    'the send pressed': { ...typedState, tags: ['active', 'owner'], force: [{ sel: '[data-send]', state: 'active' }] },
    'add hovered': { ...typedState, tags: ['hover', 'owner'], force: [{ sel: '[data-plus]', state: 'hover' }] },
    'the mic hovered': { ...typedState, tags: ['hover'], force: [{ sel: '[data-mic]', state: 'hover' }] },
    'the add tooltip': tip('[data-plus]'),
    'the mic tooltip': tip('[data-mic]'),
    'the send tooltip': tip('[data-send]'),
    'dock, typed': stage(['variant', 'owner'], ({ root }) => { fill(root, kit.composer({ kind: 'dock', placeholder: 'Message nina', text: 'can you stage it first?' })); }, { width: 400, ground: 'dock' }),
    /* drafts no board draws (derived: the one row grows with its text, the buttons stay on the last line) */
    'a long unbroken word': stage(['long'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20, text: UNBROKEN + ' ' + UNBROKEN })); }, { width: 720, allow: LINES }),
    'a tall draft scrolls': stage(['long', 'scroll'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20, text: Array.from({ length: 30 }, (_, i) => 'line ' + (i + 1) + ' ' + LONG_TITLE).join('\n') })); }, { width: 720, allow: LINES }),
    'right to left': stage(['rtl'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20, text: RTL })); }, { width: 720, dir: 'rtl' }),
    /* derived, no board: a file dragged over it (the box's line in the focus colour until it is dropped or leaves), and the mic on (the
       mic pressed, the placeholder saying who listens, the box's line as with the focus) */
    'a file dragged over it': stage(['variant', 'owner'], ({ root }) => {
      for (const c of [kit.composer({ kind: 'session', line: S20 }), kit.composer({ kind: 'bot', placeholder: 'Message nina', text: 'read this first' })]) { fill(root, c); kit.composerDropping(c, true); }
    }, { width: 720 }),
    'a dropped file is a chip': stage(['variant'], ({ root }) => {
      const c = kit.composer({ kind: 'session', line: S20, text: 'what is wrong with these totals? ' }); fill(root, c);
      kit.composerInsertChip(c, kit.html.inlineChip({ kind: 'reference', text: 'invoices-sample.csv', words: '' }));
      kit.composerInsertChip(c, kit.html.inlineChip({ kind: 'reference', text: 'screenshot.png', words: '' }));
    }, { width: 720 }),
    listening: stage(['variant', 'owner'], ({ root }) => {
      for (const c of [kit.composer({ kind: 'bot', placeholder: 'Message nina', hears: 'nina' }), kit.composer({ kind: 'session', line: S20 })]) { fill(root, c); c.querySelector<HTMLElement>('[data-mic]')?.click(); }
    }, { width: 720 }),
    'typed, narrow (390)': stage(['size', 'owner'], ({ root }) => { fill(root, kit.composer({ kind: 'session', line: S20, text: TYPED })); }, { width: 358, allow: LINES })
  }
} satisfies Story;
