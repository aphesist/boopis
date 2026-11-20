/* The themed select and the listbox it opens (HX.ui.select, HX.ui.listbox). A select-only combobox: a button shows the
   choice and opens a `listbox` of `option`s (grouped, scrolling with the thin themed bar) in the library's one layer, so
   only one is open at a time, Esc closes it and focus goes back to the button.
   Keyboard (closed): Down, Up, Home, End and a typed letter open it; Enter and Space too (it is a button).
   Keyboard (open): Up, Down, Home, End, PageUp, PageDown move over the enabled options; a typed word jumps to the next
   option that starts with it (repeating one letter cycles); Enter or Space chooses; Esc closes; Tab closes and moves on.
   Events: 'ui:change' {value, option} bubbles from the select and is cancelable; a menu-like caller (a chip) uses
   `listbox.open(anchor, entries, {onSelect})` and keeps its own state. */
import { fire, frag, nid } from '../core/dom';
import { layer } from './layer';
import { flatOptions, listboxHTML, toEntries, triggerHTML } from './select-html';
import type { SelectEntry, SelectOption } from './select-html';

export interface ListboxOpts {
  value?: string | null | undefined; label?: string | undefined; place?: 'above' | 'below' | undefined; align?: 'start' | 'end' | 'center' | undefined;
  layer?: Element | undefined; onSelect?: ((value: string, option: SelectOption) => void) | undefined; onClose?: (() => void) | undefined;
  /** the first typed letter, when the list was opened by typing */
  query?: string | undefined;
  /** a quiet line under the list (what a choice means), read as the list's description */
  foot?: string | undefined;
}
const TYPE_MS = 700;

/** the thing a listbox is anchored to is the select's trigger, or any button (a chip) that says it has a popup */
function openListbox(anchor: HTMLElement, list: readonly (string | SelectEntry)[], o: ListboxOpts = {}): HTMLElement | null {
  const entries = toEntries(list), id = nid('lb');
  const node = frag(listboxHTML(entries, { id, label: o.label, value: o.value, foot: o.foot }));
  const r = anchor.getBoundingClientRect();
  /* as wide as the field, as tall as the room beside it allows, then scrolls */
  node.style.minWidth = Math.round(r.width) + 'px';
  node.style.maxHeight = Math.max(120, Math.min(360, Math.max(innerHeight - r.bottom, r.top) - 24)) + 'px';
  const shown = layer.open(anchor, node, {
    place: o.place ?? 'below', align: o.align ?? 'start', inset: 0, ...(o.layer ? { layer: o.layer } : {}),
    onClose: () => { anchor.removeAttribute('aria-controls'); o.onClose?.(); }
  });
  if (!shown) return null;
  anchor.setAttribute('aria-controls', id);
  const scroller = node.querySelector<HTMLElement>('.ui-listbox__list') as HTMLElement;
  const options = [...node.querySelectorAll<HTMLElement>('.ui-option')];
  const enabled = (): HTMLElement[] => options.filter((x) => x.getAttribute('aria-disabled') !== 'true');
  const byValue = new Map(flatOptions(entries).map((x) => [x.value, x]));
  const textOf = (x: HTMLElement): string => (x.querySelector('.ui-menu__label')?.textContent ?? '').trim().toLowerCase();

  /* focus moves with the keys (a real focus, so the ring and the screen reader follow); the list scrolls it into view */
  const focusAt = (x: HTMLElement | undefined, center?: boolean): void => {
    if (!x) return;
    x.focus({ preventScroll: true });
    if (center) scroller.scrollTop = x.offsetTop - Math.max(0, (scroller.clientHeight - x.offsetHeight) / 2);
    else x.scrollIntoView?.({ block: 'nearest' });
  };
  const choose = (x: HTMLElement | undefined): void => {
    if (!x || x.getAttribute('aria-disabled') === 'true') return;
    const opt = byValue.get(x.dataset['value'] ?? '');
    if (!opt) return;
    o.onSelect?.(opt.value, opt);
    layer.close();
  };
  node.addEventListener('click', (e) => { choose((e.target as Element).closest<HTMLElement>('.ui-option') ?? undefined); });

  let buffer = '', timer = 0;
  const typeahead = (ch: string): void => {
    const list2 = enabled(), cur = list2.indexOf(document.activeElement as HTMLElement);
    clearTimeout(timer); timer = window.setTimeout(() => { buffer = ''; }, TYPE_MS);
    buffer += ch.toLowerCase();
    const same = buffer.length > 1 && [...buffer].every((c) => c === buffer[0]);
    /* one letter again and again cycles through the options that start with it; a word looks from where focus is */
    const q = same ? buffer[0] ?? '' : buffer, from = same || buffer.length === 1 ? cur + 1 : Math.max(cur, 0);
    const order = list2.slice(from).concat(list2.slice(0, from));
    const hit = order.find((x) => textOf(x).startsWith(q));
    if (hit) focusAt(hit);
  };
  const step = (d: number): void => {
    const list2 = enabled(), cur = list2.indexOf(document.activeElement as HTMLElement);
    focusAt(list2[Math.max(0, Math.min(list2.length - 1, cur < 0 ? (d > 0 ? 0 : list2.length - 1) : cur + d))]);
  };
  node.addEventListener('keydown', (e) => {
    const list2 = enabled();
    const page = Math.max(1, Math.floor(scroller.clientHeight / (options[0]?.offsetHeight || 30)) - 1);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); step(1); return;
      case 'ArrowUp': e.preventDefault(); step(-1); return;
      case 'PageDown': e.preventDefault(); step(page); return;
      case 'PageUp': e.preventDefault(); step(-page); return;
      case 'Home': e.preventDefault(); focusAt(list2[0]); return;
      case 'End': e.preventDefault(); focusAt(list2[list2.length - 1]); return;
      case 'Enter': e.preventDefault(); choose(document.activeElement as HTMLElement); return;
      case ' ': if (buffer) { e.preventDefault(); typeahead(' '); } else { e.preventDefault(); choose(document.activeElement as HTMLElement); } return;
      case 'Tab': layer.close(); return;   /* focus is back on the trigger before Tab moves it on */
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeahead(e.key); }
    }
  });

  const start = options.find((x) => x.getAttribute('aria-selected') === 'true' && x.getAttribute('aria-disabled') !== 'true') ?? enabled()[0];
  focusAt(start, true);
  if (o.query) typeahead(o.query);
  return node;
}

