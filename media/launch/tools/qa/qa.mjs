#!/usr/bin/env node
/* The craft checker: measures a rendered video (and, with --scene, the page it came from) against the craft bible.

   node tools/qa/qa.mjs <video.mp4> [--scene test] [--variant vertical] [--json out.json] [--no-build]

   Video (any mp4, the first trailer included)    Page (--scene: the DOM and the timeline, exact)
     stillness: share, longest hold (<= 1.5 s)      text under 28 px at 1080p (sampled 4 a second)
     dips to black (pure and near)                  the first claim (words on screen by 1.5 s)
     full-frame cross-fades                         linear easing on any tween (none allowed)
     hard cuts                                      opacity tweens on large elements (full-layer fades)
     first words (heuristic)                        stillness of the content itself (no grain, no codec)
     length, scene changes                          scene marks

   Exit code 1 when a rule fails. Methods and calibration: tools/qa/README section in media/launch/README.md. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { probe, stillness, blacks, cuts, crossfades, firstWords, round } from './video.mjs';
import { pageChecks } from './page.mjs';
import { serve } from '../lib/serve.mjs';
import { buildFilm, ROOT } from '../lib/build.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const scene = opt('--scene', null), variant = opt('--variant', 'landscape'), jsonOut = opt('--json', null), noBuild = flag('--no-build');
const file = argv[0] ? resolve(argv[0]) : null;
if (!file && !scene) { console.error('usage: qa.mjs <video> [--scene name] [--variant vertical] [--json out.json]'); process.exit(2); }

const report = { file, scene, variant, rules: [] };
const rule = (name, value, ok, note) => report.rules.push({ name, value, ok, note });

if (file) {
  const p = probe(file);
  const st = await stillness(file);
  const bl = await blacks(file, p.fps);
  const cu = await cuts(file, p.fps);
  const blends = await crossfades(file, bl.flags, p.fps);
  /* a blend over 8% of the frame is a layer cross-fading (the trailer's ghosted eyes measure 11%); smaller ones are an
     element fading, which the bible allows under 10% when it also moves: listed, not failed */
  const xf = blends.filter((b) => b.area >= 0.08), small = blends.filter((b) => b.area < 0.08);
  const words = await firstWords(file);
  delete bl.flags;
  /* scene changes a viewer sees as such: hard cuts, dips through an empty frame, cross-fades (merged within 0.5 s) */
  const events = [...cu.map((t) => ({ t, kind: 'cut' })), ...bl.nearAt.map((b) => ({ t: b.at, kind: 'dip' })), ...xf.map((x) => ({ t: x.at, kind: 'crossfade' }))].sort((a, b) => a.t - b.t);
  const changes = [];
  for (const e of events) if (!changes.length || e.t - changes[changes.length - 1].t > 0.5) changes.push(e);
  report.video = { ...p, stillness: st, blacks: bl, cuts: cu, crossfades: xf, elementFades: small, firstWords: words, sceneChanges: changes.length, changes };
  rule('length', round(p.duration, 2) + ' s', null, 'main cut 45 to 60 s');
  /* the bible's rule is the hold (<= 1.5 s); the share is the corpus comparison, so it warns rather than fails */
  rule('still share (12 fps, 160x90, < 0.6)', st.stillShare, st.stillShare <= 0.4 ? true : 'warn', 'MG corpus median 0.19; warns over 0.4');
  rule('longest hold', st.longestHold + ' s at ' + st.longestHoldAt + ' s', st.longestHold <= 1.5, 'at most 1.5 s');
  rule('holds of 1 s or more', st.holds1s, null, 'MG corpus 2 to 6');
  rule('motion index', st.motionIndex, null, 'MG corpus median 5.4');
  rule('dips to pure black', bl.pure + (bl.pure ? ' (' + bl.pureSeconds + ' s: ' + bl.pureAt.map((b) => b.at).join(', ') + ')' : ''), bl.pure === 0, 'none: hand off instead');
  rule('dips to near black (empty frames)', bl.near, bl.near === 0, 'none');
  rule('full-frame cross-fades', xf.length + (xf.length ? ' (' + xf.map((x) => x.at + '-' + x.until + ' s, ' + Math.round(x.area * 100) + '% of frame').join('; ') + ')' : ''), xf.length === 0, 'none: morph, mask or pull focus');
  rule('element fades (blends under 8%)', small.length, null, 'allowed on small elements that also move');
  rule('hard cuts', cu.length, null, 'on the beat');
  rule('first words on screen (video heuristic)', words == null ? 'none found' : words + ' s', words != null && words <= 1.5, 'by 1.5 s');
  rule('scene changes (cuts, dips, cross-fades)', changes.length, null, '');
}

