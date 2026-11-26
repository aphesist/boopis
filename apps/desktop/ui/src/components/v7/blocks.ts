/* The v7 kit's blocks (DESIGN-SYSTEM.md v7 12.2 and 21.2): Card (and its Row), Block, Menu, MenuRow, OptionRow, ListRow,
   SectionHead, Notice, SystemLine, Bubble, Well, Disclosure, TurnFoot, TimeSeparator, EmptyState. */
import type { BotLike } from '../bot-state';
import { markHTML } from '../model-mark';
import type { ModelRef } from '../model-mark';
import { orbHtml } from '../orb';
import { scrollClass } from '../scroll';
import { kbd, button, iconButton } from './controls';
import { badge, botColours, inkOrb, markStack, statusWord } from './inline';
import { attrs, cls, esc, glyph, idFrom, kitAttrs, partAttrs, textOr } from './util';
import type { Attrs, U } from './util';

/* ── Card (6): the settings card of Rows; settings, pane card, danger zone (collapsed) ── */
export const CARD_VARIANTS = ['settings', 'pane', 'danger'] as const;
export type CardVariant = typeof CARD_VARIANTS[number];
export interface RowOpts {
  label: string; labelHTML?: U<string>; value?: U<string>; /** the value with a lead (a model's mark, then its name) */ valueHTML?: U<string>; mono?: U<boolean>; control?: U<string>;
  /** a second line under the label, 12 --text-dim (a routine's time, what a connector holds): the label is then two lines by design */ sub?: U<string>;
  /** a label that explains itself: the mark (17.1), revealed on the row's hover or focus */ explain?: U<string>; id?: U<string>; attrs?: U<Attrs>;
  /** the whole row is one control (a pane card's row opens where its value is set): what pressing it does, said to a screen reader */ action?: U<string>;
}
export function row(o: RowOpts): string {
  const label = o.explain
    ? '<span class="k7-row__label">' + '<button class="k7-reset k7-mark k7-info" type="button" data-kit="Mark" data-mark-kind="info" aria-haspopup="dialog"' + attrs({ 'data-explain': o.explain, id: o.id }) + '>' + esc(o.label) + '<span class="k7-mark__i" aria-hidden="true">' + glyph('info') + '</span></button></span>'
    : '<span class="k7-row__label"' + attrs({ id: o.id, 'data-wrap-ok': o.sub ? '' : null }) + '>' + textOr(o.label, o.labelHTML) + (o.sub ? '<br><span class="k7-row__sub">' + esc(o.sub) + '</span>' : '') + '</span>';
  return '<div class="k7-row"' + partAttrs('Row', { 'data-mark-reveal': o.explain ? 'hover' : null, ...(o.action ? { role: 'button', tabindex: '0', 'data-action': '', 'aria-label': o.label + (o.value ? ': ' + o.value : '') + ', ' + o.action } : {}), ...(o.attrs ?? {}) }) + '>' + label + ' ' +   /* a word break between the label and the value, for the row's name (a flex row: it takes no room) */
    (o.valueHTML ? '<span class="k7-row__value k7-row__value--lead">' + o.valueHTML + '</span>' : o.value ? '<span class="' + cls('k7-row__value', o.mono && 'k7-mono') + '">' + esc(o.value) + '</span>' : '') + (o.control ?? '') + '</div>';
}
export interface CardOpts { variant?: U<CardVariant>; rows: readonly RowOpts[]; open?: U<boolean>; title?: U<string>; attrs?: U<Attrs> }
export function card(o: CardOpts): string {
  const v = o.variant ?? 'settings';
  if (v === 'danger') {
    const id = idFrom('k7-dz', (o.title ?? '') + o.rows.map((r) => r.label).join());
    return '<section class="k7-card"' + kitAttrs('Card', { 'data-variant': 'danger', 'data-disclose': '', 'data-open': o.open ? '' : null, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' +
      '<button class="k7-reset k7-card__head" type="button"' + attrs({ 'aria-expanded': String(!!o.open), 'aria-controls': id }) + '><span class="k7-row__label">' + esc(o.title ?? 'Danger zone') + '</span>' + glyph('chevron-down', 'k7-chev') + '</button>' +
      '<div class="k7-card__body" id="' + id + '">' + o.rows.map(row).join('') + '</div></section>';
  }
  return '<section class="k7-card"' + kitAttrs('Card', { 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + o.rows.map(row).join('') + '</section>';
}

/* ── Block (7): every inline surface that holds controls: radius 22, padding 8, 28 px controls on the 8 inset, text 4 more ── */
export interface BlockOpts {
  body: string; attrs?: U<Attrs>;
  /** `offer` (board S37's `.ns-hello`): what is missing, said kindly in one centred sentence, over the row of ways to get it (`actions`,
      kit Buttons as markup) */ variant?: U<'offer'>; text?: U<string>; actions?: U<string>;
}
export function block(o: BlockOpts): string {
  const body = o.variant === 'offer' ? '<p class="k7-type-s k7-block__say">' + esc(o.text ?? '') + '</p><div class="k7-block__ways">' + (o.actions ?? '') + '</div>' + o.body : o.body;
  return '<div class="k7-block"' + kitAttrs('Block', { 'data-sq': '', 'data-sq-mode': 'frame', 'data-variant': o.variant ?? null, ...(o.attrs ?? {}) }) + '>' + body + '</div>';
}

/* ── MenuRow (19): glyph + name, name + description, with kbd, danger; a check in a quick menu ── */
export interface MenuRowOpts {
  label: string; desc?: U<string>; icon?: U<string>; leadHTML?: U<string>; keys?: U<string>; danger?: U<boolean>;
  /** a quick menu's row: a check when on */ checked?: U<boolean>; disabled?: U<boolean>; value?: U<string>; role?: U<string>; attrs?: U<Attrs>;
}
export function menuRow(o: MenuRowOpts): string {
  const role = o.role ?? (o.checked == null ? 'menuitem' : 'menuitemcheckbox');
  return '<button class="k7-reset k7-mrow"' + kitAttrs('MenuRow', {
    type: 'button', role, tabindex: '-1', 'aria-checked': o.checked == null ? null : String(o.checked), 'aria-disabled': o.disabled ? 'true' : null,
    'data-danger': o.danger ? '' : null, 'data-value': o.value ?? o.label, ...(o.attrs ?? {})
  }) + '>' + (o.checked != null ? '<span class="k7-mrow__check" aria-hidden="true">' + (o.checked ? glyph('check') : '') + '</span>' : (o.leadHTML ?? glyph(o.icon))) +
    '<span class="k7-mrow__name">' + esc(o.label) + '</span>' + (o.desc ? '<span class="k7-mrow__desc">' + esc(o.desc) + '</span>' : '<span class="k7-grow"></span>') +
    (o.keys ? kbd({ keys: o.keys }) : '') + '</button>';
}

/* ── OptionRow (20): a two-line radio row (a permission step, an import pick, who answers next): the name, and what it means on a second
   line that is never cut (board S19) ── */
export interface OptionRowOpts {
  label: string; meaning: string; chosen?: U<boolean>; value?: U<string>; ticks?: U<{ of: number; on: number }>;
  /** what leads the name on its line (a model's mark, a glyph), and the keys that choose it, at the line's end */
  leadHTML?: U<string>; icon?: U<string>; keys?: U<string>;
  /** a choice that cannot be made now: it stays in its place, and its second line says why (`meaning` carries the reason) */
  disabled?: U<boolean>; attrs?: U<Attrs>;
  /** one of several that can all be chosen: a check box in place of the ring (6d, derived: a form's "choose any") */ check?: U<boolean>;
}
export function optionRow(o: OptionRowOpts): string {
  return '<button class="k7-reset k7-orow"' + kitAttrs('OptionRow', { type: 'button', role: 'menuitemradio', tabindex: '-1', 'aria-checked': String(!!o.chosen), 'aria-disabled': o.disabled ? 'true' : null, 'data-value': o.value ?? o.label, ...(o.attrs ?? {}) }) + '>' +
    (o.check ? '<span class="k7-orow__ring" data-check aria-hidden="true">' + glyph('check') + '</span>' : '<span class="k7-orow__ring" aria-hidden="true"></span>') + '<span class="k7-orow__text"><span class="k7-orow__name">' + (o.leadHTML ?? (o.icon ? glyph(o.icon) : '')) + '<span class="k7-orow__label">' + esc(o.label) + '</span>' +
    (o.ticks ? '<span class="k7-ticks" aria-hidden="true">' + Array.from({ length: o.ticks.of }, (_, i) => '<i' + (i < (o.ticks?.on ?? 0) ? ' data-on' : '') + '></i>').join('') + '</span>' : '') +
    (o.keys ? '<span class="k7-grow"></span>' + kbd({ keys: o.keys }) : '') + '</span><span class="k7-orow__meaning" data-wrap-ok>' + esc(o.meaning) + '</span></span></button>';
}

/* ── Menu (5): menu, quick menu (checks), palette (/ @ $), snooze, split-button menu, option menu (four rows), and a list whose rows
   say what they are beside their name (boards S31 and S32: 360 wide, the name whole and the description cut where the row ends) ── */
export const MENU_VARIANTS = ['menu', 'quick', 'palette', 'snooze', 'split', 'options', 'list'] as const;
export type MenuVariant = typeof MENU_VARIANTS[number];
export type MenuEntry = MenuRowOpts | OptionRowOpts | '-' | { heading: string };
export interface MenuOpts { label: string; entries: readonly MenuEntry[]; variant?: U<MenuVariant>; query?: U<string>; attrs?: U<Attrs>;
  /** what follows the rows, as kit markup (6e, derived: a council's combiner and "Ask the council" under S19's rows) */ foot?: U<string> }
const entryHTML = (e: MenuEntry): string => e === '-' ? '<div class="k7-menu__sep" role="separator"></div>'
  : 'heading' in e ? '<div class="k7-menu__head" role="presentation">' + esc(e.heading) + '</div>'
  : 'meaning' in e ? optionRow(e) : menuRow(e);
export function menu(o: MenuOpts): string {
  const v = o.variant ?? 'menu';
  const head = v === 'palette' ? '<div class="k7-menu__query"><span class="k7-mono k7-menu__sigil">' + esc(o.query ?? '/') + '</span></div>' : '';
  return '<div class="k7-menu"' + kitAttrs('Menu', { role: 'menu', 'aria-label': o.label, 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' + head +
    '<div class="' + cls('k7-menu__list', scrollClass({ inset: 'both' })) + '">' + o.entries.map(entryHTML).join('') + '</div>' + (o.foot ? '<div class="k7-menu__foot">' + o.foot + '</div>' : '') + '</div>';
}

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

/* ── SectionHead (18): with count, with disclosure; collapsed ── */
export interface SectionHeadOpts { title: string; count?: U<string>; disclosure?: U<boolean>; collapsed?: U<boolean>; value?: U<string>; attrs?: U<Attrs> }
export function sectionHead(o: SectionHeadOpts): string {
  /* a folding head (the inbox's Settled): the chevron at its end, pointing right while it is folded, down when open */
  const inner = '<span class="k7-shead__title">' + esc(o.title) + '</span>' + (o.count ? '<span class="k7-shead__count k7-mono">' + esc(o.count) + '</span>' : '') +
    (o.value ? '<span class="k7-shead__value">' + esc(o.value) + '</span>' : '') + (o.disclosure ? '<span class="k7-grow"></span>' + glyph('chevron', 'k7-shead__chev') : '');
  return o.disclosure
    ? '<h3 class="k7-shead"' + kitAttrs('SectionHead', { 'data-collapsed': o.collapsed ? '' : null, ...(o.attrs ?? {}) }) + '><button class="k7-reset k7-shead__btn" type="button" aria-expanded="' + String(!o.collapsed) + '">' + inner + '</button></h3>'
    : '<h3 class="k7-shead"' + kitAttrs('SectionHead', o.attrs ?? null) + '>' + inner + '</h3>';
}

/* ── Notice (12): one line about the app, up to two actions; above the composer, in a page, floating; four tones ── */
export const NOTICE_PLACES = ['composer', 'page', 'floating'] as const;
export const NOTICE_TONES = ['neutral', 'owe', 'accent', 'red'] as const;
export interface NoticeOpts {
  text: string; place?: U<typeof NOTICE_PLACES[number]>; tone?: U<typeof NOTICE_TONES[number]>; icon?: U<string>;
  /** the words that lead the line, in --text (S17: "Approaching the weekly limit", then ", 81% used, resets Wed 09:00") */ title?: U<string>;
  actions?: U<readonly { label: string; primary?: boolean; ghost?: boolean; value?: string; inert?: string }[]>; dismiss?: U<boolean>; attrs?: U<Attrs>;
}
export function notice(o: NoticeOpts): string {
  const place = o.place ?? 'page', tone = o.tone ?? 'neutral';
  return '<div class="k7-notice"' + kitAttrs('Notice', { role: tone === 'red' ? 'alert' : 'status', 'data-place': place, 'data-tone': tone, 'data-sq': '', 'data-sq-mode': place === 'floating' ? 'surface' : 'frame', ...(o.attrs ?? {}) }) + '>' +
    glyph(o.icon, 'k7-notice__ic') + '<span class="k7-notice__text">' + (o.title ? '<span class="k7-notice__title">' + esc(o.title) + '</span>' : '') + esc(o.text) + '</span>' +
    (o.actions ?? []).slice(0, 2).map((a) => button({ label: a.label, variant: a.primary ? 'primary' : a.ghost ? 'ghost' : 'tint', size: 28, attrs: { 'data-value': a.value ?? null, 'aria-disabled': a.inert ? 'true' : null, 'data-tip': a.inert ?? null } })).join('') +
    (o.dismiss ? '<button class="k7-reset k7-ib" data-kit="IconButton" data-variant="ghost" data-dismiss type="button" aria-label="Dismiss" data-tip="Dismiss">' + glyph('close') + '</button>' : '') + '</div>';
}

/* ── SystemLine (13): a centred line about the thread itself: info (with what it cost at its end, S33), steer, hand-off, error with action ── */
export const SYSTEM_LINE_VARIANTS = ['info', 'steer', 'handoff', 'error'] as const;
export interface SystemLineOpts { variant?: U<typeof SYSTEM_LINE_VARIANTS[number]>; text: string; /** a StatusWord before the words (6e, derived: an escalation the cap stopped, "capped" in amber) */ word?: U<{ text: string; tone?: U<import('./inline').StatusTone> }>; /** what follows the words in mono, at the line's end (board S33: a changed setting's extra cost, "+$0.04") */ meta?: U<string>; icon?: U<string>; from?: U<BotLike>; to?: U<BotLike>; message?: U<string>; action?: U<string>; attrs?: U<Attrs> }
export function systemLine(o: SystemLineOpts): string {
  const v = o.variant ?? 'info';
  const lead = v === 'handoff' ? (o.from ? orbHtml(o.from, { size: 16, still: true }) : '') + glyph('chevron', 'k7-sys__chev') + (o.to ? orbHtml(o.to, { size: 16, still: true }) : '') : glyph(o.icon);
  const pill = '<div class="k7-sys"' + kitAttrs('SystemLine', { role: 'note', 'data-variant': v, 'data-act': o.action ? '' : null, ...(o.attrs ?? {}) }) + '>' + lead +
    (o.word ? statusWord({ text: o.word.text, tone: o.word.tone }) : '') + '<span class="k7-sys__text">' + esc(o.text) + '</span>' + (o.meta ? '<span class="k7-sys__meta k7-mono">' + esc(o.meta) + '</span>' : '') + (o.action ? button({ label: o.action, variant: 'tint', size: 28, attrs: { 'data-line': '' } }) : '') + '</div>';   /* kit.css `.sysline.act .btn`: the tint button (S36) */
  return v === 'steer' && o.message ? '<div class="k7-sys-wrap">' + pill + '<div class="k7-sys__msg">' + esc(o.message) + '</div></div>' : pill;
}

/* ── Bubble (14): user, agent, bot (derived fill in its own chat), with byline in a room, with the you wash ── */
export const BUBBLE_KINDS = ['user', 'agent', 'bot'] as const;
export interface BubbleOpts {
  kind?: U<typeof BUBBLE_KINDS[number]>; text?: U<string>; html?: U<string>;
  /** a bot's own chat: your bubble in the bot's derived fill (18.1), from theme.ts botFill */ fill?: U<{ fill: string; text: string }>;
  /** in a room: the bot's name (12, its colour) above its first bubble and its 20 px orb in the 30 px gutter at the foot */ byline?: U<{ bot: BotLike; colour: string }>;
  /** a session's agent: the model's brand tile in the gutter of the last bubble of a run (S09) */ brand?: U<ModelRef>;
  /** a session's agent bubble that is not the last of its run: in the gutter, without the tile */ gutter?: U<boolean>;
  toYou?: U<boolean>; attrs?: U<Attrs>;
}
export function bubble(o: BubbleOpts): string {
  const k = o.kind ?? 'agent';
  const body = '<div class="k7-bubble"' + kitAttrs('Bubble', {
    'data-kind': k === 'bot' ? 'agent' : k, 'data-to-you': o.toYou ? '' : null, 'data-bot-colour': o.fill ? '' : null,
    style: o.fill ? '--bubble-user:' + o.fill.fill + ';--bubble-user-text:' + o.fill.text : null, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {})
  }) + '>' + (o.html != null ? (/^\s*<(p|div|pre|ul|ol|blockquote)\b/.test(o.html) ? o.html : '<p>' + o.html + '</p>') : o.text != null ? '<p>' + esc(o.text) + '</p>' : '') + '</div>';
  if (o.byline) {
    return '<div class="k7-gutter" data-kit-part="Gutter"><div class="k7-byline" data-bot-colour style="' + botColours(o.byline.colour) + '">' + esc(o.byline.bot.name ?? '') + '</div>' + body +
      '<span class="k7-gutter__orb">' + orbHtml({ ...o.byline.bot, state: 'idle', attention: null }, { size: 20, still: true, mode: 'fixed', surface: '--bg-2' }) + '</span></div>';
  }
  if (o.gutter && !o.brand) return '<div class="k7-gutter" data-kit-part="Gutter">' + body + '</div>';
  if (o.brand) return '<div class="k7-gutter" data-kit-part="Gutter">' + body + '<span class="k7-gutter__orb" data-brand><span class="k7-avatar k7-brand" data-kit="Avatar" data-variant="brand" aria-hidden="true">' + markHTML(o.brand, { size: 14, label: false }) + '</span></span></div>';
  return body;
}

/* ── Well (16): mono text on the deepest surface; code (in a Block or a bubble), terminal (path and branch in its head) ── */
export interface WellOpts { kind?: U<'code' | 'terminal' | 'thread'>; text: string; path?: U<string>; branch?: U<string>; label?: U<string>; attrs?: U<Attrs>;
  /** `thread` (6e, derived): a compact thread in the Well, as kit markup (a handed-off task's transcript); `text` is then unused */ html?: U<string> }
export function well(o: WellOpts): string {
  const k = o.kind ?? 'code';
  if (k === 'thread') return '<div class="k7-well"' + kitAttrs('Well', { 'data-kind': k, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '><div class="' + cls('k7-well__thread', scrollClass({ axis: 'y' })) + '" tabindex="0" role="region"' + attrs({ 'aria-label': o.label ?? 'Transcript' }) + '>' + (o.html ?? '') + '</div></div>';
  const head = k === 'terminal' ? '<div class="k7-well__head">' + glyph('terminal') + '<span class="k7-mono k7-ell">' + esc(o.path ?? '') + '</span>' + (o.branch ? '<span class="k7-mono k7-dim">' + esc(o.branch) + '</span>' : '') + '</div>' : '';
  const lines = k === 'terminal'
    ? o.text.split('\n').map((l) => (l.startsWith('$ ') ? '<span class="k7-well__prompt">$</span> ' + esc(l.slice(2)) : esc(l))).join('\n')
    : esc(o.text);
  return '<div class="k7-well"' + kitAttrs('Well', { 'data-kind': k, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + head +
    '<pre class="' + cls('k7-well__pre', scrollClass({ axis: 'x' })) + '" tabindex="0" role="region"' + attrs({ 'aria-label': o.label ?? (k === 'terminal' ? 'Terminal' : 'Code') }) + '>' + lines + '</pre></div>';
}

/* ── Disclosure (36): steps ("Read 6 files"), work log ("Worked for 59s: ..."): the boards' `.worklog` (kit.css): a chevron that turns down
   when it opens, then the summary ── */
export interface StepOpts {
  text: string; /** `log`: a line of a work log (board S10), led by its kind's glyph (`icon`) in the words' own colour */ state?: U<'done' | 'now' | 'todo' | 'failed' | 'log'>; icon?: U<string>; time?: U<string>;
  /** what became of it, after its words (the kit's StatusWord, red): "failed" */ word?: U<string>;
}
export function steps(items: readonly StepOpts[], id?: string): string {
  return '<ol class="k7-steps"' + partAttrs('Steps', { id }) + '>' + items.map((s) => '<li class="k7-step" data-state="' + (s.state ?? 'done') + '">' +
    '<span class="k7-step__ic" aria-hidden="true">' + (s.icon ? glyph(s.icon) : s.state === 'done' || !s.state ? glyph('check') : s.state === 'failed' ? glyph('close') : '<span class="k7-step__dot"' + (s.state === 'now' ? ' data-live' : '') + '></span>') + '</span>' +
    '<span class="k7-step__text">' + esc(s.text) + '</span>' + (s.word ? statusWord({ text: s.word, tone: 'red' }) : '') + (s.time ? '<span class="k7-step__time k7-mono">' + esc(s.time) + '</span>' : '') + '</li>').join('') + '</ol>';
}
export interface DisclosureOpts {
  summary: string; variant?: U<'steps' | 'worklog'>; open?: U<boolean>; steps?: U<readonly StepOpts[]>; attrs?: U<Attrs>;
  /** what follows its steps when it is open, as markup: a work log's output (a Well), what a list of parts can do (a Button) */ after?: U<string>;
}
export function disclosure(o: DisclosureOpts): string {
  const id = idFrom('k7-dc', o.summary);
  return '<div class="k7-disc"' + kitAttrs('Disclosure', { 'data-variant': o.variant ?? 'steps', 'data-disclose': '', 'data-open': o.open ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    '<button class="k7-reset k7-disc__sum" type="button"' + attrs({ 'aria-expanded': String(!!o.open), 'aria-controls': id }) + '>' + glyph('chevron', 'k7-disc__chev') + '<span class="k7-ell">' + esc(o.summary) + '</span></button>' +
    '<div class="k7-disc__body" id="' + id + '">' + (o.steps?.length || !o.after ? steps(o.steps ?? []) : '') + (o.after ? '<div class="k7-disc__after">' + o.after + '</div>' : '') + '</div></div>';
}

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

/* ── HoverBar: what a turn offers while the pointer or the focus is on it (board 11's `.hoverbar`: copy, more), beside its last bubble
   on that bubble's middle. One part for every thread: a bot's message, a room's member, a session's answer. Each action is a ghost
   IconButton carrying `data-act`; a press fires `ui:act` {value, el} on the bar (wire.ts) ── */
export interface HoverAction { value: string; icon: string; /** its accessible name ("Copy kai's message") */ label: string; /** the tip, when shorter than the name ("Copy") */ tip?: U<string>; keys?: U<string>; /** it opens a menu */ menu?: U<boolean> }
export interface HoverBarOpts { /** the group's name ("Actions on kai's message") */ label: string; actions: readonly HoverAction[]; attrs?: U<Attrs> }
export function hoverBar(o: HoverBarOpts): string {
  return '<div class="k7-hoverbar"' + kitAttrs('HoverBar', { role: 'group', 'aria-label': o.label, ...(o.attrs ?? {}) }) + '>' +
    o.actions.map((a) => iconButton({ icon: a.icon, label: a.label, tip: a.tip ?? a.label, variant: 'ghost', keys: a.keys, haspopup: a.menu ? 'menu' : undefined, attrs: { 'data-act': a.value } })).join('') + '</div>';
}
/** stand a HoverBar beside `bubble`, on its middle: the two share a row (the boards' `.row` of a bubble and its `.hoverbar`). A bar that
    stood beside another bubble leaves that one as it was (a turn's later bubble takes the bar) */
export function hoverBeside(bar: HTMLElement, bubble: HTMLElement): void {
  const old = bar.parentElement?.classList.contains('k7-hoverrow') ? bar.parentElement : null;
  if (old && old.contains(bubble)) return;
  bar.remove();
  if (old) { const was = old.firstElementChild; if (was) old.replaceWith(was); else old.remove(); }
  const row = document.createElement('div');
  row.className = 'k7-hoverrow';
  bubble.replaceWith(row);
  row.append(bubble, bar);
}

/* ── FindBar (6e, derived: find in a conversation): a small floating bar at the conversation's top right: the kit's search Field, how
   many matched ("3 of 12", or "No matches" in quiet words), previous and next, and esc that closes it. What it finds and marks is the
   app's (`ui:find` {query, dir} on the bar; `ui:find-close`) ── */
export interface FindBarOpts { id: string; label?: U<string>; value?: U<string>; /** "3 of 12"; '' says nothing; "No matches" is quiet */ count?: U<string>; attrs?: U<Attrs> }
export function findBar(o: FindBarOpts): string {
  const none = o.count === 'No matches';
  return '<div class="k7-find"' + kitAttrs('FindBar', { role: 'search', 'aria-label': o.label ?? 'Find in this conversation', 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' +
    '<span class="k7-field__box k7-find__box" data-kind="search">' + glyph('search', 'k7-field__glyph') + '<input class="k7-field__input" type="search" id="' + esc(o.id) + '"' + attrs({ value: o.value, placeholder: 'Find', 'aria-label': o.label ?? 'Find in this conversation', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': o.id + '-count' }) + '></span>' +
    '<span class="k7-find__count k7-mono" id="' + esc(o.id) + '-count" role="status" aria-live="polite"' + attrs({ 'data-none': none ? '' : null }) + '>' + esc(o.count ?? '') + '</span>' +
    iconButton({ icon: 'chevron-up', label: 'Previous match', tip: 'Previous', variant: 'ghost', keys: 'shift+Enter', attrs: { 'data-find': 'prev' } }) +
    iconButton({ icon: 'chevron-down', label: 'Next match', tip: 'Next', variant: 'ghost', keys: 'Enter', attrs: { 'data-find': 'next' } }) +
    iconButton({ icon: 'close', label: 'Close find', tip: 'Close', variant: 'ghost', keys: 'esc', attrs: { 'data-find': 'close' } }) + '</div>';
}

/* ── TimeSeparator (38): only after a gap; "NEW" in the accent ── */
export interface TimeSeparatorOpts { text: string; unread?: U<boolean> }
export function timeSeparator(o: TimeSeparatorOpts): string {
  return '<div class="k7-time"' + kitAttrs('TimeSeparator', { role: 'separator', 'aria-label': o.text, 'data-unread': o.unread ? '' : null }) + '><span>' + esc(o.text) + '</span></div>';
}

/* ── EmptyState: one line (at most 80 characters) and at most one action, where the content would be. In a list (`place: 'list'`,
   board S41's "No sessions yet") the line starts where the list's rows and heads start their words ── */
export interface EmptyStateOpts { text: string; action?: U<string>; place?: U<'list'> }
export function emptyState(o: EmptyStateOpts): string {
  return '<div class="k7-empty"' + kitAttrs('EmptyState', { 'data-place': o.place ?? null }) + '><p class="k7-empty__text">' + esc(o.text) + '</p>' + (o.action ? button({ label: o.action, variant: 'secondary', size: 32 }) : '') + '</div>';
}

export { statusWord };