export const listbox = { open: openListbox, close: layer.close };

/** a select drawn on a trigger: its value, its options, and the open list */
export interface SelectElement extends HTMLButtonElement {
  /** the chosen option's value; '' when nothing is chosen. Setting it is quiet: no ui:change */
  value: string;
  /** the options now; the value stays when it is still there, else nothing is chosen */
  setOptions(entries: readonly (string | SelectEntry)[], value?: string | null): void;
  open(): void;
}

export function wireSelect(el: HTMLElement): void {
  const btn = el as SelectElement;
  let entries: SelectEntry[] = [], value = btn.dataset['value'] ?? '';
  try { entries = JSON.parse(btn.dataset['options'] ?? '[]') as SelectEntry[]; } catch { entries = []; }
  const valueId = btn.id + '-v', placeholder = (): string => btn.dataset['placeholder'] ?? 'Choose…';
  const paint = (): void => {
    const cur = flatOptions(entries).find((x) => x.value === value);
    btn.innerHTML = triggerHTML(cur, placeholder(), valueId);
    btn.dataset['value'] = value;
  };
  Object.defineProperty(btn, 'value', { configurable: true, get: () => value, set: (v: string) => { value = String(v ?? ''); paint(); } });
  btn.setOptions = (list, v) => {
    entries = toEntries(list);
    if (v !== undefined) value = v ?? '';
    else if (!flatOptions(entries).some((x) => x.value === value)) value = '';
    btn.dataset['options'] = JSON.stringify(entries);
    paint();
  };
  const open = (query?: string): void => {
    if (btn.disabled) return;
    const label = btn.getAttribute('aria-label') ?? (btn.getAttribute('aria-labelledby')?.split(' ').map((i) => document.getElementById(i)).find((n) => n && n.id !== valueId)?.textContent?.trim() ?? undefined);
    listbox.open(btn, entries, {
      value, label, query,
      onSelect: (v, option) => {
        if (v === value) return;
        if (fire(btn, 'ui:change', { value: v, option }, true)) { value = v; paint(); }
      }
    });
  };
  btn.open = () => { open(); };
  btn.addEventListener('click', () => { open(); });
  btn.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); open(); return; }
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(e.key); }
  });
}
