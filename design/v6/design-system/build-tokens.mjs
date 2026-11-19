#!/usr/bin/env node
/* boopis design system · token build (owner: design-system agent)
   Reads ../tokens.css (the four presets, the shared scale, the corner and density modifiers) and writes
   tokens.json in the W3C Design Tokens format (2025.10: colours as sRGB objects, dimensions and durations as
   value/unit objects). Three tiers: primitive (raw values, named by family and OKLCH lightness), semantic (the
   roles the app uses, one CSS custom property each, with a value per preset as a mode) and component (sizes
   and assignments that components read). Run: node build-tokens.mjs [--report]
   --report prints the contrast table for every preset as Markdown (the source of DESIGN-SYSTEM.md's table). */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'tokens.css'), 'utf8');
const PRESETS = ['catalog', 'graphite', 'bone', 'typewriter'];
const PRESET_META = {
  catalog: { name: 'Card catalog', note: 'Warm dark, the default', scheme: 'dark', corners: 'default', case: 'sentence' },
  graphite: { name: 'Graphite', note: 'Neutral grey, close to the Figma', scheme: 'dark', corners: 'default', case: 'sentence' },
  bone: { name: 'Bone', note: 'Light', scheme: 'light', corners: 'default', case: 'sentence' },
  typewriter: { name: 'Typewriter', note: 'Mono and lowercase', scheme: 'dark', corners: 'round', case: 'lower' }
};

