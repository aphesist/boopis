/* AskCard: its view (typed props to markup) and its contract. Its look is ask-card.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { orbHtml } from '../../orb';
import { chip } from '../chip/chip';
import { kbd } from '../kbd/kbd';
import { statusWord } from '../status-word/status-word';
import type { StatusTone } from '../status-word/status-word';
import { blockAttrs, attrs, esc, glyph, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { well } from '../well/well';
import { defineContract } from '../contract';

/** an agent card's head: the asker's mark (a model's 16 px mark, or a bot's 16 px orb), a short line, and the state at the end */
function askerHTML(o: { model?: U<ModelRef>; bot?: U<BotLike>; rest?: U<boolean> }): string {
  return o.bot ? orbHtml(o.bot, o.rest ? { size: 16, rest: true, surface: '--bg-3' } : { size: 16, still: true, mode: 'fixed', surface: '--bg-3' }) : o.model ? '<span class="k7-head__mark">' + markHTML(o.model, { size: 14, label: false }) + '</span>' : '';   /* a model's mark is 14 in a card's head (sessiontab.js `ask`: cm(fam, 14)) */
}
/* ── AskCard (9): standalone (a bot's approval, never expires), attached (in a ToolRow: its answers alone, S09), question (chips),
   choices (lettered rows), lapsed blank (the guess); asked, needs you, answered (one row), lapsed ── */
