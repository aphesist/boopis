/* boopis theme runtime (ported from v6 theme.js). A theme = a preset (a block of tokens in tokens.css, chosen
   with data-hx-preset on <html>) + the user's overrides (solid colours, interface and code fonts, interface case,
   corners, density). Overrides are written as inline custom properties on <html>; translucent tokens derive from
   the solid ones in tokens.css. The dock's black (--dock-bg) is fixed and never offered. Saved through
   core/settings (storage may be blocked: the theme still applies). Emits `hx:theme`.
   The pure parts (colour parsing, contrast, sanitising an imported theme) are exported for the unit tests. */
import { emit } from '../core/bus';
import { KEYS, readJSON, writeJSON } from '../core/settings';
import { ensureFont } from './fonts';

const root = document.documentElement;
const HEX = /^#[0-9a-f]{6}$/i;

export type PresetId = 'catalog' | 'graphite' | 'bone' | 'typewriter';
export type CaseMode = 'sentence' | 'lower';
export type CornerMode = 'sharp' | 'default' | 'round';
export type Density = 'compact' | 'regular' | 'comfortable';

export interface Preset { name: string; note: string; sans: string; mono: string; case: CaseMode; corners: CornerMode; density: Density }
export const PRESETS: Record<PresetId, Preset> = {
  catalog:    { name: 'Card catalog', note: 'Warm dark, the default', sans: 'Libre Franklin', mono: 'IBM Plex Mono', case: 'sentence', corners: 'default', density: 'regular' },
  graphite:   { name: 'Graphite', note: 'Neutral grey, close to the Figma', sans: 'Geist', mono: 'Geist Mono', case: 'sentence', corners: 'default', density: 'regular' },
  bone:       { name: 'Bone', note: 'Light', sans: 'Libre Franklin', mono: 'IBM Plex Mono', case: 'sentence', corners: 'default', density: 'regular' },
  typewriter: { name: 'Typewriter', note: 'Mono and lowercase', sans: 'Geist Mono', mono: 'Geist Mono', case: 'lower', corners: 'round', density: 'regular' }
};
const isPreset = (id: string): id is PresetId => Object.prototype.hasOwnProperty.call(PRESETS, id);

