/* Composer: its view (typed props to markup) and its contract. Its look is composer.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { iconButton } from '../icon-button/icon-button';
import { selectorItem } from '../selector-item/selector-item';
import { attrs, cls, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Composer (39): session, bot, room, dock, notch; with its line; empty, typed, multi-line, running (Stop joins the right cluster; Enter
   queues), held, no model; listening (the mic on), a file dragged over it. What it does is behaviour.ts (`wireComposer`) and editing.ts ── */
export const COMPOSER_KINDS = ['session', 'bot', 'room', 'dock', 'notch'] as const;
export type ComposerKind = typeof COMPOSER_KINDS[number];
export interface LineItem {
  label: string; value: string; mono?: boolean; need?: boolean; end?: boolean; leadHTML?: string;
  /** a plain item, as the boards' lines draw them: a 16 glyph or the model's 12 mark, then the value; no chevron, no fill */ plain?: boolean; icon?: string; model?: ModelRef; attrs?: Attrs;
  /** five ticks after the value (a model's effort, S05) or, at the line's end, before it (how full the context is) */ ticks?: number; /** a plain item that only says (the branch): not a control */ still?: boolean;
  /** in a narrow composer this item is left out first (board S05 B: "the branch and the context fold into the quick menu first") */ fold?: boolean;
}
export interface ComposerOpts {
  kind?: U<ComposerKind>; placeholder?: U<string>; text?: U<string>; textHTML?: U<string>; running?: U<boolean>;
  /** the line under it (12.2, S05): its items; an empty line takes no space */ line?: U<readonly LineItem[]>; hint?: U<string>; /** a second hint, at the line's end (S17: "ctrl Enter starts it in the background") */ hintEnd?: U<string>;
  /** a bot's own chat: the send in the bot's derived fill (18.1) */ fill?: U<{ fill: string; text: string }>; label?: U<string>; attrs?: U<Attrs>;
  /** no voice model is set up yet: the voice circle is drawn as the boards draw it and says so in its name and tip; pressing it fires
      ui:voice all the same, and the app says what to set up (owner, 26 November: voice is never hidden) */ voiceSetup?: U<boolean>;
  /** this build has no dictation at all: the mic is drawn as the boards draw it, and a press, a hold or alt+V starts nothing and fires
      ui:dictate-unavailable (the app says so). The mic is transcription and has nothing to do with a voice model (owner, 26 November) */ micOff?: U<boolean>;
  /** nothing queues here yet: while a turn runs there is no send (the app lifts this while a typed message has somewhere to go) */ queueOff?: U<boolean>;
  /** the key Stop's tip shows (the shell's mod+. unless said) */ stopKeys?: U<string>;
  /** who dictation is for (a bot's name): while the mic is on the placeholder reads "nina is listening"; without it, "Listening" */ hears?: U<string>;
}
/** the voice circle's name and tip while no voice model is set up */
export const VOICE_SETUP = 'Talk: set up a voice model first';
const ticks5 = (on: number): string => '<span class="k7-ticks" aria-hidden="true">' + Array.from({ length: 5 }, (_, i) => '<i' + (i < on ? ' data-on' : '') + '></i>').join('') + '</span>';
export function composer(o: ComposerOpts): string {
  const k = o.kind ?? 'session', typed = !!(o.text || o.textHTML);
  const ph = o.placeholder ?? (o.running ? 'Queue a message, or ctrl Enter to steer' : k === 'room' ? 'Message the room' : k === 'bot' || k === 'dock' ? 'Message the bot' : 'Ask boopis');
  /* the primary circle: voice when empty, send once there is text ("Queue" while it runs); it never becomes Stop (owner, 25 November).
     It is drawn the same whether or not a voice model is set up (owner, 26 November); its name and tip say when one is needed */
  const fillAttrs = { 'data-bot-colour': o.fill ? '' : null, style: o.fill ? '--selected:' + o.fill.fill + ';--text-on-light:' + o.fill.text : null };
  const send = typed ? iconButton({ icon: 'arrowup', label: o.running ? 'Queue' : 'Send', variant: 'inverted', keys: 'Enter', attrs: { 'data-send': '', ...fillAttrs } })
    : iconButton({ icon: 'waveform', label: o.voiceSetup ? VOICE_SETUP : 'Talk', variant: 'inverted', attrs: { 'data-send': '', 'aria-haspopup': o.voiceSetup ? 'dialog' : null, ...fillAttrs } });
  /* Stop (owner, 25 November): a tinted 28 circle with a filled rounded square, at the start of the right cluster while a turn runs:
     [stop] [mic] [primary]. It is there only then, takes its own place (the text gives the width), and is the one way Stop is shown */
  const stop = '<button class="k7-reset k7-ib k7-composer__stop"' + kitAttrs('IconButton') + attrs({ type: 'button', 'data-variant': 'tinted', 'data-stop': '', 'aria-label': 'Stop', 'data-tip': 'Stop', 'data-kbd': o.stopKeys ?? 'mod+period', 'aria-keyshortcuts': o.stopKeys === 'esc' ? 'Escape' : 'Control+.' }) + '><span class="k7-composer__stop-glyph" aria-hidden="true"></span></button>';
  const line = (o.line ?? []).length || o.hint || o.hintEnd
    ? '<div class="k7-composer__line">' + (o.line ?? []).filter((x) => !x.end).map((x) => x.plain
      ? (x.still ? '<span class="k7-composer__item"' + attrs({ 'aria-label': x.label + ': ' + x.value, 'data-fold': x.fold ? '' : null, ...(x.attrs ?? {}) }) : '<button class="k7-reset k7-composer__item" type="button"' + attrs({ 'aria-label': x.label + ': ' + x.value, 'data-model': x.model ? '' : null, 'data-fold': x.fold ? '' : null, ...(x.attrs ?? {}) })) + '>' +
        (x.model ? markHTML(x.model, { size: 12, label: false }) : x.icon ? glyph(x.icon) : '') + '<span' + (x.mono ? ' class="k7-mono"' : '') + '>' + esc(x.value) + '</span>' + (x.ticks != null ? ticks5(x.ticks) : '') + (x.still ? '</span>' : '</button>')
      : selectorItem({ variant: 'line', label: x.label, value: x.value, mono: !!x.mono, need: !!x.need, ...(x.leadHTML ? { leadHTML: x.leadHTML } : {}), chevron: !x.need })).join('') +
      (o.hint ? '<span class="k7-composer__hint">' + esc(o.hint) + '</span>' : '') +
      '<span class="k7-grow"></span>' + (o.hintEnd ? '<span class="k7-composer__hint">' + esc(o.hintEnd) + '</span>' : '') + (o.line ?? []).filter((x) => x.end).map((x) => '<span class="' + cls('k7-composer__end', x.mono && x.ticks == null && 'k7-mono') + '"' + attrs({ 'aria-label': x.label + ': ' + x.value, 'data-fold': x.fold ? '' : null, ...(x.attrs ?? {}) }) + '>' + (x.ticks != null ? ticks5(x.ticks) + '<span class="k7-mono">' + esc(x.value) + '</span>' : esc(x.value)) + '</span>').join('') + '</div>'
    : '';
  return '<div class="k7-composer"' + kitAttrs('Composer', { 'data-kind': k, 'data-typed': typed ? '' : null, 'data-running': o.running ? '' : null, 'data-voice-setup': o.voiceSetup ? '' : null, 'data-mic-off': o.micOff ? '' : null, 'data-queue-off': o.queueOff ? '' : null, 'data-hears': o.hears || null, ...(o.attrs ?? {}) }) + '>' +
    '<div class="k7-composer__box" data-sq data-sq-mode="frame" data-mark-context>' +
    iconButton({ icon: 'plus', label: 'Add a file', variant: 'tinted', attrs: { 'data-plus': '' } }) +
    '<div class="k7-composer__text" contenteditable="plaintext-only" tabindex="0" role="textbox" aria-multiline="true"' + attrs({ 'aria-label': o.label ?? ph, 'data-placeholder': ph }) + '>' + (o.textHTML ?? esc(o.text ?? '')) + '</div>' +
    stop + (k === 'notch' ? '' : iconButton({ icon: 'mic', label: 'Dictate', variant: 'tinted', pressed: false, keys: 'alt+V', attrs: { 'data-mic': '' } })) + send + '</div>' + line + '</div>';   /* the mic is a tinted 28 circle, as "+" is (kit.css `.composer .ib.s`) */
}

