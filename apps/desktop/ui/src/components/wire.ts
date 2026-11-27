/* Behaviours: `hydrate(root)` wires every [data-ui] element under root once (string-built markup).
   Events bubble from the element and are cancelable where an action follows:
     'ui:change' {value} segmented, switch, chip, option group, section, disclosure
     'ui:commit' hold to approve finished;  'ui:select' {value, item} menu item, row */
import { fire } from '../core/dom';
import { wireHold } from './hold';
import { fitTabs } from './tabs';

export interface UiChange<V = string> { value: V; index?: number }
export interface UiSelect { value: string | undefined; item: HTMLElement | unknown }

/** a segmented control or page dots: `select` moves the thumb quietly (no ui:change) */
export interface SegElement extends HTMLElement { select(value: string): void }

const WIRED = new WeakSet<Element>();
type Wire = (el: HTMLElement) => void;

/* segmented, page dots: one tab stop, arrows move and select, the thumb slides by transform */
function wireSeg(root: HTMLElement): void {
  const opts = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(':scope > [role="tab"], :scope > [role="radio"]')];
  const vertical = root.getAttribute('aria-orientation') === 'vertical';
  const sel = (b: HTMLElement): string => (b.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-checked');
  function select(b: HTMLElement, focus: boolean, quiet?: boolean): void {
    const list = opts(), i = list.indexOf(b);
    if (i < 0) return;
    const prev = list.find((x) => x.getAttribute(sel(x)) === 'true');
    if (prev === b) { if (focus) b.focus(); return; }
    if (!quiet && !fire(root, 'ui:change', { value: b.dataset['value'], index: i }, true)) return;
    list.forEach((x, j) => { x.setAttribute(sel(x), String(j === i)); x.tabIndex = j === i ? 0 : -1; });
    root.style.setProperty('--i', String(i));
    if (focus) b.focus();
  }
  root.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('[role="tab"], [role="radio"]'); if (b && root.contains(b)) select(b, false); });
  root.addEventListener('keydown', (e) => {
    const list = opts(), i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = ({ [vertical ? 'ArrowDown' : 'ArrowRight']: i + 1, [vertical ? 'ArrowUp' : 'ArrowLeft']: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (next == null) return;
    e.preventDefault();
    const target = list[(next + list.length) % list.length];
    if (target) select(target, true);
  });
  (root as SegElement).select = (value: string): void => { const b = opts().find((x) => x.dataset['value'] === String(value)); if (b) select(b, false, true); };
}
/* option chips (role=radio): the same keyboard as the segmented control, no thumb */
function wireOptions(root: HTMLElement): void {
  const opts = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="radio"]')];
  function select(b: HTMLElement, focus: boolean): void {
    if (!fire(root, 'ui:change', { value: b.dataset['value'] }, true)) return;
    opts().forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    if (focus) b.focus();
  }
  root.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('[role="radio"]'); if (b) select(b, false); });
  root.addEventListener('keydown', (e) => {
    const list = opts(), i = list.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
    const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key]; if (!d) return;
    e.preventDefault();
    const t = list[(i + d + list.length) % list.length]; if (t) select(t, true);
  });
}
/* rows: Up and Down move between rows (Home, End); Enter or Space opens the row; one tab stop per list */
function wireRows(root: HTMLElement): void {
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.ui-row')].filter((r) => r.offsetParent !== null);
  const sync = (): void => { const list = rows(); const cur = list.find((r) => r.getAttribute('aria-current')) ?? list[0]; list.forEach((r) => { r.tabIndex = r === cur ? 0 : -1; }); };
  sync();
  root.addEventListener('keydown', (e) => {
    const list = rows(), i = list.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
    const n = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key]; if (n == null) return;
    e.preventDefault();
    const t = list[Math.max(0, Math.min(list.length - 1, n))];
    if (!t) return;
    list.forEach((r) => { r.tabIndex = r === t ? 0 : -1; }); t.focus();
  });
  root.addEventListener('click', (e) => {
    const r = (e.target as Element).closest<HTMLElement>('.ui-row'); if (!r || !root.contains(r)) return;
    if (!fire(r, 'ui:select', { value: r.dataset['value'], item: r }, true)) return;
    root.querySelectorAll('.ui-row[aria-current]').forEach((x) => x.removeAttribute('aria-current'));
    r.setAttribute('aria-current', 'true'); sync();
  });
}
const toggler: Wire = (el) => el.addEventListener('click', () => { const open = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', String(open)); fire(el, 'ui:change', { value: open }); });

const WIRE: Record<string, Wire> = {
  hold: (el) => { wireHold(el as HTMLButtonElement); },
  seg: wireSeg,
  options: wireOptions,
  pages: wireSeg,
  /* a tab bar: the segmented control's keyboard and selection, no thumb; a scrolling strip keeps the open tab in view */
  tabs: (el) => {
    wireSeg(el);
    if (!el.classList.contains('ui-tabs--scroll')) return;
    el.addEventListener('ui:change', () => { requestAnimationFrame(() => fitTabs(el)); });
    requestAnimationFrame(() => fitTabs(el));
    /* the fade follows the strip's width and its tabs' widths: a resized window, or the web font arriving after the first
       layout (wider labels), can make the strip overflow, or stop, after it was first fitted */
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { fitTabs(el); });
      ro.observe(el);
      for (const t of el.querySelectorAll('.ui-tab')) ro.observe(t);
    }
  },
  rows: wireRows,
  section: toggler,
  disclosure: (el) => el.addEventListener('click', () => {
    const open = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', String(open));
    const id = el.getAttribute('aria-controls'), t = id ? document.getElementById(id) : null; if (t) t.hidden = !open;
    fire(el, 'ui:change', { value: open });
  }),
  chip: (el) => { if (el.hasAttribute('aria-pressed')) el.addEventListener('click', () => { const v = el.getAttribute('aria-pressed') !== 'true'; if (fire(el, 'ui:change', { value: v }, true)) el.setAttribute('aria-pressed', String(v)); }); },
  switch: (el) => el.addEventListener('change', () => fire(el, 'ui:change', { value: (el as HTMLInputElement).checked })),
  autosize: (el) => { const fit = (): void => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }; el.addEventListener('input', fit); requestAnimationFrame(fit); },
  send: () => { /* the composer owns it */ }
};

export function hydrateOne(el: Element | null | undefined): void {
  if (!el || el.nodeType !== 1) return;
  const h = el as HTMLElement;
  const kind = h.dataset['ui'];
  if (kind && !WIRED.has(h)) { WIRED.add(h); WIRE[kind]?.(h); }
  for (const c of h.querySelectorAll<HTMLElement>('[data-ui]')) if (!WIRED.has(c)) { WIRED.add(c); WIRE[c.dataset['ui'] ?? '']?.(c); }
}
export function hydrate<E extends Element>(root?: E | null): E | null | undefined { hydrateOne(root ?? document.body); return root; }