const MONO_STACK = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const SANS_STACK = '"Helvetica Neue", Arial, system-ui, sans-serif';
/** [name, CSS font-family stack]; a null font is the system font (nothing to load) */
export type FontDef = readonly [name: string, stack: string, bundled: boolean];
export const FONTS: { sans: readonly FontDef[]; mono: readonly FontDef[] } = {
  sans: [
    ['Libre Franklin', '"Libre Franklin", "Franklin Gothic", ' + SANS_STACK, true],
    ['Geist', '"Geist", ' + SANS_STACK, true],
    ['IBM Plex Sans', '"IBM Plex Sans", ' + SANS_STACK, true],
    ['Instrument Sans', '"Instrument Sans", ' + SANS_STACK, true],
    ['Public Sans', '"Public Sans", ' + SANS_STACK, true],
    ['Geist Mono', '"Geist Mono", ' + MONO_STACK, true],
    ['IBM Plex Mono', '"IBM Plex Mono", ' + MONO_STACK, true],
    ['System', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', false]
  ],
  mono: [
    ['IBM Plex Mono', '"IBM Plex Mono", ' + MONO_STACK, true],
    ['Geist Mono', '"Geist Mono", ' + MONO_STACK, true],
    ['JetBrains Mono', '"JetBrains Mono", ' + MONO_STACK, true],
    ['Source Code Pro', '"Source Code Pro", ' + MONO_STACK, true],
    ['System', MONO_STACK, false]
  ]
};
type FontKind = 'sans' | 'mono';
const fontOf = (kind: FontKind, name: unknown): FontDef | null => FONTS[kind].find((f) => f[0] === name) ?? null;

/** [token, label, note] */
type ColourRow = readonly [token: string, label: string, note: string];
export const GROUPS: ReadonlyArray<readonly [string, readonly ColourRow[]]> = [
  ['Signal', [['--brass', 'Accent', 'You are here: focus, the current item, checked items'], ['--red', 'Attention', 'Dots and outlines when you are needed'], ['--red-text', 'Attention text', 'Stamps such as "waiting for you"']]],
  ['Surfaces', [['--bg-1', 'Frame', 'Title bar, sidebars, panels, menus'], ['--bg-2', 'Ground', 'Behind the conversation'], ['--bg-3', 'Raised', 'Your messages, the composer, tooltips'], ['--bg-0', 'Inset', 'Fields and cards in the conversation'], ['--bg-4', 'Pressed', ''], ['--chip', 'Code chips', '']]],
  ['Text', [['--text', 'Text', 'Lines and hover fills follow this colour'], ['--text-strong', 'Strong text', ''], ['--text-dim', 'Secondary text', ''], ['--text-quiet', 'Meta text', 'Times, costs, labels'], ['--text-faint', 'Faint', 'Decoration and disabled only']]],
  ['Icons', [['--icon', 'Icons', ''], ['--icon-quiet', 'Window controls', ''], ['--icon-off', 'Disabled icons', '']]],
  ['Selection', [['--selected', 'Selected fill', 'The selected tab, primary buttons'], ['--text-on-light', 'Text on the selected fill', '']]],
  ['Status', [['--ok', 'Success', ''], ['--warn', 'Warning', ''], ['--add', 'Added lines', ''], ['--del', 'Removed lines', '']]]
];
export const EDITABLE: readonly string[] = GROUPS.flatMap((g) => g[1].map((r) => r[0]));

/** The pairs that must hold (DESIGN-SYSTEM.md 5.4). [fg, bg, min, label, scope]. 'a@b' is a translucent token laid
    over a solid one. Scope 'dock' measures inside [data-ground="dock"] (the pitch-black dock, whose inks derive
    from the theme). The flag dot goes on the editable colours a failing pair is made of. */
export type Pair = readonly [fg: string, bg: string, min: number, label: string, scope?: 'dock'];
export const PAIRS: readonly Pair[] = [
  ['--text', '--bg-1', 4.5, 'Text on the frame'], ['--text', '--bg-2', 4.5, 'Text on the ground'], ['--text', '--bg-3', 4.5, 'Text on raised surfaces'], ['--text', '--bg-0', 4.5, 'Text on inset cards'],
  ['--text-dim', '--bg-1', 4.5, 'Secondary text on the frame'], ['--text-dim', '--bg-2', 4.5, 'Secondary text on the ground'], ['--text-dim', '--bg-3', 4.5, 'Secondary text on raised surfaces'],
  ['--text-quiet', '--bg-1', 4.5, 'Meta text on the frame'], ['--text-quiet', '--bg-2', 4.5, 'Meta text on the ground'], ['--text-quiet', '--bg-3', 4.5, 'Meta text on raised surfaces'], ['--text-quiet', '--bg-0', 4.5, 'Meta text on inset cards'],
  ['--text', '--current@--bg-1', 4.5, 'Text on a selected row'], ['--text-quiet', '--current@--bg-1', 4.5, 'Meta text on a selected row'],
  ['--text', '--chip', 4.5, 'Code in a chip'], ['--text-dim', '--bg-4', 4.5, 'Keys in a tooltip'],
  ['--text-on-light', '--selected', 4.5, 'Text on the selected fill'],
  ['--red-text', '--bg-2', 4.5, 'Attention text on the ground'], ['--red-text', '--bg-0', 4.5, 'Attention text on inset cards'], ['--red-text', '--bg-1', 4.5, 'Attention text on the frame'], ['--red-text', '--current@--bg-1', 4.5, 'Attention text on a selected row'],
  ['--add', '--bg-1', 4.5, 'Added-line count on the frame'], ['--del', '--bg-1', 4.5, 'Removed-line count on the frame'],
  ['--brass', '--bg-1', 3, 'Accent on the frame'], ['--brass', '--bg-2', 3, 'Accent on the ground'], ['--brass', '--bg-3', 3, 'Accent on raised surfaces'],
  ['--icon', '--bg-1', 3, 'Icons on the frame'], ['--icon-quiet', '--bg-1', 3, 'Window controls on the frame'],
  ['--red', '--bg-2', 3, 'Attention dots on the ground'], ['--red', '--bg-1', 3, 'Attention dots on the frame'],
  ['--line-field@--bg-0', '--bg-1', 3, 'Field outline against the frame'], ['--line-field@--bg-0', '--bg-0', 3, 'Field outline against the field'],
  ['--mark-off', '--bg-1', 3, 'Inactive marks on the frame'], ['--mark-off', '--bg-3', 3, 'Inactive marks on raised surfaces'],
  ['--text', '--bg-1', 4.5, 'Dock text on black', 'dock'], ['--text-quiet', '--bg-1', 4.5, 'Dock meta on black', 'dock'], ['--text-quiet', '--bg-3', 4.5, 'Meta on a card set into the dock', 'dock'],
  ['--red-text', '--bg-1', 4.5, 'Dock attention text on black', 'dock'], ['--brass', '--bg-1', 3, 'Dock accent on black', 'dock'],
  ['--mark-off', '--bg-1', 3, 'Dock inactive marks on black', 'dock']
];
/** which editable colours a dock pair is made of: the dock's inks derive from text (the ground in light themes),
    the accent and the attention red; its black is fixed */
export const DOCK_BLAME: Record<string, readonly string[]> = { '--text': ['--text', '--bg-2'], '--mark-off': ['--text', '--bg-2'], '--text-quiet': ['--text', '--bg-2'], '--red-text': ['--red'], '--brass': ['--brass'], '--bg-3': ['--text', '--bg-2'], '--bg-1': [] };
/** a derived token is blamed on the editable colours it is mixed from */
export const DERIVED: Record<string, readonly string[]> = { '--current': ['--text'], '--line-field': ['--text'], '--mark-off': ['--text-quiet', '--text-faint'] };

export const CASES: readonly CaseMode[] = ['sentence', 'lower'];
export const CORNERS: readonly CornerMode[] = ['sharp', 'default', 'round'];
export const DENSITIES: readonly Density[] = ['compact', 'regular', 'comfortable'];

type Overridable = 'sans' | 'mono' | 'case' | 'corners' | 'density';
const OVERRIDABLE: readonly Overridable[] = ['sans', 'mono', 'case', 'corners', 'density'];

export interface Theme {
  preset: PresetId;
  colors: Record<string, string>;
  sans: string | null; mono: string | null; case: CaseMode | null; corners: CornerMode | null; density: Density | null;
}
export const blank = (): Theme => ({ preset: 'catalog', colors: {}, sans: null, mono: null, case: null, corners: null, density: null });

/** keep only what is valid: a known preset, #rrggbb colours of editable tokens, known fonts and modes */
export function sanitize(t: unknown): Theme | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  const d = blank();
  d.preset = typeof o.preset === 'string' && isPreset(o.preset) ? o.preset : 'catalog';
  const cols = o.colors && typeof o.colors === 'object' ? (o.colors as Record<string, unknown>) : {};
  for (const k of Object.keys(cols)) {
    const key = k.startsWith('--') ? k : '--' + k;
    const v = cols[k];
    if (EDITABLE.includes(key) && HEX.test(String(v))) d.colors[key] = String(v).toLowerCase();
  }
  if (fontOf('sans', o.sans)) d.sans = String(o.sans);
  if (fontOf('mono', o.mono)) d.mono = String(o.mono);
  if (CASES.includes(o.case as CaseMode)) d.case = o.case as CaseMode;
  if (CORNERS.includes(o.corners as CornerMode)) d.corners = o.corners as CornerMode;
  if (DENSITIES.includes(o.density as Density)) d.density = o.density as Density;
  return d;
}

