#!/usr/bin/env node
/* The v7 tokens (DESIGN-SYSTEM.md v7 sections 3 to 9, 17, 18 and 21.1): writes src/styles/tokens.v7.css from
   src/styles/tokens.v7.json, the design's own source (copied byte for byte from docs/design/v7/tokens.v7.json on
   w31/design-system-v7 at 8ec7ede3; never edited here). The values and their grouping follow the design's generator,
   docs/design/v7/build-v7-css.mjs, with what the app needs on top:

   - Scoped, not global. Every token is declared on `[data-ui="v7"]`, the root of a v7 surface (the lab's kit stories today,
     the app's root once wave C moves the screens). The v6 tokens on :root stay as they are, so today's screens do not change.
     `data-theme="dark" | "light"` sits on that root or on a descendant (the dock's content is always dark, 21.4).
   - The hairline is one device pixel (elevation.hairline): 1px at 1x, 0.625px at 1.6x, 0.5px at 2x.
   - The theme customization of section 18 that is CSS: corners C (`data-radii="c"`) and the light shadows B and C
     (`data-shadow`). The accent is any hex and is derived at run time (components/v7/theme.ts), since its text and focus
     shades come from a contrast search.
   - The theme-dependent board constants of the approved renders (ds-v7/src/kit.css: the composer's and floating lines, the
     bubble ring, the switch's knob and track, the segmented thumb, the card line), which the kit's components read.
   - The named component internals of section 7 (tokens.v7.json space.named) as `--pad-*` lengths, so no component writes a
     literal spacing value (tokens.loose).

   Run: node scripts/build-tokens-v7.mjs [--check] */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'styles', 'tokens.v7.json');
const OUT = join(here, '..', 'src', 'styles', 'tokens.v7.css');
const t = JSON.parse(readFileSync(SRC, 'utf8'));

const R = '[data-ui="v7"]';
const DARK = `${R}, ${R}[data-theme="dark"], ${R} [data-theme="dark"]`;
const LIGHT = `${R}[data-theme="light"], ${R} [data-theme="light"]`;
const lightAnd = (s) => `${R}[data-theme="light"]${s}, ${R}[data-theme="light"] ${s}, ${R} [data-theme="light"]${s}, ${R} [data-theme="light"] ${s}`;

const dark = [], light = [], both = [];
for (const v of Object.values(t.color)) {
  if ('value' in v) both.push(`${v.css}: ${v.value};`);
  else { dark.push(`${v.css}: ${v.dark};`); light.push(`${v.css}: ${v.light};`); }
}
for (const v of Object.values(t.font)) if (v.css) both.push(`${v.css}: ${v.value};`);
for (const [, s] of Object.entries(t.font.scale)) both.push(`${s.css}: ${s.size}px;`, `${s.css.replace('--fs', '--lh')}: ${s.line}px;`);
for (const v of Object.values(t.radius)) both.push(`${v.css}: ${typeof v.value === 'number' && v.css !== '--corner-smoothing' ? v.value + 'px' : v.value};`);
for (const p of Object.values(t.nesting.pads)) both.push(`${p.css}: ${p.calc || p.value + 'px'};`);
for (const [k, v] of Object.entries(t.space.steps)) both.push(`${k}: ${v}px;`);
for (const v of Object.values(t.size)) if (v.css && typeof v.value === 'number') both.push(`${v.css}: ${v.value}px;`);
for (const [k, v] of Object.entries(t.motion.easings)) both.push(`${k}: ${v.value};`);
for (const [k, v] of Object.entries(t.motion.durations)) both.push(`${k}: ${v.value};`);
for (const [k, v] of Object.entries(t.mark)) if (k.startsWith('--')) both.push(`${k}: ${v};`);
both.push(`--shadow-composer: ${t.elevation.composer.value};`);
for (const [k, v] of Object.entries(t.elevation.light)) if (k.startsWith('--')) light.push(`${k}: ${v};`);
dark.push('--shadow-inline: none;', '--shadow-pop: none;', '--shadow-modal: none;', '--shadow-window: none;');

