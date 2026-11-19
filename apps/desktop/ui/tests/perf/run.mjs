/* The perf harness: the same scenarios in a real WebKitGTK webview (under Xvfb) and in Chromium (Playwright), frame times
   from requestAnimationFrame deltas. `pnpm perf:webkit -- --help` for the options. See README.md. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, serve, startServers, OUT } from '../lib.mjs';
import { VARIANTS } from './variants.mjs';

const require = createRequire(import.meta.url);
void require;
const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_JS = join(HERE, 'scenarios.js');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
if (opt('help', false)) {
  console.log(`node tests/perf/run.mjs [options]
  --engines webkit-cpu,webkit,chromium
                                webkit-cpu: WebKitGTK as the owner runs it (WEBKIT_DISABLE_DMABUF_RENDERER=1: CPU painting, no GL);
                                webkit: WebKitGTK's default (GL compositing; llvmpipe under Xvfb); chromium: Playwright's Chromium
                                (default: webkit-cpu,webkit,chromium; also webkit-shm = WEBKIT_DMABUF_RENDERER_FORCE_SHM=1,
                                webkit-nocomp = WEBKIT_DISABLE_COMPOSITING_MODE=1)
  --scenarios a,b               ${'idle,idle-bots,dock-morph,dock-magnify,dock-pages,dock-keys,dock-session,create-bot,tab-switch,resize'} (default: all but idle-bots)
  --variants baseline,orbs-static  one candidate cause off at a time (${Object.keys(VARIANTS).join(', ')})
  --repeat N                    runs per cell; the median of each statistic is reported (default 1)
  --scale 2                     device pixel ratio: GDK_SCALE for WebKitGTK, deviceScaleFactor for Chromium (default 2, the owner's laptop)
  --width 1800 --height 1125   window in CSS pixels (the owner's Hyprland window at scale 1.6: GTK3 renders at 2x)
  --dist DIR                    serve this dist-e2e instead of the working tree's (a build of an earlier commit, for a before-and-after)
  --display real                run WebKitGTK on the session's own display (a window opens), not under Xvfb: for a machine with a GPU
  --env K=V,K2=V2               extra environment for WebKitGTK (on top of the engine's), e.g. HYPOTAXIS_RENDERER is not read here: use
                                the WebKit variables themselves
  --python /usr/bin/python3     the interpreter that has gi and WebKit2 4.1 (default /usr/bin/python3.12; Arch: /usr/bin/python)
  --label name                  tag for the JSON written to test-results/perf/
  --json                        print JSON only`);
  process.exit(0);
}
const engines = String(opt('engines', 'webkit-cpu,webkit,chromium')).split(',');
const WEBKIT_ENV = { 'webkit-cpu': { WEBKIT_DISABLE_DMABUF_RENDERER: '1' }, webkit: {}, 'webkit-shm': { WEBKIT_DMABUF_RENDERER_FORCE_SHM: '1' }, 'webkit-nocomp': { WEBKIT_DISABLE_COMPOSITING_MODE: '1' } };
const scenarios = String(opt('scenarios', 'idle,dock-morph,dock-magnify,dock-pages,dock-keys,dock-session,create-bot,tab-switch,resize')).split(',');
const variants = String(opt('variants', 'baseline')).split(',');
const repeat = +opt('repeat', 1), scale = +opt('scale', 2), W = +opt('width', 1800), H = +opt('height', 1125);
const label = String(opt('label', 'run'));
const realDisplay = opt('display', 'xvfb') === 'real';
const PYTHON = String(opt('python', '/usr/bin/python3.12'));
const EXTRA_ENV = Object.fromEntries(String(opt('env', '')).split(',').filter(Boolean).map((kv) => kv.split(/=(.*)/s).slice(0, 2)));
const profileOf = opt('profile', null);   /* a scenario to CPU-profile in Chromium */
function printProfile(p, name) {
  const self = new Map(), byId = new Map(p.nodes.map((n) => [n.id, n]));
  p.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0)); });
  /* a native that forces style or layout (getPropertyValue, getBoundingClientRect, getClientRects, offset*) is charged to the page function that called it */
  const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const FORCERS = /^(getPropertyValue|getBoundingClientRect|getClientRects|getComputedStyle|querySelectorAll|matches|closest|focus|animate)$/;
  const callers = new Map();
  p.samples.forEach((id, i) => { const n = byId.get(id); if (!FORCERS.test(n.callFrame.functionName)) return; const q = byId.get(parent.get(id)); if (!q) return; const f = q.callFrame, k = `${n.callFrame.functionName} <- ${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`; callers.set(k, (callers.get(k) || 0) + (p.timeDeltas[i] || 0)); });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`-- forced style/layout calls by caller (ms)`);
  for (const [k, v] of [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String((v / 1000).toFixed(1)).padStart(8) + ' ms  ' + k);
  console.log(`\n-- CPU profile of ${name}: top self time (of ${(total / 1000).toFixed(0)} ms sampled)`);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(String((v / 1000).toFixed(1)).padStart(8) + ' ms  ' + k);
}
const KEYS = ['layoutMsPerFrame', 'styleMsPerFrame', 'layouts', 'styleRecalcs', 'p50', 'p95', 'p99', 'max', 'over16', 'over33', 'fps', 'scriptMsPerFrame', 'canvasClears', 'blankOrbFrames', 'frames'];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* --dist DIR serves another build of the UI (a `dist-e2e` of an earlier commit) with this harness, for a before-and-after */
const distArg = opt('dist', null);
const srv = distArg ? await serve({ '/': distArg, '/__fonts/': join(OUT, '..', 'node_modules', '@fontsource') }) : await startServers();
const url = srv.origin + '/index.html';
const scenariosSrc = readFileSync(SCENARIOS_JS, 'utf8');
const results = {};   /* engine -> variant -> scenario -> stats */

