/* The scene registry: index.html?scene=<name>. A scene module's default export is a Scene (see ./types.ts).
   Add a scene: write src/scenes/<name>.ts and add one line here (README.md, "Add a scene"). */
import type { Scene } from './types';

export const SCENES: Record<string, () => Promise<{ default: Scene }>> = {
  test: () => import('./test'),
  kit: () => import('./kit-sheet')
};
