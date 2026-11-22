/* the dock's orbs: reduced motion reduces and never freezes (ui.orb lowers the jelly, glance moves the eyes). The dock
   stills an orb only on a page that is not showing and in the 10px minimal pill; the library's own still orbs (16px
   and under) are left as they are. */
import { $$ } from '../../core/dom';
import { LOOK_X, LOOK_Y, S, X, botById, motion, rendered } from './ctx';
import { av, st } from './views';
import { onCull, orbShows } from './layer';

type OrbEl = HTMLElement & { lookAt?: (x?: number, y?: number) => void; poke?: (f?: number) => void; blink?: () => void };
/** one bot's orb draws only while it is on a visible slot of the page showing (and in view of the roster that scrolls it) */
function lifeOf(id: string): void {
  const orb = av(id) as OrbEl | null; if (!orb) return;
  const live = S.mode !== 'off' && S.mode !== 'minimal' && S.page === 'bots' && orbShows(id);
  if (orb.hasAttribute('static') === live) { if (live) orb.removeAttribute('static'); else orb.setAttribute('static', ''); }
  if (orb.getAttribute('mode') !== 'drift') orb.setAttribute('mode', 'drift');
  if (!live && typeof orb.lookAt === 'function') orb.lookAt();
}
onCull(lifeOf);
export function setOrbLife(): void {
  for (const b of S.bots) lifeOf(b.id);
  for (const o of $$('.dk-mini-orb orb-avatar[data-glance]', X.root)) {
    const vis = S.mode !== 'off' && rendered(o) && !o.closest('.is-leaving');
    if (o.hasAttribute('static') === vis) { if (vis) o.removeAttribute('static'); else o.setAttribute('static', ''); }
  }
}
/* orb2's own follow mode turns a face up to 67 degrees toward a pointer far along the row: the eyes slide to the rim
   and the body reads as a crescent (the "moon" orbs). The dock aims each orb at a point no more than LOOK_X / LOOK_Y
   away instead, and only with motion allowed; under reduced motion a hovered orb just listens. */
let looking = false;
export function lookRow(px: number | null, py?: number): void {
  const on = px != null && !motion.reduce && S.mode === 'normal' && S.page === 'bots';
  if (!on && !looking) return;
  looking = on;
  for (const b of S.bots) {
    const o = av(b.id) as OrbEl | null, w = X.orbs.get(b.id); if (!o || !w || typeof o.lookAt !== 'function') continue;
    if (!on || o.hasAttribute('static')) { o.lookAt(); continue; }
    const r = w.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    o.lookAt(cx + LOOK_X * Math.tanh(((px as number) - cx) / 180), cy + LOOK_Y * Math.tanh(((py ?? 0) - cy) / 120));
  }
}
/* DESIGN-SYSTEM.md 13: a hovered or focused live orb turns to listening, then returns to its state */
export function listenOrb(id: string, on: boolean): void {
  const o = av(id), b = botById(id); if (!o || !b) return;
  const r = on ? 'listening' : st(b).reaction;
  if (o.getAttribute('reaction') !== r) o.setAttribute('reaction', r);
}
/** every orb in the dock answers: a poke (softer under reduced motion), never a jump to the card */
export function pokeBot(id: string, force = 1): void {
  const orb = av(id) as OrbEl | null;
  if (orb && orb.isConnected && typeof orb.poke === 'function') orb.poke(motion.reduce ? Math.min(force, 0.35) : force);
}
