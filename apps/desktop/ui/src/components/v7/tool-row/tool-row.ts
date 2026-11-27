/* ToolRow: its view (typed props to markup) and its contract. Its look is tool-row.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { askCard } from '../ask-card/ask-card';
import type { AskCardOpts } from '../ask-card/ask-card';
import { steps } from '../disclosure/disclosure';
import type { StepOpts } from '../disclosure/disclosure';
import { statusWord } from '../status-word/status-word';
import type { StatusTone } from '../status-word/status-word';
import { blockAttrs, attrs, esc, glyph, idFrom, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { well } from '../well/well';
import { defineContract } from '../contract';

/* ── ToolRow (8): one tool call; edit, command, read, search; running (shimmer), done, failed (red word), waiting (an attached AskCard).
   A session's (boards S09 and S20, kit.css `.toolrow`): the answering model's 14 mark, the tool's glyph, what it is called on in mono, an
   edit's +/−, and at the end what became of it ("Waiting for you" in amber, "Allowed once 09:43", "Declined 09:44"); while it waits its
   answers sit under the head, at the Block's end; a decline's feedback is quoted under it ── */
export const TOOL_KINDS = ['edit', 'command', 'read', 'search'] as const;
export type ToolKind = typeof TOOL_KINDS[number];
export const TOOL_STATES = ['running', 'done', 'failed', 'waiting'] as const;
export type ToolState = typeof TOOL_STATES[number];
const TOOL_GLYPH: Record<ToolKind, string> = { edit: 'pen', command: 'terminal', read: 'file', search: 'search' };
export interface ToolRowOpts {
  /** `bot`: a bot's tool call as boards 11 and 17 draw it (botscreens.js `.tool`): a glyph (`icon`: the task's, or the terminal's), the tool's name, what it was called on, a chevron */ variant?: U<'session' | 'bot'>; icon?: U<string>;
  kind?: U<ToolKind>; state?: U<ToolState>; tool: string; target?: U<string>; model?: U<ModelRef>; open?: U<boolean>;
  command?: U<string>; steps?: U<readonly StepOpts[]>; ask?: U<AskCardOpts>; attrs?: U<Attrs>;
  /** an edit's lines added and removed */ add?: U<number>; del?: U<number>; /** what became of it, at the head's end ("Allowed once 09:43") */ word?: U<string>; /** the feedback a decline was sent with, quoted under the head */ note?: U<string>;
  /* ── 6e, derived (a council's members, the tasks handed to other models) ── */
  /** the word's tone ("done" ok, "no answer" amber, "error" red) */ wordTone?: U<StatusTone>;
  /** why, said in the word's Tooltip (a member that failed): the word takes the focus so the keyboard reaches it */ wordTip?: U<string>;
  /** a control at the head's end, after the word, as kit markup (a running task's ghost Stop); only on a head that is not itself a control */ end?: U<string>;
  /** what stands under the head, as kit markup (a Disclosure over a task's transcript) */ after?: U<string>;
  /** a row of a Block (a council's member): no frame of its own, its head on the corner concentric with the Block's */ row?: U<boolean>;
  /** the name is words, not a command or a path (a model's name: a council's member, a task handed to another model): the regular face,
      as model names are everywhere else; a tool's name stays mono as boards S20, S23 and 17 draw it (6f, the lead) */ text?: U<boolean>;
}
export function toolRow(o: ToolRowOpts): string {
  const k = o.kind ?? 'command', st = o.state ?? 'done';
  const id = idFrom('k7-tr', o.tool + (o.target ?? ''));
  if (o.variant === 'bot') {
    const open = !!o.open && !!(o.steps || o.command);
    return '<div class="k7-btool"' + kitAttrs('ToolRow', { 'data-variant': 'bot', 'data-state': st, 'data-sq': '', 'data-sq-mode': 'frame', 'data-disclose': o.steps || o.command ? '' : null, 'data-open': open ? '' : null, ...(o.attrs ?? {}) }) + '>' +
      '<button class="k7-reset k7-btool__head" type="button"' + attrs({ 'aria-expanded': o.steps || o.command ? String(open) : null, 'aria-controls': o.steps || o.command ? id : null }) + '>' + glyph(o.icon ?? 'session') +
      '<b class="k7-btool__name">' + esc(o.tool) + '</b>' + (o.target ? '<span class="k7-btool__target k7-ell">' + esc(o.target) + '</span>' : '') + '<span class="k7-grow"></span>' + glyph('chevron', 'k7-btool__chev') + '</button>' +
      (o.steps || o.command ? '<div class="k7-btool__body" id="' + id + '">' + (o.command ? well({ text: o.command }) : '') + (o.steps ? steps(o.steps) : '') + '</div>' : '') + '</div>';
  }
  const tip = o.wordTip ? { 'data-tip': o.wordTip, tabindex: '0', 'aria-description': o.wordTip } : {};
  const word = st === 'failed' && !o.word ? statusWord({ text: 'failed', tone: 'red', attrs: tip }) : st === 'waiting' ? statusWord({ text: 'Waiting for you', tone: 'owe' }) : o.word ? statusWord({ text: o.word, tone: o.wordTone ?? (st === 'failed' ? 'red' : 'neutral'), attrs: tip }) : '';
  const hasBody = !!(o.command || o.steps);
  /* a session's row leads with its tool's glyph; `icon` names another, and '' none (a council's member is its model's mark alone) */
  const lead = o.icon === '' ? '' : glyph(o.icon ?? TOOL_GLYPH[k], 'k7-tool__ic');
  const inner = (o.model ? '<span class="k7-head__mark">' + markHTML(o.model, { size: 14, label: false }) + '</span>' : '') + lead +
    '<b class="k7-tool__name' + (st === 'running' ? ' k7-shimmer" data-live="' : '') + '"' + (o.text ? ' data-face="text"' : '') + '>' + esc(o.tool) + '</b>' +
    (o.add != null || o.del != null ? '<span class="k7-files__counts k7-mono"><span data-tone="add">+' + (o.add ?? 0) + '</span><span data-tone="del">−' + (o.del ?? 0) + '</span></span>' : '') +
    (o.target ? '<span class="k7-tool__target k7-ell">' + esc(o.target) + '</span>' : '') + '<span class="k7-grow"></span>' + word + (hasBody ? glyph('chevron-down', 'k7-chev') : '');
  const head = hasBody ? '<button class="k7-reset k7-tool__head k7-text" type="button"' + attrs({ 'aria-expanded': String(!!o.open), 'aria-controls': id }) + '>' + inner + '</button>' : '<div class="k7-tool__head k7-text">' + inner + (o.end ?? '') + '</div>';
  const body = hasBody ? '<div class="k7-tool__body" id="' + id + '">' + (o.command ? well({ text: o.command }) : '') + (o.steps ? steps(o.steps) : '') + '</div>' : '';
  const root = o.row ? kitAttrs('ToolRow', { 'data-row': '', 'data-kind': k, 'data-state': st, 'data-disclose': hasBody ? '' : null, 'data-open': hasBody && o.open ? '' : null, ...(o.attrs ?? {}) })
    : blockAttrs('ToolRow', { 'data-kind': k, 'data-state': st, 'data-disclose': hasBody ? '' : null, 'data-open': hasBody && o.open ? '' : null, ...(o.attrs ?? {}) });
  return '<div class="' + (o.row ? 'k7-tool' : 'k7-tool k7-block') + '"' + root + '>' + head + body +
    (o.note ? '<p class="k7-tool__note k7-text">“' + esc(o.note) + '”</p>' : '') + (o.after ? '<div class="k7-tool__after">' + o.after + '</div>' : '') + (st === 'waiting' && o.ask ? askCard({ ...o.ask, variant: 'attached' }) : '') + '</div>';
}

