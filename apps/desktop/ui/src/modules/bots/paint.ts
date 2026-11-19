/* orb body paint for a bot being made, and the swatches of the picker. Swatches and the default draft colour are orb
   colours: bot data, not interface colour. */
import { ui } from '../../components';
import type { BotLike } from '../../components';

export const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ['#efece6', 'Bone'], ['#a6a6ab', 'Pewter'], ['#1c1c24', 'Ink'], ['#c4834a', 'Clay'],
  ['#f23b5a', 'Rose'], ['#f5a337', 'Amber'], ['#2fd26a', 'Green'], ['#4fc9a8', 'Mint'],
  ['#3b82f6', 'Blue'], ['#6d5cf0', 'Indigo'], ['#9b5cf6', 'Violet'], ['#f472b6', 'Pink']
];
export const DRAFT_COLOR = '#3b82f6';
export const SHAPES = ['circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond', 'cloud', 'clover', 'flower', 'star'];
export const EYES = ['pill', 'tall', 'circle', 'wide', 'squint', 'square', 'grid', 'matrix', 'bars', 'arc', 'rest', 'plus', 'heart', 'circle wide'];

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
export function paintOrb(o: Element | null | undefined, d: BotLike & { color: string; shape: string; eyes: string }): void {
  if (!o) return;
  paintOrbColour(o, d.color);
  if (o.getAttribute('shape') !== d.shape) o.setAttribute('shape', d.shape);
  if (o.getAttribute('eye-shape') !== d.eyes) o.setAttribute('eye-shape', d.eyes);
}
