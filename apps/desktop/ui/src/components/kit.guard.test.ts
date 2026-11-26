/* The kit's guard (docs/UI-COMPONENTS.md). Three promises, each a test:
   1. the kit is pure: src/components imports nothing from the app (modules, host, data, the app's state or settings);
   2. everything else reaches the kit only through its entry, `@boopis/ui`, never a component's internals;
   3. no module re-implements a pattern the kit owns: per group, the markup or CSS that would be a second copy, with an allowlist of
      the places the inventory names as known debt (each with its reason). A new copy fails here; an allowlisted one that is gone
      fails too, so the list only shrinks. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { variants } from './variants';
import { html } from './html';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');
const ALL = walk(SRC).map(rel);
const isTest = (p: string): boolean => /\.test\.ts$/.test(p);
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
/* what draws UI outside the kit: the modules, the host's screens, the theme panel, the entry, and the page's own markup */
const CONSUMER_TS = ALL.filter((p) => p.endsWith('.ts') && !p.startsWith('src/components/') && !p.startsWith('src/vendor/') && p !== 'src/host/bindings.ts' && !isTest(p));
const MODULE_CSS = ALL.filter((p) => p.endsWith('.css') && p.startsWith('src/modules/'));
const KIT_TS = ALL.filter((p) => p.startsWith('src/components/') && p.endsWith('.ts') && !isTest(p));

describe('the kit is pure', () => {
  /* what the kit may import outside itself: the DOM and key helpers, the log, the event bus (re-reading tokens on hx:theme), the colour
     maths, the token source, the vendored elements, and two shared tables that state rules from outside the app (the model names, and
     the engine's mention rule the host reads too) */
  const ALLOWED = [/^\.\.?\/(?!\.\.)/, /^\.\.\/core\/(dom|keys|log|bus|types)$/, /^\.\.\/\.\.\/core\/(dom|keys|log|bus|types)$/, /^(\.\.\/){1,2}styles\/colour$/, /^(\.\.\/)+vendor\//, /^(\.\.\/)+shared\/data\/(model-names|room-mentions)\.json$/, /^node:/];
  it('imports nothing from the app', () => {
    const bad: string[] = [];
    for (const p of KIT_TS) for (const m of read(p).matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+'([^']+)'/g)) {
      const spec = m[1] ?? '';
      if (!ALLOWED.some((r) => r.test(spec)) || /\/(modules|host|data)\//.test(spec.replace('shared/data/', '')) || /core\/(state|settings|registry)$/.test(spec)) bad.push(p + ' -> ' + spec);
    }
    expect(bad).toEqual([]);
  });
});

