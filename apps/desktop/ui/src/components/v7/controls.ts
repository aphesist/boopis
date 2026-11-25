/* The v7 kit's controls (DESIGN-SYSTEM.md v7 21.2, rows 21 to 29): Button, IconButton, Segmented, SelectorItem, Switch,
   Field, Kbd, Chip, Tooltip. Templates only: behaviour is wire.ts, the look controls.css. */
import { isMac } from '../../core/dom';
import { attrs, cls, esc, glyph, kitAttrs, partAttrs, textOr } from './util';
import type { Attrs, U } from './util';

/* ── Button (21): secondary, primary, ghost, tint, danger, split; 36, 32, 28; hold-to ── */
export const BUTTON_VARIANTS = ['secondary', 'primary', 'ghost', 'tint', 'danger', 'split'] as const;
export type ButtonVariant = typeof BUTTON_VARIANTS[number];
export const BUTTON_SIZES = [36, 32, 28] as const;
export type ButtonSize = typeof BUTTON_SIZES[number];
export interface ButtonOpts {
  label: string; variant?: U<ButtonVariant>; size?: U<ButtonSize>; icon?: U<string>; disabled?: U<boolean>;
  /** hold to confirm: the fill sweeps over --dur-hold (1 s, owner decision) and fires ui:commit */
  hold?: U<boolean>; tip?: U<string>; keys?: U<string>; type?: U<'button' | 'submit'>; attrs?: U<Attrs>;
  /** split: the menu half's accessible name */
  menuLabel?: U<string>;
}
export function button(o: ButtonOpts): string {
  const v = o.variant ?? 'secondary', size = o.size ?? 36;
  const a = (extra: Attrs): string => attrs({ type: o.type ?? 'button', disabled: !!o.disabled, 'data-tip': o.tip, 'data-kbd': o.keys, ...extra });
  const inner = glyph(o.icon) + '<span class="k7-btn__label">' + esc(o.label) + '</span>';
  if (v === 'split') {
    return '<span class="k7-split" ' + kitAttrs('Button', { 'data-variant': 'split', 'data-size': size, ...(o.attrs ?? {}) }).trim() + '>' +
      '<button class="k7-reset k7-btn k7-split__main"' + a({ 'data-variant': 'primary', 'data-size': size }) + '>' + inner + '</button>' +
      '<button class="k7-reset k7-btn k7-split__menu"' + a({ 'data-variant': 'primary', 'data-size': size, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': o.menuLabel ?? 'More options' }) + '>' + glyph('chevron-down') + '</button></span>';
  }
  return '<button class="k7-reset k7-btn"' + kitAttrs('Button') + a({ 'data-variant': v, 'data-size': size, 'data-hold': o.hold ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    (o.hold ? '<span class="k7-btn__sweep" aria-hidden="true"></span>' : '') + inner + '</button>';
}

/* ── IconButton (22): floating 36, tinted 28, ghost (window controls) ── */
export const ICON_BUTTON_VARIANTS = ['floating', 'tinted', 'ghost', 'inverted'] as const;
export type IconButtonVariant = typeof ICON_BUTTON_VARIANTS[number];
export interface IconButtonOpts { icon: string; label: string; /** the chrome's 18 px glyph (kit.css `.i.l`) */ large?: U<boolean>; variant?: U<IconButtonVariant>; pressed?: U<boolean>; expanded?: U<boolean>; haspopup?: U<string>; disabled?: U<boolean>; keys?: U<string>; tip?: U<string | false>; attrs?: U<Attrs> }
export function iconButton(o: IconButtonOpts): string {
  return '<button class="k7-reset k7-ib"' + kitAttrs('IconButton') + attrs({
    type: 'button', 'data-variant': o.variant ?? 'floating', 'aria-label': o.label, 'aria-pressed': o.pressed == null ? null : String(o.pressed),
    'aria-expanded': o.expanded == null ? null : String(o.expanded), 'aria-haspopup': o.haspopup, disabled: !!o.disabled,
    'data-tip': o.tip === false ? null : o.tip ?? o.label, 'data-kbd': o.keys, 'aria-keyshortcuts': o.keys, ...(o.attrs ?? {})
  }) + '>' + glyph(o.icon, o.large ? 'k7-ic--l' : undefined) + '</button>';
}

/* ── Kbd (27): in text (radius 4), in a pill (a pill) ── */
export interface KbdOpts { keys: string; inPill?: U<boolean>; attrs?: U<Attrs> }
/** the key names as a person reads them: ctrl K, and ⌘K on macOS */
export function keyNames(k: string): string[] {
  return k.split(/\s*\+\s*|\s+/).filter(Boolean).map((p) => {
    const l = p.toLowerCase();
    if (l === 'mod') return isMac ? '⌘' : 'ctrl';
    if (l === 'ctrl') return 'ctrl';
    if (l === 'shift') return isMac ? '⇧' : 'shift';
    if (l === 'alt') return isMac ? '⌥' : 'alt';
    if (l === 'enter') return 'Enter';
    if (l === 'esc' || l === 'escape') return 'esc';
    return p.length === 1 ? p.toUpperCase() : p;
  });
}
export function kbd(o: KbdOpts): string {
  return '<span class="k7-keys"' + attrs(o.attrs ?? {}) + '>' + keyNames(o.keys).map((n) => '<kbd class="k7-kbd"' + kitAttrs('Kbd', { 'data-in': o.inPill ? 'pill' : null }) + '>' + esc(n) + '</kbd>').join(' ') + '</span>';
}

/* ── Chip (28): answer (in an AskCard), filter, mode ── */
export const CHIP_VARIANTS = ['answer', 'filter', 'mode'] as const;
export type ChipVariant = typeof CHIP_VARIANTS[number];
export interface ChipOpts { label: string; variant?: U<ChipVariant>; chosen?: U<boolean>; icon?: U<string>; leadHTML?: U<string>; hold?: U<boolean>; value?: U<string>; attrs?: U<Attrs> }
export function chip(o: ChipOpts): string {
  const v = o.variant ?? 'filter';
  return '<button class="k7-reset k7-chip"' + kitAttrs('Chip') + attrs({ type: 'button', 'data-variant': v, 'aria-pressed': v === 'answer' ? null : String(!!o.chosen), 'data-chosen': o.chosen ? '' : null, 'data-value': o.value, 'data-hold': o.hold ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    (o.hold ? '<span class="k7-btn__sweep" aria-hidden="true"></span>' : '') + (o.leadHTML ?? glyph(o.icon)) + '<span class="k7-chip__label">' + esc(o.label) + '</span></button>';
}

/* ── Segmented (23): inline, page head (scope), tab bar ── */
export const SEGMENTED_VARIANTS = ['inline', 'head', 'tabs'] as const;
export type SegmentedVariant = typeof SEGMENTED_VARIANTS[number];
export interface SegItem { value: string; label: string; controls?: U<string>; /** the attention dot (amber, R-tab-3 in v7's 15.2): something on that side needs you */ dot?: U<boolean>; id?: U<string>; tip?: U<string>; keys?: U<string> }
export interface SegmentedOpts { items: readonly SegItem[]; value: string; label: string; variant?: U<SegmentedVariant>; attrs?: U<Attrs> }
export function segmented(o: SegmentedOpts): string {
  const tabs = o.variant === 'tabs';
  const i = Math.max(0, o.items.findIndex((it) => it.value === o.value));
  /* the track is a grid of equal columns (R-seg-1); one thumb slides between them over --dur-slide */
  return '<div class="k7-seg"' + kitAttrs('Segmented') + attrs({ role: tabs ? 'tablist' : 'radiogroup', 'aria-label': o.label, 'data-variant': o.variant ?? 'inline', style: '--n:' + o.items.length + ';--i:' + i, ...(o.attrs ?? {}) }) + '>' +
    '<span class="k7-seg__thumb"' + partAttrs('SegmentedThumb', { 'aria-hidden': 'true' }) + '></span>' +
    o.items.map((it) => {
      const on = it.value === o.value;
      return '<button class="k7-reset k7-seg__item"' + partAttrs('SegmentedItem', {
        type: 'button', role: tabs ? 'tab' : 'radio', 'aria-selected': tabs ? String(on) : null, 'aria-checked': tabs ? null : String(on),
        'aria-controls': it.controls, tabindex: on ? '0' : '-1', 'data-value': it.value, id: it.id, 'data-tip': it.tip, 'data-kbd': it.keys, 'aria-keyshortcuts': it.keys
      }) + '>' + esc(it.label) + (it.dot != null ? '<span class="k7-seg__dot"' + attrs({ 'aria-hidden': 'true', 'data-show': it.dot ? '' : null }) + '></span>' : '') + '</button>';
    }).join('') + '</div>';
}

/* ── SelectorItem (24): line (12, under the composer), launch (13, in the canvas), field (in a Row) ── */
export const SELECTOR_VARIANTS = ['line', 'launch', 'field'] as const;
export type SelectorVariant = typeof SELECTOR_VARIANTS[number];
export interface SelectorItemOpts {
  value: string; variant?: U<SelectorVariant>; label?: U<string>; leadHTML?: U<string>; icon?: U<string>; open?: U<boolean>;
  /** the value's own quiet mark, e.g. a model's provider mark */ mono?: U<boolean>;
  /** the four-step ticks (how careful: S01 B) */ ticks?: U<{ of: number; on: number }>;
  /** "+ Choose a model": the kind inline action in the accent (S41) */ need?: U<boolean>; chevron?: U<boolean>; attrs?: U<Attrs>;
}
export function selectorItem(o: SelectorItemOpts): string {
  const v = o.variant ?? 'line';
  const ticks = o.ticks ? '<span class="k7-ticks" aria-hidden="true">' + Array.from({ length: o.ticks.of }, (_, i) => '<i' + (i < (o.ticks?.on ?? 0) ? ' data-on' : '') + '></i>').join('') + '</span>' : '';
  return '<button class="k7-reset k7-sel"' + kitAttrs('SelectorItem') + attrs({
    type: 'button', 'data-variant': v, 'aria-haspopup': 'menu', 'aria-expanded': String(!!o.open), 'aria-label': o.label ? o.label + ': ' + o.value : null,
    'data-need': o.need ? '' : null, ...(o.attrs ?? {})
  }) + '>' + (o.leadHTML ?? glyph(o.icon)) + ticks + '<span class="' + cls('k7-sel__value', o.mono && 'k7-mono') + '">' + esc(o.value) + '</span>' + (o.chevron === false ? '' : glyph('chevron-down', 'k7-sel__chev')) + '</button>';
}

/* ── Switch (25): on (accent), off, focus, disabled ── */
export interface SwitchOpts { checked?: U<boolean>; disabled?: U<boolean>; label?: U<string>; labelledby?: U<string>; id?: U<string>; attrs?: U<Attrs> }
export function switchHTML(o: SwitchOpts): string {
  return '<button class="k7-reset k7-switch"' + kitAttrs('Switch') + attrs({ type: 'button', role: 'switch', 'aria-checked': String(!!o.checked), disabled: !!o.disabled, 'aria-label': o.labelledby ? null : o.label, 'aria-labelledby': o.labelledby, id: o.id, ...(o.attrs ?? {}) }) + '><span class="k7-switch__knob" aria-hidden="true"></span></button>';
}

/* ── Field (26): text, search (a pill), multi-line ── */
export const FIELD_KINDS = ['text', 'search', 'multiline'] as const;
export type FieldKind = typeof FIELD_KINDS[number];
export interface FieldOpts { id: string; kind?: U<FieldKind>; label?: U<string>; optional?: U<boolean>; value?: U<string>; placeholder?: U<string>; error?: U<string>; disabled?: U<boolean>; keys?: U<string>; mono?: U<boolean>; rows?: U<number>; /** the accessible name where no label shows */ ariaLabel?: U<string>; attrs?: U<Attrs> }
export function field(o: FieldOpts): string {
  const k = o.kind ?? 'text', err = o.error ? o.id + '-err' : null;
  const common = attrs({ id: o.id, placeholder: o.placeholder, disabled: !!o.disabled, 'aria-invalid': o.error ? 'true' : null, 'aria-describedby': err, 'aria-label': o.label ? null : o.ariaLabel ?? o.placeholder, ...(o.attrs ?? {}) });
  const control = k === 'multiline'
    ? '<textarea class="' + cls('k7-field__input', o.mono && 'k7-mono') + '" rows="' + (o.rows ?? 3) + '"' + common + '>' + esc(o.value ?? '') + '</textarea>'
    : '<input class="' + cls('k7-field__input', o.mono && 'k7-mono') + '" type="' + (k === 'search' ? 'search' : 'text') + '"' + attrs({ value: o.value }) + common + '>';
  const box = '<span class="k7-field__box"' + attrs({ 'data-kind': k }) + '>' + (k === 'search' ? glyph('search', 'k7-field__glyph') : '') + control + (o.keys ? kbd({ keys: o.keys, inPill: k === 'search' }) : '') + '</span>';
  return '<div class="k7-field"' + kitAttrs('Field', { 'data-kind': k, 'data-error': o.error ? '' : null, 'data-disabled': o.disabled ? '' : null }) + '>' +
    (o.label ? '<label class="k7-field__label" for="' + esc(o.id) + '">' + esc(o.label) + (o.optional ? ' <span class="k7-field__opt">(Optional)</span>' : '') + '</label>' : '') +
    box + (o.error ? '<p class="k7-field__error" id="' + err + '">' + esc(o.error) + '</p>' : '') + '</div>';
}

/* ── Tooltip (29): the name, then the keys. A [data-tip] control shows it on hover and focus (tooltip.ts places it); this
   is the surface as the lab and documentation draw it in place ── */
export interface TooltipOpts { label: string; keys?: U<string> }
export function tooltip(o: TooltipOpts): string {
  return '<span class="k7-tip" role="tooltip"' + kitAttrs('Tooltip') + '><span>' + esc(o.label) + '</span>' + (o.keys ? kbd({ keys: o.keys }) : '') + '</span>';
}

export { textOr };
