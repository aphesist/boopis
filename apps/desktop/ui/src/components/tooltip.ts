/* tooltip: delegated on [data-tip] (+ data-kbd, data-tip-pos), one element for the app. 480ms before the first, none
   while warm (700ms after the last), at once on keyboard focus. It repeats the button's aria-label for sight, so it
   is hidden from assistive tech; shortcuts go in aria-keyshortcuts. */
import { html } from './html';

let node: HTMLElement | null = null, timer = 0, warm = 0, cur: Element | null = null, enabled = false;
const host = (): HTMLElement => document.getElementById('hx-app') ?? document.body;
const tipTarget = (e: Event): HTMLElement | null => { const t = e.target; return t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null; };

function show(t: HTMLElement, now: boolean): void {
  clearTimeout(timer);
  const label = t.getAttribute('data-tip'); if (!label) return;
  timer = window.setTimeout(() => {
    if (!t.isConnected || t.closest('[inert]')) return;
    if (!node || !node.isConnected) { node = document.createElement('div'); node.className = 'ui-tip'; node.setAttribute('aria-hidden', 'true'); host().appendChild(node); }
    const n = node;
    cur = t;
    const state = t.getAttribute('data-tip-state'), tone = t.getAttribute('data-tip-tone'), kbd = t.getAttribute('data-kbd');
    n.innerHTML = html.tipBody(label, kbd, state ? { text: state, tone } : null);
    const r = t.getBoundingClientRect(), w = n.offsetWidth, h = n.offsetHeight;
    const pos = t.getAttribute('data-tip-pos') || (r.top > innerHeight - 160 ? 'top' : 'bottom');
    let x: number, y: number;
    if (pos === 'right') { x = r.right + 10; y = r.top + r.height / 2 - h / 2; n.style.setProperty('--tip-dy', '0px'); }
    else if (pos === 'top') { x = r.left + r.width / 2 - w / 2; y = r.top - h - 8; n.style.setProperty('--tip-dy', '3px'); }
    else { x = r.left + r.width / 2 - w / 2; y = r.bottom + 8; n.style.setProperty('--tip-dy', '-3px'); }
    n.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'; n.style.top = Math.max(8, y) + 'px';
    requestAnimationFrame(() => n.classList.add('is-in'));
  }, now || performance.now() < warm ? 0 : 480);
}
function hide(): void { clearTimeout(timer); if (cur) warm = performance.now() + 700; cur = null; if (node) node.classList.remove('is-in'); }
function enable(): void {
  if (enabled) return; enabled = true;
  document.addEventListener('pointerover', (e) => { const t = tipTarget(e); if (!t || t === cur || e.pointerType === 'touch') return; show(t, false); });
  document.addEventListener('pointerout', (e) => { const t = tipTarget(e); if (t && (!e.relatedTarget || !t.contains(e.relatedTarget as Node))) hide(); });
  document.addEventListener('focusin', (e) => { const t = tipTarget(e); if (t && t.matches(':focus-visible')) show(t, true); else hide(); });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}
export const tooltip = { enable, show: (t: HTMLElement): void => show(t, true), hide, refresh: (t: HTMLElement): void => { if (cur === t) show(t, true); } };
