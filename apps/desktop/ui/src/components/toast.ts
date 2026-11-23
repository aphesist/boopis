/* toast: one line at the top of the work, with an optional action */
import { on } from '../core/bus';
import { esc } from '../core/dom';
import { html } from './html';

let node: HTMLElement | null = null, timer = 0, holdMs = 3000;
export interface ToastOpts { action?: { label: string; onClick?: () => void } | undefined; ms?: number | undefined }

function hideToast(): void { if (node) node.classList.remove('is-in'); }
const arm = (): void => { clearTimeout(timer); timer = window.setTimeout(hideToast, holdMs); };
const hold = (): void => clearTimeout(timer);

export function toast(text: string, o: ToastOpts = {}): HTMLElement {
  if (!node || !node.isConnected) {
    node = document.createElement('div'); node.className = 'ui-toast'; node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
    (document.getElementById('hx-app') ?? document.body).appendChild(node);
    node.addEventListener('pointerenter', hold); node.addEventListener('pointerleave', arm);
    node.addEventListener('focusin', hold); node.addEventListener('focusout', arm);
  }
  const n = node;
  n.innerHTML = '<span>' + esc(text) + '</span>' + (o.action ? html.button({ label: o.action.label, size: 's', variant: 'ghost', class: 'ui-corner' }) : '');
  const b = n.querySelector('button');
  if (b) b.addEventListener('click', () => { o.action?.onClick?.(); hideToast(); });
  requestAnimationFrame(() => n.classList.add('is-in'));
  holdMs = o.ms || (o.action ? 6000 : 3000);
  arm();
  return n;
}
toast.hide = hideToast;

/* A toast sits on the shell's centre line (--hx-center-x-to, which the shell publishes on #hx-app with its first layout). A
   notice the host hands over while the app is still loading (the bots' repair, the watchdog) has no line to sit on yet, and
   the registered --hx-center-x drew it at its initial 0px: half off the window's left edge, then moved once the shell laid
   out (the owner's recording, 0.1.9). `whenReady` shows it once the shell has booted (`hx:ready`), at once when it has, and
   never before; without the app's root (a lone component) there is nothing to wait for. A layer that covers the whole window
   before the shell boots (first run) calls `toast` itself: the toast then centres on the window (components.css). */
const owed: Array<{ text: string; o: ToastOpts }> = [];
const booting = (): boolean => !!document.getElementById('hx-app')?.classList.contains('is-booting');
on('hx:ready', () => { for (const t of owed.splice(0)) toast(t.text, t.o); });
toast.whenReady = (text: string, o: ToastOpts = {}): void => { if (booting()) owed.push({ text, o }); else toast(text, o); };