/* ───────── colour maths (exported for the unit tests) ───────── */
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

/* ───────── the contrast guard: a mod's colours that would make text hard to read are not applied ─────────
   (owner decision, 19 November 2026). A mod's theme is a patch over the user's own: each colour that would take a pair that carries
   text under its floor is left out, and the theme's own token stays. The floors are the design system's (5.4: 4.5:1 for text on a
   surface, on a selected row, on a chip, ink on the selected fill, attention text and diff counts), the ratio is WCAG 2.x's, and the
   pairs are the customizer's own `PAIRS` (text only: marks and outlines hold 3:1 and are not what makes text unreadable), plus strong
   text on the surfaces, which the design system sets no floor for and which gets the body floor. Pure: the caller says what the theme
   resolves each token to. */
/** `--current` is the text colour at this share over the frame (tokens.css); a test keeps the two in step */
export const CURRENT_ALPHA = 0.085;
/** the pairs the guard checks: [fg, bg, min]. Specs may be `--current@--bg-1`, the selected row */
export const GUARD_PAIRS: readonly (readonly [fg: string, bg: string, min: number])[] = [
  ...PAIRS.filter(([, , min, , scope]) => min >= 4.5 && scope === undefined).map(([fg, bg, min]) => [fg, bg, min] as const),
  ['--text-strong', '--bg-0', 4.5], ['--text-strong', '--bg-1', 4.5], ['--text-strong', '--bg-2', 4.5], ['--text-strong', '--bg-3', 4.5]
];
/** what a skipped colour is called on the card, in the order the card lists them */
export const GUARD_LABELS: Readonly<Record<string, string>> = {
  '--text': 'text on surface', '--text-strong': 'strong text', '--text-dim': 'dim text', '--text-quiet': 'quiet text', '--text-on-light': 'text on the selected fill',
  '--red-text': 'attention text', '--add': 'added lines', '--del': 'removed lines',
  '--bg-0': 'inset cards', '--bg-1': 'the frame', '--bg-2': 'the ground', '--bg-3': 'raised surfaces', '--bg-4': 'pressed surfaces', '--chip': 'code chips', '--selected': 'the selected fill'
};
const GUARD_ORDER = Object.keys(GUARD_LABELS);
export interface Skipped { token: string; label: string }
export interface Guarded {
  /** the colours that hold: what is shown and what Keep stores */
  applied: Record<string, string>;
  /** the colours left out, in the card's order, with their words */
  skipped: Skipped[];
}
/** "Skipped 2 colours that would make text hard to read: text on surface, quiet text." (null when nothing was skipped) */
export const skippedSentence = (skipped: readonly Skipped[]): string | null =>
  skipped.length ? 'Skipped ' + skipped.length + (skipped.length === 1 ? ' colour' : ' colours') + ' that would make text hard to read: ' + skipped.map((x) => x.label).join(', ') + '.' : null;
