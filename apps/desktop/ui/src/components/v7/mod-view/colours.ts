/* Colour stays in theme (owner decision, 19 November 2026; DESIGN-SYSTEM.md 14.29). Every colour a mod names, by Claude
   Code name or theme key, maps onto the active theme's tokens, so a mod reads as part of the app in every preset and keeps
   its contrast. A literal colour (a hex, rgb()) is drawn as given only when it has enough contrast on the surface under it
   (4.5 for text, 3 for marks), else the nearest semantic token. A mod that wants its own palette proposes a theme (the card
   with the live preview); it never paints around the theme. */
import { hexOf, ratio } from '../../../styles/colour';

export type Role = 'text' | 'mark';
/** where a mod's drawing stands: a tab of the Pane, a ToolRow in the thread, the band in the strip over the composer */
export type Surface = 'pane' | 'row' | 'band';

/** text, in the v7 text tokens (`--ok-text`, `--red-text`, `--warn-text`). `claude` is the accent in Claude Code, and the accent is never
    text (DESIGN-SYSTEM 4.3), so text takes --text-strong; as a mark it is the theme's accent (`--brass`, the token a mod's theme sets) */
export const TEXT: Readonly<Record<string, string>> = {
  text: '--text', claude: '--text-strong', success: '--ok-text', error: '--red-text', warning: '--warn-text', subtle: '--text-quiet', inactive: '--text-quiet',
  suggestion: '--text-dim', permission: '--text-dim', remember: '--text-dim', merged: '--text-dim', autoAccept: '--ok-text', planMode: '--text-dim',
  inverseText: '--text-on-light', diffAdded: '--add', diffRemoved: '--del', diffAddedWord: '--add', diffRemovedWord: '--del', diffAddedDimmed: '--add', diffRemovedDimmed: '--del',
  red: '--red-text', green: '--ok-text', yellow: '--warn-text', blue: '--text-strong', cyan: '--text-strong', magenta: '--text-dim', white: '--text-strong', gray: '--text-quiet', grey: '--text-quiet', black: '--text',
  redBright: '--red-text', greenBright: '--ok-text', yellowBright: '--warn-text', blueBright: '--text-strong', cyanBright: '--text-strong', magentaBright: '--text-dim', whiteBright: '--text-strong'
};
/** marks: fills, strokes and borders (not text), where the accent is allowed */
export const MARK: Readonly<Record<string, string>> = { ...TEXT, success: '--ok', error: '--red', warning: '--warn', red: '--red', green: '--ok', yellow: '--warn', claude: '--brass', blue: '--brass', cyan: '--brass', blueBright: '--brass', cyanBright: '--brass', magenta: '--text-dim', promptBorder: '--line', bashBorder: '--line' };
/** the diff names that tint a Box background (the rest draw solid) */
export const TINT: Readonly<Record<string, string>> = { diffAdded: '--add', diffRemoved: '--del', diffAddedWord: '--add', diffRemovedWord: '--del', diffAddedDimmed: '--add', diffRemovedDimmed: '--del' };
/** surfaces: a mod asks for a surface by name; the active theme decides what it looks like */
export const SURFACE: Readonly<Record<string, string>> = { 'surface-0': '--bg-0', 'surface-1': '--bg-3', 'surface-2': '--bg-4', inset: '--bg-0', raised: '--bg-3', pressed: '--bg-4' };
export const NEAREST: readonly string[] = ['--text', '--text-dim', '--text-quiet', '--brass', '--ok-text', '--red-text', '--warn-text', '--add'];
/** the token under a mod's drawing, by surface: a pane on the Pane's ground, a placed row on its ToolRow's block, the band on the strip */
export const SURF_VAR: Readonly<Record<Surface, string>> = { pane: '--bg-pane', row: '--bg-3', band: '--bg-3' };

export type Rgb = readonly [number, number, number];
/** a token as the browser resolves it, '#rrggbb' (replaced in unit tests, where there is no cascade) */
let readToken: (token: string) => string | null = (t) => { try { return hexOf(t); } catch { return null; } };
export function setTokenReader(fn: ((token: string) => string | null) | null): void { readToken = fn ?? ((t) => { try { return hexOf(t); } catch { return null; } }); }

export const isLiteral = (v: string): boolean => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgb\(/i.test(v);
/** a literal as [r, g, b], or null when it is not one */
export function parseLiteral(v: string): Rgb | null {
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    let h = m[1] ?? '';
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgb\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)\s*\)$/i.exec(v);
  return m ? [Math.min(255, +(m[1] ?? 0)), Math.min(255, +(m[2] ?? 0)), Math.min(255, +(m[3] ?? 0))] : null;
}
const toHex = (c: Rgb): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const rgbOfHex = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
const dist = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** a literal as given when it holds up on the surface under it, else the nearest token that does (as `var(--token)`) */
export function literalOn(v: string, role: Role, surface: Surface): string {
  const rgb = parseLiteral(v), bgHex = readToken(SURF_VAR[surface] ?? '--bg-1');
  if (!rgb || !bgHex) return 'var(--text)';
  const need = role === 'text' ? 4.5 : 3;
  if (ratio(toHex(rgb), bgHex) >= need) return v;
  const ok = NEAREST.map((n) => ({ n, c: readToken(n) }))
    .filter((x): x is { n: string; c: string } => !!x.c && ratio(x.c, bgHex) >= need)
    .sort((a, b) => dist(rgbOfHex(a.c), rgb) - dist(rgbOfHex(b.c), rgb));
  return 'var(' + (ok[0] ? ok[0].n : '--text') + ')';
}

/** the token a name maps to, for a role; null when the name is unknown */
export const tokenFor = (name: string, role: Role): string | null => (role === 'text' ? TEXT : MARK)[name] ?? null;
/** the CSS value for a name that is not a literal: its token, else the quiet default of the role */
export const namedValue = (name: string, role: Role): string => { const t = tokenFor(name, role); return t ? 'var(' + t + ')' : role === 'text' ? 'var(--text)' : 'var(--line)'; };

/* ───────── a colour, as the view writes it and the behaviour paints it ───────── */
/** a colour a mod named, for a style property (`color`, `fill`, `background`) or a custom property (`--mv-border`): a name is its token at
    once (`style`); a literal waits for the behaviour, which reads the surface under it (`lit`, one `prop|role|value` entry) */
export function colourOf(prop: string, name: unknown, role: Role): { style?: string; lit?: string } {
  if (name == null || name === '') return {};
  const key = String(name);
  if (isLiteral(key)) return { lit: prop + '|' + role + '|' + key };
  return { style: prop + ':' + namedValue(key, role) };
}
type Styled = (HTMLElement | SVGElement) & ElementCSSInlineStyle;
/** paint every literal under a ModView's root against the surface it stands on (on wiring, and again when the theme changes) */
export function paintLiterals(root: Element, surface: Surface): void {
  const nodes = root.matches('[data-mv-lit]') ? [root, ...root.querySelectorAll('[data-mv-lit]')] : [...root.querySelectorAll('[data-mv-lit]')];
  for (const n of nodes as Styled[]) {
    for (const entry of (n.getAttribute('data-mv-lit') ?? '').split(';')) {
      const [prop, role, value] = entry.split('|');
      if (!prop || !value || (role !== 'text' && role !== 'mark')) continue;
      n.style.setProperty(prop === 'stop-color' ? 'stop-color' : prop, literalOn(value, role, surface));
    }
  }
}
