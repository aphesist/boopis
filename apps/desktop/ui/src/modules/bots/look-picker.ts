/* The look picker: Colour and Shape, as tabs over one row of choices. The new-bot sheet makes a look with it and a bot's
   settings change one with it (the look editor), so a look is chosen the same way in both. Each tab is a radiogroup (the
   arrow keys, Home and End move and choose). The tiles are built when the tab changes, never on a choice: rebuilding 15
   orb canvases (each with its 3D body) on every click cost 45-90 ms in WebKitGTK right as the morph started, so its
   first frames dropped and the change read as a jump. A choice moves the selection; a new colour repaints the shape
   tiles in place. Eyes are never offered: they belong to the state, never to a look (owner decision, 19 November 2026).
   The palettes are the kit's (bot data, not interface colour). */
import { cap1, el } from '../../core/dom';
import { ui } from '@boopis/ui';
import { paintOrbColour, SHAPES, SWATCHES } from './paint';

export type LookTab = 'colour' | 'shape';
export interface LookValue { shape: string; color: string }
export interface LookPickerOpts {
  value: LookValue;
  tab?: LookTab;
  /** a choice was made: the look as it is now, and which part changed */
  onPick(what: 'color' | 'shape', look: LookValue): void;
  onTab?(tab: LookTab): void;
  /** sits at the end of the tabs' line (the look editor's dice) */
  aside?: HTMLElement | null;
  class?: string;
}
export interface LookPicker {
  el: HTMLElement;
  /** the look the picker shows now */
  readonly value: LookValue;
  /** shows another look (a roll, a suggestion, a save undone) without calling `onPick` */
  set(look: LookValue): void;
}

/** the shapes on offer: the picker's list, narrowed by what this orb2 can draw */
export const offeredShapes = (): string[] => (window.OrbAvatar && window.OrbAvatar.bodyShapes ? window.OrbAvatar.bodyShapes.filter((s) => SHAPES.includes(String(s))).map(String) : SHAPES);
/** "mint circle": a look in words (an announcement, a section's meta) */
export const lookWords = (l: LookValue): string => (SWATCHES.find(([c]) => c === l.color)?.[1] ?? 'new colour').toLowerCase() + ' ' + l.shape;

export function lookPicker(o: LookPickerOpts): LookPicker {
  const value: LookValue = { shape: o.value.shape, color: o.value.color };
  let tab: LookTab = o.tab ?? 'colour';
  const TABS = [['colour', 'Colour'], ['shape', 'Shape']] as const;
  const rowId = 'bt-pick-' + Math.random().toString(36).slice(2, 7);
  const tabs = ui.segmented({ mode: 'tabs', label: 'Appearance', value: tab, options: TABS.map(([v, label]) => ({ value: v, label })), controls: { colour: rowId, shape: rowId } });
  const row = el('div', { class: 'bt-pick', role: 'tabpanel', id: rowId });
  const head = o.aside ? el('div', { class: 'bt-appearance-head' }, [tabs, o.aside]) : tabs;
  const root = el('div', { class: 'bt-appearance' + (o.class ? ' ' + o.class : '') }, [head, row]);

  const current = (): string => (tab === 'colour' ? value.color : value.shape);
  function syncRow(): void {
    const cur = current();
    for (const b of row.querySelectorAll<HTMLElement>('.bt-opt')) { const on = b.dataset['val'] === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  }
  function recolourRow(): void {
    if (tab === 'colour') return;
    for (const orb of row.querySelectorAll('.bt-opt orb-avatar')) paintOrbColour(orb, value.color);
  }
  function paintRow(): void {
    row.textContent = ''; row.dataset['kind'] = tab;
    row.setAttribute('aria-label', cap1(tab));
    const opts: ReadonlyArray<readonly [string, string] | string> = tab === 'colour' ? SWATCHES : offeredShapes();
    const group = el('div', { class: 'bt-opts', role: 'radiogroup', 'aria-label': cap1(tab) });
    for (const opt of opts) {
      const val = typeof opt === 'string' ? opt : opt[0];
      const lab = typeof opt === 'string' ? cap1(opt) : opt[1];
      const on = current() === val;
      /* the picker tiles are the one place orbs stay still: 28px, many at once, a choice not a creature; no id, so a tile is
         never taken for the bot itself when its look is repainted */
      const inner = tab === 'colour'
        ? el('span', { class: 'bt-swatch', style: '--c:' + val })
        : ui.orb({ shape: val, color: value.color, name: lab }, { size: 28, still: true });
      group.append(el('button', {
        class: 'bt-opt', type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': lab, 'data-tip': lab, 'data-val': val, tabindex: on ? '0' : '-1',
        onclick: () => choose(val)
      }, inner));
    }
    group.addEventListener('keydown', (e) => {
      const items = [...group.children] as HTMLElement[], i = items.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = items.length - 1;
      const t = items[j];
      if (j >= 0 && t) { e.preventDefault(); t.focus(); t.click(); }
    });
    row.append(group);
  }
  function choose(val: string): void {
    const what = tab === 'colour' ? 'color' : 'shape';
    const changed = value[what] !== val;
    value[what] = val;
    syncRow();
    const sel = row.querySelector<HTMLElement>('[aria-checked="true"]');
    if (sel && sel !== document.activeElement) sel.focus({ preventScroll: true });
    if (changed || what === 'color') o.onPick(what, { ...value });
  }
  tabs.addEventListener('ui:change', (e) => { tab = (e as CustomEvent<{ value: string }>).detail.value as LookTab; paintRow(); o.onTab?.(tab); });
  paintRow();
  return {
    el: root,
    get value() { return { ...value }; },
    set(look) { value.shape = look.shape; value.color = look.color; recolourRow(); syncRow(); }
  };
}