/** what ToolRow promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<ToolRowOpts>({
  name: 'ToolRow',
  folder: 'tool-row',
  layer: 'thread',
  summary: 'One tool call: an edit, a command, a read or a search; running (shimmer), done, failed or waiting on an attached AskCard. Its steps open under its head.',
  exports: ['toolRow'],
  props: {
    variant: 'session (the default) or bot (a bot\'s call, as boards 11 and 17 draw it)',
    icon: 'its glyph; empty for none',
    kind: 'edit, command, read or search',
    state: 'running, done, failed or waiting',
    tool: 'the tool\'s name',
    target: 'what it works on (a path, a query)',
    model: 'the model that called it (its mark leads)',
    open: 'its steps are open',
    command: 'the command it ran, in a Well',
    steps: 'its steps, opened from its head',
    ask: 'what it waits on: an attached AskCard',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    add: 'an edit\'s lines added',
    del: 'an edit\'s lines removed',
    word: 'what became of it, at the head\'s end',
    note: 'the feedback a decline was sent with',
    wordTone: 'the word\'s tone',
    wordTip: 'why, in the word\'s tooltip (the word takes the focus)',
    end: 'a control at the head\'s end, as markup',
    after: 'what stands under the head, as markup',
    row: 'a row of a Block: no frame of its own',
    text: 'the name is words, not a command (a model\'s name)'
  },
  events: ['ui:toggle'],
  states: ['data-kind', 'data-state', 'data-open', 'aria-expanded'],
  parts: ['k7-tool__head', 'k7-head__mark'],
  tokens: [
    '--bg-3', '--bubble-max', '--ctl-s', '--dur-1', '--ease-sharp', '--focus', '--focus-w', '--fs-s', '--fs-xs', '--gap-hair',
    '--gap-row', '--gap-s', '--gap-xs', '--hl', '--icon-quiet', '--lh-m', '--lh-xs', '--line', '--mono', '--pad-block',
    '--pad-text', '--r-block', '--r-bubble', '--r-xs', '--sans', '--sp-1', '--sp-2', '--sp-3', '--text', '--text-dim'
  ],
  a11y: 'Its head is a <button> with aria-expanded when it has steps; a word with a reason takes the focus so the keyboard reaches its tooltip.',
  boards: []
});
