/* TurnFoot: its view (typed props to markup) and its contract. Its look is turn-foot.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { badge } from '../badge/badge';
import { markStack } from '../mark/mark';
import { attrs, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── TurnFoot (37): under a finished reply. bot: the model, the time, the cost. session (board S23's `.turnbar`): the checkpoint the turn
   left, its actions (Undo, Edit from here, Fork: the app passes the ones that exist), and at the end the model, the time and the cost ── */
export interface TurnFootAction { label: string; value: string; icon?: U<string>; /** it cannot be taken now: drawn faint, still hovered and focused so its tip says why (6e: a rewind in a shared checkout) */ disabled?: U<boolean>; tip?: U<string> }
export interface TurnFootOpts {
  kind?: U<'bot' | 'session'>; model?: U<ModelRef>; modelName?: U<string>; time?: U<string>; cost?: U<string>;
  /** a session's: the checkpoint this turn left ("Checkpoint 3") */ label?: U<string>;
  /** a session's actions (the board's three unless said); each button carries `data-value` */ actions?: U<readonly TurnFootAction[]>; attrs?: U<Attrs>;
  /** a few words after the model (why it was picked: "debugging"; "8 steps") */ note?: U<string>; /** a Badge after the model ("ungoverned"), and what it means in its tip */ badge?: U<string>; badgeTip?: U<string>;
  /** several models answered (a council, 6e): their marks stacked in place of the one model's (three, then "+N") */ marks?: U<readonly ModelRef[]>;
}
export const TURN_ACTIONS: readonly TurnFootAction[] = [{ label: 'Undo', value: 'undo', icon: 'back' }, { label: 'Edit from here', value: 'edit', icon: 'pen' }, { label: 'Fork', value: 'fork', icon: 'fork' }];
export function turnFoot(o: TurnFootOpts): string {
  const k = o.kind ?? 'bot';
  const extra = (o.badge ? badge({ text: o.badge, attrs: { 'data-tip': o.badgeTip ?? null } }) : '') + (o.note ? '<span class="k7-foot__note">' + esc(o.note) + '</span>' : '');
  if (k === 'session') {
    const list = o.actions ?? TURN_ACTIONS;
    const said = [o.modelName, o.time, o.cost].filter(Boolean).join(' ');
    return '<div class="k7-foot"' + kitAttrs('TurnFoot', { 'data-kind': k, ...(o.attrs ?? {}) }) + '>' + (o.label ? '<span class="k7-foot__label">' + esc(o.label) + '</span>' : '') +
      (list.length ? '<span class="k7-foot__acts">' + list.map((x) => '<button class="k7-reset k7-foot__btn" type="button"' + attrs({ 'data-value': x.value, 'aria-disabled': x.disabled ? 'true' : null, 'data-tip': x.tip }) + '>' + glyph(x.icon) + esc(x.label) + '</button>').join('') + '</span>' : '') +
      '<span class="k7-grow"></span>' + extra + (said || o.model || o.marks ? '<span class="k7-foot__meta k7-mono">' + (o.marks?.length ? markStack(o.marks, 12) + ' ' : o.model ? markHTML(o.model, { size: 12, label: false }) + ' ' : '') + esc(said) + '</span>' : '') + '</div>';
  }
  const meta = (o.model ? '<span class="k7-foot__model">' + markHTML(o.model, { size: 14, label: false }) + esc(o.modelName ?? '') + '</span>' : o.modelName ? '<span class="k7-foot__model">' + esc(o.modelName) + '</span>' : '') + extra +
    (o.time ? '<span class="k7-mono">' + esc(o.time) + '</span>' : '') + (o.cost ? '<span class="k7-mono">' + esc(o.cost) + '</span>' : '');
  return '<div class="k7-foot"' + kitAttrs('TurnFoot', { 'data-kind': k, ...(o.attrs ?? {}) }) + '>' + meta + '</div>';
}

/** what TurnFoot promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<TurnFootOpts>({
  name: 'TurnFoot',
  folder: 'turn-foot',
  layer: 'thread',
  summary: 'Under a finished reply. A bot\'s: the model, the time, the cost. A session\'s: the checkpoint it left, its actions (Undo, Edit from here, Fork), and the model, time and cost at the end.',
  exports: ['turnFoot'],
  props: {
    kind: 'bot (the default) or session',
    model: 'the model that answered',
    modelName: 'the model\'s name',
    time: 'how long it took',
    cost: 'what it cost',
    label: 'session: the checkpoint it left',
    actions: 'session: its actions (each carries data-value)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    note: 'a few words after the model',
    badge: 'a Badge after the model',
    badgeTip: 'what the Badge means, in its tip',
    marks: 'several models answered: their marks stacked'
  },
  events: [],
  states: ['data-kind', 'aria-disabled (an action that cannot be taken)'],
  parts: ['k7-foot__acts', 'k7-foot__meta'],
  tokens: [
    '--focus-w', '--fs-xs', '--gap-row', '--gap-s', '--hover', '--lh-m', '--lh-xs', '--line-h', '--pad-kbd', '--r-pill', '--sp-1',
    '--sp-2', '--text', '--text-dim', '--text-faint', '--track'
  ],
  a11y: 'Its actions are buttons; one that cannot be taken stays focusable (aria-disabled) so its tip says why.',
  boards: ['11-botchat', '12-room', '17-working', 'S23-finished', 'S33-changed', '14-settings']
});