/* async on purpose: the static server runs in this process, and a blocking spawn would starve the page it has to serve */
async function webkitOnce(eng, variant, names, tmp) {
  const v = VARIANTS[variant] ?? {};
  const py = [PYTHON, join(HERE, 'webkit-runner.py'), '--url', url, '--scenarios', names.join(','), '--scenarios-js', SCENARIOS_JS, '--width', String(W), '--height', String(H), '--out', tmp, '--timeout', '400'];
  const args = realDisplay ? py.slice(1) : ['-a', '-s', `-screen 0 ${W * scale}x${H * scale}x24`, ...py];
  if (v.css) { writeFileSync(tmp + '.css', v.css); args.push('--css', tmp + '.css'); }
  if (v.js) { writeFileSync(tmp + '.js', v.js); args.push('--js', tmp + '.js'); }
  rmSync(tmp, { force: true });
  const stderr = await new Promise((done) => {
    const env = { ...process.env, NO_AT_BRIDGE: '1', ...(realDisplay ? {} : { GDK_SCALE: String(scale), GDK_DPI_SCALE: '1' }), ...WEBKIT_ENV[eng], ...EXTRA_ENV };
    const child = spawn(realDisplay ? PYTHON : 'xvfb-run', args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const t = setTimeout(() => child.kill('SIGKILL'), 450000);
    child.on('close', () => { clearTimeout(t); done(err); });
  });
  if (!existsSync(tmp)) throw new Error('WebKitGTK run produced nothing: ' + stderr.slice(-600));
  const j = JSON.parse(readFileSync(tmp, 'utf8'));
  return j;
}
async function chromiumOnce(browser, variant, names) {
  const v = VARIANTS[variant] ?? {};
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__perfPost = () => {}; });
  await page.exposeFunction('__perfNative', async (op, args) => {
    if (op !== 'resize') return;
    for (let i = 1; i <= args.steps; i++) { await page.setViewportSize({ width: Math.round(args.from + (args.to - args.from) * i / args.steps), height: H }); await page.waitForTimeout(args.ms); }
  });
  await page.addInitScript({ content: scenariosSrc });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__hx && document.querySelector('#hx-dock .dk-row') && !document.getElementById('hx-app').classList.contains('is-booting'), null, { timeout: 30000 });
  if (v.css) await page.addStyleTag({ content: v.css });
  if (v.js) await page.evaluate((s) => (0, eval)(s), v.js);
  await page.waitForTimeout(1500);
  const out = { engine: 'chromium ' + browser.version(), scenarios: {}, info: await page.evaluate(() => window.__perf.info()) };
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  for (const n of names) {
    /* Chromium only: how the frame splits into layout, style recalculation and script (seconds from CDP, here in ms per frame) */
    const profiling = profileOf === n;
    await page.evaluate(() => window.__perf.reset());
    if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    const m0 = await metrics();
    const r = await page.evaluate((x) => window.__perf.record(window.__perf.scenarios[x].run).then((q) => Object.assign(q, { name: x })), n);
    const m1 = await metrics();
    const per = (k) => +(((m1[k] - m0[k]) * 1000) / Math.max(1, r.frames)).toFixed(2);
    Object.assign(r, { layoutMsPerFrame: per('LayoutDuration'), styleMsPerFrame: per('RecalcStyleDuration'), taskMsPerFrame: per('TaskDuration'), layouts: Math.round((m1.LayoutCount - m0.LayoutCount) / Math.max(1, r.frames) * 100) / 100, styleRecalcs: Math.round((m1.RecalcStyleCount - m0.RecalcStyleCount) / Math.max(1, r.frames) * 100) / 100 });
    if (profiling) { const { profile } = await cdp.send('Profiler.stop'); printProfile(profile, n); }
    out.scenarios[n] = r;
  }
  out.info.after = await page.evaluate(() => window.__perf.info());
  await ctx.close();
  return out;
}

