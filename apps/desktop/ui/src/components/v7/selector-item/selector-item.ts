/* SelectorItem: its view (typed props to markup) and its contract. Its look is selector-item.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { attrs, cls, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── SelectorItem (24): line (12, under the composer), launch (13, in the canvas), field (in a Row) ── */
export const SELECTOR_VARIANTS = ['line', 'launch', 'field'] as const;
export type SelectorVariant = typeof SELECTOR_VARIANTS[number];
export interface SelectorItemOpts {
  value: string; variant?: U<SelectorVariant>; label?: U<string>; leadHTML?: U<string>; icon?: U<string>; open?: U<boolean>;
  /** the value's own quiet mark, e.g. a model's provider mark */ mono?: U<boolean>;
  /** the four-step ticks (how careful: S01 B) */ ticks?: U<{ of: number; on: number }>;
  /** "+ Choose a model": the kind inline action in the accent (S41) */ need?: U<boolean>; chevron?: U<boolean>; attrs?: U<Attrs>;
  /** a colour before the value (board 14's Accent: a 12 circle of the accent) */ swatch?: U<string>;
}
/** a colour as a 12 circle beside its name (board 14's Accent select and its menu's rows) */
export const swatchDot = (hex: string): string => '<span class="k7-swatch-dot" aria-hidden="true" style="background:' + esc(hex) + '"></span>';
export function selectorItem(o: SelectorItemOpts): string {
  const v = o.variant ?? 'line';
  const ticks = o.ticks ? '<span class="k7-ticks" aria-hidden="true">' + Array.from({ length: o.ticks.of }, (_, i) => '<i' + (i < (o.ticks?.on ?? 0) ? ' data-on' : '') + '></i>').join('') + '</span>' : '';
  return '<button class="k7-reset k7-sel"' + kitAttrs('SelectorItem') + attrs({
    type: 'button', 'data-variant': v, 'aria-haspopup': 'menu', 'aria-expanded': String(!!o.open), 'aria-label': o.label ? o.label + ': ' + o.value : null,
    'data-need': o.need ? '' : null, ...(o.attrs ?? {})
  }) + '>' + (o.swatch ? swatchDot(o.swatch) : o.leadHTML ?? glyph(o.icon)) + ticks + '<span class="' + cls('k7-sel__value', o.mono && 'k7-mono') + '">' + esc(o.value) + '</span>' + (o.chevron === false ? '' : glyph('chevron-down', 'k7-sel__chev')) + '</button>';
}

/** what SelectorItem promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SelectorItemOpts>({
  name: 'SelectorItem',
  folder: 'selector-item',
  layer: 'control',
  summary: 'A quiet current value that opens a Menu: under the composer (line), in the new session\'s canvas (launch), or in a settings Row (field).',
  exports: ['selectorItem', 'swatchDot'],
  props: {
    value: 'the value it shows',
    variant: 'line (the default), launch or field',
    label: 'what the value is ("Model"): its name reads "Model: Opus"',
    leadHTML: 'trusted kit markup that leads it in place of a glyph (an orb, a model\'s mark)',
    icon: 'a glyph of the kit\'s icon set, before the value',
    open: 'its menu is open (aria-expanded)',
    mono: 'the value in mono (a model id)',
    ticks: 'the four-step ticks after the value (how careful)',
    need: '"+ Choose a model": the kind inline action in the accent',
    chevron: 'false hides the chevron',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    swatch: 'a colour before the value, as a 12 circle (the accent)'
  },
  events: [],
  states: ['aria-expanded', 'data-variant', 'data-need'],
  parts: ['k7-sel__value', 'k7-ticks', 'k7-swatch-dot'],
  tokens: [
    '--accent-soft', '--accent-text', '--ctl-s', '--dur-1', '--dur-out', '--ease-out', '--fs-s', '--fs-xs', '--gap-sel',
    '--gap-xs', '--hover', '--icon-s', '--lh-m', '--lh-xs', '--mark-off', '--pad-need-end', '--pad-need-start', '--pad-sel-end',
    '--pad-sel-start', '--r-field', '--r-pill', '--text', '--text-dim', '--tick', '--track'
  ],
  a11y: 'A native <button> with aria-haspopup="menu"; its name says what it sets and the value ("Model: Opus").',
  boards: ['S17-newsession', 'S37-nomodel', 'S40-details', '14-settings']
});
