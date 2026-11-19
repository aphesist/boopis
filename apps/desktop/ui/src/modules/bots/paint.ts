/* orb body paint for a bot being made. The palettes of the picker are `data/looks.ts`: orb colours, bot data, not
   interface colour. */
import { ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';

export { DRAFT_COLOR, SHAPES, SWATCHES } from '../../data/looks';

/* Repaint an orb from bot data; only what changed is written, so orb2 morphs instead of restarting anything. Dark
   bodies take the library's light eyes (the same rule as ui.orb). */
const eyeColourCache = new Map<string, string | null>();
export function paintOrbColour(o: Element | null | undefined, color: string): void {
  if (!o || !color) return;
  if (!eyeColourCache.has(color)) eyeColourCache.set(color, ui.orb({ color, shape: 'circle' }, { size: 20 }).querySelector('orb-avatar')?.getAttribute('eye-color') ?? null);
  const eye = eyeColourCache.get(color) ?? null;
  if (o.getAttribute('color') !== color) o.setAttribute('color', color);
  if (eye) { if (o.getAttribute('eye-color') !== eye) o.setAttribute('eye-color', eye); } else if (o.hasAttribute('eye-color')) o.removeAttribute('eye-color');
}
export function paintOrb(o: Element | null | undefined, d: BotLike & { color: string; shape: string }): void {
  if (!o) return;
  paintOrbColour(o, d.color);
  if (o.getAttribute('shape') !== d.shape) o.setAttribute('shape', d.shape);
}