const browser = engines.includes('chromium') ? await chromium.launch({ args: ['--enable-precise-memory-info'] }) : null;
mkdirSync(join(OUT, 'perf'), { recursive: true });
const infos = {};
for (const eng of engines) {
  results[eng] = {};
  for (const variant of variants) {
    const runs = [];
    for (let i = 0; i < repeat; i++) {
      process.stderr.write(`[${eng}] ${variant} run ${i + 1}/${repeat}\n`);
      const tmp = join(OUT, 'perf', `.tmp-${eng}-${variant}.json`);
      runs.push(eng.startsWith('webkit') ? await webkitOnce(eng, variant, scenarios, tmp) : await chromiumOnce(browser, variant, scenarios));
    }
    infos[eng] = runs[0].engine;
    results[eng][variant] = {};
    for (const n of scenarios) {
      const cell = {};
      for (const k of KEYS) { const vals = runs.map((r) => r.scenarios[n]?.[k]).filter((x) => typeof x === 'number'); if (vals.length) cell[k] = +median(vals).toFixed(1); }
      if (runs.some((r) => r.scenarios[n]?.error)) cell.error = runs.find((r) => r.scenarios[n]?.error).scenarios[n].error.split('\n')[0];
      results[eng][variant][n] = cell;
    }
    results[eng][variant]._info = runs[0].info;
  }
}
if (browser) await browser.close();
await srv.close();
const file = join(OUT, 'perf', `${label}.json`);
writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), scale, W, H, repeat, infos, results }, null, 1));
if (opt('json', false)) { console.log(JSON.stringify(results)); process.exit(0); }
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
for (const eng of engines) {
  console.log(`\n== ${infos[eng]} · dpr ${scale} · ${W}x${H} ==`);
  for (const variant of variants) {
    console.log(`-- ${variant}   (live orbs ${results[eng][variant]._info?.live}, canvas px ${results[eng][variant]._info?.canvasPx}, quality ${results[eng][variant]._info?.quality})`);
    console.log(pad('scenario', 14) + ['p50', 'p95', 'max', '>16.7', '>33.4', 'fps', 'js/frame', 'clears', 'blank'].map((h) => lpad(h, 9)).join(''));
    for (const n of scenarios) {
      const c = results[eng][variant][n];
      if (c.layoutMsPerFrame != null) console.log(pad('', 14) + `  chromium per frame: layout ${c.layoutMsPerFrame} ms (${c.layouts}x), style ${c.styleMsPerFrame} ms (${c.styleRecalcs}x)`);
      console.log(pad(n, 14) + [c.p50, c.p95, c.max, c.over16, c.over33, c.fps, c.scriptMsPerFrame, c.canvasClears, c.blankOrbFrames].map((x) => lpad(x ?? '-', 9)).join('') + (c.error ? '  ERR ' + c.error : ''));
    }
  }
}
console.log('\nwritten', file);
