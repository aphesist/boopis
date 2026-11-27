/* WindowChrome: its view (typed props to markup) and its contract. Its look is window-chrome.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { orbHtml } from '../../orb';
import { kitStack } from '../avatar/avatar';
import { iconButton } from '../icon-button/icon-button';
import { kbd, keyNames } from '../kbd/kbd';
import { statusLine } from '../status-line/status-line';
import { attrs, esc, glyph, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── WindowChrome (1): no bar; a 56 px drag region; floating controls at y = 10: the sidebar toggle over the rail, the title pill
   centred on the column, the search hint (S5, the default; or the button S1, or the pill S2), the details button, thin window glyphs ── */
export const CHROME_RAILS = ['a', 'b'] as const;
export const SEARCH_SHOWS = ['hint', 'button', 'pill', 'off'] as const;
export interface ChromeOpts {
  rail?: U<typeof CHROME_RAILS[number]>; title: string; bot?: U<BotLike>; running?: U<string>; search?: U<typeof SEARCH_SHOWS[number]>;
  /** the window's buttons (the shell's controller decides which show, host/window-controls.ts); off on a tiling desktop */ windowControls?: U<boolean>; attrs?: U<Attrs>;
  /** a room's title: its members' stack (24, a third's overlap) in place of the orb (screen 12) */ members?: U<readonly BotLike[]>;
  /** a place with no bot (a session): its glyph in the pill's lead (screen 13) */ icon?: U<string>;
  /** the app's own handles on each control (ids, data-win, aria-controls): the shell wires them */ parts?: U<ChromeParts>;
}
export interface ChromeParts { toggle?: U<Attrs>; title?: U<Attrs>; search?: U<Attrs>; details?: U<Attrs>; windowGroup?: U<Attrs>; min?: U<Attrs>; max?: U<Attrs>; close?: U<Attrs> }
export function titlePill(o: { title: string; bot?: U<BotLike>; running?: U<string>; members?: U<readonly BotLike[]>; icon?: U<string>; /** a session's branch, after its name in mono (board S20) */ sub?: U<string>; attrs?: U<Attrs> }): string {
  const lead = o.members && o.members.length ? kitStack(o.members, 24, { max: 4, surface: '--bg-3' })   /* four places, as every row's stack (owner decision, 22 November: one stack, consistently) */
    : o.bot ? orbHtml({ ...o.bot, state: o.running ? 'working' : 'idle', attention: null }, { size: 24, live: true, motion: 'lively', mode: 'fixed', surface: '--bg-3' })   /* the pill's orb faces front and idles (screens.js pill: orb(bot, 24)); the bot's state is said in the rail, the thread and the status line */
    : o.icon ? '<span class="k7-title__ic" aria-hidden="true">' + glyph(o.icon) + '</span>' : '';
  return '<button class="k7-reset k7-title"' + partAttrs('TitlePill', { type: 'button', 'aria-haspopup': 'dialog', 'aria-description': 'Opens the details', 'data-running': o.running ? '' : null, 'data-lead': lead ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    lead + '<span class="k7-title__name">' + esc(o.title) + '</span>' + (o.sub ? ' <span class="k7-title__sub k7-mono">' + esc(o.sub) + '</span>' : '') +
    (o.running ? statusLine({ kind: 'system', phrase: o.running, inPill: true }) : '') + '</button>';
}
export function searchHint(o: { shows?: U<typeof SEARCH_SHOWS[number]>; attrs?: U<Attrs> }): string {
  const s = o.shows ?? 'hint';
  if (s === 'off') return '';
  if (s === 'button') return iconButton({ icon: 'search', label: 'Search', keys: 'mod+K', attrs: o.attrs });
  if (s === 'pill') return '<button class="k7-reset k7-search-pill"' + attrs({ type: 'button', 'aria-label': 'Search ' + kbdLabel(), ...(o.attrs ?? {}) }) + '>' + glyph('search') + '<span class="k7-search-pill__label">Search</span> ' + kbd({ keys: 'mod+K', inPill: true }) + '</button>';
  /* S5: the word and the key chips, no fill at rest; a 28 pill at --hover on hover and focus; its name contains its visible text */
  return '<button class="k7-reset k7-search-hint"' + attrs({ type: 'button', 'aria-label': 'Search ' + kbdLabel(), 'aria-keyshortcuts': 'Control+K', ...(o.attrs ?? {}) }) + '>Search ' + kbd({ keys: 'mod+K' }) + '</button>';   /* the space is a word break for the name (the button is a flex row: it takes no room) */
}
/** the keys as they are drawn, so the visible words are in the control's name in their order (WCAG 2.5.3) */
const kbdLabel = (): string => keyNames('mod+K').join(' ');
export function windowChrome(o: ChromeOpts): string {
  const p = o.parts ?? {};
  return '<div class="k7-chrome"' + kitAttrs('WindowChrome', { 'data-rail': o.rail ?? 'a', role: 'toolbar', 'aria-label': 'Window', ...(o.attrs ?? {}) }) + '>' +
    '<div class="k7-chrome__start">' + iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B', large: true, attrs: p.toggle }) + '</div>' +
    '<div class="k7-chrome__centre">' + titlePill({ ...o, attrs: p.title }) + '</div>' +
    '<div class="k7-chrome__end">' + searchHint({ shows: o.search, attrs: p.search }) + iconButton({ icon: 'sidebar-right', label: 'Details', keys: 'mod+.', large: true, attrs: p.details }) +
    (o.windowControls === false ? '' : '<span class="k7-chrome__wc"' + attrs(p.windowGroup ?? {}) + '>' + iconButton({ icon: 'minimize', label: 'Minimize', variant: 'ghost', attrs: p.min }) + iconButton({ icon: 'maximize', label: 'Maximize', variant: 'ghost', attrs: p.max }) + iconButton({ icon: 'close', label: 'Close window', variant: 'ghost', attrs: p.close }) + '</span>') +
    '</div></div>';
}

/** what WindowChrome promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<ChromeOpts>({
  name: 'WindowChrome',
  folder: 'window-chrome',
  layer: 'surface',
  summary: 'No bar: a 56 px drag region with floating controls: the sidebar toggle, the title pill centred on the column, the search hint, the details button, the window\'s glyphs.',
  exports: ['windowChrome', 'titlePill', 'searchHint'],
  props: {
    rail: 'a (the default) or b: the rail\'s size under it',
    title: 'the title pill\'s words',
    bot: 'the bot whose orb leads the pill',
    running: 'what runs, said in the pill',
    search: 'hint (the default), button, pill or off',
    windowControls: 'the window\'s buttons; false on a tiling desktop',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    members: 'a room: its members\' stack leads the pill',
    icon: 'a place with no bot: its glyph leads the pill',
    parts: 'the app\'s handles on each control'
  },
  events: [],
  states: ['data-rail', 'data-running (the pill)'],
  parts: ['TitlePill', 'k7-search-hint', 'k7-chrome__wc'],
  tokens: [
    '--bg-3', '--bg-4', '--chrome-y', '--ctl', '--drag-h', '--dur-1', '--dur-out', '--ease-out', '--fs-l', '--fs-s', '--fs-xs',
    '--gap-hair', '--hl', '--hover', '--lh-l', '--lh-s', '--lh-xs', '--line', '--pad-line', '--pad-pill-end', '--pad-pill-start',
    '--pill-h', '--r-pill', '--rail-b-w', '--sb-rail-w', '--search-pill-w', '--shadow-inline', '--sp-1', '--sp-2', '--sp-3',
    '--sp-6', '--text', '--text-dim', '--text-quiet', '--track-s', '--wc-h', '--wc-w'
  ],
  a11y: 'role="toolbar" named Window. The title pill is a <button> that opens the details; the search hint\'s name holds its visible words and keys.',
  boards: []
});
