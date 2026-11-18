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

/** repaint an orb's body from bot data (the library decides dark-body eyes the same way) */
export function paintOrb(o: Element | null | undefined, d: BotLike & { color: string; shape: string; eyes: string }): void {
  if (!o) return;
  o.setAttribute('color', d.color); o.setAttribute('shape', d.shape); o.setAttribute('eye-shape', d.eyes);
  const ref = ui.orb(d, { size: 20 }).querySelector('orb-avatar');
  const eye = ref?.getAttribute('eye-color'); if (eye) o.setAttribute('eye-color', eye); else o.removeAttribute('eye-color');
}
