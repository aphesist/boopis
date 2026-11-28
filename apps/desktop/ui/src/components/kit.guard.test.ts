/* The kit's guard (docs/UI-COMPONENTS.md). Three promises, each a test:
   1. the kit is pure: src/components imports nothing from the app (modules, host, data, the app's state or settings);
   2. everything else reaches the kit only through its entry, `@boopis/ui`, never a component's internals;
   3. no module re-implements a pattern the kit owns: per group, the markup or CSS that would be a second copy, with an allowlist of
      the places the inventory names as known debt (each with its reason). A new copy fails here; an allowlisted one that is gone
      fails too, so the list only shrinks. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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
/* a component's stories stand in its folder (components/v7/<name>/<name>.stories.ts) but are the lab's, never part of the kit's code */
const isStory = (p: string): boolean => /\.stories\.ts$/.test(p);
const KIT_TS = ALL.filter((p) => p.startsWith('src/components/') && p.endsWith('.ts') && !isTest(p) && !isStory(p));

describe('the kit is pure', () => {
  /* what the kit may import outside itself: the DOM and key helpers, the log, the event bus (re-reading tokens on hx:theme), the colour
     maths, the token source, the vendored elements, and two shared tables that state rules from outside the app (the model names, and
     the engine's mention rule the host reads too) */
  const ALLOWED = [/^\.\.?\/(?!\.\.)/, /^\.\.\/core\/(dom|keys|log|bus|types)$/, /^\.\.\/\.\.\/core\/(dom|keys|log|bus|types)$/, /^(\.\.\/){1,2}styles\/colour$/, /^(\.\.\/)+vendor\//, /^(\.\.\/)+shared\/data\/(model-names|room-mentions)\.json$/, /^node:/];
  it('imports nothing from the app', () => {
    const bad: string[] = [];
    for (const p of KIT_TS) for (const m of read(p).matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+'([^']+)'/g)) {
      /* a relative import is read as if it were written from src/components itself, so a component's folder (components/v7/<name>/)
         may reach the rest of the kit at any depth, and what lies outside the kit is judged the same from every folder */
      const raw = m[1] ?? '', at = raw.startsWith('.') ? posix.normalize(posix.join(posix.dirname(p), raw)) : '';
      if (at.startsWith('src/components/')) continue;
      const spec = at ? posix.relative('src/components', at) : raw;
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
  /* tab bars: the kit's Segmented tabs (R-tab-1) */
  { name: 'tab markup', where: 'ts', re: /role:\s*'tab'(?!list|panel)|<[^>]*\brole="tab"/ },
  { name: 'tab styling', where: 'css', re: /\[aria-selected/ },
  /* key chips: the kit's Kbd (R-kbd-1 to 3) */
  { name: 'key chip markup', where: 'ts', re: /<kbd\b/ },
  { name: 'key chip markup', where: 'html', re: /class="ui-kbd"/ },
  { name: 'key chip styling', where: 'css', re: /(^|[\s,}])kbd\b[^-]|\.ui-kbd\s*\{/ },
  /* search fields: the kit's Field (search) (R-search-1) */
  { name: 'search field markup', where: 'ts', re: /data-icon="search"|ui-search__/ },
  { name: 'search field markup', where: 'html', re: /data-icon="search"|ui-search/ },
  /* settings rows and sections: the kit's Card rows and SectionHead (§14.21) */
  { name: 'settings row or heading markup', where: 'ts', re: /class="ui-set__(row|head|label)"|['"]hx-set['"]|class="hx-set"/ },
  /* switches: the kit's Switch (R-switch-1 to 3); there is no checkbox (R-check-1) */
  { name: 'switch or checkbox markup', where: 'ts', re: /type="checkbox"|type:\s*'checkbox'/ },
  /* buttons and text controls: the kit's Button, IconButton and Field */
  { name: 'button markup', where: 'ts', re: /class="ui-btn\b|class:\s*'ui-btn\b|class="ui-ib\b|class:\s*'ui-ib\b/ },
  { name: 'text control markup', where: 'ts', re: /class="ui-input\b|class:\s*'ui-input\b/ },
  { name: 'hand-built button styling', where: 'css', re: /appearance:\s*none/ },
  /* the quiet mark: the kit's Badge */
  { name: 'badge styling', where: 'css', re: /border-radius:\s*var\(--r-pill\)[^}]*font:[^}]*var\(--mono\)/ },
  /* floating surfaces and messages the kit draws: menus, tooltips, notices, empty states */
  { name: 'tooltip or empty state markup', where: 'ts', re: /class="ui-(tip|empty)"|class:\s*'ui-(tip|empty)'/ },
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
