/* Orbs: the owner's <orb-avatar> web component (vendor/orb-avatar.min.js), drawn the same way in every module.
   Owner decision: reduced motion REDUCES and never freezes an orb. Blinks, eye morphs, small glances and reactions
   stay; orb2 itself drops floating, head travel, hops and spins under prefers-reduced-motion, the jelly is lowered so
   a poke does not bounce, and glance moves the eyes in small steps (orb2 holds its ambient gaze still then).
   Live or still: `live: true` always animates (whatever the size); `still: true` is one still frame (picker tiles up
   to 28px, arrange tiles); by default an orb is live above 16px and still at 16px and under. Off-screen orbs are
   paused by orb2 itself, so nothing needs `static` for that. */
import type { OrbAvatar } from '../../vendor/orb-avatar';
import { attrs, frag, onReducedChange, reduced } from '../core/dom';
import { botState } from './bot-state';
import type { BotLike } from './bot-state';
import { lookAttrs, lookOf } from './look';
import { FACE_SCALE_MAX, HOME, REST_REACTION } from './orb-pose';
import type { Look } from './look';

export { lumHex } from './look';

export type OrbEl = OrbAvatar;
export interface OrbOpts {
  size?: number | undefined; render?: number | undefined; state?: string | undefined; flag?: boolean | undefined;
  motion?: 'calm' | 'lively' | 'off' | undefined; live?: boolean | undefined; still?: boolean | undefined; mode?: string | undefined;
  /** a rest surface (the dock, the Bots sidebar, the rail; ORBS.md §23): idle is the still rest pose at the home, jelly 0 */
  rest?: boolean | undefined;
  /** the surface the orb sits on, as its token (`--bg-1` the rail and the sidebar, `--bg-3` a pill or a Block, `--bg-pane` the details
      pane; the ground `--bg-2` when left out): its eyes are cut out, drawn in that surface's colour (the boards' kit.js orb and eyes) */
  surface?: string | undefined;
}

/** call an orb method if the element has been upgraded (a not-yet-defined element has none) */
export function oc<K extends keyof OrbAvatar>(o: Element | null | undefined, m: K, ...a: OrbAvatar[K] extends (...args: infer P) => unknown ? P : never[]): void {
  const fn = (o as unknown as Record<string, unknown> | null | undefined)?.[m as string];
  if (typeof fn === 'function') { try { (fn as (...x: unknown[]) => unknown).apply(o, a); } catch { /* not upgraded yet */ } }
}

export const orbIsStill = (o: Pick<OrbOpts, 'live' | 'still'>, size: number): boolean => (o.live ? false : (!!o.still || size <= 16));

/** <span class="ui-orb"><orb-avatar …></span> as a string */
export function orbHtml(b: BotLike, o: OrbOpts = {}): string {
  const size = o.size ?? 20, s = botState(o.state ? { ...b, state: o.state } : b);
  const still = orbIsStill(o, size);
  const look = lookAttrs(lookOf(b), o.surface ?? '--bg-2');   /* the one resolver: the bot's own look, else its name's */
  const render = o.render && o.render !== size ? o.render : null;
  /* orb3 (ORBS.md §23): every bot carries the home orientation, which holds only at rest; at rest on a rest surface it wears the pose */
  const rest = !!o.rest, atRest = rest && s.reaction === 'idle';
  return '<span class="ui-orb"' + attrs({ 'data-bot': b.id, 'data-render': render ? '' : null, style: '--o:' + size + (render ? ';--r:' + render : ''), 'data-size': size >= 40 ? 'l' : null, 'data-orb-rest': rest ? '' : null }) + '>' +
    '<orb-avatar' + attrs({ size: render ?? size, shape: look.shape, color: look.color, 'eye-color': look['eye-color'] ?? 'var(' + (o.surface ?? '--bg-2') + ')', 'data-surface': o.surface ?? null, home: HOME, 'face-scale': size <= FACE_SCALE_MAX ? '1.25' : null,
      /* at rest on a rest surface: the pose, drifting, its idle off; a bot in a state there is awake as the boards draw it (kit.js orb: lively, mode fixed) */
      reaction: atRest ? REST_REACTION : s.reaction, 'idle-motion': atRest ? 'off' : o.motion ?? (rest ? 'lively' : 'calm'), mode: atRest ? 'drift' : rest ? 'fixed' : o.mode ?? 'drift', static: still && !rest,
      jelly: rest ? '0' : !still && reduced() ? '.12' : !still ? '.25' : null,
      'data-glance': still || atRest ? null : '', label: b.name, 'aria-hidden': 'true' }) + '></orb-avatar>' +
    (o.flag && s.attention ? '<span class="ui-dot ui-dot--flag" aria-hidden="true"></span>' : '') + '</span>';
}
export const orb = (b: BotLike, o?: OrbOpts): HTMLElement => frag(orbHtml(b, o));

