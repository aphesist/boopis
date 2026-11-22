/* Act 3's numbers, per variant. World px: at the act's two seams the shared camera is at rest, so world px are screen
   px; every local rect is where an element is laid out (at the seam it belongs to), every screen rect is where a key
   frame puts it (look/src/scenes/session.ts and desk.ts; SC/storyboard/board/b09 to b13).

   The boopis window is drawn at the session's scale, 2.6x, so the session (B09, B10) IS its main area seen up close:
   the B11 pull back shrinks the very window the session lives in. Landscape: the session column and its right panel
   (B09's plates) are the window's main area and right panel, so the window is 1011 product px wide (sidebar 256, main
   485, panel 270). Vertical: the column sits centred in a 1280-wide window's main area (the product's narrow layout,
   Governance under the steps). */
import type { Rect } from './rig';

export const X = 2.6;               /* the product's px to world px, the session's and the open room's scale */

export interface Layout {
  W: number; H: number;
  /** the window (appWindow at k = 2.6: 3328 wide as drawn; landscape narrows it to `win[2]`) */
  win: Rect;
  /** the main area in the session view (B09's session plate, its height extended to the window's foot), and in Bots */
  main: Rect; mainBots: Rect;
  /** the right panel (B09's .plate--frame), landscape only */
  panel?: Rect;
  /** B09's composer (SEAMS S2: the contract with Act 2) */
  composer: Rect;
  /** where B09's key frame lays out the log; the log is B10's (six steps), placed at B09's spot */
  log: [number, number];
  /** vertical: where the Governance section sits under two steps (B09) */
  gov?: [number, number];
  /** the B13 terminal (SEAMS S3, desk.terminal), its type size */
  term: Rect;
  /** the nameless app, laid out where it waits off-frame from B12 on (A4 owns it after the seam) */
  app: Rect;
  /** B11's key frame: where the three plates sit at the end of the slow move (screen x, y, width) */
  b11: { win: [number, number, number]; mid: [number, number, number]; term: [number, number, number]; app: [number, number, number] };
  /** B12: the terminal close (its scale keeps the mono at 29 px or more), the window behind */
  b12: { term: [number, number, number]; win: [number, number, number] };
  /** B13: the window's translation (scale 1: the room at 2.6x) so its main area lands on SEAMS desk.window */
  b13: { win: [number, number]; plate: Rect; room: [number, number] };
  /** the film lines */
  line12: { y: number; size: number };
}

export const LANDSCAPE: Layout = {
  W: 1920, H: 1080,
  win: [-626, -184, 2626, 1477],
  main: [40, -80, 1260, 1373],
  mainBots: [40, -80, 1960, 1373],
  panel: [1300, 400, 700, 760],
  composer: [80, 790, 1196, 220],
  log: [80, 140],
  term: [-24, 110, 1004, 860],
  app: [2060, 980, 440, 360],
  b11: { win: [600, 250, 1120], mid: [135, 76, 1650], term: [110, 170, 760], app: [1380, 640, 440] },
  b12: { term: [-30, 250, 1130], win: [1130, 300, 1100] },
  b13: { win: [960, 20], plate: [40, -80, 1000, 1200], room: [80, 110] },
  line12: { y: 70, size: 88 }
};

export const VERTICAL: Layout = {
  W: 1080, H: 1920,
  win: [-1479, 416, 3328, 2454],
  main: [-813, 520, 2662, 2350],
  mainBots: [-813, 520, 2662, 2350],
  composer: [50, 1330, 936, 220],
  log: [50, 600],
  gov: [50, 1220],
  term: [30, 230, 1020, 720],
  app: [560, 2040, 470, 380],
  b11: { win: [70, 640, 940], mid: [24, 300, 1900], term: [70, 280, 760], app: [540, 1220, 470] },
  b12: { term: [6, 560, 1068], win: [160, 1360, 1100] },
  b13: { win: [20, 480], plate: [10, 520, 1100, 1000], room: [50, 560] },
  line12: { y: 240, size: 104 }
};
