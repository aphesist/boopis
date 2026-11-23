#!/usr/bin/env node
/* The craft checker: measures a rendered video (and, with --scene, the page it came from) against the craft bible.

   node tools/qa/qa.mjs <video.mp4> [--scene test] [--variant vertical] [--json out.json] [--no-build] [--dist dir]
   node tools/qa/qa.mjs --joins a1.mp4,a2.mp4,a3.mp4,a4.mp4 [--page-joins] [--variant vertical]

   Video (any mp4, the first trailer included)    Page (--scene: the DOM and the timeline, exact)
     stillness: share, longest hold (<= 1.5 s)      text under 28 px at 1080p (sampled 4 a second)
     dips to black (pure and near)                  the first claim (words on screen by 1.5 s)
     full-frame cross-fades (not drifts)            linear easing on any tween (none allowed)
     double images (shutter samples as copies)      opacity tweens on large elements (full-layer fades)
     hard cuts                                      stillness of the content itself (no grain, no codec)
     first words (heuristic)                        scene marks
     length, scene changes                          text cut by the frame or outside the safe area (layout.mjs)
                                                    an act's elements drawn outside its span (layout.mjs)
   Video and page (a video of the --scene)          inline capsules off the line's baseline (layout.mjs)
     double images confirmed: the render against
     the page at 64 sub-frames (frames.mjs)        Joins (frames.mjs): --joins, the last frame of each act's
                                                    render against the next's first; --page-joins, the same
                                                    from the act scenes on the page

   --shutter 180 (the renders' shutter angle), --confirm 4 (how many fast frames to re-render besides the detector's).
   Exit code 1 when a rule fails. Methods and calibration: tools/qa/README section in media/launch/README.md. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { probe, stillness, blacks, cuts, crossfades, firstWords, round, XF_AREA } from './video.mjs';
import { doubleImages } from './doubles.mjs';
import { pageChecks } from './page.mjs';
import { serve } from '../lib/serve.mjs';
import { buildFilm, distDir, openFilm, ROOT } from '../lib/build.mjs';
import { readFile } from 'node:fs/promises';
import { textEdges, actSpans, actWindows, chipBaselines } from './layout.mjs';
import { videoJoins, pageFrame, diffRegions, confirmDoubles, fastestFrames } from './frames.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const scene = opt('--scene', null), variant = opt('--variant', 'landscape'), shutterDeg = Number(opt('--shutter', '180')), jsonOut = opt('--json', null), noBuild = flag('--no-build'), query = opt('--query', ''), joins = opt('--joins', null), pageJoins = flag('--page-joins'), dist = opt('--dist', null), confirmN = Number(opt('--confirm', '4'));
const file = argv[0] ? resolve(argv[0]) : null;
if (!file && !scene && !joins && !pageJoins) { console.error('usage: qa.mjs <video> [--scene name] [--variant vertical] [--json out.json] [--joins a1.mp4,a2.mp4,a3.mp4,a4.mp4] [--page-joins]'); process.exit(2); }

const report = { file, scene, variant, rules: [] };
const rule = (name, value, ok, note) => report.rules.push({ name, value, ok, note });

if (file) {
  const p = probe(file);
  const st = await stillness(file);
  const bl = await blacks(file, p.fps);
  const cu = await cuts(file, p.fps);
  const blends = await crossfades(file, bl.flags, p.fps);
  /* a blend over 8% of the frame is a layer cross-fading (the trailer's ghosted eyes measure 11%); smaller ones are an
     element fading, which the bible allows under 10% when it also moves: listed, not failed. Blocks a move explains
     (a drift, a push, a panel sliding) are not blends (video.mjs) */
  const xf = blends.filter((b) => b.area >= XF_AREA), small = blends.filter((b) => b.area < XF_AREA);
  const doubles = await doubleImages(file, { ...p, shutter: shutterDeg / 360 });
  const words = await firstWords(file);
  delete bl.flags;
  /* scene changes a viewer sees as such: hard cuts, dips through an empty frame, cross-fades (merged within 0.5 s) */
  const events = [...cu.map((t) => ({ t, kind: 'cut' })), ...bl.nearAt.map((b) => ({ t: b.at, kind: 'dip' })), ...xf.map((x) => ({ t: x.at, kind: 'crossfade' }))].sort((a, b) => a.t - b.t);
  const changes = [];
  for (const e of events) if (!changes.length || e.t - changes[changes.length - 1].t > 0.5) changes.push(e);
  report.video = { ...p, stillness: st, blacks: bl, cuts: cu, crossfades: xf, elementFades: small, doubleImages: doubles, firstWords: words, sceneChanges: changes.length, changes };
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
  rule('double images (moving things as sharp copies)', doubles.length + (doubles.length ? ' (' + doubles.map((d) => d.at + '-' + d.until + ' s at ' + d.region.join(',') + ', copies ' + d.gap + ' px apart').join('; ') + ')' : ''), doubles.length === 0, 'a smooth smear, never two shutter samples');
  rule('hard cuts', cu.length, null, 'on the beat');
  rule('first words on screen (video heuristic)', words == null ? 'none found' : words + ' s', words != null && words <= 1.5, 'by 1.5 s');
  rule('scene changes (cuts, dips, cross-fades)', changes.length, null, '');
}

