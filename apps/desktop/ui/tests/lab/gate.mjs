/* The lab's CI gate (docs/UI-LAB.md, "What CI blocks on"): reads the reports and fails on any finding whose check is not `visual`.

   The v7 checks (rules.mjs rows with `v7: true`) are report-only until the v7 kit lands: today's v6 screens fail them by design and
   the kit replaces those screens. The switch is LAB_V7_BLOCKING: unset or 0, a v7 finding is printed and counted but does not fail
   the job; "kit", it blocks on the v7 kit's own stories (src/lab/stories/kit/) and source (src/components/v7/), which are built to
   pass it, and is reported for the v6 screens wave C moves; 1, it blocks everywhere. ci.yml sets "kit" since kit-v7.

   node tests/lab/gate.mjs [lab-report/summary.json] [--orbs lab-report-orbs/summary.json] */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS } from './rules.mjs';

const UI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const V7_BLOCKING = process.env.LAB_V7_BLOCKING === '1';
export const V7_KIT = process.env.LAB_V7_BLOCKING === 'kit';
/** a finding on the v7 kit: its stories, the app's surfaces already on it (stories/v7/: the shell, the rail, the Bots chat and rooms,
    w33/shell-bots), or the kit's own source files */
const onKit = (f) => (typeof f.story === 'string' && (f.story.startsWith('kit/') || f.story.startsWith('v7/'))) || (typeof f.file === 'string' && f.file.startsWith('src/components/v7/'));
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const first = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
const reports = [first ?? (opt('orbs') ? null : join(UI_ROOT, 'lab-report', 'summary.json')), opt('orbs')].filter(Boolean);
const findings = [];
for (const r of reports) {
  if (!existsSync(r)) { console.error('gate: no report at ' + r); process.exit(2); }
  findings.push(...JSON.parse(readFileSync(r, 'utf8')).findings);
}
const v7 = (f) => !!CHECKS[f.check]?.v7;
const count = (list) => { const by = {}; for (const f of list) by[f.check] = (by[f.check] ?? 0) + 1; return Object.entries(by).map(([k, v]) => k + ' ' + v).join(', '); };
const visual = findings.filter((f) => f.check === 'visual');
const blocksV7 = (f) => V7_BLOCKING || (V7_KIT && onKit(f));
const v7s = findings.filter((f) => f.check !== 'visual' && v7(f) && !blocksV7(f));
const bad = findings.filter((f) => f.check !== 'visual' && (!v7(f) || blocksV7(f)));
console.log(`lab gate: ${bad.length} failures that block, ${V7_BLOCKING ? 'v7 checks blocking' : v7s.length + ' v7 findings reported only (' + (V7_KIT ? 'the kit\'s block; the v6 screens\' are reported' : 'LAB_V7_BLOCKING is off') + ')'}, ${visual.length} screenshot differences (reported only)`);
if (v7s.length) console.log('  v7: ' + count(v7s));
if (bad.length) console.log('  blocking: ' + count(bad));
for (const f of bad.slice(0, 80)) console.log('  ' + f.check + ' | ' + (f.story ? f.story + ' / ' + f.state + ' | ' + (f.el ?? '') : f.file + ':' + (f.line ?? '')) + ' | ' + f.msg);
process.exit(bad.length ? 1 : 0);
