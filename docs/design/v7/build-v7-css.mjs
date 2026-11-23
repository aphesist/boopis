#!/usr/bin/env node
// Writes tokens.v7.css from tokens.v7.json: the proposal's tokens as custom properties, dark and light, plus the
// option switches the owner's boards use (data-font, data-radii, data-shadow, data-accent, data-attention).
// Usage: node docs/design/v7/build-v7-css.mjs [out.css]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, 'tokens.v7.json'), 'utf8'));
const out = process.argv[2] || join(here, 'tokens.v7.css');

const dark = [], light = [], both = [];
for (const v of Object.values(t.color)) {
  if ('value' in v) both.push(`${v.css}: ${v.value};`);
  else { dark.push(`${v.css}: ${v.dark};`); light.push(`${v.css}: ${v.light};`); }
}
for (const v of Object.values(t.font)) if (v.css) both.push(`${v.css}: ${v.value};`);
for (const [, s] of Object.entries(t.font.scale)) both.push(`${s.css}: ${s.size}px;`, `${s.css.replace('--fs', '--lh')}: ${s.line}px;`);
for (const v of Object.values(t.radius)) both.push(`${v.css}: ${typeof v.value === 'number' && v.css !== '--corner-smoothing' ? v.value + 'px' : v.value};`);
for (const p of Object.values(t.nesting.pads)) both.push(`${p.css}: ${p.value}px;`);
for (const [k, v] of Object.entries(t.space.steps)) both.push(`${k}: ${v}px;`);
for (const v of Object.values(t.size)) if (v.css && typeof v.value === 'number') both.push(`${v.css}: ${v.value}px;`);
for (const [k, v] of Object.entries(t.motion.easings)) both.push(`${k}: ${v.value};`);
for (const [k, v] of Object.entries(t.motion.durations)) both.push(`${k}: ${v.value};`);
both.push(`--shadow-composer: ${t.elevation.composer.value};`, '--hl: 0.5px;');
for (const [k, v] of Object.entries(t.elevation.light)) if (k.startsWith('--')) light.push(`${k}: ${v};`);
dark.push('--shadow-inline: none;', '--shadow-pop: none;', '--shadow-modal: none;', '--shadow-window: none;');

const css = `/* Generated from tokens.v7.json by build-v7-css.mjs. A proposal: nothing in the app reads it yet. */
:root, [data-theme="dark"] { color-scheme: dark;
  ${dark.join('\n  ')}
}
[data-theme="light"] { color-scheme: light;
  ${light.join('\n  ')}
}
:root {
  ${both.join('\n  ')}
}
/* options (the boards) */
[data-font="inter"] { --sans: 'Inter', system-ui, sans-serif; }
[data-font="figtree"] { --sans: 'Figtree', system-ui, sans-serif; }
[data-font="geist"] { --sans: 'Geist', system-ui, sans-serif; }
[data-radii="a"] { --corner-smoothing: 0; }
[data-radii="c"] { --r-bubble: 22px; --r-dialog: 24px; --r-menu: 20px; --r-card: 18px; --r-tile: 16px; --r-field: 12px; --r-nav: 10px; --r-tip: 8px; --r-composer: 24px; }
[data-theme="light"][data-shadow="b"], [data-theme="light"] [data-shadow="b"] {
  --shadow-inline: 0 2px 6px -1px #1c1c1c0d, 0 0 0 0.5px #1c1c1c1f; --shadow-pop: 0 6px 14px -3px #1c1c1c12, 0 0 0 0.5px #1c1c1c24;
  --shadow-modal: 0 12px 24px -6px #1c1c1c14, 0 0 0 0.5px #1c1c1c24; --float-line: #1c1c1c1f; }
[data-theme="light"][data-shadow="c"], [data-theme="light"] [data-shadow="c"] {
  --shadow-inline: 0 0 0 0.5px #1c1c1c24; --shadow-pop: 0 0 0 0.5px #1c1c1c2e; --shadow-modal: 0 0 0 0.5px #1c1c1c2e; --float-line: #1c1c1c2e; }
[data-accent="ink"] { --on-accent: var(--text-on-light); --accent: var(--selected); --accent-text: var(--text); --focus: var(--text-dim); --accent-soft: var(--current); }
[data-theme="dark"] [data-accent="brass"], [data-theme="dark"][data-accent="brass"] { --accent: #c8a66a; --accent-text: #d9bd88; --focus: #c8a66a; --accent-soft: #c8a66a1f; }
[data-theme="light"] [data-accent="brass"], [data-theme="light"][data-accent="brass"] { --accent: #8a6a2c; --accent-text: #7a5c22; --focus: #8a6a2c; --accent-soft: #8a6a2c1a; }
/* the colour of what the person owes, resolved where the theme is declared */
:root, [data-theme], [data-attention="red"] { --owe: var(--red); --owe-text: var(--red-text); }
[data-attention="warn"] { --owe: var(--warn); --owe-text: var(--warn-text); }
[data-theme="dark"], :root { --seg-on: var(--current); --seg-on-sh: none; --card-line: var(--hair); }
[data-theme="light"] { --seg-on: var(--bg-3); --seg-on-sh: inset 0 0 0 var(--hl) var(--line), var(--shadow-inline); --card-line: var(--float-line); }
`;
writeFileSync(out, css);
console.log('wrote', out);