/* the board constants that change with the theme (ds-v7/src/kit.css and build-v7-css.mjs's last two rules) */
dark.push('--composer-line: var(--line-strong);', '--float-line: var(--line);', '--bubble-ring: var(--hair);', '--knob: #f5f5f5e6;', '--knob-sh: none;',
  '--track-off: var(--fill-2);', '--seg-on: var(--current);', '--seg-on-sh: none;', '--card-line: var(--hair);');
light.push('--composer-line: #1c1c1c14;', '--float-line: #1c1c1c0d;', '--bubble-ring: transparent;', '--knob: #ffffff;', '--knob-sh: 0 1px 2px #0000002e, 0 0 0 .5px #0000000f;',
  '--track-off: #1c1c1c1f;', '--seg-on: var(--bg-3);', '--seg-on-sh: inset 0 0 0 var(--hl) var(--line), var(--shadow-inline);', '--card-line: var(--float-line);');

/* section 7's named internals (tokens.v7.json space.named; the approved renders' kit.css where the prose gives a range) */
const NAMED = {
  '--pad-bubble-y': 7, '--pad-bubble-x': 12,          /* bubble 7 12 */
  '--pad-row-y': 6, '--pad-row-x': 8,                  /* menu row padding 6 8 */
  '--pad-btn': 16, '--pad-btn-card': 14, '--pad-btn-s': 12,   /* button 0 16 (36), 0 14 (32), 0 12 (28) */
  '--pad-chip': 14,                                    /* chip 0 14 */
  '--pad-set-x': 16, '--pad-set-y': 6,                 /* settings rows 16 across (min 44 tall) */
  '--pad-nav-y': 7, '--pad-nav-x': 9,                  /* settings nav row 7 9 */
  '--pad-tip-y': 4, '--pad-tip-x': 6,                  /* tooltip 4 6 */
  '--pad-pill-y': 7.5, '--pad-pill-end': 13.5, '--pad-pill-start': 7.5,   /* title pill 7.5 13.5 7.5 7.5 */
  '--pad-kbd': 5,                                      /* key chip: 20 tall, 5 across (kit.css) */
  '--pad-inline': 7,                                   /* an inline chip's sides (kit.css .you, .refchip, .badge2) */
  '--pad-code-y': 1, '--pad-code-x': 5,                /* inline code 1 5 */
  '--pad-line': 10, '--pad-line-act': 3,               /* a SystemLine pill: 0 10; with an action, the button on a 3 inset (20.2, S36) */
  '--pad-queue': 4,                                    /* the queue: rows on a 4 inset (8.2) */
  '--pad-text': 4,                                     /* text rows inside a Block indent 4 more (R-corner-10) */
  '--gap-hair': 2,                                     /* 2 px: the segmented track's and the window controls' gap (section 7: "plus 2") */
  '--gap-xs': 3, '--gap-s': 6, '--gap-row': 10,        /* key chips 3 apart; glyph gaps 6; a 54 row's orb to name 10 */
  '--pad-chrome': 56,                                  /* the drag region's height (56) as the top of what sits under it: the rail, a pane's head */
  '--gutter': 30, '--gm': 22,                          /* the thread's agent gutter and the brand tile (20, S09) */
  '--pad-chip-mode': 10,                               /* a composer mode chip: 0 10 (kit.css .chip.mode) */
  '--pad-sel-start': 7, '--pad-sel-end': 5, '--gap-sel': 4,   /* a SelectorItem: 0 5 0 7, gap 4 (kit.css .select) */
  '--pad-need-start': 7, '--pad-need-end': 9,          /* "+ Choose a model": 0 9 0 7 (kit.css .ns-need) */
  '--pad-field': 12, '--pad-field-y': 8,             /* a field 0 12 (kit.css .input) */
  '--gap-label': 6                                     /* a field's label above it */
};
for (const [k, v] of Object.entries(NAMED)) both.push(`${k}: ${v}px;`);
/* the sizes the components share that section 7 names but tokens.v7.json does not carry as a number */
both.push('--search-pill-w: 300px;', '--notch-h: 60px;', '--diff-n: 36px;', '--diff-g: 16px;', '--notch-ctl: 24px;', '--composer-max-h: 204px;', '--menu-w: 240px;', '--options-w: 372px;', '--pop-w: 260px;', '--on-danger: #ffffff;', '--logo-box: 72px;', '--logo-w: 32px;', '--tick: 6px;', '--seg-item-h: 26px;', '--kbd-h: 20px;', '--switch-w: 32px;', '--switch-h: 20px;', '--knob-d: 16px;', '--line-h: 26px;', '--line-h-act: 32px;', '--item-h: 60px;',
  '--item-mark: 40px;', '--session-h: 44px;', '--compact-h: 36px;', '--badge-h: 18px;', '--dot: 8px;', '--letter: 20px;', '--icon-s: 16px;',
  '--flag-ring: 2.5px;', '--hold-ring: 2px;', '--focus-w: 2px;', '--focus-off: 2px;', '--mark-gap-ch: 7ch;', '--tools-w: 520px;', '--sb-open-w: 300px;',
  '--rail-b-w: 64px;', '--tile-b: 44px;', '--pane-orb: 64px;', '--dk-row-h: 72px;', '--dk-compact-h: 48px;', '--dk-open-w: 640px;', '--dk-open-h: 432px;',
  '--dk-row-max: 640px;', '--dk-compact-max: 380px;', '--dk-orb: 40px;', '--dk-orb-hover: 52px;', '--dk-orb-near: 46px;', '--dk-orb-compact: 24px;',
  '--dk-gap: 14px;', '--dk-gap-compact: 8px;', '--dk-r-compact: 24px;', '--dk-inset: 8px;', '--hl: 1px;');

