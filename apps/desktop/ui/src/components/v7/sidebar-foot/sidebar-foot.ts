/* SidebarFoot: its view (typed props to markup) and its contract. Its look is sidebar-foot.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { iconButton } from '../icon-button/icon-button';
import { attrs, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── SidebarFoot: the open sidebar's foot (board 12, botscreens.js sidebarG `.foot-ctl`): you at the start (the account: a 32 circle at
   --current with the user glyph, the name 13 --text-dim; `account: false` leaves it out, as the Sessions side does), Store and
   Settings (tinted 28s) at the end ── */
export interface SidebarFootOpts { name: string; account?: U<boolean>; /** the app's handles on its three controls */ parts?: U<{ account?: Attrs; store?: Attrs; settings?: Attrs }>; attrs?: U<Attrs> }
export function sidebarFoot(o: SidebarFootOpts): string {
  return '<div class="k7-sfoot"' + kitAttrs('SidebarFoot', o.attrs ?? null) + '>' +
    (o.account === false ? '' : '<button class="k7-reset k7-sfoot__me" type="button"' + attrs({ 'aria-label': 'Account, ' + o.name, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-tip': o.name, 'data-tip-pos': 'top', ...(o.parts?.account ?? {}) }) + '>' +
      '<span class="k7-sfoot__avatar" aria-hidden="true">' + glyph('user') + '</span><span class="k7-sfoot__name k7-ell">' + esc(o.name) + '</span></button>') + '<span class="k7-grow"></span>' +
    iconButton({ icon: 'store', label: 'Store', variant: 'tinted', keys: 'mod+shift+S', attrs: { 'aria-haspopup': 'dialog', ...(o.parts?.store ?? {}) } }) +
    iconButton({ icon: 'gear', label: 'Settings', variant: 'tinted', keys: 'mod+,', attrs: { 'aria-haspopup': 'dialog', ...(o.parts?.settings ?? {}) } }) + '</div>';
}

/** what SidebarFoot promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SidebarFootOpts>({
  name: 'SidebarFoot',
  folder: 'sidebar-foot',
  layer: 'surface',
  summary: 'The open sidebar\'s foot: you at the start (the account), Store and Settings at the end.',
  exports: ['sidebarFoot'],
  props: {
    name: 'your name',
    account: 'false leaves the account out (the Sessions side)',
    parts: 'the app\'s handles on its three controls',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['aria-expanded (the account menu)'],
  parts: ['k7-sfoot__me'],
  tokens: [
    '--ctl-card', '--current', '--dur-1', '--dur-out', '--ease-out', '--fs-s', '--hover', '--lh-s', '--r-pill', '--sp-2', '--sp-3',
    '--text', '--text-dim', '--track-s'
  ],
  a11y: 'Three buttons: the account (a menu), Store and Settings (dialogs), each named, with their keys.',
  boards: [
    '11-botchat', 'K02-12-sidebar', '17-working', 'S17-newsession', 'S20-running', 'S23-finished', 'S33-changed', 'S36-engine',
    'S37-nomodel', 'S38-gate', 'S40-details', 'S41-noproject'
  ]
});
