/* Colour maths and the token reader: pure of the app's state (no settings, no bus), so the component library can use them
   (a mod's colours, components/mod-colors.ts) and the theme runtime builds on them (styles/theme.ts). */

export type RGBA = [number, number, number, number];
/** Colours as the browser resolves them. Chrome reports a color-mix() as color(srgb r g b / a) with channels from
    0 to 1, other colours as rgb(a) from 0 to 255; both are read here (Finding F6). */
export function parseColor(css: string): RGBA {
  const ch = (v: string | undefined, scale: number): number => (v == null || v === 'none' ? 0 : v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v));   // scale: what 100% means
  const f = /color\(srgb\s+([^\s/)]+)\s+([^\s/)]+)\s+([^\s/)]+)(?:\s*\/\s*([^\s)]+))?\)/.exec(css);
  if (f) return [ch(f[1], 1) * 255, ch(f[2], 1) * 255, ch(f[3], 1) * 255, f[4] == null ? 1 : ch(f[4], 1)];
  const m = css.match(/-?[\d.]+(?:e[-+]?\d+)?%?/gi) ?? [];
  return [ch(m[0], 255), ch(m[1], 255), ch(m[2], 255), m[3] == null ? 1 : ch(m[3], 1)];
}
export const toHex = (c: readonly number[]): string => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** WCAG relative luminance of #rrggbb */
export function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
/** WCAG contrast ratio of two #rrggbb colours */
export function ratio(a: string, b: string): number { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** `top` laid over `under` at top's alpha, as the eye sees it */
export function composite(top: RGBA, under: RGBA): string { const a = top[3]; return toHex([0, 1, 2].map((i) => (top[i] ?? 0) * a + (under[i] ?? 0) * (1 - a))); }

let probe: HTMLElement | null = null, dockScope: HTMLElement | null = null;
export function rgbaOf(token: string, scope?: 'dock'): RGBA {
  if (!probe) {
    probe = document.createElement('i');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  }
  let host: HTMLElement = document.body || document.documentElement;
  if (scope === 'dock') {
    if (!dockScope) { dockScope = document.createElement('div'); dockScope.setAttribute('data-ground', 'dock'); dockScope.setAttribute('aria-hidden', 'true'); dockScope.style.cssText = probe.style.cssText; }
    host.appendChild(dockScope); host = dockScope;
  }
  host.appendChild(probe);
  probe.style.color = 'var(' + token + ')';
  const c = parseColor(getComputedStyle(probe).color).map((v, i) => (i < 3 ? Math.max(0, Math.min(255, v)) : Math.max(0, Math.min(1, v)))) as RGBA;
  probe.remove();
  if (dockScope) dockScope.remove();
  return c;
}
/** a token as the browser resolves it, as #rrggbb */
export const hexOf = (token: string, scope?: 'dock'): string => toHex(rgbaOf(token, scope));
