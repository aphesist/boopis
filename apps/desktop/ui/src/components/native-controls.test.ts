/* The guard: no control whose look comes from the browser or the OS comes back into `src` (docs/UI-CONTROLS.md).
   It reads every source file and fails on a native select, a date or colour field, a spin button, a stock checkbox or radio, a
   title="" tooltip used as UI, a native alert, or an unthemed dialog, unless the file is on the allowlist below with the reason
   written next to it. An allowlist entry nobody uses any more fails too, so the list stays true.
   A new control is built in `src/components/` (select.ts, html.ts) from the design system; do not add to the allowlist to ship one. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SRC, '..');

interface Rule { id: string; what: string; instead: string; re: RegExp; kinds?: readonly string[] }
const TYPE = (names: string): RegExp => new RegExp(`type\\s*[=:]\\s*\\\\?["'](?:${names})\\\\?["']`, 'i');
const RULES: readonly Rule[] = [
  { id: 'select', what: 'a native <select>, <option> or <datalist> (its popup is the platform\'s)', instead: 'ui.select / ui.field({ kind: \'select\' | \'model\' }) from components/select.ts', re: /<(?:select|option|datalist)\b|createElement\(\s*['"](?:select|option|datalist)['"]|\bel\(\s*['"](?:select|option|datalist)['"]/i },
  { id: 'select-css', what: 'a stylesheet rule for a native select or option', instead: '.ui-select and .ui-option in components.css', re: /(?:^|[\s,>}])(?:select|option)(?:\.|\s*[{,:[])/m, kinds: ['.css'] },
  { id: 'date-time', what: 'a date, time or month field (a platform picker)', instead: 'a text field with a format hint, or a select', re: TYPE('date|time|datetime-local|month|week'), kinds: ['.ts', '.html'] },
  { id: 'colour', what: 'a colour field (the platform\'s colour chooser)', instead: 'a swatch button and a hex field (styles/theme-panel.ts)', re: TYPE('color'), kinds: ['.ts', '.html'] },
  { id: 'range', what: 'a range slider', instead: 'a segmented control, or a text field', re: TYPE('range'), kinds: ['.ts', '.html'] },
  { id: 'number', what: 'a number field (spin buttons)', instead: 'a text field with inputmode="decimal" or "numeric" (modules/cards/form.ts)', re: TYPE('number'), kinds: ['.ts', '.html'] },
  { id: 'file', what: 'a file input (the platform\'s chooser)', instead: 'keep the input hidden behind a button of the library', re: TYPE('file'), kinds: ['.ts', '.html'] },
  { id: 'checkbox-radio', what: 'a stock checkbox or radio', instead: 'ui.switch, ui.segmented, ui.chipGroup or the form card\'s option rows', re: TYPE('checkbox|radio'), kinds: ['.ts', '.html'] },
  { id: 'title-tooltip', what: 'a title="" tooltip (the platform\'s, unthemed, slow and unreadable by keyboard)', instead: 'data-tip (components/tooltip.ts) and an accessible name', re: /\stitle=(?:"|\\")|setAttribute\(\s*['"]title['"]/ },
  { id: 'native-dialog-call', what: 'alert(), confirm() or prompt()', instead: 'a form card or ui.toast', re: /(?<![\w.$])(?:window\.)?(?:alert|confirm|prompt)\(/ },
  { id: 'dialog', what: 'a <dialog> that is not the app\'s themed .hx-dialog', instead: 'the .hx-dialog pattern (modules/shell/shell.css)', re: /<dialog\b(?![^>]*class="hx-dialog)/ },
  { id: 'disclosure-widget', what: 'a native <details>, <summary>, <progress> or <meter>', instead: 'ui.disclosure, ui.section, ui.measure, the progress dots', re: /<(?:details|summary|progress|meter)\b/ }
];

/** where a rule is allowed, and why. `file` is relative to `apps/desktop/ui`. */
interface Allow { rule: string; file: string; why: string }
const ALLOW: readonly Allow[] = [
  { rule: 'file', file: 'src/modules/cards/form.ts', why: 'the form card\'s upload: the input is hidden and the library\'s "Choose a file" button opens the OS chooser, which cannot be themed' },
  { rule: 'file', file: 'src/styles/theme-panel.ts', why: 'Import file: the OS chooser behind a library button; the input has no look of its own (shell.css .hxt-file)' },
  { rule: 'checkbox-radio', file: 'src/components/html.ts', why: 'ui.switch: appearance none, drawn by .ui-switch (14.16 "a native checkbox with role=switch")' },
  { rule: 'checkbox-radio', file: 'src/styles/theme-panel.ts', why: 'the preset cards: a visually hidden radio inside a themed card, so the group keeps arrow-key behaviour' },
  { rule: 'checkbox-radio', file: 'src/modules/shell/dialogs.ts', why: 'reads the radios\' state for the dialog\'s Tab loop; draws nothing' },
  { rule: 'checkbox-radio', file: 'index.html', why: 'the shell\'s Dock switch: ui.switch markup' },
  { rule: 'title-tooltip', file: 'src/modules/dock/views.ts', why: 'the dock belongs to another change; its long-name title moves to data-tip there (docs/UI-CONTROLS.md)' }
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'vendor' && name !== 'node_modules') yield* walk(p); } else yield p;
  }
}
const files = [...walk(SRC), join(ROOT, 'index.html')].filter((p) => /\.(ts|css|html)$/.test(p) && !/\.test\.ts$/.test(p) && !/\.generated\.ts$/.test(p) && !/bindings\.ts$/.test(p));
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');