/** what Composer promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<ComposerOpts>({
  name: 'Composer',
  folder: 'composer',
  layer: 'compose',
  summary: 'Where the person writes: in a session, a bot\'s chat, a room, the dock or the notch, with its line under it. Enter sends (or queues while a turn runs), ctrl Enter steers, the mic dictates, "+" adds a file, Stop stops.',
  exports: ['composer'],
  props: {
    kind: 'session (the default), bot, room, dock or notch',
    placeholder: 'the words while empty',
    text: 'its text',
    textHTML: 'its text as trusted markup (chips)',
    running: 'a turn runs: Stop shows, Enter queues',
    line: 'the line under it: its items (a SelectorItem, or a plain item)',
    hint: 'a hint on the line',
    hintEnd: 'a second hint, at the line\'s end',
    fill: 'a bot\'s own chat: the send in the bot\'s fill',
    label: 'the text\'s accessible name (the placeholder unless said)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    voiceSetup: 'no voice model yet: the voice circle says so and still asks',
    micOff: 'this build has no dictation: the mic starts nothing and says so',
    queueOff: 'nothing queues here: no send while a turn runs',
    stopKeys: 'the key Stop\'s tip shows',
    hears: 'who dictation is for: "nina is listening"'
  },
  events: [
    'ui:add', 'ui:dictate', 'ui:dictate-unavailable', 'ui:files', 'ui:mark', 'ui:refused', 'ui:send', 'ui:steer', 'ui:stop',
    'ui:voice'
  ],
  states: [
    'data-kind', 'data-typed', 'data-running', 'data-voice-setup', 'data-mic-off', 'data-queue-off', 'data-listening',
    'data-dictation', 'data-drop', 'aria-pressed (the mic)'
  ],
  parts: ['k7-composer__box', 'k7-composer__text', 'k7-composer__line', 'k7-composer__stop'],
  tokens: [
    '--bg-3', '--composer-h', '--composer-line', '--composer-max-h', '--composer-pad', '--ctl', '--ctl-s', '--dur-1', '--ease-out',
    '--focus', '--fs-m', '--fs-xs', '--gap-hair', '--gap-s', '--hl', '--lh-m', '--line-field', '--notch-ctl', '--pad-kbd',
    '--pad-text', '--r-bubble', '--r-composer', '--r-stop', '--r-xs', '--shadow-composer', '--sp-1', '--sp-2', '--sp-3',
    '--stop-glyph', '--text', '--text-dim', '--text-quiet'
  ],
  a11y: 'The text is a role="textbox" (aria-multiline). Enter sends, shift Enter is a new line, ctrl Enter steers, alt+V dictates, Esc stops dictation; mod+Z and shift mod+Z undo and redo across chips. Its buttons are named (Add a file, Dictate or Stop listening, Talk or Send or Queue, Stop).',
  boards: [
    '11-botchat', '12-room', 'K02-12-held', '17-working', 'S17-newsession', 'S20-running', 'S23-finished', 'S33-changed',
    'S36-engine', 'S37-nomodel', 'S38-gate', 'S40-details', 'S41-noproject', 'K01-rest', 'K02-hover', 'K03-asks', 'K04-card',
    'K05-many', 'K06-none', 'K07-centred', 'K08-compact'
  ]
});
