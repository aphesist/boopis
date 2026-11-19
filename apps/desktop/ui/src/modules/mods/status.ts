/* The status line under the composer (docs/MODS.md section 3; DESIGN-SYSTEM.md 14.29 and 11): mono 11 in the quiet ink, the
   mod's name first, one line. The composer rises 22px when the first status appears and settles back when the last clears
   (owner decision, 19 November 2026): a FLIP, never a layout animation. The composer host holds [band][composer][status] and
   its bottom is fixed, so a status line appearing lifts the composer and the band by 22px in one layout step. FLIP: measure,
   let the layout change, then animate `transform` from the old place to the new one (compositor only) over --dur-3 on
   --spring. Cleared: the same in reverse. Reduced motion: no travel, a short crossfade from a ghost of where the composer was. */
import { el, reduced, tokenMs } from '../../core/dom';
import type { ModStatus } from '../../data';
import { surface } from './surfaces';

const tokStr = (name: string, d: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || d;
let flips: Animation[] = [];
let shownCount = 0;

/** a copy of what is leaving, for the fade; without ids and focus */
function copyOf(n: HTMLElement): HTMLElement {
  const c = n.cloneNode(true) as HTMLElement;
  for (const x of c.querySelectorAll('[id]')) x.removeAttribute('id');
  c.removeAttribute('id');
  const src = n.querySelectorAll('textarea');
  c.querySelectorAll('textarea').forEach((t, i) => { t.value = src[i]?.value ?? ''; });
  return c;
}

function riseComposer(mutate: () => void): void {
  const slots = surface.slots, host = slots?.status.parentElement, comp = slots?.band.nextElementSibling as HTMLElement | null | undefined;
  if (!slots || !host || !comp || !host.isConnected || !comp.getBoundingClientRect().height || !comp.animate) { mutate(); return; }
  const first = comp.getBoundingClientRect(), hadBand = !!slots.band.childElementCount, topFirst = hadBand ? slots.band.getBoundingClientRect().top : first.top;
  const before = slots.status.cloneNode(true) as HTMLElement;   /* what the status line said, kept for the fade-out when it clears */
  const hadStatus = !!slots.status.childElementCount;
  flips.forEach((a) => { a.cancel(); }); flips = [];
  mutate();
  const last = comp.getBoundingClientRect(), dy = first.top - last.top;
  if (Math.abs(dy) < 1) return;
  const movers: HTMLElement[] = [comp, ...(slots.band.childElementCount ? [slots.band] : [])];
  const rm = reduced(), fade = tokenMs('--dur-2', 200) > 1 ? tokenMs('--dur-2', 200) : 120, ease = tokStr('--ease', 'ease-out');
  if (rm) {
    /* a short crossfade: a ghost of the old place fades out while the real one fades in (a copy, so no ids and no focus) */
    const ghost = el('div', { class: 'mod-ghost', 'aria-hidden': 'true' });
    ghost.inert = true;
    if (hadBand) ghost.append(copyOf(slots.band));
    ghost.append(copyOf(comp));
    ghost.style.top = (topFirst - host.getBoundingClientRect().top) + 'px';
    host.append(ghost);
    const out = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: ease, fill: 'forwards' });
    out.onfinish = () => { ghost.remove(); };
    for (const m of movers) flips.push(m.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: ease }));
  } else {
    const o = { duration: tokenMs('--dur-3', 300), easing: tokStr('--spring', 'cubic-bezier(.22, 1, .36, 1)') };
    for (const m of movers) flips.push(m.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }], o));
  }
  /* the line itself: in, it fades in as the composer leaves its place; out, a copy fades in the vacated place */
  if (!hadStatus && slots.status.childElementCount) slots.status.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: ease, delay: rm ? 0 : 60, fill: 'backwards' });
  if (hadStatus && !slots.status.childElementCount && !rm) {
    before.className = slots.status.className + ' mod-status--ghost'; before.setAttribute('aria-hidden', 'true');
    host.append(before);
    const out = before.animate([{ opacity: 1 }, { opacity: 0 }], { duration: tokenMs('--dur-out', 120) > 1 ? tokenMs('--dur-out', 120) : 120, easing: ease, fill: 'forwards' });
    out.onfinish = () => { before.remove(); };
  }
}

function paint(list: readonly ModStatus[]): void {
  const slot = surface.slots?.status;
  if (!slot) return;
  slot.setAttribute('role', 'region'); slot.setAttribute('aria-label', 'Mod status');
  slot.replaceChildren(...list.map((s) => {
    const i = el('span', { class: 'mod-status__i' });
    i.append(el('span', { class: 'mod-status__n', text: s.plugin }), document.createTextNode(' '), el('span', { class: 'mod-status__t', text: s.text }));
    return i;
  }));
}

/** the status lines of the session: the composer rises (or settles back) when the first appears (the last clears); a second adds no height, so nothing moves */
export function setStatus(list: readonly ModStatus[], o: { animate: boolean }): void {
  const had = shownCount > 0, now = list.length > 0;
  shownCount = list.length;
  if (o.animate && had !== now) riseComposer(() => { paint(list); }); else paint(list);
}
