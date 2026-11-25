/* The v7 kit's blocks (DESIGN-SYSTEM.md v7 12.2 and 21.2): Card (and its Row), Block, Menu, MenuRow, OptionRow, ListRow,
   SectionHead, Notice, SystemLine, Bubble, Well, Disclosure, TurnFoot, TimeSeparator, EmptyState. */
import type { BotLike } from '../bot-state';
import { markHTML } from '../model-mark';
import type { ModelRef } from '../model-mark';
import { orbHtml } from '../orb';
import { scrollClass } from '../scroll';
import { kbd, button } from './controls';
import { badge, botColours, inkOrb, statusWord } from './inline';
import { attrs, cls, esc, glyph, idFrom, kitAttrs, partAttrs, textOr } from './util';
import type { Attrs, U } from './util';

/* ── Card (6): the settings card of Rows; settings, pane card, danger zone (collapsed) ── */
export const CARD_VARIANTS = ['settings', 'pane', 'danger'] as const;
export type CardVariant = typeof CARD_VARIANTS[number];
export interface RowOpts {
  label: string; labelHTML?: U<string>; value?: U<string>; mono?: U<boolean>; control?: U<string>;
  /** a label that explains itself: the mark (17.1), revealed on the row's hover or focus */ explain?: U<string>; id?: U<string>; attrs?: U<Attrs>;
}
export function row(o: RowOpts): string {
  const label = o.explain
    ? '<span class="k7-row__label">' + '<button class="k7-reset k7-mark k7-info" type="button" data-kit="Mark" data-mark-kind="info" aria-haspopup="dialog"' + attrs({ 'data-explain': o.explain, id: o.id }) + '>' + esc(o.label) + '<span class="k7-mark__i" aria-hidden="true">' + glyph('info') + '</span></button></span>'
    : '<span class="k7-row__label"' + attrs({ id: o.id }) + '>' + textOr(o.label, o.labelHTML) + '</span>';
  return '<div class="k7-row"' + partAttrs('Row', { 'data-mark-reveal': o.explain ? 'hover' : null, ...(o.attrs ?? {}) }) + '>' + label +
    (o.value ? '<span class="' + cls('k7-row__value', o.mono && 'k7-mono') + '">' + esc(o.value) + '</span>' : '') + (o.control ?? '') + '</div>';
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
export interface BlockOpts { body: string; attrs?: U<Attrs> }
export function block(o: BlockOpts): string {
  return '<div class="k7-block"' + kitAttrs('Block', { 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + o.body + '</div>';
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

/* ── OptionRow (20): a two-line radio row (a permission step, an import pick) ── */
export interface OptionRowOpts {
  label: string; meaning: string; chosen?: U<boolean>; value?: U<string>; ticks?: U<{ of: number; on: number }>;
  /** a choice that cannot be made now: it stays in its place, and its second line says why (`meaning` carries the reason) */
  disabled?: U<boolean>; attrs?: U<Attrs>;
}
export function optionRow(o: OptionRowOpts): string {
  return '<button class="k7-reset k7-orow"' + kitAttrs('OptionRow', { type: 'button', role: 'menuitemradio', tabindex: '-1', 'aria-checked': String(!!o.chosen), 'aria-disabled': o.disabled ? 'true' : null, 'data-value': o.value ?? o.label, ...(o.attrs ?? {}) }) + '>' +
    '<span class="k7-orow__ring" aria-hidden="true"></span><span class="k7-orow__text"><span class="k7-orow__name">' + esc(o.label) +
    (o.ticks ? '<span class="k7-ticks" aria-hidden="true">' + Array.from({ length: o.ticks.of }, (_, i) => '<i' + (i < (o.ticks?.on ?? 0) ? ' data-on' : '') + '></i>').join('') + '</span>' : '') +
    '</span><span class="k7-orow__meaning">' + esc(o.meaning) + '</span></span></button>';
}

/* ── Menu (5): menu, quick menu (checks), palette (/ @ $), snooze, split-button menu, option menu (four rows) ── */
export const MENU_VARIANTS = ['menu', 'quick', 'palette', 'snooze', 'split', 'options'] as const;
export type MenuVariant = typeof MENU_VARIANTS[number];
export type MenuEntry = MenuRowOpts | OptionRowOpts | '-' | { heading: string };
export interface MenuOpts { label: string; entries: readonly MenuEntry[]; variant?: U<MenuVariant>; query?: U<string>; attrs?: U<Attrs> }
const entryHTML = (e: MenuEntry): string => e === '-' ? '<div class="k7-menu__sep" role="separator"></div>'
  : 'heading' in e ? '<div class="k7-menu__head" role="presentation">' + esc(e.heading) + '</div>'
  : 'meaning' in e ? optionRow(e) : menuRow(e);
export function menu(o: MenuOpts): string {
  const v = o.variant ?? 'menu';
  const head = v === 'palette' ? '<div class="k7-menu__query"><span class="k7-mono k7-menu__sigil">' + esc(o.query ?? '/') + '</span></div>' : '';
  return '<div class="k7-menu"' + kitAttrs('Menu', { role: 'menu', 'aria-label': o.label, 'data-variant': v, 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' + head +
    '<div class="' + cls('k7-menu__list', scrollClass({ inset: 'both' })) + '">' + o.entries.map(entryHTML).join('') + '</div></div>';
}

/* ── ListRow (17): session (44, two lines), bot (54, orb 36), item (60, a 40 mark, the action a 28 pill), compact (36, one line) ── */
export const LIST_ROW_VARIANTS = ['session', 'bot', 'item', 'compact'] as const;
export type ListRowVariant = typeof LIST_ROW_VARIANTS[number];
export interface ListRowOpts {
  variant?: U<ListRowVariant>; title: string; sub?: U<string>; bot?: U<BotLike>; markText?: U<string>; markHTML?: U<string>; action?: U<string>;
  current?: U<boolean>; needs?: U<boolean | string>; working?: U<boolean>; count?: U<string>; time?: U<string>; /** the boopis bot, in ink */ ink?: U<boolean>;
  /** a bot row's lead in place of one orb: a room's member stack (OrbStack, 24 in rows; screen 12) */ leadHTML?: U<string>; /** the end slot's own words (a bot made outside boopis) */ endHTML?: U<string>; attrs?: U<Attrs>;
}
export function listRow(o: ListRowOpts): string {
  const v = o.variant ?? 'session';
  const needsWords = typeof o.needs === 'string' ? o.needs : null;
  const sub = needsWords ? '<span class="k7-lrow__sub" data-tone="owe">' + esc(needsWords) + '</span>' : o.sub ? '<span class="k7-lrow__sub">' + esc(o.sub) + '</span>' : '';
  const lead = v === 'bot' ? (o.leadHTML ?? ((h: string) => (o.ink ? inkOrb(h) : h))(orbHtml(o.bot ?? { name: o.title }, { size: 36, rest: true, flag: !!o.needs, state: o.bot?.state && o.bot.state !== 'idle' ? undefined : o.needs ? 'needs' : o.working ? 'working' : undefined })   /* the bot's own state when it says one (compute, replying...), else the row's flags */))
    : v === 'item' ? '<span class="k7-lrow__mark" aria-hidden="true">' + (o.markHTML ?? esc(o.markText ?? o.title.slice(0, 2))) + '</span>'
    : o.working ? '<span class="k7-dot" data-pulse data-live aria-hidden="true"></span>' : '';
  const end = (o.endHTML ?? '') + (o.needs && v !== 'bot' ? badge({ text: o.count ?? 'needs you', tone: 'owe' }) : o.count ? badge({ text: o.count }) : '') +
    (o.time ? '<span class="k7-lrow__time k7-mono">' + esc(o.time) + '</span>' : '') + (v === 'item' && o.action ? button({ label: o.action, variant: 'tint', size: 28 }) : '');
  const text = v === 'compact'
    ? '<span class="k7-lrow__one"><span class="k7-lrow__title">' + esc(o.title) + '</span>' + (o.sub ? '<span class="k7-lrow__sub">' + esc(o.sub) + '</span>' : '') + '</span>'
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
  const inner = '<span class="k7-shead__title">' + esc(o.title) + '</span>' + (o.count ? '<span class="k7-shead__count k7-mono">' + esc(o.count) + '</span>' : '') +
    (o.value ? '<span class="k7-shead__value">' + esc(o.value) + '</span>' : '') + (o.disclosure ? glyph('chevron-down', 'k7-chev') : '');
  return o.disclosure
    ? '<h3 class="k7-shead"' + kitAttrs('SectionHead', { 'data-collapsed': o.collapsed ? '' : null, ...(o.attrs ?? {}) }) + '><button class="k7-reset k7-shead__btn" type="button" aria-expanded="' + String(!o.collapsed) + '">' + inner + '</button></h3>'
    : '<h3 class="k7-shead"' + kitAttrs('SectionHead', o.attrs ?? null) + '>' + inner + '</h3>';
}

/* ── Notice (12): one line about the app, up to two actions; above the composer, in a page, floating; four tones ── */
export const NOTICE_PLACES = ['composer', 'page', 'floating'] as const;
export const NOTICE_TONES = ['neutral', 'owe', 'accent', 'red'] as const;
export interface NoticeOpts {
  text: string; place?: U<typeof NOTICE_PLACES[number]>; tone?: U<typeof NOTICE_TONES[number]>; icon?: U<string>;
  actions?: U<readonly { label: string; primary?: boolean }[]>; dismiss?: U<boolean>; attrs?: U<Attrs>;
}
export function notice(o: NoticeOpts): string {
  const place = o.place ?? 'page', tone = o.tone ?? 'neutral';
  return '<div class="k7-notice"' + kitAttrs('Notice', { role: tone === 'red' ? 'alert' : 'status', 'data-place': place, 'data-tone': tone, 'data-sq': '', 'data-sq-mode': place === 'floating' ? 'surface' : 'frame', ...(o.attrs ?? {}) }) + '>' +
    glyph(o.icon, 'k7-notice__ic') + '<span class="k7-notice__text">' + esc(o.text) + '</span>' +
    (o.actions ?? []).slice(0, 2).map((a) => button({ label: a.label, variant: a.primary ? 'primary' : 'tint', size: 28 })).join('') +
    (o.dismiss ? '<button class="k7-reset k7-ib" data-kit="IconButton" data-variant="ghost" type="button" aria-label="Dismiss" data-tip="Dismiss">' + glyph('close') + '</button>' : '') + '</div>';
}

/* ── SystemLine (13): a centred line about the thread itself: info, steer, hand-off, error with action ── */
export const SYSTEM_LINE_VARIANTS = ['info', 'steer', 'handoff', 'error'] as const;
export interface SystemLineOpts { variant?: U<typeof SYSTEM_LINE_VARIANTS[number]>; text: string; icon?: U<string>; from?: U<BotLike>; to?: U<BotLike>; message?: U<string>; action?: U<string>; attrs?: U<Attrs> }
export function systemLine(o: SystemLineOpts): string {
  const v = o.variant ?? 'info';
  const lead = v === 'handoff' ? (o.from ? orbHtml(o.from, { size: 16, still: true }) : '') + glyph('chevron', 'k7-sys__chev') + (o.to ? orbHtml(o.to, { size: 16, still: true }) : '') : glyph(o.icon);
  const pill = '<div class="k7-sys"' + kitAttrs('SystemLine', { role: 'note', 'data-variant': v, 'data-act': o.action ? '' : null, ...(o.attrs ?? {}) }) + '>' + lead +
    '<span class="k7-sys__text">' + esc(o.text) + '</span>' + (o.action ? button({ label: o.action, variant: 'secondary', size: 28, attrs: { 'data-line': '' } }) : '') + '</div>';
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
      '<span class="k7-gutter__orb">' + orbHtml(o.byline.bot, { size: 20, still: true }) + '</span></div>';
  }
  if (o.gutter && !o.brand) return '<div class="k7-gutter" data-kit-part="Gutter">' + body + '</div>';
  if (o.brand) return '<div class="k7-gutter" data-kit-part="Gutter">' + body + '<span class="k7-gutter__orb"><span class="k7-avatar k7-brand" data-kit="Avatar" data-variant="brand" aria-hidden="true">' + markHTML(o.brand, { size: 14, label: false }) + '</span></span></div>';
  return body;
}

/* ── Well (16): mono text on the deepest surface; code (in a Block or a bubble), terminal (path and branch in its head) ── */
export interface WellOpts { kind?: U<'code' | 'terminal'>; text: string; path?: U<string>; branch?: U<string>; label?: U<string>; attrs?: U<Attrs> }
export function well(o: WellOpts): string {
  const k = o.kind ?? 'code';
  const head = k === 'terminal' ? '<div class="k7-well__head">' + glyph('terminal') + '<span class="k7-mono k7-ell">' + esc(o.path ?? '') + '</span>' + (o.branch ? '<span class="k7-mono k7-dim">' + esc(o.branch) + '</span>' : '') + '</div>' : '';
  const lines = k === 'terminal'
    ? o.text.split('\n').map((l) => (l.startsWith('$ ') ? '<span class="k7-well__prompt">$</span> ' + esc(l.slice(2)) : esc(l))).join('\n')
    : esc(o.text);
  return '<div class="k7-well"' + kitAttrs('Well', { 'data-kind': k, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' + head +
    '<pre class="' + cls('k7-well__pre', scrollClass({ axis: 'x' })) + '" tabindex="0" role="region"' + attrs({ 'aria-label': o.label ?? (k === 'terminal' ? 'Terminal' : 'Code') }) + '>' + lines + '</pre></div>';
}

/* ── Disclosure (36): steps ("Read 6 files"), work log ("Worked for 59s: ...") ── */
export interface StepOpts { text: string; state?: U<'done' | 'now' | 'todo' | 'failed'>; icon?: U<string>; time?: U<string> }
export function steps(items: readonly StepOpts[], id?: string): string {
  return '<ol class="k7-steps"' + partAttrs('Steps', { id }) + '>' + items.map((s) => '<li class="k7-step" data-state="' + (s.state ?? 'done') + '">' +
    '<span class="k7-step__ic" aria-hidden="true">' + glyph(s.icon ?? (s.state === 'done' || !s.state ? 'check' : s.state === 'failed' ? 'close' : 'play')) + '</span>' +
    '<span class="k7-step__text">' + esc(s.text) + '</span>' + (s.time ? '<span class="k7-step__time k7-mono">' + esc(s.time) + '</span>' : '') + '</li>').join('') + '</ol>';
}
export interface DisclosureOpts { summary: string; variant?: U<'steps' | 'worklog'>; open?: U<boolean>; steps?: U<readonly StepOpts[]>; attrs?: U<Attrs> }
export function disclosure(o: DisclosureOpts): string {
  const id = idFrom('k7-dc', o.summary);
  return '<div class="k7-disc"' + kitAttrs('Disclosure', { 'data-variant': o.variant ?? 'steps', 'data-disclose': '', 'data-open': o.open ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    '<button class="k7-reset k7-disc__sum" type="button"' + attrs({ 'aria-expanded': String(!!o.open), 'aria-controls': id }) + '><span class="k7-ell">' + esc(o.summary) + '</span>' + glyph('chevron-down', 'k7-chev') + '</button>' +
    '<div class="k7-disc__body" id="' + id + '">' + steps(o.steps ?? []) + '</div></div>';
}

/* ── TurnFoot (37): under a finished reply: model, time, cost; a session's Undo, Edit from here, Fork on hover ── */
export interface TurnFootAction { label: string; value: string; disabled?: U<boolean>; tip?: U<string> }
export interface TurnFootOpts {
  kind?: U<'bot' | 'session'>; model?: U<ModelRef>; modelName?: U<string>; time?: U<string>; cost?: U<string>;
  /** a session's actions (default Undo, Edit from here, Fork); each button carries `data-value` */ actions?: U<readonly TurnFootAction[]>; attrs?: U<Attrs>;
}
export function turnFoot(o: TurnFootOpts): string {
  const k = o.kind ?? 'bot';
  const meta = (o.model ? '<span class="k7-foot__model">' + markHTML(o.model, { size: 14, label: false }) + esc(o.modelName ?? '') + '</span>' : '') +
    (o.time ? '<span class="k7-mono">' + esc(o.time) + '</span>' : '') + (o.cost ? '<span class="k7-mono">' + esc(o.cost) + '</span>' : '');
  const list: readonly TurnFootAction[] = o.actions ?? ['Undo', 'Edit from here', 'Fork'].map((l) => ({ label: l, value: l }));
  const acts = k === 'session' ? '<span class="k7-foot__acts">' + list.map((x) => '<button class="k7-reset k7-foot__btn" type="button"' + attrs({ 'data-value': x.value, disabled: !!x.disabled, 'data-tip': x.tip }) + '>' + esc(x.label) + '</button>').join('') + '</span>' : '';
  return '<div class="k7-foot"' + kitAttrs('TurnFoot', { 'data-kind': k, ...(o.attrs ?? {}) }) + '>' + meta + acts + '</div>';
}

/* ── TimeSeparator (38): only after a gap; "NEW" in the accent ── */
export interface TimeSeparatorOpts { text: string; unread?: U<boolean> }
export function timeSeparator(o: TimeSeparatorOpts): string {
  return '<div class="k7-time"' + kitAttrs('TimeSeparator', { role: 'separator', 'aria-label': o.text, 'data-unread': o.unread ? '' : null }) + '><span>' + esc(o.text) + '</span></div>';
}

/* ── EmptyState: one line (at most 80 characters) and at most one action, where the content would be ── */
export interface EmptyStateOpts { text: string; action?: U<string> }
export function emptyState(o: EmptyStateOpts): string {
  return '<div class="k7-empty"' + kitAttrs('EmptyState') + '><p class="k7-empty__text">' + esc(o.text) + '</p>' + (o.action ? button({ label: o.action, variant: 'secondary', size: 32 }) : '') + '</div>';
}

export { statusWord };