const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** the tokens a pair's side is made of, the one blamed first at the front */
const partsOf = (spec: string): readonly string[] => (spec === '--current@--bg-1' ? ['--text', '--bg-1'] : [spec]);
/**
 * Checks a patch of colours over a theme. `base` is what the theme resolves a token to (#rrggbb) without the patch. While a pair that
 * carries text is under its floor, one patched colour it is made of is left out (the text side first: dark text on a dark frame
 * costs the text, not the frame), and the pairs are checked again with it gone, so what is left holds together. Never throws and
 * never reads the page: a token `base` cannot give counts as unknown and its pairs are not checked.
 */
export function guardColors(patch: Readonly<Record<string, string>>, base: (token: string) => string | null): Guarded {
  const kept: Record<string, string> = { ...patch };
  const gone: string[] = [];
  const value = (t: string): string | null => kept[t] ?? base(t);
  const resolve = (spec: string): string | null => {
    if (spec !== '--current@--bg-1') return value(spec);
    const text = value('--text'), frame = value('--bg-1');
    return text && frame ? composite([...rgbOf(text), CURRENT_ALPHA], [...rgbOf(frame), 1]) : null;
  };
  for (;;) {
    let blame: string | null = null;
    for (const [fg, bg, min] of GUARD_PAIRS) {
      const a = resolve(fg), b = resolve(bg);
      if (!a || !b || ratio(a, b) >= min - 0.005) continue;
      blame = [...partsOf(fg), ...partsOf(bg)].find((t) => t in kept) ?? null;
      if (blame) break;
    }
    if (!blame) break;
    delete kept[blame]; gone.push(blame);
  }
  const order = (t: string): number => { const i = GUARD_ORDER.indexOf(t); return i < 0 ? GUARD_ORDER.length : i; };
  return { applied: kept, skipped: gone.sort((a, b) => order(a) - order(b)).map((token) => ({ token, label: GUARD_LABELS[token] ?? token })) };
}

