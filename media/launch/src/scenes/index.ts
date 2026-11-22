/* The scene registry: index.html?scene=<name>. A scene module's default export is a Scene (see ./types.ts).
   Add a scene: write src/scenes/<name>.ts and add one line here (README.md, "Add a scene"). */
import type { Scene } from './types';

export const SCENES: Record<string, () => Promise<{ default: Scene }>> = {
  test: () => import('./test'),
  kit: () => import('./kit-sheet'),
  board: () => import('./board'),
  /* the film and its views (src/scenes/film.ts) */
  film: () => import('./film').then((m) => ({ default: m.editScene('master') })),
  a1: () => import('./film').then((m) => ({ default: m.actScene('A1') })),
  a2: () => import('./film').then((m) => ({ default: m.actScene('A2') })),
  a3: () => import('./film').then((m) => ({ default: m.actScene('A3') })),
  a4: () => import('./film').then((m) => ({ default: m.actScene('A4') })),
  cut15: () => import('./film').then((m) => ({ default: m.editScene('cut15') })),
  bumper6: () => import('./film').then((m) => ({ default: m.editScene('bumper6') }))
};