export const ASK_VARIANTS = ['standalone', 'attached', 'question', 'choices', 'lapsed', 'form'] as const;
export type AskVariant = typeof ASK_VARIANTS[number];
export const ASK_STATES = ['asked', 'needs', 'answered', 'lapsed', 'withdrawn'] as const;
export type AskState = typeof ASK_STATES[number];
export interface AskAnswer {
  label: string; primary?: boolean; hold?: boolean; keys?: string;
  /** what the answer is called to the app (data-value) */ value?: string;
  /** the outlined chip (the boards' Deny) */ outline?: boolean;
  /** a ghost chip: no fill and no line, the quietest answer (6e: Edit on a permission) */ ghost?: boolean;
  /** at the row's end, the others at its start (the dock's cards, K03 and K04: Deny at the end) */ end?: boolean;
  /** drawn as the board draws it, and it does nothing yet: the reason, said in its tip */ inert?: string;
  /** what the answer does, to the app (data-action: a form's submit, defer, cancel) */ action?: string;
}
export interface AskCardOpts {
  variant?: U<AskVariant>; state?: U<AskState>; who?: U<string>; bot?: U<BotLike>; model?: U<ModelRef>;
  ask: string; sub?: U<string>; /** the approval rule that asked, by name: "Rule: “...”" in the accent (board 11) */ rule?: U<string>; command?: U<string>; answers?: U<readonly AskAnswer[]>; choices?: U<readonly string[]>; chosen?: U<number | string>;
  /** answered: the one-line receipt ("Allowed once", "sent as a correction") */ receipt?: U<string>; something?: U<boolean>; attrs?: U<Attrs>;
  /** the asker's orb at rest, in its pose (the dock's cards: every bot in the dock rests unless its state shows in the row) */ rest?: U<boolean>;
  /** "needs you" in words alone, without its dot (the dock's cards, K03 and K04: the orb's flag in the row already carries the dot) */ plain?: U<boolean>;
  /* ── the form variant (`form`, derived at step 6d: a form is this same block, REPASS.md 6d) ── */
  /** who asks, drawn by the app where an orb or a model's mark is not it (several askers with "+N", a connector's tile, a mod's glyph, the
      boopis mark); '' draws no avatar */ lead?: U<string>;
  /** the StatusWord at the head's end in place of the state's own ("later", "done", "expired", "cancelled": quiet) */ word?: U<{ text: string; tone?: U<StatusTone> }>;
  /** how long the ask stays open, in words ("expires in 9 min"), quiet before the StatusWord; the app keeps it current (`data-countdown`) */ countdown?: U<string>;
  /** what the form asks for, as kit markup (Fields, OptionRows, a Segmented, a Well, a DiffView, the card of steps), stacked 8 apart */ fields?: U<string>;
  /** what submitting does, in one quiet small line over the answers */ effect?: U<string>;
  /** why the answer did not go: the Field's error line, for the whole form */ error?: U<string>;
  /** the answer is being sent: the primary shows the kit's working state (its words shimmer) and the fields and answers are inert */ busy?: U<boolean>;
  /** an answered row's action at its end, as kit markup ("Open" on a form put off for later) */ rowAction?: U<string>;
}
export const APPROVAL_ANSWERS: readonly AskAnswer[] = [{ label: 'Hold to allow once', primary: true, hold: true }, { label: 'Allow all this turn', value: 'turn' }, { label: 'Always allow', value: 'always' }, { label: 'Deny', value: 'deny', keys: 'esc', outline: true }];
const answerChips = (list: readonly AskAnswer[], more = '', busy = false): string => '<div class="k7-ask__answers"' + (busy ? ' inert' : '') + '>' + list.map((x) => chip({ label: x.label, variant: 'answer', chosen: !!x.primary && !busy, hold: !!x.hold && !(busy && x.primary), attrs: { 'data-value': x.value ?? null, 'data-action': x.action ?? null, 'data-outline': x.outline ? '' : null, 'data-ghost': x.ghost ? '' : null, 'data-end': x.end ? '' : null, 'aria-keyshortcuts': x.keys ? (x.keys === 'esc' ? 'Escape' : x.keys) : null, 'aria-disabled': x.inert ? 'true' : null, 'data-tip': x.inert ?? null, 'data-busy': busy && x.primary ? '' : null, 'aria-busy': busy && x.primary ? 'true' : null } }).replace('<span class="k7-chip__label">', busy && x.primary ? '<span class="k7-chip__label k7-shimmer">' : '<span class="k7-chip__label">').replace('</button>', x.keys ? kbd({ keys: x.keys }) + '</button>' : '</button>')).join('') + more + '</div>';
export function askCard(o: AskCardOpts): string {
  const v = o.variant ?? 'standalone', st = o.state ?? 'needs';
  /* attached (S09): the answers alone, at the end of their tool row's Block; the row's own head says what waits and for whom */
  if (v === 'attached') return '<div class="k7-ask"' + partAttrs('AskCard', { role: 'group', 'aria-label': o.ask, 'data-variant': v, 'data-state': st, ...(o.attrs ?? {}) }) + '>' + answerChips(o.answers ?? APPROVAL_ANSWERS) + '</div>';
  const stateWord = o.word ? (o.word.text ? statusWord({ text: o.word.text, tone: o.word.tone }) : '') : st === 'needs' ? statusWord({ text: 'needs you', tone: 'owe', dot: !o.plain }) : st === 'lapsed' ? statusWord({ text: 'lapsed', tone: 'owe' }) : st === 'withdrawn' ? statusWord({ text: 'withdrawn' }) : st === 'answered' ? statusWord({ text: o.receipt ?? 'answered', tone: 'ok' }) : '';
  const lead = o.lead ?? askerHTML(o);
  const count = o.countdown != null ? '<span class="k7-ask__count" data-countdown>' + esc(o.countdown) + '</span>' : '';
  const head = '<div class="k7-ask__head k7-text">' + lead + '<span class="k7-ask__who k7-ell">' + esc(o.who ?? (v === 'question' || v === 'lapsed' ? 'asked during the turn' : (o.bot?.name ?? 'boopis') + ' asks')) + '</span>' + count + stateWord + '</div>';
  const a = blockAttrs('AskCard', { role: 'group', 'aria-label': o.ask, 'data-variant': v, 'data-state': st, 'data-busy': o.busy ? '' : null, 'aria-busy': o.busy ? 'true' : null, ...(o.attrs ?? {}) });
  if (st === 'answered' || st === 'withdrawn') {
    /* answered: a one-line receipt, then the card collapses to one row (a form put off for later keeps "Open" at its end) */
    return '<div class="k7-ask k7-block"' + a + '><div class="k7-ask__head k7-text">' + lead + '<span class="k7-ask__who k7-ell">' + esc(o.ask) + '</span>' + stateWord + (o.rowAction ?? '') + '</div></div>';
  }
  const body = '<p class="k7-ask__ask k7-text">' + (v === 'lapsed' && o.choices ? esc(o.ask) : esc(o.ask)) + '</p>' + (o.rule ? '<p class="k7-ask__sub k7-text">Rule: <span class="k7-ask__rule">“' + esc(o.rule) + '”</span></p>' : o.sub ? '<p class="k7-ask__sub k7-text">' + esc(o.sub) + '</p>' : '') + (o.command ? well({ text: o.command }) : '');
  if (v === 'form') {
    /* a form (6d): the ask, its why, what it asks for stacked 8 apart, what submitting does, why the last answer did not go, the answers */
    return '<div class="k7-ask k7-block"' + a + '>' + head + body + (o.fields ? '<div class="k7-ask__fields"' + (o.busy ? ' inert' : '') + '>' + o.fields + '</div>' : '') +
      (o.effect ? '<p class="k7-ask__effect k7-text">' + esc(o.effect) + '</p>' : '') + (o.error ? '<p class="k7-ask__error k7-text" role="alert">' + esc(o.error) + '</p>' : '') +
      (o.answers?.length ? answerChips(o.answers, '', !!o.busy) : '') + '</div>';
  }
  let answers = '';
  if (v === 'choices') {
    answers = '<div class="k7-ask__choices" role="radiogroup"' + attrs({ 'aria-label': o.ask }) + '>' + (o.choices ?? []).map((c, i) => {
      const on = o.chosen === i || o.chosen === c;
      return '<button class="k7-reset k7-ask__choice" type="button" role="radio"' + attrs({ 'aria-checked': String(on), 'data-chosen': on ? '' : null }) + '><span class="k7-ask__letter" aria-hidden="true">' + String.fromCharCode(65 + i) + '</span><span class="k7-ell">' + esc(c) + '</span></button>';
    }).join('') + (o.something !== false ? '<button class="k7-reset k7-ask__choice" type="button"><span class="k7-ask__letter" aria-hidden="true">' + glyph('pen') + '</span><span class="k7-ell">Something else</span></button>' : '') + '</div>';
  } else {
    const list: readonly AskAnswer[] = o.answers ?? (v === 'question' || v === 'lapsed' ? (o.choices ?? []).map((c, i) => ({ label: c, primary: i === 0 })) : APPROVAL_ANSWERS);
    answers = answerChips(list, (v === 'question' || v === 'lapsed') && o.something !== false ? chip({ label: 'Something else', variant: 'answer', attrs: { 'data-value': 'else', 'data-outline': '' } }) : '');
  }
  /* a form's question (6d): your own words in a Field under the answers once "Something else" is chosen, and why the answer did not go */
  const after = (o.fields ? '<div class="k7-ask__fields"' + (o.busy ? ' inert' : '') + '>' + o.fields + '</div>' : '') + (o.error ? '<p class="k7-ask__error k7-text" role="alert">' + esc(o.error) + '</p>' : '');
  return '<div class="k7-ask k7-block"' + a + '>' + head + body + (o.busy ? answers.replace(/^<div class="k7-ask__(answers|choices)"/, '<div inert class="k7-ask__$1"') : answers) + after + '</div>';
}

