#!/usr/bin/env node
/* `pnpm kit:docs`: the kit's article as ONE self-contained HTML file, dist-kit-docs/kit-docs.html (gitignored).

   1. builds kit-docs/ with vite.kit-docs.config.ts: one script, one stylesheet, the fonts inlined as data URIs;
   2. folds the script and the stylesheet into the page, so the file needs nothing beside it;
   3. checks the result: no reference to the network (no http(s) URL in a src, href, url() or @import; the v6 tokens' Google Fonts
      import is dropped, the fonts are the bundled ones), under 10 MB, and none of the words that must not appear in a published page
      (the owner's handle, a GitHub address, internal project names).
   Run it after changing a component's folder; the article is written from the folders, so it is then current. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(UI, 'dist-kit-docs');
const BUILD = join(OUT, 'build');
const FILE = join(OUT, 'kit-docs.html');

execFileSync(process.execPath, [join(UI, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.kit-docs.config.ts', '--logLevel', 'warn'], { cwd: UI, stdio: 'inherit' });

let page = readFileSync(join(BUILD, 'index.html'), 'utf8');
const asset = (ref) => readFileSync(join(BUILD, ref.replace(/^\.\//, '')), 'utf8');
/* the stylesheet: the remote font import of the v6 tokens goes (the faces are bundled and inlined) */
page = page.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, ref) => '<style>' + asset(ref).replace(/@import\s+(?:url\(\s*)?(["'])https?:[^"']*\1\s*\)?[^;]*;/g, '') + '</style>');
/* the script, as a module in the page; a literal "</script" inside it would end the element early */
page = page.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, ref) => '<script type="module">' + asset(ref).replace(/<\/script/gi, '<\\/script') + '</script>');
writeFileSync(FILE, page);

/* ───────── checks ───────── */
const problems = [];
const size = statSync(FILE).size;
if (size > 10 * 1024 * 1024) problems.push('the file is ' + (size / 1048576).toFixed(1) + ' MB, over 10 MB');
for (const m of page.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']|url\(\s*["']?https?:[^)]+\)|@import\s+(?:url\(\s*)?["']?https?:/gi)) problems.push('a network reference: ' + m[0].slice(0, 120));
if (/<link[^>]+rel="(?:stylesheet|modulepreload|preload)"/.test(page)) problems.push('a <link> to a file beside the page is left');
if (/<script[^>]+src=/.test(page)) problems.push('a <script src> is left');
const FORBIDDEN = [/aphesist/i, /github\.com/i, /\bhermes\b/i, /contraprova/i, /\benzo\b/i, /bethunter/i, /sundenlast/i];
for (const re of FORBIDDEN) { const m = re.exec(page); if (m) problems.push('the word "' + m[0] + '" appears (…' + page.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ') + '…)'); }
const leftovers = existsSync(BUILD) ? readdirSync(join(BUILD, 'assets')).length : 0;
if (!process.env.KEEP_BUILD) rmSync(BUILD, { recursive: true, force: true });
if (problems.length) { console.error('kit:docs: ' + FILE + '\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('kit:docs: ' + FILE + ' (' + (size / 1048576).toFixed(2) + ' MB, one file; ' + leftovers + ' built assets folded in or dropped)');
