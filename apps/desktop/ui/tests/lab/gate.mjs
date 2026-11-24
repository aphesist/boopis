/* The lab's CI gate (docs/UI-LAB.md, "What CI blocks on"): reads the reports and fails on any finding whose check is not `visual`,
   unless tests/lab/v7-allowlist.json names it as a known pre-v7 exception.

   The allowlist holds only v7 checks (rules.mjs rows with `v7: true`): the v6 stories that fail a v7 rule today, because the v7 kit
   is not built yet. It never weakens a rule: kit-v7 replaces those components and empties the list, and any finding it does not
   name (a new story, a new state, a check that newly fails, a new file) blocks. An entry that matched nothing is stale and is
   printed, so the list only shrinks; `--strict-stale` makes a stale entry fail too (a full run only).

   node tests/lab/gate.mjs [lab-report/summary.json] [--orbs lab-report-orbs/summary.json] [--strict-stale]
   node tests/lab/gate.mjs --write [--orbs ...]   rewrite the allowlist from the reports (only for a run of the whole matrix) */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS } from './rules.mjs';

const UI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ALLOW = join(UI_ROOT, 'tests', 'lab', 'v7-allowlist.json');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const reports = [argv[0] && !argv[0].startsWith('--') ? argv[0] : join(UI_ROOT, 'lab-report', 'summary.json'), opt('orbs')].filter(Boolean);
const findings = [];
for (const r of reports) {
  if (!existsSync(r)) { console.error('gate: no report at ' + r); process.exit(2); }
  findings.push(...JSON.parse(readFileSync(r, 'utf8')).findings);
}
const v7 = (check) => !!CHECKS[check]?.v7;
/* orbs move by design: whether one orb's edge flips in a given window is not the same from run to run, so an orb story is excused
   whole (every state); every other check is excused per state */
const WHOLE_STORY = new Set(['orb.rest', 'orb.edges']);

/* ───────── write ───────── */
if (argv.includes('--write')) {
  const prev = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : {};
  const stories = new Map(), files = new Map();
  for (const f of findings) {
    if (!v7(f.check)) continue;
    if (f.story) {
      const k = f.check + '|' + f.story;
      const e = stories.get(k) ?? { check: f.check, story: f.story, states: new Set() };
      e.states.add(WHOLE_STORY.has(f.check) ? '*' : f.state);
      stories.set(k, e);
    } else if (f.file) {
      const k = f.check + '|' + f.file + '|' + f.msg;
      files.set(k, { check: f.check, file: f.file, msg: f.msg });
    }
  }
  const out = {
    about: prev.about ?? 'Known pre-v7 exceptions to the v7 lab checks (docs/UI-LAB.md, "The v7 checks"). Each entry is a v6 story or source file that fails a v7 rule today because the v7 kit is not built. w32/kit-v7 must empty this list; CI blocks on any finding it does not name.',
    reasons: Object.fromEntries([...new Set([...stories.values(), ...files.values()].map((e) => e.check))].sort().map((c) => [c, prev.reasons?.[c] ?? 'the v6 component this story draws predates the v7 rule (' + (CHECKS[c].rule ?? CHECKS[c].ds) + '); kit-v7 replaces it'])),
    stories: [...stories.values()].sort((a, b) => (a.check + a.story < b.check + b.story ? -1 : 1)).map((e) => ({ check: e.check, story: e.story, states: e.states.has('*') ? '*' : [...e.states].sort() })),
    files: [...files.values()].sort((a, b) => (a.check + a.file + a.msg < b.check + b.file + b.msg ? -1 : 1))
  };
  writeFileSync(ALLOW, JSON.stringify(out, null, 1) + '\n');
  console.log(`gate: wrote ${out.stories.length} story entries and ${out.files.length} file entries to ${ALLOW}`);
  process.exit(0);
}

/* ───────── check ───────── */
const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : { stories: [], files: [] };
const bogus = [...allow.stories, ...allow.files].filter((e) => !v7(e.check));
if (bogus.length) { console.error('gate: the allowlist may name v7 checks only; these are not: ' + bogus.map((e) => e.check).join(', ')); process.exit(1); }
const used = new Set();
const excused = (f) => {
  if (!v7(f.check)) return false;
  if (f.story) {
    const i = allow.stories.findIndex((e) => e.check === f.check && e.story === f.story && (e.states === '*' || e.states.includes(f.state)));
    if (i >= 0) { used.add('s' + i); return true; }
  } else if (f.file) {
    const i = allow.files.findIndex((e) => e.check === f.check && e.file === f.file && e.msg === f.msg);
    if (i >= 0) { used.add('f' + i); return true; }
  }
  return false;
};
const blocking = findings.filter((f) => f.check !== 'visual');
const bad = blocking.filter((f) => !excused(f));
const visual = findings.length - blocking.length;
const known = blocking.length - bad.length;
console.log(`lab gate: ${bad.length} failures that block, ${known} known pre-v7 exceptions (v7-allowlist.json), ${visual} screenshot differences (reported only)`);
const by = {};
for (const f of bad) by[f.check] = (by[f.check] ?? 0) + 1;
if (bad.length) console.log('  by check: ' + Object.entries(by).map(([k, v]) => k + ' ' + v).join(', '));
for (const f of bad.slice(0, 80)) console.log('  ' + f.check + ' | ' + (f.story ? f.story + ' / ' + f.state + ' | ' + (f.el ?? '') : f.file + ':' + (f.line ?? '')) + ' | ' + f.msg);
const stale = [...allow.stories.map((e, i) => ['s' + i, e.check + ' | ' + e.story]), ...allow.files.map((e, i) => ['f' + i, e.check + ' | ' + e.file + ' | ' + e.msg])].filter(([k]) => !used.has(k));
/* only checks this run produced can prove an entry stale (a run narrowed to one story, or without the orb report, proves nothing else) */
const ran = new Set(findings.map((f) => f.check));
const provable = stale.filter(([, d]) => ran.has(d.split(' | ')[0]));
if (provable.length) {
  console.log(`  ${provable.length} allowlist entries matched nothing in this run (fixed: remove them from v7-allowlist.json):`);
  for (const [, d] of provable.slice(0, 40)) console.log('    ' + d);
}
process.exit(bad.length || (argv.includes('--strict-stale') && provable.length) ? 1 : 0);
