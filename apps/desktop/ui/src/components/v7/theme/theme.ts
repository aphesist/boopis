/* v7 theming that is not CSS (DESIGN-SYSTEM.md v7 sections 5 and 18). A v7 surface is any element with `data-ui="v7"`;
   its theme is `data-theme` (dark, the default, or light), its corners `data-radii` (B, the default, or "c"), its light
   shadows `data-shadow` (A, the default, "b" or "c"). The accent is any hex: its text and focus shades and the colour
   on it come from contrast searches (section 18), so they are computed here and written on the root as custom properties.
   Iris, the owner's pick (P1), is the tokens' own value and needs nothing. Two derivations live here: the accent's
   (section 18) and a bot's own fill for your bubble and send in its chat (18.1). */
import { emit } from '../../../core/bus';
import { ratio } from '../../../styles/colour';

export type Mode = 'dark' | 'light';
export interface AccentTokens { '--accent': string; '--accent-text': string; '--focus': string; '--on-accent': string; '--accent-soft': string; '--accent-mark': string }

/* the surfaces section 18 measures against, per mode (tokens.v7.json color: bg-sidebar, bg-chrome, bg-elevated) */
const SURFACE: Record<Mode, { bg1: string; bg2: string; bg3: string }> = {
  dark: { bg1: '#0e0e0e', bg2: '#121212', bg3: '#1f1f1f' },
  light: { bg1: '#f5f5f5', bg2: '#fcfcfc', bg3: '#ffffff' }
};
/* the inverted ink: the dark ink text takes on a light fill (--text-on-light in dark, 18.1's #121212) */
const INK = '#121212';
/* the soft wash's alpha as the tokens set it for Iris (dark #5b5bd61f, light #5b5bd614) */
const SOFT: Record<Mode, string> = { dark: '1f', light: '14' };

/* ── OKLab (Björn Ottosson's matrices) ── */
const lin = (c: number): number => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c: number): number => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, v)) * 255); };
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
const rgbToHex = (c: readonly number[]): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOklab([L, a, b]: readonly [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]);
}
/** the colour moved in OKLab lightness (up or down) in small steps until `ok` holds, or the end of the range */
function walk(hex: string, dir: 1 | -1, ok: (c: string) => boolean): string {
  const [L, a, b] = toOklab(hex);
  for (let i = 0; i <= 200; i++) {
    const c = fromOklab([Math.max(0, Math.min(1, L + dir * i * 0.005)), a, b]);
    if (ok(c)) return c;
  }
  return dir > 0 ? '#ffffff' : '#000000';
}

/** section 18: the tokens a custom accent derives, in one mode */
export function deriveAccent(hex: string, mode: Mode): AccentTokens {
  const s = SURFACE[mode];
  const fill = rgbToHex(hexToRgb(hex));
  /* dark: lightened until 4.5:1 on --bg-3 and --bg-1; light: darkened until 4.5:1 on --bg-1 */
  const text = mode === 'dark' ? walk(fill, 1, (c) => ratio(c, s.bg3) >= 4.5 && ratio(c, s.bg1) >= 4.5) : walk(fill, -1, (c) => ratio(c, s.bg1) >= 4.5);
  /* white, or the inverted ink when white is under 4.5:1 on the fill */
  const on = ratio('#ffffff', fill) >= 4.5 ? '#ffffff' : INK;
  /* for marks only: a fill under 3:1 on --bg-2 is lightened (dark) or darkened (light) */
  const mark = ratio(fill, s.bg2) >= 3 ? fill : walk(fill, mode === 'dark' ? 1 : -1, (c) => ratio(c, s.bg2) >= 3);
  return { '--accent': fill, '--accent-text': text, '--focus': text, '--on-accent': on, '--accent-soft': fill + SOFT[mode], '--accent-mark': mark };
}

export interface ThemeOpts { theme?: Mode | undefined; accent?: string | null | undefined; radii?: 'b' | 'c' | undefined; shadow?: 'a' | 'b' | 'c' | undefined }
/** make an element a v7 root in a theme (the lab's kit stories; the app's root in wave C) */
export function applyTheme(root: HTMLElement, o: ThemeOpts = {}): void {
  root.setAttribute('data-ui', 'v7');
  const mode: Mode = o.theme ?? (root.getAttribute('data-theme') as Mode | null) ?? 'dark';
  root.setAttribute('data-theme', mode);
  if (o.radii === 'c') root.setAttribute('data-radii', 'c'); else if (o.radii) root.removeAttribute('data-radii');
  if (o.shadow && o.shadow !== 'a') root.setAttribute('data-shadow', o.shadow); else if (o.shadow) root.removeAttribute('data-shadow');
  const keys: (keyof AccentTokens)[] = ['--accent', '--accent-text', '--focus', '--on-accent', '--accent-soft', '--accent-mark'];
  const accent = o.accent === null ? null : o.accent ?? root.getAttribute('data-accent');
  if (!accent) { for (const k of keys) root.style.removeProperty(k); root.removeAttribute('data-accent'); }
  else {
    root.setAttribute('data-accent', accent);
    const t = deriveAccent(accent, mode);
    for (const k of keys) root.style.setProperty(k, t[k]);
  }
  /* orbs re-read the colours they resolved (the boopis bot's ink, cut-out eyes): the app's one theme event */
  emit('hx:theme', { preset: 'v7-' + mode, scheme: mode });
}

/** section 18.1: a bot's derived fill for your bubble and the send button in its own chat. White text when 4.5:1 is
    reachable by lowering OKLab L by at most 0.08 (the fill is that darkened colour); else the orb's colour with #121212 */
export function botFill(hex: string): { fill: string; text: string } {
  const base = rgbToHex(hexToRgb(hex));
  const [L, a, b] = toOklab(base);
  for (let d = 0; d <= 0.08 + 1e-9; d += 0.0025) {
    const c = d === 0 ? base : fromOklab([L - d, a, b]);
    if (ratio('#ffffff', c) >= 4.5) return { fill: c, text: '#ffffff' };
  }
  return { fill: base, text: '#121212' };
}

/** a bot's colour as text on a theme's ground (its name above a bubble in a room, its mention chip: 4.3). The orb's colour where it
    holds 4.5:1 on --bg-2 and --bg-3, else moved in OKLab lightness until it does (lighter in dark, darker in light), so the WCAG floor
    holds for every look. The design names the colour, not this floor's derivation: an owner question (kit-v7 report) */
export function botText(hex: string, mode: Mode): string {
  const s = SURFACE[mode], base = rgbToHex(hexToRgb(hex));
  const ok = (c: string): boolean => ratio(c, s.bg2) >= 4.5 && ratio(c, s.bg3) >= 4.5;
  return ok(base) ? base : walk(base, mode === 'dark' ? 1 : -1, ok);
}
