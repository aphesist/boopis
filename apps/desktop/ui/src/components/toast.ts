/* toast: one line at the top of the work, with an optional action */
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
  n.innerHTML = '<span>' + esc(text) + '</span>' + (o.action ? html.button({ label: o.action.label, size: 's', variant: 'ghost' }) : '');
  const b = n.querySelector('button');
  if (b) b.addEventListener('click', () => { o.action?.onClick?.(); hideToast(); });
  requestAnimationFrame(() => n.classList.add('is-in'));
  holdMs = o.ms || (o.action ? 6000 : 3000);
  arm();
  return n;
}
toast.hide = hideToast;