/** what AskCard promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<AskCardOpts>({
  name: 'AskCard',
  folder: 'ask-card',
  layer: 'thread',
  summary: 'A question for the person: an approval, a question with chips, lettered choices, a lapsed blank, or a whole form. Asked, needs you, answered (one row), lapsed or withdrawn.',
  exports: ['askCard'],
  props: {
    variant: 'standalone (the default), attached, question, choices, lapsed or form',
    state: 'asked, needs (the default), answered, lapsed or withdrawn',
    who: 'who asks, in words',
    bot: 'the bot that asks (its orb leads)',
    model: 'the model that asks (its mark leads)',
    ask: 'the question',
    sub: 'a line under it',
    rule: 'the approval rule that asked, by name',
    command: 'the command it would run, in a Well',
    answers: 'its answers as chips (primary, hold, keys, outline, ghost, at the end, inert)',
    choices: 'choices: the lettered rows',
    chosen: 'the answer chosen (answered)',
    receipt: 'answered: the one-line receipt ("Allowed once")',
    something: 'question: false hides "Something else"',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    rest: 'the asker\'s orb at rest, in its pose',
    plain: '"needs you" in words alone, without its dot',
    lead: 'who asks, drawn by the app where an orb or a mark is not it',
    word: 'the StatusWord at the head\'s end in place of the state\'s own',
    countdown: 'how long it stays open, in words',
    fields: 'form: what it asks for, as kit markup',
    effect: 'form: what submitting does, in one quiet line',
    error: 'form: why the answer did not go',
    busy: 'form: the answer is being sent (the fields and answers are inert)',
    rowAction: 'answered: an action at the row\'s end, as markup'
  },
  events: ['ui:commit'],
  states: ['data-variant', 'data-state', 'aria-busy', 'inert (while busy)'],
  parts: ['AskCard (attached: its answers alone)', 'k7-ask__answers'],
  tokens: [
    '--accent', '--accent-text', '--badge-h', '--bubble-max', '--ctl', '--fill-2', '--focus-w', '--fs-2xs', '--fs-m', '--fs-s',
    '--fs-xs', '--gap-hair', '--gap-row', '--gap-s', '--hl', '--hover', '--icon-s', '--letter', '--lh-m', '--lh-xs', '--line',
    '--line-strong', '--mono', '--on-accent', '--pad-block', '--r-block', '--r-field', '--r-tip', '--red-text', '--sp-1', '--sp-2',
    '--text', '--text-dim'
  ],
  a11y: 'role="group" named by the question. Its answers are buttons; the primary one may need a 1 s hold (or Enter twice). Answered, it is one line that says what was chosen.',
  boards: []
});