/* ───────── state ───────── */
let theme: Theme = (() => { const s = sanitize(readJSON(KEYS.theme)); return s ?? blank(); })();
let applied: string[] = [];
/** the saved theme, while a preview is showing (null otherwise): a preview is never saved */
let held: Theme | null = null;
const effective = <K extends Overridable>(k: K): Theme[K] | Preset[K] => (theme[k] ?? PRESETS[theme.preset][k]) as Theme[K] | Preset[K];
const effStr = (k: 'sans' | 'mono'): string => String(effective(k));

let probe: HTMLElement | null = null, dockScope: HTMLElement | null = null;
function rgbaOf(token: string, scope?: 'dock'): RGBA {
  if (!probe) {
    probe = document.createElement('i');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  }
  let host: HTMLElement = document.body || root;
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
/** a translucent token laid over a solid one ('--current@--bg-1'), as the eye sees it */
export function compositeOf(spec: string, scope?: 'dock'): string {
  const [top, under] = spec.split('@');
  if (!under) return hexOf(spec, scope);
  return composite(rgbaOf(top ?? '', scope), rgbaOf(under, scope));
}

function save(): void { writeJSON(KEYS.theme, theme as unknown as Record<string, unknown>); }
type Refresh = () => void;
let refreshUI: Refresh | null = null;
export function setThemeRefresh(fn: Refresh | null): void { refreshUI = fn; }

function apply(quiet?: boolean): void {
  root.setAttribute('data-hx-preset', theme.preset);
  root.setAttribute('data-hx-case', String(effective('case')));
  root.setAttribute('data-hx-corners', String(effective('corners')));
  root.setAttribute('data-hx-density', String(effective('density')));
  for (const k of applied) root.style.removeProperty(k);
  applied = [];
  for (const [k, v] of Object.entries(theme.colors)) { root.style.setProperty(k, v); applied.push(k); }
  const sans = fontOf('sans', effStr('sans')), mono = fontOf('mono', effStr('mono'));
  if (theme.sans && sans) { root.style.setProperty('--sans', sans[1]); applied.push('--sans'); }
  if (theme.mono && mono) { root.style.setProperty('--mono', mono[1]); applied.push('--mono'); }
  ensureFont(sans?.[0]); ensureFont(mono?.[0]);
  const light = lum(hexOf('--bg-2')) > 0.4;
  root.style.setProperty('color-scheme', light ? 'light' : 'dark');
  if (light) root.setAttribute('data-hx-theme', 'light'); else root.removeAttribute('data-hx-theme');
  if (!held) save();
  if (!quiet) emit('hx:theme', { preset: theme.preset, scheme: light ? 'light' : 'dark' });
  refreshUI?.();
}

export interface ThemePatch extends Partial<Pick<Theme, Overridable>> { colors?: Record<string, string> }
export interface ContrastRow { label: string; fg: string; bg: string; scope: string; min: number; ratio: number; pass: boolean }

function exportObject() {
  const colors: Record<string, string> = {};
  for (const k of EDITABLE) colors[k] = hexOf(k);
  return { format: 'boopis-theme', version: 1, preset: theme.preset, sans: effective('sans'), mono: effective('mono'), case: effective('case'), corners: effective('corners'), density: effective('density'), colors };
}

export const themeApi = {
  presets: PRESETS as Record<string, Preset>,
  get: (): Theme => JSON.parse(JSON.stringify(held ?? theme)) as Theme,
  /** a preview is showing */
  previewing: (): boolean => held !== null,
  /** Shows a patch of colours over the saved theme without saving it: a reload, or `endPreview(false)`, gives the saved theme
      back at once. Called again, it patches the saved theme again (one preview at a time). Every other change restores first.
      A colour that would make text hard to read (the contrast guard above) is not shown: the theme's own token stays, and the
      answer says which were left out. What is shown is all that Keep stores. */
  preview(patch: { colors?: Record<string, string> }): Guarded {
    const showing = held !== null;
    held ??= JSON.parse(JSON.stringify(theme)) as Theme;
    theme = JSON.parse(JSON.stringify(held)) as Theme;
    if (showing) apply(true);   /* the page shows the last patch: put the saved theme back, so the guard reads what it really resolves to */
    const wanted = patch.colors ? sanitize({ preset: theme.preset, colors: patch.colors })?.colors ?? {} : {};
    const guarded = guardColors(wanted, (t) => { try { return hexOf(t); } catch { return null; } });
    theme.colors = Object.assign({}, theme.colors, guarded.applied);
    apply();
    emit('hx:theme-preview', { previewing: true });
    return guarded;
  },
  /** Keeps a patch of colours as the theme without a preview having shown it (the card was not on screen): the same guard, then saved. */
  keep(colors: Record<string, string>): Guarded {
    themeApi.endPreview(false);
    const wanted = sanitize({ preset: theme.preset, colors })?.colors ?? {};
    const guarded = guardColors(wanted, (t) => { try { return hexOf(t); } catch { return null; } });
    if (Object.keys(guarded.applied).length) themeApi.set({ colors: guarded.applied });
    return guarded;
  },
  /** Ends the preview: `true` keeps the colours it showed (they become the theme and are saved), `false` gives the saved theme back. */
  endPreview(commit: boolean): boolean {
    if (!held) return false;
    if (commit) held = null; else { theme = held; held = null; }
    apply();
    emit('hx:theme-preview', { previewing: false });
    return true;
  },
  scheme: (): 'dark' | 'light' => (root.getAttribute('data-hx-theme') === 'light' ? 'light' : 'dark'),
  set(patch: ThemePatch): void {
    themeApi.endPreview(false);
    if (patch.colors) theme.colors = Object.assign({}, theme.colors, patch.colors);
    for (const k of OVERRIDABLE) {
      if (k in patch) {
        const v = patch[k] as string | null | undefined;
        (theme as unknown as Record<string, unknown>)[k] = v === PRESETS[theme.preset][k] ? null : (v ?? null);
      }
    }
    apply();
  },
  preset(id: string): void { if (!isPreset(id)) return; themeApi.endPreview(false); theme = Object.assign(blank(), { preset: id }); apply(); },
  reset(): void { themeApi.endPreview(false); theme = Object.assign(blank(), { preset: theme.preset }); apply(); },
  exportJSON: (): string => JSON.stringify(exportObject(), null, 2),
  importJSON(text: string): void {
    themeApi.endPreview(false);
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { throw new Error('The text is not valid JSON.'); }
    if (!obj || (obj as { format?: unknown }).format !== 'boopis-theme') throw new Error('This JSON is not a boopis theme (it needs "format": "boopis-theme").');
    const t = sanitize(obj);
    if (!t) throw new Error('This JSON is not a boopis theme (it needs "format": "boopis-theme").');
    // keep only the colours that differ from the preset, so the preset stays meaningful
    theme = Object.assign(blank(), { preset: t.preset }); apply(true);
    const colors: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.colors)) if (v !== hexOf(k)) colors[k] = v;
    theme = Object.assign(t, { colors });
    for (const k of OVERRIDABLE) if (theme[k] === PRESETS[theme.preset][k]) (theme as unknown as Record<string, unknown>)[k] = null;
    apply();
  },
  contrast(): ContrastRow[] {
    return PAIRS.map(([fg, bg, min, label, scope]) => {
      const r = ratio(compositeOf(fg, scope), compositeOf(bg, scope));
      return { label, fg, bg, scope: scope ?? 'app', min, ratio: Math.round(r * 100) / 100, pass: r >= min - 0.005 };
    });
  },
  parseColor
};

/* the customizer panel reads and edits the theme through these (theme-panel.ts) */
export const themeInternals = {
  get theme(): Theme { return theme; },
  apply, effective, fontOf, blank
};

apply(true);
