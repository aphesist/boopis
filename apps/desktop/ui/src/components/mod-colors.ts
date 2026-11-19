/* Colour stays in theme (owner decision, 19 November 2026; DESIGN-SYSTEM.md 14.29). Every colour a mod names, by Claude
   Code name or theme key, maps onto the active theme's tokens, so a mod reads as part of the app in every preset and keeps
   its contrast. A literal colour (a hex, rgb()) is drawn as given only when it has enough contrast on the surface under it
   (4.5 for text, 3 for marks), else the nearest semantic token. A mod that wants its own palette proposes a theme (the card
   with the live preview); it never paints around the theme. */
import { hexOf, ratio } from '../styles/theme';

export type Role = 'text' | 'mark';
export type Surface = 'frame' | 'ground' | 'inset';

/** text. `claude` is the accent in Claude Code, and brass is never text (DESIGN-SYSTEM 4.3), so text takes --text-strong */
export const TEXT: Readonly<Record<string, string>> = {
  text: '--text', claude: '--text-strong', success: '--ok', error: '--del', warning: '--warn', subtle: '--text-quiet', inactive: '--text-quiet',
  suggestion: '--text-dim', permission: '--text-dim', remember: '--text-dim', merged: '--text-dim', autoAccept: '--ok', planMode: '--text-dim',
  inverseText: '--text-on-light', diffAdded: '--add', diffRemoved: '--del', diffAddedWord: '--add', diffRemovedWord: '--del', diffAddedDimmed: '--add', diffRemovedDimmed: '--del',
  red: '--del', green: '--ok', yellow: '--warn', blue: '--text-strong', cyan: '--text-strong', magenta: '--text-dim', white: '--text-strong', gray: '--text-quiet', grey: '--text-quiet', black: '--text',
  redBright: '--del', greenBright: '--ok', yellowBright: '--warn', blueBright: '--text-strong', cyanBright: '--text-strong', magentaBright: '--text-dim', whiteBright: '--text-strong'
};
/** marks: fills, strokes and borders (not text), where the accent is allowed */
export const MARK: Readonly<Record<string, string>> = { ...TEXT, claude: '--brass', blue: '--brass', cyan: '--brass', blueBright: '--brass', cyanBright: '--brass', magenta: '--text-dim', promptBorder: '--line', bashBorder: '--line' };
/** the diff names that tint a Box background (the rest draw solid) */
export const TINT: Readonly<Record<string, string>> = { diffAdded: '--add', diffRemoved: '--del', diffAddedWord: '--add', diffRemovedWord: '--del', diffAddedDimmed: '--add', diffRemovedDimmed: '--del' };
/** surfaces: a mod asks for a surface by name; the active theme decides what it looks like */
export const SURFACE: Readonly<Record<string, string>> = { 'surface-0': '--bg-0', 'surface-1': '--bg-3', 'surface-2': '--bg-4', inset: '--bg-0', raised: '--bg-3', pressed: '--bg-4' };
export const NEAREST: readonly string[] = ['--text', '--text-dim', '--text-quiet', '--brass', '--ok', '--del', '--warn', '--add'];
/** the token under a mod's drawing, by surface: a pane is on the frame, a placed row on the ground, the band inset */
export const SURF_VAR: Readonly<Record<Surface, string>> = { frame: '--bg-1', ground: '--bg-2', inset: '--bg-0' };

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

/* ───────── painting a node ───────── */
/** a literal that was written onto a node: re-read when the theme changes (a surface or a token moved) */
export interface Lit { node: Element; apply(): void }
export interface PaintCtx { surface: Surface; lits: Lit[] }
type Styled = (HTMLElement | SVGElement) & ElementCSSInlineStyle;

/** set a colour a mod named on a node: `prop` is a style property ('color', 'fill', 'background') or a custom property ('--mv-border') */
export function paintColor(node: Styled, prop: string, name: unknown, role: Role, ctx: PaintCtx): void {
  if (name == null || name === '') return;
  const key = String(name);
  const write = (v: string): void => { if (prop.startsWith('-')) node.style.setProperty(prop, v); else (node.style as unknown as Record<string, string>)[prop] = v; };
  if (isLiteral(key)) {
    const apply = (): void => { write(literalOn(key, role, ctx.surface)); };
    apply();
    ctx.lits.push({ node, apply });
    return;
  }
  write(namedValue(key, role));
}
