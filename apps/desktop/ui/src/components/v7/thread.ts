/* The v7 kit's conversation pieces (DESIGN-SYSTEM.md v7 12.2, 19, 20 and 21.2 rows 8 to 11, 15 and 39): ToolRow, AskCard,
   FilesCard, Queue, DiffView, Composer. Every inline surface that holds controls is a Block (R-corner-10). */
import type { BotLike } from '../bot-state';
import { markHTML } from '../model-mark';
import type { ModelRef } from '../model-mark';
import { orbHtml } from '../orb';
import { button, chip, iconButton, kbd, selectorItem } from './controls';
import { steps, well } from './blocks';
import type { StepOpts } from './blocks';
import { mark, statusWord } from './inline';
import type { StatusTone } from './inline';
import { attrs, cls, esc, glyph, idFrom, kitAttrs, partAttrs } from './util';
import type { Attrs, U } from './util';

const blockAttrs = (name: string, more: Attrs): string => kitAttrs(name, { 'data-block': '', 'data-sq': '', 'data-sq-mode': 'frame', ...more });
/** an agent card's head: the asker's mark (a model's 16 px mark, or a bot's 16 px orb), a short line, and the state at the end */
function askerHTML(o: { model?: U<ModelRef>; bot?: U<BotLike>; rest?: U<boolean> }): string {
  return o.bot ? orbHtml(o.bot, o.rest ? { size: 16, rest: true, surface: '--bg-3' } : { size: 16, still: true, mode: 'fixed', surface: '--bg-3' }) : o.model ? '<span class="k7-head__mark">' + markHTML(o.model, { size: 14, label: false }) + '</span>' : '';   /* a model's mark is 14 in a card's head (sessiontab.js `ask`: cm(fam, 14)) */
}

/* ── AskCard (9): standalone (a bot's approval, never expires), attached (in a ToolRow: its answers alone, S09), question (chips),
   choices (lettered rows), lapsed blank (the guess); asked, needs you, answered (one row), lapsed ── */
