/* How orb2 meets the screen. The element draws on its own canvas and owns one shared requestAnimationFrame loop for every
   orb (it pauses an orb that is off-screen, hidden or `static`, and lowers its own quality when frames run long). One
   thing in it shows: a canvas is cleared by the browser the moment its width is assigned, and orb2 redraws it on the
   NEXT frame of its loop. Its quality ladder (`OrbAvatar.quality`, auto: dpr and frame stride) reassigns the width of every
   orb when it steps, and a resize observed after the loop ran does the same for one orb, so for a frame every orb on the
   screen is painted empty. That is the flicker: on a machine that paints on the CPU (WebKitGTK without DMABUF) the
   ladder steps up and back down every few seconds.
   The fix keeps orb2 as it is and closes the gap: whenever a canvas is resized, the orb draws itself again before the
   browser can paint, in the same task. Nothing about how an orb looks or moves changes. (A still orb, `static`, has it
   worse: orb2's loop never visits it, so when the ladder steps its canvas is emptied and stays empty until something
   touches the orb. The same redraw covers it.)

   The second thing is where the cost goes on a machine that paints on the CPU (WebKitGTK started with
   WEBKIT_DISABLE_DMABUF_RENDERER=1 has no GL and no layers). There a frame repaints the BOUNDING BOX of everything that
   changed once more than ten rectangles changed, so 25 small orbs, 14 in the sidebar and 11 in the dock, repaint the
   window between them at 60 Hz: measured, the dock's orbs alone or the sidebar's alone hold 60 fps, both together 20.
   An orb idling in its calm drift does not need 60 updates a second (the drift is a slow sine; at 30 the eye cannot tell),
   so the ambient orbs update on alternate frames, the dock's group on the even ones and the rest on the odd ones: each frame
   repaints one group's box, never the span between them. An orb that is doing something quick (a blink, a poke, an emote,
   a look at the pointer, a face morph, a jelly still swinging, a spin) is never held back, and a held-back orb is given the
   time it missed, so nothing runs slower, only less often.
   While the dock itself is moving (a morph, a page, the row magnifying under the pointer) its whole region repaints every
   frame; the ambient orbs outside it then wait for the dock to settle (`holdOutsideDock`, which expires by itself 120 ms
   after the last call), because a frame that repaints the dock and an orb in the sidebar repaints the window between them.
   orb2 is a pinned vendored build; the members used here are checked by `orb-runtime.test.ts`, and if a future build
   renames them this does nothing (and says so) instead of breaking the orb. */
import { logger } from '../core/log';

const log = logger('orb-runtime');

interface OrbInternals extends HTMLElement {
  _fit?: () => void;
  _update?: (dt: number, now: number) => void;
  _cw?: number;
  _static?: boolean;
  _sig?: unknown;
  _slot?: number;
  _owed?: number;
  _target?: unknown;
  _override?: unknown;
  _customSeq?: unknown;
  _tp?: number;
  _btp?: number;
  _jx?: ArrayLike<number>;
  _jv?: ArrayLike<number>;
  _blinkAt?: number;
  _dblBlinkAt?: number;
  _spinAt?: number;
  _pokeAt?: number;
}
type Proto = { _fit?: unknown; _update?: unknown };

let installed = false;
const QUICK_S = 0.5;   /* seconds after a blink, a spin or a poke during which an orb keeps its full rate */

const energy = (a: ArrayLike<number> | undefined, w: number): number => { let e = 0; for (let i = 0; a && i < a.length; i++) e += Math.abs(a[i] ?? 0) * w; return e; };
/** idling in its ambient drift: nothing quick is happening to this orb (every field must be there, or it is not ambient) */
function ambient(o: OrbInternals, now: number): boolean {
  if (o._sig == null || o._target || o._override || o._customSeq) return false;
  if (!(o._tp !== undefined && o._tp >= 1 && o._btp !== undefined && o._btp >= 1)) return false;
  if (!(energy(o._jx, 1) + energy(o._jv, 0.02) < 2e-3)) return false;
  return now - Math.max(o._blinkAt ?? Infinity, o._dblBlinkAt ?? Infinity, o._spinAt ?? Infinity, o._pokeAt ?? Infinity) > QUICK_S;
}
const phases = new WeakMap<Element, number>();
/** the dock's orbs are one group and every other orb another: each group repaints its own box on its own frames */
const phaseOf = (o: Element): number => { let p = phases.get(o); if (p === undefined) { p = o.closest('#hx-dock') ? 0 : 1; phases.set(o, p); } return p; };
let lastNow = Number.NaN, frame = 0, holdUntil = 0;
const HOLD_MS = 120;
/* when the orbs draw in a worker (components/orb-worker) the policy runs there; the dock's calls are forwarded to it */
let bridge: { hold(): void; release(): void } | null = null;
export function setHoldBridge(b: { hold(): void; release(): void } | null): void { bridge = b; }
/** the dock is animating this frame: ambient orbs outside it wait (called by the dock's frame loop; expires on its own) */
export function holdOutsideDock(): void { if (bridge) bridge.hold(); else holdUntil = performance.now() + HOLD_MS; }
/** the dock has settled: the orbs outside it go on at once */
export function releaseOutsideDock(): void { if (bridge) bridge.release(); else holdUntil = 0; }

/** make a resized orb canvas repaint in the same task; returns whether the patch is in place */
export function installOrbRuntime(): boolean {
  if (installed) return true;
  const ctor = customElements.get('orb-avatar');
  const proto = ctor?.prototype as (Proto & Record<string, unknown>) | undefined;
  if (!proto || typeof proto._fit !== 'function' || typeof proto._update !== 'function') {
    log.warn('orb-avatar has no _fit/_update: canvases are left as the library draws them');
    return false;
  }
  const fit = proto._fit as (this: OrbInternals) => void;
  proto._fit = function patchedFit(this: OrbInternals): void {
    const before = this._cw;
    fit.call(this);
    if (this._cw !== before && (this._cw ?? 0) > 0 && this.isConnected) {
      try { this._update?.(0, performance.now() / 1000); } catch { /* not drawable yet: the loop draws it */ }
    }
  };
  const update = proto._update as (this: OrbInternals, dt: number, now: number) => void;
  proto._update = function patchedUpdate(this: OrbInternals, dt: number, now: number): void {
    if (dt > 0) {
      if (now !== lastNow) { lastNow = now; frame++; }
      const ph = phaseOf(this);
      if (ph === 1 && performance.now() < holdUntil && ambient(this, now)) {
        this._owed = (this._owed ?? 0) + dt;
        return;
      }
      if ((window as unknown as { OrbAvatar?: { qualityLevel?: number } }).OrbAvatar?.qualityLevel === 2) {
        this._slot = ph;                               /* the ladder's own frame skip, by group instead of by orb */
      } else if (((frame + ph) & 1) === 1 && ambient(this, now)) {
        this._owed = (this._owed ?? 0) + dt;
        return;
      }
      if (this._owed) { dt = Math.min(0.08, dt + this._owed); this._owed = 0; }
    }
    update.call(this, dt, now);
  };
  installed = true;
  return true;
}