const seams = actWindows(await readFile(resolve(ROOT, 'src/acts/seams.ts'), 'utf8'), Infinity);
const seamTimes = [seams.a2[0], seams.a3[0], seams.a4[0]];
const region = (r) => r.box.join(',') + (r.moved ? ' moved ' + r.moved.join(',') : '') + ' (' + r.diff + ')';

/* the act joins in the renders: the four acts' files of one variant, in order */
if (joins) {
  const files = joins.split(',').map((f) => resolve(f));
  if (files.length !== 4) throw new Error('--joins takes the four acts\' videos, in order');
  const pj = probe(files[0]);
  const js = videoJoins(files, seamTimes, pj);
  report.joins = js;
  /* a region of one 8x8 block (32 px at 1080p) is left to grain and the codec; two or more is a pop */
  for (const j of js) rule('act join at ' + j.at + ' s (renders)', j.regions.length ? j.regions.length + ' region(s): ' + j.regions.slice(0, 4).map(region).join('; ') : 'match', !j.regions.some((r) => r.blocks >= 2), 'last frame of ' + j.from + ' = first of ' + j.to + ', within grain');
}

if (scene || pageJoins) {
  const out = distDir(dist);
  if (!noBuild) await buildFilm(out);
  const srv = await serve(out);
  const urlFor = (sc) => srv.url + 'index.html?render=1&scene=' + encodeURIComponent(sc) + (variant === 'vertical' ? '&variant=vertical' : '') + (query ? '&' + query.replace(/^[?&]/, '') : '');
  const size = variant === 'vertical' ? { width: 1080, height: 1920 } : {};
  try {
    if (scene) {
      const pg = await pageChecks(urlFor(scene), { vertical: variant === 'vertical' });
      report.page = pg;
      rule('page: text under 28 px', pg.text.under28.length ? pg.text.under28.map((s) => '"' + s.text.slice(0, 40) + '" ' + s.px + ' px at ' + round(s.from, 2) + '-' + round(s.to, 2) + ' s').join('; ') : 'none (smallest ' + pg.text.smallest + ' px)', pg.text.under28.length === 0, 'at least 28 px at 1080p');
      rule('page: mounted UI under the floor', pg.warnings.length ? pg.warnings.join('; ') : 'none', pg.warnings.length ? 'warn' : true, 'mount() zoom so the smallest text is 28 px or more');
      rule('page: first claim', pg.firstClaim == null ? 'none' : pg.firstClaim + ' s ("' + (pg.claimText ?? '').slice(0, 40) + '")', pg.firstClaim != null && pg.firstClaim <= 1.5, 'words on screen by 1.5 s');
      rule('page: linear easing', pg.linear.length ? pg.linear.map((l) => l.target + ' ' + l.props + ' at ' + l.at + ' s').join('; ') : 'none (' + pg.tweens + ' tweens)', pg.linear.length === 0, 'no linear ease on anything that starts or stops');
      rule('page: unspecified eases', pg.unspecified, pg.unspecified === 0, 'every tween names a curve');
      rule('page: full-layer opacity fades', pg.fades.length ? pg.fades.map((f) => f.target + ' ' + Math.round(f.area * 100) + '% at ' + round(f.start, 2) + ' s').join('; ') : 'none', pg.fades.length === 0, 'opacity only on elements under 10% of the frame');
      rule('page: content still share / longest hold', pg.stillness.stillShare + ' / ' + pg.stillness.longestHold + ' s at ' + pg.stillness.longestHoldAt + ' s', pg.stillness.longestHold <= 1.5, 'without grain or codec noise');
      rule('page: scene marks', pg.marks.length + (pg.marks.length ? ' (' + pg.marks.map((m) => round(m.t, 2) + ' ' + m.name).join('; ') + ')' : ''), null, '');
      /* layout on the live page: text at the frame's edge, an act's elements outside its span, capsules off the line */
      const { browser, page } = await openFilm(urlFor(scene) + '&nograin', size);
      try {
        const dur = await page.evaluate(() => window.__film.duration);
        const edges = await textEdges(page, { vertical: variant === 'vertical' });
        const spans = await actSpans(page, { ...seams, a4: [seams.a4[0], Infinity] });
        const chips = await chipBaselines(page);
        report.layout = { textEdges: edges, actSpans: spans, chips };
        rule('page: text cut by the frame or outside the safe area', edges.length ? edges.length + ': ' + edges.slice(0, 6).map((e) => '"' + e.text.slice(0, 30) + '" ' + e.kind + ' at ' + e.from + '-' + e.to + ' s').join('; ') + (edges.length > 6 ? '; ...' : '') : 'none', edges.length === 0, variant === 'vertical' ? '9:16: inside x 60-960, y 220-1640' : '16:9: 48 px inside every edge');
        const strays = spans.filter((e) => !e.carried), carries = spans.filter((e) => e.carried);
        rule('page: an act\'s elements outside its span', strays.length ? strays.length + ': ' + strays.slice(0, 6).map((e) => e.owner + ' (' + e.act + ', ' + e.span + ') ' + e.when + ' at ' + e.from + '-' + e.to + ' s').join('; ') + (strays.length > 6 ? '; ...' : '') : 'none', strays.length === 0, 'by class a1- to a4-, the acts at ' + seamTimes.join(', ') + ' s');
        if (carries.length) rule('page: carried across a seam', carries.map((e) => e.owner + ' (' + e.act + ') to ' + e.to + ' s').join('; '), null, 'ctx.carry: continuous from inside its act');
        rule('page: inline capsules on the line\'s baseline', chips.off.length ? chips.off.length + ': ' + chips.off.slice(0, 5).map((c) => c.chip + ' in "' + c.text.slice(0, 24) + '" ' + c.offset + ' px (product ' + c.expected + ') at ' + c.from + '-' + c.to + ' s').join('; ') : 'none (' + chips.all.length + ' capsules)', chips.off.length === 0, 'within 1 px of the product\'s own offset');
        /* the double-image confirmation: a render of this scene re-rendered at 64 samples where it moves fastest */
        if (file) {
          const pv = probe(file), fps = pv.fps;
          if (Math.abs(pv.duration - dur) > 0.1) rule('double images confirmed at 64 samples', 'not run: the video is not this scene (' + round(pv.duration, 2) + ' s against ' + round(dur, 2) + ' s)', null, '');
          else {
            const ev = report.video?.doubleImages ?? [];
            const frames = [...new Set([...ev.map((e) => Math.round(((e.at + e.until) / 2) * fps)), ...fastestFrames(file, confirmN)])].sort((a, b) => a - b);
            const cdp = await page.context().newCDPSession(page);
            const cf = await confirmDoubles(page, cdp, file, frames, { W: pv.width, H: pv.height, fps, shutter: shutterDeg / 360 });
            report.confirm = cf;
            const doubled = cf.filter((c) => c.status === 'doubled'), mism = cf.filter((c) => c.status === 'mismatch');
            if (mism.length > cf.length / 2) rule('double images confirmed at 64 samples', 'not confirmed: the render is not of this source (' + mism.length + ' of ' + cf.length + ' frames differ everywhere, median ' + Math.max(...mism.map((m) => m.median)) + ')', null, 're-render the act from this source');
            else rule('double images confirmed at 64 samples', doubled.length ? doubled.length + ' of ' + cf.length + ' frames: ' + doubled.map((c) => 'f' + c.frame + ' (' + c.t + ' s) ' + c.regions.slice(0, 2).map(region).join(', ')).join('; ') : 'none in ' + cf.length + ' frames (' + frames.join(', ') + ')', doubled.length === 0, 'the render against the page at 64 sub-frames');
          }
        }
      } finally { await browser.close(); }
    }
    /* the act joins on the page: act N's scene at its last frame against act N+1's at its first, no grain */
    if (pageJoins) {
      const shots = [];
      for (const a of ['a1', 'a2', 'a3', 'a4']) {
        const { browser, context, page } = await openFilm(urlFor(a) + '&nograin', size);
        try {
          const m = await page.evaluate(() => ({ d: window.__film.duration, fps: window.__film.fps, W: window.__film.width, H: window.__film.height }));
          const cdp = await context.newCDPSession(page), w = m.W >= m.H ? 480 : 270;
          await page.evaluate((t) => window.__film.seek(t, { paint: true }), 0);
          const first = await pageFrame(page, cdp, { W: m.W, H: m.H, w });
          await page.evaluate((t) => window.__film.seek(t, { paint: true }), (Math.round(m.d * m.fps) - 1) / m.fps);
          const last = await pageFrame(page, cdp, { W: m.W, H: m.H, w });
          shots.push({ first, last, W: m.W });
        } finally { await browser.close(); }
      }
      report.pageJoins = [];
      for (let i = 0; i < 3; i++) {
        const A = shots[i].last, B = shots[i + 1].first;
        const d = diffRegions(A.g, B.g, A.w, A.h, { level: 2, scale: shots[i].W / A.w });
        report.pageJoins.push({ at: seamTimes[i], ...d });
        rule('act join at ' + seamTimes[i] + ' s (page)', d.regions.length ? d.regions.length + ' region(s): ' + d.regions.slice(0, 4).map(region).join('; ') : 'match', !d.regions.some((r) => r.blocks >= 2), 'a' + (i + 1) + '\'s last frame = a' + (i + 2) + '\'s first');
      }
    }
  } finally { await srv.close(); }
}

const w = Math.max(...report.rules.map((r) => r.name.length));
console.log('\ncraft check: ' + (file ?? joins ?? '') + (scene ? ' [page: ' + scene + (variant === 'vertical' ? ', vertical' : '') + ']' : ''));
for (const r of report.rules) console.log((r.ok === null ? '  ·  ' : r.ok === 'warn' ? 'warn ' : r.ok ? ' ok  ' : 'FAIL ') + r.name.padEnd(w) + '  ' + r.value + (r.note ? '   [' + r.note + ']' : ''));
const fails = report.rules.filter((r) => r.ok === false).length;
console.log(fails ? '\n' + fails + ' rule(s) failed' : '\nall rules pass');
if (jsonOut) await writeFile(resolve(jsonOut), JSON.stringify(report, null, 1));
process.exitCode = fails ? 1 : 0;