/* ───────── parse ───────── */
function block(selectorRe) {
  const m = css.match(selectorRe);
  if (!m) throw new Error('block not found: ' + selectorRe);
  const start = css.indexOf('{', m.index) + 1;
  let depth = 1, i = start;
  while (depth && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
  const body = css.slice(start, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const decl of body.split(';')) {
    const k = decl.indexOf(':');
    if (k < 0) continue;
    const name = decl.slice(0, k).trim();
    if (!name.startsWith('--') && name !== 'color-scheme') continue;
    out[name] = decl.slice(k + 1).trim().replace(/\s+/g, ' ');
  }
  return out;
}
const preset = {
  catalog: block(/:root, \[data-hx-preset="catalog"\]\s*\{/),
  graphite: block(/\[data-hx-preset="graphite"\]\s*\{/),
  bone: block(/\[data-hx-preset="bone"\]\s*\{/),
  typewriter: block(/\[data-hx-preset="typewriter"\]\s*\{/)
};
const shared = block(/\/\* ───────────── everything else[^\n]*\n:root\s*\{/);
const corners = { default: {}, sharp: block(/:root\[data-hx-corners="sharp"\]\s*\{/), round: block(/:root\[data-hx-corners="round"\]\s*\{/) };
const density = { regular: {}, compact: block(/:root\[data-hx-density="compact"\]\s*\{/), comfortable: block(/:root\[data-hx-density="comfortable"\]\s*\{/) };

/* ───────── colour maths ───────── */
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function parseColor(v) {
  v = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return { rgb: hexRGB(v), a: 1 };
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
  throw new Error('colour? ' + v);
}
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (top, under) => top.rgb.map((c, i) => c * top.a + under[i] * (1 - top.a));
const mix = (a, b, p) => a.map((c, i) => c * p + b[i] * (1 - p));
function oklch(rgb) {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B); let H = Math.atan2(B, A) * 180 / Math.PI; if (H < 0) H += 360;
  return { L, C, H };
}

/* ───────── resolve every colour role per preset ───────── */
const SOLID = ['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-4', '--chip', '--text', '--text-strong', '--text-dim', '--text-quiet',
  '--text-faint', '--icon', '--icon-quiet', '--icon-off', '--selected', '--text-on-light', '--brass', '--red', '--red-text', '--ok', '--warn', '--add', '--del'];
const DERIVED = { /* name: [source, percent] — color-mix(in srgb, var(source) p%, transparent) */
  '--hair': ['--text', 0.075], '--line': ['--text', 0.15], '--line-strong': ['--text', 0.26], '--hover': ['--text', 0.045],
  '--current': ['--text', 0.085], '--brass-soft': ['--brass', 0.14], '--red-soft': ['--red', 0.14]
};
const R = {};
for (const p of PRESETS) {
  const t = {};
  for (const k of SOLID) t[k] = parseColor(preset[p][k]);
  t['--scrim'] = parseColor(preset[p]['--scrim']);
  for (const [k, [src, pc]] of Object.entries(DERIVED)) t[k] = { rgb: t[src].rgb, a: pc };
  t['--line-field'] = { rgb: t['--text'].rgb, a: PRESET_META[p].scheme === 'light' ? 0.54 : 0.42 };   /* promoted to tokens.css */
  t['--mark-off'] = { rgb: mix(t['--text-quiet'].rgb, t['--text-faint'].rgb, 0.55), a: 1 };            /* library token (components.css) */
  t['--dock-bg'] = parseColor(shared['--dock-bg']);
  /* the dock ground: one ink per scheme (dark presets ink with --text, light ones with their ground --bg-2) */
  const light = PRESET_META[p].scheme === 'light';
  const black = t['--dock-bg'].rgb;
  const ink = light ? t['--bg-2'].rgb : t['--text'].rgb;
  const inkStrong = light ? t['--bg-3'].rgb : t['--text-strong'].rgb;
  t.dock = {
    '--text': { rgb: ink, a: 1 }, '--text-strong': { rgb: inkStrong, a: 1 },
    '--text-dim': { rgb: mix(ink, black, 0.68), a: 1 }, '--text-quiet': { rgb: mix(ink, black, 0.6), a: 1 },
    '--text-faint': { rgb: mix(ink, black, 0.42), a: 1 }, '--mark-off': { rgb: mix(ink, black, 0.42), a: 1 }, '--icon': { rgb: mix(ink, black, 0.75), a: 1 },
    '--bg-0': { rgb: black, a: 1 }, '--bg-3': { rgb: mix(ink, black, 0.13), a: 1 }, '--bg-4': { rgb: mix(ink, black, 0.19), a: 1 },
    '--chip': { rgb: mix(ink, black, 0.12), a: 1 }, '--surface': { rgb: mix(ink, black, 0.07), a: 1 },
    '--selected': { rgb: ink, a: 1 }, '--text-on-light': { rgb: black, a: 1 },
    '--hair': { rgb: ink, a: 0.08 }, '--line': { rgb: ink, a: 0.17 }, '--line-strong': { rgb: ink, a: 0.3 },
    '--hover': { rgb: ink, a: 0.06 }, '--current': { rgb: ink, a: 0.1 },
    '--red-text': { rgb: mix(t['--red'].rgb, ink, 0.8), a: 1 }, '--brass': { rgb: mix(t['--brass'].rgb, ink, light ? 0.55 : 0.78), a: 1 }
  };
  R[p] = t;
}
const solid = (p, k, scope) => { const t = scope === 'dock' ? R[p].dock : R[p]; const c = t[k] || R[p][k]; if (c.a === 1) return c.rgb; return over(c, solid(p, '--bg-1')); };
function rgbOf(p, spec, scope) { /* '--current@--bg-1' composites a translucent token over a solid one */
  const [top, under] = spec.split('@');
  const t = scope === 'dock' ? Object.assign({}, R[p], R[p].dock) : R[p];
  const c = t[top];
  if (!under) return c.a === 1 ? c.rgb : over(c, t['--bg-2'].rgb);
  const u = under === '#000' ? [0, 0, 0] : rgbOf(p, under, scope);
  return c.a === 1 ? c.rgb : over(c, u);
}

/* ───────── the pairs that must hold (theme.js PAIRS, plus the ones the components add) ───────── */
const PAIRS = [
  ['--text', '--bg-1', 4.5, 'Text on the frame'], ['--text', '--bg-2', 4.5, 'Text on the ground'], ['--text', '--bg-3', 4.5, 'Text on raised surfaces'],
  ['--text', '--bg-0', 4.5, 'Text on inset cards'],
  ['--text-dim', '--bg-1', 4.5, 'Secondary text on the frame'], ['--text-dim', '--bg-2', 4.5, 'Secondary text on the ground'], ['--text-dim', '--bg-3', 4.5, 'Secondary text on raised surfaces'],
  ['--text-dim', '--bg-0', 4.5, 'Secondary text on inset cards'],
  ['--text-quiet', '--bg-1', 4.5, 'Meta text on the frame'], ['--text-quiet', '--bg-2', 4.5, 'Meta text on the ground'], ['--text-quiet', '--bg-3', 4.5, 'Meta text on raised surfaces'],
  ['--text-quiet', '--bg-0', 4.5, 'Meta text on inset cards (card meta, call numbers in wells)'],
  ['--text-quiet', '--current@--bg-1', 4.5, 'Meta text on a selected row'], ['--text', '--current@--bg-1', 4.5, 'Text on a selected row'],
  ['--text', '--chip', 4.5, 'Code in a chip'], ['--text-quiet', '--bg-4', 4.5, 'Kbd label on a pressed fill (tooltip kbd)'],
  ['--text-on-light', '--selected', 4.5, 'Text on the selected fill (primary button, tab thumb)'],
  ['--red-text', '--bg-2', 4.5, 'Attention text on the ground (stamp)'], ['--red-text', '--bg-0', 4.5, 'Attention text on inset cards'],
  ['--red-text', '--bg-1', 4.5, 'Attention text on the frame (list state word)'], ['--red-text', '--current@--bg-1', 4.5, 'Attention text on a selected row'],
  ['--brass', '--bg-1', 3, 'Accent on the frame (focus ring, current marker)'], ['--brass', '--bg-2', 3, 'Accent on the ground'],
  ['--brass', '--bg-0', 3, 'Accent on inset cards'], ['--brass', '--bg-3', 3, 'Accent on raised surfaces (composer chip icon, caret)'],
  ['--icon', '--bg-1', 3, 'Icons on the frame'], ['--icon', '--bg-3', 3, 'Icons on raised surfaces'], ['--icon-quiet', '--bg-1', 3, 'Window controls on the frame'],
  ['--red', '--bg-2', 3, 'Attention dots and stamp outline on the ground'], ['--red', '--bg-0', 3, 'Attention outline on inset cards'], ['--red', '--bg-1', 3, 'Attention dot on the frame'],
  ['--ok', '--bg-0', 3, 'Pass mark in output'], ['--add', '--bg-1', 4.5, 'Added-line count on the frame'], ['--del', '--bg-1', 4.5, 'Removed-line count on the frame'],
  ['--line@--bg-0', '--bg-1', 3, 'Field outline as found (--line) against the frame'],
  ['--line-field@--bg-0', '--bg-1', 3, 'Field outline, library (--line-field) against the frame'], ['--line-field@--bg-0', '--bg-0', 3, 'Field outline, library (--line-field) against the field'],
  ['--text-dim', '--bg-4', 4.5, 'Kbd label in a tooltip, library (--text-dim on --bg-4)'],
  ['--text-faint', '--bg-2', 3, 'Inactive mark as found (--text-faint on the ground)'],
  ['--mark-off', '--bg-0', 3, 'Inactive mark, library (--mark-off: page dot, ladder ring) on inset cards'], ['--mark-off', '--bg-1', 3, 'Inactive mark, library, on the frame'],
  ['--mark-off', '--bg-2', 3, 'Inactive mark, library, on the ground'], ['--mark-off', '--bg-3', 3, 'Inactive mark, library, on raised surfaces']
];
const DOCK_PAIRS = [
  ['--text', '#000', 4.5, 'Dock text on #000'], ['--text-dim', '#000', 4.5, 'Dock secondary text on #000'], ['--text-quiet', '#000', 4.5, 'Dock meta on #000'],
  ['--text-quiet', '--surface@#000', 4.5, 'Meta on a card set into the dock'], ['--red-text', '#000', 4.5, 'Dock attention text'],
  ['--brass', '#000', 3, 'Dock accent (page indicator, focus)'], ['--icon', '#000', 3, 'Dock icons'],
  ['--text-on-light', '--selected', 4.5, 'Primary button in the dock'],
  ['--mark-off', '#000', 3, 'Dock inactive mark (page dot, ladder ring) on #000'], ['--mark-off', '--surface@#000', 3, 'Dock inactive mark on a card set into the dock']
];
function check(p) {
  const rows = [];
  for (const [fg, bg, min, label] of PAIRS) {
    const f = fg.includes('@') ? rgbOf(p, fg) : rgbOf(p, fg);
    const b = rgbOf(p, bg);
    rows.push({ fg, bg, min, label, r: ratio(f, b) });
  }
  for (const [fg, bg, min, label] of DOCK_PAIRS) {
    const f = rgbOf(p, fg, 'dock');
    const b = bg === '#000' ? [0, 0, 0] : rgbOf(p, bg, 'dock');
    rows.push({ fg: 'dock ' + fg, bg, min, label, r: ratio(f, b) });
  }
  return rows;
}

/* ───────── primitives: every distinct solid value, named by family and OKLCH lightness ───────── */
const prim = new Map(); /* hex -> path */
const primTree = {};
function family(rgb) {
  const { C, H } = oklch(rgb);
  const spread = Math.max(...rgb) - Math.min(...rgb);
  if (spread <= 1) return 'grey';                 /* R = G = B: Graphite and Typewriter */
  if (C < 0.03) return 'warm';                    /* every Card catalog and Bone neutral leans warm */
  if (H >= 100 && H < 180) return 'green';
  if (H >= 60 && H < 100) return C > 0.11 ? 'amber' : 'brass';
  if (H >= 180 && H < 300) return 'blue';          /* the Graphite steel and Typewriter carbon-paper accents */
  return 'red';
}
function primitiveFor(rgb) {
  const hex = toHex(rgb);
  if (prim.has(hex)) return prim.get(hex);
  const fam = hex === '#000000' ? 'black' : family(rgb);
  const { L } = oklch(rgb);
  let step = fam === 'black' ? '0' : String(Math.round(L * 100));
  primTree[fam] = primTree[fam] || {};
  /* a collision takes the next decimal, written with a hyphen: DTCG names may not contain a dot (warm/24-5 is L 24.5) */
  if (primTree[fam][step]) step = (L * 100).toFixed(1).replace('.', '-');
  if (primTree[fam][step]) step = (L * 100).toFixed(2).replace('.', '-');
  primTree[fam][step] = { $type: 'color', $value: colorValue(rgb, 1) };
  const path = 'primitive.color.' + fam + '.' + step;
  prim.set(hex, path);
  return path;
}
function colorValue(rgb, a) {
  const o = { colorSpace: 'srgb', components: rgb.map((v) => +(v / 255).toFixed(4)), hex: toHex(rgb) };
  if (a !== 1) o.alpha = +a.toFixed(3);
  return o;
}
const ref = (path) => '{' + path + '}';

/* ───────── semantic colour roles ───────── */
const ROLES = [
  ['surface.inset', '--bg-0', 'Drawer: fields, approval and ship cards, the command field, wells. Set into whatever it sits on.'],
  ['surface.frame', '--bg-1', 'Cabinet: title bar, sidebars, the open right panel, menus, palette, dialogs.'],
  ['surface.ground', '--bg-2', 'Reading room: the ground the work sits on.'],
  ['surface.raised', '--bg-3', 'Card stock: what the user wrote or is writing (request cards, the composer), tooltips, toasts.'],
  ['surface.pressed', '--bg-4', 'Pressed fills, the kbd inside a tooltip, scrollbar thumbs.'],
  ['surface.chip', '--chip', 'Inline code chips.'],
  ['text.default', '--text', 'Body text and labels. Lines and hover fills are derived from it.'],
  ['text.strong', '--text-strong', 'Titles, the current row, a hovered icon.'],
  ['text.dim', '--text-dim', 'Secondary text: roles, quotes, descriptions.'],
  ['text.quiet', '--text-quiet', 'Meta that must stay readable: times, costs, call numbers, group headings.'],
  ['text.faint', '--text-faint', 'Decoration and disabled only. Never carries meaning on its own.'],
  ['icon.default', '--icon', 'Icons in icon buttons and rows.'],
  ['icon.quiet', '--icon-quiet', 'Window controls.'],
  ['icon.off', '--icon-off', 'Disabled icons.'],
  ['selected.fill', '--selected', 'Bone: the selected segment, primary buttons, the send button, a checked switch.'],
  ['selected.on', '--text-on-light', 'Ink on the selected fill.'],
  ['accent.default', '--brass', 'You are here: focus ring, current marker, active rung, checked items, caret.'],
  ['attention.fill', '--red', 'You owe something: dots, stamp outlines, the blank underline.'],
  ['attention.text', '--red-text', 'Attention as text: "waiting for you", "needs you", "failed".'],
  ['status.ok', '--ok', 'A passed gate in output.'],
  ['status.warn', '--warn', 'A contrast warning in the customizer. Never attention.'],
  ['diff.add', '--add', 'Added lines and counts.'],
  ['diff.del', '--del', 'Removed lines and counts.']
];
const DERIVED_ROLES = [
  ['line.hair', '--hair', 'Dividers inside a surface.', '--text', 7.5],
  ['line.default', '--line', 'Outlines of controls (secondary button, field).', '--text', 15],
  ['line.strong', '--line-strong', 'Hovered outlines, empty radio rings, the switch track.', '--text', 26],
  ['fill.hover', '--hover', 'Hover fill on rows, icon buttons, chips.', '--text', 4.5],
  ['fill.current', '--current', 'The selected row, the active dialog tab, a focused menu item.', '--text', 8.5],
  ['accent.soft', '--brass-soft', 'Text selection; the flash on a panel section opened from elsewhere.', '--brass', 14],
  ['attention.soft', '--red-soft', 'Hover fill behind a stamp.', '--red', 14]
];
function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] = o[p] || {};
  o[parts[parts.length - 1]] = val;
}
const semantic = { color: {} };
for (const [path, cssVar, desc] of ROLES) {
  const modes = {};
  for (const p of PRESETS) modes[p] = ref(primitiveFor(R[p][cssVar].rgb));
  const tok = { $type: 'color', $value: modes.catalog, $description: desc, $extensions: { boopis: { css: cssVar, modes } } };
  setPath(semantic.color, path, tok);
}
for (const [path, cssVar, desc, src, pc] of DERIVED_ROLES) {
  const modes = {};
  for (const p of PRESETS) modes[p] = colorValue(R[p][src].rgb, pc / 100);
  setPath(semantic.color, path, {
    $type: 'color', $value: modes.catalog, $description: desc,
    $extensions: { boopis: { css: cssVar, formula: `color-mix(in srgb, var(${src}) ${pc}%, transparent)`, modes } }
  });
}
{
  const modes = {}; for (const p of PRESETS) modes[p] = colorValue(R[p]['--text'].rgb, R[p]['--line-field'].a);
  setPath(semantic.color, 'line.field', { $type: 'color', $value: modes.catalog, $description: 'Text-field outline: 3:1 against the field and the frame.',
    $extensions: { boopis: { css: '--line-field', formula: 'color-mix(in srgb, var(--text) 42%, transparent); 54% when data-hx-theme="light"', modes } } });
}
{
  const modes = {}; for (const p of PRESETS) modes[p] = ref(primitiveFor(R[p]['--mark-off'].rgb));
  setPath(semantic.color, 'mark.off', { $type: 'color', $value: modes.catalog,
    $description: 'An inactive non-text mark: a page dot, a ladder station still to come. 3:1 on every surface (WCAG 1.4.11) and well under the active marks (--text-dim, --brass). Library token (components.css); promote to tokens.css.',
    $extensions: { boopis: { css: '--mark-off', formula: 'color-mix(in srgb, var(--text-quiet) 55%, var(--text-faint)); --text-faint (ink 42%) on the dock ground', library: true, modes } } });
}
/* the Bone contrast fixes (DESIGN-SYSTEM.md, Findings F4) are in tokens.css now, so the modes above carry them */
{
  const modes = {}; for (const p of PRESETS) modes[p] = colorValue(R[p]['--scrim'].rgb, R[p]['--scrim'].a);
  setPath(semantic.color, 'scrim', { $type: 'color', $value: modes.catalog, $description: 'Behind the palette, dialogs and overlay drawers.', $extensions: { boopis: { css: '--scrim', modes } } });
}
setPath(semantic.color, 'surface.dock', {
  $type: 'color', $value: ref(primitiveFor([0, 0, 0])),
  $description: 'The dock slab. Pitch black in every theme; not themeable, never offered in the customizer.',
  $extensions: { boopis: { css: '--dock-bg', fixed: true } }
});
/* the dock ground: a scope, not a preset. Inside [data-ground="dock"] the semantic roles are re-derived from #000. */
const groundDock = {};
for (const k of ['--text', '--text-strong', '--text-dim', '--text-quiet', '--text-faint', '--mark-off', '--icon', '--bg-3', '--bg-4', '--chip', '--surface', '--selected', '--text-on-light', '--hair', '--line', '--line-strong', '--hover', '--current', '--red-text', '--brass']) {
  const modes = {}; for (const p of PRESETS) { const c = R[p].dock[k]; modes[p] = colorValue(c.rgb, c.a); }
  groundDock[k.replace(/^--/, '')] = { $type: 'color', $value: modes.catalog, $extensions: { boopis: { css: k, scope: '[data-ground="dock"]', modes } } };
}

/* shadows */
function shadowOf(v) {
  return v.split(/,(?![^(]*\))/).map((s) => {
    const m = s.trim().match(/^(-?[\d.]+)(?:px)? (-?[\d.]+)(?:px)? (-?[\d.]+)(?:px)?(?: (-?[\d.]+)(?:px)?)? (rgba\([^)]+\))$/);
    const c = parseColor(m[5]);
    return { color: colorValue(c.rgb, c.a), offsetX: dim(+m[1]), offsetY: dim(+m[2]), blur: dim(+m[3]), spread: dim(m[4] ? +m[4] : 0) };
  });
}
const dim = (v, unit = 'px') => ({ value: v, unit });
semantic.shadow = {};
for (const [name, cssVar, desc] of [['pop', '--shadow-pop', 'Things that float over other things: menus, palette, dialogs, popovers, toasts.'], ['side', '--shadow-side', 'A left drawer over the ground (overlay mode).'], ['side-r', '--shadow-side-r', 'The right panel in overlay mode.'], ['tip', '--shadow-tip', 'Tooltips.']]) {
  const modes = {}; for (const p of PRESETS) modes[p] = shadowOf(preset[p][cssVar]);
  semantic.shadow[name] = { $type: 'shadow', $value: modes.catalog, $description: desc, $extensions: { boopis: { css: cssVar, modes } } };
}
/* fonts */
const fam = (v) => v.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
semantic.font = {
  sans: { $type: 'fontFamily', $value: fam(preset.catalog['--sans']), $description: 'Interface and prose.', $extensions: { boopis: { css: '--sans', modes: Object.fromEntries(PRESETS.map((p) => [p, fam(preset[p]['--sans'])])) } } },
  mono: { $type: 'fontFamily', $value: fam(preset.catalog['--mono']), $description: 'Code, paths, numbers, times, costs, model names, call numbers, kbd.', $extensions: { boopis: { css: '--mono', modes: Object.fromEntries(PRESETS.map((p) => [p, fam(preset[p]['--mono'])])) } } }
};

/* ───────── scale primitives (shared by every preset) ───────── */
const px = (v) => parseFloat(v);
const scale = {
  size: {}, space: {}, radius: {}, control: {}, layout: {}, z: {}, duration: {}, easing: {}, weight: {}, leading: {}, tracking: {}
};
const SIZE_DESC = { '--fs-2xs': 'Mono meta: times, costs, call numbers, kbd, stamps.', '--fs-xs': 'Labels, group headings, tooltips, secondary lines, chips.', '--fs-s': 'Interface default: rows, buttons, menus, tabs.', '--fs-m': 'Reading: conversation prose, the composer, card titles.', '--fs-l': 'View and dialog titles, a bot name in its header.', '--fs-xl': 'The one display size: a bot name being made.' };
for (const k of ['--fs-2xs', '--fs-xs', '--fs-s', '--fs-m', '--fs-l', '--fs-xl']) scale.size[k.slice(5)] = { $type: 'dimension', $value: dim(px(shared[k])), $description: SIZE_DESC[k], $extensions: { boopis: { css: k } } };
for (let i = 1; i <= 7; i++) scale.space[i] = { $type: 'dimension', $value: dim(px(shared['--sp-' + i])), $extensions: { boopis: { css: '--sp-' + i } } };
const R_DESC = { xs: 'kbd, inline code, stamps.', s: 'Buttons, rows, fields, wells, the segmented track, tooltips.', m: 'Cards, the composer, menus, popovers, toasts, request cards.', l: 'Sheets, dialogs, the palette, the dock, where the ground meets the frame.', pill: 'Chips (a capsule), dots, the switch, anything inside a pill.' };
/* the corner scale (owner decisions of 18 November 2026, revised: Apple continuous corners in every engine). One scale
   for every engine, drawn by HX.ui.squircle. The library's lines (components.css) win while they exist: default,
   sharp, round; else tokens.css's. */
const lib = readFileSync(join(here, '..', 'components', 'components.css'), 'utf8');
const SCALE_RE = /--r-xs: (\d+)px; --r-s: (\d+)px; --r-m: (\d+)px; --r-l: (\d+)px; --r-floor: (\d+)px/g;
const toScale = (m) => ({ xs: +m[1], s: +m[2], m: +m[3], l: +m[4], floor: +m[5] });
const LL = [...lib.matchAll(SCALE_RE)].map(toScale), TL = [...css.matchAll(SCALE_RE)].map(toScale);
const SC = LL.length >= 3 ? { default: LL[0], sharp: LL[1], round: LL[2], from: 'components.css (library, until tokens.css takes it)' }
  : { default: { xs: px(shared['--r-xs']), s: px(shared['--r-s']), m: px(shared['--r-m']), l: px(shared['--r-l']), floor: px(shared['--r-floor']) }, sharp: TL[0], round: TL[1], from: 'tokens.css' };
const smoothing = parseFloat((lib.match(/--corner-smoothing:\s*([\d.]+)/) || css.match(/--corner-smoothing:\s*([\d.]+)/) || [0, '0.6'])[1]);
for (const k of ['xs', 's', 'm', 'l']) {
  const modes = { sharp: dim(SC.sharp[k]), default: dim(SC.default[k]), round: dim(SC.round[k]) };
  scale.radius[k] = { $type: 'dimension', $value: modes.default, $description: R_DESC[k],
    $extensions: { boopis: { css: '--r-' + k, modes, cornerSmoothing: smoothing, source: SC.from, v6: { sharp: dim(px(corners.sharp['--r-' + k] || 0)), default: dim(px(shared['--r-' + k])), round: dim(px(corners.round['--r-' + k] || 0)) } } } };
}
scale.radius.floor = { $type: 'dimension', $value: dim(SC.default.floor), $description: 'The smallest inner radius of a nested corner: inner = max(floor, outer − gap); under it the padding gives way.',
  $extensions: { boopis: { css: '--r-floor', modes: { sharp: dim(SC.sharp.floor), default: dim(SC.default.floor), round: dim(SC.round.floor) } } } };
scale.corner = { smoothing: { $type: 'number', $value: smoothing, $description: "Figma corner smoothing of every corner (0.6, as iOS); drawn as a path by HX.ui.squircle in every engine.",
  $extensions: { boopis: { css: '--corner-smoothing', algorithm: 'figma-squircle (MIT, Tien Pham), after Daniel Furse, Desperately seeking squircles', nesting: 'A container declares --r-outer and --pad; what sits in its corners takes --r-in = max(--r-floor, --r-outer − --pad).' } } } };
scale.radius.pill = { $type: 'dimension', $value: dim(999), $description: R_DESC.pill, $extensions: { boopis: { css: '--r-pill' } } };
const CTL = { '--row-h': ['row', 'One-line row: list rows, menu items, options.'], '--row-h-2': ['row-2', 'Two-line row: bots list, roster.'], '--ctl': ['control', 'Buttons, segmented control, fields.'], '--ctl-s': ['control-s', 'Icon buttons, small buttons, the send button.'] };
for (const [k, [name, desc]] of Object.entries(CTL)) {
  scale.control[name] = { $type: 'dimension', $value: dim(px(shared[k])), $description: desc, $extensions: { boopis: { css: k, modes: { compact: dim(px(density.compact[k])), regular: dim(px(shared[k])), comfortable: dim(px(density.comfortable[k])) } } } };
}
for (const [k, desc] of [['--chrome-h', 'Title bar height.'], ['--sb-rail-w', 'Left sidebar as a rail.'], ['--right-rail-w', 'Right panel closed: the strip that holds the context measure.'], ['--col-w', 'Conversation column, margin included.'], ['--margin-w', 'The call-number margin.'], ['--measure', 'Prose width (col-w minus margin-w), about 80 characters.'], ['--composer-w', 'Composer width (spans margin and measure).'], ['--dock-rest-h', 'The dock at rest.'], ['--composer-gap', 'Between the composer and the dock (or the window edge).'], ['--gutter', 'Minimum side gutter.']]) {
  scale.layout[k.slice(2)] = { $type: 'dimension', $value: dim(px(shared[k])), $description: desc, $extensions: { boopis: { css: k } } };
}
scale.layout['sb-w'] = { $type: 'dimension', $value: dim(256), $description: 'Open left sidebar: clamp(256px, 15vw, 288px).', $extensions: { boopis: { css: '--sb-w', cssValue: shared['--sb-w'] } } };
scale.layout['right-w'] = { $type: 'dimension', $value: dim(300), $description: 'Open right panel and the bot settings sheet: clamp(300px, 18vw, 340px).', $extensions: { boopis: { css: '--right-w', cssValue: shared['--right-w'] } } };
for (const k of ['base', 'right', 'sidebar', 'dock', 'scrim', 'overlay', 'chrome', 'menu', 'palette', 'toast', 'tooltip']) scale.z[k] = { $type: 'number', $value: +shared['--z-' + k], $extensions: { boopis: { css: '--z-' + k } } };
scale.z.local = { $type: 'number', $value: 3, $description: 'The highest literal z-index allowed inside a component, and only under isolation: isolate (R-elev-5). Modal dialogs use the top layer (showModal), above every value here.' };
/* icons: six sizes and two gaps (DESIGN-SYSTEM.md §10, R-icon-3, R-icon-5) */
scale.icon = {};
for (const [k, desc] of [['2xs', 'Chevrons of disclosures and group heads.'], ['xs', 'Section chevrons, glyphs in mono chips, schedule marks.'], ['s', 'The command field, file chips, task and inline marks, model marks in running text.'], ['m', 'Chips and menu glyphs.'], ['l', 'Buttons, rows, the send button, origin slots, the palette.'], ['xl', 'Icon buttons.']]) {
  scale.icon[k] = { $type: 'dimension', $value: dim(px(shared['--ic-' + k])), $description: desc, $extensions: { boopis: { css: '--ic-' + k } } };
}
scale.icon.gap = { $type: 'dimension', $value: dim(px(shared['--ic-gap'])), $description: 'Icon to label: buttons, menu items, rows.', $extensions: { boopis: { css: '--ic-gap' } } };
scale.icon['gap-tight'] = { $type: 'dimension', $value: dim(px(shared['--ic-gap-tight'])), $description: 'Icon to label in capsules and controls of 26px and under.', $extensions: { boopis: { css: '--ic-gap-tight' } } };
/* nested corners per container (R-corner-3, R-corner-5): the container's inset and the radius of what sits in its corners */
scale.nest = {};
for (const [k, outer, padVar, desc] of [['dialog', 'l', '--pad-dialog', 'Dialogs and sheets: the close button and the head\'s tabs.'], ['palette', 'l', '--pad-palette', 'The palette\'s rows.'], ['dock', 'l', '--pad-dock', 'A card or row at the top of the dock slab.'], ['menu', 'm', '--pad-menu', 'Menu items.'], ['card', 'm', '--pad-card', 'A well, a footer button, a stamp in a card.'], ['composer', 'm', '--composer-pad', 'Attach, chips, mic and send in the composer.'], ['toast', 'm', '--pad-toast', 'A toast\'s action.'], ['field', 's', '--pad-tip', 'Key chips in a tooltip or at a field\'s end.'], ['seg', 's', '--pad-seg', 'The segmented thumb and options.']]) {
  const pad = px(shared[padVar]);
  const modes = Object.fromEntries(['sharp', 'default', 'round'].map((m) => [m, dim(Math.max(SC[m].floor, SC[m][outer] - pad))]));
  scale.nest[k] = { $type: 'dimension', $value: modes.default, $description: desc,
    $extensions: { boopis: { css: '--r-in-' + k, pad: { css: padVar, value: dim(pad) }, outer: '--r-' + outer, formula: 'max(var(--r-floor), calc(var(--r-' + outer + ') - var(' + padVar + ')))', modes } } };
}
/* floating surfaces, focus, targets, scrollbars */
scale.float = { gap: { $type: 'dimension', $value: dim(px(shared['--float-gap'])), $description: 'A menu, popover or tooltip from its anchor.', $extensions: { boopis: { css: '--float-gap' } } },
  margin: { $type: 'dimension', $value: dim(px(shared['--float-margin'])), $description: 'The least distance from a floating surface to the window edge.', $extensions: { boopis: { css: '--float-margin' } } } };
scale.focus = { width: { $type: 'dimension', $value: dim(px(shared['--focus-w'])), $extensions: { boopis: { css: '--focus-w' } } }, offset: { $type: 'dimension', $value: dim(px(shared['--focus-offset'])), $description: 'Outside the element; -2px (inside) in tracks and floating surfaces.', $extensions: { boopis: { css: '--focus-offset' } } } };
scale.target = { min: { $type: 'dimension', $value: dim(px(shared['--hit-min'])), $description: 'The smallest pointer target (WCAG 2.5.8).', $extensions: { boopis: { css: '--hit-min' } } } };
scale.opacity = { disabled: { $type: 'number', $value: +shared['--disabled-alpha'], $description: 'Proposed (R-state-6): a disabled control drawn in fills (send, switch, field).', $extensions: { boopis: { css: '--disabled-alpha', proposed: true } } } };
scale.scroll = {};
for (const [k, v, desc] of [['size', '--scroll-size', 'The bar\'s box, both axes; the track is transparent.'], ['thumb', '--scroll-thumb', 'The thumb at rest, a capsule centred in the bar.'], ['thumb-active', '--scroll-thumb-active', 'The thumb while hovered or dragged.'], ['thumb-min', '--scroll-thumb-min', 'The shortest thumb.']]) scale.scroll[k] = { $type: 'dimension', $value: dim(px(shared[v])), $description: desc, $extensions: { boopis: { css: v } } };
const DUR = { press: ['--dur-press', 'Press feedback.'], 1: ['--dur-1', 'Hover in, colour changes.'], 2: ['--dur-2', 'Menus, fades, popovers (with a 6px drop).'], 3: ['--dur-3', 'Layout travel, sheets, card height changes.'] };
for (const [k, [v, desc]] of Object.entries(DUR)) scale.duration[k] = { $type: 'duration', $value: dim(px(shared[v]), 'ms'), $description: desc, $extensions: { boopis: { css: v, reducedMotion: k === 'press' ? undefined : dim(1, 'ms') } } };
scale.duration.indicator = { $type: 'duration', $value: dim(240, 'ms'), $description: 'A segmented thumb or page indicator travelling.', $extensions: { boopis: { css: '--dur-slide', reducedMotion: dim(1, 'ms') } } };
scale.duration.out = { $type: 'duration', $value: dim(120, 'ms'), $description: 'Hover out, tooltips, exits.', $extensions: { boopis: { css: '--dur-out', reducedMotion: dim(1, 'ms') } } };
scale.duration.breathe = { $type: 'duration', $value: dim(1800, 'ms'), $description: 'The one loop: a running dot breathes (opacity .35 to 1, alternate). Stopped under reduced motion.', $extensions: { boopis: { css: '--dur-breathe' } } };
scale.duration.hold = { $type: 'duration', $value: dim(1000, 'ms'), $description: 'Hold to approve. One value everywhere (owner decision; the dock used 650, bots 1100).', $extensions: { boopis: { css: '--dur-hold' } } };
const bez = (v) => v.match(/[-\d.]+/g).map(Number);
scale.easing.ease = { $type: 'cubicBezier', $value: bez(shared['--ease']), $description: 'Every UI step: hover, colour, fade, menu.', $extensions: { boopis: { css: '--ease' } } };
scale.easing.settle = { $type: 'cubicBezier', $value: bez(shared['--spring']), $description: 'Layout travel and anything settling into place. Named --spring in CSS; it never overshoots.', $extensions: { boopis: { css: '--spring' } } };
scale.easing.travel = { $type: 'cubicBezier', $value: bez(shared['--ease-io']), $description: 'In-out, only for the breathing dot and symmetric travel.', $extensions: { boopis: { css: '--ease-io' } } };
scale.weight = { regular: { $type: 'fontWeight', $value: 400 }, medium: { $type: 'fontWeight', $value: 500, $description: 'Labels, buttons, current tab.' }, semibold: { $type: 'fontWeight', $value: 600, $description: 'Titles only.' } };
scale.leading = {
  reading: { $type: 'number', $value: +shared['--lh'], $extensions: { boopis: { css: '--lh' } } },
  ui: { $type: 'number', $value: +shared['--lh-ui'], $extensions: { boopis: { css: '--lh-ui' } } },
  tight: { $type: 'number', $value: +shared['--lh-tight'], $extensions: { boopis: { css: '--lh-tight' } } },
  meta: { $type: 'number', $value: +shared['--lh-meta'], $description: 'Mono meta in the call-number margin.', $extensions: { boopis: { css: '--lh-meta' } } },
  small: { $type: 'number', $value: +shared['--lh-small'], $description: 'Hints, descriptions, notes.', $extensions: { boopis: { css: '--lh-small' } } }
};
scale.tracking = { sans: { $type: 'dimension', $value: { value: 0, unit: 'rem' }, $extensions: { boopis: { css: '--track' } } }, mono: { $type: 'dimension', $value: { value: -0.01, unit: 'em' }, $description: 'Not a DTCG unit; read it as -0.01em.', $extensions: { boopis: { css: '--track-mono', cssValue: '-.01em' } } } };

/* typography composites */
const typo = (size, weight, lh, font, extra) => Object.assign({ $type: 'typography', $value: { fontFamily: ref('semantic.font.' + font), fontSize: ref('primitive.size.' + size), fontWeight: weight, lineHeight: lh, letterSpacing: font === 'mono' ? { value: -0.01, unit: 'em' } : { value: 0, unit: 'px' } } }, extra || {});
semantic.type = {
  display: typo('xl', 600, 1.2, 'sans', { $description: 'One per screen at most: the name of a bot being made.' }),
  title: typo('l', 600, 1.2, 'sans', { $description: 'View and dialog titles, a bot name in its header.' }),
  'card-title': typo('m', 600, 1.35, 'sans', { $description: 'Card and dock-card titles.' }),
  reading: typo('m', 400, 1.6, 'sans', { $description: 'Conversation prose, request cards, the composer. Measure 608px.' }),
  interface: typo('s', 400, 1.35, 'sans', { $description: 'Rows, buttons (500), menus, tabs (500).' }),
  label: typo('xs', 500, 1.35, 'sans', { $description: 'Group headings, field labels, chips.' }),
  small: typo('xs', 400, 1.5, 'sans', { $description: 'Hints, descriptions, tooltips.' }),
  code: typo('xs', 400, 1.45, 'mono', { $description: 'Inline code chips (12px; the 12.5px variants are drift).' }),
  meta: typo('2xs', 400, 1.45, 'mono', { $description: 'Call numbers, times, costs, state words, kbd.' }),
  stamp: typo('2xs', 500, 1, 'mono', { $description: '"waiting for you", "needs you", "failed".' })
};

/* ───────── component tier ───────── */
const c = (v, desc) => (desc ? { $value: v, $description: desc } : { $value: v });
const component = {
  button: {
    height: Object.assign({ $type: 'dimension' }, c(ref('primitive.control.control'))), 'height-s': Object.assign({ $type: 'dimension' }, c(ref('primitive.control.control-s'))),
    'padding-x': { $type: 'dimension', $value: dim(14) }, 'padding-x-s': { $type: 'dimension', $value: dim(10) }, radius: { $type: 'dimension', $value: ref('primitive.radius.s') },
    primary: { background: { $type: 'color', $value: ref('semantic.color.selected.fill') }, text: { $type: 'color', $value: ref('semantic.color.selected.on') }, 'background-hover': { $type: 'color', $value: ref('semantic.color.text.strong') } },
    secondary: { outline: { $type: 'color', $value: ref('semantic.color.line.default') }, text: { $type: 'color', $value: ref('semantic.color.text.default') }, 'background-hover': { $type: 'color', $value: ref('semantic.color.fill.hover') } },
    disabled: { text: { $type: 'color', $value: ref('semantic.color.text.quiet') }, background: { $type: 'color', $value: ref('semantic.color.surface.pressed') } }
  },
  'icon-button': { size: { $type: 'dimension', $value: ref('primitive.control.control-s') }, glyph: { $type: 'dimension', $value: dim(18) }, stroke: { $type: 'number', $value: 1.5 }, color: { $type: 'color', $value: ref('semantic.color.icon.default') } },
  hold: { duration: { $type: 'duration', $value: ref('primitive.duration.hold') }, 'min-width': { $type: 'dimension', $value: dim(148) }, rest: { $type: 'color', $value: ref('semantic.color.surface.raised') }, fill: { $type: 'color', $value: ref('semantic.color.selected.fill') }, grid: { $type: 'dimension', $value: dim(3), $description: 'Dot field pitch (Bayer 4x4).' } },
  row: { height: { $type: 'dimension', $value: ref('primitive.control.row') }, 'height-2': { $type: 'dimension', $value: ref('primitive.control.row-2') }, inset: { $type: 'dimension', $value: dim(8) }, 'icon-axis': { $type: 'dimension', $value: dim(28), $description: 'Every glyph and orb in the sidebar centres on x = 28.' }, 'text-line': { $type: 'dimension', $value: dim(44), $description: 'Every label in the sidebar starts at x = 44.' } },
  card: { width: { $type: 'dimension', $value: dim(520) }, 'width-compact': { $type: 'dimension', $value: dim(360) }, padding: { $type: 'dimension', $value: [dim(14), dim(16)] }, radius: { $type: 'dimension', $value: ref('primitive.radius.m') }, surface: { $type: 'color', $value: ref('semantic.color.surface.inset') }, well: { $type: 'color', $value: ref('semantic.color.surface.ground') } },
  request: { padding: { $type: 'dimension', $value: [dim(10), dim(14)] }, radius: { $type: 'dimension', $value: ref('primitive.radius.m') }, surface: { $type: 'color', $value: ref('semantic.color.surface.raised') } },
  composer: { width: { $type: 'dimension', $value: ref('primitive.layout.composer-w') }, padding: { $type: 'dimension', $value: [dim(12), dim(14), dim(4)], $description: 'Around the text (full layout).' }, inset: { $type: 'dimension', $value: dim(6), $description: 'The actions group and the bar sit this far from the box edge (--composer-pad).' }, 'action-radius': { $type: 'dimension', $value: dim(10), $description: 'Mic, send, attach and chips: max(--r-floor, --r-m − inset).', $extensions: { boopis: { formula: 'max(var(--r-floor), calc(var(--r-outer) - var(--pad)))' } } }, radius: { $type: 'dimension', $value: ref('primitive.radius.m') }, surface: { $type: 'color', $value: ref('semantic.color.surface.raised') }, outline: { $type: 'color', $value: ref('semantic.color.line.hair') }, 'outline-focus': { $type: 'color', $value: ref('semantic.color.line.default') } },
  stamp: { height: { $type: 'dimension', $value: dim(20) }, 'padding-x': { $type: 'dimension', $value: dim(7) }, radius: { $type: 'dimension', $value: ref('primitive.radius.xs') }, outline: { $type: 'color', $value: ref('semantic.color.attention.fill') }, text: { $type: 'color', $value: ref('semantic.color.attention.text') } },
  dot: { size: { $type: 'dimension', $value: dim(6) }, 'size-measure': { $type: 'dimension', $value: dim(4) }, 'size-flag': { $type: 'dimension', $value: dim(8) } },
  switch: { width: { $type: 'dimension', $value: dim(34) }, height: { $type: 'dimension', $value: dim(20) }, knob: { $type: 'dimension', $value: dim(14) }, on: { $type: 'color', $value: ref('semantic.color.selected.fill') }, off: { $type: 'color', $value: ref('semantic.color.surface.inset') } },
  focus: { width: { $type: 'dimension', $value: ref('primitive.focus.width') }, offset: { $type: 'dimension', $value: ref('primitive.focus.offset') }, color: { $type: 'color', $value: ref('semantic.color.accent.default') } },
  scrollbar: { size: { $type: 'dimension', $value: ref('primitive.scroll.size') }, thumb: { $type: 'dimension', $value: ref('primitive.scroll.thumb') }, 'thumb-active': { $type: 'dimension', $value: ref('primitive.scroll.thumb-active') }, 'thumb-min': { $type: 'dimension', $value: ref('primitive.scroll.thumb-min') },
    color: { $type: 'color', $value: ref('semantic.color.surface.pressed'), $extensions: { boopis: { css: '--scroll-thumb-color' } } }, 'color-active': { $type: 'color', $value: ref('semantic.color.mark.off'), $description: 'Hovered or dragged: 3:1 like every non-text mark (proposed, R-scroll-3).', $extensions: { boopis: { css: '--scroll-thumb-color-active' } } },
    track: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0 }, $description: 'Transparent: no track, no buttons.' } },
  elevation: {
    0: { $type: 'shadow', $value: [], $description: 'The frame and the ground.', $extensions: { boopis: { css: '--elev-0', z: '--z-base' } } },
    1: { $type: 'shadow', $value: [], $description: 'In flow: raised and inset surfaces. Tone and a hairline, never a shadow.', $extensions: { boopis: { css: '--elev-1' } } },
    2: { $type: 'shadow', $value: ref('semantic.shadow.tip'), $description: 'Tooltips.', $extensions: { boopis: { css: '--elev-2', z: '--z-tooltip' } } },
    3: { $type: 'shadow', $value: ref('semantic.shadow.pop'), $description: 'Menus, popovers, toasts.', $extensions: { boopis: { css: '--elev-3', z: '--z-menu, --z-toast' } } },
    4: { $type: 'shadow', $value: ref('semantic.shadow.pop'), $description: 'The palette and dialogs, over --scrim.', $extensions: { boopis: { css: '--elev-4', z: '--z-palette; modal dialogs use the top layer' } } }
  },
  dock: { surface: { $type: 'color', $value: ref('semantic.color.surface.dock') }, 'rest-height': { $type: 'dimension', $value: ref('primitive.layout.dock-rest-h') }, radius: { $type: 'dimension', $value: ref('primitive.radius.l') }, flare: { $type: 'dimension', $value: ref('primitive.radius.l') }, orb: { $type: 'dimension', $value: dim(40) }, pitch: { $type: 'dimension', $value: dim(54) } }
};

/* ───────── assemble ───────── */
const tokens = {
  $description: 'boopis design tokens. Generated by design-system/build-tokens.mjs from tokens.css; do not edit by hand. Values follow the W3C Design Tokens format (2025.10). Theme presets are modes: every themed token carries its catalog value in $value and every preset in $extensions.boopis.modes. Corners and density are two further modifiers on radius and control tokens.',
  $extensions: {
    boopis: {
      generatedFrom: 'tokens.css',
      modifiers: {
        preset: { default: 'catalog', contexts: PRESETS, apply: 'data-hx-preset="<context>" on <html>', meta: PRESET_META },
        corners: { default: 'default', contexts: ['sharp', 'default', 'round'], apply: 'data-hx-corners on <html>', note: 'Typewriter defaults to round.' },
        density: { default: 'regular', contexts: ['compact', 'regular', 'comfortable'], apply: 'data-hx-density on <html>' },
        case: { default: 'sentence', contexts: ['sentence', 'lower'], apply: 'data-hx-case on <html>; --ui-case is none or lowercase, applied to interface labels only' },
        ground: { default: 'surface', contexts: ['surface', 'dock'], apply: 'data-ground="dock" on the dock root or a card inside it: re-derives the text, line and fill roles from #000' }
      },
      fixed: ['--dock-bg']
    }
  },
  primitive: Object.assign({ color: primTree }, scale),
  semantic: Object.assign(semantic, { ground: { dock: groundDock } }),
  component
};
/* cleanup undefined */
const json = JSON.stringify(tokens, (k, v) => (v === undefined ? undefined : v), 2);
writeFileSync(join(here, 'tokens.json'), json + '\n');

if (process.argv.includes('--report')) {
  const all = {}; for (const p of PRESETS) all[p] = check(p);
  const lines = ['| Pair | Min | ' + PRESETS.map((p) => PRESET_META[p].name).join(' | ') + ' |', '|---|---|' + PRESETS.map(() => '---').join('|') + '|'];
  all.catalog.forEach((row, i) => {
    lines.push('| ' + row.label + ' (`' + row.fg + '` on `' + row.bg + '`) | ' + row.min + ' | ' + PRESETS.map((p) => { const r = all[p][i].r; return (r < row.min ? '**' + r.toFixed(2) + ' fail**' : r.toFixed(2)); }).join(' | ') + ' |');
  });
  console.log(lines.join('\n'));
  console.log('\nVALUES');
  for (const p of PRESETS) {
    const t = R[p];
    console.log(p, Object.fromEntries([...SOLID, '--scrim'].map((k) => [k, t[k].a === 1 ? toHex(t[k].rgb) : toHex(t[k].rgb) + ' @' + t[k].a])));
  }
  console.log('\nDOCK');
  for (const p of PRESETS) console.log(p, Object.fromEntries(Object.entries(R[p].dock).map(([k, v]) => [k, toHex(v.rgb) + (v.a !== 1 ? ' @' + v.a : '')])));
  console.log('\nPRIMS', JSON.stringify(Object.fromEntries(Object.entries(primTree).map(([f, o]) => [f, Object.fromEntries(Object.entries(o).map(([s, v]) => [s, v.$value.hex]))]))));
}
