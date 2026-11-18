/* Orbs in the bots tab. Drawn by the library (ui.orb: one wrapper, the state map, light eyes on dark bodies).
   Owner decision: reduced motion reduces and never freezes; ui.liven / glance keep orbs over 16px live, lower the
   jelly and give small glances under reduced motion. Every live orb answers: click pokes (orb2 escalates on repeats),
   hover looks at the pointer and listens, double-click plays an emote. */
import { el, reduced } from '../../core/dom';
import { ui } from '../../components';
import type { OrbOpts } from '../../components/orb';
import { oc } from '../../components/orb';
import type { BotLike } from '../../components';
import { S } from './model';

type Live = HTMLElement & { _hover?: boolean; _held?: boolean };
export function liven(o: Live | null, size: number): Live | null {
  if (!o) return o;
  ui.liven(o, { size });   /* the library's rule: live above 16px, lowered jelly and small glances under reduced motion */
  o.dataset['base'] = o.getAttribute('reaction') ?? 'idle';
  play(o);
  return o;
}
/** an orb wrapper from the library, alive */
export function orbEl(b: BotLike, size: number, opts?: OrbOpts): HTMLElement {
  const w = ui.orb(b, { size, ...(opts ?? {}) });
  liven(w.querySelector('orb-avatar'), size);
  return w;
}
export const orbHTML = (b: BotLike, size: number, opts?: OrbOpts): string => ui.html.orb(b, { size, ...(opts ?? {}) });
export const livenIn = <E extends HTMLElement>(root: E): E => { for (const o of root.querySelectorAll<Live>('orb-avatar:not(.is-live)')) liven(o, +(o.getAttribute('size') ?? 20) || 20); return root; };
/** a hovered orb keeps listening and takes the new state when the pointer leaves */
export function setReact(o: Live | null | undefined, r: string): void {
  if (!o) return;
  o.dataset['base'] = r;
  if (!o._hover && o.getAttribute('reaction') !== r) o.setAttribute('reaction', r);
}
const EMOTES = ['curious', 'winkswap', 'doubletake', 'shapeshift', 'calibrate'];
const EMOTES_CALM = ['curious', 'winkswap', 'slowblink', 'calibrate'];
function play(o: Live): void {
  if (o.classList.contains('is-live')) return;
  o.classList.add('is-live');
  o.setAttribute('aria-hidden', 'true');
  o.addEventListener('click', () => oc(o, 'poke', reduced() ? 0.5 : 0.9));
  o.addEventListener('dblclick', (e) => { e.preventDefault(); const l = reduced() ? EMOTES_CALM : EMOTES; oc(o, 'emote', l[Math.floor(Math.random() * l.length)] as string); });
  o.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch') return;
    o._hover = true;
    const base = o.dataset['base'] || 'idle';
    if (base === 'idle' || base === 'happy' || base === 'done' || base === 'sleeping') { if (base === 'sleeping') oc(o, 'wakeUp'); o.setAttribute('reaction', 'listening'); }
    oc(o, 'lookAt', e.clientX, e.clientY);
  });
  o.addEventListener('pointermove', (e) => { if (o._hover) oc(o, 'lookAt', e.clientX, e.clientY); }, { passive: true });
  o.addEventListener('pointerleave', () => {
    o._hover = false;
    if (o.getAttribute('reaction') !== (o.dataset['base'] || 'idle')) o.setAttribute('reaction', o.dataset['base'] || 'idle');
    oc(o, 'lookAt');
  });
}
/** the orbs you look at (header, preview, settings) sit in a library orb button: Enter or Space pokes, quietly */
export function orbButton(b: BotLike, size: number, label: string, opts?: OrbOpts): HTMLButtonElement & { orb: Live } {
  const w = orbEl(b, size, opts);
  const btn = el('button', { class: 'ui-orb-btn bt-orb-btn', type: 'button', 'aria-label': label }, w) as HTMLButtonElement & { orb: Live };
  const o = w.querySelector('orb-avatar') as Live;
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); oc(o, 'poke', reduced() ? 0.5 : 0.9); } });
  btn.addEventListener('focus', () => { if (!o._hover && (o.dataset['base'] || 'idle') === 'idle') o.setAttribute('reaction', 'listening'); });
  btn.addEventListener('blur', () => { if (!o._hover) o.setAttribute('reaction', o.dataset['base'] || 'idle'); });
  btn.orb = o;
  return btn;
}
/** the one orb you look at (the room's presence, the new-bot preview) is the library's lead orb: it always gets a
    small step under reduced motion (owner: the presence orb is always alive) */
let leadDone = false;
export function leadOrb(): void {
  if (leadDone) return;
  leadDone = true;
  ui.glance.lead(() => (S.view === 'new' ? S.newPane?.querySelector('.bt-stage orb-avatar') : S.presence), { skip: (o) => !!(o as Live)._hover || !!(o as Live)._held });
}
/** orb2 resolves var() colours once per attribute change: re-read them when the theme changes */
export function repaintOrbs(): void {
  for (const root of [S.viewRoot, S.listWrap]) {
    if (!root) continue;
    for (const o of root.querySelectorAll('orb-avatar')) for (const a of ['color', 'eye-color']) { const v = o.getAttribute(a); if (v) o.setAttribute(a, v); }
  }
}
/** gentle cursor following for the presence orb: look at a point pulled toward the orb, release when the pointer rests */
export function gentleFollow(getOrb: () => Live | null, k: number) {
  let raf = 0, x = 0, y = 0, rest = 0, held = false;
  const tick = (): void => {
    raf = 0; const o = getOrb(); if (!o || !o.isConnected || held || o._hover) return;
    const r = o.getBoundingClientRect(); if (!r.width) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    oc(o, 'lookAt', cx + (x - cx) * k, cy + (y - cy) * k);
    clearTimeout(rest); rest = window.setTimeout(() => { const q = getOrb(); if (q && !held) oc(q, 'lookAt'); }, 1600);
  };
  addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
  return {
    hold(px: number, py: number): void { const o = getOrb(); if (!o) return; held = true; o._held = true; clearTimeout(rest); oc(o, 'lookAt', px, py); },
    release(): void { held = false; const o = getOrb(); if (o) o._held = false; oc(o, 'lookAt'); },
    glance(px: number, py: number, ms?: number): void { const o = getOrb(); if (!o || held) return; o._held = true; oc(o, 'lookAt', px, py); clearTimeout(rest); rest = window.setTimeout(() => { o._held = false; oc(o, 'lookAt'); }, ms || 1100); }
  };
}
