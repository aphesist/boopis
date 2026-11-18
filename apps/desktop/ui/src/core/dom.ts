/* DOM and string helpers shared by every module (one implementation per concern, STANDARDS section 1).
   `$` throws when an element the markup promises is missing: that is a programmer error, never user input. */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);

export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue>;
/** attributes as a string: null, undefined and false are dropped, true is a bare attribute */
export const attrs = (o?: Attrs | null): string =>
  Object.entries(o ?? {})
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => (v === true ? ' ' + k : ' ' + k + '="' + esc(v) + '"'))
    .join('');
export const cx = (...a: unknown[]): string => a.filter(Boolean).join(' ');
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const isMac: boolean = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/* reduced motion: one query for the app. Reduce, never freeze (owner decision). */
const RMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reduced = (): boolean => !!RMQ && RMQ.matches;
export const onReducedChange = (fn: (reduced: boolean) => void): void => {
  if (RMQ && RMQ.addEventListener) RMQ.addEventListener('change', (e) => fn(e.matches));
};

let uid = 0;
export const nid = (prefix = 'ui'): string => prefix + (++uid).toString(36);

/** The first element of an HTML string, parsed through a template (nothing runs). */
export function frag<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const first = t.content.firstElementChild;
  if (!first) throw new Error('frag: no element in ' + html.slice(0, 40));
  return first as T;
}

/** Dispatch a bubbling CustomEvent; false when a listener called preventDefault on a cancelable one. */
export function fire<D>(el: EventTarget, type: string, detail?: D, cancelable = false): boolean {
  return el.dispatchEvent(new CustomEvent<D>(type, { detail: detail as D, bubbles: true, cancelable }));
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const n = root.querySelector<T>(sel);
  if (!n) throw new Error('missing element: ' + sel);
  return n;
}
export const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));

/** A token's value in ms (a duration custom property), with a fallback. */
export function tokenMs(name: string, fallback: number): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return isNaN(n) ? fallback : /ms$/.test(v) ? n : n * 1000;
}

export type Kids = Node | string | null | undefined | false | readonly Kids[];
/** createElement with attributes and children. Keys: class, html, text, on<event>; anything else is an attribute. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, a?: Record<string, unknown> | null, kids?: Kids): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (a) {
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = String(v);
      else if (k === 'html') n.innerHTML = String(v);
      else if (k === 'text') n.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v as EventListener);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  const add = (c: Kids): void => {
    if (c == null || c === false || c === '') return;
    if (Array.isArray(c)) c.forEach(add);
    else n.append(c as Node | string);
  };
  add(kids);
  return n;
}

export const focusable = (n: Element | null): n is HTMLElement => !!n && typeof (n as HTMLElement).focus === 'function';
export const isField = (n: EventTarget | null): boolean =>
  n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
export const hhmm = (d = new Date()): string => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
export const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