/** a comment is not markup: block and line comments are blanked before the rules look */
const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
const code = (p: string, text: string): string => {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (p.endsWith('.css')) return noBlock;
  if (p.endsWith('.html')) return noBlock.replace(/<!--[\s\S]*?-->/g, blank);
  return noBlock.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
};

const found: Array<{ rule: Rule; file: string; line: number; text: string }> = [];
for (const p of files) {
  const text = code(p, readFileSync(p, 'utf8'));
  for (const rule of RULES) {
    if (rule.kinds && !rule.kinds.some((k) => p.endsWith(k))) continue;
    const lines = text.split('\n');
    lines.forEach((l, i) => { if (rule.re.test(l)) found.push({ rule, file: rel(p), line: i + 1, text: l.trim().slice(0, 120) }); });
  }
}
const allowed = (f: { rule: Rule; file: string }): boolean => ALLOW.some((a) => a.rule === f.rule.id && a.file === f.file);

describe('no native controls in src', () => {
  it('scans the app\'s sources (a guard that reads nothing guards nothing)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => rel(f) === 'src/components/select.ts')).toBe(true);
    expect(files.some((f) => rel(f) === 'index.html')).toBe(true);
  });
  it('finds none outside the allowlist', () => {
    const bad = found.filter((f) => !allowed(f));
    const say = bad.map((f) => `${f.file}:${f.line}  ${f.rule.what}\n    use ${f.rule.instead}\n    ${f.text}`);
    expect(say, 'native controls came back; see docs/UI-CONTROLS.md\n' + say.join('\n')).toEqual([]);
  });
  it('lists no allowance that nothing uses', () => {
    const stale = ALLOW.filter((a) => !found.some((f) => f.rule.id === a.rule && f.file === a.file));
    expect(stale.map((a) => `${a.rule} in ${a.file}`)).toEqual([]);
  });
  it('would catch the thing it guards against', () => {
    const probe = (re: RegExp, s: string): boolean => re.test(s);
    const by = (id: string): RegExp => RULES.find((r) => r.id === id)!.re;
    expect(probe(by('select'), '<select class="ui-input">')).toBe(true);
    expect(probe(by('select'), "el('select', {})")).toBe(true);
    expect(probe(by('date-time'), '<input type="date">')).toBe(true);
    expect(probe(by('date-time'), "{ type: 'time' }")).toBe(true);
    expect(probe(by('colour'), '<input type=\\"color\\">')).toBe(true);
    expect(probe(by('number'), "type = 'number'")).toBe(true);
    expect(probe(by('title-tooltip'), '<span title="x">')).toBe(true);
    expect(probe(by('native-dialog-call'), 'if (confirm("sure"))')).toBe(true);
    expect(probe(by('native-dialog-call'), 'ui.confirm(x)')).toBe(false);
    expect(probe(by('select-css'), 'select.ui-input { appearance: none; }')).toBe(true);
    expect(probe(by('select-css'), '.ui-select { }')).toBe(false);
  });
  it('the stylesheet keeps the rules that stand in for the platform\'s own', () => {
    const css = readFileSync(join(SRC, 'components/components.css'), 'utf8');
    expect(css).toMatch(/:-webkit-autofill/);                      /* autofill keeps the theme's colours */
    expect(css).toMatch(/\[data-layer-host\], \.ui-scroll\) ::-webkit-scrollbar/);   /* every scroller the app draws has the thin bar, in WebKitGTK too */
  });
});
