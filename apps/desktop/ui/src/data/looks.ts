/* How a bot looks (orb2: a body shape, a colour, eyes) and what a bot with no look of its own gets. The palettes are
   the new-bot picker's; they are bot data, not interface colour. A look derived from a name is a default, never stored:
   the same name always draws the same bot, until its owner picks another and boopis saves it with the teammate. */
export const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ['#efece6', 'Bone'], ['#a6a6ab', 'Pewter'], ['#1c1c24', 'Ink'], ['#c4834a', 'Clay'],
  ['#f23b5a', 'Rose'], ['#f5a337', 'Amber'], ['#2fd26a', 'Green'], ['#4fc9a8', 'Mint'],
  ['#3b82f6', 'Blue'], ['#6d5cf0', 'Indigo'], ['#9b5cf6', 'Violet'], ['#f472b6', 'Pink']
];
export const DRAFT_COLOR = '#3b82f6';
export const SHAPES = ['circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond', 'cloud', 'clover', 'flower', 'star'];
export const EYES = ['pill', 'tall', 'circle', 'wide', 'squint', 'square', 'grid', 'matrix', 'bars', 'arc', 'rest', 'plus', 'heart', 'circle wide'];

export interface Look { shape: string; color: string; eyes: string }

/** FNV-1a over the UTF-16 units of a name */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** the look a name has until it is given one: the same name, the same look, on every machine */
export function lookFor(name: string): Look {
  const h = hash(String(name));
  return {
    color: (SWATCHES[h % SWATCHES.length] as readonly [string, string])[0],
    shape: SHAPES[(h >>> 8) % SHAPES.length] as string,
    eyes: EYES[(h >>> 16) % EYES.length] as string
  };
}