/** a drawn orb on a rest surface (the dock, the Bots sidebar, the rail; ORBS.md section 23) follows its bot's reaction in place: at rest
    the pose, still; any other state its own reaction, alive. An orb the pointer woke (wireRestOrb) is left to it until it settles */
export function restReact(o: Element | null | undefined, reaction: string): void {
  if (!o) return;
  const atRest = reaction === 'idle', r = atRest ? REST_REACTION : reaction;
  if ((o as HTMLElement & { _hover?: boolean })._hover) return;
  if (o.getAttribute('reaction') !== r) o.setAttribute('reaction', r);
  const motion = atRest ? 'off' : 'calm';
  if (o.getAttribute('idle-motion') !== motion) o.setAttribute('idle-motion', motion);
}

/** paint a drawn orb in a look: only the attributes that change are written, so orb2 morphs the body and fades the
    colour instead of starting again (the same attributes `orbHtml` writes: `lookAttrs`) */
export function paintLook(o: Element | null | undefined, look: Look): void {
  if (!o) return;
  for (const [k, v0] of Object.entries(lookAttrs(look, o.getAttribute('data-surface') ?? '--bg-2'))) {
    /* the boopis bot keeps the theme's ink (kit `inkOrb`), and an orb with no eye colour of its own keeps its eyes cut to its surface */
    if (k === 'color' && o.hasAttribute('data-ink')) continue;
    const v = k === 'eye-color' && v0 === null ? 'var(' + (o.getAttribute('data-surface') ?? '--bg-2') + ')' : v0;
    if (v === null) { if (o.hasAttribute(k)) o.removeAttribute(k); } else if (o.getAttribute(k) !== v) o.setAttribute(k, v);
  }
}
/** every orb of one bot drawn under `root` (`ui.orb` marks its wrapper with `data-bot`), in its look now: a look that
    changed after something drew the bot (the plugin's record read late, a look saved in the editor) reaches every
    place at once. Returns how many orbs were painted. */
