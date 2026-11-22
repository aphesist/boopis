/* The static half of the token check: hard-coded colours, font sizes and radii in the UI's CSS and TypeScript,
   outside the token files (tokens.css and its generated tokens.json). Bot looks (an orb's colour is bot data, not
   interface colour), vendored code, tests and the lab itself are not interface styling and are skipped.
   `node tests/lab/static-scan.mjs` prints the findings; check.mjs folds them into the report. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { UI_ROOT } from './serve.mjs';
import { areaOfPath } from './rules.mjs';

const SRC = join(UI_ROOT, 'src');
const SKIP = [/^styles\/tokens\.(css|json)$/, /^vendor\//, /\.test\.ts$/, /^lab\//, /^host\/bindings\.ts$/, /^data\/(mock-data|bot-catalog)\.ts$/, /^components\/look\.ts$/, /\.d\.ts$/, /^host\/fixtures\//, /^components\/squircle-golden\.json$/];
/* where a literal is data, not styling: the theme runtime's presets and contrast maths, the mod colour mapper's literal guard, a bot's look */
const DATA_FILES = [/^styles\/theme\.ts$/, /^components\/mod-colors\.ts$/, /^modules\/bots\/(paint|new-bot|names)\.ts$/, /^vendor\//];

function files(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...files(p)); else if (/\.(css|ts)$/.test(d.name)) out.push(p);
  }
  return out;
}
const stripComments = (s, css) => (css ? s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) : s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length)));

export function scan() {
  const findings = [];
  for (const f of files(SRC)) {
    const rel = relative(SRC, f).replace(/\\/g, '/');
    if (SKIP.some((r) => r.test(rel))) continue;
    if (statSync(f).size > 400000) continue;
    const css = f.endsWith('.css');
    const text = stripComments(readFileSync(f, 'utf8'), css);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = (msg, m) => findings.push({ check: 'tokens.static', area: areaOfPath(rel), file: 'src/' + rel, line: i + 1, msg, snippet: line.trim().slice(0, 160), key: 'tokens.static|' + rel + '|' + msg });
      if (css) {
        for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\d[^)]*\)|hsla?\([^)]*\)/g)) {
          if (/var\(/.test(m[0])) continue;
          at('literal colour ' + m[0], m);
        }
        const sw = /scrollbar-(width|color)\s*:\s*([^;]+)/.exec(line);
        /* R-scroll-1 allows exactly one setting: scrollbar-width: none on a hidden bar (R-scroll-7's tab strips) */
        if (sw && !(sw[1] === 'width' && sw[2].trim() === 'none')) findings.push({ check: 'scrollbar', area: areaOfPath(rel), file: 'src/' + rel, line: i + 1, msg: 'sets scrollbar-' + sw[1] + ' (' + sw[2].trim() + '), which WebKitGTK ignores; scrollbars are drawn with ::-webkit-scrollbar (R-scroll-1)', snippet: line.trim().slice(0, 160), key: 'scrollbar|' + rel + '|' + i });
        const fs = /font(?:-size)?\s*:[^;]*?\b(\d+(?:\.\d+)?)px/.exec(line);
        if (fs && !/var\(--fs/.test(line.slice(fs.index, fs.index + fs[0].length + 10))) at('literal font size ' + fs[1] + 'px', fs);
        const br = /border-radius\s*:\s*([^;]*)/.exec(line);
        if (br && /\b([1-9]\d*(?:\.\d+)?)px/.test(br[1]) && !/var\(/.test(br[1]) && !/^\s*(999px|50%)/.test(br[1])) at('literal radius ' + br[1].trim(), br);
      } else if (!DATA_FILES.some((r) => r.test(rel))) {
        for (const m of line.matchAll(/['"`][^'"`]*?(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])|rgba?\(\s*\d[^)]*\))[^'"`]*?['"`]/g)) {
          if (/[a-z]{2,} [a-z]{2,} [a-z]{2,}/i.test(m[0])) continue;   /* a sentence that names a colour (copy), not styling */
          if (/^#[0-9a-f]{3}$/i.test(m[1]) && !/(color|background|fill|stroke|border)/i.test(line)) continue;   /* '#abc' as an id or a hash, not a colour */
          at('literal colour ' + m[1] + ' in a string', m);
        }
        for (const m of line.matchAll(/style(?:=\\?["']|\.cssText\s*=\s*['"`])[^'"`]*?\b(gap|padding|margin|width|height|font-size)\s*:\s*(\d+(?:\.\d+)?)px/g)) if (m[2] !== '0') at('literal ' + m[1] + ' ' + m[2] + 'px in an inline style', m);
        for (const m of line.matchAll(/(font-size|border-radius|fontSize|borderRadius)\s*[:=]\s*['"`]?\s*(\d+(?:\.\d+)?)px/g)) if (m[2] !== '0') at('literal ' + m[1] + ' ' + m[2] + 'px in a string', m);
      }
    });
  }
  return findings;
}

if (process.argv[1] && process.argv[1].endsWith('static-scan.mjs')) {
  const f = scan();
  for (const x of f) console.log(x.file + ':' + x.line + '  [' + x.area + ']  ' + x.msg + '\n    ' + x.snippet);
  console.log('\n' + f.length + ' literal values outside the token files');
}
