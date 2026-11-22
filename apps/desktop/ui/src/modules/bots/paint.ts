/* orb body paint for a bot being made or re-looked. The palettes of the picker are the kit's (`components/look.ts`):
   orb colours, bot data, not interface colour. Painting goes through the kit's `paintLook`, the same attributes `ui.orb`
   writes (the light eyes of a dark body included), and only what changed is written, so orb2 morphs. */
import { paintLook } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';

export { DRAFT_COLOR, SHAPES, SWATCHES } from '@boopis/ui';

/** a new colour on the body the orb has now */
export function paintOrbColour(o: Element | null | undefined, color: string): void {
  if (!o || !color) return;
  paintLook(o, { shape: o.getAttribute('shape') ?? 'circle', color });
}
export function paintOrb(o: Element | null | undefined, d: BotLike & { color: string; shape: string }): void {
  paintLook(o, { shape: d.shape, color: d.color });
}
