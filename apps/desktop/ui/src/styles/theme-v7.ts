/* The v7 appearance (DESIGN-SYSTEM.md v7 sections 5 and 18): Theme (Follow system, Light, Dark), the accent (any hex; the kit
   derives the rest), corners (B Standard or C Rounder), light shadows (A, B or C), and "Your messages in a bot's colour" (18.1).
   Kept with the UI's settings (`hx.v7.theme`, core/settings). Settings > Appearance edits them.

   While wave C moves the screens, the app is part v6 and part v7: the v6 theme (styles/theme.ts) still draws the v6 parts, so
   Light and Dark choose its light and dark preset (Bone and Card catalog, the lab's mapping), and density is the v6 theme's own
   setting (tokens.v7 has no density steps yet). Every v7 root that follows the theme (`followTheme`: the Settings and Store
   dialogs, and any root a screen registers) takes the v6 theme's scheme and these choices, again whenever either changes. */
import { emit, on } from '../core/bus';
import { KEYS, readJSON, writeJSON } from '../core/settings';
import { kit } from '@boopis/ui';
import { PRESETS, themeApi } from './theme';
import type { Density } from './theme';

export const MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof MODES)[number];
export const RADII = ['b', 'c'] as const;
export const SHADOWS = ['a', 'b', 'c'] as const;
export interface Appearance { mode: ThemeMode; accent: string | null; radii: 'b' | 'c'; shadow: 'a' | 'b' | 'c'; botColour: boolean }
const KEY = KEYS.appearance;
const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULTS: Appearance = { mode: 'dark', accent: null, radii: 'b', shadow: 'a', botColour: true };

/** a saved appearance, read leniently: what is not one of the choices is the default */
export function sanitizeAppearance(o: unknown): Appearance {
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
  return {
    mode: pick(r['mode'], MODES, DEFAULTS.mode), accent: typeof r['accent'] === 'string' && HEX.test(r['accent']) ? r['accent'].toLowerCase() : null,
    radii: pick(r['radii'], RADII, 'b'), shadow: pick(r['shadow'], SHADOWS, 'a'), botColour: r['botColour'] !== false
  };
}

let cur: Appearance | null = null;
/** the appearance as saved (the defaults when nothing is, or storage is blocked) */
export function appearance(): Appearance {
  cur ??= (() => { const saved = readJSON<Record<string, unknown>>(KEY); return saved ? sanitizeAppearance(saved) : { ...DEFAULTS, mode: themeApi.scheme() }; })();
  return { ...cur };
}

const media = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null);
/** the scheme a mode resolves to now */
export const schemeOf = (m: ThemeMode): 'dark' | 'light' => (m === 'system' ? (media()?.matches ? 'light' : 'dark') : m);

/** the v6 theme in the scheme a mode asks for, when it is not in it already (its own preset otherwise kept) */
function syncV6(m: ThemeMode): void {
  const want = schemeOf(m);
  if (themeApi.scheme() !== want) themeApi.preset(want === 'light' ? 'bone' : 'catalog');
}

const roots = new Set<HTMLElement>();
function paint(el: HTMLElement): void {
  const a = appearance();
  kit.applyTheme(el, { theme: themeApi.scheme(), accent: a.accent, radii: a.radii, shadow: a.shadow, quiet: true });
}
const paintAll = (): void => { for (const r of roots) paint(r); };

/** change the appearance: saved, then every following root (and the v6 theme, for Theme) shows it */
export function setAppearance(patch: Partial<Appearance>): void {
  cur = sanitizeAppearance({ ...appearance(), ...patch });
  writeJSON(KEY, { ...cur });
  if ('mode' in patch) syncV6(cur.mode);
  paintAll();
  emit('hx:theme', { preset: 'v7-' + themeApi.scheme(), scheme: themeApi.scheme() });
}

/** density: the v6 theme's own (compact, regular, comfortable) */
export const density = (): Density => (themeApi.get().density ?? PRESETS[themeApi.get().preset].density);
export const setDensity = (d: Density): void => { themeApi.set({ density: d }); };

/** make `el` a v7 root that follows the theme from now on */
export function followTheme(el: HTMLElement): HTMLElement {
  roots.add(el);
  paint(el);
  return el;
}

let started = false;
/** once, at boot: the saved mode is applied to the v6 theme, Follow system follows the system, and the roots follow the v6 theme */
export function startThemeV7(): void {
  if (started) return;
  started = true;
  const saved = readJSON<Record<string, unknown>>(KEY);
  if (saved) syncV6(appearance().mode);
  media()?.addEventListener('change', () => { if (appearance().mode === 'system') syncV6('system'); });
  on('hx:theme', (e) => {
    if (e.preset.startsWith('v7-')) return;
    /* the v6 theme moved by another way (the light and dark key, a preset in a test): an explicit mode follows it */
    const a = appearance();
    if (a.mode !== 'system' && a.mode !== e.scheme) { cur = { ...a, mode: e.scheme }; writeJSON(KEY, { ...cur }); }
    paintAll();
  });
}