const css = `/* Generated from tokens.v7.json by scripts/build-tokens-v7.mjs. Do not edit: run \`pnpm tokens\`. */
${DARK} { color-scheme: dark;
  ${dark.join('\n  ')}
}
${LIGHT} { color-scheme: light;
  ${light.join('\n  ')}
}
${R} {
  ${both.join('\n  ')}
}
/* one device pixel (elevation.hairline) */
@media (min-resolution: 1.5dppx) { ${R} { --hl: 0.625px; } }
@media (min-resolution: 2dppx) { ${R} { --hl: 0.5px; } }
/* theme customization (section 18): corners C, rounder */
${R}[data-radii="c"], ${R} [data-radii="c"] { --r-bubble: 22px; --r-dialog: 24px; --r-menu: 18px; --r-card: 16px; --r-tile: 16px; --r-field: 12px; --r-nav: 10px; --r-tip: 8px; --r-composer: 22px; }
/* theme customization (section 18): the light shadows B (hairline + half) and C (flat); A is the standard */
${lightAnd('[data-shadow="b"]')} {
  --shadow-inline: 0 2px 6px -1px #1c1c1c0d, 0 0 0 0.5px #1c1c1c1f; --shadow-pop: 0 6px 14px -3px #1c1c1c12, 0 0 0 0.5px #1c1c1c24;
  --shadow-modal: 0 12px 24px -6px #1c1c1c14, 0 0 0 0.5px #1c1c1c24; --float-line: #1c1c1c1f; }
${lightAnd('[data-shadow="c"]')} {
  --shadow-inline: 0 0 0 0.5px #1c1c1c24; --shadow-pop: 0 0 0 0.5px #1c1c1c2e; --shadow-modal: 0 0 0 0.5px #1c1c1c2e; --float-line: #1c1c1c2e; }
/* reduced motion (motion.reduced): durations to 1 ms; the loops stop in the components */
@media (prefers-reduced-motion: reduce) {
  ${R} { --dur-press: 1ms; --dur-1: 1ms; --dur-out: 1ms; --dur-pop: 1ms; --dur-2: 1ms; --dur-dot: 1ms; --dur-slide: 1ms; --dur-3: 1ms; --mark-dur-in: 1ms; --mark-dur-out: 1ms; }
}
`;

if (process.argv.includes('--check')) {
  const now = readFileSync(OUT, 'utf8');
  if (now !== css) { console.error('tokens.v7.css is out of date: run pnpm tokens'); process.exit(1); }
  console.log('tokens.v7.css is current');
} else {
  writeFileSync(OUT, css);
  console.log('wrote', OUT);
}
