/* The three act seams as data: SEAMS.md is the contract in words, these are its numbers (measured from the art
   director's key frames, `look/src/scenes/`, on the engine: 1080p px in the key frame's box, which sits at world (0, 0)
   on the stage layer at the seam). Both acts import them, so the outgoing act lands exactly where the incoming one
   starts. Rects are [x, y, w, h]; zoom is the kit's zoom (on-screen radius = the kit's radius x zoom). */
import type { CameraState } from '../motion/camera';

export type Rect = [number, number, number, number];
export interface SeamCarry { handle: string; what: string; rect: Rect; zoom?: number; radius?: number; fill?: string }
export interface SeamSide { state: string; camera: CameraState; carries: SeamCarry[]; offFrame?: string }
export interface Seam { id: 'S1' | 'S2' | 'S3'; t: number; bar: string; from: 'A1' | 'A2' | 'A3'; to: 'A2' | 'A3' | 'A4'; out: string; in: string; landscape: SeamSide; vertical: SeamSide }

const REST_L: CameraState = { x: 960, y: 540, zoom: 1, roll: 0 };
const REST_V: CameraState = { x: 540, y: 960, zoom: 1, roll: 0 };

export const SEAMS: Seam[] = [
  {
    id: 'S1', t: 9.6, bar: '5.3', from: 'A1', to: 'A2',
    out: 'B04 ends on its key-frame composition: you sent "@kai is it ready to cut?", the presence entry "kai thinking" has risen, the cursor rests just off the send button.',
    in: "B05 starts there: kai's reply takes the presence entry's place, landing whole (blocks rise 6 px in turn); the camera then follows the thread down on the camera spring and the head leaves the top.",
    landscape: {
      state: 'b04', camera: REST_L,
      carries: [
        { handle: 'room.group', what: 'the room plate (the look\'s .plate--room)', rect: [40, -80, 1840, 1240], radius: 30 },
        { handle: 'room.head', what: 'the head: the stack at 32 px real (96 on screen), "release", "kai, nina, moss and vox", its actions', rect: [130, 64, 1668, 288], zoom: 3 },
        { handle: 'room.thread', what: 'your request (You 14:02) and the presence entry', rect: [130, 340, 1668, 359], zoom: 3 },
        { handle: 'room.presence', what: 'the presence entry "kai thinking" (its orb 60 px at [130, 585])', rect: [130, 576, 1668, 123], zoom: 3 },
        { handle: 'room.composer', what: 'the room composer with the four member chips', rect: [130, 740, 1668, 254], zoom: 3, radius: 60, fill: 'var(--bg-3)' }
      ],
      offFrame: 'the cursor, 48 px, its tip at [1810, 956] (the foreground layer, depth 1.25, at rest = the same px)'
    },
    vertical: {
      state: 'b04', camera: REST_V,
      carries: [
        { handle: 'room.group', what: 'the room plate', rect: [-40, 120, 1160, 1580], radius: 30 },
        { handle: 'room.head', what: 'the head (stack orbs 83 px)', rect: [60, 250, 962, 250], zoom: 2.6 },
        { handle: 'room.thread', what: 'your request and the presence entry (narrow layout)', rect: [60, 520, 962, 368], zoom: 2.6 },
        { handle: 'room.presence', what: 'the presence entry "kai thinking" (its orb 52 px at [60, 789])', rect: [60, 781, 962, 106], zoom: 2.6 },
        { handle: 'room.composer', what: 'the room composer, four member chips', rect: [60, 1330, 962, 220], zoom: 2.6, radius: 52, fill: 'var(--bg-3)' }
      ],
      offFrame: 'the cursor, its tip at [1036, 1515]'
    }
  },
  {
    id: 'S2', t: 20, bar: '10.2.5', from: 'A2', to: 'A3',
    out: 'B08 ends pushed into your session: the tabs pill clicked Session at +2.5, the room slid out left and the session in, the composer morphed (member chips folded, Governed arrived), and the camera pushed in until the session sits exactly as B09\'s key frame composes it, before the request types.',
    in: 'B09 starts there: the request "fix the proration drift in src/billing" types into that composer (30 cps), send at +2.5; the answer and the Governance panel arrive after it.',
    landscape: {
      state: 'b09', camera: REST_L,
      carries: [
        { handle: 'composer.el', what: 'the session composer, empty, the Governed chip on', rect: [80, 790, 1196, 220], zoom: 2.6, radius: 52, fill: 'var(--bg-3)' },
        { handle: 'composer.session', what: 'the session plate (.plate--room); the thread above the composer is empty at the seam', rect: [40, -80, 1260, 1240], radius: 30 }
      ],
      offFrame: 'the right panel (.plate--frame at [1300, 400, 700, 760]) and the film line are not on screen yet: B09 brings them'
    },
    vertical: {
      state: 'b09', camera: REST_V,
      carries: [
        { handle: 'composer.session', what: 'the session column (narrow layout), empty at the seam', rect: [50, 600, 936, 464], zoom: 2.6 },
        { handle: 'composer.el', what: 'the session composer: the 9:16 key frame does not show it; it sits under the column at 936 px wide, its top at y 1330 and inside the band (cutdowns.md B08: the composer at the band\'s foot)', rect: [50, 1330, 936, 220], zoom: 2.6, radius: 52, fill: 'var(--bg-3)' }
      ],
      offFrame: 'open question for the art director: B09\'s 9:16 key frame has no composer in view; until it is boarded the rect above is the contract'
    }
  },
  {
    id: 'S3', t: 32, bar: '16.1', from: 'A3', to: 'A4',
    out: 'B13 ends on its key-frame composition: the run printed and done in the terminal, the same messages landed in the open room beside it (the live huddle "vox and kai worked it out, 2 messages"), the prompt returned.',
    in: 'B14 starts there and holds half a beat; from +0.5 the camera glides right and down to the dock and the nameless app on the camera spring (they wait off-frame in the world, placed where B14\'s key frame needs them after the glide).',
    landscape: {
      state: 'b13', camera: REST_L,
      carries: [
        { handle: 'desk.terminal', what: 'the terminal plate (.term)', rect: [-24, 110, 1004, 860], radius: 18, fill: 'var(--bg-0)' },
        { handle: 'desk.window', what: 'the open room (.plate--room) with its thread at 2.6x', rect: [1000, -60, 1000, 1200], radius: 30 }
      ],
      offFrame: 'the dock and the nameless app (desk.dock, desk.app) are off-frame right and below; A4 owns where'
    },
    vertical: {
      state: 'b13', camera: REST_V,
      carries: [
        { handle: 'desk.terminal', what: 'the terminal, on top', rect: [30, 230, 1020, 720], radius: 18, fill: 'var(--bg-0)' },
        { handle: 'desk.window', what: 'the open room below it, full width', rect: [30, 1000, 1100, 1000], radius: 30 }
      ],
      offFrame: 'the dock session and the nameless app are below the frame (cutdowns.md B14: the app below the dock session)'
    }
  }
];

export const seamAt = (id: Seam['id']): Seam => SEAMS.find((s) => s.id === id)!;
