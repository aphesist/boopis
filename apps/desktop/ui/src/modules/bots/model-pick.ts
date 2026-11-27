/* A bot's model, chosen in the kit's Menu (step 2a: the v6 select and its listbox went): the field is the kit's SelectorItem (the model's
   mark and its name, the chevron), and it opens a list Menu of the models, one heading per provider where there are several, the one
   chosen checked, each row led by its provider's mark in its brand colour (design system 10.1: a list of models is the picker). The
   Menu has the kit's keys: the arrows, Home and End, a letter, Enter and Space; Esc closes it and the focus goes back to the field. */
import { kit, ui } from '@boopis/ui';

type MenuEntry = Parameters<typeof kit.openMenu>[1]['entries'][number];

const lead = (m: string, size: number): string => ui.html.modelMark(m, { size, color: 'brand', label: false });

/** the field: the model's mark and its name, or the placeholder; `name` is the handle the module finds it by */
export function modelFieldHTML(name: string, label: string, value: string, o: { disabled?: boolean } = {}): string {
  return kit.html.selectorItem({ variant: 'field', label, value: value ? ui.modelMark.called(value) || value : 'Choose a model', ...(value ? { leadHTML: lead(value, 14) } : {}),
    attrs: { 'data-model-pick': name, 'data-label': label, 'data-value': value, ...(o.disabled ? { disabled: '', 'aria-disabled': 'true' } : {}) } });
}

/** the Menu's rows: the models by provider (a heading for each where there are several), in the order each provider first appears */
export function modelMenuEntries(models: readonly string[], value: string): MenuEntry[] {
  const groups = new Map<string, { name: string; list: string[] }>();
  for (const m of new Set(models)) {
    const f = ui.modelMark.family(m);
    const g = groups.get(f.id) ?? { name: f.name, list: [] };
    g.list.push(m); groups.set(f.id, g);
  }
  const row = (m: string): MenuEntry => ({ label: ui.modelMark.called(m) || m, value: m, role: 'menuitemradio', checked: m === value, leadHTML: lead(m, 16) });
  return groups.size < 2 ? [...groups.values()].flatMap((g) => g.list.map(row)) : [...groups.values()].flatMap((g) => [{ heading: g.name } as MenuEntry, ...g.list.map(row)]);
}

/** open the models' Menu under the field; a choice redraws the field's value and calls `onPick` */
export function openModelMenu(field: HTMLElement, o: { label: string; models: readonly string[]; value: string; onPick: (value: string) => void }): void {
  if (field.hasAttribute('disabled')) return;
  kit.openMenu(field, {
    label: o.label, variant: 'list', entries: modelMenuEntries(o.models, o.value), place: 'below', align: 'start',
    onSelect: (v) => { paintModelField(field, v); o.onPick(v); }
  });
}

/** the field opens its Menu on a press, Enter or Space (it is a button), and on the Down or Up arrow, as a select does */
export function wireModelField(field: HTMLElement, open: () => void): void {
  field.addEventListener('click', open);
  field.addEventListener('keydown', (e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); open(); } });
}

/** show a model in the field, as the Menu chose it or a save undid it */
export function paintModelField(field: HTMLElement, value: string): void {
  const label = field.dataset['label'] ?? 'Model';
  const next = document.createRange().createContextualFragment(modelFieldHTML(field.dataset['modelPick'] ?? '', label, value)).firstElementChild;
  if (!next) return;
  field.dataset['value'] = value;
  field.setAttribute('aria-label', next.getAttribute('aria-label') ?? label);
  field.replaceChildren(...next.childNodes);
}