describe('everything reaches the kit through its entry', () => {
  it('no file outside the kit imports src/components by path', () => {
    const bad: string[] = [];
    for (const p of ALL.filter((x) => x.endsWith('.ts') && !x.startsWith('src/components/'))) {
      for (const m of read(p).matchAll(/from\s+'([^']*\bcomponents(?:\/[^']*)?)'/g)) bad.push(p + ' -> ' + m[1]);
    }
    expect(bad).toEqual([]);
  });
});

/* one group of the inventory: a pattern that is a second copy of a kit component, where it is looked for, and the known places */
interface Group { name: string; where: 'ts' | 'css' | 'html'; re: RegExp; allow?: Record<string, string> }
const GROUPS: Group[] = [
  /* scroll areas: one bar, drawn by the kit (R-scroll-1); a scroller is a .ui-scroll */
  { name: 'scrollbar styling', where: 'css', re: /scrollbar-(width|color)|::-webkit-scrollbar/,
    allow: { 'src/modules/shell/shell.css': 'the rail list hides its bar so every orb stays on the x = 28 axis' } },
  { name: 'scroller declared outside the kit', where: 'css', re: /overflow(-[xy])?\s*:\s*[^;}]*\b(auto|scroll)\b/,
    allow: { 'src/modules/shell/shell.css': 'the failed-module notice (.hx-stub) and the theme JSON textarea (.hxt-json, a field the user resizes)' } },
  /* tab bars: ui.tabs or ui.segmented({mode: 'tabs'}) (R-tab-1) */
  { name: 'tab markup', where: 'ts', re: /role:\s*'tab'(?!list|panel)|<[^>]*\brole="tab"/ },
  { name: 'tab styling', where: 'css', re: /\[aria-selected/ },
  /* key chips: ui.html.keys / kbd / comboKbds (R-kbd-1 to 3) */
  { name: 'key chip markup', where: 'ts', re: /<kbd\b/ },
  { name: 'key chip markup', where: 'html', re: /class="ui-kbd"/ },
  { name: 'key chip styling', where: 'css', re: /(^|[\s,}])kbd\b[^-]|\.ui-kbd\s*\{/ },
  /* search fields: ui.search (R-search-1) */
  { name: 'search field markup', where: 'ts', re: /data-icon="search"|ui-search__/ },
  { name: 'search field markup', where: 'html', re: /data-icon="search"|ui-search/ },
  /* settings rows and sections: ui.html.setRow, setHead, setSection (§14.21) */
  { name: 'settings row or heading markup', where: 'ts', re: /class="ui-set__(row|head|label)"|['"]hx-set['"]|class="hx-set"/ },
  /* switches: ui.html.switch (R-switch-1 to 3); there is no checkbox (R-check-1) */
  { name: 'switch or checkbox markup', where: 'ts', re: /type="checkbox"|type:\s*'checkbox'/ },
  /* buttons and text controls: ui.html.button, iconButton, input, field */
  { name: 'button markup', where: 'ts', re: /class="ui-btn\b|class:\s*'ui-btn\b|class="ui-ib\b|class:\s*'ui-ib\b/,
    allow: { 'src/styles/theme-panel.ts': 'Import file is a <label> styled as a small button so it opens the file chooser (pending: a file button in the kit)' } },
  { name: 'text control markup', where: 'ts', re: /class="ui-input\b|class:\s*'ui-input\b/,
    allow: { 'src/modules/cards/form.ts': 'the form card renders its own controls from the schema (one card family; pending: ui.html.input there)' } },
  { name: 'hand-built button styling', where: 'css', re: /appearance:\s*none/,
    allow: { 'src/modules/cards/cards.css': 'the card layer\'s own surfaces: the token, the mini card, the option row (pending: rows and option rows in the kit)' } },
  /* the quiet mark: ui.html.badge */
  { name: 'badge styling', where: 'css', re: /border-radius:\s*var\(--r-pill\)[^}]*font:[^}]*var\(--mono\)/ },
  /* floating surfaces and messages the kit draws: menus, tooltips, toasts, empty states */
  { name: 'tooltip, toast or empty state markup', where: 'ts', re: /class="ui-(tip|toast|empty)"|class:\s*'ui-(tip|toast|empty)'/ },
  /* a bare library class restyled from a module (a module may place a kit component in its context, never redefine it) */
  { name: 'kit class redefined in a module', where: 'css', re: /(^|\})\s*\.ui-[\w-]+\s*(,\s*\.ui-[\w-]+\s*)*\{/ }
];
const filesOf = (w: Group['where']): string[] => (w === 'ts' ? CONSUMER_TS : w === 'css' ? MODULE_CSS : ['index.html']);
const strip = (src: string, w: Group['where']): string => (w === 'css' ? src.replace(/\/\*[\s\S]*?\*\//g, '') : w === 'ts' ? src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '') : src.replace(/<!--[\s\S]*?-->/g, ''));

describe('no module re-implements a kit component', () => {
  it('scans the app (a sanity check on the walk)', () => {
    expect(CONSUMER_TS.length).toBeGreaterThan(60);
    expect(MODULE_CSS.length).toBeGreaterThanOrEqual(6);
    expect(GROUPS.find((g) => g.name === 'key chip markup')?.re.test('<kbd class="x">')).toBe(true);
  });
  for (const g of GROUPS) {
    it(g.name + ' (' + g.where + ')', () => {
      const hits = filesOf(g.where).filter((p) => g.re.test(strip(read(p), g.where)));
      const unexpected = hits.filter((p) => !(g.allow && p in g.allow));
      const stale = Object.keys(g.allow ?? {}).filter((p) => !hits.includes(p));
      expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
    });
  }
});

describe('every component exports its variants for the UI lab', () => {
  it('each variant list names a template the kit draws', () => {
    const drawn = new Set([...Object.keys(html), 'menu', 'progress', 'composer', 'orb', 'select', 'tip', 'presence']);
    expect(Object.keys(variants).filter((k) => !drawn.has(k))).toEqual([]);
  });
  it('the new templates render from props alone (pure: the same output twice, no global read)', () => {
    const once = (): string => html.tabs({ label: 'L', tabs: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'b' }) + html.search({ label: 'Search', keys: 'esc' }) +
      html.scroll({ axis: 'x', bare: true, body: 'x' }) + html.badge({ label: 'outside' }) + html.setSection({ id: 's', label: 'S' }) + html.input({ value: 'v', mono: true });
    expect(once()).toBe(once());
  });
});
