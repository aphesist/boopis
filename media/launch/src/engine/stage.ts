/* The frame. A stage is the film's fixed 1920x1080 (or 1080x1920) box; inside it, a ground (the living background), a
   world (what the camera looks at, in layers at depths) and a screen layer (things fixed to the frame: the grain, the
   eyelids of a blink, a wipe). Units are 1080p CSS pixels at every output size: 4K is the same page at
   deviceScaleFactor 2, so text and vectors are drawn at their final size. */
import type { Film } from './film';

export interface Layer { el: HTMLElement; depth: number; name: string }
export interface Stage {
  root: HTMLElement;
  /** the background: the ground and its light, behind the camera's layers (it moves with the camera at its own depth) */
  ground: HTMLElement;
  /** the camera's root: every world layer sits in here */
  world: HTMLElement;
  /** fixed to the frame, above the world */
  screen: HTMLElement;
  layers: Map<string, Layer>;
  /** a world layer at a depth (1 = the stage plane, 0.3 = far ground, 1.3 = foreground); created once per name */
  layer(name: string, depth?: number): HTMLElement;
  width: number;
  height: number;
}

export function createStage(film: Film, host: HTMLElement): Stage {
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'film-stage';
  root.dataset['variant'] = film.variant;
  root.style.width = film.width + 'px';
  root.style.height = film.height + 'px';
  const ground = document.createElement('div'); ground.className = 'film-ground';
  const world = document.createElement('div'); world.className = 'film-world';
  const screen = document.createElement('div'); screen.className = 'film-screen';
  root.append(ground, world, screen);
  host.appendChild(root);
  const layers = new Map<string, Layer>();
  const stage: Stage = {
    root, ground, world, screen, layers, width: film.width, height: film.height,
    layer(name, depth = 1) {
      const have = layers.get(name);
      if (have) return have.el;
      const el = document.createElement('div');
      el.className = 'film-layer';
      el.dataset['layer'] = name;
      el.dataset['depth'] = String(depth);
      /* layers are stacked by depth: far first */
      const after = [...layers.values()].filter((l) => l.depth <= depth).pop();
      if (after) after.el.after(el); else world.prepend(el);
      layers.set(name, { el, depth, name });
      return el;
    }
  };
  return stage;
}

/** an absolutely placed box in a layer, in world px (the frame's px when the camera is at rest) */
export function place<T extends Element>(el: T, x: number, y: number, o: { w?: number; h?: number; anchor?: 'center' | 'topleft' } = {}): T {
  const s = (el as unknown as HTMLElement).style;
  s.position = 'absolute';
  if (o.w != null) s.width = o.w + 'px';
  if (o.h != null) s.height = o.h + 'px';
  if (o.anchor === 'topleft') { s.left = x + 'px'; s.top = y + 'px'; }
  else { s.left = x + 'px'; s.top = y + 'px'; s.translate = '-50% -50%'; }
  return el;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