export const ASK_VARIANTS = ['standalone', 'attached', 'question', 'choices', 'lapsed'] as const;
export type AskVariant = typeof ASK_VARIANTS[number];
export const ASK_STATES = ['asked', 'needs', 'answered', 'lapsed', 'withdrawn'] as const;
export type AskState = typeof ASK_STATES[number];
export interface AskAnswer {
  label: string; primary?: boolean; hold?: boolean; keys?: string;
  /** what the answer is called to the app (data-value) */ value?: string;
  /** the outlined chip (the boards' Deny) */ outline?: boolean;
  /** at the row's end, the others at its start (the dock's cards, K03 and K04: Deny at the end) */ end?: boolean;
  /** drawn as the board draws it, and it does nothing yet: the reason, said in its tip */ inert?: string;
}
export interface AskCardOpts {
  variant?: U<AskVariant>; state?: U<AskState>; who?: U<string>; bot?: U<BotLike>; model?: U<ModelRef>;
  ask: string; sub?: U<string>; /** the approval rule that asked, by name: "Rule: “...”" in the accent (board 11) */ rule?: U<string>; command?: U<string>; answers?: U<readonly AskAnswer[]>; choices?: U<readonly string[]>; chosen?: U<number | string>;
  /** answered: the one-line receipt ("Allowed once", "sent as a correction") */ receipt?: U<string>; something?: U<boolean>; attrs?: U<Attrs>;
  /** the asker's orb at rest, in its pose (the dock's cards: every bot in the dock rests unless its state shows in the row) */ rest?: U<boolean>;
  /** "needs you" in words alone, without its dot (the dock's cards, K03 and K04: the orb's flag in the row already carries the dot) */ plain?: U<boolean>;
}
export const APPROVAL_ANSWERS: readonly AskAnswer[] = [{ label: 'Hold to allow once', primary: true, hold: true }, { label: 'Allow all this turn', value: 'turn' }, { label: 'Always allow', value: 'always' }, { label: 'Deny', value: 'deny', keys: 'esc', outline: true }];
const answerChips = (list: readonly AskAnswer[], more = ''): string => '<div class="k7-ask__answers">' + list.map((x) => chip({ label: x.label, variant: 'answer', chosen: !!x.primary, hold: !!x.hold, attrs: { 'data-value': x.value ?? null, 'data-outline': x.outline ? '' : null, 'data-end': x.end ? '' : null, 'aria-keyshortcuts': x.keys ? (x.keys === 'esc' ? 'Escape' : x.keys) : null, 'aria-disabled': x.inert ? 'true' : null, 'data-tip': x.inert ?? null } }).replace('</button>', x.keys ? kbd({ keys: x.keys }) + '</button>' : '</button>')).join('') + more + '</div>';
export function askCard(o: AskCardOpts): string {
  const v = o.variant ?? 'standalone', st = o.state ?? 'needs';
  /* attached (S09): the answers alone, at the end of their tool row's Block; the row's own head says what waits and for whom */
  if (v === 'attached') return '<div class="k7-ask"' + partAttrs('AskCard', { role: 'group', 'aria-label': o.ask, 'data-variant': v, 'data-state': st, ...(o.attrs ?? {}) }) + '>' + answerChips(o.answers ?? APPROVAL_ANSWERS) + '</div>';
  const stateWord = st === 'needs' ? statusWord({ text: 'needs you', tone: 'owe', dot: !o.plain }) : st === 'lapsed' ? statusWord({ text: 'lapsed', tone: 'owe' }) : st === 'withdrawn' ? statusWord({ text: 'withdrawn' }) : st === 'answered' ? statusWord({ text: o.receipt ?? 'answered', tone: 'ok' }) : '';
  const head = '<div class="k7-ask__head k7-text">' + askerHTML(o) + '<span class="k7-ask__who k7-ell">' + esc(o.who ?? (v === 'question' || v === 'lapsed' ? 'asked during the turn' : (o.bot?.name ?? 'boopis') + ' asks')) + '</span>' + stateWord + '</div>';
  const a = blockAttrs('AskCard', { role: 'group', 'aria-label': o.ask, 'data-variant': v, 'data-state': st, ...(o.attrs ?? {}) });
  if (st === 'answered' || st === 'withdrawn') {
    /* answered: a one-line receipt, then the card collapses to one row */
    return '<div class="k7-ask k7-block"' + a + '><div class="k7-ask__head k7-text">' + askerHTML(o) + '<span class="k7-ask__who k7-ell">' + esc(o.ask) + '</span>' + stateWord + '</div></div>';
  }
  const body = '<p class="k7-ask__ask k7-text">' + (v === 'lapsed' && o.choices ? esc(o.ask) : esc(o.ask)) + '</p>' + (o.rule ? '<p class="k7-ask__sub k7-text">Rule: <span class="k7-ask__rule">“' + esc(o.rule) + '”</span></p>' : o.sub ? '<p class="k7-ask__sub k7-text">' + esc(o.sub) + '</p>' : '') + (o.command ? well({ text: o.command }) : '');
  let answers = '';
  if (v === 'choices') {
    answers = '<div class="k7-ask__choices" role="radiogroup"' + attrs({ 'aria-label': o.ask }) + '>' + (o.choices ?? []).map((c, i) => {
      const on = o.chosen === i || o.chosen === c;
      return '<button class="k7-reset k7-ask__choice" type="button" role="radio"' + attrs({ 'aria-checked': String(on), 'data-chosen': on ? '' : null }) + '><span class="k7-ask__letter" aria-hidden="true">' + String.fromCharCode(65 + i) + '</span><span class="k7-ell">' + esc(c) + '</span></button>';
    }).join('') + (o.something !== false ? '<button class="k7-reset k7-ask__choice" type="button"><span class="k7-ask__letter" aria-hidden="true">' + glyph('pen') + '</span><span class="k7-ell">Something else</span></button>' : '') + '</div>';
  } else {
    const list: readonly AskAnswer[] = o.answers ?? (v === 'question' || v === 'lapsed' ? (o.choices ?? []).map((c, i) => ({ label: c, primary: i === 0 })) : APPROVAL_ANSWERS);
    answers = answerChips(list, v === 'question' || v === 'lapsed' ? chip({ label: 'Something else', variant: 'answer', attrs: { 'data-value': 'else', 'data-outline': '' } }) : '');
  }
  return '<div class="k7-ask k7-block"' + a + '>' + head + body + answers + '</div>';
}

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
  const word = st === 'failed' ? statusWord({ text: 'failed', tone: 'red' }) : st === 'waiting' ? statusWord({ text: 'Waiting for you', tone: 'owe' }) : o.word ? statusWord({ text: o.word }) : '';
  const hasBody = !!(o.command || o.steps);
  const inner = (o.model ? '<span class="k7-head__mark">' + markHTML(o.model, { size: 14, label: false }) + '</span>' : '') + glyph(TOOL_GLYPH[k], 'k7-tool__ic') +
    '<b class="k7-tool__name' + (st === 'running' ? ' k7-shimmer" data-live="' : '') + '">' + esc(o.tool) + '</b>' +
    (o.add != null || o.del != null ? '<span class="k7-files__counts k7-mono"><span data-tone="add">+' + (o.add ?? 0) + '</span><span data-tone="del">−' + (o.del ?? 0) + '</span></span>' : '') +
    (o.target ? '<span class="k7-tool__target k7-ell">' + esc(o.target) + '</span>' : '') + '<span class="k7-grow"></span>' + word + (hasBody ? glyph('chevron-down', 'k7-chev') : '');
  const head = hasBody ? '<button class="k7-reset k7-tool__head k7-text" type="button"' + attrs({ 'aria-expanded': String(!!o.open), 'aria-controls': id }) + '>' + inner + '</button>' : '<div class="k7-tool__head k7-text">' + inner + '</div>';
  const body = hasBody ? '<div class="k7-tool__body" id="' + id + '">' + (o.command ? well({ text: o.command }) : '') + (o.steps ? steps(o.steps) : '') + '</div>' : '';
  return '<div class="k7-tool k7-block"' + blockAttrs('ToolRow', { 'data-kind': k, 'data-state': st, 'data-disclose': hasBody ? '' : null, 'data-open': hasBody && o.open ? '' : null, ...(o.attrs ?? {}) }) + '>' + head + body +
    (o.note ? '<p class="k7-tool__note k7-text">“' + esc(o.note) + '”</p>' : '') + (st === 'waiting' && o.ask ? askCard({ ...o.ask, variant: 'attached' }) : '') + '</div>';
}

