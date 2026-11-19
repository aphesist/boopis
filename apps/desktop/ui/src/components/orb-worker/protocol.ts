/* The messages between the page and the orb worker (ADR-0025). The page owns the elements; the worker owns every orb's
   canvas and runs the vendored orb2 build as it is. The page sends state (attributes, calls, visibility, size); the worker
   sends back only what the page reads (the quality level). Messages are batched into one post per task. */

export interface RectLike { left: number; top: number; width: number; height: number }
/** what orb2 reads from the host's computed style: its colour (the particle ink falls back to it) and two custom properties */
export interface StyleSnap { color: string; particle: string; spark: string }

export type ToWorker =
  | { t: 'init'; dpr: number; reduced: boolean; dark: boolean }
  | { t: 'make'; id: number; canvas: OffscreenCanvas; attrs: Record<string, string>; style: StyleSnap; dock: boolean }
  | { t: 'attr'; id: number; name: string; value: string | null; style: StyleSnap }
  | { t: 'conn'; id: number; on: boolean; dock: boolean }
  | { t: 'vis'; id: number; v: boolean }
  | { t: 'size'; id: number; w: number }
  | { t: 'call'; id: number; m: string; a: unknown[]; rect: RectLike | null }
  | { t: 'drop'; id: number }
  | { t: 'hold' }
  | { t: 'release' }
  | { t: 'env'; dpr: number; reduced: boolean; dark: boolean }
  | { t: 'quality'; q: 'auto' | 0 | 1 | 2 };

export type FromWorker =
  | { t: 'ready'; ok: true }
  | { t: 'ready'; ok: false; why: string }
  | { t: 'quality'; level: number };

/** the methods of an orb the page forwards (the ones the app calls, and the rest of orb2's public ones) */
export const ORB_CALLS = ['poke', 'blink', 'lookAt', 'emote', 'wakeUp', 'sleep', 'spin', 'sequence', 'morphEyes'] as const;
