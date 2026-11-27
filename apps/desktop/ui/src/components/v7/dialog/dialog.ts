/* Dialog: its view (typed props to markup) and its contract. Its look is dialog.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { button } from '../button/button';
import { iconButton } from '../icon-button/icon-button';
import { attrs, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Dialog (4): large (Settings: 900, a 220 nav), wide (the Store: 900 by 640, no nav, its title and what stands at the head's end:
   board 15) or form (440 to 520: commit, import, new bot, confirm); enter 200 ms, the scrim, close 28 at 10 in (a capsule; a ghost on a
   large or wide dialog) ── */
export const DIALOG_VARIANTS = ['form', 'large', 'wide'] as const;
export interface DialogOpts {
  variant?: U<typeof DIALOG_VARIANTS[number]>;
  /** `wide`: what stands at the head's end, before the close (board 15's "3 installed"), as kit markup */ headEnd?: U<string>;
  /** `wide`: the body's own attributes (its id, a label, tabindex for a scroller the keyboard reads) */ bodyAttrs?: U<Attrs>; title: string; body: string; nav?: U<readonly { label: string; icon?: string; current?: boolean; /** the page it opens (Settings: `data-page`) */ value?: string; attrs?: Attrs }[]>;
  /** `large`: the page's own attributes (its id, a label naming the page shown) */ pageAttrs?: U<Attrs>;
  actions?: U<readonly { label: string; variant?: 'primary' | 'ghost' | 'danger' | 'split'; /** it cannot be taken now, and its Tooltip says why (6e: a rewind where it cannot run) */ disabled?: boolean; tip?: string }[]>; scrim?: U<boolean>; id?: U<string>; attrs?: U<Attrs>;
}
export function dialog(o: DialogOpts): string {
  const v = o.variant ?? 'form', id = o.id ?? 'k7-dlg-' + o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  /* the large dialog's close is a ghost (board 14: `.d-close` with no fill); a form's a tinted capsule */
  const close = iconButton({ icon: 'close', label: 'Close', variant: v === 'form' ? 'tinted' : 'ghost', keys: 'esc', attrs: { 'data-dialog-close': '' } });
  const inner = v === 'wide'
    ? '<div class="k7-dialog__head"><h2 class="k7-dialog__title" id="' + esc(id) + '-t">' + esc(o.title) + '</h2>' + (o.headEnd ? '<span class="k7-dialog__end">' + o.headEnd + '</span>' : '') + '</div>' +
      '<div class="k7-dialog__body"' + attrs({ 'data-wide': '', ...(o.bodyAttrs ?? {}) }) + '>' + o.body + '</div>'
    : v === 'large'
    ? '<nav class="k7-dialog__nav" aria-label="' + esc(o.title) + '">' + (o.nav ?? []).map((n) => '<button class="k7-reset k7-dialog__navrow" type="button"' + attrs({ 'aria-current': n.current ? 'page' : null, 'data-page': n.value, 'aria-label': n.label, ...(n.attrs ?? {}) }) + '>' + glyph(n.icon) + '<span class="k7-ell">' + esc(n.label) + '</span></button>').join('') + '</nav>' +
      '<div class="k7-dialog__page"' + attrs(o.pageAttrs ?? {}) + '>' + o.body + '</div>'
    : '<h2 class="k7-dialog__title" id="' + esc(id) + '-t">' + esc(o.title) + '</h2><div class="k7-dialog__body">' + o.body + '</div>' +
      ((o.actions ?? []).length ? '<div class="k7-dialog__foot">' + (o.actions ?? []).map((x) => button({ label: x.label, variant: x.variant ?? 'secondary', size: 32, menuLabel: x.label + ' options', ...(x.tip ? { tip: x.tip } : {}), ...(x.disabled ? { attrs: { 'aria-disabled': 'true', 'data-disabled': '' } } : {}) })).join('') + '</div>' : '');
  const dlg = '<div class="k7-dialog"' + kitAttrs('Dialog', { role: 'dialog', 'aria-modal': 'true', 'data-variant': v, id, 'aria-labelledby': v !== 'large' ? id + '-t' : null, 'aria-label': v === 'large' ? o.title : null, 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' + inner + close + '</div>';
  return o.scrim === false ? dlg : '<div class="k7-scrim" data-layer-host>' + dlg + '</div>';
}

/** what Dialog promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<DialogOpts>({
  name: 'Dialog',
  folder: 'dialog',
  layer: 'surface',
  summary: 'A dialog: large (Settings: 900 with a 220 nav), wide (the Store: 900 by 640, its title and what stands at its head\'s end) or a form (440 to 520: commit, import, new bot, confirm), over a scrim that is never blurred.',
  exports: ['dialog'],
  props: {
    variant: 'form (the default), large or wide',
    headEnd: 'wide: what stands at the head\'s end, before the close (kit markup)',
    bodyAttrs: 'wide: the body\'s own attributes',
    title: 'its title',
    body: 'what it holds, as markup',
    nav: 'large: its nav rows (a label, a glyph, current, the page it opens)',
    pageAttrs: 'large: the page\'s own attributes',
    actions: 'form: its buttons (one that cannot be taken says why in its tip)',
    scrim: 'false: no scrim around it',
    id: 'its id',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-variant', 'aria-current (the nav row shown)', 'aria-disabled (an action)'],
  parts: ['k7-dialog__nav', 'k7-dialog__page', 'k7-dialog__foot', 'k7-dialog__head', 'k7-dialog__end'],
  tokens: [
    '--bg-3', '--bg-pane', '--current', '--dialog-form', '--dialog-l', '--dur-2', '--ease-sharp', '--float-line', '--focus-w',
    '--fs-l', '--fs-s', '--gap-hair', '--hl', '--hover', '--icon', '--lh-l', '--lh-s', '--pad-dialog', '--pad-nav-x', '--r-card',
    '--r-dialog', '--r-nav', '--row-h', '--scrim', '--set-nav-w', '--shadow-modal', '--sp-1', '--sp-2', '--sp-3', '--sp-4',
    '--sp-5', '--sp-6', '--sp-7', '--spec-strong', '--text', '--text-dim', '--wide-h', '--wide-head', '--pad-chrome', '--pad-wide'
  ],
  a11y: 'role="dialog", aria-modal; a form or wide dialog is named by its title, a large dialog by `title`. Its close is an IconButton with esc.',
  boards: ['14-settings', 'S39-settings-sessions', '15-store']
});