export function repaintLook(root: ParentNode | null | undefined, id: string, look: Look): number {
  if (!root || !id) return 0;
  const sel = String(id).replace(/["\\]/g, '');
  const q = '.ui-orb[data-bot="' + sel + '"] > orb-avatar';
  const own = root instanceof Element && root.matches('.ui-orb[data-bot="' + sel + '"]') ? [...root.querySelectorAll(':scope > orb-avatar')] : [];
  let n = 0;
  for (const o of [...own, ...root.querySelectorAll(q)]) { paintLook(o, look); n++; }
  return n;
}

/* ───────────── glance: small eye steps for live orbs under reduced motion (shared by bots and the dock) ─────────────
   orb2 holds its ambient gaze still under prefers-reduced-motion. While reduced motion is on, every few seconds up
   to three visible live orbs (orb-avatar[data-glance]:not([static])) get a small new `gaze`; turning reduced motion
   off clears it so orb2's own idle life takes over again.
   The lead: three random orbs of fifteen would leave the one orb the user is looking at (the room's presence orb,
   the new-bot preview) nearly still. lead(orb | () => orb, {skip}) names it: under reduced motion it gets its own
   step every 1.8s, a blink (one in three) or a small gaze, and the random steps leave it alone. A getter is read
   on every step. The step is skipped while the pointer is on the orb, while it carries data-glance-hold, or when
   skip(orb) says so. lead(null) clears it; there is one lead at a time. */
type LeadTarget = Element | (() => Element | null | undefined) | null | undefined;
export interface GlanceHost extends HTMLElement { _hover?: boolean; _held?: boolean }

let t = 0, leadT = 0, lead: LeadTarget = null, leadSkip: ((o: Element) => boolean) | null = null;
const visible = (el: Element): boolean => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
const step = (): string => (Math.random() < 0.25 ? '8 5' : Math.round(Math.random() * 28 - 14) + ' ' + Math.round(Math.random() * 16 - 6));
const leadOrb = (): Element | null => {
  let o: Element | null | undefined = null;
  try { o = typeof lead === 'function' ? lead() : lead; } catch { o = null; }
  return o && o.isConnected ? o : null;
};
function tick(): void {
  clearTimeout(t); t = 0;
  if (!reduced() || document.hidden) return;
  const L = leadOrb();
  const live = [...document.querySelectorAll('orb-avatar[data-glance]:not([static])')].filter((o) => o !== L && visible(o));
  for (let k = 0; k < 3 && live.length; k++) live.splice(Math.floor(Math.random() * live.length), 1)[0]?.setAttribute('gaze', step());
  t = window.setTimeout(tick, 1400 + Math.random() * 1600);
}
function leadTick(): void {
  clearTimeout(leadT); leadT = 0;
  if (!lead || !reduced() || document.hidden) return;
  const o = leadOrb();
  if (o && !o.hasAttribute('static') && visible(o)) {
    if (!o.hasAttribute('data-glance')) { o.setAttribute('data-glance', ''); o.setAttribute('jelly', '.12'); }
    const held = o.matches(':hover') || o.hasAttribute('data-glance-hold') || (leadSkip ? leadSkip(o) : false);
    if (!held) { if (Math.random() < 0.34 && typeof (o as OrbAvatar).blink === 'function') (o as OrbAvatar).blink(); else o.setAttribute('gaze', step()); }
  }
  leadT = window.setTimeout(leadTick, 1800);
}
let glanceStarted = false;
/** start the listeners (called once by main): the jelly follows the preference too, lowered while reduced */
export function startGlance(): void {
  if (glanceStarted) return;
  glanceStarted = true;
  onReducedChange(() => {
    for (const o of document.querySelectorAll('orb-avatar[data-glance]')) { if (reduced()) o.setAttribute('jelly', '.12'); else if (o.getAttribute('jelly') === '.12') o.removeAttribute('jelly'); }
    if (reduced()) { tick(); leadTick(); } else { clearTimeout(t); clearTimeout(leadT); t = leadT = 0; for (const o of document.querySelectorAll('orb-avatar[data-glance][gaze]')) o.removeAttribute('gaze'); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && reduced()) { if (!t) tick(); if (!leadT) leadTick(); } });
  if (reduced()) setTimeout(tick, 600);
}
export const glance = {
  add<E extends Element>(o: E | null | undefined): E | null | undefined { if (o) o.setAttribute('data-glance', ''); if (reduced() && !t) tick(); return o; },
  lead(target: LeadTarget, opts?: { skip?: ((o: Element) => boolean) | undefined }): LeadTarget {
    lead = target ?? null; leadSkip = opts?.skip ?? null;
    if (lead && typeof lead !== 'function') glance.add(lead);
    clearTimeout(leadT); leadT = 0;
    if (lead && reduced()) leadT = window.setTimeout(leadTick, 600);
    return target;
  },
  get current(): Element | null { return leadOrb(); },
  tick
};

/** liven an orb made outside orbHtml (the dock's 80px-rendered row orbs, a bot's presence orb): the same rule.
    {lead: true} also makes it the glance lead. */
export function liven<E extends Element>(orbEl: E | null | undefined, o: { size?: number; live?: boolean; still?: boolean; lead?: boolean; skip?: (o: Element) => boolean } = {}): E | null | undefined {
  if (!orbEl) return orbEl;
  const size = o.size || +(orbEl.getAttribute('size') ?? 0) || 20;
  if (orbIsStill(o, size)) { orbEl.setAttribute('static', ''); orbEl.removeAttribute('data-glance'); return orbEl; }
  orbEl.removeAttribute('static');
  if (reduced()) orbEl.setAttribute('jelly', '.12');
  glance.add(orbEl);
  if (o.lead) glance.lead(orbEl, o.skip ? { skip: o.skip } : undefined);
  return orbEl;
}
