/* The v7 kit's surfaces (DESIGN-SYSTEM.md v7 7, 12.1 and 21.2 rows 1 to 4, 40 and 42): WindowChrome, Page, Pane, Dialog, Rail,
   Notch. The Dock is dock.ts. */
import type { BotLike } from '../bot-state';
import { orbHtml } from '../orb';
import { stack } from '../stack';
import { slabPath } from '../squircle-path';
import { button, iconButton, kbd, segmented } from './controls';
import type { SegItem } from './controls';
import { emptyState, sectionHead } from './blocks';
import { inkOrb, statusLine } from './inline';
import { composer } from './thread';
import { attrs, cls, esc, glyph, kitAttrs, partAttrs } from './util';
import type { Attrs, U } from './util';

/* ── WindowChrome (1): no bar; a 56 px drag region; floating controls at y = 10: the sidebar toggle over the rail, the title pill
   centred on the column, the search hint (S5, the default; or the button S1, or the pill S2), the details button, thin window glyphs ── */
export const CHROME_RAILS = ['a', 'b'] as const;
export const SEARCH_SHOWS = ['hint', 'button', 'pill', 'off'] as const;
export interface ChromeOpts {
  rail?: U<typeof CHROME_RAILS[number]>; title: string; bot?: U<BotLike>; running?: U<string>; search?: U<typeof SEARCH_SHOWS[number]>;
  /** the window's buttons (the shell's controller decides which show, host/window-controls.ts); off on a tiling desktop */ windowControls?: U<boolean>; attrs?: U<Attrs>;
}
export function titlePill(o: { title: string; bot?: U<BotLike>; running?: U<string> }): string {
  return '<button class="k7-reset k7-title"' + partAttrs('TitlePill', { type: 'button', 'aria-haspopup': 'dialog', 'aria-description': 'Opens the details', 'data-running': o.running ? '' : null }) + '>' +
    (o.bot ? orbHtml(o.bot, { size: 24, live: !!o.running, state: o.running ? 'working' : undefined }) : '') + '<span class="k7-title__name">' + esc(o.title) + '</span>' +
    (o.running ? statusLine({ kind: 'system', phrase: o.running, inPill: true }) : '') + '</button>';
}
export function searchHint(o: { shows?: U<typeof SEARCH_SHOWS[number]> }): string {
  const s = o.shows ?? 'hint';
  if (s === 'off') return '';
  if (s === 'button') return iconButton({ icon: 'search', label: 'Search', keys: 'mod+K' });
  if (s === 'pill') return '<button class="k7-reset k7-search-pill" type="button" aria-label="Search, ' + esc(kbdLabel()) + '">' + glyph('search') + '<span class="k7-grow">Search</span> ' + kbd({ keys: 'mod+K', inPill: true }) + '</button>';
  /* S5: the word and the key chips, no fill at rest; a 28 pill at --hover on hover and focus; its name contains its visible text */
  return '<button class="k7-reset k7-search-hint" type="button" aria-label="Search, ' + esc(kbdLabel()) + '" aria-keyshortcuts="Control+K">Search ' + kbd({ keys: 'mod+K' }) + '</button>';
}
const kbdLabel = (): string => (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'ctrl K');
export function windowChrome(o: ChromeOpts): string {
  return '<div class="k7-chrome"' + kitAttrs('WindowChrome', { 'data-rail': o.rail ?? 'a', role: 'toolbar', 'aria-label': 'Window', ...(o.attrs ?? {}) }) + '>' +
    '<div class="k7-chrome__start">' + iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B' }) + '</div>' +
    '<div class="k7-chrome__centre">' + titlePill(o) + '</div>' +
    '<div class="k7-chrome__end">' + searchHint({ shows: o.search }) + iconButton({ icon: 'sidebar-right', label: 'Details', keys: 'mod+.' }) +
    (o.windowControls === false ? '' : '<span class="k7-chrome__wc">' + iconButton({ icon: 'minimize', label: 'Minimize', variant: 'ghost' }) + iconButton({ icon: 'maximize', label: 'Maximize', variant: 'ghost' }) + iconButton({ icon: 'close', label: 'Close window', variant: 'ghost' }) + '</span>') +
    '</div></div>';
}