/* ── FilesCard (10): a turn's changed files (board S23, kit.css `.files-card`): "2 changed files" with the turn's +/−, an action at the
   head's end (Open diff), then a row per file: its glyph, its path in mono, its own +/− at the end. A long list folds (`fold`) ── */
export interface FileRow { path: string; add?: number; del?: number }
export interface FilesCardOpts {
  files: readonly FileRow[]; /** a long list folds under its head: open or closed */ fold?: U<boolean>; open?: U<boolean>; /** the head's action ("Open diff"); its button carries `data-files` */ action?: U<string>; actionAttrs?: U<Attrs>; attrs?: U<Attrs>;
  /** board S38 (sessiontab2.js `s18` c): the same card says how a check on the change went (the gate): in its head the check's glyph and
      name and the verdict as a StatusWord in its tone, at the end the one way on ("Fix and retry"); under it what the check printed, in
      a Well in the verdict's colour, and one note. The files the check ran on follow where there are any */
  check?: U<{ icon?: U<string>; title: string; word: string; tone?: U<StatusTone>; output?: U<string>; note?: U<string> }>;
}
export function filesCard(o: FilesCardOpts): string {
  if (o.check) {
    const c = o.check;
    return '<div class="k7-files k7-block"' + blockAttrs('FilesCard', { 'data-check': c.tone ?? 'neutral', 'data-open': '', ...(o.attrs ?? {}) }) + '>' +
      '<div class="k7-files__head k7-text">' + glyph(c.icon ?? 'terminal') + '<span class="k7-files__name">' + esc(c.title) + '</span>' + statusWord({ text: c.word, tone: c.tone }) +
      '<span class="k7-grow"></span>' + (o.action ? button({ label: o.action, variant: 'tint', size: 28, attrs: { 'data-files': '', ...(o.actionAttrs ?? {}) } }) : '') + '</div>' +
      (c.output ? well({ text: c.output, label: c.title + ' output' }) : '') +
      (o.files.length ? '<ul class="k7-files__list">' + o.files.map((f) => '<li class="k7-files__row k7-text"' + partAttrs('FileRow') + '>' + glyph('file') + '<span class="k7-ell k7-mono">' + esc(f.path) + '</span></li>').join('') + '</ul>' : '') +
      (c.note ? '<p class="k7-files__note k7-text">' + esc(c.note) + '</p>' : '') + '</div>';
  }
  const add = o.files.reduce((n, f) => n + (f.add ?? 0), 0), del = o.files.reduce((n, f) => n + (f.del ?? 0), 0);
  const id = idFrom('k7-fc', o.files.map((f) => f.path).join());
  const counts = (a: number, d: number): string => '<span class="k7-files__counts k7-mono"><span data-tone="add">+' + a + '</span><span data-tone="del">−' + d + '</span></span>';
  const title = '<span class="k7-files__title">' + esc(o.files.length + (o.files.length === 1 ? ' changed file' : ' changed files')) + '</span>' + counts(add, del);
  const open = o.fold ? !!o.open : true;
  return '<div class="k7-files k7-block"' + blockAttrs('FilesCard', { 'data-disclose': o.fold ? '' : null, 'data-open': open ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    '<div class="k7-files__head k7-text">' + (o.fold ? '<button class="k7-reset k7-files__fold" type="button"' + attrs({ 'aria-expanded': String(open), 'aria-controls': id }) + '>' + title + glyph('chevron-down', 'k7-chev') + '</button>' : title) +
    '<span class="k7-grow"></span>' + (o.action ? button({ label: o.action, variant: 'tint', size: 28, attrs: { 'data-files': '', ...(o.actionAttrs ?? {}) } }) : '') + '</div>' +
    '<ul class="k7-files__list" id="' + id + '">' + o.files.map((f) => '<li class="k7-files__row k7-text"' + partAttrs('FileRow') + '>' + glyph('file') + '<span class="k7-ell k7-mono">' + esc(f.path) + '</span>' + counts(f.add ?? 0, f.del ?? 0) + '</li>').join('') + '</ul></div>';
}

/* ── FileCard: one file a bot wrote or handed over (boards 11 and 17, botscreens.js `.file`): a 32 x 40 file tile, the name, one mono line ── */
export interface FileCardOpts { name: string; meta?: U<string>; /** it opens the file: a control (Enter and Space press it) */ opens?: U<boolean>; attrs?: U<Attrs> }
export function fileCard(o: FileCardOpts): string {
  return '<div class="k7-file"' + kitAttrs('FileCard', { 'data-sq': '', 'data-sq-mode': 'frame', ...(o.opens ? { role: 'button', tabindex: '0', 'data-action': '', 'aria-label': 'Open ' + o.name } : {}), ...(o.attrs ?? {}) }) + '><span class="k7-file__ic" aria-hidden="true">' + glyph('file') + '</span>' +
    '<span class="k7-file__text"><span class="k7-file__name k7-ell">' + esc(o.name) + '</span>' + (o.meta ? '<span class="k7-file__meta k7-mono k7-ell">' + esc(o.meta) + '</span>' : '') + '</span></div>';
}

/* ── Queue (11): messages waiting to be sent, above the composer; list (the engine's numbered queue), held (one row) ── */
export interface QueueOpts {
  variant?: U<'list' | 'held'>; items?: U<readonly string[]>; held?: U<string>; editing?: U<number>; attrs?: U<Attrs>;
  /** held: the message can be taken back into the composer: the list rows' own Edit, named by this (what it brings back) */ edit?: U<string>;
  /** held: what Send now does, said in its tip before it is pressed ("Send now stops those turns.") */ sendTip?: U<string>;
}
export function queue(o: QueueOpts): string {
  const v = o.variant ?? 'list';
  /* held (board K02, kit.css `.queue-held`): the clock, the one line, Send now; the buttons carry `data-queue` ("now", "edit") */
  const rows = v === 'held'
    ? '<div class="k7-queue__row"' + partAttrs('QueueRow', { role: 'listitem' }) + '>' + glyph('clock') + '<span class="k7-queue__text k7-ell">' + esc(o.held ?? '1 message waits until the discussion ends') + '</span>' +
      (o.edit ? iconButton({ icon: 'pen', label: o.edit, tip: 'Edit', variant: 'ghost', attrs: { 'data-queue': 'edit' } }) : '') + button({ label: 'Send now', variant: 'tint', size: 28, ...(o.sendTip ? { tip: o.sendTip } : {}), attrs: { 'data-queue': 'now' } }) + '</div>'
    : (o.items ?? []).map((t, i) => '<div class="k7-queue__row"' + partAttrs('QueueRow', { role: 'listitem', 'data-editing': o.editing === i ? '' : null }) + '><span class="k7-queue__n k7-mono">' + (i + 1) + '</span>' +
      (o.editing === i ? '<span class="k7-queue__edit" contenteditable="plaintext-only" role="textbox" aria-label="Edit the queued message">' + esc(t) + '</span>' : '<span class="k7-queue__text k7-ell">' + esc(t) + '</span>') +
      iconButton({ icon: 'pen', label: 'Edit', variant: 'ghost' }) + iconButton({ icon: 'close', label: 'Cancel', variant: 'ghost' }) + button({ label: 'Send now', variant: 'tint', size: 28 }) + '</div>').join('');
  return '<div class="k7-queue"' + kitAttrs('Queue', { role: 'list', 'aria-label': v === 'held' ? 'Held message' : 'Queued messages', 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + rows + '</div>';
}

/* ── DiffView (15): stacked, split; with an inline comment. One grid: a 36 line-number gutter, a 16 sign column, the code ── */
export interface DiffLine { n?: number | null; sign?: '+' | '-' | ' '; text: string }
export interface DiffComment { at: number; who: string; text: string; bot?: BotLike }
export interface DiffViewOpts { path: string; lines: readonly DiffLine[]; variant?: U<'stacked' | 'split'>; comment?: U<DiffComment>; focusComment?: U<boolean>; attrs?: U<Attrs> }
export function diffView(o: DiffViewOpts): string {
  const v = o.variant ?? 'stacked';
  const add = o.lines.filter((l) => l.sign === '+').length, del = o.lines.filter((l) => l.sign === '-').length;
  const row = (l: DiffLine): string => '<div class="k7-diff__row"' + partAttrs('DiffRow', { 'data-sign': l.sign === '+' ? 'add' : l.sign === '-' ? 'del' : null }) + '><span class="k7-diff__n">' + (l.n ?? '') + '</span><span class="k7-diff__g">' + esc(l.sign && l.sign !== ' ' ? (l.sign === '-' ? '−' : '+') : '') + '</span><span class="k7-diff__code"' + partAttrs('DiffCode') + '>' + esc(l.text) + '</span></div>';
  const comment = (c: DiffComment): string => '<div class="k7-diff__comment"' + partAttrs('DiffComment', { 'data-sq': '', 'data-sq-mode': 'frame' }) + '><div class="k7-diff__who">' + (c.bot ? orbHtml(c.bot, { size: 16, still: true }) : glyph('user')) + esc(c.who) + '</div>' +
    '<div class="k7-diff__text"' + attrs({ contenteditable: o.focusComment ? 'plaintext-only' : null, role: o.focusComment ? 'textbox' : null, 'aria-label': o.focusComment ? 'Comment' : null, tabindex: o.focusComment ? '0' : null }) + '>' + esc(c.text) + '</div></div>';
  const col = (lines: readonly DiffLine[]): string => lines.map((l, i) => row(l) + (o.comment && o.comment.at === i ? comment(o.comment) : '')).join('');
  const body = v === 'split'
    ? '<div class="k7-diff__split"><div class="k7-diff__col ui-scroll ui-scroll--x" tabindex="0" role="region" aria-label="Before">' + col(o.lines.filter((l) => l.sign !== '+')) + '</div><div class="k7-diff__col ui-scroll ui-scroll--x" tabindex="0" role="region" aria-label="After">' + col(o.lines.filter((l) => l.sign !== '-')) + '</div></div>'
    : col(o.lines);
  return '<div class="k7-diff"' + kitAttrs('DiffView', { 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' +
    '<div class="k7-diff__head">' + glyph('file') + '<span class="k7-ell k7-mono">' + esc(o.path) + '</span><span class="k7-files__counts k7-mono"><span data-tone="add">+' + add + '</span><span data-tone="del">−' + del + '</span></span></div>' +
    (v === 'split' ? '<div class="k7-diff__body">' : '<div class="k7-diff__body ui-scroll ui-scroll--x" tabindex="0" role="region"' + attrs({ 'aria-label': o.path }) + '>') + body + '</div></div>';
}

/* ── Composer (39): session, bot, room, dock, notch; with its line; empty, typed, multi-line, running (Stop joins the right cluster; Enter
   queues), held, no model; listening (the mic on), a file dragged over it. What it does is wire.ts `wireComposer` and compose.ts ── */
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
export { mark };
