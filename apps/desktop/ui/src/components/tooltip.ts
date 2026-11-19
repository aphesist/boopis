/* tooltip: delegated on [data-tip] (+ data-kbd, data-tip-pos on the control or a container), one element for the app, placed by
   the library's one placement primitive (place.ts). 480ms before the first, none
   while warm (700ms after the last), at once on keyboard focus. It repeats the button's aria-label for sight, so it
   is hidden from assistive tech; shortcuts go in aria-keyshortcuts. */
import { html } from './html';
import { parsePos, placeAt } from './place';
import type { Side } from './place';

let node: HTMLElement | null = null, timer = 0, warm = 0, cur: Element | null = null, enabled = false;
/* R-elev-6: under a modal dialog (the top layer) the tip mounts inside it, as the menus do (layer.ts) */
const host = (t: Element): Element => t.closest('dialog, [data-layer-host]') ?? document.getElementById('hx-app') ?? document.body;
const tipTarget = (e: Event): HTMLElement | null => { const t = e.target; return t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null; };

function show(t: HTMLElement, now: boolean): void {
  clearTimeout(timer);
  const label = t.getAttribute('data-tip'); if (!label) return;
  timer = window.setTimeout(() => {
    if (!t.isConnected || t.closest('[inert]')) return;
    if (!node) { node = document.createElement('div'); node.className = 'ui-tip'; node.setAttribute('aria-hidden', 'true'); }
    const into = host(t);
    if (node.parentElement !== into) into.appendChild(node);
    const n = node;
    cur = t;
    const state = t.getAttribute('data-tip-state'), tone = t.getAttribute('data-tip-tone'), kbd = t.getAttribute('data-kbd');
    n.innerHTML = html.tipBody(label, kbd, state ? { text: state, tone } : null);
    /* the control's preferred side (its own data-tip-pos or a container's), else below, or above near the window's foot;
       place.ts flips, shifts and keeps clear of a text the container names */
    const pref = parsePos(t.closest('[data-tip-pos]')?.getAttribute('data-tip-pos'));
    const side: Side = pref ? pref.side : t.getBoundingClientRect().top > innerHeight - 160 ? 'top' : 'bottom';
    const p = placeAt(n, t, { side, align: pref?.align ?? 'center' });
    n.style.setProperty('--tip-dy', p.side === 'top' ? '3px' : p.side === 'bottom' ? '-3px' : '0px');
    /* fonts and key chips settle after the first measure: place once more before it shows, so a tip held at the window's edge sits on its margin */
    requestAnimationFrame(() => { if (cur === t) placeAt(n, t, { side: p.side, align: p.align }); n.classList.add('is-in'); });
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
