/* The floating Notice at run time (DESIGN-SYSTEM.md v7 21.2 row 12, 21.3: "the toast becomes the floating Notice, a 44 pill",
   board 03): one line about the app at the bottom centre, with at most one action, one at a time (a newer one takes its place).
   It enters over --dur-1 (the Notice's own entrance), stays while the pointer or the focus is on it, and goes after a while.
   It is drawn on a v7 root of its own that follows the theme of the root it is shown over, and inside the top-most open modal
   dialog when there is one, so a modal's scrim never covers it. The template is blocks.ts `notice`. */
import { frag } from '../../core/dom';
import { notice } from './blocks';
import type { NoticeOpts } from './blocks';
import { wire } from './wire';

export interface NotifyOpts {
  tone?: NoticeOpts['tone']; icon?: string | undefined;
  /** one action: its label and what it does; the notice goes once it is pressed */
  action?: { label: string; onClick?: () => void } | undefined;
  /** how long it stays, in ms (default 4 s, 6 s with an action) */
  ms?: number | undefined;
}

let host: HTMLElement | null = null;
let timer = 0;
let hold = 4000;

/** where it shows: the top-most open modal dialog (the top layer), else the app's root, else the page */
function placeOf(): HTMLElement {
  const modal = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => d.matches(':modal')).pop();
  return modal ?? document.getElementById('hx-app') ?? document.body;
}
/** the theme of the v7 root it is shown over (the dialog's or the app's), else the page's colour scheme */
function themeOf(place: HTMLElement): 'dark' | 'light' {
  const root = place.closest<HTMLElement>('[data-ui="v7"]') ?? place.querySelector<HTMLElement>('[data-ui="v7"]');
  const t = root?.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return getComputedStyle(document.documentElement).colorScheme.includes('light') ? 'light' : 'dark';
}
const arm = (): void => { clearTimeout(timer); timer = window.setTimeout(hide, hold); };
const pause = (): void => clearTimeout(timer);

/** hide the notice that is showing */
export function hide(): void {
  clearTimeout(timer);
  host?.replaceChildren();
}

/** show one line; a notice already showing is replaced */
export function notify(text: string, o: NotifyOpts = {}): HTMLElement {
  const place = placeOf();
  if (!host) {
    host = document.createElement('div');
    host.className = 'k7-float';
    host.addEventListener('pointerenter', pause); host.addEventListener('pointerleave', arm);
    host.addEventListener('focusin', pause); host.addEventListener('focusout', arm);
  }
  if (host.parentElement !== place) place.append(host);
  host.setAttribute('data-ui', 'v7');
  host.setAttribute('data-theme', themeOf(place));
  const n = wire(frag(notice({ text, place: 'floating', tone: o.tone ?? 'neutral', icon: o.icon, ...(o.action ? { actions: [{ label: o.action.label }] } : {}), attrs: { 'data-enter': '' } })));
  const b = n.querySelector<HTMLButtonElement>('[data-kit~="Button"]');
  b?.addEventListener('click', () => { o.action?.onClick?.(); hide(); });
  host.replaceChildren(n);
  hold = o.ms ?? (o.action ? 6000 : 4000);
  arm();
  return n;
}
