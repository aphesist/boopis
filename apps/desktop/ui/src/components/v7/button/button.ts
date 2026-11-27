/* Button: its view (typed props to markup) and its contract. Its look is button.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { attrs, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Button (21): secondary, primary, ghost, tint, danger, split; 36, 32, 28; hold-to ── */
export const BUTTON_VARIANTS = ['secondary', 'primary', 'ghost', 'tint', 'danger', 'split'] as const;
export type ButtonVariant = typeof BUTTON_VARIANTS[number];
export const BUTTON_SIZES = [36, 32, 28] as const;
export type ButtonSize = typeof BUTTON_SIZES[number];
export interface ButtonOpts {
  label: string; variant?: U<ButtonVariant>; size?: U<ButtonSize>; icon?: U<string>; /** what leads the label in place of a glyph (a provider's mark, S37): trusted kit markup */ leadHTML?: U<string>; disabled?: U<boolean>;
  /** hold to confirm: the fill sweeps over --dur-hold (1 s, owner decision) and fires ui:commit */
  hold?: U<boolean>; tip?: U<string>; keys?: U<string>; type?: U<'button' | 'submit'>; attrs?: U<Attrs>;
  /** split: the menu half's accessible name */
  menuLabel?: U<string>;
}
export function button(o: ButtonOpts): string {
  const v = o.variant ?? 'secondary', size = o.size ?? 36;
  const a = (extra: Attrs): string => attrs({ type: o.type ?? 'button', disabled: !!o.disabled, 'data-tip': o.tip, 'data-kbd': o.keys, ...extra });
  const inner = (o.leadHTML ?? glyph(o.icon)) + '<span class="k7-btn__label">' + esc(o.label) + '</span>';
  if (v === 'split') {
    return '<span class="k7-split" ' + kitAttrs('Button', { 'data-variant': 'split', 'data-size': size, ...(o.attrs ?? {}) }).trim() + '>' +
      '<button class="k7-reset k7-btn k7-split__main"' + a({ 'data-variant': 'primary', 'data-size': size }) + '>' + inner + '</button>' +
      '<button class="k7-reset k7-btn k7-split__menu"' + a({ 'data-variant': 'primary', 'data-size': size, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': o.menuLabel ?? 'More options' }) + '>' + glyph('chevron-down') + '</button></span>';
  }
  return '<button class="k7-reset k7-btn"' + kitAttrs('Button') + a({ 'data-variant': v, 'data-size': size, 'data-hold': o.hold ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    (o.hold ? '<span class="k7-btn__sweep" aria-hidden="true"></span>' : '') + inner + '</button>';
}

/** what Button promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<ButtonOpts>({
  name: 'Button',
  folder: 'button',
  layer: 'control',
  summary: 'The one button: secondary, primary, ghost, tint, danger and split, at 36, 32 or 28. A Button that holds asks for a 1 s press before it acts.',
  exports: ['button'],
  props: {
    label: 'the words on it, and its accessible name',
    variant: 'secondary (the default), primary, ghost, tint, danger or split (a primary with a menu half)',
    size: '36 (the default), 32 or 28',
    icon: 'a glyph of the kit\'s icon set, before the words',
    leadHTML: 'trusted kit markup that leads it in place of a glyph (an orb, a model\'s mark)',
    disabled: 'it cannot be pressed now',
    hold: 'hold to confirm: the fill sweeps over --dur-hold (1 s) and fires ui:commit',
    tip: 'its tooltip\'s words',
    keys: 'the keys that do the same, shown in its tooltip',
    type: 'button (the default) or submit',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    menuLabel: 'split: the menu half\'s accessible name'
  },
  events: ['ui:commit'],
  states: [
    'data-variant', 'data-size', 'disabled', 'data-hold', 'data-holding', 'data-held', 'data-armed',
    'aria-expanded (the split menu half)'
  ],
  parts: ['k7-split__main', 'k7-split__menu', 'k7-btn__sweep'],
  tokens: [
    '--bg-3', '--bg-4', '--ctl', '--ctl-card', '--ctl-s', '--dur-1', '--dur-hold', '--dur-out', '--dur-press', '--ease-out',
    '--ease-sharp', '--fill-2', '--fs-m', '--fs-s', '--gap-hair', '--gap-s', '--hl', '--hover', '--icon-off', '--line',
    '--on-danger', '--pad-btn', '--pad-btn-card', '--pad-btn-s', '--r-pill', '--red', '--selected', '--selected-hover',
    '--selected-off', '--text', '--text-dim', '--text-on-light', '--track'
  ],
  a11y: 'A native <button>, named by its words. A hold is pressed and held, or Space held, for 1 s; from the keyboard Enter twice confirms too (the first press says "Press again to confirm" for 4 s). The split half is its own button with aria-haspopup="menu".',
  boards: [
    '11-botchat', '12-room', 'K02-12-held', '17-working', 'S17-newsession', 'S23-finished', 'S36-engine', 'S37-nomodel',
    'S38-gate', 'S41-noproject', '14-settings'
  ]
});
