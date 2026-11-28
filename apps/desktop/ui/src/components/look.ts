/* How a bot looks: orb2's body shape and a colour. The eyes are never part of a look: they follow the bot's state
   (owner decision, 19 November 2026, R-orb-1). The palettes are the new-bot picker's; they are bot data, not interface
   colour (R-colour-8).

   ONE resolver. `lookOf(bot)` is the look of a bot wherever an orb of it is drawn: its own shape and colour when it
   has them (the plugin's record, the new-bot sheet, the look editor), else the look its name gives. `ui.orb` draws
   every orb through it, the live provider maps the plugin's record through it, and `lookAttrs` turns a look into the
   attributes an <orb-avatar> carries (with the light eyes of a dark body, R-orb-7), so no two places can draw the same
   bot two ways. A look derived from a name is a default, never stored: the same name always draws the same bot, until
   its owner picks another and boopis saves it with the teammate. */

export const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ['#efece6', 'Bone'], ['#a6a6ab', 'Pewter'], ['#1c1c24', 'Ink'], ['#c4834a', 'Clay'],
  ['#f23b5a', 'Rose'], ['#f5a337', 'Amber'], ['#2fd26a', 'Green'], ['#4fc9a8', 'Mint'],
  ['#3b82f6', 'Blue'], ['#6d5cf0', 'Indigo'], ['#9b5cf6', 'Violet'], ['#f472b6', 'Pink']
];
export const DRAFT_COLOR = '#3b82f6';
/** orb2's built-in bodies (OrbBuiltInShape), in the picker's order */
export const SHAPES = ['circle', 'squircle', 'soft', 'wide', 'tall', 'bean', 'drop', 'ghost', 'triangle', 'hexagon', 'diamond', 'cloud', 'clover', 'flower', 'star'];

export interface Look { shape: string; color: string }
/** what a look is read from: a bot, a draft, a group member, a plugin record's `look` with the name beside it */
export interface LookSource { id?: string | undefined; name?: string | undefined; shape?: unknown; color?: unknown }

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
/** a shape orb2 draws, as the plugin stores it (lower case); anything else is not a shape */
export const shapeOf = (v: unknown): string | null => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return SHAPES.includes(s) ? s : null; };
/** a colour as the plugin stores it (`#rrggbb`, lower case); anything else (a name, a short form, a typo) is not one */
export const colourOf = (v: unknown): string | null => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return /^#[0-9a-f]{6}$/.test(s) ? s : null; };

/** THE look of a bot: its own shape and colour where it has a valid one, each part separately, else its name's. A record
    written outside boopis (a profile made with the hermes command, a hand-written bot.json) may hold half a look, a
    shape orb2 has no body for or a colour in another form: the part that is not valid is the name's. */
export function lookOf(b: LookSource): Look {
  const shape = shapeOf(b.shape), color = colourOf(b.color);
  if (shape && color) return { shape, color };
  const base = lookFor(b.name ?? b.id ?? '');
  return { shape: shape ?? base.shape, color: color ?? base.color };
}
export const sameLook = (a: LookSource, b: LookSource): boolean => { const x = lookOf(a), y = lookOf(b); return x.shape === y.shape && x.color === y.color; };
/** the swatch's name for a colour ("Mint"), or null for one that is not a swatch */
export const colourName = (c: string): string | null => SWATCHES.find(([v]) => v === colourOf(c))?.[1] ?? null;

/** WCAG relative luminance of `#rrggbb` (1 for anything else, so an unknown colour keeps the dark eyes) */
export function lumHex(hex: string | undefined): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ''); if (!m) return 1;
  const n = parseInt(m[1] ?? '0', 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
/* The two swatches that fade into their own theme (the owner, 28 November 2026: "black becomes grayish black and white becomes
   more pearl-sand like"). Bone draws as pearl-sand in the light theme and Ink as graphite in the dark theme, each through a v7
   token (`--look-bone`, `--look-ink`; scripts/build-tokens-v7.mjs), so one bot follows the theme of the surface it is drawn on
   (the dock's inside is the dark theme in both). Bone on dark and Ink on light already stand out and keep the swatch. What is
   stored, rolled and named stays the swatch: only the drawing changes. On pearl-sand the eyes cut to a near-white surface would
   vanish, so there Bone's eyes are the theme's ink (`--look-bone-eye`); elsewhere they are cut to the surface as before. */
const SHADED: Readonly<Record<string, { color: string; eye?: (cut: string) => string }>> = {
  '#efece6': { color: 'var(--look-bone, #efece6)', eye: (cut) => 'var(--look-bone-eye, ' + cut + ')' },
  '#1c1c24': { color: 'var(--look-ink, #1c1c24)' }
};
/** the attributes of an <orb-avatar> for a look on a surface (its token, the ground `--bg-2` when left out): shape, colour (Bone and
    Ink as their theme draws them, above), and the eyes: light on a dark body (luminance under .05, R-orb-7), the theme's ink on
    Bone where it is pearl-sand, else null (the caller cuts them to the surface); never `eye-shape` (the eyes are the state's) */
export function lookAttrs(look: Look, surface = '--bg-2'): { shape: string; color: string; 'eye-color': string | null } {
  const shade = SHADED[String(look.color).toLowerCase()];
  return { shape: look.shape, color: shade?.color ?? look.color, 'eye-color': lumHex(look.color) < 0.05 ? 'var(--ink-on-dock)' : shade?.eye ? shade.eye('var(' + surface + ')') : null };
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
