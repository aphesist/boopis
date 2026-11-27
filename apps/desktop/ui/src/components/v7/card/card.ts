/* Card: its view (typed props to markup) and its contract. Its look is card.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { attrs, cls, esc, glyph, idFrom, kitAttrs, partAttrs, textOr } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Card (6): the settings card of Rows; settings, pane card, danger zone (collapsed) ── */
export const CARD_VARIANTS = ['settings', 'pane', 'danger'] as const;
export type CardVariant = typeof CARD_VARIANTS[number];
export interface RowOpts {
  label: string; labelHTML?: U<string>; value?: U<string>; /** the value with a lead (a model's mark, then its name) */ valueHTML?: U<string>; mono?: U<boolean>; control?: U<string>;
  /** a second line under the label, 12 --text-dim (a routine's time, what a connector holds): the label is then two lines by design */ sub?: U<string>;
  /** the second line as markup (inline code in the host's words, 7a) in place of `sub` */ subHTML?: U<string>;
  /** a control before the label (board O-B07: a rule's Switch leads its words) */ leadHTML?: U<string>;
  /** the label wraps rather than being cut: the owner's own words (a rule, a binding's action) */ wrap?: U<boolean>;
  /** a label that explains itself: the mark (17.1), revealed on the row's hover or focus */ explain?: U<string>; id?: U<string>; attrs?: U<Attrs>;
  /** the whole row is one control (a pane card's row opens where its value is set): what pressing it does, said to a screen reader */ action?: U<string>;
  /** the whole row is a checkbox, its check in the accent at its end when on (board 14's "Under the composer": `chk`); it fires
      ui:change {value} and toggles */ check?: U<boolean>;
}
export function row(o: RowOpts): string {
  const label = o.explain
    ? '<span class="k7-row__label">' + '<button class="k7-reset k7-mark k7-info" type="button" data-kit="Mark" data-mark-kind="info" aria-haspopup="dialog"' + attrs({ 'data-explain': o.explain, id: o.id }) + '>' + esc(o.label) + '<span class="k7-mark__i" aria-hidden="true">' + glyph('info') + '</span></button></span>'
    : '<span class="k7-row__label"' + attrs({ id: o.id, 'data-wrap-ok': o.sub || o.subHTML || o.wrap ? '' : null }) + '>' + textOr(o.label, o.labelHTML) + (o.subHTML ? '<br><span class="k7-row__sub">' + o.subHTML + '</span>' : o.sub ? '<br><span class="k7-row__sub">' + esc(o.sub) + '</span>' : '') + '</span>';
  const check = o.check == null ? {} : { role: 'checkbox', tabindex: '0', 'aria-checked': String(!!o.check), 'data-check': '', 'data-action': '' };
  return '<div class="k7-row"' + partAttrs('Row', { 'data-mark-reveal': o.explain ? 'hover' : null, ...(o.action ? { role: 'button', tabindex: '0', 'data-action': '', 'aria-label': o.label + (o.value ? ': ' + o.value : '') + ', ' + o.action } : {}), ...check, ...(o.attrs ?? {}) }) + '>' + (o.leadHTML ?? '') + label + ' ' +   /* a word break between the label and the value, for the row's name (a flex row: it takes no room) */
    (o.valueHTML ? '<span class="k7-row__value k7-row__value--lead">' + o.valueHTML + '</span>' : o.value ? '<span class="' + cls('k7-row__value', o.mono && 'k7-mono') + '">' + esc(o.value) + '</span>' : '') + (o.control ?? '') +
    (o.check == null ? '' : '<span class="k7-row__check" aria-hidden="true">' + glyph('check') + '</span>') + '</div>';
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

/** what Card promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<CardOpts>({
  name: 'Card',
  folder: 'card',
  layer: 'block',
  summary: 'The settings card: a column of Rows (a label, a value or a control). A pane card\'s rows open where their value is set; a danger zone is collapsed under its head.',
  exports: ['card'],
  props: {
    variant: 'settings (the default), pane or danger',
    rows: 'its rows: a label (with a second line, a lead, an explanation), a value or a control; a row can be one control (`action`) or a checkbox (`check`)',
    open: 'danger: the zone is open',
    title: 'danger: the head\'s words ("Danger zone")',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:change', 'ui:toggle'],
  states: ['data-variant', 'data-open', 'aria-expanded (danger)', 'aria-checked (a check Row)'],
  parts: ['Row', 'k7-card__head', 'k7-card__body'],
  tokens: [
    '--accent-text', '--bg-3', '--card-line', '--dur-1', '--dur-out', '--ease-out', '--ease-sharp', '--focus-w', '--fs-m',
    '--fs-s', '--fs-xs', '--hl', '--hover', '--icon-quiet', '--icon-s', '--sp-1', '--lh-m', '--lh-s', '--lh-xs', '--pad-btn-card',
    '--pad-card', '--pad-kbd', '--pad-queue', '--pad-set-x', '--pad-set-y', '--pill-h', '--r-card', '--r-nav', '--red-text',
    '--session-h', '--shadow-inline', '--sp-3', '--text', '--text-dim', '--track-s'
  ],
  a11y: 'A <section>. A Row that acts is role="button", a check Row role="checkbox", each one tab stop pressed with Enter or Space; the danger head is a <button> with aria-expanded.',
  boards: ['11-botchat', 'S40-details', '14-settings']
});
