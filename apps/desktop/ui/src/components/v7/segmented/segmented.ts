/* Segmented: its view (typed props to markup) and its contract. Its look is segmented.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { attrs, esc, glyph, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Segmented (23): inline, page head (scope), tab bar ── */
export const SEGMENTED_VARIANTS = ['inline', 'head', 'tabs'] as const;
export type SegmentedVariant = typeof SEGMENTED_VARIANTS[number];
export interface SegItem { value: string; label: string; controls?: U<string>; /** the attention dot (amber, R-tab-3 in v7's 15.2): something on that side needs you */ dot?: U<boolean>; id?: U<string>; tip?: U<string>; keys?: U<string>; /** upright: the item's glyph (its label is its name and its tip) */ icon?: U<string> }
export interface SegmentedOpts {
  items: readonly SegItem[]; value: string; label: string; variant?: U<SegmentedVariant>; attrs?: U<Attrs>;
  /** the switch stood on its end (the collapsed rail's Sessions over Bots; owner, 25 November): its items 28 circles with their glyphs in the track */ upright?: U<boolean>;
}
export function segmented(o: SegmentedOpts): string {
  const tabs = o.variant === 'tabs';
  const i = Math.max(0, o.items.findIndex((it) => it.value === o.value));
  /* the track is a grid of equal columns (R-seg-1); one thumb slides between them over --dur-slide */
  return '<div class="k7-seg"' + kitAttrs('Segmented') + attrs({ role: tabs ? 'tablist' : 'radiogroup', 'aria-label': o.label, 'aria-orientation': o.upright ? 'vertical' : null, 'data-variant': o.variant ?? 'inline', 'data-upright': o.upright ? '' : null, style: '--n:' + o.items.length + ';--i:' + i, ...(o.attrs ?? {}) }) + '>' +
    '<span class="k7-seg__thumb"' + partAttrs('SegmentedThumb', { 'aria-hidden': 'true' }) + '></span>' +
    o.items.map((it) => {
      const on = it.value === o.value;
      return '<button class="k7-reset k7-seg__item"' + partAttrs('SegmentedItem', {
        type: 'button', role: tabs ? 'tab' : 'radio', 'aria-selected': tabs ? String(on) : null, 'aria-checked': tabs ? null : String(on),
        'aria-controls': it.controls, tabindex: on ? '0' : '-1', 'data-value': it.value, id: it.id, 'data-tip': it.tip ?? (o.upright ? it.label : undefined), 'data-tip-pos': o.upright ? 'right' : null, 'data-kbd': it.keys, 'aria-keyshortcuts': it.keys,
        'aria-label': o.upright ? it.label : null
      }) + '>' + (o.upright ? glyph(it.icon) : esc(it.label)) + (it.dot != null ? '<span class="k7-seg__dot"' + attrs({ 'aria-hidden': 'true', 'data-show': it.dot ? '' : null }) + '></span>' : '') + '</button>';
    }).join('') + '</div>';
}

/** what Segmented promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SegmentedOpts>({
  name: 'Segmented',
  folder: 'segmented',
  layer: 'control',
  summary: 'One of a few: inline, a page head\'s scope, or a tab bar. One thumb slides between equal columns; it can stand upright (the collapsed rail\'s switch).',
  exports: ['segmented'],
  props: {
    items: 'its items: value, label, and optionally the panel it controls, an attention dot, an id, a tip, keys and a glyph (upright)',
    value: 'the chosen item',
    label: 'the group\'s accessible name',
    variant: 'inline (the default), head or tabs',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    upright: 'stood on its end: 28 circles with their glyphs, named by their labels'
  },
  events: ['ui:change'],
  states: [
    'aria-checked (radio items)', 'aria-selected (tabs)', 'tabindex (roving)', '--i (the thumb\'s place)', 'data-variant',
    'data-upright'
  ],
  parts: ['SegmentedThumb', 'SegmentedItem'],
  tokens: [
    '--ctl-s', '--dur-1', '--dur-out', '--ease-out', '--fill-2', '--focus-w', '--fs-s', '--gap-hair', '--gap-s', '--lh-s', '--owe',
    '--pad-chip', '--pad-kbd', '--pad-seg', '--r-pill', '--seg-item-h', '--seg-on', '--seg-on-sh', '--text', '--text-dim'
  ],
  a11y: 'A radiogroup of radios, or a tablist of tabs. One tab stop (roving tabindex); the arrows, Home and End move and choose.',
  boards: []
});