/* ── Page (2): the ground and its 640 column, or a settings page (its head: the title and a Segmented scope) ── */
export interface PageOpts { variant?: U<'column' | 'settings'>; title?: U<string>; scope?: U<{ items: readonly SegItem[]; value: string }>; body?: U<string>; empty?: U<{ text: string; action?: string }>; attrs?: U<Attrs> }
export function page(o: PageOpts): string {
  const v = o.variant ?? 'column';
  const body = o.empty ? emptyState(o.empty) : (o.body ?? '');
  if (v === 'settings') {
    return '<section class="k7-page"' + kitAttrs('Page', { 'data-variant': 'settings', 'aria-label': o.title, ...(o.attrs ?? {}) }) + '><header class="k7-page__head"><h2 class="k7-page__title">' + esc(o.title ?? '') + '</h2>' +
      (o.scope ? segmented({ label: 'Scope', items: o.scope.items, value: o.scope.value, variant: 'head' }) : '') + '</header><div class="k7-page__body">' + body + '</div></section>';
  }
  return '<main class="k7-page"' + kitAttrs('Page', { 'data-variant': 'column', ...(o.attrs ?? {}) }) + '><div class="k7-page__column k7-thread" data-kit-part="Thread">' + body + '</div></main>';
}
/** a settings section: its heading (4 in from its card) and its card */
export const section = (title: string, cardHTML: string, count?: string): string => '<div class="k7-section">' + sectionHead({ title, ...(count ? { count } : {}) }) + cardHTML + '</div>';

/* ── Pane (3): details (356) or tools (520, resizable: Diff, Files, Terminal, PR, + Side chat); open, closed, overlay under 900 ── */
export interface PaneOpts {
  variant?: U<'details' | 'tools'>; open?: U<boolean>; overlay?: U<boolean>; title?: U<string>; bot?: U<BotLike>; tab?: U<string>; sideChat?: U<boolean>;
  body?: U<string>; label?: U<string>; attrs?: U<Attrs>;
}
export function pane(o: PaneOpts): string {
  const v = o.variant ?? 'details';
  const a = kitAttrs('Pane', { 'data-variant': v, 'data-open': o.open === false ? null : '', 'data-overlay': o.overlay ? '' : null, role: 'complementary', 'aria-label': o.label ?? (v === 'tools' ? 'Tools' : 'Details'), ...(o.attrs ?? {}) });
  if (v === 'tools') {
    const tabs: SegItem[] = [{ value: 'diff', label: 'Diff' }, { value: 'files', label: 'Files' }, { value: 'terminal', label: 'Terminal' }, { value: 'pr', label: 'PR' }, ...(o.sideChat ? [{ value: 'chat', label: 'Side chat' }] : [])];
    return '<aside class="k7-pane"' + a + '><div class="k7-pane__grip" role="separator" aria-orientation="vertical" aria-label="Resize the tools" tabindex="0" aria-valuenow="520" aria-valuemin="356" aria-valuemax="900"></div>' +
      '<div class="k7-pane__tabs">' + segmented({ label: 'Tools', items: tabs, value: o.tab ?? 'diff', variant: 'tabs' }) + '<span class="k7-grow"></span>' + iconButton({ icon: 'close', label: 'Close the tools', variant: 'tinted' }) + '</div>' +
      '<div class="k7-pane__body">' + (o.body ?? '') + '</div></aside>';
  }
  return '<aside class="k7-pane"' + a + '><div class="k7-pane__head">' + (o.bot ? orbHtml(o.bot, { size: 64 }) : '') + '<h2 class="k7-pane__name">' + esc(o.title ?? '') + '</h2>' +
    segmented({ label: 'Details', items: [{ value: 'activity', label: 'Activity' }, { value: 'library', label: 'Library' }], value: o.tab ?? 'activity' }) + '</div>' +
    '<div class="k7-pane__body">' + (o.body ?? '') + '</div>' + iconButton({ icon: 'more', label: 'More', variant: 'tinted', haspopup: 'menu', attrs: { 'data-pane-more': '' } }) + '</aside>';
}

/* ── Dialog (4): large (Settings: 900, a 220 nav) or form (440 to 520: commit, import, new bot, confirm); enter 200 ms, the scrim,
   close 28 at 10 in (a capsule) ── */
