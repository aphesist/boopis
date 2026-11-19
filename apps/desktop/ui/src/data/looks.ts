/* How a bot looks (orb2: a body shape and a colour; the eyes are never part of a look, they follow the bot's state) and what a bot with no look of its own gets. The palettes are
   the new-bot picker's; they are bot data, not interface colour. A look derived from a name is a default, never stored:
   the same name always draws the same bot, until its owner picks another and boopis saves it with the teammate. */
export const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ['#efece6', 'Bone'], ['#a6a6ab', 'Pewter'], ['#1c1c24', 'Ink'], ['#c4834a', 'Clay'],
  ['#f23b5a', 'Rose'], ['#f5a337', 'Amber'], ['#2fd26a', 'Green'], ['#4fc9a8', 'Mint'],
  ['#3b82f6', 'Blue'], ['#6d5cf0', 'Indigo'], ['#9b5cf6', 'Violet'], ['#f472b6', 'Pink']
];
export const DRAFT_COLOR = '#3b82f6';
export const SHAPES = ['circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond', 'cloud', 'clover', 'flower', 'star'];

export interface Look { shape: string; color: string }

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
    shape: SHAPES[(h >>> 8) % SHAPES.length] as string
  };
}

export interface RollOpts {
  /** the shapes on offer (the picker's list, narrowed by what orb2 can draw); SHAPES by default */
  shapes?: readonly string[];
  /** looks (shape and colour) that existing bots have: kept out of the answer while another combination is free */
  taken?: ReadonlyArray<{ shape?: string; color?: string }>;
  /** the look in the field now: a roll never lands on it while another is free */
  avoid?: { shape?: string; color?: string };
  /** a number in [0, 1); Math.random by default */
  random?: () => number;
}
const lookKey = (shape: string | undefined, color: string | undefined): string => String(shape ?? '').toLowerCase() + '|' + String(color ?? '').toLowerCase();
/** a random colour from the swatches and shape from the offered shapes, one not worn by an existing bot nor by the
    look in the field while another combination is free; the eyes are not rolled, they follow the state */
export function rollLook(o: RollOpts = {}): Look {
  const rand = o.random ?? Math.random;
  const shapes = o.shapes?.length ? o.shapes : SHAPES;
  const used = new Set((o.taken ?? []).map((b) => lookKey(b.shape, b.color)));
  const here = o.avoid ? lookKey(o.avoid.shape, o.avoid.color) : null;
  const all: Array<readonly [string, string]> = [];
  for (const shape of shapes) for (const [color] of SWATCHES) all.push([shape, color]);
  const free = all.filter(([s, c]) => !used.has(lookKey(s, c)));
  const fresh = free.filter(([s, c]) => lookKey(s, c) !== here);
  const from = fresh.length ? fresh : free.length ? free : all;
  const [shape, color] = from[Math.floor(rand() * from.length)] as readonly [string, string];
  return { shape, color };
}
