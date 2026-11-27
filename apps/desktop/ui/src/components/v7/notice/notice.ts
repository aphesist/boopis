/* Notice: its view (typed props to markup) and its contract. Its look is notice.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { button } from '../button/button';
import { esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

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

/** what Notice promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<NoticeOpts>({
  name: 'Notice',
  folder: 'notice',
  layer: 'notify',
  summary: 'One line about the app, with up to two actions: above the composer, in a page, or floating over the window, one at a time. Neutral, amber, accent or red.',
  exports: ['notice'],
  props: {
    text: 'its line',
    place: 'composer, page (the default) or floating',
    tone: 'neutral (the default), owe, accent or red',
    icon: 'a glyph of the kit\'s icon set, before the line',
    title: 'the words that lead the line, in --text',
    actions: 'up to two actions (primary, ghost, a value, inert with the reason)',
    dismiss: 'a Dismiss button at its end',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-place', 'data-tone'],
  parts: ['k7-notice__text', 'k7-notice__title'],
  tokens: [
    '--accent-soft', '--accent-text', '--bg-3', '--composer-h', '--dur-1', '--dur-2', '--ease-sharp', '--float-line', '--fs-m',
    '--fs-s', '--gap-row', '--hl', '--lh-m', '--line', '--owe-soft', '--owe-text', '--pad-block', '--pad-text', '--r-block',
    '--red-soft', '--red-text', '--shadow-pop', '--sp-1', '--text', '--text-dim'
  ],
  a11y: 'role="status" (polite), or role="alert" in the red tone. Opened at a control (kit.openNotice) it is a small dialog with one action, and Esc returns the focus.',
  boards: ['S17-newsession']
});
