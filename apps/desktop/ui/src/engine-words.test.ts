/* The guard of ADR-0031 for the UI: boopis is the product and its engine is invisible, so no text the UI writes names it.
   This reads every source file (not tests, not the generated bindings, not the vendored contract) and fails on a string literal
   that says "Hermes" where a person could read it. It does not count:
   - code identifiers: a literal with no space, in lower or upper case (`'hermes-request'`, `'hermes'`); the prose spelling
     `Hermes` always counts;
   - log lines (`log.*(...)`), which go to the console and Diagnostics only;
   - PENDING: the model sign-in flows' strings (Settings > Models, the plan, "Change models"), which their own branch rewrites.
     Each entry must still be in the source, so the list empties itself as those strings change.
   Store items (core/engine-words.ts) are data, never literals, so they never meet this guard; the rendered-text check below
   shows they are left alone. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineWordsIn, storeItem } from './core/engine-words';

const SRC = dirname(fileURLToPath(import.meta.url));

const PENDING: readonly (readonly [string, string])[] = [
  ['host/models-tab.ts', 'Runs on your own Claude Code login, through Hermes\\\'s official plugin. boopis never sees your Claude login.'],
  ['host/models-tab.ts', 'Hermes\\\'s Claude subscription plugin. Change models installs it, after showing you what it is, when you choose the Claude subscription.'],
  ['host/models-tab.ts', 'Installed in Hermes'],
  ['host/models-tab.ts', 'Hermes could not be asked, so the ladder is not shown: ${view.error}'],
  ['host/free-tier.ts', 'Hermes says it lifts ${inWords(resetsAtMs - now)}, at ${clock(resetsAtMs)}.'],
  ['host/free-tier.ts', 'Hermes reports no usage figures for this plan. Its limits show here when one is reached.'],
  ['host/free-tier.ts', 'Hermes did not report the plan.'],
  ['host/free-tier.ts', 'Hermes reported no usage figures.'],
  ['host/plan-view.ts', 'Hermes is not connected, so the plan cannot be read.']
];

/** the statement marks of a log line */
const LOG = /\blog\.(debug|info|warn|error)\(|\bconsole\.\w+\(/;

interface Literal { text: string; at: number }

/** the string literals of a TypeScript source: '...', "..." and `...` (with `${}` kept as written), skipping comments,
    regular expressions after an operator, and nested template expressions' own code */
export function literals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let prev = '';
  while (i < src.length) {
    const c = src[i] ?? '';
    const n = src[i + 1] ?? '';
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(prev)) {
      // a regular expression literal
      i++;
      let cls = false;
      while (i < src.length && (src[i] !== '/' || cls)) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
      i++;
      prev = '/';
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const start = i;
      i++;
      let depth = 0;
      while (i < src.length) {
        const k = src[i];
        if (k === '\\') { i += 2; continue; }
        if (c === '`' && k === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (c === '`' && depth > 0 && k === '}') { depth--; i++; continue; }
        if (k === c && depth === 0) break;
        i++;
      }
      out.push({ text: src.slice(start + 1, i), at: start });
      i++;
      prev = 'x';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function files(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'vendor') files(p, acc); continue; }
    if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts') && name !== 'bindings.ts' && name !== 'testing.ts') acc.push(p);
  }
  return acc;
}

const isIdentifier = (t: string): boolean => !/\s/.test(t) && !t.includes('Hermes');

describe('the engine is never named in the UI (ADR-0031)', () => {
  it('no source literal a person can read names it', () => {
    const found: string[] = [];
    const seen = new Set<number>();
    for (const file of files(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      for (const lit of literals(src)) {
        if (!/hermes/i.test(lit.text) || isIdentifier(lit.text)) continue;
        const line = src.slice(src.lastIndexOf('\n', lit.at) + 1, src.indexOf('\n', lit.at));
        if (LOG.test(line)) continue;
        const k = PENDING.findIndex(([f, t]) => f === rel && t === lit.text);
        if (k >= 0) { seen.add(k); continue; }
        found.push(`${rel}:${String(src.slice(0, lit.at).split('\n').length)}: ${lit.text}`);
      }
    }
    expect(found, 'say it in boopis\'s words').toEqual([]);
    expect(PENDING.filter((_, k) => !seen.has(k)), 'these PENDING entries are gone from the source; remove them').toEqual([]);
  });

  it('the scanner reads the three quotes and skips comments, regexps and identifiers', () => {
    const src = "// 'Hermes in a comment'\nconst a = 'Hermes said'; const r = /hermes/i; const t = `x ${b ? 'Hermes inside' : ''} y`; const k = 'hermes-request';";
    expect(literals(src).map((l) => l.text)).toEqual(['Hermes said', "x ${b ? 'Hermes inside' : ''} y", 'hermes-request']);
    expect(isIdentifier('hermes-request') && !isIdentifier('Hermes') && !isIdentifier('ask hermes')).toBe(true);
  });

  it('the rendered-text check flags the engine, and leaves a store item\'s own name alone', () => {
    const root = document.createElement('div');
    root.innerHTML = storeItem('<p>Hermes web tools, by Nous Research for Hermes</p>') + '<p>boopis is ready</p>';
    expect(engineWordsIn(root)).toEqual([]);
    root.insertAdjacentHTML('beforeend', '<button aria-label="Ask Hermes">x</button><p>Hermes did not answer</p>');
    expect(engineWordsIn(root)).toEqual(['Ask Hermes', 'Hermes did not answer']);
  });
});