export interface DialogOpts {
  variant?: U<'large' | 'form'>; title: string; body: string; nav?: U<readonly { label: string; icon?: string; current?: boolean }[]>;
  actions?: U<readonly { label: string; variant?: 'primary' | 'ghost' | 'danger' | 'split' }[]>; scrim?: U<boolean>; id?: U<string>; attrs?: U<Attrs>;
}
export function dialog(o: DialogOpts): string {
  const v = o.variant ?? 'form', id = o.id ?? 'k7-dlg-' + o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const close = iconButton({ icon: 'close', label: 'Close', variant: 'tinted', keys: 'esc', attrs: { 'data-dialog-close': '' } });
  const inner = v === 'large'
    ? '<nav class="k7-dialog__nav" aria-label="' + esc(o.title) + '">' + (o.nav ?? []).map((n) => '<button class="k7-reset k7-dialog__navrow" type="button"' + attrs({ 'aria-current': n.current ? 'page' : null }) + '>' + glyph(n.icon) + '<span class="k7-ell">' + esc(n.label) + '</span></button>').join('') + '</nav>' +
      '<div class="k7-dialog__page">' + o.body + '</div>'
    : '<h2 class="k7-dialog__title" id="' + esc(id) + '-t">' + esc(o.title) + '</h2><div class="k7-dialog__body">' + o.body + '</div>' +
      ((o.actions ?? []).length ? '<div class="k7-dialog__foot">' + (o.actions ?? []).map((x) => button({ label: x.label, variant: x.variant ?? 'secondary', size: 32, menuLabel: x.label + ' options' })).join('') + '</div>' : '');
  const dlg = '<div class="k7-dialog"' + kitAttrs('Dialog', { role: 'dialog', 'aria-modal': 'true', 'data-variant': v, id, 'aria-labelledby': v === 'form' ? id + '-t' : null, 'aria-label': v === 'large' ? o.title : null, 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' + inner + close + '</div>';
  return o.scrim === false ? dlg : '<div class="k7-scrim" data-layer-host>' + dlg + '</div>';
}

/* ── Rail (40): the bots' tiles; A 54 on 88, B 44 on 64 (automatic under 1200 px); current, needs you, working ── */
export interface RailBot extends BotLike { current?: boolean; needs?: boolean; working?: boolean; /** the boopis bot, in ink */ ink?: boolean }
export interface RailOpts { size?: U<'a' | 'b'>; bots: readonly RailBot[]; groups?: U<readonly { name: string; members: readonly BotLike[] }[]>; attrs?: U<Attrs> }
export function rail(o: RailOpts): string {
  const b = o.size === 'b', orb = b ? 28 : 36;
  const tile = (x: RailBot): string => '<button class="k7-reset k7-tile"' + attrs({ type: 'button', 'aria-label': (x.name ?? '') + (x.needs ? ', needs you' : x.working ? ', working' : ''), 'aria-current': x.current ? 'page' : null, 'data-tip': x.name, 'data-tip-pos': 'right', 'data-needs': x.needs ? '' : null }) + '>' +
    ((h: string) => (x.ink ? inkOrb(h) : h))(orbHtml(x, { size: orb, rest: true, state: x.needs ? 'needs' : x.working ? 'working' : undefined })) + (x.needs ? '<span class="k7-flag" aria-hidden="true"></span>' : '') + '</button>';
  /* a group is the v6 cluster (owner decision, 23 November; a keep-list item in v7), its orbs at 0.42 of the tile's orb as the approved
     boards draw it (ds-v7 screens.js: 15 on the standard rail, 12 on the compact one) */
  const groups = (o.groups ?? []).map((g) => '<button class="k7-reset k7-tile" type="button"' + attrs({ 'aria-label': g.name + ': ' + g.members.map((m) => m.name).join(', '), 'data-tip': g.name, 'data-tip-pos': 'right' }) + '>' + stack({ members: g.members, size: Math.round(orb * 0.42), shape: 'cluster', still: true, tip: false }) + '</button>').join('');
  return '<nav class="k7-rail"' + kitAttrs('Rail', { 'data-size': b ? 'b' : 'a', 'aria-label': 'Bots', ...(o.attrs ?? {}) }) + '>' + o.bots.map(tile).join('') +
    (groups ? '<hr class="k7-rail__rule">' + groups : '') + '<span class="k7-grow"></span><div class="k7-rail__foot">' +
    iconButton({ icon: 'plus', label: 'New bot', variant: 'ghost' }) + iconButton({ icon: 'store', label: 'Store', variant: 'ghost' }) + iconButton({ icon: 'gear', label: 'Settings', variant: 'ghost' }) + '</div></nav>';
}

/* ── Notch (42): the notch's own surface. The notch spec is not in this repository (an owner question); what the kit can draw from
   section 8.2: the slab's black shape (--r-slab 30, flush to the top), its composer on a 12 inset, radius 18 = 30 - 12 ── */
export interface NotchOpts { width?: U<number>; placeholder?: U<string>; attrs?: U<Attrs> }
export function notch(o: NotchOpts = {}): string {
  const w = o.width ?? 420, h = 60, F = 30;
  const path = slabPath(w, h, 30, F);
  return '<div class="k7-notch"' + kitAttrs('Notch', { style: '--w:' + w + 'px', ...(o.attrs ?? {}) }) + '>' +
    '<svg class="k7-notch__slab" viewBox="0 0 ' + (w + 2 * F) + ' ' + h + '" width="' + (w + 2 * F) + '" height="' + h + '" aria-hidden="true"><path d="' + path + '" transform="matrix(1 0 0 -1 0 ' + h + ')"/></svg>' +
    '<div class="k7-notch__in" data-theme="dark">' + composer({ kind: 'notch', ...(o.placeholder ? { placeholder: o.placeholder } : {}) }) + '</div></div>';
}

export { cls };
