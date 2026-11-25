/* The v7 lab's static checks (docs/UI-LAB.md, "The v7 checks"): read the UI's source, no browser.
     kit.single     a name section 21 merged away (RETIRED in v7.mjs: QueueStrip, LimitNotice, Toast, Banner, ScopePicker,
                    SettingsLine, SteerLine, CheckpointBar, ChoiceCards, LaunchCard, ReferenceChip) used anywhere in the UI's
                    source, its stories included; and a kit component (KIT_V7) with no story file src/lab/stories/kit/<name>.stories.ts
     tokens.loose   a spacing value written as a literal (padding, margin, gap, inset in px or rem) in the UI's CSS, outside the
                    token files. Colours, font sizes and radii are tokens.static's (static-scan.mjs); together they are the token check
     contrast.accent  the theme does not define the derived accent tokens section 18 checks (--accent-text, --on-accent, --focus)
   `node tests/lab/static-v7.mjs` prints the findings; check.mjs folds them into the report. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_V7, KIT_V7_EXTRA, RETIRED, kebab, retiredPattern } from './v7.mjs';

const UI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(UI_ROOT, 'src');
const KIT_STORIES = join(SRC, 'lab', 'stories', 'kit');
/* generated or vendored, never written by hand here */
const SKIP = [/^vendor\//, /^host\/bindings\.ts$/, /^styles\/tokens\.json$/, /\.d\.ts$/, /^host\/fixtures\//, /^components\/squircle-golden\.json$/];
/* the token files: where literal values are the definition */
const TOKEN_FILES = [/^styles\/tokens\.css$/, /^styles\/tokens\.v7\.css$/];

function files(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...files(p)); else if (/\.(css|ts|html)$/.test(d.name)) out.push(p);
  }
  return out;
}
const blank = (m) => m.replace(/[^\n]/g, ' ');
const stripComments = (s, css) => (css ? s.replace(/\/\*[\s\S]*?\*\//g, blank) : s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length)));
const area = (rel) => (/modules\/session|components\/composer/.test(rel) ? 'composer' : /modules\/shell|components\/(toast|tooltip|layer)/.test(rel) ? 'shell' : /modules\/bots/.test(rel) ? 'bots' : /modules\/(cards|mods)|components\/mod-/.test(rel) ? 'cards' : /modules\/dock/.test(rel) ? 'dock' : /modules\/store|host\/live\/store|host\/store-bridge/.test(rel) ? 'store' : /host\/|styles\/theme-v7|modules\/settings/.test(rel) ? 'settings' : 'components');

/* a literal length that is spacing: a px or rem number other than 0 and the hairline 1px */
const SPACE_PROP = /(?:^|[;{\s])(padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap|inset(?:-(?:inline|block)(?:-(?:start|end))?)?)\s*:\s*([^;}]+)/g;
const LOOSE = /(?<![\w.-])(-?\d*\.?\d+)(px|rem)\b/g;

export function scanV7() {
  const findings = [];
  const at = (check, rel, line, msg, snippet) => findings.push({ check, area: area(rel), file: 'src/' + rel, line, msg, snippet: (snippet || '').trim().slice(0, 160), key: check + '|' + rel + '|' + msg });
  for (const f of files(SRC)) {
    const rel = relative(SRC, f).replace(/\\/g, '/');
    if (SKIP.some((r) => r.test(rel))) continue;
    if (statSync(f).size > 400000) continue;
    const css = f.endsWith('.css');
    const src = stripComments(readFileSync(f, 'utf8'), css);
    const lines = src.split('\n');
    /* kit.single: the name in the file's path, or in its code (comments are not code) */
    for (const [name, into] of Object.entries(RETIRED)) {
      const re = retiredPattern(name);
      if (re.test(rel)) at('kit.single', rel, 0, `the file is named for ${name}, which section 21 merged into ${into}`, rel);
      lines.forEach((l, i) => {
        re.lastIndex = 0;
        for (const m of l.matchAll(re)) {
          const before = l.slice(Math.max(0, m.index - 12), m.index);
          if (name === 'Banner' && /role\s*[=:]\s*["'`]?$/.test(before)) continue;   /* role="banner" is a landmark, not the component */
          at('kit.single', rel, i + 1, `uses ${name} ("${m[0]}"), which section 21 merged into ${into}`, l);
        }
      });
    }
    /* tokens.loose: literal spacing in CSS outside the token files */
    if (css && !TOKEN_FILES.some((r) => r.test(rel))) {
      lines.forEach((l, i) => {
        for (const m of l.matchAll(SPACE_PROP)) {
          const value = m[2].replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ');   /* a var() fallback is the token's, not loose */
          for (const v of value.matchAll(LOOSE)) {
            const n = Math.abs(parseFloat(v[1]));
            if (n === 0 || (v[2] === 'px' && n === 1)) continue;
            at('tokens.loose', rel, i + 1, `literal ${m[1]} ${v[1]}${v[2]}`, l);
          }
        }
      });
    }
  }
  /* kit.single: a story file per kit component */
  for (const name of [...KIT_V7, ...KIT_V7_EXTRA]) {
    const want = [join(KIT_STORIES, kebab(name) + '.stories.ts'), join(KIT_STORIES, name + '.stories.ts')];
    if (!want.some((p) => existsSync(p))) findings.push({ check: 'kit.single', area: 'components', file: 'src/lab/stories/kit/' + kebab(name) + '.stories.ts', line: 0, msg: `the kit component ${name} has no story file`, snippet: '', key: 'kit.single|stories|' + name });
  }
  /* contrast.accent: the derived tokens exist (the in-page check measures them) */
  const tokensCss = ['tokens.css', 'tokens.v7.css'].map((n) => join(SRC, 'styles', n)).filter(existsSync).map((p) => readFileSync(p, 'utf8')).join('\n');
  for (const t of ['--accent-text', '--on-accent', '--focus']) if (!new RegExp(t + '\\s*:').test(tokensCss)) findings.push({ check: 'contrast.accent', area: 'components', file: 'src/styles/tokens.css', line: 0, msg: `the theme defines no ${t} (section 18 derives it from the accent and checks it at 4.5:1)`, snippet: '', key: 'contrast.accent|token|' + t });
  return findings;
}

if (process.argv[1] && process.argv[1].endsWith('static-v7.mjs')) {
  const f = scanV7();
  const by = {};
  for (const x of f) { (by[x.check] ??= []).push(x); }
  for (const [c, xs] of Object.entries(by)) { console.log(c + ': ' + xs.length); for (const x of xs.slice(0, process.argv.includes('--all') ? 1e9 : 15)) console.log('  ' + x.file + ':' + x.line + '  ' + x.msg); }
  console.log('\n' + f.length + ' findings');
}
