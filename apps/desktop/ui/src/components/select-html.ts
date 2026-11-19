/* The themed select, as strings (HX.ui.select, design system 14.25 "Selects draw their own chevron" and 14.18 menus).
   One markup for the trigger (a button that is a select-only combobox) and for the list it opens (a `listbox` of
   `option`s, in `group`s when the options have headers). The behaviour is in select.ts; nothing here touches the DOM,
   so html.ts can build a field from it. No colour, family or size lives here: components.css has them. */
import { attrs, cx, esc, nid } from '../core/dom';
import type { Attrs } from '../core/dom';
import { ariaKeys, keyLabel } from '../core/keys';
import { icon } from './icons';
import { markHTML, modelFamily } from './model-mark';
import type { ModelRef } from './model-mark';

type U<T> = T | undefined;

export interface SelectOption {
  value: string; label?: U<string>; desc?: U<string>; mono?: U<boolean>;
  /** a model: its provider's mark leads (brand colour: a list of models is the picker, design system 10.1) */
  model?: U<ModelRef>; icon?: U<string>; /** trusted markup that leads the label (an orb), drawn by the app and never by data */ lead?: U<string>;
  disabled?: U<boolean>; keys?: U<string>;
}
/** options under a header; the header may carry a provider's mark or an icon */
export interface SelectGroup { label: string; model?: U<ModelRef>; icon?: U<string>; options: readonly SelectOption[] }
export type SelectEntry = SelectOption | SelectGroup;

export const isGroup = (e: SelectEntry): e is SelectGroup => 'options' in e;
export const optionLabel = (o: SelectOption): string => o.label ?? o.value;
/** every option, in order, headers dropped */
export const flatOptions = (entries: readonly SelectEntry[]): SelectOption[] => entries.flatMap((e) => (isGroup(e) ? [...e.options] : [e]));
/** plain strings are options whose value is their text */
export const toEntries = (list: readonly (string | SelectEntry)[]): SelectEntry[] => list.map((x) => (typeof x === 'string' ? { value: x } : x));

/** Models as a picker's entries: one group per provider family, in the order each first appears, a header carrying the
    family's mark; a single family needs no header. The family comes from the model id, never the host (design system 10.1). */
export function modelEntries(models: readonly string[]): SelectEntry[] {
  const byFamily = new Map<string, { name: string; first: string; options: SelectOption[] }>();
  for (const m of new Set(models)) {
    const f = modelFamily(m);
    let g = byFamily.get(f.id);
    if (!g) { g = { name: f.name, first: m, options: [] }; byFamily.set(f.id, g); }
    g.options.push({ value: m, model: m, mono: true });
  }
  if (byFamily.size < 2) return [...byFamily.values()].flatMap((g) => g.options);
  return [...byFamily.values()].map((g) => ({ label: g.name, model: g.first, options: g.options }));
}

const lead = (o: SelectOption, size: number): string =>
  o.model != null ? markHTML(o.model, { size, color: 'brand' }) : o.lead ?? (o.icon ? icon(o.icon) : '');

/** one option of the open list */
export function optionHTML(o: SelectOption, selected: boolean): string {
  const l = lead(o, 16);
  return '<div class="ui-option" role="option" id="' + nid('opt') + '" tabindex="-1"' + attrs({ 'aria-selected': String(selected), 'aria-disabled': o.disabled ? 'true' : null, 'data-value': o.value, 'aria-keyshortcuts': o.keys && ariaKeys(o.keys) }) + '>' +
    '<span class="ui-menu__glyph" aria-hidden="true">' + (selected ? icon('check') : '') + '</span>' +
    '<span class="ui-menu__text"><span class="' + cx('ui-menu__label', o.mono && 'ui-mono') + '"' + (l || o.mono ? ' data-content' : '') + '>' + l + esc(optionLabel(o)) + '</span>' + (o.desc ? '<span class="ui-menu__desc">' + esc(o.desc) + '</span>' : '') + '</span>' +
    (o.keys ? '<span class="ui-keys" aria-hidden="true">' + o.keys.split('+').map((k) => '<kbd class="ui-kbd">' + esc(keyLabel(k)) + '</kbd>').join(' ') + '</span>' : '') + '</div>';
}
/** the open list: a surface (the library's squircle frame, which does not scroll) around the scrolling `role="listbox"`; a header is
    the accessible name of its `group` and is not itself an option */
export function listboxHTML(entries: readonly SelectEntry[], o: { id: string; label?: U<string>; value?: U<string | null> }): string {
  const body = entries.map((e) => {
    if (!isGroup(e)) return optionHTML(e, e.value === o.value);
    const gid = nid('lbg'), mark = e.model != null ? markHTML(e.model, { size: 16, label: false }) : e.icon ? icon(e.icon) : '';
    return '<div class="ui-listbox__group" role="group" aria-labelledby="' + gid + '"><div class="ui-listbox__head" role="presentation" id="' + gid + '">' + mark + '<span>' + esc(e.label) + '</span></div>' +
      e.options.map((x) => optionHTML(x, x.value === o.value)).join('') + '</div>';
  }).join('');
  return '<div class="ui-listbox"><div class="ui-listbox__list" role="listbox" id="' + esc(o.id) + '"' + attrs({ 'aria-label': o.label }) + '>' + body + '</div></div>';
}

export interface SelectOpts {
  id?: U<string>; name?: U<string>; entries: readonly SelectEntry[]; value?: U<string | null>; placeholder?: U<string>;
  /** the visible label's element id (aria-labelledby), or a name for the control when there is no visible label */
  labelId?: U<string | null>; label?: U<string>; describedby?: U<string | null>; invalid?: U<boolean>; disabled?: U<boolean>; mono?: U<boolean>; raised?: U<boolean>;
  class?: U<string>; attrs?: U<Attrs>;
}
/** what the trigger shows for the chosen option: its lead, then its name; the placeholder, quiet, when nothing is chosen */
export function triggerHTML(o: SelectOption | undefined, placeholder: string, valueId: string): string {
  const l = o ? lead(o, 16) : '';
  return (l ? '<span class="ui-select__lead" aria-hidden="true">' + l + '</span>' : '') +
    '<span class="' + cx('ui-select__v', !o && 'ui-select__ph') + '" id="' + valueId + '">' + esc(o ? optionLabel(o) : placeholder) + '</span>' + icon('chevron-down', { size: 's' });
}
/** the trigger: a button that is a select-only combobox. Wire it with hydrate() or the `ui.select` factory. */
export function selectHTML(o: SelectOpts): string {
  const id = o.id || nid('sel'), vid = id + '-v', placeholder = o.placeholder ?? 'Choose…';
  const cur = flatOptions(o.entries).find((x) => x.value === o.value);
  return '<button type="button" class="' + cx('ui-input', 'ui-select', o.mono && 'ui-input--mono', o.raised && 'ui-input--raised', o.class) + '" data-ui="select" role="combobox" aria-haspopup="listbox" aria-expanded="false" id="' + esc(id) + '"' +
    attrs({ name: o.name, 'aria-labelledby': o.labelId ? o.labelId + ' ' + vid : null, 'aria-label': o.labelId ? null : o.label, 'aria-describedby': o.describedby, 'aria-invalid': o.invalid ? 'true' : null, disabled: o.disabled,
      'data-value': o.value ?? '', 'data-placeholder': placeholder, 'data-options': JSON.stringify(o.entries), ...o.attrs }) + '>' + triggerHTML(cur, placeholder, vid) + '</button>';
}
