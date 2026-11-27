/* ListRow: its view (typed props to markup) and its contract. Its look is list-row.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { orbHtml } from '../../orb';
import { inkOrb } from '../avatar/avatar';
import { badge } from '../badge/badge';
import { button } from '../button/button';
import { attrs, esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── ListRow (17): session (44, two lines), bot (54, its orb 28: board K02, the owner's "Grok sizes", 23 November; a room's row leads
   with its members' stack), head (the main bot at 44 over its name, first in the Bots list: K02), item (60, a 40 mark, the action a
   28 pill), compact (36, one line) ── */
export const LIST_ROW_VARIANTS = ['session', 'bot', 'head', 'item', 'compact'] as const;
export type ListRowVariant = typeof LIST_ROW_VARIANTS[number];
export interface ListRowOpts {
  variant?: U<ListRowVariant>; title: string; sub?: U<string>; bot?: U<BotLike>; markText?: U<string>; markHTML?: U<string>; action?: U<string>; /** the app's handles on an item's action */ actionAttrs?: U<Attrs>;
  current?: U<boolean>; needs?: U<boolean | string>; working?: U<boolean>; count?: U<string>; time?: U<string>; /** the boopis bot, in ink */ ink?: U<boolean>;
  /** a session's row (the boards' `.sess-row`): the mark of the model that answers in it leads, its branch is the sub line's mono part */ model?: U<ModelRef>; branch?: U<string>;
  /** a bot row's lead in place of one orb: a room's member stack (OrbStack, 24 in rows; screen 12) */ leadHTML?: U<string>; /** the end slot's own words (a bot made outside boopis) */ endHTML?: U<string>; attrs?: U<Attrs>;
}
export function listRow(o: ListRowOpts): string {
  const v = o.variant ?? 'session', rowOfSession = v === 'session' || v === 'compact';
  const needsWords = typeof o.needs === 'string' ? o.needs : null;
  const sub = needsWords ? '<span class="k7-lrow__sub" data-tone="owe">' + esc(needsWords) + '</span>'
    : v === 'session' && (o.branch || o.time || o.sub) ? '<span class="k7-lrow__sub">' + [o.branch ? '<span class="k7-mono">' + esc(o.branch) + '</span>' : '', o.sub ? '<span>' + esc(o.sub) + '</span>' : '', o.time ? '<span>' + esc(o.time) + '</span>' : ''].filter(Boolean).join(' ') + '</span>'   /* a word break between them: the row's name holds its visible words (the line is a flex row: the space takes no room) */
    : o.sub ? '<span class="k7-lrow__sub">' + esc(o.sub) + '</span>' : '';
  if (v === 'head') {
    /* board K02's `.sb-main` (src-k02 screens.js sidebarOpen): the bot's 44 orb at rest over its name; it opens that bot as a row does */
    const orb = orbHtml(o.bot ?? { name: o.title }, { size: 44, rest: true, surface: '--bg-1', state: o.bot?.state && o.bot.state !== 'idle' ? undefined : o.needs ? 'needs' : o.working ? 'working' : undefined });
    return '<div class="k7-lrow"' + kitAttrs('ListRow', { role: 'option', tabindex: o.current ? '0' : '-1', 'data-variant': v, 'aria-selected': o.current ? 'true' : 'false', 'data-current': o.current ? '' : null, 'data-needs': o.needs ? '' : null, 'data-working': o.working ? '' : null, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' +
      (o.ink ? inkOrb(orb) : orb) + '<span class="k7-lrow__title">' + esc(o.title) + '</span>' + (o.needs ? '<span class="k7-dot" data-tone="owe" aria-hidden="true"></span>' : '') + '</div>';
  }
  const lead = v === 'bot' ? (o.leadHTML ?? ((h: string) => (o.ink ? inkOrb(h) : h))(orbHtml(o.bot ?? { name: o.title }, { size: 28, rest: true, surface: '--bg-1', state: o.bot?.state && o.bot.state !== 'idle' ? undefined : o.needs ? 'needs' : o.working ? 'working' : undefined })   /* the bot's own state when it says one (compute, replying...), else the row's flags */))
    : v === 'item' ? '<span class="k7-lrow__mark" aria-hidden="true">' + (o.markHTML ?? esc(o.markText ?? o.title.slice(0, 2))) + '</span>'
    : o.model ? '<span class="k7-lrow__lead" aria-hidden="true">' + markHTML(o.model, { size: 16, label: false }) + '</span>' : '';
  /* a session's row ends with what it waits on you for (the amber badge), or the working dot, or nothing */
  /* a bot's row that waits on you ends with the amber dot (the boards' `.sb-row .dot.owe`); its orb carries no flag there */
  const end = (o.endHTML ?? '') + (o.needs && v === 'bot' ? '<span class="k7-dot" data-tone="owe" aria-hidden="true"></span>' : o.needs ? badge({ text: o.count ?? 'needs you', tone: 'owe' }) : o.count ? badge({ text: o.count }) : '') +
    (rowOfSession && o.working && !o.needs ? '<span class="k7-dot" data-live aria-hidden="true"></span>' : '') +
    (o.time && v !== 'session' ? '<span class="k7-lrow__time k7-mono">' + esc(o.time) + '</span>' : '') + (v === 'item' && o.action ? button({ label: o.action, variant: 'tint', size: 28, ...(o.actionAttrs ? { attrs: o.actionAttrs } : {}) }) : '');
  const text = v === 'compact'
    ? '<span class="k7-lrow__title">' + esc(o.title) + '</span>' + (o.sub ? ' <span class="k7-lrow__sub">' + esc(o.sub) + '</span>' : '') + '<span class="k7-grow"></span>'
    : '<span class="k7-lrow__text"><span class="k7-lrow__title">' + esc(o.title) + '</span>' + (sub ? ' ' + sub : '') + '</span>';   /* a space between the parts: the row's text reads as words (its name holds them, WCAG 2.5.3) */
  /* an item row carries its action, so it is a list item, not an option (no control inside a control) */
  const item = v === 'item';
  return '<div class="k7-lrow"' + kitAttrs('ListRow', { role: item ? 'listitem' : 'option', tabindex: item ? null : o.current ? '0' : '-1', 'data-variant': v, 'aria-selected': item ? null : o.current ? 'true' : 'false', 'data-current': o.current ? '' : null, 'data-needs': o.needs ? '' : null, 'data-working': o.working ? '' : null, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' +
    lead + text + (end ? ' ' + end : '') + '</div>';
}
/** rows as a list: one tab stop, arrows move (12.2 List) */
export interface ListOpts { label: string; rows: readonly ListRowOpts[]; attrs?: U<Attrs> }
export function list(o: ListOpts): string {
  return '<div class="k7-list"' + attrs({ role: o.rows.every((r) => r.variant === 'item') ? 'list' : 'listbox', 'aria-label': o.label, 'data-kit-part': 'Sidebar', ...(o.attrs ?? {}) }) + '>' + o.rows.map(listRow).join('') + '</div>';
}

/** what ListRow promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<ListRowOpts>({
  name: 'ListRow',
  folder: 'list-row',
  layer: 'row',
  summary: 'A row of a list: a session (44, two lines), a bot (54, its orb 28), the main bot (head), an item (60, a 40 mark and its action) or compact (36). `list` makes rows one list with one tab stop.',
  exports: ['listRow', 'list'],
  props: {
    variant: 'session (the default), bot, head, item or compact',
    title: 'its first line',
    sub: 'its second line',
    bot: 'bot and head: the bot whose orb leads',
    markText: 'item: the mark\'s letters',
    markHTML: 'item: the mark as markup',
    action: 'item: its action\'s words (a tinted 28 Button)',
    actionAttrs: 'item: the app\'s handles on the action',
    current: 'it is the one open now',
    needs: 'it waits on you: true, or the words that say for what',
    working: 'work is running in it (a live dot)',
    count: 'a count at its end (a Badge)',
    time: 'when it last ran',
    ink: 'the boopis bot, in ink',
    model: 'session: the mark of the model that answers in it',
    branch: 'session: its branch, the second line\'s mono part',
    leadHTML: 'bot: a lead in place of the orb (a room\'s stack)',
    endHTML: 'its end slot\'s own words (made outside boopis)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['aria-selected', 'data-current', 'data-variant', 'data-needs', 'data-working'],
  parts: ['Sidebar (the list)', 'k7-lrow__title', 'k7-lrow__sub'],
  tokens: [
    '--bg-1', '--bg-4', '--compact-h', '--current', '--dur-1', '--dur-out', '--ease-out', '--flag-ring', '--focus-w', '--fs-2xs',
    '--fs-m', '--fs-s', '--fs-xs', '--gap-row', '--gap-s', '--hair', '--hl', '--hover', '--item-h', '--item-mark', '--lh-s',
    '--lh-xs', '--line-field', '--mono', '--owe-text', '--pad-kbd', '--r-field', '--r-floor', '--r-tile', '--row-h-2',
    '--session-h', '--sp-2', '--sp-3', '--text', '--text-dim', '--track-s'
  ],
  a11y: 'An option of a listbox (an item row is a listitem, since it carries its own action). The list is one tab stop; its current row takes it.',
  boards: []
});
