/* The look picker: Colour and Shape, as the kit's Segmented tabs over one panel of choices (the kit's Swatches: the colours as circles, the
   shapes as the bot's still orb at 28 in its colour). The new-bot form makes a look with it and a bot's settings change one with it (the
   look editor), so a look is chosen the same way in both. Each panel is the Swatches' radio group (a press, the arrows, Home and End
   choose; ui:change). The panel is drawn when the tab changes, never on a choice: rebuilding 15 orb canvases (each with its 3D body) on
   every click cost 45-90 ms in WebKitGTK right as the morph started, so its first frames dropped and the change read as a jump. A choice
   moves the selection; a new colour repaints the shape faces in place. Eyes are never offered: they belong to the state, never to a look
   (owner decision, 19 November 2026). The palettes are the kit's (bot data, not interface colour). */
import { cap1, el } from '../../core/dom';
import { kit } from '@boopis/ui';
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

let seq = 0;
export function lookPicker(o: LookPickerOpts): LookPicker {
  const value: LookValue = { shape: o.value.shape, color: o.value.color };
  let tab: LookTab = o.tab ?? 'colour';
  const panelId = 'bt-look-' + (++seq);
  const tabs = kit.segmented({ variant: 'tabs', label: 'Look', value: tab, items: [{ value: 'colour', label: 'Colour', controls: panelId }, { value: 'shape', label: 'Shape', controls: panelId }] });
  const panel = el('div', { class: 'bt-look__panel', role: 'tabpanel', id: panelId });
  const head = el('div', { class: 'bt-look__head' }, o.aside ? [tabs, o.aside] : [tabs]);
  const root = el('div', { class: 'bt-look' + (o.class ? ' ' + o.class : ''), 'data-look': '' }, [head, panel]);

  const current = (): string => (tab === 'colour' ? value.color : value.shape);
  const group = (): HTMLElement | null => panel.querySelector<HTMLElement>('[data-kit~="Swatches"]');
  /** the selection follows the look without redrawing the panel */
  function sync(): void {
    const cur = current();
    for (const b of panel.querySelectorAll<HTMLElement>('[role="radio"]')) { const on = b.dataset['value'] === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  }
  function recolour(): void {
    if (tab === 'colour') return;
    for (const orb of panel.querySelectorAll('orb-avatar')) paintOrbColour(orb, value.color);
  }
  function paint(): void {
    panel.setAttribute('aria-label', cap1(tab));
    panel.dataset['kind'] = tab;
    /* the picker's faces are the one place orbs stay still: 28px, many at once, a choice not a creature; no id, so a face is never taken
       for the bot itself when its look is repainted */
    const items = tab === 'colour'
      ? SWATCHES.map(([hex, label]) => ({ label, hex, value: hex }))
      : offeredShapes().map((s) => ({ label: cap1(s), hex: value.color, value: s, face: kit.html.avatar({ bot: { shape: s, color: value.color, name: cap1(s) }, size: 28, still: true }) }));
    panel.replaceChildren(kit.swatches({ label: cap1(tab), choose: true, value: current(), items, attrs: { 'data-look-kind': tab } }));
  }
  panel.addEventListener('ui:change', (e) => {
    if (e.target !== group()) return;
    const val = String((e as CustomEvent<{ value: string }>).detail.value);
    const what = tab === 'colour' ? 'color' : 'shape';
    if (value[what] === val) return;
    value[what] = val;
    o.onPick(what, { ...value });
  });
  tabs.addEventListener('ui:change', (e) => { tab = (e as CustomEvent<{ value: string }>).detail.value as LookTab; paint(); o.onTab?.(tab); });
  paint();
  return {
    el: root,
    get value() { return { ...value }; },
    set(look) { value.shape = look.shape; value.color = look.color; recolour(); sync(); }
  };
}
