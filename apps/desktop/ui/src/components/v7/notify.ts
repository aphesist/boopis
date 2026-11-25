/* The floating Notice at work (DESIGN-SYSTEM.md v7 21.2 row 12, 21.3: "the toast becomes the floating Notice, a 44 pill"): one line
   that tells the person something the app did, with up to two actions and a dismiss. One at a time: a new one takes the place of the
   one showing. It stays 3 s (6 s with an action), longer while the pointer or the focus is on it, then fades (`--dur-2`; reduced
   motion: at once). It is a polite status, never an alert, except in the red tone. The host is the app's `[data-notify-host]` (a v7
   root), else `#hx-app` or the body; where it sits is the host's CSS (`.k7-notify`). */
import { frag } from '../../core/dom';
import { notice } from './blocks';
import { wire } from './wire';

export interface NotifyOpts {
  action?: { label: string; onClick?: () => void } | undefined; ms?: number | undefined; tone?: 'neutral' | 'owe' | 'accent' | 'red' | undefined;
}
let node: HTMLElement | null = null, timer = 0, holdMs = 3000;
const hide = (): void => { if (node) node.removeAttribute('data-in'); };
const arm = (): void => { clearTimeout(timer); timer = window.setTimeout(hide, holdMs); };
const hold = (): void => { clearTimeout(timer); };

/** show `text` in the floating Notice; returns its element */
export function notify(text: string, o: NotifyOpts = {}): HTMLElement {
  if (!node || !node.isConnected) {
    node = document.createElement('div');
    node.className = 'k7-notify';
    (document.querySelector('[data-notify-host]') ?? document.getElementById('hx-app') ?? document.body).appendChild(node);
    node.addEventListener('pointerenter', hold); node.addEventListener('pointerleave', arm);
    node.addEventListener('focusin', hold); node.addEventListener('focusout', arm);
  }
  const n = node;
  const el = wire(frag(notice({ text, place: 'floating', tone: o.tone ?? 'neutral', dismiss: true, ...(o.action ? { actions: [{ label: o.action.label }] } : {}) })));
  n.replaceChildren(el);
  el.querySelector<HTMLElement>('[data-kit~="Button"]')?.addEventListener('click', () => { o.action?.onClick?.(); hide(); });
  el.querySelector<HTMLElement>('[aria-label="Dismiss"]')?.addEventListener('click', hide);
  requestAnimationFrame(() => { n.setAttribute('data-in', ''); });
  holdMs = o.ms || (o.action ? 6000 : 3000);
  arm();
  return n;
}
/** the Notice showing now, for tests: its words, or '' */
export const notifyText = (): string => node?.querySelector('.k7-notice__text')?.textContent ?? '';