if (scene) {
  if (!noBuild) await buildFilm();
  const srv = await serve(resolve(ROOT, 'dist'));
  try {
    const pg = await pageChecks(srv.url + 'index.html?render=1&scene=' + encodeURIComponent(scene) + (variant === 'vertical' ? '&variant=vertical' : ''), { vertical: variant === 'vertical' });
    report.page = pg;
    rule('page: text under 28 px', pg.text.under28.length ? pg.text.under28.map((s) => '"' + s.text.slice(0, 40) + '" ' + s.px + ' px at ' + round(s.from, 2) + '-' + round(s.to, 2) + ' s').join('; ') : 'none (smallest ' + pg.text.smallest + ' px)', pg.text.under28.length === 0, 'at least 28 px at 1080p');
    rule('page: first claim', pg.firstClaim == null ? 'none' : pg.firstClaim + ' s ("' + (pg.claimText ?? '').slice(0, 40) + '")', pg.firstClaim != null && pg.firstClaim <= 1.5, 'words on screen by 1.5 s');
    rule('page: linear easing', pg.linear.length ? pg.linear.map((l) => l.target + ' ' + l.props + ' at ' + l.at + ' s').join('; ') : 'none (' + pg.tweens + ' tweens)', pg.linear.length === 0, 'no linear ease on anything that starts or stops');
    rule('page: unspecified eases', pg.unspecified, pg.unspecified === 0, 'every tween names a curve');
    rule('page: full-layer opacity fades', pg.fades.length ? pg.fades.map((f) => f.target + ' ' + Math.round(f.area * 100) + '% at ' + round(f.start, 2) + ' s').join('; ') : 'none', pg.fades.length === 0, 'opacity only on elements under 10% of the frame');
    rule('page: content still share / longest hold', pg.stillness.stillShare + ' / ' + pg.stillness.longestHold + ' s at ' + pg.stillness.longestHoldAt + ' s', pg.stillness.longestHold <= 1.5, 'without grain or codec noise');
    rule('page: scene marks', pg.marks.length + (pg.marks.length ? ' (' + pg.marks.map((m) => round(m.t, 2) + ' ' + m.name).join('; ') + ')' : ''), null, '');
  } finally { await srv.close(); }
}

const w = Math.max(...report.rules.map((r) => r.name.length));
console.log('\ncraft check: ' + (file ?? '') + (scene ? ' [page: ' + scene + (variant === 'vertical' ? ', vertical' : '') + ']' : ''));
for (const r of report.rules) console.log((r.ok === null ? '  ·  ' : r.ok === 'warn' ? 'warn ' : r.ok ? ' ok  ' : 'FAIL ') + r.name.padEnd(w) + '  ' + r.value + (r.note ? '   [' + r.note + ']' : ''));
const fails = report.rules.filter((r) => r.ok === false).length;
console.log(fails ? '\n' + fails + ' rule(s) failed' : '\nall rules pass');
if (jsonOut) await writeFile(resolve(jsonOut), JSON.stringify(report, null, 1));
process.exitCode = fails ? 1 : 0;
