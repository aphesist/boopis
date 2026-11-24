/* The bots' rest pose (ORBS.md §23 on w31/bot-character, DECIDED by the owner, 23 November: K08 B, drawn by orb3 3.0.2; DESIGN-SYSTEM.md
   v7 21.4). Every bot carries `home="38 22 -24"`, which orb3 holds only at rest. At rest on the dock, the Bots sidebar and the rail a bot
   wears K07's big upright pills: a reaction `pose` (ORBS.md calls it hidden: no UI lists it; orb3's own `hidden` flag would refuse it as an attribute), defined with `rest: true` and no blink, on `idle-motion="off"` and
   `mode="drift"`, with `jelly="0"`: still, so it never redraws (G5). Any other state turns the whole bot out of the home into that
   state's life (orb3's STATE_LIFE) and back at rest. Chat and room bots run the alive-idle engine all the time, `jelly=".25"`.
   orb3 3.0.2 draws every eye bolder (a resting pill is 0.30 by 0.13 of the body). Orbs of 44 px and under take `face-scale="1.25"`.
   The pose is defined wherever orb3 runs: the page (main-thread orbs) and the orb worker. */
export const HOME = '38 22 -24';
export const REST_REACTION = 'pose';
export const FACE_SCALE_MAX = 44;

interface OrbStatics {
  defineReaction?(name: string, def: Record<string, unknown>): void;
  shapes?: { pairEyes?(a: unknown, b: unknown): unknown };
  __pose?: boolean;
}
/** K07's pills, as the approved renders define them (ds-v7 kit.js definePose) */
export function definePose(A: OrbStatics | undefined | null): boolean {
  if (!A || A.__pose) return !!A?.__pose;
  if (typeof A.defineReaction !== 'function' || !A.shapes?.pairEyes) return false;
  const D = Math.PI / 180;
  const pills = A.shapes.pairEyes(['pill', { x: -0.19 + 0.04, y: -0.08, w: 0.18, h: 0.41, ang: 4 * D }], ['pill', { x: 0.19 + 0.04, y: -0.08, w: 0.18, h: 0.41, ang: 4 * D }]);
  A.defineReaction(REST_REACTION, { label: 'Pose', rest: true, blink: false, face: () => pills, motion: () => ({ eyaw: 0, epitch: 0, w: 1 }) });
  A.__pose = true;
  return true;
}
